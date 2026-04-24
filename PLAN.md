# AgentDeck — Superplan técnico y funcional

> Diseño arquitectónico v1. Privado por ahora, pensado para futura apertura open source.
> Autor: diseño en sesión con Roberto Bustamante, 2026-04-24.
> Estado: **No implementar nada todavía.** Este documento es la fuente de verdad conceptual.

---

## 1. Resumen ejecutivo

**AgentDeck** es una aplicación web **local** que corre en la máquina principal (Mac) y se accede desde cualquier dispositivo de la LAN (iPhone, iPad, otra laptop) vía `http://192.168.x.x:8787`.

**Qué es**: centro de control unificado para trabajar con agentes IA de CLI (Codex CLI, Claude Code, OpenClaw), proyectos locales, terminales reales, prompts, specs SDD, logs, y uso/gasto.

**Qué NO es**: no es cloud, no es desktop (Tauri/Electron), no es IDE completo, no es clon de code-server ni ttyd. No se expone a internet.

**Valor real**:
- Terminal real del host accesible desde celular sin SSH ni apps nativas.
- Control por **intención** (no por recordar flags).
- Contratos y specs que los agentes IA pueden leer antes de tocar código.
- Seguridad LAN seria: auth, allowlist, risk scoring, panic button.
- Memoria local por proyecto que alimenta prompts sin mandar nada a la nube.

**Diferenciador clave**: no es "una terminal en el navegador con skin bonito". Es una capa de **gobernanza local de agentes IA** con terminal como primitiva, no como fin.

---

## 2. Decisión de arquitectura recomendada

El stack propuesto es **adecuado con ajustes puntuales**. Respuestas concretas:

### Fastify vs NestJS
**Fastify.** NestJS es sobre-ingeniería para un server que va a tener ~20-30 endpoints, WebSocket y PTY bridge. Los decoradores, módulos, DI contenedor de Nest son overhead para un equipo de 1 y para un binario que se corre en `localhost`. Fastify + plugins (auth, rate-limit, cors, websocket) da control explícito y menor superficie de ataque. Nest se justifica si más adelante se mete un sistema de eventos grande tipo CQRS — no es el caso.

### SQLite + Drizzle vs Prisma
**Drizzle.** Razones: (a) sin runtime pesado, sin query engine en Rust embebido, (b) tipos inferidos directos de schema TS, (c) mucho mejor con SQLite nativo y migraciones simples, (d) license-friendly (Apache-2.0 vs la historia de Prisma). Prisma tiene mejor DX de modelado pero agrega un query engine binario que complica empaquetado y licencias en escenarios open source futuros.

### React vs alternativas
**React sigue**, pero con matices. Razón principal: shadcn/ui y Monaco tienen comunidades React-first. Alternativas descartadas para este caso:
- **SolidJS**: más rápido, pero ecosistema UI no está a la altura de shadcn.
- **Svelte/SvelteKit**: muy bueno pero menos componentes listos para paneles complejos.
- **HTMX + servidor**: tentador por simplicidad, se queda corto con xterm.js y estados reactivos de sesiones múltiples.

Stack React + Vite + TS + Tailwind + shadcn es pragmático y permite futuro desarrollo comunitario.

### xterm.js + node-pty vs integrar ttyd directamente
**xterm.js + node-pty.** ttyd embebido tiene dos problemas:
1. Es un binario C que dificulta el empaquetado cross-platform y la auditabilidad open source.
2. No tiene hooks nativos para **risk scoring**, **session metadata**, **spec lock**, ni **budget guard**. Si se mete ttyd, hay que meterle proxy encima, y se pierde la razón de haberlo metido.

Con node-pty controlamos el ciclo de vida, el `spawn`, las variables de entorno, el `cwd`, el stdin interceptor (para risk scoring) y los streams salientes (para masking de secretos). Eso es core, no accesorio.

### Monaco Editor vs code-server embebido
**Monaco minimal en MVP**, solo para visualizar/editar archivos específicos: `CLAUDE.md`, `AGENTS.md`, `specs/*.md`, `.env.example`, `package.json`. No es un IDE. Si el usuario quiere un IDE completo, que use code-server aparte (opcionalmente AgentDeck puede mostrar un link si detecta que está corriendo localmente). Embeber code-server dentro de AgentDeck duplica la superficie y lo convierte en clon.

### Ajustes al stack
- Agregar **Hono** como alternativa plan-B mental (no sustituir Fastify todavía). Mencionarlo porque si en algún momento se quiere empaquetar como binario `bun`, Hono corre en Bun/Node/Deno sin cambios.
- **node-pty**: requiere `node-gyp` y dependencias de build. Documentar esto desde el inicio y considerar **prebuilds** para publicación open source.
- **Zod** obligatorio en cada endpoint (input + output). Type-safety client-server via schema compartido.

---

## 3. Arquitectura general (texto)

```
 [Navegador: Mac / iPhone / iPad / Laptop LAN]
   React + Vite + Tailwind + shadcn + xterm.js + Monaco
              │  HTTPS local (self-signed o HTTP con loopback binding)
              │  WebSocket wss://192.168.x.x:8787/ws/terminal/:id
              ▼
 [AgentDeck Server — proceso Node en Mac]
   ┌────────────────────────────────────────────────────────────┐
   │ Fastify HTTP API                                           │
   │   ├── /auth      login, logout, me                          │
   │   ├── /projects  CRUD + health radar                        │
   │   ├── /sessions  list/kill                                  │
   │   ├── /commands  run safe, list favorites, risk-score       │
   │   ├── /prompts   library                                    │
   │   ├── /specs     SDD center                                 │
   │   ├── /tools     detect/version/auth                        │
   │   ├── /expenses  manual + imports                           │
   │   ├── /logs      stream + audit                             │
   │   └── /settings  bind IP, trust mode, secrets policy        │
   ├────────────────────────────────────────────────────────────┤
   │ WebSocket hub (terminal + events)                           │
   │   └── PTY Session Manager ── node-pty ── shell real         │
   ├────────────────────────────────────────────────────────────┤
   │ Security layer                                              │
   │   auth middleware, CSRF, Origin check, rate-limit,          │
   │   allowlist, risk scoring, secret masker, idle timeouts     │
   ├────────────────────────────────────────────────────────────┤
   │ Domain services                                             │
   │   ProjectManager, CommandRunner, RiskScorer,                │
   │   ContextCapsuleBuilder, AgentContract, DiffExplainer,      │
   │   TimelineRecorder, ReplayService, BudgetGuard, HealthRadar │
   ├────────────────────────────────────────────────────────────┤
   │ Persistence — SQLite (better-sqlite3 + Drizzle)             │
   │   projects, sessions, command_logs, audit, prompts,         │
   │   specs, expenses, settings, plugins, timeline_events       │
   ├────────────────────────────────────────────────────────────┤
   │ Plugin loader (fase 3+): carga descriptores JSON,           │
   │   no ejecuta código de plugin en MVP.                       │
   └────────────────────────────────────────────────────────────┘
              │
              ▼
     [Filesystem Mac]  [zsh/bash]  [Codex / Claude / OpenClaw / git / npm / ...]
```

**Principio rector**: el backend es un **guardián** entre el navegador y el shell. Ningún input del cliente llega al PTY sin pasar por Origin check, auth, masking y (opcionalmente) risk scoring.

---

## 4. Módulos del sistema

Para cada módulo: propósito, funcionalidades, datos, pantallas, prioridad.

### 4.1 Dashboard
- **Propósito**: estado general del sistema — sesiones activas, alertas, último proyecto, salud de herramientas IA.
- **Funcionalidades**: cards de proyectos recientes, sesiones vivas, alertas de seguridad, atajos a "Nueva sesión".
- **Datos**: agrega de `projects`, `terminal_sessions`, `audit_logs`.
- **Pantallas**: single view con grid responsive.
- **Prioridad**: MVP (versión mínima: sesiones activas + proyectos + botón new).

### 4.2 Projects
- **Propósito**: CRUD de proyectos locales; cada uno es un "contexto" con path, stack, agente preferido y notas.
- **Funcionalidades**: add/edit/delete, validar path existe, detectar stack, listar scripts, health radar, comandos frecuentes.
- **Datos**: tabla `projects` + `project_actions` (acciones por intención).
- **Pantallas**: lista, detalle, wizard de alta.
- **Prioridad**: MVP.

### 4.3 Terminal Sessions
- **Propósito**: abrir/cerrar/listar sesiones PTY por proyecto.
- **Funcionalidades**: nueva sesión, reconectar, redimensionar, kill, pinear, tmux opcional.
- **Datos**: `terminal_sessions` (id, project_id, pid, state, started_at, ended_at).
- **Pantallas**: panel lateral con lista, viewport con xterm.
- **Prioridad**: MVP (sin tmux) — tmux en fase 2.

### 4.4 Command Runner
- **Propósito**: ejecutar comandos **conocidos y clasificados**, no arbitrarios.
- **Funcionalidades**: catálogo, botones de acción, risk scoring, confirmaciones, logs por comando.
- **Datos**: `tool_commands`, `command_logs`.
- **Pantallas**: botonera dentro de detalle de proyecto, historial, command palette.
- **Prioridad**: MVP (versión mínima con comandos hardcoded para Codex/Claude/OpenClaw/git/npm).

### 4.5 AI Tools (Codex / Claude Code / OpenClaw)
- **Propósito**: integración declarativa con cada herramienta IA.
- **Funcionalidades**: detectar instalación (`which codex`, `codex --version`), status de auth si la CLI lo expone, launcher rápido, plantillas de prompts.
- **Datos**: `tools` (detección cacheada), `tool_commands`.
- **Pantallas**: sección "AI Tools" con cards de estado.
- **Prioridad**: MVP básico (solo detección + launcher). Integración profunda en fase 2.

### 4.6 SDD Center
- **Propósito**: specs reusables por proyecto, plantillas, AGENTS.md/CLAUDE.md.
- **Funcionalidades**: crear spec desde plantilla, editar en Monaco, versionar snapshot, exportar como pack.
- **Datos**: `specs`, `prompts`.
- **Pantallas**: lista de specs por proyecto, editor, galería de plantillas.
- **Prioridad**: fase 2 (Horizonte 2).

### 4.7 Prompt Library
- **Propósito**: prompts reutilizables con variables (`{{project}}`, `{{stack}}`, `{{objetivo}}`).
- **Funcionalidades**: crear, clonar, categorizar, copiar a clipboard, ligar a proyecto.
- **Datos**: `prompts`, `prompt_usages`.
- **Pantallas**: lista con tags, editor.
- **Prioridad**: fase 2.

### 4.8 Logs
- **Propósito**: logs de comandos y sesiones, sanitizados.
- **Funcionalidades**: búsqueda, filtros (proyecto, fecha, riesgo), export JSON/CSV.
- **Datos**: `command_logs`, `session_logs`, `audit_logs`.
- **Pantallas**: vista de timeline + filtros.
- **Prioridad**: MVP (versión simple por sesión).

### 4.9 Expenses / Usage
- **Propósito**: registro manual y semi-automático de gasto en herramientas IA y cloud.
- **Funcionalidades**: alta manual de suscripciones, asociar a proyecto, estimación de sesiones, alertas cuando se rompe presupuesto.
- **Datos**: `expenses`, `budget_limits`.
- **Pantallas**: overview + detalle.
- **Prioridad**: fase 3.

### 4.10 Settings
- **Propósito**: configuración: IP/puerto, trust mode, credenciales, allowlist, timeouts.
- **Funcionalidades**: formularios.
- **Datos**: `settings` (kv encriptado).
- **Pantallas**: single view por categoría.
- **Prioridad**: MVP (mínimo: IP bind + password + timeout).

### 4.11 Security / Access Control
- **Propósito**: auth local, sesiones web, revocaciones, audit log.
- **Funcionalidades**: login, logout, ver sesiones activas web, kill all, cambiar passphrase.
- **Datos**: `local_auth`, `web_sessions`, `audit_logs`.
- **Pantallas**: login, settings > security.
- **Prioridad**: MVP.

---

## 5. MVP recomendado

**Criterio**: mínimo conjunto que justifica la existencia del producto y se puede construir en 2-4 semanas de trabajo serio.

### Alcance MVP
1. **Login local** con passphrase (argon2id), una sola cuenta.
2. **Binding configurable**: por defecto `127.0.0.1`; el usuario habilita `0.0.0.0` o IP LAN específica con confirmación explícita.
3. **Proyectos** (CRUD): nombre, path, stack detectado, notas.
4. **Terminal embebida** (xterm.js + node-pty + WS) en el `cwd` del proyecto, con resize y cierre.
5. **Quick commands** para Codex / Claude / OpenClaw / git-status: botones que inyectan comando en una terminal nueva o existente.
6. **Logs** por sesión (stdin sanitizado + stdout recortado), persistidos en SQLite.
7. **Panic button**: mata todas las sesiones PTY, invalida tokens web.
8. **Command Risk Scoring mínimo**: bloquear patrones de lista negra (`rm -rf`, `git reset --hard`, `chmod -R 777`, `mkfs`, `dd if=`, redirecciones a `/dev/*`). Modal de confirmación con texto tipeado ("CONFIRM") para desbloquear.
9. **Secret masker** en logs: regex de patrones conocidos (AWS, GitHub, Anthropic, OpenAI, Railway, Bearer).
10. **Warning visible** si el usuario bindea a `0.0.0.0`.

### Lo que NO va al MVP
- Tmux, session replay, timeline completo, budget guard, plugins, expenses, SDD center, Monaco editor, prompt library, handoff entre agentes, mobile command mode avanzado.

### Validación del plan contra la pregunta original
Sí, el plan permite ejecutar **terminal real desde el navegador con xterm.js + WebSocket + node-pty**: el flujo es `xterm.onData → WS send → server → pty.write`; `pty.onData → WS send → xterm.write`. Validado conceptualmente. El MVP es pequeño (9 features realmente core, sin fluff) y construible por fases.

---

## 6. Modelo de seguridad

Este es el punto más crítico porque es LAN pero **no es solo mi red**: familia, invitados, vecinos con WiFi compartida, cámaras IoT comprometidas pueden estar en la misma LAN.

### 6.1 Principios
1. **Default deny**: todo endpoint y comando requiere auth salvo `GET /health` y `GET /login`.
2. **Loopback-first**: por defecto bindea `127.0.0.1`. Exponer a LAN es explícito.
3. **Zero trust de la red**: misma LAN ≠ seguro.
4. **Least privilege en comandos**: allowlist > blacklist.
5. **No secrets in logs, ever**.

### 6.2 Controles concretos
- **Binding IP configurable** en settings. Default `127.0.0.1:8787`. Para LAN: usuario elige la IP específica (no `0.0.0.0`) salvo override con warning.
- **TLS**: generar certificado self-signed al primer arranque, opción para usar `mkcert` local. HTTPS obligatorio si bindea no-loopback.
- **Autenticación**: passphrase de 12+ chars, argon2id (memoria 64MiB, iters 3). Cookie httpOnly, SameSite=Strict, Secure si TLS. Sesión con expiración absoluta (24h) + inactividad (30min).
- **CSRF**: token rotativo en cada respuesta, verificación en POST/PUT/DELETE. Para WebSocket: verificar `Origin` contra allowlist configurada (default `https://localhost:8787` + IP LAN declarada) + ticket de handshake firmado por el cookie auth.
- **WebSocket hijacking mitigation**: el token CSRF se valida en el primer mensaje WS (handshake lógico); sin handshake válido en 3s, close.
- **Rate limiting**: 5 intentos de login / 15 min / IP. 100 req/min API. WS connects 20/min/IP.
- **Lockout**: 10 fallos → bloqueo 30 min por IP; reset con passphrase maestra o reinicio del servicio.
- **CORS**: estricto — solo los orígenes configurados (IP bind + localhost). No wildcard nunca.
- **Allowlist de comandos**: lista positiva para ejecución no interactiva. Comandos dentro de terminal interactiva: el usuario escribe libremente, pero el **Risk Scorer** monitorea stdin y advierte con overlay antes de `Enter` en patrones destructivos.
- **Secret masker bidireccional**: en logs persistidos y en streams mostrados si se detecta patrón (opcional, off por defecto en output live para no romper UX, on por defecto en persistencia).
- **No guardar API keys completas**: los settings/ENV que contengan tokens se enmascaran en UI con `sk-****1234`. La clave real vive en el archivo `.env` del usuario o en keychain del OS — AgentDeck solo mantiene referencia.
- **Idle timeout terminal**: sesión PTY sin input 30min → warning; 60min → kill (configurable).
- **Panic button**: endpoint + botón UI + shortcut global (`Ctrl+Shift+P`). Mata PTYs, invalida todas las sesiones web, limpia WS.
- **Audit log inmutable**: cada login, logout, cambio de settings sensible, comando riesgoso, panic button → append-only en `audit_logs`.
- **Warning de exposición**: pantalla modal recurrente si se bindea fuera de loopback y si el firewall del OS no está detectando regla.

### 6.3 Amenazas identificadas y mitigaciones

| Amenaza | Mitigación |
|---|---|
| Usuario en la misma WiFi accede | Auth + TLS + IP binding específico + lockout |
| CSRF desde otra página del browser | SameSite=Strict + CSRF token + Origin check en WS |
| WebSocket hijacking | Handshake firmado + Origin check + ticket one-time |
| Comandos destructivos | Risk Scorer + confirmación tipeada + allowlist para no-interactivo |
| Exposición de tokens en logs | Secret masker + env vars sensibles no logueadas |
| Terminal persistente olvidada | Idle timeout + panel de sesiones activas + push notification al dispositivo del dueño |
| Reuso de cookie robada | Binding de cookie a user-agent + IP (soft, no hard), rotación en cada login |
| Escalada via node-pty | PTY corre como el usuario que lanza AgentDeck; documentar no correr como root |
| MITM en LAN | TLS obligatorio cuando no-loopback, aceptación manual del cert self-signed |
| Supply-chain (npm) | Lockfile + audit + SBOM + revisión de deps críticas (ver §31) |
| Dependencia con telemetría | Auditoría manual; `LOCAL_ONLY_TRUST_MODE` setting que deshabilita dep opcionales con network |
| Ataque físico (alguien toma el iPad) | Passphrase al desbloquear app + timeout agresivo + lock screen del OS |

---

## 7. Diseño de terminal web

### 7.1 Flujo técnico
```
xterm.onData(ch) → WS send {t:"in", d:ch}
WS recv {t:"in", d} → pty.write(d)
pty.onData(d) → WS send {t:"out", d}
WS recv {t:"out", d} → xterm.write(d)
resize event → WS {t:"resize", cols, rows} → pty.resize(cols,rows)
```

### 7.2 Decisiones
- **Shell**: `zsh` si existe en el host, fallback `bash`. Detectable con `process.env.SHELL`.
- **cwd**: `project.path` validado contra realpath y contra escape de symlink.
- **Env**: heredado del proceso AgentDeck + `AGENTDECK_SESSION=1` + overrides por proyecto.
- **Resize**: xterm `FitAddon`; throttle 100ms.
- **Reconexión**: cada sesión tiene buffer circular del servidor (últimos 64KB). En reconnect, cliente hace replay inicial.
- **Cierre**: `pty.kill('SIGTERM')`, 5s, luego `SIGKILL`. Estado final guardado en DB.
- **Múltiples terminales**: sin límite en DB, soft limit de 10 activas concurrentes (configurable).
- **Procesos largos**: idle timer se resetea con cualquier output (no solo input), para que un `npm run dev` no se cierre solo.

### 7.3 ¿Tmux primero o no?

**Opción A (MVP): terminal simple sin tmux.**
Pros: menos fricción, sin dep externa, funciona en cualquier Mac limpia. Contra: al recargar página, se pierde output anterior (salvo el buffer circular). Si se reinicia AgentDeck, se pierden PTYs.

**Opción B (fase 2): tmux opcional.**
Detectar `tmux` en `PATH`. Si está, ofrecer "Persistent session" toggle — la PTY envuelve `tmux new -A -s agentdeck-{sessionId}`. En reconnect, `tmux attach`. Si AgentDeck reinicia, la sesión sigue viva en tmux.

**Recomendación**: **A en MVP, B en fase 2.** Meter tmux al inicio complica el modelo mental y agrega una pieza no controlada. El buffer circular + reconnect cubre 90% del caso.

---

## 8. Diseño de proyectos

### 8.1 Schema lógico
```
projects
  id                  TEXT PK (ulid)
  name                TEXT unique-per-user
  path                TEXT  (validado: exists, isDirectory, realpath, no symlink escape)
  stack               TEXT  ('node' | 'php' | 'python' | 'go' | 'mixed' | null)
  default_shell       TEXT  ('zsh' | 'bash' | null → auto)
  preferred_ai_tool   TEXT  ('codex' | 'claude' | 'openclaw' | null)
  notes               TEXT
  detected_files      JSON  { packageJson, composerJson, artisan, claudeMd, agentsMd, specsDir, dotenv }
  created_at          DATETIME
  updated_at          DATETIME
  last_opened_at      DATETIME
  pinned              BOOLEAN
```

### 8.2 Funciones
- **Agregar proyecto**: wizard con path picker (en Mac) o textbox (en iOS) + auto-detect.
- **Validar path**: `fs.stat`, `fs.realpath`, chequeo que no sea `/`, `~`, `/Users`, `/etc`, etc. (lista de paths prohibidos).
- **Abrir terminal**: crea session, spawnea shell con `cwd = project.path`.
- **Listar archivos básicos**: árbol limitado (1er nivel + archivos detect importantes).
- **Abrir editor**: Monaco sobre archivos whitelisted (CLAUDE.md, AGENTS.md, specs/*.md, package.json read-only, .env.example). **Nunca abrir `.env` en UI**.
- **Comandos frecuentes**: generados de `scripts` en package.json, `composer.json`, `Makefile`.
- **Detección de archivos clave**: al agregar proyecto y en cada "refresh", escanea:
  - `package.json`, `composer.json`, `artisan`, `pyproject.toml`, `go.mod`, `Cargo.toml`
  - `CLAUDE.md`, `AGENTS.md`, `specs/`, `docs/architecture.md`
  - `.env*` (cuenta presencia, NO contenido)
  - `.git/`, branch actual, dirty state

---

## 9. Editor web

**Recomendación**: Monaco **minimal** en MVP, específico a archivos de gobernanza.

### Ruta gradual
1. **MVP**: visor de solo-lectura para `CLAUDE.md`, `AGENTS.md`, `specs/*.md`, `package.json`, `README.md`. Un diff viewer simple para cuando un agente propone cambios.
2. **Fase 2**: edición guardable de los mismos archivos + snapshot a `audit_logs`.
3. **Fase 3**: edición de `specs/` extendida, con templates del SDD Center.
4. **No entrar en ruta IDE**: si el usuario necesita editar código completo, que abra el proyecto en su editor de escritorio o en code-server separado. AgentDeck puede detectar code-server corriendo en `localhost:8080` y mostrar link.

### ¿code-server embebido?
**No.** Aumenta 10x la superficie del producto, complica licencia (code-server es MIT pero VS Code OSS tiene trademarks), y compite con el scope real. Link externo opcional sí.

---

## 10. SDD Center

Módulo que convierte a AgentDeck en un lugar donde los agentes IA **leen las reglas antes de tocar código**.

### 10.1 Capacidades
- Crear `specs/` por proyecto con plantillas.
- Generar `CLAUDE.md` y `AGENTS.md` iniciales.
- Guardar prompts reutilizables versionados.
- Generar comandos para Codex/Claude/OpenClaw con contexto embebido.
- Mantener **restricciones de proyecto** (ej: "no agregar nuevas dependencias sin aprobación"), inyectables a cualquier prompt.
- Spec Lock (ver §22): advierte si una sesión va contra la spec.

### 10.2 Plantillas iniciales
| Plantilla | Propósito |
|---|---|
| `frontend-boundaries.md` | Scope y no-scope del frontend (rutas permitidas, estado, qué NO tocar). |
| `implementation-plan.md` | Plan por fases con criterios de aceptación. |
| `security-review.md` | Checklist de revisión de seguridad (OWASP top 10, auth, secrets). |
| `visual-refresh.md` | Reglas para refresh visual sin tocar lógica. |
| `code-review.md` | Rubric de review (bugs, legibilidad, tests, performance). |
| `terminal-safety.md` | Comandos aprobados por proyecto, comandos prohibidos. |
| `migration-review.md` | Plantilla para revisar migraciones DB. |
| `prompt-debugging.md` | Prompt de diagnóstico riguroso con hipótesis. |

### 10.3 Modelo de datos
```
specs
  id, project_id, kind (template_key), title, content_md,
  version, active, created_at, updated_at, locked BOOLEAN
```

---

## 11. Integración con herramientas IA y desarrollo

Integración declarativa vía archivo de plugin (ver §26). Para cada tool:

| Tool | Detección | Versión | Auth | Comandos seguros | Riesgos | Log |
|---|---|---|---|---|---|---|
| **Codex CLI** | `which codex` | `codex --version` | `codex auth status` si existe; sino heurística `~/.codex/` | `codex`, `codex --help`, `codex resume` | Puede modificar cualquier archivo del cwd | guardar stdin de sesión (si usuario lo permite) + diff resultante |
| **Claude Code** | `which claude` | `claude --version` | lectura de `~/.claude/*` sin extraer tokens | `claude`, `claude -m sonnet`, `claude --print "..."` con plantilla | Puede hacer edits masivos | idem |
| **OpenClaw** | `which openclaw` | `openclaw version` | `openclaw doctor` | `openclaw status`, `openclaw doctor`, `openclaw list` | Manejo de procesos y credenciales | idem |
| **GitHub CLI** | `which gh` | `gh version` | `gh auth status` | `gh pr list`, `gh issue list`, `gh repo view` | `gh repo delete`, `gh api DELETE` | audit de mutaciones |
| **Railway CLI** | `which railway` | `railway --version` | `railway whoami` | `railway status`, `railway logs`, `railway variables` (enmascarados) | `railway down`, `railway delete` | audit |
| **npm / yarn / pnpm** | `which ...` | `--version` | n/a | `install`, `run <script>`, `outdated`, `audit` | `npm publish`, `--force`, instalación desde url arbitraria | log completo |
| **composer** | `which composer` | `--version` | `composer config --global` read | `install`, `update --dry-run`, `show`, `outdated` | `composer global require`, scripts custom | log |
| **php artisan** | detect `artisan` en project.path | `php artisan --version` | n/a | `serve`, `migrate --pretend`, `route:list`, `tinker` read-only modo | `migrate:fresh`, `db:seed`, `artisan down`, `key:generate` | log |
| **git** | `which git` | `--version` | `git config user.name/email` | `status`, `diff`, `log`, `branch`, `fetch` | `reset --hard`, `clean -fd`, `push --force`, `filter-branch` | audit |
| **docker** | `which docker` | `version` | `docker info` | `ps`, `images`, `logs` | `system prune -a`, `rm -f $(docker ps -aq)` | audit |

**Principio**: AgentDeck **no** guarda tokens de estos tools. Solo referencia si está autenticado o no.

---

## 12. Gastos y uso

### 12.1 V1 (manual)
- Alta de suscripciones: proveedor, plan, costo mensual, moneda, fecha de cobro, notas.
- Categorías: AI (Claude, ChatGPT, Codex), Infra (Railway, Vercel), Dominios, Otros.
- Totalización mensual y YTD.

### 12.2 V2 (semi-automático)
- **Estimación por sesión**: para sesiones de Claude Code con plantilla de tokens, estimar costo según modelo.
- **Import de logs**: leer archivos de log de Claude Code / Codex si tienen costo computable.
- **API usage** cuando el proveedor la exponga.
- **OpenTelemetry** opt-in para Claude Code: si Claude Code emite spans OTel (feature que sí existe en algunas versiones), captarlos localmente sin enviarlos a cloud.

### 12.3 Advertencia explícita en UI
> "Para planes tipo ChatGPT Plus o Claude Pro sin API accesible, AgentDeck no puede calcular gasto exacto. El módulo es **registro manual y estimaciones**, no contabilidad fiscal."

### 12.4 Export
CSV + JSON. Útil para contabilidad propia.

---

## 13. Base de datos (SQLite)

Todas las tablas con `created_at`, `updated_at` cuando aplica. IDs son ULID en string.

### 13.1 Tablas

**`local_auth`**
```
id, passphrase_hash (argon2id), passphrase_updated_at,
lockout_until, failed_attempts, last_login_at
```
Una sola fila en V1. Sin PII, sin email.

**`web_sessions`**
```
id, token_hash, user_id=1, user_agent, ip,
created_at, last_active_at, expires_at, revoked
```
Índice: `(token_hash)`, `(expires_at)`.

**`projects`**
Ver §8.

**`tools`**
```
id, name, binary_path, version, auth_ok BOOLEAN,
last_checked_at, metadata JSON
```

**`tool_commands`**
```
id, tool_id, label, command_template,
risk_level ('safe'|'moderate'|'dangerous'|'destructive'),
requires_confirmation, active
```

**`terminal_sessions`**
```
id, project_id FK, pid, shell, cols, rows,
started_at, ended_at, exit_code, state ('running'|'ended'|'killed'),
created_by_session_id (web_sessions.id)
```

**`command_logs`**
```
id, session_id FK, project_id FK, command_raw_masked,
risk_level, started_at, ended_at, exit_code,
stdout_preview_masked, stderr_preview_masked
```
`command_raw_masked` y previews pasan por secret masker antes de persistir.

**`prompts`**
```
id, project_id FK nullable, title, body_md, tags JSON,
variables JSON, last_used_at, uses_count
```

**`specs`**
```
id, project_id FK, kind, title, content_md, version,
active BOOLEAN, locked BOOLEAN, created_at, updated_at
```

**`expenses`**
```
id, project_id FK nullable, provider, plan, amount, currency,
period ('monthly'|'yearly'|'one_time'), next_charge_date,
notes, active
```

**`settings`**
```
key TEXT PK, value_encrypted, updated_at
```
Valores sensibles cifrados con clave derivada de passphrase.

**`audit_logs`**
```
id, actor_session_id, event_type, payload JSON, ip, created_at
```
Append-only. Trigger previene UPDATE/DELETE.

**`timeline_events`** (fase 3)
```
id, project_id, session_id, event_type, payload JSON, occurred_at
```

**`plugins`** (fase 3)
```
id, name, version, descriptor_json, enabled, installed_at
```

### 13.2 Índices clave
- `web_sessions(expires_at)`, `web_sessions(token_hash)`
- `terminal_sessions(project_id, state)`
- `command_logs(project_id, started_at DESC)`
- `audit_logs(created_at DESC)`
- `timeline_events(project_id, occurred_at DESC)`

### 13.3 Datos sensibles que NO se guardan
- Passphrase en claro — nunca.
- API tokens (Claude, OpenAI, GitHub, Railway, etc.) — nunca en la DB de AgentDeck.
- Contenido de `.env` — nunca.
- Stdout completo de sesiones por defecto — solo preview sanitizado (primeros/últimos N KB con masking). Usuario puede activar "full session recording" opt-in por proyecto, con advertencia.

---

## 14. API backend

Todo endpoint valida input/output con Zod. Todo endpoint (salvo `/health` y `/auth/login`) requiere sesión.

### 14.1 REST
```
POST   /auth/login              { passphrase } → { token, expiresAt }
POST   /auth/logout             (cookie)
GET    /auth/me                 → { user, session }
POST   /auth/change-passphrase  { current, next }

GET    /projects                → [Project]
POST   /projects                { name, path, ... } → Project
PATCH  /projects/:id
DELETE /projects/:id
GET    /projects/:id/health     → HealthRadarSnapshot
GET    /projects/:id/files      ?path=  (whitelisted)
POST   /projects/:id/detect     → rerun detection

GET    /sessions                → [TerminalSession]
DELETE /sessions/:id            (kill)
POST   /sessions/panic          → kills all PTYs + invalidates web sessions

GET    /tools                   → [Tool]
POST   /tools/detect            → force re-detection
GET    /tools/:name/commands    → [ToolCommand]
POST   /commands/risk-score     { command } → { level, reasons }
POST   /commands/run            { projectId, commandId, args? } → { logId, sessionId? }

GET    /logs                    ?projectId&since&level
GET    /logs/:id                → detail
DELETE /logs                    ?olderThan

GET    /prompts                 ?tag
POST   /prompts
PATCH  /prompts/:id
DELETE /prompts/:id

GET    /specs                   ?projectId
POST   /specs
PATCH  /specs/:id
DELETE /specs/:id

GET    /expenses
POST   /expenses
PATCH  /expenses/:id
DELETE /expenses/:id

GET    /settings
PATCH  /settings
POST   /settings/rotate-csrf

GET    /audit                   ?since&eventType
GET    /health                  (public, unauthenticated, minimal: { ok:true, version })
```

### 14.2 WebSocket
```
WS /ws/terminal/:sessionId
  Handshake: cookie auth + query token CSRF one-time
  Messages:
    client→server: { t:"in", d } | { t:"resize", cols, rows } | { t:"ping" }
    server→client: { t:"out", d } | { t:"exit", code } | { t:"err", msg } | { t:"pong" }
  Close: 4401 unauthorized | 4403 forbidden | 4408 timeout | 1000 normal

WS /ws/events
  Handshake idem.
  Server→client broadcasts: session started/ended, panic fired,
    risk event (pattern detected), health alert.
```

### 14.3 Controles por endpoint
- Todos los POST/PATCH/DELETE: CSRF token + body schema Zod.
- Rate limit por endpoint (más estricto en `/auth/login`, `/commands/run`, `/sessions/panic`).
- Logging a `audit_logs` para cambios de settings, panic, commands `dangerous`/`destructive`, crear/borrar projects, cambios de passphrase.

---

## 15. Estructura de carpetas

**Recomendación para MVP**: **monorepo simple**, no sobre-ingeniería.

```
agentdeck/
├── apps/
│   ├── web/               # Vite + React + Tailwind + shadcn + xterm
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── lib/       # fetcher, ws client, utils
│   │   │   ├── hooks/
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   └── vite.config.ts
│   └── server/            # Fastify + node-pty + better-sqlite3 + drizzle
│       ├── src/
│       │   ├── routes/    # auth, projects, sessions, commands, ...
│       │   ├── ws/        # terminal hub, events hub
│       │   ├── services/  # domain: ProjectManager, RiskScorer, ...
│       │   ├── db/        # drizzle schema, migrations, client
│       │   ├── security/  # auth, csrf, masker, rate-limit
│       │   ├── plugins/   # fastify plugins
│       │   └── index.ts
│       └── drizzle.config.ts
├── packages/
│   ├── shared/            # tipos compartidos, zod schemas
│   ├── risk/              # risk scorer puro (testable)
│   └── masker/            # secret masker puro (testable)
├── docs/
│   ├── architecture.md
│   ├── security-model.md
│   ├── plugin-system.md
│   └── roadmap.md
├── scripts/
│   ├── dev.sh             # arranca web y server
│   └── install-macos.sh   # panel de instalación (ver §36)
├── .github/               # vacío por ahora (repo privado)
├── PLAN.md                # este archivo
├── README.md              # draft mínimo
├── LICENSE_DECISION.md    # nota de que es privado + plan futuro
├── SECURITY.md            # contacto + canal de disclosure
├── PRIVACY.md             # qué datos guarda y dónde
└── package.json           # workspaces: ["apps/*", "packages/*"]
```

**Por qué monorepo simple**:
- Un solo dueño (Roberto), no hay equipos distintos.
- Tipos compartidos son reales (schemas Zod, DTO).
- `apps/server` y `packages/risk` son testeables en aislamiento.
- Evita la trampa de partir en 6 paquetes innecesariamente.

**pnpm workspaces** recomendado por mejor manejo de store y licencias transitivas.

---

## 16. UI/UX del producto

### 16.1 Layout general (desktop)
```
┌─────────────────────────────────────────────────────────────┐
│ Topbar: AgentDeck · breadcrumb · status · user · panic      │
├─────────┬───────────────────────────────────────────────────┤
│ Sidebar │ Main                                              │
│         │                                                   │
│ Home    │   [content específico de la ruta]                 │
│ Proj.   │                                                   │
│ Sess.   │                                                   │
│ Prompts │                                                   │
│ Specs   │                                                   │
│ Logs    │                                                   │
│ Exp.    │                                                   │
│ Sett.   │                                                   │
│         │                                                   │
│         ├───────────────────────────────────────────────────┤
│         │ Bottom drawer: sesiones activas (xterm viewport)  │
└─────────┴───────────────────────────────────────────────────┘
```

### 16.2 Pantallas clave
- **Dashboard**: grid de cards — "Sesiones activas", "Últimos proyectos", "Alertas de seguridad", "Quick actions".
- **Project detail**: header con nombre/path, tabs (Overview / Terminal / Files / Specs / Logs / Settings), botón "New terminal".
- **Terminal panel**: xterm fullbleed, tab bar de sesiones, toolbar (resize mode, copy, paste, clear, kill), indicador de riesgo en tiempo real (color del borde).
- **Command palette** (`Cmd/Ctrl+K`): fuzzy sobre proyectos, acciones, comandos. Reemplaza memoria.
- **Logs view**: timeline vertical con filtros arriba, expandible por evento.
- **Login**: form simple, passphrase-only, sin recuperación (no hay email, es local).

### 16.3 Mobile-first para iPhone/iPad
- Layout colapsa sidebar a bottom nav.
- Terminal ocupa viewport completo con **teclado auxiliar** sticky encima del keyboard nativo (Esc, Tab, Ctrl, /, -, |, &&, ↑, ↓, Ctrl+C, Ctrl+D).
- Botones mínimo 44x44pt (Apple HIG).
- Confirmaciones destructivas: modal fullscreen con botón "CONFIRM" que se habilita tras tipear la palabra.
- Portrait + landscape soportados.
- Sin depender de hover para info crítica (tooltips son acompañantes).

### 16.4 Dark mode
Default dark. Toggle manual. Paleta: slate-950/900 fondo, slate-100 texto, primary electric (cyan-400), warn amber-400, danger rose-500.

### 16.5 Botones peligrosos
- Color rose + outline, no relleno (evita accidente).
- Doble confirmación: modal + tipeo de "CONFIRM" o "DELETE".
- Nunca en el primer tap-target de una sección.

### 16.6 Accesibilidad
- Contraste AA mínimo.
- Focus visible siempre (no `outline: none`).
- ARIA labels en iconos.
- Navegación por teclado completa (Tab, shortcuts).
- Respetar `prefers-reduced-motion`.

---

## 17. Plan por fases

### Fase 0 — Validación técnica (1-3 días)
- **Objetivos**: probar que xterm.js + WS + node-pty funciona de punta a punta en Mac, que el bind LAN es viable, que Safari iOS renderiza xterm.
- **Entregables**: spike desechable con login hardcoded y una terminal real.
- **Riesgos**: compilación de node-pty, latencia WS, xterm en Safari mobile.
- **Criterio aceptación**: desde iPhone en la misma LAN, abrir terminal y correr `ls`, `htop`, `vim :q`.

### Fase 1 — MVP funcional (2-4 semanas)
- **Objetivos**: ver §5.
- **Entregables**: binario runnable con `pnpm dev` o `pnpm start` en Mac; instalación vía script (ver §36).
- **Riesgos**: scope creep, UX móvil.
- **Criterio**: un día entero de trabajo de Roberto desde iPad usando solo AgentDeck, sin SSH ni desktop.

### Fase 2 — Proyectos + comandos rápidos (2 semanas)
- **Objetivos**: stack detection, tool commands, monaco minimal para specs.
- **Entregables**: detección auto de package.json/composer.json/artisan, comandos frecuentes por proyecto, editor de CLAUDE.md/AGENTS.md.
- **Riesgos**: risk scoring false positives.
- **Criterio**: creación de un proyecto nuevo → stack detectado automáticamente → botones útiles disponibles en ≤10s.

### Fase 3 — SDD Center (2-3 semanas)
- **Objetivos**: plantillas, specs versionadas, prompt library básica, Agent Contract generable.
- **Criterio**: iniciar una sesión de Claude Code **con contrato** generado por AgentDeck que pegado al prompt limita scope.

### Fase 4 — Editor y specs avanzadas (2 semanas)
- **Objetivos**: Monaco con edición guardable, diff viewer, Spec Lock.
- **Criterio**: una sesión de Codex intenta modificar un archivo fuera del scope declarado → AgentDeck muestra warning con link a la spec.

### Fase 5 — Gastos/uso (2 semanas)
- **Objetivos**: expenses manuales + estimación por sesión.
- **Criterio**: reporte CSV mensual con gasto agregado por proveedor y por proyecto.

### Fase 6 — Hardening de seguridad (2 semanas)
- **Objetivos**: auditoría completa, fuzzing básico de API, revisión de deps, SBOM, pen-test interno.
- **Entregables**: checklist cerrado, SECURITY.md final.
- **Criterio**: zero hallazgos high en escaneo interno; TLS obligatorio cuando no-loopback; lockout probado.

### Fase 7 — Empaquetado / instalación local (2 semanas)
- **Objetivos**: script de instalación Mac, launchd service opcional, auto-start al login, instalador con auto-update futuro.
- **Entregables**: `install-macos.sh` + plist + uninstall + upgrade.
- **Criterio**: Mac limpia → AgentDeck corriendo en 90s.

### Fase 8+ (Horizonte 3-4)
Timeline, Replay, Budget Guard, Health Radar completo, plugins, apertura open source.

---

## 18. Pruebas

### 18.1 Niveles
- **Unit**: Zod schemas, risk scorer, secret masker, path validator.
- **Integration**: rutas Fastify con DB in-memory, auth flow completo.
- **WebSocket**: mock WS cliente + server, verificar handshake + reconnect + backpressure.
- **Terminal session**: spawn shell bash en test, escribir `echo hi`, verificar output.
- **Security**: intentos de CSRF, Origin inválido, token expirado, rate limit.
- **E2E (Playwright)**: login → crear proyecto → abrir terminal → correr `ls` → kill → panic button.
- **Móvil**: Playwright con device emulation (iPhone 15) para UX básica; manual en device real para keyboard auxiliar.

### 18.2 Escenarios críticos
| Caso | Resultado esperado |
|---|---|
| Login correcto | Cookie set, redirect a dashboard |
| Login con passphrase mala 10 veces | Lockout 30min |
| Abrir terminal válida | xterm conectado en <1s, stream bidireccional |
| Cerrar terminal | PTY killed, estado en DB `ended`, logs persistidos |
| Comando largo (`sleep 60`) | No timeout mientras haya actividad visual o keepalive |
| Resize frecuente | Sin race conditions, último valor aplicado |
| Reconexión tras `wifi off/on` | Cliente reconecta, replay del buffer circular |
| `rm -rf /` tipeado | Risk scorer intercepta antes de Enter → modal con CONFIRM |
| Secret en output (`sk-ant-xxx`) | Enmascarado en logs persistidos |
| Acceso desde IP no autorizada (si CORS filtrado por IP) | 403 + audit log |
| Panic button | Todas las PTYs muertas en ≤2s, sesiones web invalidadas |
| Request con cookie pero sin CSRF | 403 |

---

## 19. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| node-pty falla al compilar en macOS nueva | Documentar versiones soportadas. Offrecer prebuilds cuando se publique. Alternativa de fallback: `@lydell/node-pty` (fork mantenido). |
| Procesos colgados consumen RAM/CPU | Idle timeout + panel de sesiones con CPU/RAM + limit configurable |
| Comandos destructivos | Risk Scorer + allowlist + confirmación tipeada + audit |
| Exposición LAN por error | Default loopback + warning en UI + self-check al boot del firewall |
| Safari iOS no renderiza xterm bien | Spike en fase 0, fallback a terminal simplificada móvil |
| Teclado celular: ausencia de Esc, Tab | Teclado auxiliar sticky |
| Sesiones persistentes huérfanas | TTL por sesión + cleanup al boot |
| Consumo de recursos (log growth) | Rotación de logs, caps por proyecto, vacuum SQLite periódico |
| Logs demasiado grandes | Compresión (zstd opcional), retención configurable (default 30d) |
| Credenciales filtradas por bug en masker | Test suite de masker con corpus amplio, fail-closed (si duda, enmascara) |
| Dependencias con telemetría | Auditoría manual + `NO_TELEMETRY=1` + blocklist |
| Arrastre de deps con licencias copyleft | Auditoría al agregar cada dep; ver §31 |
| node-pty privileges escalation | Documentar: no correr como root, no agregar `sudo` a allowlist |
| Empaquetar credenciales por error | `.gitignore` desde día 1; pre-commit hook que escanea secretos |
| WS hijack via extensión del browser | Origin check estricto + token handshake + SameSite cookies |
| Usuario cierra laptop: sesiones PTY mueren | Explicitly OK, documentar; tmux en fase 2 cubre el caso |

---

## 20. Recomendación final

### Stack final recomendado
- Backend: **Node 22+**, **TypeScript**, **Fastify**, **better-sqlite3** + **Drizzle**, **node-pty**, **ws**, **zod**, **argon2**.
- Frontend: **React 18+**, **TypeScript**, **Vite**, **Tailwind**, **shadcn/ui**, **xterm.js** + `FitAddon` + `WebLinksAddon`, **Monaco** (minimal).
- Tooling: **pnpm workspaces**, **biome** o **eslint+prettier**, **vitest**, **Playwright**.
- Opcionales fase 2+: **tmux** (runtime), **pm2**/`launchd` (service), **zstd** (log compression).

### MVP final recomendado
Ver §5. Un solo usuario local, un solo dispositivo de acceso a la vez sin multi-sesión web (multi-sesión en fase 2). 9 features core.

### Qué NO construir al inicio
- IDE completo
- Plugins
- Session replay
- Timeline avanzado
- Budget guard
- Tmux
- Handoff entre agentes (pegar texto es suficiente en V1)
- Mobile command mode con snippets complejos
- code-server embebido

### Primer experimento técnico obligatorio
**Antes de escribir línea de producción**: spike de 1 día que pruebe:
1. xterm.js + node-pty + ws en Mac.
2. Acceso desde iPhone Safari en la LAN.
3. Latencia de tipeo <50ms percibida.
4. Kill de PTY limpio.

Si cualquiera de los 4 falla, replantear stack antes de seguir.

### Próximos 5 pasos concretos
1. **Spike técnico** (Fase 0) — 1 día.
2. **Confirmar binding LAN y TLS self-signed** — validar aceptación del cert en iOS.
3. **Diseñar schema SQLite definitivo** y generar migración inicial con Drizzle.
4. **Implementar auth + settings + UI de login** — bloque de seguridad primero.
5. **Implementar terminal embebida + panel de sesiones** — bloque core.

---

---

# Segunda capa — Innovación y diferenciación

## 21. Diferenciadores de producto

Ideas que hacen a AgentDeck **distinto** de terminal web común / code-server / ttyd / dashboards.

### 21.1 Agent Contract auto-generado por sesión
- **Problema**: cuando se abre una sesión de Codex/Claude, el agente puede hacer cualquier cosa — tocar archivos fuera de scope, instalar deps, cambiar arquitectura.
- **Cómo funciona**: al iniciar sesión, AgentDeck genera un markdown con objetivo, alcance, prohibiciones, archivos sensibles, comandos permitidos, criterios de aceptación. Lo pega al prompt del agente o lo guarda como `specs/agent-contract-{session}.md`.
- **Valor**: el agente arranca con reglas explícitas. Menos desvíos.
- **Complejidad**: baja-media (templating + pickers).
- **Ubicación**: **MVP básico** (plantilla + copy), versión completa fase 3.

### 21.2 Context Capsule
- **Problema**: contar de nuevo el contexto de un proyecto cada vez que se abre un agente es tedioso y se olvida data relevante.
- **Cómo funciona**: botón "Generate capsule" — produce un markdown compacto (resumen, decisiones, rutas, errores recientes, próximo paso) que se copia al clipboard.
- **Valor**: handoff a cualquier agente (incluso cambiando de Claude a Codex) sin perder memoria.
- **Complejidad**: media (requiere timeline events + resumen heurístico).
- **Ubicación**: fase 3.

### 21.3 Command Risk Scoring
- **Problema**: `rm -rf` tipeado por error, `git reset --hard` sin entender, scripts `curl | sh` maliciosos.
- **Cómo funciona**: antes de que stdin llegue al PTY, pasa por un scorer. Patrones destructivos disparan overlay "¿Ejecutar X? Nivel: Destructive".
- **Valor**: una barrera que tu mano sola no tiene.
- **Complejidad**: baja (reglas regex + AST parsing simple).
- **Ubicación**: **MVP**.

### 21.4 Spec Lock
- **Problema**: agentes se salen de la spec sin que te des cuenta.
- **Cómo funciona**: declarás una spec activa por proyecto. Cambios detectados en archivos fuera de scope → alerta visual. Comandos fuera de la allowlist de la spec → warning.
- **Valor**: convierte un conjunto de reglas en un semáforo.
- **Complejidad**: media.
- **Ubicación**: fase 3.

### 21.5 Diff Explainer
- **Problema**: un agente toca 12 archivos — leer los 12 diffs es tedioso y fácil de aprobar sin entender.
- **Cómo funciona**: post-sesión, AgentDeck genera un informe: "¿Qué cambió? ¿Por qué? ¿Riesgo? ¿Cómo revertir?".
- **Valor**: review humano más rápido y seguro.
- **Complejidad**: media-alta (puede usar Claude/Codex offline prompt pequeño, o heurística local).
- **Ubicación**: fase 3-4.

### 21.6 Local AI Memory Map
- **Problema**: el contexto útil de un proyecto está disperso en mente/CLAUDE.md/notes.
- **Cómo funciona**: por proyecto, un grafo simple de decisiones técnicas, comandos frecuentes, errores conocidos, restricciones. Se alimenta de logs, specs, y notas manuales.
- **Valor**: sugerencias y plantillas más relevantes.
- **Complejidad**: media.
- **Ubicación**: fase 3.

### 21.7 Project Health Radar
- **Problema**: "¿cómo está este proyecto?" requiere revisar 10 cosas.
- **Cómo funciona**: escaneo on-demand — deps obsoletas, tests existentes, estado git, ramas, secretos potencialmente expuestos, presencia de README/AGENTS.md/specs, tamaño de logs.
- **Valor**: semáforo de salud con acciones sugeridas.
- **Complejidad**: media.
- **Ubicación**: fase 2 (versión mínima).

### 21.8 Smart Prompt Composer
- **Problema**: escribir buenos prompts toma tiempo.
- **Cómo funciona**: wizard — seleccionás proyecto + objetivo + restricciones + agente destino; AgentDeck genera prompt con plantilla SDD incrustada.
- **Valor**: output que los agentes interpretan mejor.
- **Complejidad**: baja-media.
- **Ubicación**: fase 2.

### 21.9 Agent Budget Guard
- **Problema**: sesiones largas de IA acumulan costo sin que te enteres.
- **Cómo funciona**: límite por sesión, por día, por herramienta. Alertas. Estimación cuando hay data; registro manual cuando no.
- **Valor**: evita el susto del cierre de mes.
- **Complejidad**: media (dep. de si hay API).
- **Ubicación**: fase 3.

### 21.10 Mobile Command Mode
- **Problema**: trabajar desde celular con terminal completa es incómodo.
- **Cómo funciona**: modo "solo acciones" — lista de comandos favoritos, botones grandes, teclado auxiliar, confirmaciones claras.
- **Valor**: control real del Mac desde iPhone sin sufrir.
- **Complejidad**: baja-media.
- **Ubicación**: fase 2.

### 21.11 Panic Button
- **Problema**: si algo se descontrola, necesitás una palanca única.
- **Cómo funciona**: botón grande (y shortcut global) que mata PTYs, invalida sesiones web, guarda snapshot de logs.
- **Valor**: reset seguro sin reiniciar el OS.
- **Complejidad**: baja.
- **Ubicación**: **MVP**.

### 21.12 Local-Only Trust Mode
- **Problema**: "¿este producto manda algo afuera?" Duda crónica con apps IA.
- **Cómo funciona**: toggle que garantiza (y verifica al boot) que no hay conexiones salientes no esperadas. Netstat snapshot publicado en settings.
- **Valor**: confianza declarada y verificable.
- **Complejidad**: media.
- **Ubicación**: fase 2 (declaración MVP, verificación fase 2).

### 21.13 Agent Handoff
- **Problema**: pasar contexto de Claude a Codex (o viceversa) es manual y se pierde info.
- **Cómo funciona**: genera resumen de transferencia con estado, decisiones, archivos tocados, pendientes, next prompt.
- **Valor**: continuidad entre herramientas.
- **Complejidad**: media.
- **Ubicación**: fase 3.

---

## 22. Funcionalidades futuristas pero realizables

Las ideas de §21 se detallan acá como features concretas.

### 22.1 Agent Timeline
Registro estructurado de **todo** lo que pasa en sesión:
- Evento: `session_started`, `command_run`, `file_changed`, `prompt_sent`, `spec_used`, `error_detected`, `decision_noted`, `cost_estimated`, `session_ended`.
- Cada evento tiene `occurred_at`, `project_id`, `session_id`, `payload`.
- Vista: timeline vertical con agrupamiento por sesión.
- Reconstrucción: desde eventos se puede reconstruir qué pasó en una sesión sin releer logs crudos.

**Implementación**:
- Hook central `emit(event)` en backend.
- Hooks especializados: después de un comando, comparar git status antes/después para emitir `file_changed`.
- Retención: 90 días por default.

### 22.2 Session Replay
Replay **textual estructurado**, no video:
- Lee `timeline_events` + `command_logs` ordenados.
- Vista reproductor con timeline scrubber (← → space).
- Muestra: comando actual, stdout, archivos afectados, duración.
- No reinterpreta stdout en tiempo real (es texto plano), pero anima la progresión.

**Implementación**:
- No requiere guardar stdout completo por default. Si está activo "full recording" para ese proyecto, se guarda.
- UI: panel con timestamps y acciones, tipo git blame interactivo.

### 22.3 AI Handoff
Flujo:
1. Claude diseña plan → guarda en `specs/handoff-{timestamp}.md`.
2. Botón "Pasar a Codex" → AgentDeck genera capsule con plan + scope + prohibiciones + comandos permitidos.
3. Copy-to-clipboard del handoff + launch de Codex.
4. OpenClaw puede leer el mismo handoff para ejecutar comandos.

**Contenido del handoff**:
- Estado actual (git branch, último commit, archivos modificados).
- Decisiones tomadas (de timeline).
- Archivos tocados.
- Pendientes.
- Riesgos señalados.
- Siguiente prompt recomendado (autogen por plantilla).

### 22.4 Spec Lock
- Cada proyecto tiene una `active_spec_id`.
- Cuando una sesión inicia, se evalúa scope: `allowed_paths`, `allowed_commands`, `forbidden_patterns`.
- File watcher (chokidar) detecta cambios; si fuera de scope → warning.
- Comandos stdin interceptados contra lista.
- **No bloquea automáticamente** salvo que el usuario active "strict mode". Default: warning visible.

### 22.5 Command Risk Scoring
Niveles:
- **safe**: no muta estado persistente (`ls`, `git status`, `cat`).
- **moderate**: muta estado local pero reversible (`git commit`, `npm install`).
- **dangerous**: muta estado potencialmente irreversible (`git push`, `git merge`).
- **destructive**: irreversible y con radio grande (`rm -rf`, `git reset --hard`, `drop`, `truncate`, `chmod -R 777`, `mv` a paths críticos, `curl | sh`).

Patrones iniciales (no exhaustivos):
```
rm\s+-rf|rm\s+-fr     → destructive
git\s+reset\s+--hard  → destructive
git\s+clean\s+-fd     → destructive
git\s+push\s+-f       → dangerous
chmod\s+-R\s+777      → destructive
chown\s+-R            → dangerous
kill\s+-9\s+-1        → destructive
dd\s+if=              → destructive
mkfs\.                → destructive
curl.*\|\s*(sh|bash)  → dangerous
>\s*/dev/sd           → destructive
>\s*/etc/             → dangerous
drop\s+(database|table)  → destructive (si se detecta psql/sqlite/mysql en cwd)
truncate              → dangerous
```

### 22.6 Local AI Memory Map
Estructura por proyecto:
```
memory_map
  id, project_id, key, value_md, source, confidence, last_seen_at
```
`key` ejemplos: `stack.frontend`, `convention.imports`, `known_error.deps`, `restriction.no_new_deps`.
Alimentación:
- Manual (UI).
- Auto: heurísticas (detectar `package.json` → `stack.frontend=react|vue|...`).
- Agente (opcional): comando `Update memory map` que pide a Claude un resumen del proyecto y propone entries.

Uso: inyectado al Prompt Composer y al Agent Contract.

### 22.7 Project Health Radar
Checks (on-demand y al abrir proyecto):
- Git: branch, ahead/behind, dirty state, untracked count.
- Deps: `npm outdated` / `composer outdated`.
- Tests: existencia de `test/`, `tests/`, `__tests__/`, scripts `test*`.
- Docs: README, AGENTS.md, CLAUDE.md, specs/.
- Secrets risk: grep en archivos tracked por patrones, counts.
- Logs de AgentDeck: tamaño, antigüedad, comandos fallidos recientes.
- Score global 0-100 con breakdown.

### 22.8 Smart Prompt Composer
Wizard:
1. Proyecto → carga memory map + stack.
2. Objetivo → dropdown (`feature nueva`, `refactor`, `bugfix`, `review`, `migración`, `security`, `visual`).
3. Restricciones → checklist (`no new deps`, `no arch change`, `minimal diff`, `tests required`).
4. Agente destino → (`Claude`, `Codex`, `OpenClaw`) — algunos prompts se afinan por agente.
5. Preview del prompt → copy/save como spec.

### 22.9 Agent Budget Guard
- **Límites**: mensual global, por tool, por sesión.
- **Estimación**: para Claude con modelos conocidos, estima tokens de prompt y costo. Sin API, es estimación gruesa.
- **Alertas**: 50%, 80%, 100% del límite → notificación local.
- **Override**: usuario puede continuar aceptando el gasto.

### 22.10 Context Capsule
Genera markdown <= 3KB con:
- Proyecto + stack + path.
- Objetivo actual (desde Agent Contract si existe).
- Últimas 3 decisiones de timeline.
- Archivos relevantes recientes.
- Comandos útiles.
- Checklist de fase actual.
- Próximo paso.

Botón "Copy" y "Save to clipboard as plain text" para pegar directo al agente.

### 22.11 Mobile Command Mode
UI:
- Pantalla principal: grid de **cards de acciones** (Deploy, Pull latest, Status, Open Claude, Run tests).
- Tap → confirmación + ejecución en terminal asociada.
- Terminal accesible en segunda tab pero no primary.
- Teclado auxiliar: barra sticky encima del keyboard iOS con Esc, Tab, Ctrl, Alt, arrows, `|`, `&&`, `/`, `-`, `~`, `.`.
- Snippets rápidos: barra horizontal scrollable con `git pull`, `npm run dev`, `codex`, `claude`.
- Modo "solo acciones" (sin terminal visible): para cuando no quiero tipear nada.

### 22.12 Panic Button
- Shortcut global (si aplica en browser: `Ctrl/Cmd+Shift+P`).
- Botón visible siempre en topbar con icono claro.
- Tap → modal con conteo de sesiones a matar + "CONFIRM".
- Acciones: kill PTYs, invalidar web sessions, snapshot logs, trigger audit event.
- Recovery: servicio sigue vivo, solo hay que relogin.

### 22.13 Local-Only Trust Mode
- Setting `trust_mode: local_only`.
- Al boot, lista conexiones salientes esperadas (ninguna por default).
- Opción "Verify" que corre `lsof -i -P | grep LISTEN` y `netstat -an` comparando con expectativa.
- Avisa si alguna dep tiene telemetría conocida.
- Blocklist de deps con telemetría activa.

### 22.14 Agent Contract
Generado al iniciar sesión (opcional). Contiene:
- Objetivo (input usuario o plantilla).
- Alcance: paths permitidos, paths prohibidos.
- Comandos permitidos/prohibidos.
- Criterios de aceptación.
- Archivos sensibles (`.env`, `secrets/`, keys).
- Fase aprobada de la spec.

Ejemplo en markdown:
```markdown
# Agent Contract — sesión 2026-04-24 bugfix-login
**Objetivo**: arreglar validación de passphrase en `/auth/login`.
**Scope permitido**: apps/server/src/routes/auth/*, packages/shared/auth.ts.
**Scope prohibido**: migrations/, db/schema, UI, packages/risk.
**Comandos permitidos**: pnpm test, pnpm typecheck, git status/diff/add/commit.
**Prohibidos**: migraciones DB, cambios en drizzle schema, `npm install <nuevo>`.
**Criterios aceptación**: tests de auth pasan; no regresiones.
**Sensibles**: no tocar `.env` ni secrets/.
```

### 22.15 Diff Explainer
Post-sesión:
- Lee diff de git vs commit inicial de la sesión.
- Agrupa por archivo.
- Por cada archivo: intención inferida (heurística o prompt a agente), riesgo, relación con la spec, cómo revertir (`git checkout HEAD -- file` o `git revert`).
- Checklist de prueba generado.

### 22.16 Local Knowledge Packs
Paquetes zip/folder con:
- `prompts/` — prompts reusables.
- `specs/` — plantillas.
- `commands/` — tool commands preconfigurados.
- `checks/` — health checks adicionales.
- `rules/` — risk scoring ampliado.

Packs iniciales:
- `node-pack`, `react-pack`, `laravel-pack`, `oracle-plsql-pack`, `python-pack`, `devops-pack`, `academic-docs-pack`.

**Instalación**: archivo único JSON + assets; AgentDeck valida esquema y registra. Sin ejecución de código en MVP-plugin.

---

## 23. Simplificación extrema de UX

Filosofía: **"El usuario selecciona intención, no recuerda comandos."**

### 23.1 Command Palette (`Cmd/Ctrl+K`)
- Búsqueda fuzzy sobre: proyectos, acciones, specs, prompts, tool commands, settings.
- Ranking por uso reciente.
- Ejemplo: tipear "dev" → top hit "Start dev server · proyecto-x".

### 23.2 Acciones por intención
| Intención humana | Resultado |
|---|---|
| "Iniciar dev" | `npm run dev` o `composer run dev` o `php artisan serve` según stack |
| "Revisar cambios" | `git status && git diff` en viewport limpio |
| "Abrir con Claude" | spawn `claude` en cwd + inyecta context capsule |
| "Abrir con Codex" | spawn `codex` + capsule |
| "Probar" | script `test` del stack detectado |
| "Desplegar staging" | script configurado `deploy:staging` (con confirmación) |
| "Limpieza" | `git stash` o `git clean -n` (never `-f` sin confirmación) |

### 23.3 Favoritos
- Marcar acciones/comandos como favorites por proyecto.
- Sidebar del proyecto muestra top 5 favs.

### 23.4 Recientes
- Últimas 10 acciones ejecutadas, por proyecto y global.

### 23.5 Wizard SDD
- "Crear spec" → elige plantilla → pregunta 3-5 variables → genera `specs/nombre.md` → abre en editor.

### 23.6 Wizard sesión segura
- "Nueva sesión agente" → elige proyecto → elige agente → review Agent Contract → review comandos permitidos → arrancar.

---

## 24. Automatizaciones locales

Para cada una: trigger, revisa, muestra, requiere permiso, riesgo de falsos positivos.

| # | Auto | Trigger | Revisa | Muestra | Permiso | FP risk |
|---|---|---|---|---|---|---|
| 1 | Auto git status al abrir proyecto | Abrir detalle de proyecto | `git status -s` | Badge con count dirty/untracked | No (read-only) | Bajo |
| 2 | Detectar stack | Alta o refresh | `package.json`, `composer.json`, `artisan`, `pyproject.toml`, `go.mod` | Chip de stack | No | Bajo |
| 3 | Listar scripts disponibles | Idem | `package.json.scripts` | Lista en panel de acciones | No | Bajo |
| 4 | Detectar CLAUDE.md / AGENTS.md | Idem | `fs.stat` | Link "Open file" | No | Nulo |
| 5 | Sugerir crear specs si no hay | Detalle sin `specs/` | Ausencia de carpeta | Banner sugerencia | No (sugerencia) | Bajo |
| 6 | Alerta al tocar `.env` | Antes de comando con `.env` en args o edit de archivo `.env*` | Regex en command line + fs event | Modal warning | **Sí** (confirmación) | Medio (match por nombre) |
| 7 | Alerta cambios sin commit antes de sesión agente | Start agent session | `git status --porcelain` | Modal "dirty, ¿continuar?" | Sí | Bajo |
| 8 | Snapshot pre-destructivo | Command Risk Scorer nivel `destructive` | Toma snapshot git stash + lista archivos | Confirma y crea stash etiquetado | Sí | Bajo |
| 9 | Bitácora auto de sesión | Session end | timeline events | Markdown en `.agentdeck/bitacora/` | Sí (opt-in global) | Bajo |
| 10 | Resumen final de sesión | Session end | eventos | Notificación + opción de copiar resumen | Sí | Bajo |
| 11 | Prompt de continuación | Session end con estado incompleto | timeline + pendientes | Plantilla lista para pegar | Sí | Bajo |
| 12 | Detectar dirty state antes de panic | Panic button | git status | Pide confirmar stash antes de matar | Sí | Bajo |
| 13 | Alerta de idle terminal | 30 min sin input | PTY activity | Toast | No | Bajo |
| 14 | Alerta de log crecimiento | Log > 100MB por proyecto | tamaño DB | Sugiere rotación | No | Bajo |

---

## 25. Experiencia desde celular

### 25.1 Funcional en celular (cómodo)
- Ver estado de proyectos, sesiones activas.
- Lanzar comandos pre-definidos (Mobile Command Mode).
- Leer logs y audits.
- Kill de sesiones.
- Panic button.
- Editar specs cortas.
- Copiar capsules y prompts.

### 25.2 Funcional pero incómodo
- Editar código real.
- Sesiones largas de terminal (viable con teclado auxiliar, pero cansa).
- Crear specs complejas desde cero.

### 25.3 No funcional / no recomendado
- Sesiones prolongadas de Codex/Claude (preferir Mac para eso, celular como monitor/remote control).
- Debugging complejo.
- Edición de diagramas.

### 25.4 Diseño concreto móvil
- Sidebar → bottom nav de 5 items: Home, Projects, Terminal, Tools, Settings.
- Tipografía mínima 14px, touch targets 44pt.
- Teclado auxiliar sticky (ver §22.11).
- Portrait: terminal + botonera inferior.
- Landscape: terminal fullscreen, bar flotante colapsable.
- Confirmaciones: modal fullscreen, textbox "CONFIRM".
- Hover → no se usa; todo está con tap o long-press con ayuda visual.
- Gestos: swipe horizontal entre tabs, swipe down para cerrar modales.
- Accesibilidad: tamaño de texto dinámico, contraste AA.
- iPad específico: split view soportado; dos tabs con dos terminales en landscape.

---

## 26. Arquitectura para extensiones / plugins

Diseño conceptual, **no implementar en MVP**.

### 26.1 Descriptor de plugin
```json
{
  "id": "agentdeck-plugin-codex",
  "name": "Codex CLI",
  "version": "0.1.0",
  "license": "MIT",
  "detector": {
    "binary": "codex",
    "version_command": "codex --version",
    "auth_command": "codex auth status"
  },
  "commands": [
    { "id": "codex.start", "label": "Open Codex", "template": "codex", "risk": "moderate" },
    { "id": "codex.resume", "label": "Resume Codex", "template": "codex resume", "risk": "moderate" }
  ],
  "dangerous_patterns": ["codex --unsafe"],
  "prompt_templates": [
    { "id": "codex.feature", "file": "prompts/feature.md" }
  ],
  "health_checks": [
    { "id": "codex.authenticated", "command": "codex auth status", "expect": "ok" }
  ],
  "masked_fields": ["CODEX_API_KEY", "OPENAI_API_KEY"],
  "relevant_files": [".codex/", "codex.config.json"]
}
```

### 26.2 Modelo de plugin
- **MVP-plugin (fase 3)**: descriptor JSON + assets estáticos. **No ejecución de código de plugin**. AgentDeck interpreta el descriptor.
- **V2 plugin (post-open-source)**: workers en sandbox, sin acceso al FS salvo por API permitida.

### 26.3 Plugins iniciales (descriptores, no código)
- Codex CLI
- Claude Code
- OpenClaw
- Git
- GitHub CLI
- Railway CLI
- Laravel
- Node / React
- Oracle PL/SQL
- Docker

### 26.4 Instalación
- Archivo `.agentdeck-plugin.json` + carpeta hermana.
- `agentdeck plugin install <path>` o UI en Settings > Plugins.
- Validación de schema + firma opcional.

---

## 27. Observabilidad local

Sin telemetría cloud.

- **Logs** en SQLite con rotación (compactación zstd opcional, default 30d retención).
- **Audit trail** append-only.
- **Métricas de sesión**: duración, comandos ejecutados, exit codes, riesgo máximo encontrado.
- **Consumo básico**: `ps` del PID de AgentDeck + PIDs hijos; visible en Settings > Status.
- **Tamaño de logs**: visible en dashboard.
- **Eventos de seguridad**: login fail, lockout, comando destructive, panic, cambio de setting sensible.
- **Export**: JSON/CSV desde UI + CLI `agentdeck export --since <date>`.

Opt-in en fase 2: **OpenTelemetry local-only** (collector en loopback, no exporter externo). Útil si el usuario quiere integrar con herramientas propias.

---

## 28. Política de datos y privacidad

### 28.1 Qué guarda AgentDeck
- Projects (nombre, path, notas).
- Terminal sessions metadata (pid, state, duración).
- Command logs con masking.
- Prompts/specs creados.
- Expenses manuales.
- Settings.
- Audit logs.
- Auth: solo hash de passphrase.

### 28.2 Dónde
- SQLite en `~/Library/Application Support/AgentDeck/agentdeck.db` (macOS).
- Config en `~/Library/Application Support/AgentDeck/config.json`.
- Logs grandes en `~/Library/Logs/AgentDeck/` (rotados).
- Nada en iCloud ni en cualquier ruta sincronizada por default.

### 28.3 Qué NUNCA guarda
- Passphrase en claro.
- Tokens de API de terceros.
- Contenido de `.env`.
- Stdout completo por default (solo previews masked).
- PII de terceros.

### 28.4 Cómo enmascara secretos
- Regex patrones conocidos (AWS, GitHub, Anthropic, OpenAI, Railway, Stripe, generic Bearer/JWT).
- Fallback: strings alfanuméricos largos (>32 chars) con entropía alta → `****`.
- Masker puro y testeado con corpus (ver §18).

### 28.5 Cómo borrar historial
- UI: Settings > Privacy > "Delete all logs older than X", "Delete all session logs", "Delete expense history", "Factory reset".
- CLI: `agentdeck purge --logs --older-than 30d`.

### 28.6 Cómo exportar
- JSON/CSV por módulo.
- Full backup cifrado (zip + passphrase) en fase 6.

### 28.7 Cómo hacer backup
- Manual: copy del folder de Application Support.
- Automático en fase 6: snapshot SQLite con `VACUUM INTO` + rotación.

### 28.8 Proyectos privados (laborales, confidenciales)
- Toggle "Private project" → no aparece en dashboard agregado; logs aislados; no se incluyen en exports globales.
- Confirmación doble antes de cualquier export que incluya proyectos privados.

---

## 29. Licenciamiento y estrategia open source futura

> **Nota**: no es asesoría legal. Es recomendación técnica informada. Para decisiones legales formales, consultar abogado (más si hay empleador o contratos NDA involucrados).

### 29.1 ¿Qué significa que el repo sea privado por ahora?
Privado en GitHub = solo tú y colaboradores invitados ven el código. No hay implicación de licencia automáticamente. El código sigue siendo tuyo (o de tu empleador según contrato laboral — revisar con cuidado si hay IP assignment).

### 29.2 Qué implica no agregar licencia todavía
Mientras el repo es privado: **ninguna implicación práctica**. Nadie más tiene acceso.

Pero **si abrís el repo a público sin licencia**:
- El código es visible pero legalmente **"all rights reserved"** — nadie puede copiar, modificar ni usar salvo fair use (que en software es estrecho).
- No cumple la definición de open source de OSI.
- Gente que contribuya sin licencia clara crea ambigüedad legal compleja.
- Recomendación: **no hacer el repo público sin licencia definida**.

### 29.3 Qué pasa si publicás sin licencia
- El repo será visible pero **no reutilizable legalmente**.
- La gente no contribuirá (no saben qué permisos tienen).
- En algunos casos genera mala percepción comunitaria.

### 29.4 Licencia recomendada cuando decidas abrirlo

**Recomendación principal: `Apache-2.0`.**

Razones para AgentDeck específicamente:
- **Protección explícita de patentes**: si alguna dep o contribuyente tiene patentes relacionadas, Apache-2.0 otorga licencia recíproca de uso. MIT no lo hace explícito.
- **Atribución clara**: requiere mantener `NOTICE` si existe.
- **Aceptación empresarial alta**: empresas grandes pueden adoptar sin fricción legal (a diferencia de GPL/AGPL).
- **Compatibilidad**: puede combinarse con MIT, BSD. Solo cuidado con GPL-2.0.

### 29.5 Diferencia práctica entre MIT, Apache-2.0, GPL-3.0, AGPL-3.0

| Criterio | MIT | Apache-2.0 | GPL-3.0 | AGPL-3.0 |
|---|---|---|---|---|
| Permite uso comercial | Sí | Sí | Sí | Sí |
| Requiere abrir modificaciones | No | No | Sí (derivadas que distribuís) | Sí (incluso si corre como servicio en red) |
| Otorga licencia de patentes | Implícita/débil | Explícita | Explícita | Explícita |
| Compatible con deps permisivas | Muy compatible | Muy compatible | Menos | Menos |
| Requiere atribución | Sí | Sí + NOTICE si aplica | Sí | Sí |
| Copyleft | No | No | Fuerte | Muy fuerte (network) |
| Aceptación por empresas | Máxima | Muy alta | Selectiva | Baja |
| Adecuación para AgentDeck | Alta | **Alta — recomendada** | Media-baja | Baja |

### 29.6 ¿Cuál para AgentDeck?
Priorizás:
- **Uso amplio**: MIT o Apache-2.0.
- **Protección legal propia**: Apache-2.0 (patentes + NOTICE).
- **Adopción empresarial**: Apache-2.0 o MIT.
- **Evitar ambigüedad**: Apache-2.0 (más explícita en términos).
- **Recibir contribuciones**: Apache-2.0 (DCO o CLA opcional).

**Veredicto**: **Apache-2.0**. MIT es válida y más corta pero pierde protección de patentes, que vale la pena para una herramienta que toca agentes IA (espacio legal aún inmaduro).

### 29.7 ¿Apache-2.0 por patentes?
**Sí**, argumento principal. El código va a integrar con productos comerciales (Codex/Claude/OpenClaw). Una licencia con grant de patentes explícito cubre un escenario donde un contribuyente tenga patente y luego reclame. MIT no lo cubre explícitamente.

### 29.8 ¿AGPL demasiado restrictiva para LAN tool?
**Sí**, para AgentDeck es excesiva. AGPL exige que si corrés el software como servicio y alguien lo usa a través de la red, tenés que entregar el source completo a esos usuarios. En LAN uno a uno es manejable, pero:
- Asusta a empresas que querrían adoptar.
- Si algún día se corre en infra compartida, complica.
- No hay ventaja fuerte para AgentDeck: el producto es para el dueño del Mac, no para operar como SaaS.

**AGPL tiene sentido** cuando el modelo de negocio esperado es "open core + servicio hosted vendido" (ej: MongoDB pre-SSPL, Plausible Analytics). No es tu caso.

### 29.9 ¿SPDX identifiers?
**Sí**. Práctica estándar:
```
// SPDX-License-Identifier: Apache-2.0
```
En cada archivo `.ts/.tsx/.sql` cuando se abra el repo. Herramientas como `license-checker` y SBOMs lo leen. Evita ambigüedad.

### 29.10 Archivos a preparar desde ahora (privado)

Mientras es privado:
- `README.md` (draft minimal).
- `SECURITY.md` (contacto y disclosure interno).
- `PRIVACY.md` (qué datos guarda y dónde).
- `LICENSE_DECISION.md` (nota: "privado por ahora; plan: Apache-2.0 al abrir"; incluye fecha y criterios para decidir).
- `CONTRIBUTING_DRAFT.md` (borrador que el equipo interno usa; sirve de base para público).
- `ROADMAP.md` (fases).
- `docs/architecture.md`, `docs/security-model.md`, `docs/plugin-system.md`.

**No agregar `LICENSE` todavía**. Agregarla implica compromiso público.

**No aceptar contribuciones externas** mientras no haya licencia.

---

## 30. Archivos legales y comunitarios

### 30.1 Mientras sea privado

| Archivo | Contenido |
|---|---|
| `README.md` | Qué es, cómo correr, advertencia privado |
| `SECURITY.md` | Cómo reportar (canal interno), versiones soportadas internas |
| `CONTRIBUTING_DRAFT.md` | Pautas para tí, rebase workflow, commit conventions, PR template futuro |
| `LICENSE_DECISION.md` | Nota: privado → plan Apache-2.0, criterios para abrir (feature completeness, cleanup, sin secretos, auditoría de deps) |
| `PRIVACY.md` | Qué guarda y dónde (ver §28) |
| `ROADMAP.md` | Fases 0-7+ (ver §17) |
| `docs/architecture.md` | Arquitectura v1 (de §3) |
| `docs/security-model.md` | Modelo de seguridad (§6) |
| `docs/plugin-system.md` | Descriptor de plugins (§26) |

### 30.2 Al abrir como open source

| Archivo | Contenido |
|---|---|
| `LICENSE` | Texto completo Apache-2.0 |
| `CONTRIBUTING.md` | Pautas públicas: cómo setear dev, cómo correr tests, cómo abrir PR, DCO/sign-off requerido |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 (estándar) |
| `SECURITY.md` definitivo | `security@<dominio>` o GitHub Security Advisories, política de disclosure, versiones soportadas |
| `GOVERNANCE.md` (si aplica) | Quién toma decisiones. Si sos tú solo, modelo BDFL al inicio. |
| `NOTICE` (si Apache-2.0 lo amerita) | Atribuciones requeridas |
| `THIRD_PARTY_NOTICES.md` | Lista de deps con sus licencias y textos |
| `SBOM` (SPDX o CycloneDX) | Generado con `syft` o `cyclonedx-npm` |
| `.github/ISSUE_TEMPLATE/` | bug.yml, feature.yml |
| `.github/PULL_REQUEST_TEMPLATE.md` | Checklist: tests, docs, security, license |
| `.github/workflows/` | CI tests, lint, audit, license-check |

---

## 31. Manejo de dependencias y licencias de terceros

### 31.1 Estrategia
- Preferir deps con licencias **permisivas** (MIT, Apache-2.0, BSD, ISC).
- **Evitar** deps con licencias copyleft fuertes (GPL, AGPL, LGPL con restricciones) salvo que estén aisladas y no se linkeen estáticamente.
- **Documentar** cada dep crítica con propósito + licencia en `THIRD_PARTY_NOTICES.md`.
- **Herramientas**:
  - `license-checker` o `license-checker-rseidelsohn` para npm.
  - `@cyclonedx/cdxgen` para SBOM.
  - `npm audit` en CI.
  - `socket.dev` o `snyk` opcionales.

### 31.2 Impacto por dep del stack

| Dep | Licencia | Riesgo | Acción |
|---|---|---|---|
| **xterm.js** | MIT | Ninguno | Usar directo |
| **node-pty** | MIT | Ninguno; requiere build nativo | Documentar build; considerar fork `@lydell/node-pty` si problemas |
| **React** | MIT | Ninguno (ya sin cláusula patent vieja) | Usar directo |
| **Fastify** | MIT | Ninguno | Usar directo |
| **Tailwind** | MIT | Ninguno | Usar directo |
| **shadcn/ui** | MIT (código copiado al repo) | Ninguno — no es dep runtime | OK |
| **Monaco Editor** | MIT | Bundle grande; verificar que no trae trackers | Lazy-load + revisar build |
| **better-sqlite3** | MIT | Build nativo | Documentar |
| **Drizzle** | Apache-2.0 | Ninguno | Preferida |
| **Zod** | MIT | Ninguno | OK |
| **argon2** (node-argon2) | MIT | Build nativo | OK |
| **ws** | MIT | Ninguno | OK |
| **Vite** | MIT | Ninguno | OK |
| **Playwright** | Apache-2.0 | Ninguno | OK |
| **Biome** | MIT + Apache-2.0 dual | Ninguno | OK |

### 31.3 Reglas operativas
- Antes de agregar dep nueva: `license-checker --package <name>` + revisar repo.
- Regenerar `THIRD_PARTY_NOTICES.md` y SBOM en cada release.
- Bloquear deps con licencias problemáticas en CI.
- Versiones pinneadas con lockfile; `npm audit` limpio.

---

## 32. Modelo de negocio futuro (opcional)

Compatible con filosofía local-first y sin convertir en cloud.

| Modelo | Compatibilidad licencia | Viabilidad |
|---|---|---|
| **Open core** | Apache-2.0 OK (enterprise features en repo separado con licencia comercial) | Alta |
| **Donaciones** (GitHub Sponsors, OpenCollective) | Cualquier licencia | Alta |
| **Sponsors empresariales** | Cualquier licencia | Media |
| **Versión local gratuita + enterprise self-hosted** | Open core | Media-alta |
| **Plugins premium** | Core Apache-2.0, plugins con licencia comercial propia | Alta |
| **Consultoría / soporte** | Cualquier licencia | Alta |
| **Plantillas profesionales (packs premium)** | Cualquier licencia | Media-alta |
| **Edición enterprise self-hosted** | Open core / dual licensing | Media |

**Incompatible con licencia permisiva**: vender como SaaS cerrado es difícil de sostener si alguien puede forkear y ofrecerlo. Mitigación: trademark + marca + servicios.

**Incompatible con AGPL**: modelos de donación + consultoría siguen funcionando, pero adopción empresarial cae.

**Recomendación**: Apache-2.0 + open core (core abierto, plugins/packs premium) + consultoría. Es el patrón de productos como Gitea, Supabase, Cal.com.

---

## 33. Roadmap innovador

### Horizonte 1 — MVP útil (semanas 1-6)
**Debe resolver**: terminal web local, proyectos, comandos rápidos, logs, seguridad básica.
- Login local + bindings + CSRF + rate limit.
- Proyectos CRUD + path validation.
- Terminal embebida + xterm + node-pty + WS.
- Quick commands Codex/Claude/OpenClaw/git.
- Logs básicos + masking.
- Panic button.
- Command Risk Scoring mínimo (blacklist).
- **Delivery**: Mac con AgentDeck corriendo, iPhone accede y trabaja.

### Horizonte 2 — Productividad IA (semanas 7-14)
**Debe resolver**: SDD Center, Prompt Composer, Agent Contracts, Context Capsules, Diff Explainer básico.
- SDD Center con plantillas.
- Prompt Library con variables.
- Agent Contract auto-generado.
- Context Capsule.
- Smart Prompt Composer wizard.
- Monaco minimal para specs.
- Health Radar inicial.
- Mobile Command Mode v1.

### Horizonte 3 — Control avanzado (semanas 15-24)
**Debe resolver**: Timeline, Session Replay, Budget Guard, Health Radar completo, Spec Lock, plugins (descriptor).
- Timeline events registrados por todo el sistema.
- Session Replay textual.
- Budget Guard.
- Project Health Radar completo.
- Spec Lock con watcher.
- Diff Explainer completo.
- Memory Map.
- Plugin descriptor loader (sin sandbox aún).

### Horizonte 4 — Comunidad / open source (semana 25+)
**Debe resolver**: licencia, docs, contribuciones, plugin API estable, seguridad pública, releases.
- Auditoría de seguridad externa.
- SBOM, THIRD_PARTY_NOTICES.
- Apache-2.0 aplicada con SPDX.
- README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY publicados.
- Release v1.0 público.
- Plugin API v1 con sandbox (workers).
- Packs de conocimiento iniciales.

---

## 34. Priorización brutal

### Must-have (bloqueante para V1)
- Auth local + passphrase + lockout.
- Binding IP configurable + TLS self-signed cuando no-loopback.
- CSRF + CORS + Origin check WS.
- Proyectos CRUD.
- Terminal embebida funcional.
- Quick commands Codex/Claude/OpenClaw.
- Command Risk Scoring (mínimo blacklist).
- Secret masker en logs.
- Panic button.
- Warning de exposición LAN.
- Mobile: layout responsive + teclado auxiliar.

### Should-have (fase 2)
- Monaco minimal.
- Smart Prompt Composer.
- Agent Contract.
- Context Capsule.
- Tmux opcional.
- Health Radar v1.
- SDD Center con plantillas.

### Could-have (fase 3-4)
- Session Replay.
- Timeline completo.
- Budget Guard.
- Spec Lock con watcher.
- Diff Explainer.
- Memory Map.
- Plugins descriptor.

### Not now (fase futura o nunca)
- code-server embebido.
- IDE completo.
- Ejecutor de prompts multi-agente con orquestación.
- Cloud sync.
- Cuentas multi-usuario.
- WebAuthn.
- Marketplace de plugins.

### Tentadoras pero peligrosas para MVP
- **Timeline completo**: tentador porque habilita Replay/Capsule, pero su scope correcto requiere instrumentar casi todos los servicios. Si se mete al MVP, se come dos semanas y atrasa lo core.
- **Plugin system completo**: tentador para "extensibilidad", pero meter sandbox complejo antes de validar producto es premature optimization.
- **Budget Guard con estimación**: requiere parsers por modelo; mejor manual V1.
- **Monaco con edición completa**: tentador "porque está disponible", pero abre scope IDE y distrae.
- **Multi-user**: AgentDeck es mono-usuario. Agregar multi-user rompe modelo de seguridad.
- **Tmux**: mejora UX pero agrega dependencia externa y modelo mental; MVP sin tmux es correcto.

---

## 35. Primer experimento innovador

Un experimento pequeño, alto impacto, bajo riesgo, que valide la **identidad** de AgentDeck (no solo "abrir terminal").

### Propuesta: **"Terminal + Agent Contract + Context Capsule"** combo

**Objetivo**: al abrir una terminal de proyecto, AgentDeck auto-genera:
1. Un **Agent Contract** mínimo (plantilla base con scope y prohibiciones a completar).
2. Un **Context Capsule** copiable (resumen del proyecto + git status + stack + últimos comandos).
3. Un **botón** que inyecta ambos en el shell al iniciar un agente (`claude --print` con contrato, o pega en clipboard).

### Implementación conceptual
- Al crear sesión → corre `git status --porcelain`, detecta stack, lee `CLAUDE.md` si existe.
- Abre un overlay pre-terminal con:
  - `[Agent Contract]` editable (textbox con plantilla).
  - `[Context Capsule]` generado (read-only, botón copy).
  - `[Start Session]` con checkbox "Inject contract to Claude".
- Si se selecciona inject → spawn Claude con prompt que incluye el contrato.

### Criterios de éxito
- El overlay se genera en ≤1s tras tap "New session".
- El contrato es útil tal cual (probado con 1 sesión real de bugfix).
- El capsule copiado a clipboard y pegado en Claude reduce preguntas de contexto iniciales en ≥50%.
- El usuario percibe valor distinto vs abrir terminal cruda.

### Qué NO incluir (mantener acotado)
- No Spec Lock en este experimento.
- No Timeline completo — solo un campo "last command" del proyecto.
- No Diff Explainer.
- No Budget Guard.
- No Monaco — el textbox es `<textarea>`.

### Tiempo estimado
1-3 días de trabajo serio, asumiendo auth + proyectos + terminal ya funcionando.

### Valor que valida
Si este experimento funciona: AgentDeck no es una terminal web, es un **gobernador local de agentes IA**. Ese es el diferenciador real. Si falla (sensación de fricción vs valor), se revisa el enfoque antes de invertir en Timeline/Replay/etc.

---

---

## Bonus — panel de instalación macOS

(Este punto estaba en el brief original fuera de las 35 secciones. Se documenta acá para cerrar.)

Un script idempotente `scripts/install-macos.sh` que:
1. Verifica Node 22+ instalado. Si no, sugiere `brew install node`.
2. Verifica `pnpm` instalado. Si no, `corepack enable`.
3. Clona/descarga AgentDeck (cuando se distribuya).
4. Ejecuta `pnpm install` con auditoría de licencias.
5. Genera certificado self-signed si el usuario quiere TLS (opcional `mkcert` si está instalado).
6. Pide passphrase inicial, la hashea, la guarda.
7. Crea `launchd` plist opcional para auto-start al login (`~/Library/LaunchAgents/com.agentdeck.plist`).
8. Abre `http://127.0.0.1:8787/login` en el browser.
9. Imprime IP LAN sugerida para acceder desde iPhone.
10. Ofrece desinstalar limpio: `uninstall-macos.sh`.

**UI dentro del producto**: Settings > Installation muestra:
- Versión instalada.
- Path de DB + logs.
- Estado de launchd.
- Botón "Re-generate TLS cert".
- Botón "Check for updates" (opt-in; verifica en GitHub releases cuando sea público).
- Botón "Factory reset" con confirmación triple.

---

## Cierre — validación interna

**Pregunta a validar antes de responder**: ¿permite el plan ejecutar una **terminal real desde el navegador usando xterm.js + WebSocket + node-pty**, y el MVP es **suficientemente pequeño** para construirse por fases?

**Respuesta**:
- **Terminal real**: sí. Arquitectura §3 + flujo §7.1 lo describe de punta a punta.
- **MVP pequeño**: sí, 9 features core (§5), construible en 2-4 semanas de trabajo serio. Fase 0 de spike (1 día) valida técnica antes.

El plan está **listo para ser ejecutado**. No se ha escrito código, no se ha instalado nada, no se han generado archivos del producto. Solo este plan.

**Siguiente acción recomendada**: Fase 0 — spike técnico de 1 día (ver §17 y §20).

---

*Fin del superplan v1. Actualizar con fecha y versión al modificar.*
