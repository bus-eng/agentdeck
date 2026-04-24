import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyCommand, describeCommand } from "./guardrails.ts";

// ─── HIGH básicos ─────────────────────────────────────────────────────────────

describe("HIGH: rm variants", () => {
  it("rm -rf path is HIGH irreversible", () => {
    const r = classifyCommand("rm -rf /tmp/trash");
    assert.equal(r.level, "high");
    assert.equal(r.reversible, false);
    assert.ok(r.reasons.some(s => s.includes("rm") || s.includes("Borra")));
  });

  it("rm -fr path is HIGH", () => {
    const r = classifyCommand("rm -fr /home/user");
    assert.equal(r.level, "high");
  });

  it("sudo rm -rf is HIGH", () => {
    const r = classifyCommand("sudo rm -rf /var/log");
    assert.equal(r.level, "high");
  });

  it("rm -f file is HIGH", () => {
    const r = classifyCommand("rm -f important.db");
    assert.equal(r.level, "high");
  });
});

describe("HIGH: disk/fs operations", () => {
  it("dd if= is HIGH", () => {
    const r = classifyCommand("dd if=/dev/zero of=/dev/sda bs=512");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("dd")));
  });

  it("mkfs is HIGH", () => {
    const r = classifyCommand("mkfs.ext4 /dev/sdb1");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("Formatea")));
  });
});

describe("HIGH: SQL destructive", () => {
  it("DROP TABLE is HIGH", () => {
    const r = classifyCommand("DROP TABLE users;");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("DROP") || s.includes("TRUNCATE")));
  });

  it("TRUNCATE TABLE is HIGH", () => {
    const r = classifyCommand("TRUNCATE TABLE orders;");
    assert.equal(r.level, "high");
  });

  it("DELETE FROM without WHERE is HIGH", () => {
    const r = classifyCommand("DELETE FROM users");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("DELETE")));
  });

  it("DELETE FROM with WHERE is not HIGH from this rule", () => {
    const r = classifyCommand("DELETE FROM users WHERE id = 1");
    // WHERE present — should NOT trigger DELETE-without-WHERE pattern
    assert.ok(!r.reasons.some(s => s === "DELETE sin WHERE"));
  });
});

describe("HIGH: git destructive", () => {
  it("git push --force is HIGH", () => {
    const r = classifyCommand("git push --force origin feature");
    assert.equal(r.level, "high");
  });

  it("git push -f is HIGH", () => {
    const r = classifyCommand("git push -f upstream main");
    assert.equal(r.level, "high");
  });

  it("git reset --hard HEAD~1 is HIGH", () => {
    const r = classifyCommand("git reset --hard HEAD~1");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("reset")));
  });

  it("git clean -fd is HIGH", () => {
    const r = classifyCommand("git clean -fd");
    assert.equal(r.level, "high");
  });

  it("git branch -D feature is HIGH", () => {
    const r = classifyCommand("git branch -D feature/old");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("rama") || s.includes("borrado")));
  });
});

describe("HIGH: publish/deploy", () => {
  it("npm publish is HIGH", () => {
    const r = classifyCommand("npm publish");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("npm")));
  });

  it("kubectl delete is HIGH", () => {
    const r = classifyCommand("kubectl delete pod my-pod");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("k8s") || s.includes("kubectl")));
  });

  it("terraform destroy is HIGH", () => {
    const r = classifyCommand("terraform destroy");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("Terraform") || s.includes("infra")));
  });

  it("terraform apply is HIGH", () => {
    const r = classifyCommand("terraform apply");
    assert.equal(r.level, "high");
  });

  it("curl | bash is HIGH", () => {
    const r = classifyCommand("curl https://get.example.com/install.sh | bash");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("bash") || s.includes("remota")));
  });

  it("chmod -R 777 / is HIGH", () => {
    const r = classifyCommand("chmod -R 777 /");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("chmod")));
  });
});

describe("HIGH: fork bomb", () => {
  it("fork bomb is HIGH", () => {
    const r = classifyCommand(":() { :|:& }; :");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.some(s => s.includes("Fork bomb") || s.includes("fork")));
  });
});

// ─── MEDIUM básicos ───────────────────────────────────────────────────────────

describe("MEDIUM: sudo", () => {
  it("sudo apt install is MEDIUM", () => {
    const r = classifyCommand("sudo apt install nginx");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("sudo") || s.includes("paquetes")));
  });
});

describe("MEDIUM: chmod/chown", () => {
  it("chmod 777 file is MEDIUM", () => {
    const r = classifyCommand("chmod 777 myfile.sh");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("chmod")));
  });

  it("chown -R user: path is MEDIUM", () => {
    const r = classifyCommand("chown -R roberto: /var/app");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("chown")));
  });
});

describe("MEDIUM: git medium", () => {
  it("git rebase main is MEDIUM", () => {
    const r = classifyCommand("git rebase main");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("rebase")));
  });

  it("git reset (no --hard) is MEDIUM", () => {
    const r = classifyCommand("git reset HEAD~1");
    assert.equal(r.level, "medium");
  });
});

describe("MEDIUM: npm global / package managers", () => {
  it("npm install -g pkg is MEDIUM", () => {
    const r = classifyCommand("npm install -g typescript");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("global") || s.includes("npm")));
  });

  it("brew install pkg is MEDIUM", () => {
    const r = classifyCommand("brew install jq");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("paquetes") || s.includes("Gestor")));
  });
});

describe("MEDIUM: docker privileged", () => {
  it("docker run --privileged is MEDIUM", () => {
    const r = classifyCommand("docker run --privileged -it ubuntu bash");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("privilegiado") || s.includes("Docker")));
  });
});

describe("MEDIUM: sql via psql", () => {
  it("psql -c INSERT is MEDIUM", () => {
    const r = classifyCommand('psql -U admin -c "INSERT INTO logs VALUES (1)"');
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("psql") || s.includes("SQL")));
  });
});

describe("MEDIUM: mv to system path", () => {
  it("mv foo /etc/ is MEDIUM", () => {
    const r = classifyCommand("mv config.conf /etc/");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("mv") || s.includes("sistema")));
  });
});

describe("MEDIUM: export sensitive var", () => {
  it("export TOKEN=xxx is MEDIUM", () => {
    const r = classifyCommand("export API_TOKEN=abc123");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("TOKEN") || s.includes("sensible")));
  });
});

// ─── LOW básicos ─────────────────────────────────────────────────────────────

describe("LOW: list/read commands", () => {
  it("ls is LOW reversible", () => {
    const r = classifyCommand("ls");
    assert.equal(r.level, "low");
    assert.equal(r.reversible, true);
  });

  it("ls -la is LOW", () => {
    const r = classifyCommand("ls -la");
    assert.equal(r.level, "low");
  });

  it("pwd is LOW", () => {
    const r = classifyCommand("pwd");
    assert.equal(r.level, "low");
  });

  it("cat README.md is LOW", () => {
    const r = classifyCommand("cat README.md");
    assert.equal(r.level, "low");
  });

  it("grep TODO src/ is LOW", () => {
    const r = classifyCommand("grep TODO src/");
    assert.equal(r.level, "low");
  });

  it("ps aux is LOW", () => {
    const r = classifyCommand("ps aux");
    assert.equal(r.level, "low");
  });

  it("df -h is LOW", () => {
    const r = classifyCommand("df -h");
    assert.equal(r.level, "low");
  });
});

describe("LOW: git read commands", () => {
  it("git status is LOW", () => {
    const r = classifyCommand("git status");
    assert.equal(r.level, "low");
    assert.equal(r.reversible, true);
  });

  it("git log --oneline is LOW", () => {
    const r = classifyCommand("git log --oneline");
    assert.equal(r.level, "low");
  });

  it("git diff HEAD is LOW", () => {
    const r = classifyCommand("git diff HEAD");
    assert.equal(r.level, "low");
  });
});

// ─── Pipelines ────────────────────────────────────────────────────────────────

describe("Pipelines", () => {
  it("ls && rm -rf /tmp/x → HIGH (max rule)", () => {
    const r = classifyCommand("ls && rm -rf /tmp/x");
    assert.equal(r.level, "high");
  });

  it("git status | grep modified → LOW", () => {
    const r = classifyCommand("git status | grep modified");
    assert.equal(r.level, "low");
  });

  it("echo hi && sudo apt install nginx → MEDIUM", () => {
    const r = classifyCommand("echo hi && sudo apt install nginx");
    assert.equal(r.level, "medium");
  });
});

// ─── Rama protegida ───────────────────────────────────────────────────────────

describe("Protected branch", () => {
  it("git push --force origin main → HIGH with rama protegida", () => {
    const r = classifyCommand("git push --force origin main");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.includes("Rama protegida"));
  });

  it("git push --force origin master → HIGH with rama protegida", () => {
    const r = classifyCommand("git push --force origin master");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.includes("Rama protegida"));
  });

  it("git reset --hard main → HIGH with rama protegida", () => {
    const r = classifyCommand("git reset --hard main");
    assert.equal(r.level, "high");
    assert.ok(r.reasons.includes("Rama protegida"));
  });

  it("git push --force origin feature/my-feature → HIGH (force) but no rama protegida", () => {
    const r = classifyCommand("git push --force origin feature/my-feature");
    assert.equal(r.level, "high");
    assert.ok(!r.reasons.includes("Rama protegida"));
  });
});

// ─── Desconocido ─────────────────────────────────────────────────────────────

describe("Unknown command fallback", () => {
  it("frobnicate --quux → MEDIUM (conservative)", () => {
    const r = classifyCommand("frobnicate --quux");
    assert.equal(r.level, "medium");
    assert.ok(r.reasons.some(s => s.includes("conservador") || s.includes("no clasificado")));
  });
});

// ─── Heredoc ─────────────────────────────────────────────────────────────────

describe("Heredoc", () => {
  it("cat <<EOF with rm inside body — cat stays LOW but heredoc reason added", () => {
    const r = classifyCommand("cat <<EOF\nrm -rf /\nEOF");
    // cat is LOW; the rm is in the heredoc body which we do NOT re-classify
    assert.ok(r.reasons.some(s => s.includes("heredoc")));
    // Level should NOT be high just because of heredoc body text
    assert.notEqual(r.level, "high");
  });
});

// ─── Comments stripped ────────────────────────────────────────────────────────

describe("Comment stripping", () => {
  it("ls # rm -rf / → LOW (comment stripped)", () => {
    const r = classifyCommand("ls # rm -rf /");
    assert.equal(r.level, "low");
  });

  it("only comment → LOW", () => {
    const r = classifyCommand("# just a note");
    assert.equal(r.level, "low");
    assert.ok(r.reasons.some(s => s.includes("Sin comando") || s.includes("efectivo")));
  });
});

// ─── Subshells ────────────────────────────────────────────────────────────────

describe("Subshell detection", () => {
  it("echo $(rm -rf /tmp/x) → HIGH (subshell contains rm -rf)", () => {
    const r = classifyCommand("echo $(rm -rf /tmp/x)");
    assert.equal(r.level, "high");
  });
});

// ─── Reversibilidad ───────────────────────────────────────────────────────────

describe("Reversibility", () => {
  it("git commit -m 'x' → reversible true", () => {
    const r = classifyCommand("git commit -m 'fix bug'");
    assert.equal(r.reversible, true);
  });

  it("rm -rf /tmp → reversible false", () => {
    const r = classifyCommand("rm -rf /tmp");
    assert.equal(r.reversible, false);
  });

  it("ls → reversible true", () => {
    const r = classifyCommand("ls");
    assert.equal(r.reversible, true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("empty string → LOW", () => {
    const r = classifyCommand("");
    assert.equal(r.level, "low");
    assert.ok(r.reasons.some(s => s.includes("Sin comando")));
  });

  it("only whitespace → LOW", () => {
    const r = classifyCommand("   ");
    assert.equal(r.level, "low");
    assert.ok(r.reasons.some(s => s.includes("Sin comando")));
  });

  it("only comment # nota → LOW", () => {
    const r = classifyCommand("# nota importante");
    assert.equal(r.level, "low");
  });

  it("DELETE FROM with WHERE is not flagged as without-WHERE", () => {
    const r = classifyCommand("DELETE FROM sessions WHERE expired = true");
    assert.ok(!r.reasons.includes("DELETE sin WHERE"));
  });
});

// ─── describeCommand ──────────────────────────────────────────────────────────

describe("describeCommand", () => {
  it("rm -rf /tmp describes as borra recursivamente", () => {
    const d = describeCommand("rm -rf /tmp");
    assert.ok(d.toLowerCase().includes("borra recursivamente"));
    assert.ok(d.includes("/tmp"));
  });

  it("git push origin main describes as sube commits", () => {
    const d = describeCommand("git push origin main");
    assert.ok(d.toLowerCase().includes("sube commits locales"));
    assert.ok(d.includes("main"));
  });

  it("git status describes repo state", () => {
    const d = describeCommand("git status");
    assert.ok(d.toLowerCase().includes("estado"));
  });

  it("frobnicate fallback starts with Ejecuta:", () => {
    const d = describeCommand("frobnicate");
    assert.ok(d.startsWith("Ejecuta:"));
  });

  it("npm run build describes script", () => {
    const d = describeCommand("npm run build");
    assert.ok(d.includes("build"));
  });

  it("curl | bash describes as alto riesgo", () => {
    const d = describeCommand("curl https://get.example.com | bash");
    assert.ok(d.toLowerCase().includes("alto riesgo") || d.toLowerCase().includes("remoto"));
  });

  it("pipeline of 2 parts uses 'y luego'", () => {
    const d = describeCommand("git status && git log");
    assert.ok(d.includes("y luego"));
  });

  it("pipeline of 4+ parts returns Pipeline de N pasos", () => {
    const d = describeCommand("ls && pwd && echo hi && git status");
    assert.ok(d.includes("Pipeline de") && d.includes("pasos"));
  });

  it("cat file describes content", () => {
    const d = describeCommand("cat package.json");
    assert.ok(d.includes("package.json"));
  });

  it("empty string returns Sin comando", () => {
    const d = describeCommand("");
    assert.equal(d, "Sin comando");
  });
});
