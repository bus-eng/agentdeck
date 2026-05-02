// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Roberto Bustamante (virela-dev)

import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import { randomBytes, randomUUID } from "node:crypto";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import os from "node:os";
import { resolveBrowsePath, browseDirectory } from "./src/fs-browse.js";
import { db, schema } from "./src/db/index.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { projectRoutes } from "./src/routes/projects.js";
import mdnsFactory from "multicast-dns";

let nodePty: typeof import("@lydell/node-pty");
try {
  nodePty = (await import("@lydell/node-pty")) as typeof import("@lydell/node-pty");
} catch (err) {
  console.error("[ad] FATAL: could not load @lydell/node-pty.\n       Run: npm run rebuild\n       Error:", err);
  process.exit(1);
}

let deckLib: any;
try {
  deckLib = await import("./src/deck.js");
} catch (err) {
  console.error("[ad] WARN: deck module not available:", err);
  deckLib = {};
}

function loadLocalEnv(): void {
  const candidates = [join(process.cwd(), ".env.local"), join(process.cwd(), ".env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const ALLOW_LAN = process.env.AGENTDECK_ALLOW_LAN === "true";
const HOST = ALLOW_LAN ? (process.env.HOST ?? "0.0.0.0") : "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const PASSPHRASE = process.env.PASSPHRASE ?? "agentdeck-dummy";
const AGENTDECK_AUTH_TOKEN = process.env.AGENTDECK_AUTH_TOKEN ?? "";
const AGENTDECK_WORKSPACE = process.env.AGENTDECK_WORKSPACE ?? "";
const MDNS_HOSTNAME = (process.env.MDNS_HOSTNAME ?? "agentdeck.local").toLowerCase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PtySession {
  pty: import("@lydell/node-pty").IPty | null;
  ws?: import("ws").WebSocket;
  username?: string;
  createdAt: number;
  reconnectKillTimer?: ReturnType<typeof setTimeout> | null;
  ptyDataDisposable?: { dispose(): void } | null;
  ptyExitDisposable?: { dispose(): void } | null;
  outputTail?: string;
  outputTailStart?: number;
  outputTotalChars?: number;
}

const SESSIONS_FILE = join(__dirname, "sessions.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PTY_REATTACH_GRACE_MS = 1000 * 60 * 3;
const PTY_OUTPUT_TAIL_MAX = 256 * 1024;

const sessions = new Map<string, PtySession>();

function getLanIp(): string | undefined {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return undefined;
}

function maskPassphrase(p: string): string {
  if (p.length <= 4) return "*".repeat(p.length);
  return p.slice(0, 2) + "***" + p.slice(-2);
}

function clearReconnectKillTimer(sess: PtySession): void {
  if (sess.reconnectKillTimer) {
    clearTimeout(sess.reconnectKillTimer);
    sess.reconnectKillTimer = null;
  }
}

function appendOutputTail(sess: PtySession, chunk: string): void {
  sess.outputTotalChars = (sess.outputTotalChars ?? 0) + chunk.length;
  const next = (sess.outputTail ?? "") + chunk;
  const trimmed = next.length > PTY_OUTPUT_TAIL_MAX ? next.slice(next.length - PTY_OUTPUT_TAIL_MAX) : next;
  sess.outputTail = trimmed;
  sess.outputTailStart = (sess.outputTotalChars ?? 0) - trimmed.length;
}

function getReplayFrom(sess: PtySession, seenChars: number): string {
  const tail = sess.outputTail ?? "";
  const tailStart = sess.outputTailStart ?? 0;
  const total = sess.outputTotalChars ?? 0;
  const normalizedSeen = Math.max(0, Math.min(seenChars, total));
  if (!tail) return "";
  if (normalizedSeen <= tailStart) return tail;
  const offset = normalizedSeen - tailStart;
  return offset >= tail.length ? "" : tail.slice(offset);
}

function teardownPtyBindings(sess: PtySession): void {
  try { sess.ptyDataDisposable?.dispose(); } catch { }
  try { sess.ptyExitDisposable?.dispose(); } catch { }
  sess.ptyDataDisposable = null;
  sess.ptyExitDisposable = null;
}

function killSessionPty(sess: PtySession, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
  clearReconnectKillTimer(sess);
  const pty = sess.pty;
  if (!pty) return;
  teardownPtyBindings(sess);
  try { pty.kill(signal); } catch { }
  sess.pty = null;
}

function spawnSessionPty(): import("@lydell/node-pty").IPty {
  const shell = process.env.AGENTDECK_SHELL ?? "/bin/zsh";
  const shellArgs = shell.endsWith("zsh") ? ["-fi"] : ["-i"];
  const DEFAULT_PATH = [
    `${os.homedir()}/.local/bin`,
    `${os.homedir()}/.nvm/versions/node/v22.22.2/bin`,
    "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin",
    "/usr/bin", "/bin", "/usr/sbin", "/sbin",
  ].join(":");
  return nodePty.spawn(shell, shellArgs, {
    name: "xterm-256color", cols: 80, rows: 24,
    cwd: process.env.HOME ?? os.homedir(),
    env: {
      ...(process.env as Record<string, string>),
      HOME: os.homedir(), USER: os.userInfo().username,
      LOGNAME: os.userInfo().username,
      PATH: DEFAULT_PATH + (process.env.PATH ? ":" + process.env.PATH : ""),
      TERM: "xterm-256color", LANG: process.env.LANG ?? "en_US.UTF-8",
      PROMPT_EOL_MARK: "", AGENTDECK_SESSION: "1",
    },
  });
}

function attachPtyToSocket(sess: PtySession, socket: import("ws").WebSocket, seenChars = 0): void {
  const isReattach = !!sess.pty;
  clearReconnectKillTimer(sess);
  if (!sess.pty) sess.pty = spawnSessionPty();
  if (sess.ws && sess.ws !== socket) {
    try { sess.ws.close(1012, "Reattached from another client"); } catch { }
  }
  sess.ws = socket;
  const pty = sess.pty;
  teardownPtyBindings(sess);
  sess.ptyDataDisposable = pty.onData((data) => {
    appendOutputTail(sess, data);
    const seq = sess.outputTotalChars ?? 0;
    if (sess.ws !== socket) return;
    try { socket.send(JSON.stringify({ t: "out", d: data, seq })); } catch { }
  });
  sess.ptyExitDisposable = pty.onExit(({ exitCode }) => {
    console.log(`[ad] PTY exited — code ${exitCode}`);
    teardownPtyBindings(sess);
    sess.pty = null;
    clearReconnectKillTimer(sess);
    if (sess.ws === socket) {
      try { socket.send(JSON.stringify({ t: "exit", code: exitCode })); } catch { }
      try { socket.close(); } catch { }
      sess.ws = undefined;
    }
  });
  try {
    socket.send(JSON.stringify({ t: "session", state: isReattach ? "reattached" : "fresh" }));
    if (isReattach) {
      const replay = getReplayFrom(sess, seenChars);
      if (replay) socket.send(JSON.stringify({ t: "replay", d: replay, seq: sess.outputTotalChars ?? 0 }));
    }
  } catch { }
}

function schedulePtyTermination(sess: PtySession): void {
  clearReconnectKillTimer(sess);
  sess.reconnectKillTimer = setTimeout(() => {
    if (sess.ws || !sess.pty) return;
    console.log("[ad] PTY reattach grace expired — killing orphan PTY");
    const orphanPty = sess.pty;
    try { orphanPty.kill("SIGTERM"); } catch { }
    setTimeout(() => {
      if (!sess.ws && sess.pty === orphanPty) killSessionPty(sess, "SIGKILL");
    }, 3000);
  }, PTY_REATTACH_GRACE_MS);
}

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
  } catch (e) { console.log("[ad] could not restore sessions:", e); }
}

function persistSessions(): void {
  try {
    const data = [...sessions.entries()].map(([token, sess]) => ({ token, username: sess.username, createdAt: sess.createdAt }));
    writeFileSync(SESSIONS_FILE, JSON.stringify(data), "utf8");
  } catch (e) { console.log("[ad] could not persist sessions:", e); }
}

function validateToken(token: string | undefined): boolean {
  if (typeof token !== "string" || !sessions.has(token)) return false;
  const sess = sessions.get(token)!;
  if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
    sessions.delete(token); persistSessions(); return false;
  }
  return true;
}

loadSessions();

interface Project { id: string; name: string; path: string; createdAt: number; }
const PROJECTS_FILE = join(__dirname, "projects.json");
let projectsDB: Project[] = [];

function loadProjects(): void {
  if (!existsSync(PROJECTS_FILE)) return;
  try {
    projectsDB = JSON.parse(readFileSync(PROJECTS_FILE, "utf8")) as Project[];
  } catch { projectsDB = []; }
}

function persistProjects(): void {
  writeFileSync(PROJECTS_FILE, JSON.stringify(projectsDB, null, 2), "utf8");
}

loadProjects();

// ── Fastify bootstrap ──────────────────────────────────────────────────────────
const app = Fastify({ logger: false });

await app.register(fastifyCookie);
await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
await app.register(fastifyStatic, { root: join(__dirname, "public"), serve: true, index: false, wildcard: false });
await app.register(fastifyWebSocket);

app.decorate("sessions", sessions);

await app.register(projectRoutes);

app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
  try {
    if (typeof body !== "string") { done(null, {}); return; }
    const parsed: Record<string, string> = {};
    for (const pair of body.split("&")) {
      if (!pair) continue;
      const idx = pair.indexOf("=");
      if (idx === -1) { parsed[decodeURIComponent(pair)] = ""; continue; }
      const k = decodeURIComponent(pair.slice(0, idx));
      const v = decodeURIComponent(pair.slice(idx + 1));
      if (k) parsed[k] = v;
    }
    done(null, parsed);
  } catch (err) { done(err as Error, undefined); }
});

function isAuthenticated(req: import("fastify").FastifyRequest): boolean {
  return validateToken(req.cookies.ad_session);
}

function getUserId(req: import("fastify").FastifyRequest): string | null {
  const token = req.cookies.ad_session;
  if (!validateToken(token)) return null;
  return sessions.get(token!)?.username ?? token ?? null;
}

// ── Auth routes ─────────────────────────────────────────────────────────────────
app.get("/health", async (_req, reply) => reply.send({ ok: true }));

app.get("/", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.redirect("/login");
  return reply.type("text/html").send(readFileSync(join(__dirname, "public", "index.html"), "utf8").replace(/__VERSION__/g, String(Date.now())));
});

app.get("/login", async (_req, reply) => reply.sendFile("login.html", join(__dirname, "public")));

app.get("/settings", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.redirect("/login");
  return reply.sendFile("settings.html", join(__dirname, "public"));
});

app.post("/login", { config: { rawBody: false } }, async (req, reply) => {
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
      path: "/", httpOnly: true, sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
      secure: !ALLOW_LAN,
    })
    .redirect("/");
});

app.post("/logout", async (req, reply) => {
  const token = req.cookies.ad_session;
  if (token && sessions.has(token)) {
    const sess = sessions.get(token)!;
    killSessionPty(sess, "SIGTERM");
    sessions.delete(token);
    persistSessions();
    console.log("[ad] logout — session removed");
  }
  return reply.redirect("/login");
});

// ── WebSocket: terminal ─────────────────────────────────────────────────────────
app.get("/ws/terminal", { websocket: true }, (socket, req) => {
  if (!isAuthenticated(req)) {
    socket.close(4401, "Unauthorized");
    return;
  }
  const token = req.cookies.ad_session;
  if (!token || !sessions.has(token)) {
    socket.close(4401);
    return;
  }
  let seenChars = 0;
  try {
    const rawUrl = req.raw.url ?? "/ws/terminal";
    const url = new URL(rawUrl, "http://agentdeck.local");
    seenChars = Number(url.searchParams.get("seen") ?? "0");
    if (!Number.isFinite(seenChars) || seenChars < 0) seenChars = 0;
  } catch { seenChars = 0; }

  const sess = sessions.get(token!)!;
  const hadPty = !!sess.pty;
  console.log(hadPty ? "[ad] WS opened — reattaching PTY" : "[ad] WS opened — spawning PTY");
  attachPtyToSocket(sess, socket as unknown as import("ws").WebSocket, seenChars);

  let msgCount = 0;
  const msgReset = setInterval(() => { msgCount = 0; }, 1000).unref();
  socket.on("message", (raw: import("ws").RawData) => {
    if (++msgCount > 60) { socket.close(4409, "rate limited"); return; }
    let msg: { t?: string; d?: string };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === "in" && msg.d) {
      sess.pty?.write(msg.d);
    } else if (msg.t === "resize") {
      const p = msg.d as unknown as { cols?: number; rows?: number };
      if (p?.cols && p?.rows) {
        try { sess.pty?.resize(p.cols, p.rows); } catch { }
      }
    }
  });
  socket.on("close", () => clearInterval(msgReset));

  socket.on("close", () => {
    if (sess.ws !== socket) return;
    console.log("[ad] WS closed — PTY kept alive for reattach grace period");
    sess.ws = undefined;
    schedulePtyTermination(sess);
  });
});

// ── Kill endpoint ───────────────────────────────────────────────────────────────
app.post("/kill", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const token = req.cookies.ad_session;
  const sess = sessions.get(token!);
  if (sess?.pty) {
    try {
      killSessionPty(sess, "SIGTERM");
      console.log("[ad] PTY killed by /kill endpoint");
    } catch (e) { console.log("[ad] PTY kill error:", e); }
  }
  return reply.send({ ok: true });
});

// ── Projects API ────────────────────────────────────────────────────────────────
app.get("/projects", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false, error: "unauthorized" });
  return reply.send({ items: projectsDB });
});

app.post("/projects", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false, error: "unauthorized" });
  const body = req.body as { name?: string; path?: string } | undefined;
  const name = (body?.name ?? "").trim();
  let path = (body?.path ?? "").trim();
  if (!name) return reply.status(400).send({ ok: false, error: "name required" });
  if (!path) return reply.status(400).send({ ok: false, error: "path required" });
  if (path.startsWith("~")) path = (process.env.HOME ?? "/tmp") + path.slice(1);
  const existing = projectsDB.find((p) => p.path === path);
  if (existing) return reply.status(409).send({ ok: false, error: "project with this path already exists" });
  const project: Project = { id: randomUUID(), name, path, createdAt: Date.now() };
  projectsDB.push(project);
  persistProjects();
  if (deckLib?.ensureDeckForProject) deckLib.ensureDeckForProject({ id: project.id, name, stack: "" });
  console.log(`[ad] project created — ${name} (${path})`);
  return reply.send({ ok: true, item: project });
});

app.post("/projects/:id/open", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const { id } = req.params as { id: string };
  const proj = projectsDB.find((p) => p.id === id);
  if (!proj) return reply.status(404).send({ ok: false, error: "project not found" });
  const token = req.cookies.ad_session;
  const sess = sessions.get(token!);
  if (sess?.pty) {
    sess.pty.write(`cd "${proj.path.replace(/"/g, '\\"')}"\r`);
  }
  if (deckLib?.ensureDeckForProject) {
    const d = deckLib.ensureDeckForProject(proj);
    if (d?.id) db.update(schema.decks).set({ lastOpened: new Date() }).where(eq(schema.decks.id, d.id)).run();
  }
  return reply.send({ ok: true, path: proj.path, name: proj.name });
});

app.delete("/projects/:id", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const { id } = req.params as { id: string };
  const idx = projectsDB.findIndex((p: Project) => p.id === id);
  if (idx === -1) return reply.status(404).send({ ok: false });
  projectsDB.splice(idx, 1);
  persistProjects();
  db.delete(schema.decks).where(eq(schema.decks.projectId, id)).run();
  return reply.send({ ok: true });
});

// ── FS browse ───────────────────────────────────────────────────────────────────
app.get("/fs/browse", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false, error: "unauthorized" });
  const query = req.query as { path?: string; hidden?: string };
  const pathResult = resolveBrowsePath(query.path);
  if (!pathResult.ok) return reply.status(pathResult.status).send({ ok: false, error: pathResult.error });
  const includeHidden = query.hidden === "1";
  const result = await browseDirectory(pathResult.path, includeHidden);
  if (!result.ok) {
    const isPermission = result.error === "Permiso denegado";
    return reply.status(isPermission ? 403 : 400).send(result);
  }
  console.log(`[ad] fs/browse — path=${result.path} entries=${result.stats.total}`);
  return reply.send(result);
});

// ── Command history ─────────────────────────────────────────────────────────────
db.run(sql`CREATE TABLE IF NOT EXISTS command_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL,
  kind TEXT NOT NULL, use_count INTEGER NOT NULL DEFAULT 1, last_used_at INTEGER NOT NULL,
  UNIQUE (user_id, text)
)`);
db.run(sql`CREATE INDEX IF NOT EXISTS command_history_user_last_used_idx ON command_history (user_id, last_used_at DESC)`);

const PATH_TOKEN_RE = /(?:^|\s)((?:[~/][\w./\- @]+|\.\/[\w./\-]+))(?=\s|$)/g;
function extractTokens(text: string): string[] {
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  PATH_TOKEN_RE.lastIndex = 0;
  while ((m = PATH_TOKEN_RE.exec(text)) !== null) {
    const t = m[1].trim();
    if (t.length >= 2) tokens.push(t);
  }
  return tokens;
}

function upsertHistoryEntry(userId: string, text: string, kind: "command" | "token"): void {
  const now = Date.now();
  db.run(sql`INSERT INTO command_history (user_id, text, kind, use_count, last_used_at)
    VALUES (${userId}, ${text}, ${kind}, 1, ${now})
    ON CONFLICT (user_id, text) DO UPDATE SET use_count = use_count + 1, last_used_at = ${now}`);
}

app.post("/api/history/record", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.status(401).send({ ok: false });
  const body = req.body as { text?: string } | undefined;
  const text = (body?.text ?? "").trim();
  if (!text) return reply.status(400).send({ ok: false, error: "text required" });
  upsertHistoryEntry(userId, text, "command");
  for (const token of extractTokens(text)) {
    if (token !== text) upsertHistoryEntry(userId, token, "token");
  }
  return reply.send({ ok: true });
});

app.get("/api/history/suggest", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.status(401).send({ ok: false });
  const query = req.query as { q?: string; limit?: string };
  const q = (query.q ?? "").trim();
  if (q.length < 2) return reply.send({ items: [] });
  const limit = Math.min(Number(query.limit ?? 8), 20);
  const rows = db.all(sql`
    SELECT text, kind, use_count FROM command_history
    WHERE user_id = ${userId} AND text LIKE ${q.replace(/[%_]/g, "\\$&") + "%"} ESCAPE '\\'
    ORDER BY use_count DESC, last_used_at DESC LIMIT ${limit}
  `) as Array<{ text: string; kind: string; use_count: number }>;
  return reply.send({ items: rows });
});

// ── Deck module — seed ──────────────────────────────────────────────────────────
deckLib.seedProfiles?.();

// ── Decks API ───────────────────────────────────────────────────────────────────
app.get("/api/decks", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const all = db.select().from(schema.decks).all() as any[];
  const items = all.map((deck: any) => {
    const proj = projectsDB.find((p) => String(p.id) === String(deck.projectId));
    if (proj && deckLib?.computeHealthForDeck) deckLib.computeHealthForDeck(deck, proj);
    return { ...deck, projectName: proj?.name ?? "?" };
  });
  return reply.send({ ok: true, items });
});

app.get("/api/decks/current", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const query = req.query as { projectId?: string };
  const proj = projectsDB.find((p) => String(p.id) === String(query.projectId));
  if (!proj) return reply.status(404).send({ ok: false, error: "project not found" });
  const deck = db.select().from(schema.decks).where(sql`decks.project_id = ${query.projectId}`).get() as any;
  if (!deck) return reply.status(404).send({ ok: false, error: "deck not found" });
  if (deckLib?.computeHealthForDeck) deckLib.computeHealthForDeck(deck, proj);
  return reply.send({ ok: true, deck: { ...deck, projectName: proj.name } });
});

app.put("/api/decks/:id", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const { id } = req.params as { id: string };
  const body = req.body as any;
  const allowed = ["goal", "stack", "urls", "rules", "memoryNotes", "memoryDecisions", "frequentCommands", "prompts", "deployProvider"];
  const updates: any = { updatedAt: new Date() };
  for (const k of allowed) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  db.update(schema.decks).set(updates).where(eq(schema.decks.id, id)).run();
  const deck = db.select().from(schema.decks).where(eq(schema.decks.id, id)).get() as any;
  const proj = projectsDB.find((p) => String(p.id) === String(deck?.projectId));
  if (deck && proj && deckLib?.exportDeckToMd) deckLib.exportDeckToMd(deck, proj.name);
  return reply.send({ ok: true, deck });
});

// ── Checkpoints API ─────────────────────────────────────────────────────────────
app.get("/api/decks/:id/checkpoints", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const { id } = req.params as { id: string };
  const items = db.select().from(schema.checkpoints).where(eq(schema.checkpoints.deckId, id)).orderBy(desc(schema.checkpoints.createdAt)).all();
  return reply.send({ ok: true, items });
});

app.post("/api/decks/:id/checkpoints", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const { id } = req.params as { id: string };
  const body = req.body as any;
  const cpId = randomUUID();
  const checkpoint = {
    id: cpId,
    deckId: id,
    narrative: body.narrative ?? "",
    reason: body.reason ?? "",
    stateBefore: body.stateBefore ?? "",
    stateAfter: body.stateAfter ?? "",
    commandsExecuted: body.commandsExecuted ? JSON.stringify(body.commandsExecuted) : "[]",
    filesModified: body.filesModified ? JSON.stringify(body.filesModified) : "[]",
    risks: body.risks ?? "",
    rollbackNotes: body.rollbackNotes ?? "",
    createdAt: new Date(),
  };
  db.insert(schema.checkpoints).values(checkpoint as any).run();
  db.update(schema.decks).set({ healthLastCheckpointId: cpId, updatedAt: new Date() }).where(eq(schema.decks.id, id)).run();
  try { if (deckLib?.exportCheckpointToMd) deckLib.exportCheckpointToMd(checkpoint); } catch { }
  return reply.send({ ok: true, item: checkpoint });
});

// ── Prompt Bridge ───────────────────────────────────────────────────────────────
app.get("/api/decks/:id/prompt", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const { id } = req.params as { id: string };
  const deck = db.select().from(schema.decks).where(eq(schema.decks.id, id)).get() as any;
  if (!deck) return reply.status(404).send({ ok: false, error: "deck not found" });
  const proj = projectsDB.find((p) => String(p.id) === String(deck.projectId));
  const prompt = [
    "# Contexto para IA",
    "",
    `Proyecto: ${proj?.name ?? "Desconocido"}`,
    `Objetivo: ${deck.goal || "No definido"}`,
    `Stack: ${deck.stack || "No detectado"}`,
    "",
    "## Estado actual",
    `- Score: ${deck.healthScore}/100`,
    deck.healthLastError ? `- Ultimo error: ${deck.healthLastError}` : "",
    deck.healthGitDirty ? "- Git: sucio" : "- Git: limpio",
    deck.healthLastBuildOk === true ? "- Build: OK" : deck.healthLastBuildOk === false ? "- Build: FALLIDO" : "- Build: no verificado",
    deck.healthLastCheckpointId ? `- Ultimo checkpoint: ${deck.healthLastCheckpointId}` : "",
    "",
    deck.goal ? `## Objetivo\n\n${deck.goal}` : "",
    deck.memoryNotes ? `## Notas\n\n${deck.memoryNotes}` : "",
    deck.rules && deck.rules !== "[]" ? `## Reglas\n\n${JSON.parse(deck.rules).map((r: string) => `- ${r}`).join("\n")}` : "",
    "",
    "---",
    "*Generado por AgentDeck — Centro de Mando Inteligente*",
  ].filter(Boolean).join("\n");
  return reply.send({ ok: true, prompt });
});

// ── Agent Profiles API ──────────────────────────────────────────────────────────
app.get("/api/profiles", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const items = db.select().from(schema.agentProfiles).all();
  return reply.send({ ok: true, items });
});

app.put("/api/profiles/active", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const body = req.body as { profileId?: string } | undefined;
  if (!body?.profileId) return reply.status(400).send({ ok: false, error: "profileId required" });
  const ws = deckLib?.resolveWorkspace?.() ?? "";
  if (ws) {
    const settingsDir = join(ws, "Settings");
    mkdirSync(settingsDir, { recursive: true });
    const settingsFile = join(settingsDir, "agentdeck.settings.json");
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsFile)) {
      try { settings = JSON.parse(readFileSync(settingsFile, "utf8")); } catch { }
    }
    settings.activeProfile = body.profileId;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2), "utf8");
  }
  return reply.send({ ok: true });
});

// ── Recipes API ─────────────────────────────────────────────────────────────────
app.get("/api/recipes", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const ws = deckLib?.resolveWorkspace?.() ?? "";
  let recipes: any[] = [];
  if (ws) {
    const recipesDir = join(ws, "Recipes");
    if (existsSync(recipesDir)) {
      const files = require("node:fs").readdirSync(recipesDir).filter((f: string) => f.endsWith(".recipe.json") || f.endsWith(".recipe.md"));
      for (const file of files) {
        try {
          const content = readFileSync(join(recipesDir, file), "utf8");
          const parsed = JSON.parse(content);
          recipes.push({ ...parsed, _file: file });
        } catch { /* skip invalid */ }
      }
    }
  }
  recipes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return reply.send({ ok: true, items: recipes });
});

app.post("/api/recipes", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const body = req.body as any;
  const name = (body.name ?? "").trim();
  if (!name) return reply.status(400).send({ ok: false, error: "name required" });
  const ws = deckLib?.resolveWorkspace?.() ?? "";
  if (!ws) return reply.status(500).send({ ok: false, error: "no workspace" });
  const recipesDir = join(ws, "Recipes");
  mkdirSync(recipesDir, { recursive: true });
  const recipe = {
    id: randomUUID(),
    name,
    description: body.description ?? "",
    tags: body.tags ?? [],
    riskLevel: body.riskLevel ?? "low",
    requiresConfirmation: body.requiresConfirmation ?? false,
    expectedResult: body.expectedResult ?? "",
    evidenceOutput: body.evidenceOutput ?? "",
    steps: body.steps ?? [{ name: "Ejecutar", command: "", check: "" }],
  };
  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
  writeFileSync(join(recipesDir, `${safeName}.recipe.json`), JSON.stringify(recipe, null, 2) + "\n", "utf8");
  return reply.send({ ok: true, item: recipe });
});

// ── Evidence Packs API ──────────────────────────────────────────────────────────
app.get("/api/evidence", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const items = db.select().from(schema.evidencePacks).orderBy(desc(schema.evidencePacks.timestamp)).all();
  return reply.send({ ok: true, items });
});

app.post("/api/evidence", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const body = req.body as any;
  const evId = randomUUID();
  db.insert(schema.evidencePacks).values({
    id: evId,
    checkpointId: body.checkpointId ?? null,
    summary: body.summary ?? "",
    commands: body.commands ? JSON.stringify(body.commands) : "[]",
    result: body.result ?? "",
    errors: body.errors ?? "",
    filesAffected: body.filesAffected ? JSON.stringify(body.filesAffected) : "[]",
    timestamp: new Date(),
  } as any).run();
  const item = db.select().from(schema.evidencePacks).where(eq(schema.evidencePacks.id, evId)).get();
  return reply.send({ ok: true, item });
});

// ── Guardrails / Mobile Safe Mode ───────────────────────────────────────────────
app.post("/api/guardrails/classify", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const body = req.body as { command?: string; mobile?: boolean } | undefined;
  const command = (body?.command ?? "").trim();
  if (!command) return reply.status(400).send({ ok: false, error: "command required" });
  const isMobile = body?.mobile === true;
  const lower = command.toLowerCase();

  const destructive = [
    "rm -rf", "rm -r -f", "rm --recursive --force", "rm -fr",
    "sudo ", "chmod 777", "chmod -r 777", "chmod 000",
    "git push --force", "git push -f", "git push origin +",
    "dd if=", "mkfs.", "fdisk", "format ", "shutdown", "reboot",
    "kill -9", "pkill -9",
  ];
  const medium = [
    "git push", "git merge", "git rebase", "git reset --hard",
    "git revert", "git cherry-pick", "drop table", "drop database",
    "delete from", "truncate", "npm publish", "npm unpublish",
    "docker rm", "docker rmi", "docker stop $(docker ps",
    "pnpm publish", "yarn publish",
  ];

  const level = destructive.some((d) => lower.includes(d)) ? "high"
    : medium.some((m) => lower.includes(m)) ? "medium"
    : "low";

  const needsConfirmation = level === "high" || (isMobile && level === "medium");
  const blocked = isMobile && level === "high";

  return reply.send({
    ok: true,
    level,
    needsConfirmation,
    blocked,
    reason: blocked ? "Comando bloqueado en modo móvil por seguridad." : undefined,
  });
});

// ── Today View API ──────────────────────────────────────────────────────────────
app.get("/api/today", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const allDecks = db.select().from(schema.decks).all() as any[];
  const activeProjects = allDecks
    .filter((d: any) => d.lastOpened)
    .sort((a: any, b: any) => {
      const ta = a.lastOpened instanceof Date ? a.lastOpened.getTime() : Number(a.lastOpened) || 0;
      const tb = b.lastOpened instanceof Date ? b.lastOpened.getTime() : Number(b.lastOpened) || 0;
      return tb - ta;
    })
    .slice(0, 5);
  const projectsWithErrors = allDecks.filter((d: any) => d.healthLastError != null || (typeof d.healthScore === "number" && d.healthScore < 40));
  const recentCheckpoints = db.select().from(schema.checkpoints).orderBy(desc(schema.checkpoints.createdAt)).limit(10).all();

  const ws = deckLib?.resolveWorkspace?.() ?? "";
  let activeProfileId = "devops";
  if (ws) {
    const settingsFile = join(ws, "Settings", "agentdeck.settings.json");
    if (existsSync(settingsFile)) {
      try {
        const s = JSON.parse(readFileSync(settingsFile, "utf8"));
        if (s.activeProfile) activeProfileId = s.activeProfile;
      } catch { }
    }
  }
  const activeProfile = db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, activeProfileId)).get() as any;
  const suggestedActions = activeProfile?.suggestedRecipes
    ? JSON.parse(activeProfile.suggestedRecipes)
    : ["Crear checkpoint", "Revisar estado", "Abrir terminal"];

  return reply.send({ ok: true, activeProjects, projectsWithErrors, recentCheckpoints, suggestedActions });
});

// ── Upload API ──────────────────────────────────────────────────────────────────
const UPLOADS_DIR = join(os.homedir(), ".agentdeck", "uploads");
mkdirSync(UPLOADS_DIR, { recursive: true });

app.post("/api/upload", async (req, reply) => {
  if (!isAuthenticated(req)) return reply.status(401).send({ ok: false });
  const data = await req.file();
  if (!data) return reply.status(400).send({ ok: false, error: "no file" });
  const ext = extname(data.filename);
  const filename = `${randomUUID()}${ext}`;
  const filePath = join(UPLOADS_DIR, filename);
  const { pipeline } = await import("node:stream/promises");
  const writeStream = require("node:fs").createWriteStream(filePath);
  try {
    await pipeline(data.file, writeStream);
  } catch (err) {
    try { writeStream.destroy(); require("node:fs").unlinkSync(filePath); } catch { }
    return reply.status(500).send({ ok: false, error: "upload failed" });
  }
  return reply.send({ ok: true, filename, originalName: data.filename, size: 0 });
});

// ── mDNS responder ──────────────────────────────────────────────────────────────
const mdns = ALLOW_LAN ? mdnsFactory() : null;
mdns?.on("query", (query: any) => {
  for (const q of query.questions) {
    if (q.name?.toLowerCase() === MDNS_HOSTNAME && (q.type === "A" || q.type === "AAAA")) {
      const ip = getLanIp();
      if (!ip) continue;
      mdns.respond({
        answers: [{ name: MDNS_HOSTNAME, type: "A", ttl: 60, data: ip }],
      });
    }
  }
});

function shutdown(signal: string) {
  console.log(`[ad] ${signal} — shutting down`);
  try { mdns?.destroy(); } catch { }
  app.close().finally(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await app.listen({ host: HOST, port: PORT });

const lanIp = getLanIp();
console.log("[ad] ─────────────────────────────────────────────");
console.log(`[ad] Local:  http://127.0.0.1:${PORT}`);
if (ALLOW_LAN && lanIp) {
  console.log(`[ad] LAN:    http://${lanIp}:${PORT}`);
  console.log(`[ad] mDNS:   http://${MDNS_HOSTNAME}:${PORT}`);
  console.log("[ad] WARN:   LAN access enabled via AGENTDECK_ALLOW_LAN=true");
} else {
  console.log("[ad] LAN:    disabled by default");
}
console.log(`[ad] Pass:   ${maskPassphrase(PASSPHRASE)}`);
if (AGENTDECK_AUTH_TOKEN) {
  console.log(`[ad] Token:  ${AGENTDECK_AUTH_TOKEN.slice(0, 4)}••••${AGENTDECK_AUTH_TOKEN.slice(-4)}`);
}
console.log("[ad] ─────────────────────────────────────────────");