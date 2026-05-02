# AgentDeck — Centro de Mando Inteligente

![AgentDeck](agentdeck-main.png)

AgentDeck es un centro de mando local para operar proyectos técnicos desde el celular. Combina gestión visual de proyectos (Decks), terminal remota controlada, chat contextual con IA y acciones guiadas.

Corre en tu Mac y se accede desde cualquier dispositivo en la misma red (iPhone, iPad, laptop) vía navegador.

## Stack

- **Runtime**: Node.js >= 22
- **Backend**: Fastify 5 + WebSocket + node-pty
- **DB**: SQLite (better-sqlite3 + Drizzle ORM)
- **Frontend**: HTML/CSS/JS estático (Tailwind v4 CDN), xterm.js
- **Red**: mDNS local (`agentdeck.local`), solo LAN

## Quick start

```bash
git clone <repo> && cd agentdeck/agentdeck
npm install && npm run setup && npm run start
# → http://127.0.0.1:8787
```

## Estructura

```
agentdeck/
  server.ts          — servidor Fastify + WebSocket + rutas
  public/            — frontend estático (login, settings, index)
  src/
    db/              — Drizzle schema + SQLite
    deck.ts          — Deck model, health score, checkpoints
    routes/          — API routes (projects, etc.)
    fs-browse.ts     — navegación filesystem con jail
    guardrails.ts    — clasificador de riesgo de comandos
  scripts/           — setup, doctor, update, reset, service install
  data/              — base de datos local (no versionada)
```

## Comandos principales

| Comando | Descripción |
|---|---|
| `npm run dev` | Desarrollo con hot reload |
| `npm run start` | Producción |
| `npm run doctor` | Diagnosticar entorno |
| `npm run setup` | Setup completo + workspace |
| `npm run update` | Post-git-pull (deps + doctor) |
| `npm run reset-local` | Reparar configuración local |
| `npm run rebuild` | Recompilar node-pty nativo |

## Seguridad

- Puerto 8787, host `127.0.0.1` por defecto
- Autenticación por passphrase + cookie de sesión
- API keys en `~/.agentdeck/providers/` (local, no compartidas)
- Workspace sincronizable via iCloud (opcional)
- Rate limiting en WebSocket (60 msg/s por socket)
- Path sanitizado en navegación filesystem (jail al home)

© 2026 Roberto Bustamante. Todos los derechos reservados.
