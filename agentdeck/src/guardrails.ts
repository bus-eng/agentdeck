export type RiskLevel = "low" | "medium" | "high";

export interface PartClassification {
  raw: string;
  level: RiskLevel;
  reasons: string[];
  reversible: boolean;
}

export interface Classification {
  level: RiskLevel;
  reasons: string[];
  reversible: boolean;
  parts: PartClassification[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

function stripComments(cmd: string): string {
  // Strip # comments that are not inside single/double quotes
  let result = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; result += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; result += ch; continue; }
    if (ch === "#" && !inSingle && !inDouble) break;
    result += ch;
  }
  return result.trim();
}

function detectHeredoc(cmd: string): boolean {
  return /<<-?\s*['"]?\w+['"]?/.test(cmd);
}

// Extract subshell contents: $(...) and `...`
function extractSubshells(cmd: string): string[] {
  const result: string[] = [];
  // $( ... )
  const reDollar = /\$\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = reDollar.exec(cmd)) !== null) result.push(m[1]);
  // ` ... `
  const reBacktick = /`([^`]*)`/g;
  while ((m = reBacktick.exec(cmd)) !== null) result.push(m[1]);
  return result;
}

// Split a command string by shell separators (&& || ; |) respecting quotes/parens
function splitParts(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let parenDepth = 0;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
    if (inSingle || inDouble) { current += ch; continue; }
    if (ch === "(") { parenDepth++; current += ch; continue; }
    if (ch === ")") { parenDepth--; current += ch; continue; }
    if (parenDepth > 0) { current += ch; continue; }
    // Check separators
    if (ch === "&" && cmd[i + 1] === "&") { parts.push(current); current = ""; i++; continue; }
    if (ch === "|" && cmd[i + 1] === "|") { parts.push(current); current = ""; i++; continue; }
    if (ch === "|") { parts.push(current); current = ""; continue; }
    if (ch === ";") { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

// ─── HIGH patterns ──────────────────────────────────────────────────────────

const HIGH_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^\s*(sudo\s+)?rm\s+(-[rRfi]*[rRf][rRfi]*\s|--recursive|--force\s|(-\w*[rR]\w*\s.*-\w*[fF]\w*)|-rf|-fr|-Rf|-fR)/,
    reason: "Borra recursivamente (rm -rf)" },
  { re: /\brm\s+(-\w*f|-\w*r\w+\s+-\w*f)/,
    reason: "rm con --force" },
  { re: /\bdd\s+if=/,
    reason: "Escritura raw de disco (dd)" },
  { re: /\bmkfs(\.\w+)?\b/,
    reason: "Formatea sistema de archivos" },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/,
    reason: "Apaga/reinicia la máquina" },
  { re: /:\(\)\s*\{.*:\|:.*&.*\}\s*;\s*:/,
    reason: "Fork bomb" },
  { re: /\bgit\s+push\b.*(\s--force\b|\s-f\b|--force-with-lease)/,
    reason: "git push forzado" },
  { re: /\bgit\s+reset\s+--hard/,
    reason: "git reset --hard (descarta cambios)" },
  { re: /\bgit\s+clean\s+-[a-z]*f/,
    reason: "git clean -f (borra untracked)" },
  { re: /\bgit\s+branch\s+-D\b/,
    reason: "Fuerza borrado de rama" },
  { re: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i,
    reason: "DROP/TRUNCATE SQL" },
  { re: /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i,
    reason: "DELETE sin WHERE" },
  { re: /\bUPDATE\s+\w+\s+SET\b(?![\s\S]*\bWHERE\b)/i,
    reason: "UPDATE sin WHERE" },
  { re: /\bnpm\s+publish\b/,
    reason: "Publica paquete a npm" },
  { re: /\b(cargo|gem|pip)\s+publish\b/,
    reason: "Publica paquete" },
  { re: /\bgh\s+release\s+create\b/,
    reason: "Crea release pública" },
  { re: /\bkubectl\s+delete\b/,
    reason: "Elimina recurso k8s" },
  { re: /\bterraform\s+(destroy|apply)\b/,
    reason: "Cambios infra Terraform" },
  { re: /\bdocker\s+(system\s+prune|volume\s+rm)\b/,
    reason: "Prune/rm Docker" },
  { re: /\b>\s*\/dev\/(sda|nvme|disk)/,
    reason: "Redirige a dispositivo raw" },
  { re: /\bchmod\s+-R\s+(777|000)\b/,
    reason: "chmod permisivo recursivo" },
  { re: /\bcurl\s+[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/,
    reason: "curl | bash (ejecución remota)" },
];

const PROTECTED_BRANCHES = /\b(main|master|prod|production|release)\b/;
const GIT_DESTRUCTIVE_WITH_BRANCH = /\bgit\s+(push\s+.*(-f\b|--force\b|--force-with-lease)|reset\s+--hard|branch\s+-D|clean\s+-[a-z]*f)\b/;

// ─── MEDIUM patterns ─────────────────────────────────────────────────────────

const MEDIUM_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^\s*sudo\b/, reason: "Usa sudo" },
  { re: /\bchmod\s+777\b/, reason: "chmod 777" },
  { re: /\bchown\s+-R\b/, reason: "chown recursivo" },
  { re: /\bgit\s+reset\b(?!\s+--hard)/, reason: "git reset (soft/mixed)" },
  { re: /\bgit\s+rebase\b/, reason: "git rebase reescribe historial" },
  { re: /\bgit\s+checkout\s+--\s/, reason: "Descarta cambios locales" },
  { re: /\bnpm\s+(i|install)\s+-g\b/, reason: "Install global npm" },
  { re: /\b(pip|pipx)\s+install\b.*--force/, reason: "pip install --force" },
  { re: /\bmv\s+.*\s+(\/|\/etc|\/usr|\/bin|\/var)(\/|$)/, reason: "mv a path de sistema" },
  { re: /\b(curl|wget)\b[^|]*-o\s+(\/|\/etc|\/usr)/, reason: "Descarga a path de sistema" },
  { re: />+\s*(\/etc|\/usr|~\/\.\w+rc|\/var)/, reason: "Redirect a archivo sensible" },
  { re: /\bexport\s+\w*(SECRET|TOKEN|KEY|PASSWORD)\w*\s*=/i, reason: "Export de variable sensible" },
  { re: /\b(brew|apt|yum|dnf)\s+(install|uninstall|remove)\b/, reason: "Gestor de paquetes" },
  { re: /\bdocker\s+run\b.*--privileged/, reason: "Docker privilegiado" },
  { re: /\bpsql\b.*-c\s+["'].*\b(INSERT|UPDATE|DELETE)\b/i, reason: "SQL mutante vía psql -c" },
];

// ─── LOW commands ─────────────────────────────────────────────────────────────

const LOW_FIRST_TOKENS = new Set([
  "ls", "ll", "la", "pwd", "cd", "cat", "bat", "less", "more", "head", "tail",
  "wc", "file", "stat", "grep", "rg", "ag", "ack", "echo", "printf", "which",
  "whereis", "type", "env", "printenv", "date", "uptime", "whoami", "id",
  "hostname", "ps", "top", "htop", "df", "du", "free", "vmstat", "uname",
]);

const LOW_GIT = /^\s*git\s+(status|log|diff|show|blame|remote\s+show|config\s+--get|fetch|stash\s+list)\b/;
const LOW_GIT_BRANCH = /^\s*git\s+branch\b(?!\s+-D)/;
const LOW_GIT_PULL = /^\s*git\s+pull\s+--ff-only\b/;
const LOW_NPM = /^\s*npm\s+(ls|list|outdated|run)\b/;
const LOW_MISC = /^\s*(node\s+--version|tsc\s+--version|docker\s+ps\b|docker\s+images\b|kubectl\s+get\b)/;

function isLowGit(cmd: string): boolean {
  return LOW_GIT.test(cmd) || LOW_GIT_BRANCH.test(cmd) || LOW_GIT_PULL.test(cmd);
}

function isLow(cmd: string): boolean {
  const first = cmd.trim().split(/\s+/)[0] ?? "";
  if (LOW_FIRST_TOKENS.has(first)) {
    // find with -delete or -exec rm is NOT low
    if (first === "find" && (/-delete\b/.test(cmd) || /-exec\s+rm\b/.test(cmd))) return false;
    return true;
  }
  if (isLowGit(cmd)) return true;
  if (LOW_NPM.test(cmd)) return true;
  if (LOW_MISC.test(cmd)) return true;
  return false;
}

// Reversible: low + git commit + git branch (no -D) + mkdir + touch + cd
const REVERSIBLE_PATTERNS = [
  /^\s*git\s+commit\b/,
  /^\s*git\s+branch\b(?!\s+-D)/,
  /^\s*mkdir\b/,
  /^\s*touch\b/,
  /^\s*cd\b/,
];

function isReversible(cmd: string, level: RiskLevel): boolean {
  if (level === "low") return true;
  return REVERSIBLE_PATTERNS.some(re => re.test(cmd));
}

// ─── classifyPart ────────────────────────────────────────────────────────────

function classifyPart(raw: string): PartClassification {
  const cmd = stripComments(raw);

  if (cmd === "") {
    return { raw, level: "low", reasons: ["Sin comando efectivo"], reversible: true };
  }

  const reasons: string[] = [];
  let level: RiskLevel = "low";

  // Check HIGH
  for (const { re, reason } of HIGH_PATTERNS) {
    if (re.test(cmd)) {
      level = "high";
      reasons.push(reason);
    }
  }

  // Protected branch check
  if (GIT_DESTRUCTIVE_WITH_BRANCH.test(cmd) && PROTECTED_BRANCHES.test(cmd)) {
    level = "high";
    reasons.push("Rama protegida");
  }

  if (level !== "high") {
    // Check MEDIUM
    for (const { re, reason } of MEDIUM_PATTERNS) {
      if (re.test(cmd)) {
        level = maxLevel(level, "medium");
        reasons.push(reason);
      }
    }
  }

  if (level === "low" && reasons.length === 0) {
    if (isLow(cmd)) {
      // already low, no reason needed
    } else {
      // default: conservative medium
      level = "medium";
      reasons.push("Comando no clasificado (principio conservador)");
    }
  }

  const reversible = isReversible(cmd, level);
  return { raw, level, reasons, reversible };
}

// ─── classifyCommand ─────────────────────────────────────────────────────────

// Check HIGH patterns on the full (unsplit) command string
// This catches patterns that span separators (e.g., curl|bash, fork bomb split by ; and |)
function checkHighOnFullCommand(cmd: string): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  for (const { re, reason } of HIGH_PATTERNS) {
    if (re.test(cmd)) reasons.push(reason);
  }
  if (GIT_DESTRUCTIVE_WITH_BRANCH.test(cmd) && PROTECTED_BRANCHES.test(cmd)) {
    reasons.push("Rama protegida");
  }
  return { level: reasons.length > 0 ? "high" : "low", reasons };
}

export function classifyCommand(cmd: string): Classification {
  const normalized = cmd.trim().replace(/\s+/g, " ");

  if (normalized === "" || normalized === "#") {
    return { level: "low", reasons: ["Sin comando"], reversible: true, parts: [] };
  }

  // Heredoc detection — treat body as opaque (don't classify heredoc body content)
  const hasHeredoc = detectHeredoc(normalized);

  // Build the effective command for full-string checks:
  // strip comments and heredoc body so they don't pollute pattern matching
  const strippedForCheck = stripComments(
    hasHeredoc
      ? (normalized.split(/<<-?\s*['"]?\w+['"]?/)[0] ?? normalized).trim()
      : normalized
  );

  // Pre-check full command string for HIGH patterns that may span split boundaries
  const fullCheck = checkHighOnFullCommand(strippedForCheck);

  // Subshell classification
  const subshells = extractSubshells(normalized);
  const subshellClassifications = subshells.map(s => classifyPart(s.trim()));

  // Split and classify parts (using original normalized, not heredoc-stripped)
  // For heredoc: classify only the command before the heredoc marker
  const classifyTarget = hasHeredoc
    ? (normalized.split(/<<-?\s*['"]?\w+['"]?/)[0] ?? normalized).trim()
    : normalized;

  const rawParts = splitParts(classifyTarget);
  const parts: PartClassification[] = rawParts.length > 0
    ? rawParts.map(p => classifyPart(p))
    : [classifyPart(classifyTarget)];

  if (hasHeredoc) {
    const first = parts[0];
    if (first && !first.reasons.includes("Contiene heredoc — revisá el cuerpo")) {
      first.reasons.push("Contiene heredoc — revisá el cuerpo");
    }
  }

  // Merge: parts + full-command pre-check + subshells
  let level: RiskLevel = parts.reduce<RiskLevel>((acc, p) => maxLevel(acc, p.level), "low");
  level = maxLevel(level, fullCheck.level);
  for (const sc of subshellClassifications) {
    level = maxLevel(level, sc.level);
  }

  const allReasons = [
    ...parts.flatMap(p => p.reasons),
    ...fullCheck.reasons,
    ...subshellClassifications.flatMap(sc => sc.reasons),
  ];

  const reasons = [...new Set(allReasons)];
  const reversible = parts.every(p => p.reversible) && subshellClassifications.every(sc => sc.reversible);

  return { level, reasons, reversible, parts };
}

// ─── describeCommand ─────────────────────────────────────────────────────────

const DESCRIBE_RULES: Array<{ re: RegExp; describe: (m: RegExpMatchArray) => string }> = [
  // curl | bash — before generic curl
  { re: /\bcurl\s+(\S+)[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/,
    describe: () => "Descarga y ejecuta script remoto (alto riesgo)" },
  // rm -rf
  { re: /\brm\s+(-rf|-fr|-rRf|-Rf|-r\s+--force|--recursive\s+--force|--force\s+--recursive)\s+(\S+)/,
    describe: m => `Borra recursivamente \`${m[2]}\` y todo su contenido (irreversible)` },
  // git push --force
  { re: /\bgit\s+push\s+.*?(--force-with-lease|--force|-f)\s+(\S+)\s+(\S+)/,
    describe: m => `Fuerza push a \`${m[2]}/${m[3]}\` — reescribe historial remoto` },
  { re: /\bgit\s+push\s+.*?(--force-with-lease|--force|-f)/,
    describe: () => "Fuerza push — reescribe historial remoto" },
  // git push (normal)
  { re: /\bgit\s+push\s+(\S+)\s+(\S+)/,
    describe: m => `Sube commits locales a \`${m[1]}/${m[2]}\`` },
  { re: /\bgit\s+push\b/,
    describe: () => "Sube commits locales al remoto" },
  // git reset --hard
  { re: /\bgit\s+reset\s+--hard\s+(\S+)/,
    describe: m => `Descarta cambios locales y apunta a \`${m[1]}\` (irreversible)` },
  { re: /\bgit\s+reset\s+--hard/,
    describe: () => "Descarta cambios locales (irreversible)" },
  // git commit
  { re: /\bgit\s+commit\s+.*?-m\s+['"]([^'"]+)['"]/,
    describe: m => `Crea commit con mensaje \`${m[1]}\`` },
  { re: /\bgit\s+commit\b/,
    describe: () => "Crea commit" },
  // git status/log/diff
  { re: /\bgit\s+status\b/, describe: () => "Muestra estado del repo" },
  { re: /\bgit\s+log\b/, describe: () => "Muestra historial de commits" },
  { re: /\bgit\s+diff\b/, describe: () => "Muestra diffs sin stagear" },
  // npm
  { re: /\bnpm\s+publish\b/, describe: () => "Publica paquete al registry npm (público)" },
  { re: /\bnpm\s+run\s+(\S+)/, describe: m => `Ejecuta script npm \`${m[1]}\`` },
  { re: /\bnpm\s+(install|i)\s+(-g\s+)?(\S+)/, describe: m => `Instala dependencias ${m[3]}` },
  { re: /\bnpm\s+(install|i)\b/, describe: () => "Instala dependencias" },
  // cd / ls / cat / mkdir / mv / cp / chmod / chown
  { re: /\bcd\s+(\S+)/, describe: m => `Cambia directorio a \`${m[1]}\`` },
  { re: /\bls\s+(\S+)/, describe: m => `Lista archivos en \`${m[1]}\`` },
  { re: /\bls\b/, describe: () => "Lista archivos en el directorio actual" },
  { re: /\bcat\s+(\S+)/, describe: m => `Muestra contenido de \`${m[1]}\`` },
  { re: /\bmkdir\s+(-p\s+)?(\S+)/, describe: m => `Crea directorio \`${m[2]}\`` },
  { re: /\bmv\s+(\S+)\s+(\S+)/, describe: m => `Mueve/renombra \`${m[1]}\` → \`${m[2]}\`` },
  { re: /\bcp\s+(-r\s+)?(\S+)\s+(\S+)/, describe: m => `Copia \`${m[2]}\` → \`${m[3]}\`` },
  { re: /\bchmod\s+(\S+)\s+(\S+)/, describe: m => `Cambia permisos de \`${m[2]}\` a ${m[1]}` },
  { re: /\bchown\s+(\S+)\s+(\S+)/, describe: m => `Cambia dueño de \`${m[2]}\` a ${m[1]}` },
  // sudo
  { re: /^\s*sudo\s+(.+)/, describe: m => `Ejecuta con privilegios root: ${m[1]}` },
  // curl
  { re: /\bcurl\s+(\S+)/, describe: m => `Descarga ${m[1]}` },
  // psql
  { re: /\bpsql\b.*-c\s+['"]([^'"]+)['"]/, describe: m => `Ejecuta SQL contra Postgres: ${m[1]}` },
  // sqlplus
  { re: /\bsqlplus\b/, describe: () => "Sesión Oracle SQL*Plus" },
  // docker
  { re: /\bdocker\s+run\b/, describe: () => "Ejecuta contenedor Docker" },
  // kubectl
  { re: /\bkubectl\s+get\s+(\S+)/, describe: m => `Lista recursos k8s tipo \`${m[1]}\`` },
  // terraform
  { re: /\bterraform\s+plan\b/, describe: () => "Muestra cambios de infra previstos (sin aplicar)" },
  { re: /\bterraform\s+apply\b/, describe: () => "Aplica cambios de infraestructura" },
  // tsx / node
  { re: /\btsx\s+(\S+)/, describe: m => `Ejecuta script: \`${m[1]}\`` },
  { re: /\bnode\s+(\S+)/, describe: m => `Ejecuta script: \`${m[1]}\`` },
];

// Patterns that must be matched against the full unsplit command string
const WHOLE_COMMAND_DESCRIBE: Array<{ re: RegExp; describe: (m: RegExpMatchArray) => string }> = [
  { re: /\bcurl\s+\S+[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/,
    describe: () => "Descarga y ejecuta script remoto (alto riesgo)" },
];

function describeSingleWhole(cmd: string): string | null {
  for (const { re, describe } of WHOLE_COMMAND_DESCRIBE) {
    const m = cmd.match(re);
    if (m) return describe(m);
  }
  return null;
}

function describeSingle(cmd: string): string {
  const trimmed = cmd.trim();
  for (const { re, describe } of DESCRIBE_RULES) {
    const m = trimmed.match(re);
    if (m) return describe(m);
  }
  // fallback
  const truncated = trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed;
  return `Ejecuta: ${truncated}`;
}

export function describeCommand(cmd: string): string {
  const normalized = cmd.trim().replace(/\s+/g, " ");
  if (normalized === "") return "Sin comando";

  // Check whole-command patterns first (e.g. curl|bash spans the pipe separator)
  const wholeMatch = describeSingleWhole(normalized);
  if (wholeMatch !== null) return wholeMatch;

  const parts = splitParts(normalized);
  if (parts.length === 0) return describeSingle(normalized);
  if (parts.length === 1) return describeSingle(parts[0]);
  if (parts.length <= 3) {
    return parts.map(p => describeSingle(p)).join(" y luego ");
  }
  return `Pipeline de ${parts.length} pasos`;
}
