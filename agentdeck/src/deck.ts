import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { sql, eq, desc } from "drizzle-orm";
import { db, schema } from "./db/index.js";

const WORKSPACE_DIRS = ["Decks", "Recipes", "Prompts", "Checkpoints", "Settings", "Exports"];
const _cache = { ws: "" };

export function resolveWorkspace(): string {
  if (_cache.ws) return _cache.ws;
  const envFile = join(process.cwd(), ".env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("AGENTDECK_WORKSPACE=")) {
        _cache.ws = t.slice("AGENTDECK_WORKSPACE=".length).replace(/^["']|["']$/g, "");
        return _cache.ws;
      }
    }
  }
  if (process.platform === "darwin") {
    const icloud = join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs", "AgentDeck");
    if (existsSync(join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs"))) {
      _cache.ws = icloud;
      return icloud;
    }
  }
  _cache.ws = join(homedir(), ".agentdeck", "workspace");
  return _cache.ws;
}

export function ensureWorkspaceDirs(workspacePath: string): void {
  mkdirSync(workspacePath, { recursive: true });
  for (const d of WORKSPACE_DIRS) mkdirSync(join(workspacePath, d), { recursive: true });
}

export function exportDeckToMd(deck: any, projectName: string): string {
  const ws = resolveWorkspace();
  ensureWorkspaceDirs(ws);
  const md = [
    "---",
    `id: ${deck.id}`,
    `project: ${projectName}`,
    `goal: ${deck.goal || ""}`,
    `stack: ${deck.stack || ""}`,
    `health_score: ${deck.healthScore ?? 0}`,
    `created_at: ${deck.createdAt ? new Date(deck.createdAt).toISOString() : ""}`,
    `updated_at: ${deck.updatedAt ? new Date(deck.updatedAt).toISOString() : ""}`,
    "---", "",
    `# ${projectName}`, "",
    deck.goal ? `**Objetivo:** ${deck.goal}` : "", "",
    "## Salud del proyecto", "",
    `- **Score:** ${deck.healthScore ?? 0}/100`,
    `- **Git dirty:** ${deck.healthGitDirty ? "sí" : "no"}`,
    `- **Dev server:** ${deck.healthHasDevServer ? "activo" : "inactivo"}`,
    deck.healthLastError ? `- **Último error:** ${deck.healthLastError}` : "", "",
    deck.memoryNotes ? `## Notas\n\n${deck.memoryNotes}\n` : "",
    "", "---",
    `*Actualizado: ${new Date(deck.updatedAt).toLocaleString("es-AR")}*`,
    `*Generado por AgentDeck*`,
  ].filter(Boolean).join("\n");

  const safeName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const filePath = join(ws, "Decks", `${safeName}.deck.md`);
  writeFileSync(filePath, md, "utf8");
  return filePath;
}

export function exportCheckpointToMd(cp: any): string {
  const ws = resolveWorkspace();
  ensureWorkspaceDirs(ws);
  const md = [
    "---",
    `id: ${cp.id}`,
    `deck_id: ${cp.deckId}`,
    `created_at: ${new Date(cp.createdAt).toISOString()}`,
    "---", "",
    `# Checkpoint: ${cp.narrative}`, "",
    cp.reason ? `**Motivo:** ${cp.reason}` : "", "",
    cp.stateBefore ? `## Estado antes\n\n${cp.stateBefore}` : "",
    cp.stateAfter ? `## Estado después\n\n${cp.stateAfter}` : "", "",
    cp.commandsExecuted ? `## Comandos ejecutados\n\n${JSON.parse(cp.commandsExecuted).map((c: string) => `- \`${c}\``).join("\n")}` : "",
    cp.filesModified ? `\n## Archivos modificados\n\n${JSON.parse(cp.filesModified).map((f: string) => `- \`${f}\``).join("\n")}` : "", "",
    cp.risks ? `## Riesgos\n\n${cp.risks}` : "",
    cp.rollbackNotes ? `## Rollback\n\n${cp.rollbackNotes}` : "", "",
    "---",
    `*Generado por AgentDeck*`,
  ].filter(Boolean).join("\n");

  const filePath = join(ws, "Checkpoints", `${cp.id}.cp.md`);
  writeFileSync(filePath, md, "utf8");
  return filePath;
}

export function ensureTables(): void {
  const sqlite = (db as any).session?.client as any;
  if (!sqlite) return;
  sqlite.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, stack TEXT, preferred_agent TEXT, notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE,
    goal TEXT, stack TEXT, urls TEXT, rules TEXT, memory_notes TEXT, memory_decisions TEXT,
    frequent_commands TEXT, prompts TEXT, deploy_provider TEXT,
    health_score INTEGER NOT NULL DEFAULT 0, health_git_branch TEXT, health_git_dirty INTEGER NOT NULL DEFAULT 1,
    health_has_dev_server INTEGER NOT NULL DEFAULT 0, health_last_build_ok INTEGER, health_last_build_time INTEGER,
    health_last_error TEXT, health_last_checkpoint_id TEXT, health_checked_at INTEGER,
    last_opened INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    narrative TEXT NOT NULL, reason TEXT, state_before TEXT, state_after TEXT,
    commands_executed TEXT, files_modified TEXT, risks TEXT, rollback_notes TEXT, evidence_id TEXT,
    created_at INTEGER NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS evidence_packs (
    id TEXT PRIMARY KEY, checkpoint_id TEXT REFERENCES checkpoints(id) ON DELETE SET NULL,
    summary TEXT NOT NULL, commands TEXT, result TEXT, errors TEXT, files_affected TEXT,
    timestamp INTEGER NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, focus TEXT NOT NULL,
    allowed_risk_levels TEXT, suggested_recipes TEXT, ui_hints TEXT, created_at INTEGER NOT NULL
  )`);
}

export function seedProfiles(): void {
  ensureTables();
  const profiles = [
    { id: "devops", name: "DevOps Local", focus: "Entorno, build, deploy y estado del sistema", allowedRiskLevels: JSON.stringify(["low","medium"]), suggestedRecipes: JSON.stringify(["Diagnosticar build","Levantar entorno local","Preparar deploy"]), uiHints: JSON.stringify({ showTerminal: true, showHealth: true, showDeploy: true }) },
    { id: "ui-designer", name: "UI Designer", focus: "Preview visual, assets, prototipado y CSS", allowedRiskLevels: JSON.stringify(["low"]), suggestedRecipes: JSON.stringify(["Publicar artículo","Revisar SEO"]), uiHints: JSON.stringify({ showTerminal: false, showHealth: true, showDeploy: false }) },
    { id: "seo-editor", name: "SEO Editor", focus: "Contenido, metadata, estructura y rendimiento web", allowedRiskLevels: JSON.stringify(["low"]), suggestedRecipes: JSON.stringify(["Revisar SEO","Publicar artículo"]), uiHints: JSON.stringify({ showTerminal: false, showHealth: true, showPreview: true }) },
    { id: "qa-tester", name: "QA Tester", focus: "Pruebas, reportes, regresión y cobertura", allowedRiskLevels: JSON.stringify(["low"]), suggestedRecipes: JSON.stringify(["Diagnosticar build","Crear checkpoint"]), uiHints: JSON.stringify({ showTerminal: true, showHealth: true, showLogs: true }) },
    { id: "docs-writer", name: "Docs Writer", focus: "Documentación, changelog y notas técnicas", allowedRiskLevels: JSON.stringify(["low"]), suggestedRecipes: JSON.stringify(["Crear checkpoint"]), uiHints: JSON.stringify({ showTerminal: false, showHealth: false, showCheckpoints: true }) },
  ];

  for (const p of profiles) {
    const existing = db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, p.id)).get();
    if (!existing) db.insert(schema.agentProfiles).values(p).run();
  }
}

export function ensureDeckForProject(project: { id: string; name: string; stack?: string }): any {
  let deck = db.select().from(schema.decks).where(sql`decks.project_id = ${project.id}`).get() as any;
  if (!deck) {
    const id = randomUUID();
    (db as any).run(
      `INSERT INTO decks (id, project_id, goal, stack, urls, rules, health_score, health_git_dirty, health_has_dev_server, created_at, updated_at)
       VALUES (?, ?, '', ?, '{}', '[]', 0, 1, 0, ?, ?)`,
      [id, project.id, project.stack || '', Date.now(), Date.now()]
    );
    deck = db.select().from(schema.decks).where(eq(schema.decks.id, id)).get();
  }
  return deck;
}

export function computeHealthForDeck(deck: any, project: { name: string }): any {
  let score = 100;
  if (deck.healthGitDirty) score -= 15;
  if (!deck.healthHasDevServer) score -= 10;
  if (deck.healthLastBuildOk === false) score -= 20;
  if (deck.healthLastError) score -= 15;
  if (!deck.lastOpened || (Date.now() - Number(deck.lastOpened)) > 7 * 24 * 60 * 60 * 1000) score -= 10;
  score = Math.max(0, Math.min(100, score));
  db.update(schema.decks).set({ healthScore: score, healthCheckedAt: new Date() }).where(eq(schema.decks.id, deck.id)).run();
  deck = db.select().from(schema.decks).where(eq(schema.decks.id, deck.id)).get();
  exportDeckToMd(deck, project.name);
  return deck;
}
