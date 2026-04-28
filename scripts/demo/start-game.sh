#!/usr/bin/env bash
# Phase 2C demo — start the game economy with real on-chain transfers.
#
# Connects to a running `subtick api` (default http://127.0.0.1:8080) and uses
# the demo validator key as the funded sender. Each game action submits a
# signed Transfer; the off-chain ledger keeps tracking gold + items locally.
#
# Usage:
#   ./scripts/demo/start-game.sh                          # localhost defaults
#   BASE_URL=http://1.2.3.4:8080 ./scripts/demo/start-game.sh
#   PLAYERS=16 TICK_MS=100 ./scripts/demo/start-game.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY_PATH="${REPO_ROOT}/demo_node/keys/v0.key"

if [[ ! -f "${KEY_PATH}" ]]; then
    echo "[game] sender key missing at ${KEY_PATH} — run ./scripts/demo/setup-genesis.sh" >&2
    exit 1
fi
if [[ ! -d "${REPO_ROOT}/sdk/js/node_modules" ]]; then
    echo "[game] installing SDK deps (npm install) ..."
    (cd "${REPO_ROOT}/sdk/js" && npm install --silent)
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
PLAYERS="${PLAYERS:-8}"
TICK_MS="${TICK_MS:-200}"
ITEMS="${ITEMS:-12}"

echo "[game] base=${BASE_URL} players=${PLAYERS} tick=${TICK_MS}ms items=${ITEMS}"
echo "[game] sender key: ${KEY_PATH}"
echo

cd "${REPO_ROOT}/apps/game"
exec node run.js \
    --base-url "${BASE_URL}" \
    --players "${PLAYERS}" \
    --tick-ms "${TICK_MS}" \
    --items "${ITEMS}" \
    --duration 0 \
    --sender-key "${KEY_PATH}"
