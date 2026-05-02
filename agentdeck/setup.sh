#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════════
# AgentDeck Setup - All-in-one installation script
# Usage: npm run setup  or  bash setup.sh
# ═══════════════════════════════════════════════════════════════════════

# Colors for friendly output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Script directory resolution
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
PLIST_NAME="com.agentdeck.plist"
PLIST_SOURCE="$PROJECT_DIR/$PLIST_NAME"
PLIST_TARGET="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/agentdeck.log"

# ─────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────

print_header() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}AgentDeck Setup${NC}                                          ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${BLUE}▸${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# ─────────────────────────────────────────────────────────────────────────
# Check Node.js version
# ─────────────────────────────────────────────────────────────────────────

check_node() {
    print_step "Verificando Node.js..."

    if ! command -v node &> /dev/null; then
        print_error "Node.js no está instalado."
        echo ""
        echo "Por favor instala Node.js 22+:"
        echo "  • Homebrew:  brew install node"
        echo "  • Web:      https://nodejs.org"
        echo ""
        exit 1
    fi

    NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 22 ]; then
        print_error "Node.js $NODE_VERSION detectado. Se requiere Node.js 22+."
        echo ""
        echo "Para actualizar:"
        echo "  • Homebrew:  brew install node"
        echo "  • Web:      https://nodejs.org"
        echo ""
        exit 1
    fi

    NODE_PATH=$(which node)
    print_success "Node.js $(node --version) encontrado"
}

# ─────────────────────────────────────────────────────────────────────────
# Install dependencies
# ─────────────────────────────────────────────────────────────────────────

install_deps() {
    print_step "Instalando dependencias..."
    cd "$PROJECT_DIR"

    if [ -d "node_modules" ]; then
        print_success "node_modules ya existe, saltando npm install"
    else
        npm install
        print_success "Dependencias instaladas"
    fi
}

# ─────────────────────────────────────────────────────────────────────────
# Create log directory
# ─────────────────────────────────────────────────────────────────────────

setup_logs() {
    mkdir -p "$LOG_DIR"
    print_success "Directorio de logs creado: $LOG_DIR"
}

# ─────────────────────────────────────────────────────────────────────────
# Install launchd service
# ─────────────────────────────────────────────────────────────────────────

install_service() {
    print_step "Configurando servicio de auto-inicio..."

    # Check if plist exists
    if [ ! -f "$PLIST_SOURCE" ]; then
        print_warning "Archivo $PLIST_SOURCE no encontrado, omitiendo servicio"
        return 0
    fi

    # Check if already installed
    if [ -f "$PLIST_TARGET" ]; then
        print_warning "Servicio ya instalado, actualizando..."
        launchctl unload "$PLIST_TARGET" 2>/dev/null || true
    fi

    sed "s|/opt/homebrew/bin/node|$NODE_PATH|g" "$PLIST_SOURCE" > "$PLIST_TARGET"
    print_success "Servicio configurado en LaunchAgents"
}

# ─────────────────────────────────────────────────────────────────────────
# Start the service
# ─────────────────────────────────────────────────────────────────────────

start_service() {
    print_step "Iniciando AgentDeck..."

    # Try to load via launchd first
    if [ -f "$PLIST_TARGET" ]; then
        launchctl load "$PLIST_TARGET" 2>/dev/null || true
    fi

    # Also try direct start
    cd "$PROJECT_DIR"
    npm start &
    SERVER_PID=$!

    # Wait for server to start
    sleep 3

    # Check if server is running
    if curl -s --max-time 2 http://127.0.0.1:8787/health &> /dev/null; then
        print_success "Servidor iniciado"
    else
        print_warning "El servidor può no estar disponible inmediatamente"
    fi
}

# ─────────────────────────────────────────────────────────────────────────
# Show success message
# ────────────────────────────��────────────────────────────────────────────

show_success() {
    # Get LAN IP
    LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "192.168.x.x")

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}              ${BOLD}✅ AgentDeck instalado${NC}                       ${GREEN}║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}Acceso:${NC}"
    echo -e "    🌐 Local:    ${CYAN}http://127.0.0.1:8787${NC}"
    echo -e "    🌐 Red LAN:  ${CYAN}http://${LAN_IP}:8787${NC}"
    echo -e "    🌐 mDNS:     ${CYAN}http://agentdeck.local:8787${NC}"
    echo ""
    echo -e "  ${BOLD}Contraseña:${NC} ${YELLOW}agentdeck-dummy${NC}"
    echo ""
    echo -e "  ${BOLD}WebSocket Terminal:${NC} ${CYAN}ws://localhost:8787/ws/terminal${NC}"
    echo ""

    if [ -f "$LOG_FILE" ]; then
        echo -e "  ${BOLD}Logs:${NC} tail -f $LOG_FILE"
        echo ""
    fi

    echo -e "${GREEN}¡Listo! Abre cualquiera de las URLs arriba en tu navegador.${NC}"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────
# Main execution
# ─────────────────────────────────────────────────────────────────────────

main() {
    print_header
    check_node
    install_deps
    setup_logs
    install_service
    start_service
    show_success
}

# Run main
main "$@"