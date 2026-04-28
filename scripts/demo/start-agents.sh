#!/usr/bin/env bash
# Phase 2C demo — start the AI agents marketplace with real on-chain payments.
#
# Same wiring as start-game.sh: same SDK, same API. Each completed cycle
# emits one signed Transfer from the demo validator → a synthetic recipient.
#
# Usage:
#   ./scripts/demo/start-agents.sh
#   BASE_URL=http://1.2.3.4:8080 ./scripts/demo/start-agents.sh
#   BUYERS=4 DATA=3 COMPUTE=3 TICK_MS=100 ./scripts/demo/start-agents.sh
#   VERBOSE=1 ./scripts/demo/start-agents.sh    # one log line per protocol phase

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY_PATH="${REPO_ROOT}/demo_node/keys/v0.key"

if [[ ! -f "${KEY_PATH}" ]]; then
    echo "[agents] sender key missing at ${KEY_PATH} — run ./scripts/demo/setup-genesis.sh" >&2
    exit 1
fi
if [[ ! -d "${REPO_ROOT}/sdk/js/node_modules" ]]; then
    echo "[agents] installing SDK deps (npm install) ..."
    (cd "${REPO_ROOT}/sdk/js" && npm install --silent)
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
BUYERS="${BUYERS:-2}"
DATA="${DATA:-2}"
COMPUTE="${COMPUTE:-2}"
TICK_MS="${TICK_MS:-200}"
VERBOSE="${VERBOSE:-}"

echo "[agents] base=${BASE_URL} buyers=${BUYERS} data=${DATA} compute=${COMPUTE} tick=${TICK_MS}ms"
echo "[agents] sender key: ${KEY_PATH}"
echo

cd "${REPO_ROOT}/apps/agents"
ARGS=(
    --base-url "${BASE_URL}"
    --buyers "${BUYERS}"
    --data "${DATA}"
    --compute "${COMPUTE}"
    --tick-ms "${TICK_MS}"
    --duration 0
    --sender-key "${KEY_PATH}"
)
if [[ -n "${VERBOSE}" ]]; then
    ARGS+=(--verbose)
fi
exec node run.js "${ARGS[@]}"
