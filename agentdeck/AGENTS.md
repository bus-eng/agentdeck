# AGENTS.md — Contexto para asistentes IA

Este archivo describe AgentDeck para que una IA pueda entender el proyecto, navegar el código y contribuir sin romper nada.

## Stack

- **Runtime**: Node.js >= 22, TypeScript (tsx para dev, tsc para build)
- **Backend**: Fastify 5 + @fastify/websocket + @fastify/static + @fastify/cookie + @fastify/multipart
- **Terminal**: @lydell/node-pty (nativo, requiere rebuild en cada install)
- **Base de datos**: better-sqlite3 + Drizzle ORM (modo synchronous)
- **Frontend**: HTML estático en `public/`, CSS con Tailwind v4 (CDN), xterm.js
- **Red**: mDNS local via multicast-dns

## Estructura del código

```
agentdeck/                  ← raíz de la app
  server.ts                 ← entry point (~860 lines)
  public/
    index.html              ← app principal (~6300 lines HTML+CSS+JS inline)
    login.html              ← login page
    settings.html           ← settings page (proveedores IA)
  src/
    db/
      index.ts              ← SQLite connection + Drizzle init
      schema.ts             ← Drizzle schema (decks, checkpoints, evidencePacks, etc.)
    deck.ts                 ← Deck model, health score, checkpoints, seed profiles
    fs-browse.ts            ← filesystem browser con jail (chroot virtual al HOME)
    guardrails.ts           ← clasificador de riesgo de comandos (regex-based)
    routes/
      projects.ts           ← CRUD projects API con Drizzle
  scripts/
    setup.mjs, doctor.mjs, update.mjs, reset-local.mjs, install-service.mjs
    lib/constants.mjs, logger.mjs, workspace.mjs
  data/                     ← SQLite DB local (creada en runtime, no versionada)
```

## Reglas sagradas (NO ROMPER)

### 1. NO tocar public/index.html sin autorización explícita
La UI ha sido meticulosamente ajustada (colores, espaciado, responsive mobile-first). Cualquier cambio que no sea bugfix puede romper la interfaz. Siempre preguntar antes.

Si se autoriza un cambio:
- Mantener mobile-first (320px-430px primary target)
- NO cambiar paleta de colores (variables CSS en `:root`)
- NO cambiar estructura del DOM (IDs, clases, anidamiento)
- NO agregar dependencias JS externas sin consultar

### 2. CRUD de proyectos: hay DOS sistemas
- **server.ts** (líneas ~400-450): sistema legacy con `projectsDB` (JSON file). Usa `randomUUID()`, paths absolutos.
- **src/routes/projects.ts**: sistema nuevo con Drizzle. Requiere middleware de auth (ver punto 4).

Ambos coexisten. El legacy es el que usa el frontend actual. NO migrar el frontend al nuevo sin probar exhaustivamente.

### 3. Base de datos
- Usar Drizzle ORM siempre que sea posible (type-safe).
- Si necesitás raw SQL (para migraciones o CREATE TABLE), seguí el patrón de `db.run(sql\`...\`)`.
- `schema.ts` define: decks, checkpoints, evidencePacks, agentProfiles, commandHistory.
- El server también crea `command_history` en raw SQL (línea 470).
- `PRAGMA foreign_keys = ON` está activado en `src/db/index.ts`.

### 4. Autenticación
- Basada en passphrase (variable `PASSPHRASE`, default `agentdeck-dummy`).
- Cookie de sesión (`ad_session`) con token random de 32 bytes.
- Helper `isAuthenticated(req)` chequea cookie válida.
- Las rutas en `src/routes/projects.ts` ahora tienen un hook `onRequest` que verifica auth.
- `secure: !ALLOW_LAN` en la cookie (secure solo si no es LAN).

### 5. WebSocket terminal
- Ruta: `/ws/terminal`
- Rate limiting: 60 mensajes/segundo por socket
- Formato mensaje: `{ t: "in"|"resize", d: string|object }`
- El PTY vive independiente del WebSocket (grace period para reconexión)
- `schedulePtyTermination(sess)` mata el PTY si no hay reconnect en N segundos

### 6. Filesystem browser
- Ruta: `/fs/browse?path=<path>&hidden=1`
- Usa `resolveBrowsePath()` que implementa jail: solo permite navegar dentro de `$HOME`.
- `browseDirectory()` retorna entradas con nombre, tamaño, fecha, tipo.
- Botón "Mostrar archivos ocultos" vía query param `hidden=1`.

### 7. Deck model (src/deck.ts)
- `ensureDeckForProject(project)`: crea deck si no existe.
- `calculateHealthScore(deck)`: 0-100 basado en errores, último éxito, actividad.
- `checkpointSystem`: cada checkpoint tiene id, deckId, label, tags, files, parentId (para diff).

### 8. Guardrails (src/guardrails.ts)
- Clasifica comandos por riesgo: safe, risky, dangerous, forbidden.
- Regex-based: detecta `rm -rf`, `dd`, `chmod 777`, `> /dev/sda`, etc.
- Función `classifyCommand(text)` retorna `{ level, reason, suggestion }`.

### 9. Settings / proveedores IA
- Ruta `/settings` muestra configuración de Anthropic, OpenAI, Google AI, OpenRouter.
- POST `/api/providers/configure` guarda API keys en `~/.agentdeck/providers/`.
- GET `/api/providers/status` retorna estado de cada proveedor.
- Las claves se muestran enmascaradas en la UI.

### 10. Scripts
- `npm run doctor`: diagnostica Node, deps, puerto, workspace, node-pty.
- `npm run setup`: instala deps, crea `.env.local`, detecta iCloud workspace, crea estructura de ejemplo.
- `npm run update`: git pull + npm install + doctor.
- `npm run reset-local -- --all` borra `~/.agentdeck/{providers,uploads,data}`.

## Convenciones de código

- Usar `import type` para imports de solo tipos.
- Los archivos `.ts` se importan como `.js` (para tsx runtime).
- Funciones flecha `const fn = () => {}` (no `function`).
- Preferir `for...of` sobre `forEach`.
- Las rutas Fastify usan `async (req, reply) =>`.
- Los mensajes de consola llevan prefijo `[ad]`.
 - Usar `let` solo cuando sea necesario, preferir `const`.
- Errores manejados con `try/catch` silencioso para no-logging (evitar leaks).
- Nombres de archivos en kebab-case: `fs-browse.ts`, no `fsBrowse.ts`.

## Principios de diseño

- Zero configuración para el usuario: todo debe funcionar con `npm run setup && npm run start`.
- Mobile-first: la UI prioriza pantallas de 320px-430px.
- Sin dependencia de cloud: todo corre local, 0 MVPs de servicios externos.
- La terminal es el núcleo: todo lo demás (chat, IA, acciones) es adorno sobre un shell real.
- Seguridad por aislamiento: no se expone a internet, solo LAN, autenticación obligatoria.

## Tests

```bash
npm test  # corre src/guardrails.test.ts con node --test
```

Usa `node:test` + `node:assert` (sin jest/vitest). Tests de guardrails con casos de riesgo conocidos.

## Errores comunes

- `node-pty` no compila → `npm run rebuild`
- Puerto ocupado → `lsof -ti:8787 | xargs kill`
- NaN en DB queries → `Number(id)` de string puede dar NaN, validar con `Number.isFinite`
- `.env.local` no existe → `npm run setup` lo crea
- El build (`tsc`) produce archivos `.js` en `dist/`, pero el server corre con `tsx` que resuelve `.ts` directo
