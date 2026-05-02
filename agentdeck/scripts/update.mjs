import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function ok(msg) { console.log(` ${GREEN("✓")} ${msg}`); }
function warn(msg) { console.log(` ${YELLOW("⚠")} ${msg}`); }
function err(msg) { console.error(` ${RED("✗")} ${msg}`); }

async function main() {
  console.log(`\n ${BOLD("AgentDeck Update")}\n`);

  // 1) Check git status
  let statusRaw;
  try {
    statusRaw = execSync("git status --porcelain", { cwd, encoding: "utf8" });
  } catch {
    err("No es un repositorio git. Hacé git clone primero.");
    process.exit(1);
  }

  const hasChanges = statusRaw.trim().length > 0;
  if (hasChanges) {
    warn("Hay cambios locales sin commit:");
    console.log(statusRaw.split("\n").map((l) => `      ${l}`).join("\n"));
    warn("git pull puede fallar si hay conflictos. Hacé commit o stash primero.");
  }

  // 2) Track lockfile changes
  const oldLock = existsSync(join(cwd, "package-lock.json"))
    ? readFileSync(join(cwd, "package-lock.json"), "utf8")
    : null;

  // 3) git pull
  console.log(`  ${BOLD("git pull")}...`);
  execSync("git pull", { cwd, stdio: "inherit" });
  ok("Repositorio actualizado");

  // 4) Reinstall if lock changed
  const newLock = existsSync(join(cwd, "package-lock.json"))
    ? readFileSync(join(cwd, "package-lock.json"), "utf8")
    : null;
  const depsChanged = oldLock !== newLock;

  if (depsChanged || hasChanges) {
    console.log(`  ${BOLD("npm install")}...`);
    execSync("npm install", { cwd, stdio: "inherit" });
    ok("Dependencias actualizadas");
  } else {
    ok("Dependencias no cambiaron — saltando npm install");
  }

  // 5) Rebuild node-pty proxy check
  try {
    execSync("node -e \"require('@lydell/node-pty')\"", { cwd, stdio: "pipe" });
  } catch {
    warn("@lydell/node-pty necesita rebuild. Ejecutá: npm run rebuild");
  }

  // 6) Run doctor
  console.log(`\n${BOLD("Post-update check")}`);
  execSync("node scripts/doctor.mjs", { cwd, stdio: "inherit" });
}

main().catch((e) => { err(e.message); process.exit(1); });
