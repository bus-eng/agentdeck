import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AGENTDECK_HOME, detectSuggestedWorkspace } from "./constants.mjs";
import { ok, warn, err } from "./logger.mjs";

export const WORKSPACE_DIRS = ["Decks", "Recipes", "Prompts", "Checkpoints", "Settings", "Exports"];

export function resolveWorkspacePath(customPath) {
  if (customPath) return customPath;
  return detectSuggestedWorkspace();
}

export function readWorkspacePath() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return null;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("AGENTDECK_WORKSPACE=")) {
      return trimmed.slice("AGENTDECK_WORKSPACE=".length).replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}

export function icloudAvailable() {
  if (process.platform !== "darwin") return false;
  const icloud = join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
  return existsSync(icloud);
}

export function ensureWorkspace(workspacePath) {
  mkdirSync(workspacePath, { recursive: true });
  for (const dir of WORKSPACE_DIRS) {
    mkdirSync(join(workspacePath, dir), { recursive: true });
  }
}

export function writeWorkspaceEnv(workspacePath) {
  const envPath = join(process.cwd(), ".env.local");
  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf8");
  }
  const lines = content.split(/\r?\n/).filter((l) => !l.trim().startsWith("AGENTDECK_WORKSPACE="));
  lines.push(`AGENTDECK_WORKSPACE="${workspacePath}"`);
  lines.push("");
  writeFileSync(envPath, lines.join("\n"), "utf8");
  ok(`Workspace guardado en .env.local: ${workspacePath}`);
}

export function seedExampleFiles(workspacePath) {
  const deck = {
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
  };
  const deckPath = join(workspacePath, "Decks", "example.deck.json");
  if (!existsSync(deckPath)) {
    writeFileSync(deckPath, JSON.stringify(deck, null, 2) + "\n", "utf8");
    ok("Decks/example.deck.json creado");
  }

  const recipe = {
    id: "example",
    name: "Setup inicial",
    description: "Instalar dependencias y preparar el entorno",
    steps: ["git pull", "npm install", "pnpm rebuild @lydell/node-pty"],
    tags: ["setup"],
  };
  const recipePath = join(workspacePath, "Recipes", "example.recipe.json");
  if (!existsSync(recipePath)) {
    writeFileSync(recipePath, JSON.stringify(recipe, null, 2) + "\n", "utf8");
    ok("Recipes/example.recipe.json creado");
  }

  const promptPath = join(workspacePath, "Prompts", "claude-context.template.md");
  if (!existsSync(promptPath)) {
    writeFileSync(
      promptPath,
      [
        "# Contexto para Claude",
        "",
        "Estoy trabajando en el proyecto **{{project_name}}**.",
        "",
        "## Stack",
        "{{project_stack}}",
        "",
        "## Objetivo actual",
        "{{project_goal}}",
        "",
        "## Estado",
        "{{project_status}}",
        "",
        "## Próximo paso",
        "{{next_step}}",
        "",
        "---",
        "*Generado por AgentDeck — Centro de Mando Inteligente*",
      ].join("\n"),
      "utf8"
    );
    ok("Prompts/claude-context.template.md creado");
  }

  const settingsPath = join(workspacePath, "Settings", "agentdeck.settings.json");
  if (!existsSync(settingsPath)) {
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          theme: "light",
          defaultProvider: "",
          defaultModel: "",
          terminalFontSize: 13,
          mobileFontSize: 14,
          shortcuts: { dev: "pnpm dev", test: "pnpm test", build: "pnpm build" },
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    ok("Settings/agentdeck.settings.json creado");
  }
}
