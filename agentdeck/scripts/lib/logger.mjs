export function log(msg, label = "●") {
  console.log(` ${label} ${msg}`);
}
export function ok(msg) { log(msg, "✅"); }
export function warn(msg) { console.log(` ⚠️  ${msg}`); }
export function err(msg) { console.log(` ❌ ${msg}`); }
export function info(msg) { log(msg, " ℹ️ "); }
export function title(msg) {
  console.log(`\n ── ${msg} ─${"─".repeat(Math.max(0, 50 - msg.length))}\n`);
}
