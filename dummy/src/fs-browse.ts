import { readdir, stat, lstat } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import os from "node:os";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  mtime: number | null;
  error?: string;
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export interface FsBrowseResult {
  ok: true;
  path: string;
  parent: string;
  breadcrumb: BreadcrumbItem[];
  entries: FsEntry[];
  stats: { total: number; dirs: number; files: number };
  truncated?: true;
}

export interface FsBrowseError {
  ok: false;
  error: string;
}

// ── Jail config ───────────────────────────────────────────────────────────────

const HOME = process.env.HOME ?? os.homedir();

/**
 * Allowed root prefixes. $HOME is resolved at module load time.
 * Can be extended via AGENTDECK_FS_ROOTS (colon-separated) in the future.
 */
const FS_ALLOWED_ROOTS: string[] = [
  HOME,
  "/tmp",
  "/private/tmp",  // macOS alias for /tmp
  "/Volumes",
];

function isPathAllowed(normalized: string): boolean {
  return FS_ALLOWED_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(root + "/")
  );
}

// ── Path normalization + validation ───────────────────────────────────────────

export function resolveBrowsePath(input: string | undefined): { ok: true; path: string } | { ok: false; error: string; status: 400 | 403 } {
  const raw = (input ?? "").trim() || "~";

  // Reject null bytes
  if (raw.includes("\0")) {
    return { ok: false, error: "Ruta inválida: contiene null byte", status: 400 };
  }

  // Expand ~
  let expanded = raw;
  if (expanded.startsWith("~")) {
    expanded = HOME + expanded.slice(1);
  }

  // Normalize (resolves .., //, etc.)
  const normalized = resolve(expanded);

  // Must be absolute after normalize (resolve() always returns absolute, but guard anyway)
  if (!normalized.startsWith("/")) {
    return { ok: false, error: "Ruta inválida: debe ser absoluta", status: 400 };
  }

  // Jail check
  if (!isPathAllowed(normalized)) {
    return { ok: false, error: "Ruta fuera del alcance permitido", status: 403 };
  }

  return { ok: true, path: normalized };
}

// ── Breadcrumb builder ────────────────────────────────────────────────────────

export function buildBreadcrumb(absPath: string): BreadcrumbItem[] {
  const parts = absPath.split("/").filter(Boolean);
  const crumbs: BreadcrumbItem[] = [{ name: "/", path: "/" }];
  let current = "";
  for (const part of parts) {
    current += "/" + part;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

// ── Directory listing ─────────────────────────────────────────────────────────

const MAX_ENTRIES = 500;

export async function browseDirectory(
  absPath: string,
  includeHidden: boolean
): Promise<FsBrowseResult | FsBrowseError> {
  // Check existence and directory status
  let dirStat: Awaited<ReturnType<typeof stat>>;
  try {
    dirStat = await stat(absPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, error: "Permiso denegado" };
    }
    return { ok: false, error: `Ruta no existe: ${absPath}` };
  }

  if (!dirStat.isDirectory()) {
    return { ok: false, error: `La ruta no es un directorio: ${absPath}` };
  }

  // Read entries
  let dirents: import("node:fs").Dirent<string>[];
  try {
    dirents = await readdir(absPath, { withFileTypes: true, encoding: "utf8" });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, error: "Permiso denegado" };
    }
    return { ok: false, error: `Error al leer directorio: ${absPath}` };
  }

  // Filter dotfiles if needed
  const filtered = includeHidden
    ? dirents
    : dirents.filter((d) => !d.name.startsWith("."));

  // Sort: dirs first (alphabetical, case-insensitive), then files
  filtered.sort((a, b) => {
    const aIsDir = a.isDirectory();
    const bIsDir = b.isDirectory();
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  // Truncate if needed
  const truncated = filtered.length > MAX_ENTRIES;
  const slice = truncated ? filtered.slice(0, MAX_ENTRIES) : filtered;

  // Build entries with stat info
  const entries: FsEntry[] = await Promise.all(
    slice.map(async (d): Promise<FsEntry> => {
      const fullPath = join(absPath, d.name);
      const isSymlink = d.isSymbolicLink();

      let size = 0;
      let mtime: number | null = null;
      let statError: string | undefined;

      try {
        // lstat: doesn't follow symlinks — avoids hanging on broken symlinks
        const s = await lstat(fullPath);
        size = s.isDirectory() ? 0 : s.size;
        mtime = s.mtimeMs;
      } catch {
        statError = "stat failed";
      }

      return {
        name: d.name,
        path: fullPath,
        isDir: d.isDirectory(),
        isFile: d.isFile(),
        isSymlink,
        size,
        mtime,
        ...(statError ? { error: statError } : {}),
      };
    })
  );

  const dirs = entries.filter((e) => e.isDir).length;
  const files = entries.filter((e) => !e.isDir).length;

  const parent = dirname(absPath);

  const result: FsBrowseResult = {
    ok: true,
    path: absPath,
    parent,
    breadcrumb: buildBreadcrumb(absPath),
    entries,
    stats: { total: entries.length, dirs, files },
    ...(truncated ? { truncated: true as const } : {}),
  };

  return result;
}
