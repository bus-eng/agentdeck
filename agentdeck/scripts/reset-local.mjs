import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const cwd = process.cwd();
const AGENTDECK_HOME = join(homedir(), ".agentdeck");

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function ok(msg) { console.log(` ${GREEN("✓")} ${msg}`); }
function warn(msg) { console.log(` ${YELLOW("⚠")} ${msg}`); }
function err(msg) { console.error(` ${RED("✗")} ${msg}`); }

async function main() {
  const args = process.argv.slice(2);
  const dangerous = args.includes("--all");

  console.log(`\n ${BOLD("AgentDeck Reset Local")}\n`);

  if (!dangerous) {
    warn("Modo seguro: solo repara archivos de configuración sin borrar datos.");

    // Regenerar .env.local desde .env.example si falta
    const envPath = join(cwd, ".env.local");
    const envExample = join(cwd, ".env.example");
    if (existsSync(envPath)) {
      ok(".env.local ya existe — no se modifica");
    } else if (existsSync(envExample)) {
      const content = readFileSync(envExample, "utf8");
      writeFileSync(envPath, content, "utf8");

      // Añadir token si no existe
      if (!content.includes("AGENTDECK_AUTH_TOKEN=")) {
        const token = randomBytes(32).toString("hex");
        writeFileSync(envPath, `\n# Token interno (regenerado)\nAGENTDECK_AUTH_TOKEN=${token}\n`, { flag: "a" });
      }
      ok(".env.local regenerado");
    } else {
      err("No existe .env.example. No se puede regenerar .env.local");
    }

    // Home dirs
    mkdirSync(AGENTDECK_HOME, { recursive: true });
    mkdirSync(join(AGENTDECK_HOME, "providers"), { recursive: true });
    mkdirSync(join(AGENTDECK_HOME, "uploads"), { recursive: true });
    mkdirSync(join(AGENTDECK_HOME, "data"), { recursive: true });
    ok("~/.agentdeck estructura reparada");

    console.log(`\n Para borrar toda la configuración local (providers, uploads, data):`);
    console.log(`   npm run reset-local -- --all\n`);

  } else {
    console.log(` ${YELLOW("⚠  Modo destructivo — --all activo")}\n`);
    console.log(` Se va a limpiar ~/.agentdeck/ (sin confirmación adicional)`);
    console.log(` Dejando solo los directorios vacíos.\n`);

    // Clean Home dirs (remove children but not the dirs themselves)
    const cleanDirs = ["providers", "uploads", "data"];
    for (const d of cleanDirs) {
      const p = join(AGENTDECK_HOME, d);
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        mkdirSync(p, { recursive: true });
        ok(`~/.agentdeck/${d} limpiado`);
      }
    }

    // Remove .env.local
    const envPath = join(cwd, ".env.local");
    if (existsSync(envPath)) {
      const envExample = join(cwd, ".env.example");
      if (existsSync(envExample)) {
        writeFileSync(envPath, readFileSync(envExample, "utf8"), "utf8");
      } else {
        rmSync(envPath, { force: true });
      }
      ok(".env.local regenerado desde .env.example");
    }

    console.log(`\n ${YELLOW("Configuración local limpiada.")}`);
    console.log(` Ejecutá: npm run setup\n`);
  }

  // Run doctor after reset
  console.log(`\n${BOLD("Post-reset check")}`);
  execSync("node scripts/doctor.mjs", { cwd, stdio: "inherit" });
}

main().catch((e) => { err(e.message); process.exit(1); });
