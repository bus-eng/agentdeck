// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Roberto Bustamante (virela-dev)

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, "../../data/agentdeck.db");

// Ensure data directory exists
try {
  mkdirSync(join(__dirname, "../../data"), { recursive: true });
} catch {
  throw new Error(`Cannot create data directory at ${join(__dirname, "../../data")}`);
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };
