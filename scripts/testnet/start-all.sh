#!/usr/bin/env bash
# Phase 3 Public Testnet — start all 4 validators.
#
# - validator_0 runs `subtick api` (consensus + HTTP/WS API on :8080)
# - validator_1/2/3 run `subtick start` (consensus only)
#
# Each process gets its own log under testnet_public/logs/. PIDs are recorded
# in testnet_public/pids/ so `stop-all.sh` knows what to kill.
#
# Usage:
#   ./scripts/testnet/start-all.sh
#   API_LISTEN=0.0.0.0:8080 ./scripts/testnet/start-all.sh   # public bind on validator_0
#   FRESH=1 ./scripts/testnet/start-all.sh                   # wipe data dirs first

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NET_DIR="${REPO_ROOT}/testnet_public"
CONFIGS_DIR="${NET_DIR}/configs"
LOGS_DIR="${NET_DIR}/logs"
PIDS_DIR="${NET_DIR}/pids"

API_LISTEN="${API_LISTEN:-127.0.0.1:8080}"
FRESH="${FRESH:-}"

SUBTICK_BIN="${REPO_ROOT}/subtick/target/release/subtick"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    SUBTICK_BIN="${SUBTICK_BIN}.exe"
fi
if [[ ! -x "${SUBTICK_BIN}" ]]; then
    echo "[start] subtick binary missing — run ./scripts/testnet/setup.sh first" >&2
    exit 1
fi
if [[ ! -d "${CONFIGS_DIR}" ]]; then
    echo "[start] testnet configs missing — run ./scripts/testnet/setup.sh first" >&2
    exit 1
fi

mkdir -p "${LOGS_DIR}" "${PIDS_DIR}"

if [[ -n "${FRESH}" ]]; then
    echo "[start] FRESH=1 — wiping data dirs"
    for i in 0 1 2 3; do
        rm -rf "${NET_DIR}/data_${i}"
        mkdir -p "${NET_DIR}/data_${i}"
    done
fi

# Phase 6 sharded mode env — exported once, inherited by all 4 spawns.
export SUBTICK_PHASE6_BATCH_BUILDER=1
export SUBTICK_PHASE6_GOSSIP=1
export SUBTICK_PHASE6_ORDERER=1
export SUBTICK_PHASE6_EXECUTOR=1
export SUBTICK_DISABLE_BLOCK_PATH=1
export SUBTICK_LEADER_TIMEOUT_MS=2000
export SUBTICK_SHARDING_MODE=sharded
export SUBTICK_NUM_ACTIVE_SHARDS=4

cd "${REPO_ROOT}"

# Start validators 1, 2, 3 first — quorum is 3 of 4, so validator_0 only
# reaches it after at least two peers are up.
for i in 1 2 3; do
    cfg="${CONFIGS_DIR}/config_${i}.toml"
    log="${LOGS_DIR}/validator_${i}.log"
    "${SUBTICK_BIN}" start --config "${cfg}" > "${log}" 2>&1 &
    echo "$!" > "${PIDS_DIR}/validator_${i}.pid"
    echo "[start] validator_${i}  pid=$!  log=${log}"
done

# Validator 0 runs the API. Started last so peers are already listening
# when it reaches out.
sleep 1
cfg="${CONFIGS_DIR}/config_0.toml"
log="${LOGS_DIR}/validator_0.log"
"${SUBTICK_BIN}" api --config "${cfg}" --listen "${API_LISTEN}" > "${log}" 2>&1 &
echo "$!" > "${PIDS_DIR}/validator_0.pid"
echo "[start] validator_0  pid=$!  log=${log}  api=${API_LISTEN}"

echo
echo "[start] waiting for API ..."
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 1
    if curl -fs "http://${API_LISTEN}/health" > /dev/null 2>&1; then
        echo "[start] API up after ${attempt}s"
        curl -s "http://${API_LISTEN}/health"
        echo
        echo
        echo "Next:"
        echo "  ./scripts/testnet/health.sh"
        echo "  ./scripts/testnet/metrics-tail.sh"
        echo "  ./scripts/testnet/stop-all.sh"
        exit 0
    fi
done

echo "[start] API failed to come up within 15s — check ${LOGS_DIR}/validator_0.log" >&2
exit 2
