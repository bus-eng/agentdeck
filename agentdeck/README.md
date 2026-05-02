# AgentDeck — Centro de Mando Inteligente para Proyectos

AgentDeck combina:

- **gestión visual de proyectos** (Decks)
- **chat contextual con IA**
- **terminal remota controlada** (motor interno)
- **acciones guiadas y automatización**
- **experiencia mobile-first**

> No es un editor web, ni una terminal bonita. AgentDeck es un centro de mando tipo Deck OS para operar proyectos técnicos desde el celular.

---

## Instalación rápida

```bash
git clone <url-del-repo>
cd agentdeck
npm run setup
npm run start
```

Abrí en tu navegador:

- `http://127.0.0.1:8787` (local)
- `http://agentdeck.local:8787` (LAN, requiere configuración)

---

## Arquitectura de almacenamiento

AgentDeck separa tres espacios:

### 1. Instalación de la app

Repositorio/código fuente de AgentDeck. No incluye datos del usuario.

### 2. AgentDeck Home (`~/.agentdeck/`)

Datos internos no portables:

- `providers/` — credenciales de API keys (por usuario)
- `uploads/` — archivos subidos al chat
- `data/` — base SQLite local (proyectos, historial)
- `workspace/` — fallback si no hay iCloud

### 3. AgentDeck Workspace (sincronizable)

Datos portables del usuario pensados para sincronizarse via iCloud, Dropbox o OneDrive.

```
AgentDeck/           ← Ruta sugerida en macOS: iCloud Drive/AgentDeck
  Decks/             → Proyectos registrados (referencias, no copias)
  Recipes/           → Recetas de automatización
  Prompts/           → Plantillas de contexto para Claude, GPT, etc.
  Checkpoints/       → Snapshots de estado del proyecto
  Settings/          → Configuración portable del usuario
  Exports/           → Exportaciones de sesiones y reportes
```

**Qué NO se guarda en el workspace:**
- `node_modules`, `dist/`, builds, caches
- logs de servidor
- datos temporales de sesión
- credenciales ni tokens

---

## Comandos principales

| Comando | Qué hace |
|---------|----------|
| `npm run setup` | Setup completo (deps, .env.local, workspace, ejemplos) |
| `npm run start` | Iniciar servidor |
| `npm run dev` | Modo desarrollo con hot reload |
| `npm run build` | Compilar TypeScript |
| `npm run doctor` | Diagnosticar entorno local |
| `npm run update` | Actualizar repo + deps + doctor (post git pull) |
| `npm run reset-local` | Reparar configuración local (seguro) |
| `npm run reset-local -- --all` | Limpiar configuración y datos locales |

### Diagnóstico

```bash
npm run doctor
```

### Actualización después de git pull

```bash
npm run update
```

### Reparar configuración local

```bash
npm run reset-local
```

Para limpiar también datos locales (providers, uploads, data):

```bash
npm run reset-local -- --all
```

---

## Workspace sincronizable

### En macOS con iCloud

El setup detecta iCloud Drive y sugiere:

```
~/Library/Mobile Documents/com~apple~CloudDocs/AgentDeck
```

Como ruta del workspace. Asegurate de que iCloud Drive esté activo en Preferencias del Sistema → Apple ID → iCloud.

### Sin iCloud (fallback)

Si iCloud no está disponible, el setup usa `~/.agentdeck/workspace/`.

### Cambiar la carpeta del workspace

Editá `.env.local`:

```
AGENTDECK_WORKSPACE="/ruta/a/tu/workspace"
```

### Recuperar AgentDeck en otra máquina

1. Instalá Node.js 22+ y AgentDeck
2. Configurá iCloud Drive en la máquina nueva
3. Ejecutá `npm run setup`
4. El setup va a detectar iCloud y proponer la misma carpeta del workspace
5. Los decks, recetas y settings estarán disponibles automáticamente

---

## Configuración de proveedores IA

Una vez iniciada la app, entrá a `/settings` desde la app o hacé click en el botón `IA` del topbar para configurar claves de Anthropic, OpenAI, Google AI u OpenRouter.

---

## Seguridad

- Puerto por defecto: `8787`
- Host por defecto: `127.0.0.1` (solo acceso local)
- Para exponer en LAN: `AGENTDECK_ALLOW_LAN=true` en `.env.local`
- Todas las claves se guardan en `~/.agentdeck/providers/` (local, no en el workspace)
- Las claves se muestran enmascaradas en la UI

---

## Troubleshooting

### Puerto 8787 ocupado

```bash
lsof -ti:8787 | xargs kill
```

O cambiá el puerto en `.env.local`:

```
PORT=8788
```

### Node.js no encontrado o versión incorrecta

```bash
node --version   # debe ser >= 22
brew install node
```

### agentdeck.local no resuelve

- Solo funciona en macOS con mDNS habilitado (por defecto)
- Requiere `AGENTDECK_ALLOW_LAN=true`
- Usá `http://127.0.0.1:8787` como alternativa
- En redes corporativas, mDNS puede estar bloqueado

### Dependencias nativas (@lydell/node-pty)

```bash
npm run rebuild
```

### La app funciona en 127.0.0.1 pero no desde celular

1. Verificá que ambas estén en la misma red Wi-Fi
2. Configurá `AGENTDECK_ALLOW_LAN=true` en `.env.local`
3. Reiniciá el servidor
4. Probá con `http://<ip-local>:8787` (el doctor muestra la IP)

---

## Stack

- **Runtime**: Node.js >= 22
- **Package manager**: npm (package-lock.json)
- **Backend**: Fastify 5 + WebSocket
- **Terminal**: node-pty + xterm.js
- **Base de datos**: SQLite (better-sqlite3 + Drizzle ORM)
- **Frontend**: HTML/CSS/JS estático servido desde public/
