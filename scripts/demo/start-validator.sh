#!/usr/bin/env bash
# Phase 2C demo — boot the Subtick validator + API in single-binary Phase 6 mode.
#
# Default listen: 127.0.0.1:8080 (HTTP/WS API). Override with API_LISTEN.
# Default p2p:    127.0.0.1:19100 (set in demo_node/config.toml).
#
# Required: ./scripts/demo/setup-genesis.sh first (creates keys + genesis + config).
#
# Usage:
#   ./scripts/demo/start-validator.sh
#   API_LISTEN=0.0.0.0:8080 ./scripts/demo/start-validator.sh    # public bind
#
# Stop with Ctrl+C; the executor + orderer + API thread shut down cleanly.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_DIR="${REPO_ROOT}/demo_node"
CONFIG_PATH="${NODE_DIR}/config.toml"

API_LISTEN="${API_LISTEN:-127.0.0.1:8080}"

SUBTICK_BIN="${REPO_ROOT}/subtick/target/release/subtick"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    SUBTICK_BIN="${SUBTICK_BIN}.exe"
fi

if [[ ! -f "${CONFIG_PATH}" ]]; then
    echo "[validator] config missing — run ./scripts/demo/setup-genesis.sh first" >&2
    exit 1
fi
if [[ ! -x "${SUBTICK_BIN}" ]]; then
    echo "[validator] subtick binary missing — run ./scripts/demo/setup-genesis.sh first" >&2
    exit 1
fi

# Phase 6 mode + sharded stamping (4 active shards). Identical to the env
# vars we used for `examples/real_tx_smoke.js`; verified end-to-end.
export SUBTICK_PHASE6_BATCH_BUILDER=1
export SUBTICK_PHASE6_GOSSIP=1
export SUBTICK_PHASE6_ORDERER=1
export SUBTICK_PHASE6_EXECUTOR=1
export SUBTICK_DISABLE_BLOCK_PATH=1
export SUBTICK_LEADER_TIMEOUT_MS=2000
export SUBTICK_SHARDING_MODE=sharded
export SUBTICK_NUM_ACTIVE_SHARDS=4

echo "[validator] booting on api=${API_LISTEN}"
echo "[validator] env: phase6=on sharded=on shards=4"
echo "[validator] Ctrl+C to stop"
echo

cd "${REPO_ROOT}"
exec "${SUBTICK_BIN}" api --config "${CONFIG_PATH}" --listen "${API_LISTEN}"
