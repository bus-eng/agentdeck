# AgentDeck — Guía de Configuración

> Configuración en menos de 2 minutos para usuarios Mac (técnicos y no técnicos).

## Requisitos

| Requisito | Versión mínima | Cómo verificar |
|---|---|---|
| **macOS** | 12+ (Monterey o superior) | `苹果` → "Acerca de este Mac" |
| **Node.js** | 22+ | `node --version` en Terminal |
| **Navegador** | Safari, Chrome, Edge | — |

> Si no tienes Node 22+, consulta la sección [Instalar Node](#instalar-node) más abajo.

## Instalación Express (1 minuto)

Abre **Terminal.app** y ejecuta:

```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/1-EnCurso/Programacion/code/agentdeck/agentdeck
npm run setup
```

Este comando hace TODO automáticamente:
1. Verifica Node 22+
2. Instala las dependencias (`npm install`)
3. Instala el servicio de auto-inicio (launchd)
4. Inicia el servidor

Al finalizar verás:

```
╔═══════════════════════════════════════════════════════╗
║           ✅ AgentDeck instalado                    ║
╠═══════════════════════════════════════════════════════╣
║  🌐 Local:    http://127.0.0.1:8787                  ║
║  🌐 Red LAN:  http://192.168.x.x:8787                ║
║  🌐 mDNS:     http://agentdeck.local:8787             ║
║  🔑 Contraseña: agentdeck-dummy                        ║
╚═══════════════════════════════════════════════════════════════╝
```

**¡Listo!** Abre alguna de esas URLs en tu navegador.

---

## Cómo usar AgentDeck

### Desde otra Mac en la misma red

1. Abre Safari o Chrome
2. Ve a `http://agentdeck.local:8787`
3. Ingresa la contraseña: `agentdeck-dummy` (o la que hayas configurado)

### Desde iPhone o iPad

1. Asegúrate de estar en el mismo Wi-Fi que tu Mac
2. Abre Safari
3. Ve a `http://agentdeck.local:8787`
4. Ingresa la contraseña

### Acceso avanzado: Terminal WebSocket

Si necesitas conectar una terminal manualmente:

```
ws://localhost:8787/ws/terminal
```

---

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm start` | Iniciar el servidor manualmente |
| `npm run service:status` | Ver si el servicio está corriendo |
| `npm run service:stop` | Detener el servicio |
| `npm run service:start` | Iniciar el servicio |
| `npm run service:restart` | Reiniciar el servicio |
| `npm run uninstall` | Desinstalar todo (servicio + archivos) |

---

## Cambiar la contraseña

1. Detén el servicio: `npm run service:stop`
2. Edita el archivo `.env`:

```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/1-EnCurso/Programacion/code/agentdeck/agentdeck
echo 'PASSPHRASE=tu-nueva-contraseña-segura' > .env
```

3. Inicia el servicio: `npm run service:start`

---

## Solución de problemas

### ❌ "command not found: npm"

Instala Node.js:

```bash
# Con Homebrew (recomendado)
brew install node

# O descarga desde https://nodejs.org
```

### ❌ "Error: @lydell/node-pty no load"

Ejecuta:

```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/1-EnCurso/Programacion/code/agentdeck/agentdeck
npm run rebuild
```

### ❌ "service already running"

Fuerza el reinicio:

```bash
npm run service:restart
```

### ❌ "agentdeck.local no carga"

1. Verifica que el servicio esté corriendo:

```bash
npm run service:status
```

2. Si dice "NOT running", inícialo:

```bash
npm run service:start
```

3. Si sigue sin funcionar, reinicia la Mac y ejecuta:

```bash
npm run setup
```

### ❌ "La página no carga desde iPhone"

1. Asegúrate de estar en el **mismo Wi-Fi** que la Mac
2. Prueba con la IP de red en lugar de mDNS:

```bash
# En la Mac, ejecuta:
ipconfig getifaddr en0
```

Copia esa IP (algo como `192.168.1.100`) y úsala en el iPhone: `http://192.168.1.100:8787`

### ❌ "Error de conexión" en WebSocket

El servicio debe estar corriendo. Ejecuta:

```bash
npm run service:start
```

---

## Instalar Node.js

### Opción 1: Homebrew (recomendado)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

### Opción 2: Installer oficial

1. Ve a https://nodejs.org
2. Descarga **LTS** (versión con número par)
3. Abre el archivo `.pkg` y sigue los pasos

---

## Desinstalar completamente

```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/1-EnCurso/Programacion/code/agentdeck/agentdeck
npm run uninstall
```

Esto elimina:
- El servicio de auto-inicio
- Los logs
- La configuración

Los archivos del proyecto permanecen.

---

## Dónde obtener ayuda

- **Issues técnicos**: Abre un issue en el repo
- **Soporte general**: Consulta este documento o pregunta directamente

---

## Appendix: Variables de entorno opcionales

Crea un archivo `.env` en la raíz del proyecto:

```bash
# Configuración por defecto
HOST=0.0.0.0
PORT=8787
PASSPHRASE=agentdeck-dummy
MDNS_HOSTNAME=agentdeck.local
```

---

© 2026 Roberto Bustamante. Código privado.