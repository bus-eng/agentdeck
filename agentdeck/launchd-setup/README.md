# AgentDeck — Servicio de Auto-inicio (launchd)

## Qué es launchd?

`launchd` es el sistema de macOS para iniciar servicios automáticamente cuando enciendes tu Mac. AgentDeck usa esto para iniciarse en segundo plano sin que tengas que ejecutar `npm start` manualmente cada vez.

## Cómo funciona

1. Al ejecutar `npm run setup` o `npm run service:install`, se crea un archivo de configuración en `~/Library/LaunchAgents/com.agentdeck.plist`
2. macOS lee este archivo y ejecuta AgentDeck automáticamente al iniciar sesión
3. El servidor queda corriendo en segundo plano, accesible en el puerto 8787

## Comandos del servicio

| Comando | Qué hace |
|---|---|
| `npm run service:start` | Iniciar el servicio manualmente |
| `npm run service:stop` | Detener el servicio |
| `npm run service:restart` | Reiniciar el servicio |
| `npm run service:status` | Verificar si está corriendo |
| `npm run service:logs` | Ver los logs en tiempo real |
| `npm run uninstall` | Desinstalar completamente |

## Verificar estado

```bash
npm run service:status
```

Salida posible:
- `🟢 AgentDeck is RUNNING` — El servicio está activo
- `🔴 AgentDeck is NOT running` — El servicio está detenido

## Ver logs

```bash
npm run service:logs
```

Los logs también están en: `~/Library/Logs/agentdeck.log`

## Forzar reinicio

Si AgentDeck no responde:

```bash
npm run service:restart
```

O manualmente:

```bash
launchctl unload ~/Library/LaunchAgents/com.agentdeck.plist
launchctl load ~/Library/LaunchAgents/com.agentdeck.plist
```

## Desinstalar el servicio

Para eliminar solo el servicio (sin borrar archivos):

```bash
npm run service:uninstall
```

Para desinstalar todo (servicio + configuración):

```bash
npm run uninstall
```

## Solución de problemas

### El servicio no inicia al encender la Mac

1. Verifica que el plist exista:
```bash
ls -la ~/Library/LaunchAgents/com.agentdeck.plist
```

2. Intenta cargarlo manualmente:
```bash
launchctl load ~/Library/LaunchAgents/com.agentdeck.plist
```

3. Revisa los logs:
```bash
npm run service:logs
```

### Error: "service already loaded"

El servicio ya está activo. Reinícialo:
```bash
npm run service:restart
```

### Cambió la IP de la red

No pasa nada — el servicio usa `agentdeck.local` (mDNS) que funciona automáticamente en la misma red.

## Ubicaciones importantes

| Archivo | Dónde está |
|---|---|
| Configuración del servicio | `~/Library/LaunchAgents/com.agentdeck.plist` |
| Logs | `~/Library/Logs/agentdeck.log` |
| Proyectos guardados | `projects.json` (en la carpeta del proyecto) |
| Sesiones | `sessions.json` (en la carpeta del proyecto) |

## Acceso sin servicio

Si prefieres no usar el servicio automático, puedes iniciar AgentDeck manualmente:

```bash
npm start
```

Esto inicia el servidor en primer plano. Ciérralo con `Ctrl+C`.

---

© 2026 Roberto Bustamante. Código privado.