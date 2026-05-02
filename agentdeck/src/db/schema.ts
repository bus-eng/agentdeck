// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Roberto Bustamante (virela-dev)

import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  stack: text("stack"),
  preferredAgent: text("preferred_agent"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().unique(),
  goal: text("goal"),
  stack: text("stack"),
  urls: text("urls"), // JSON
  rules: text("rules"), // JSON array
  memoryNotes: text("memory_notes"),
  memoryDecisions: text("memory_decisions"), // JSON array
  frequentCommands: text("frequent_commands"), // JSON array
  prompts: text("prompts"), // JSON array
  deployProvider: text("deploy_provider"),
  healthScore: integer("health_score").notNull().default(0),
  healthGitBranch: text("health_git_branch"),
  healthGitDirty: integer("health_git_dirty", { mode: "boolean" }).notNull().default(true),
  healthHasDevServer: integer("health_has_dev_server", { mode: "boolean" }).notNull().default(false),
  healthLastBuildOk: integer("health_last_build_ok", { mode: "boolean" }),
  healthLastBuildTime: integer("health_last_build_time", { mode: "timestamp" }),
  healthLastError: text("health_last_error"),
  healthLastCheckpointId: text("health_last_checkpoint_id"),
  healthCheckedAt: integer("health_checked_at", { mode: "timestamp" }),
  lastOpened: integer("last_opened", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;

export const checkpoints = sqliteTable("checkpoints", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").references(() => decks.id, { onDelete: "cascade" }).notNull(),
  narrative: text("narrative").notNull(),
  reason: text("reason"),
  stateBefore: text("state_before"),
  stateAfter: text("state_after"),
  commandsExecuted: text("commands_executed"), // JSON array
  filesModified: text("files_modified"), // JSON array
  risks: text("risks"),
  rollbackNotes: text("rollback_notes"),
  evidenceId: text("evidence_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type Checkpoint = typeof checkpoints.$inferSelect;

export const evidencePacks = sqliteTable("evidence_packs", {
  id: text("id").primaryKey(),
  checkpointId: text("checkpoint_id").references(() => checkpoints.id, { onDelete: "set null" }),
  summary: text("summary").notNull(),
  commands: text("commands"), // JSON array
  result: text("result"),
  errors: text("errors"),
  filesAffected: text("files_affected"), // JSON array
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type EvidencePack = typeof evidencePacks.$inferSelect;

export const agentProfiles = sqliteTable("agent_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  focus: text("focus").notNull(),
  allowedRiskLevels: text("allowed_risk_levels"), // JSON array
  suggestedRecipes: text("suggested_recipes"), // JSON array
  uiHints: text("ui_hints"), // JSON
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type AgentProfile = typeof agentProfiles.$inferSelect;

export const commandHistory = sqliteTable(
  "command_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    text: text("text").notNull(),
    kind: text("kind").notNull(), // "command" | "token"
    useCount: integer("use_count").notNull().default(1),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("command_history_user_text_idx").on(t.userId, t.text),
    index("command_history_user_last_used_idx").on(t.userId, t.lastUsedAt),
  ]
);

export type CommandHistory = typeof commandHistory.$inferSelect;
