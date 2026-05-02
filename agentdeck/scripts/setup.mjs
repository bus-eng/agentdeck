import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const AGENTDECK_HOME = join(homedir(), ".agentdeck");
const MIN_NODE = 22;
const DEFAULT_PORT = 8787;

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const CYAN = (s) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function ok(msg) { console.log(` ${GREEN("✓")} ${msg}`); }
function warn(msg) { console.log(` ${YELLOW("⚠")} ${msg}`); }
function err(msg) { console.log(` ${RED("✗")} ${msg}`); process.exit(1); }

async function main() {
  console.log(`\n ${BOLD("AgentDeck Setup")}\n`);
  const cwd = process.cwd();

  // 1) Node
  const major = Number(process.version.slice(1).split(".")[0]);
  if (major < MIN_NODE) err(`Node.js ${process.version} (${MIN_NODE}+ required)`);
  ok(`Node.js ${process.version}`);

  // 2) Install deps
  if (!existsSync(join(cwd, "node_modules"))) {
    console.log(`  ${BOLD("npm install")}...`);
    execSync("npm install", { cwd, stdio: "inherit" });
    ok("Dependencias instaladas");
  } else {
    ok("node_modules ya existe");
  }

  // 3) .env.local
  const envPath = join(cwd, ".env.local");
  const envExample = join(cwd, ".env.example");
  if (!existsSync(envPath) && existsSync(envExample)) {
    writeFileSync(envPath, readFileSync(envExample, "utf8"), "utf8");
    ok(".env.local creado desde .env.example");
  } else {
    ok(".env.local ya existe");
  }

  // 4) Securize: if HOST=0.0.0.0 without AGENTDECK_ALLOW_LAN=true, fix
  let envContent = readFileSync(envPath, "utf8");
  if (envContent.includes("HOST=0.0.0.0") && !envContent.includes("AGENTDECK_ALLOW_LAN=true")) {
    envContent += '\n# AgentDeck Setup: LAN access requires explicit opt-in\nAGENTDECK_ALLOW_LAN=false\n';
    writeFileSync(envPath, envContent, "utf8");
    ok("HOST=127.0.0.1 por defecto (LAN requiere AGENTDECK_ALLOW_LAN=true)");
  }

  // 5) Generate AGENTDECK_AUTH_TOKEN if not set
  if (!envContent.includes("AGENTDECK_AUTH_TOKEN=")) {
    const token = randomBytes(32).toString("hex");
    envContent += `\n# Token interno AgentDeck (generado por setup)\nAGENTDECK_AUTH_TOKEN=${token}\n`;
    writeFileSync(envPath, envContent, "utf8");
    ok("Token de autenticación generado");
  }

  // 6) AGENTDECK_HOME dirs
  mkdirSync(AGENTDECK_HOME, { recursive: true });
  mkdirSync(join(AGENTDECK_HOME, "providers"), { recursive: true });
  mkdirSync(join(AGENTDECK_HOME, "uploads"), { recursive: true });
  mkdirSync(join(AGENTDECK_HOME, "data"), { recursive: true });
  ok("~/.agentdeck creado (Home, providers, uploads, data)");

  // 7) Workspace
  const icloudDocs = join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
  const icloudAvailable = platform() === "darwin" && existsSync(icloudDocs);
  const icloudWs = join(icloudDocs, "AgentDeck");
  const fallbackWs = join(AGENTDECK_HOME, "workspace");

  let workspacePath = null;
  if (envContent.includes("AGENTDECK_WORKSPACE=")) {
    const m = envContent.match(/AGENTDECK_WORKSPACE="?([^\n"]+)"?/);
    workspacePath = m ? m[1].trim() : null;
  }

  if (workspacePath) {
    mkdirSync(workspacePath, { recursive: true });
    ok(`Workspace: ${workspacePath}`);
  } else {
    workspacePath = icloudAvailable ? icloudWs : fallbackWs;
    mkdirSync(workspacePath, { recursive: true });
    envContent += `\n# AgentDeck Workspace (sincronizable)\nAGENTDECK_WORKSPACE="${workspacePath}"\n`;
    writeFileSync(envPath, envContent, "utf8");
    if (icloudAvailable) warn(`Workspace en iCloud: ${workspacePath}\n   └─ no guardes node_modules/dist aquí`);
    else ok(`Workspace: ${workspacePath}`);
  }

  // 8) Workspace subdirs
  for (const d of ["Decks", "Recipes", "Prompts", "Checkpoints", "Settings", "Exports"]) {
    mkdirSync(join(workspacePath, d), { recursive: true });
  }
  ok("Estructura del workspace completa");

  // 9) Seed examples
  const seedFiles = [
    {
      path: join(workspacePath, "Decks", "example.deck.json"),
      content: JSON.stringify({
        id: "example",
        name: "Mi Proyecto Ejemplo",
        path: "",
        goal: "Explorar las capacidades de AgentDeck",
        stack: "node",
        urls: { local: "http://127.0.0.1:8787" },
        rules: ["No exponer claves en el repositorio"],
        recipes: [],
        lastOpened: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, null, 2) + "\n",
    },
    {
      path: join(workspacePath, "Recipes", "example.recipe.json"),
      content: JSON.stringify({
        id: "example",
        name: "Setup inicial",
        steps: ["git pull", "npm install", "pnpm rebuild @lydell/node-pty"],
        tags: ["setup"],
      }, null, 2) + "\n",
    },
    {
      path: join(workspacePath, "Prompts", "claude-context.template.md"),
      content: [
        "# Contexto para Claude",
        "",
        "Proyecto: **{{project_name}}**",
        "Stack: {{project_stack}}",
        "Objetivo: {{project_goal}}",
        "",
        "---",
        "*Generado por AgentDeck — Centro de Mando Inteligente*",
      ].join("\n") + "\n",
    },
    {
      path: join(workspacePath, "Settings", "agentdeck.settings.json"),
      content: JSON.stringify({
        theme: "light",
        terminalFontSize: 13,
        mobileFontSize: 14,
        shortcuts: { dev: "pnpm dev", test: "pnpm test" },
      }, null, 2) + "\n",
    },
  ];
  for (const f of seedFiles) {
    if (!existsSync(f.path)) {
      const parent = f.path.substring(0, f.path.lastIndexOf("/"));
      mkdirSync(parent, { recursive: true });
      writeFileSync(f.path, f.content, "utf8");
      ok(f.path.replace(workspacePath + "/", "Workspace/") + " creado");
    }
  }

  // 10) Rebuild node-pty if needed
  try {
    execSync("node -e \"require('@lydell/node-pty')\"", { cwd, stdio: "pipe" });
    ok("@lydell/node-pty funciona");
  } catch {
    warn("@lydell/node-pty necesita rebuild");
    console.log(`  ${BOLD("npm run rebuild")}...`);
    execSync("npm run rebuild", { cwd, stdio: "inherit" });
    ok("@lydell/node-pty compilado");
  }

  // summary
  console.log(`\n ${GREEN("═══════════════════════════════")}`);
  console.log(` ${GREEN("✅ AgentDeck listo")}`);
  console.log(` ${GREEN("═══════════════════════════════")}`);
  console.log(`\n   ${CYAN("http://127.0.0.1:8787")}`);
  console.log(`   ${CYAN("http://agentdeck.local:8787")}  (con mDNS en LAN)\n`);
  console.log(`   npm run start   → iniciar servidor`);
  console.log(`   npm run doctor  → diagnosticar`);
  console.log(`   npm run update  → actualizar`);
  console.log(`   npm run reset-local → reparar configuración\n`);
}

main().catch((e) => { console.error(` ${RED("✗")} ${e.message}`); process.exit(1); });
