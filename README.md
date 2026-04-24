# AgentDeck

> **Private repo.** Diseño y código en desarrollo activo. No redistribuir ni usar como base sin autorización explícita del autor.

AgentDeck es una aplicación web **local** (corre en una Mac) que se accede desde cualquier dispositivo de la misma red — iPhone, iPad, otra laptop — vía `http://agentdeck.local:8787` (o `http://127.0.0.1:8787`).

Su razón de ser: ser un **centro de control local de agentes IA** (Codex CLI, Claude Code, OpenClaw y otros) encima de una terminal real, con proyectos guardados, comandos por intención, logs sanitizados, specs SDD y gobierno sobre qué pueden y qué no pueden hacer los agentes dentro de una sesión.

**No** es cloud. **No** es Electron/Tauri. **No** se expone a internet. Solo LAN.

## Estado actual

- `PLAN.md` — superplan técnico y funcional (35 secciones + estrategia de licencias).
- `dummy/` — spike ejecutable: Fastify + WebSocket + `@lydell/node-pty` + chat UI mobile-first. Sirve para validar el flujo end-to-end desde Safari iPhone contra un shell real en la Mac, antes de construir el v1 real con monorepo completo.

## Cómo correr el spike

Requisitos: Node ≥22, npm (o pnpm), macOS.

```bash
cd dummy
npm install
npm run dev
```

Al arrancar el server imprime tres URLs:

```
[ad] Local:  http://127.0.0.1:8787
[ad] LAN:    http://192.168.x.x:8787
[ad] mDNS:   http://agentdeck.local:8787  ← open this on iPhone/iPad/Mac
```

Passphrase por defecto: `agentdeck-dummy` (editable en `dummy/.env`, ver `.env.example`).

El usuario en el login es informativo; iCloud Keychain lo asocia a la contraseña para autocompletar en siguientes accesos.

## Licencia

Repo **privado**. No se ha asignado licencia todavía — el uso, copia o redistribución requieren autorización explícita del autor.

Plan a futuro (cuando se cumplan los prerequisitos legales del autor): abrir el proyecto bajo **Apache-2.0** con SPDX identifiers en cada archivo fuente.

## Contribuciones

Mientras el repo sea privado, **no se aceptan contribuciones externas**. Issues y PRs quedarán cerrados sin evaluar.

---

© 2026 Roberto Bustamante. Todos los derechos reservados.
