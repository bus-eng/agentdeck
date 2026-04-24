# AgentDeck — dummy spike

Proof of concept: **xterm.js + WebSocket + node-pty** end-to-end in the browser, accessible from iPhone/iPad on the same LAN.

> Throwaway code. No production hardening, no persistence, no HTTPS. Do not expose to public networks.

## What it does

- Fastify server with a WebSocket endpoint that bridges the browser terminal to a real PTY (your `$SHELL`).
- xterm.js frontend with a mobile keyboard bar for iOS (Esc, Tab, Ctrl+C, arrows, Enter).
- Cookie-based session with a simple passphrase login.

## Run it

```bash
cd dummy
pnpm install
pnpm dev
```

The server prints on startup:

```
[ad] Local:  http://127.0.0.1:8787
[ad] LAN:    http://192.168.x.x:8787  ← open this on iPhone
[ad] Pass:   ag***ck
```

## Accessing from iPhone

1. Make sure Mac and iPhone are on the same Wi-Fi network.
2. Open the **LAN URL** printed above in Safari.
3. Enter passphrase: `agentdeck-dummy` (default).

## Config (optional)

Copy `.env.example` to `.env` and set:

| Variable | Default | Notes |
|---|---|---|
| `HOST` | `0.0.0.0` | `0.0.0.0` is required for LAN access |
| `PORT` | `8787` | Any free port |
| `PASSPHRASE` | `agentdeck-dummy` | Change to anything |

## If node-pty fails to load

`@lydell/node-pty` is a native module. If it fails on first run:

```bash
pnpm approve-builds
pnpm install
```

Or rebuild manually:

```bash
pnpm rebuild @lydell/node-pty
```
