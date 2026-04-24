import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import mdnsFactory from "multicast-dns";

// ── @lydell/node-pty dynamic import with clear error ────────────────────────
let nodePty: typeof import("@lydell/node-pty");
try {
  nodePty = await import("@lydell/node-pty");
} catch (err) {
  console.error(
    "[ad] FATAL: could not load @lydell/node-pty.",
    "\n       If this is a native module build error, run:",
    "\n         pnpm approve-builds",
    "\n       or:",
    "\n         pnpm rebuild @lydell/node-pty",
    "\n       Original error:",
    err
  );
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────────────────────
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 8787);
const PASSPHRASE = process.env.PASSPHRASE ?? "agentdeck-dummy";
const MDNS_HOSTNAME = (process.env.MDNS_HOSTNAME ?? "agentdeck.local").toLowerCase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Session store (file-backed so it survives server restart) ────────────────
interface PtySession {
  pty: import("@lydell/node-pty").IPty | null;
  ws?: import("ws").WebSocket;
  username?: string;
  createdAt: number;
}

const SESSIONS_FILE = join(__dirname, "sessions.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const sessions = new Map<string, PtySession>();

// Hydrate from disk at boot (PTYs don't survive — only the tokens are valid)
function loadSessions(): void {
  if (!existsSync(SESSIONS_FILE)) return;
  try {
    const raw = readFileSync(SESSIONS_FILE, "utf8");
    const data = JSON.parse(raw) as Array<{ token: string; username?: string; createdAt: number }>;
    const now = Date.now();
    let loaded = 0;
    for (const entry of data) {
      if (now - entry.createdAt > SESSION_TTL_MS) continue;
      sessions.set(entry.token, { pty: null, username: entry.username, createdAt: entry.createdAt });
      loaded++;
    }
    console.log(`[ad] restored ${loaded} session(s) from disk`);
  } catch (e) {
    console.log("[ad] could not restore sessions:", e);
  }
}

function persistSessions(): void {
  try {
    const data = [...sessions.entries()].map(([token, sess]) => ({
      token,
      username: sess.username,
      createdAt: sess.createdAt,
    }));
    writeFileSync(SESSIONS_FILE, JSON.stringify(data), "utf8");
  } catch (e) {
    console.log("[ad] could not persist sessions:", e);
  }
}

function validateToken(token: string | undefined): boolean {
  if (typeof token !== "string" || !sessions.has(token)) return false;
  const sess = sessions.get(token)!;
  if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    persistSessions();
    return false;
  }
  return true;
}

loadSessions();

// ── Projects store (file-backed) ─────────────────────────────────────────────
interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

const PROJECTS_FILE = join(__dirname, "projects.json");
let projects: Project[] = [];

function loadProjects(): void {
  if (!existsSync(PROJECTS_FILE)) return;
  try {
    projects = JSON.parse(readFileSync(PROJECTS_FILE, "utf8"));
    console.log(`[ad] loaded ${projects.length} project(s)`);
  } catch (e) {
    console.log("[ad] could not load projects:", e);
    projects = [];
  }
}

function persistProjects(): void {
  try {
    writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf8");
  } catch (e) {
    console.log("[ad] could not persist projects:", e);
  }
}

// Expand ~ to $HOME; resolve and return real path info
function validateProjectPath(input: string): { ok: true; resolved: string } | { ok: false; error: string } {
  if (!input || typeof input !== "string") return { ok: false, error: "Ruta vacía" };
  let p = input.trim();
  if (p.startsWith("~")) p = (process.env.HOME ?? os.homedir()) + p.slice(1);
  try {
    const stat = statSync(p);
    if (!stat.isDirectory()) return { ok: false, error: "La ruta no es un directorio" };
    return { ok: true, resolved: p };
  } catch {
    return { ok: false, error: "La ruta no existe" };
  }
}

loadProjects();

// ── LAN IP detection ─────────────────────────────────────────────────────────
function getLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const addrs = ifaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

function maskPassphrase(p: string): string {
  if (p.length <= 4) return "****";
  return p.slice(0, 2) + "***" + p.slice(-2);
}

// ── Fastify ──────────────────────────────────────────────────────────────────
const app = Fastify({ logger: false });

await app.register(fastifyCookie);
await app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  // Serve static assets (icons, css) automatically. Explicit routes for
  // `/` and `/login` override the auto-serve because Fastify picks the
  // most specific match first. `index: false` prevents the plugin from
  // serving `public/index.html` when someone hits `/` — that still goes
  // through our auth-checked handler.
  serve: true,
  index: false,
  wildcard: false,
});
await app.register(fastifyWebSocket);

// Content-type parser MUST be registered before routes that use it
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, body, done) => {
    try {
      const parsed: Record<string, string> = {};
      for (const pair of (body as string).split("&")) {
        const [k, v] = pair.split("=").map(decodeURIComponent);
        if (k) parsed[k] = v ?? "";
      }
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// ── Auth helper ──────────────────────────────────────────────────────────────
function isAuthenticated(req: import("fastify").FastifyRequest): boolean {
  return validateToken(req.cookies.ad_session);
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Health — public
app.get("/health", async (_req, reply) => {
  return reply.send({ ok: true });
});

// GET / — serve index or redirect to login
app.get("/", async (req, reply) => {
  if (!isAuthenticated(req)) {
    return reply.redirect("/login");
  }
  return reply.sendFile("index.html", join(__dirname, "public"));
});

// GET /login
app.get("/login", async (_req, reply) => {
  return reply.sendFile("login.html", join(__dirname, "public"));
});

// POST /login
app.post(
  "/login",
  { config: { rawBody: false } },
  async (req, reply) => {
    const body = req.body as Record<string, string> | undefined;
    const submitted = body?.passphrase ?? "";
    const username = (body?.username ?? "").trim() || "local";

    if (submitted !== PASSPHRASE) {
      console.log(`[ad] login failed — user=${username}`);
      return reply.redirect("/login?error=1");
    }

    const token = randomBytes(32).toString("hex");
    sessions.set(token, { pty: null, username, createdAt: Date.now() });
    persistSessions();

    console.log(`[ad] login ok — user=${username}, session persisted`);
    return reply
      .setCookie("ad_session", token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_MS / 1000, // seconds
      })
      .redirect("/");
  }
);

// POST /logout
app.post("/logout", async (req, reply) => {
  const token = req.cookies.ad_session;
  if (token && sessions.has(token)) {
    const sess = sessions.get(token)!;
    try { sess.pty?.kill(); } catch { /* ignore */ }
    sessions.delete(token);
    persistSessions();
    console.log("[ad] logout — session removed");
  }
  return reply
    .clearCookie("ad_session", { path: "/" })
    .send({ ok: true });
});

// POST /kill — kill PTY for this session
app.post("/kill", async (req, reply) => {
  if (!isAuthenticated(req)) {
    return reply.status(401).send({ ok: false, error: "unauthorized" });
  }
  const token = req.cookies.ad_session!;
  const sess = sessions.get(token);
  if (sess?.pty) {
    try {
      sess.pty.kill("SIGTERM");
      console.log("[ad] PTY killed by /kill endpoint");
    } catch (e) {
      console.log("[ad] PTY kill error:", e);
    }
  }
  return reply.send({ ok: true });
});

// WS /ws/terminal
app.get(
  "/ws/terminal",
  { websocket: true },
  (socket, req) => {
    // Auth check happens here — at WS handshake time, before any data flows
    const token = req.cookies.ad_session;
    if (!validateToken(token)) {
      console.log("[ad] WS rejected — invalid or missing session cookie");
      socket.close(4401, "Unauthorized");
      return;
    }

    console.log("[ad] WS opened — spawning PTY");

    const shell = process.env.SHELL ?? "zsh";
    const pty = nodePty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME ?? os.homedir(),
      env: {
        ...(process.env as Record<string, string>),
        // zsh: suppress the trailing `%` it prints when output lacks a newline
        // (it's meant for terminal users but looks like garbage in chat UI).
        PROMPT_EOL_MARK: "",
        // Mark that the shell runs inside AgentDeck so user-level scripts can
        // adjust their output if they care to.
        AGENTDECK_SESSION: "1",
      },
    });

    const sess = sessions.get(token!)!;
    sess.pty = pty;
    sess.ws = socket as unknown as import("ws").WebSocket;

    // PTY → WS
    pty.onData((data) => {
      try {
        socket.send(JSON.stringify({ t: "out", d: data }));
      } catch {
        // ws may already be closing
      }
    });

    pty.onExit(({ exitCode }) => {
      console.log(`[ad] PTY exited — code ${exitCode}`);
      try {
        socket.send(JSON.stringify({ t: "exit", code: exitCode }));
      } catch { /* ignore */ }
      socket.close();
    });

    // WS → PTY
    socket.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          t: "in" | "resize";
          d?: string;
          cols?: number;
          rows?: number;
        };

        if (msg.t === "in" && typeof msg.d === "string") {
          pty.write(msg.d);
        } else if (msg.t === "resize" && msg.cols && msg.rows) {
          pty.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed messages
      }
    });

    // WS close → kill PTY
    socket.on("close", () => {
      console.log("[ad] WS closed — killing PTY");
      try {
        pty.kill("SIGTERM");
        // Give it 3s then SIGKILL
        setTimeout(() => {
          try { pty.kill("SIGKILL"); } catch { /* already dead */ }
        }, 3000);
      } catch { /* ignore */ }
    });
  }
);

// ── Projects API ─────────────────────────────────────────────────────────────

// GET /projects — list
app.get("/projects", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  return reply.send({ items: projects });
});

// POST /projects — create
app.post("/projects", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const body = req.body as { name?: string; path?: string } | undefined;
  const name = (body?.name ?? "").trim();
  const rawPath = (body?.path ?? "").trim();
  if (!name) return reply.status(400).send({ ok: false, error: "Nombre requerido" });
  const v = validateProjectPath(rawPath);
  if (!v.ok) return reply.status(400).send({ ok: false, error: v.error });
  const project: Project = {
    id: randomBytes(8).toString("hex"),
    name,
    path: v.resolved,
    createdAt: Date.now(),
  };
  projects.push(project);
  persistProjects();
  return reply.status(201).send(project);
});

// DELETE /projects/:id — remove
app.delete("/projects/:id", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const id = (req.params as { id: string }).id;
  const before = projects.length;
  projects = projects.filter((p) => p.id !== id);
  if (projects.length === before) return reply.status(404).send({ ok: false, error: "No existe" });
  persistProjects();
  return reply.status(204).send();
});

// POST /projects/:id/open — cd into project in active PTY
app.post("/projects/:id/open", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const id = (req.params as { id: string }).id;
  const project = projects.find((p) => p.id === id);
  if (!project) return reply.status(404).send({ ok: false, error: "No existe" });

  const token = req.cookies.ad_session!;
  const sess = sessions.get(token);
  if (!sess?.pty) {
    return reply.send({ ok: false, needsSession: true, path: project.path, name: project.name });
  }

  // Quote the path so spaces survive (iCloud Drive paths have many)
  const quoted = `'${project.path.replace(/'/g, "'\\''")}'`;
  sess.pty.write(`cd ${quoted}\n`);
  return reply.send({ ok: true, path: project.path, name: project.name });
});

// ── mDNS responder: announce `agentdeck.local` on the LAN ────────────────────
// Any Apple device (iPhone/iPad/Mac) and most modern OSes resolve .local
// via multicast DNS automatically. No /etc/hosts edit, no router config.
const mdns = mdnsFactory();
mdns.on("query", (query) => {
  for (const q of query.questions) {
    if (q.name?.toLowerCase() === MDNS_HOSTNAME && (q.type === "A" || q.type === "ANY")) {
      const ip = getLanIp();
      if (!ip) continue;
      mdns.respond({
        answers: [{
          name: MDNS_HOSTNAME,
          type: "A",
          ttl: 60,
          data: ip,
        }],
      });
    }
  }
});

function shutdown(signal: string) {
  console.log(`[ad] ${signal} — shutting down`);
  try { mdns.destroy(); } catch { /* ignore */ }
  app.close().finally(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start ─────────────────────────────────────────────────────────────────────
await app.listen({ host: HOST, port: PORT });

const lanIp = getLanIp();
console.log("[ad] ─────────────────────────────────────────────");
console.log(`[ad] Local:  http://127.0.0.1:${PORT}`);
if (lanIp) {
  console.log(`[ad] LAN:    http://${lanIp}:${PORT}`);
}
console.log(`[ad] mDNS:   http://${MDNS_HOSTNAME}:${PORT}  ← use this on iPhone/iPad/Mac`);
console.log(`[ad] Pass:   ${maskPassphrase(PASSPHRASE)}`);
console.log("[ad] ─────────────────────────────────────────────");
