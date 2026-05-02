import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const AGENTDECK_HOME = join(homedir(), ".agentdeck");
const ICON = "├";
const ICON_END = "└";
const ICON_SUB = "│";
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

let errors = [];
let warnings = [];
let fixes = [];

function pass(msg, detail = "") {
  console.log(`  ${GREEN("✓")} ${msg}${detail ? ` ${YELLOW("(" + detail + ")")}` : ""}`);
}
function fail(msg, fix) {
  console.log(`  ${RED("✗")} ${msg}`);
  errors.push(msg);
  if (fix) fixes.push(fix);
}
function warn_(msg) {
  console.log(`  ${YELLOW("⚠")} ${msg}`);
  warnings.push(msg);
}

async function main() {
  const args = process.argv.slice(2);
  const fixMode = args.includes("--fix") || args.includes("-f");

  console.log(`\n ${BOLD("AgentDeck Doctor")}${fixMode ? " " + YELLOW("(--fix)") : ""}\n`);

  const cwd = process.cwd();

  // 1) Node version
  const nodeVersion = process.version.slice(1);
  const major = Number(nodeVersion.split(".")[0]);
  if (major >= 22) {
    pass("Node.js", nodeVersion);
  } else {
    fail(`Node.js ${nodeVersion} (se requiere >= 22)`, "Instalá Node 22+: https://nodejs.org");
  }

  // 2) package manager
  const hasNpmLock = existsSync(join(cwd, "package-lock.json"));
  const hasPnpmLock = existsSync(join(cwd, "pnpm-lock.yaml"));
  const hasYarnLock = existsSync(join(cwd, "yarn.lock"));
  if (hasNpmLock) pass("Package manager", "npm (package-lock.json detectado)");
  else if (hasPnpmLock) pass("Package manager", "pnpm (pnpm-lock.yaml detectado)");
  else if (hasYarnLock) pass("Package manager", "yarn (yarn.lock detectado)");
  else warn_("No se detectó lockfile");

  // 3) dependencies
  const hasNM = existsSync(join(cwd, "node_modules"));
  if (hasNM) pass("node_modules existe");
  else {
    warn_("node_modules no encontrado");
    if (fixMode) {
      console.log(`  ${ICON} Ejecutando npm install...`);
      execSync("npm install", { cwd, stdio: "inherit" });
      pass("node_modules instalado");
    } else {
      fixes.push("Ejecutá: npm install");
    }
  }

  // 4) .env.local
  const envPath = join(cwd, ".env.local");
  const envExample = join(cwd, ".env.example");
  if (existsSync(envPath)) {
    pass(".env.local existe");
  } else if (existsSync(envExample)) {
    warn_(".env.local no encontrado (existe .env.example)");
    if (fixMode) {
      writeFileSync(envPath, readFileSync(envExample, "utf8"), "utf8");
      pass(".env.local creado desde .env.example");
    } else {
      fixes.push("Ejecutá: cp .env.example .env.local");
    }
  } else {
    warn_(".env.local no encontrado");
  }

  // 5) AGENTDECK_HOME
  mkdirSync(AGENTDECK_HOME, { recursive: true });
  if (existsSync(AGENTDECK_HOME)) pass("~/.agentdeck (AgentDeck Home)");
  else fail("~/.agentdeck no se pudo crear", "Verificá permisos de escritura en ~/");

  // 6) AGENTDECK_WORKSPACE
  let workspacePath = null;
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("AGENTDECK_WORKSPACE=")) {
        workspacePath = t.split("=").slice(1).join("=").replace(/^["']|["']$/g, "");
      }
    }
  }

  const icloudPath = join(
    homedir(),
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs",
    "AgentDeck"
  );
  const icloudExists = platform() === "darwin" && existsSync(
    join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs")
  );

  if (workspacePath) {
    mkdirSync(workspacePath, { recursive: true });
    pass(`Workspace: ${workspacePath}`);
  } else if (icloudExists) {
    warn_("AGENTDECK_WORKSPACE no configurado en .env.local");
    if (fixMode) {
      const suggested = icloudPath;
      mkdirSync(suggested, { recursive: true });
      const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
      const lines = envContent.split(/\r?\n/).filter((l) => !l.trim().startsWith("AGENTDECK_WORKSPACE="));
      lines.push(`AGENTDECK_WORKSPACE="${suggested}"`);
      lines.push("");
      writeFileSync(envPath, lines.join("\n"), "utf8");
      pass(`Workspace configurado: ${suggested}`);
      workspacePath = suggested;
    } else {
      fixes.push("Ejecutá: npm run setup --fix");
    }
  } else {
    const fallback = join(AGENTDECK_HOME, "workspace");
    warn_("AGENTDECK_WORKSPACE no configurado (no hay iCloud)");
    if (fixMode) {
      mkdirSync(fallback, { recursive: true });
      const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
      const lines = envContent.split(/\r?\n/).filter((l) => !l.trim().startsWith("AGENTDECK_WORKSPACE="));
      lines.push(`AGENTDECK_WORKSPACE="${fallback}"`);
      lines.push("");
      writeFileSync(envPath, lines.join("\n"), "utf8");
      pass(`Workspace configurado: ${fallback}`);
      workspacePath = fallback;
    } else {
      fixes.push("Ejecutá: npm run setup --fix");
    }
  }

  // 7) Workspace dirs
  if (workspacePath) {
    const dirs = ["Decks", "Recipes", "Prompts", "Checkpoints", "Settings", "Exports"];
    let ok = true;
    for (const d of dirs) {
      const p = join(workspacePath, d);
      mkdirSync(p, { recursive: true });
      if (!existsSync(p)) {
        fail(`Workspace/${d} no se pudo crear`);
        ok = false;
      }
    }
    if (ok) pass("Estructura del workspace completa");

    // iCloud warning
    if (platform() === "darwin" && workspacePath.includes("Mobile Documents")) {
      warn_("Workspace en iCloud: no guardar node_modules, dist, .next ni logs pesados acá");
    }
  }

  // 8) Port check
  const net = await import("node:net");
  const port = 8787;
  await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        warn_(`Puerto ${port} en uso`);
      }
      server.close(resolve);
    });
    server.once("listening", () => {
      server.close(resolve);
    });
    server.listen(port, "127.0.0.1");
  });
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    const hostLine = raw.split(/\r?\n/).find((l) => l.trim().startsWith("HOST="));
    const hostVal = hostLine ? hostLine.split("=").slice(1).join("=").trim() : "";
    if (hostVal === "0.0.0.0") {
      const allowLine = raw.split(/\r?\n/).find((l) => l.trim().startsWith("AGENTDECK_ALLOW_LAN="));
      if (!allowLine || allowLine.includes("false")) {
        warn_("HOST=0.0.0.0 sin AGENTDECK_ALLOW_LAN=true — la app se va a bindear a 127.0.0.1 de todas formas");
      }
    }
  }

  // 9) Providers dir
  mkdirSync(join(AGENTDECK_HOME, "providers"), { recursive: true });

  // summary
  console.log("");
  if (errors.length === 0 && warnings.length === 0) {
    console.log(` ${GREEN("✅ Todo en orden")}`);
    process.exit(0);
  } else {
    if (errors.length > 0) {
      console.log(` ${RED("✗")} ${errors.length} error(es):`);
      errors.forEach((e) => console.log(`   • ${e}`));
    }
    if (warnings.length > 0) {
      console.log(` ${YELLOW("⚠")} ${warnings.length} advertencia(s):`);
      warnings.forEach((w) => console.log(`   • ${w}`));
    }
    if (fixes.length > 0) {
      console.log(`\n ${BOLD("Sugerencias:")}`);
      fixes.forEach((f) => console.log(`   ${f}`));
    }
    process.exit(errors.length > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`${RED("✗")} Error inesperado:`, err.message);
  process.exit(1);
});
