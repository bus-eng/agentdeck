#!/bin/bash
# AgentDeck — Quick PR creator
# Usage: npm run pr
#        npm run pr "mi mensaje descriptivo"

set -e

BRANCH="pr/$(date +%s)"
MSG="${1:-$(date '+%Y-%m-%d %H:%M')}"

echo "→ Creando branch $BRANCH..."
git checkout -b "$BRANCH"

echo "→ Staging todo..."
git add -A

echo "→ Commiteando..."
git commit -m "$MSG"

echo "→ Pusheando..."
git push -u origin "$BRANCH"

echo "→ Abriendo PR en GitHub..."
gh pr create --fill --web

echo ""
echo "✅ PR creado. Mergealo desde:"
echo "   https://github.com/bus-eng/agentdeck"
