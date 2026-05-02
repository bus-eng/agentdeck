#!/bin/bash
set -e

# AgentDeck Auto-Start Installer for macOS
# Usage: ./scripts/install-service.sh [install|uninstall|start|stop|restart|status]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.agentdeck.plist"
PLIST_SOURCE="$PROJECT_DIR/$PLIST_NAME"
PLIST_TARGET="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs"

check_node() {
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js not found. Install from https://nodejs.org"
        exit 1
    fi
    NODE_PATH=$(which node)
    echo "✓ Node found: $NODE_PATH"
}

install() {
    check_node

    # Build the project first
    echo "📦 Building AgentDeck..."
    cd "$PROJECT_DIR"
    npm run build

    # Create log directory
    mkdir -p "$LOG_DIR"

    # Update plist with actual node path
    sed "s|/opt/homebrew/bin/node|$NODE_PATH|g" "$PLIST_SOURCE" > "$PLIST_TARGET"

    echo "✓ Plist installed to: $PLIST_TARGET"
    echo "✓ Starting service..."
    launchctl load "$PLIST_TARGET"
    echo "✅ AgentDeck service installed and running!"
    echo ""
    echo "Access URLs:"
    echo "  - Local:    http://127.0.0.1:8787"
    echo "  - LAN:      http://$(ipconfig getifaddr en0):8787"
    echo "  - mDNS:     http://agentdeck.local:8787"
}

uninstall() {
    echo "🗑️ Uninstalling AgentDeck service..."
    launchctl unload "$PLIST_TARGET" 2>/dev/null || true
    rm -f "$PLIST_TARGET"
    echo "✅ Service uninstalled."
}

start() {
    launchctl load "$PLIST_TARGET"
    echo "✅ Service started."
}

stop() {
    launchctl unload "$PLIST_TARGET"
    echo "🛑 Service stopped."
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if launchctl list | grep -q "com.agentdeck"; then
        echo "🟢 AgentDeck is RUNNING"
        launchctl list | grep agentdeck
    else
        echo "🔴 AgentDeck is NOT running"
    fi
}

logs() {
    if [ -f "$LOG_DIR/agentdeck.log" ]; then
        tail -f "$LOG_DIR/agentdeck.log"
    else
        echo "No logs found. Service may not be running."
    fi
}

case "$1" in
    install)   install ;;
    uninstall) uninstall ;;
    start)     start ;;
    stop)      stop ;;
    restart)   restart ;;
    status)    status ;;
    logs)      logs ;;
    *)
        echo "Usage: $0 {install|uninstall|start|stop|restart|status|logs}"
        exit 1
        ;;
esac
