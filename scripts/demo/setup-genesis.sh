#!/usr/bin/env bash
# Phase 2C demo — one-time genesis setup.
#
# Generates a fresh single-validator genesis under ./demo_node so the
# validator can boot in solo Phase 6 mode with quorum = 1. Idempotent: if
# the keys already exist, the script preserves them.
#
# Usage:
#   ./scripts/demo/setup-genesis.sh
#
# Output files:
#   demo_node/keys/v0.key      32-byte hex Ed25519 seed
#   demo_node/genesis.json     1-validator genesis (also funds that pubkey)
#   demo_node/config.toml      node config pointed at the above

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_DIR="${REPO_ROOT}/demo_node"
KEY_PATH="${NODE_DIR}/keys/v0.key"
GENESIS_PATH="${NODE_DIR}/genesis.json"
CONFIG_PATH="${NODE_DIR}/config.toml"

# Locate subtick binary (release build expected; build it if missing).
SUBTICK_BIN="${REPO_ROOT}/subtick/target/release/subtick"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    SUBTICK_BIN="${SUBTICK_BIN}.exe"
fi

if [[ ! -x "${SUBTICK_BIN}" ]]; then
    echo "[setup] subtick binary not found at ${SUBTICK_BIN}"
    echo "[setup] building (cargo build --release --features api) ..."
    (cd "${REPO_ROOT}/subtick" && cargo build --release --features api)
fi

mkdir -p "${NODE_DIR}/keys" "${NODE_DIR}/data"

if [[ -f "${KEY_PATH}" ]]; then
    echo "[setup] reusing existing key at ${KEY_PATH}"
else
    echo "[setup] generating validator key ..."
    "${SUBTICK_BIN}" keygen --output "${KEY_PATH}"
fi

if [[ -f "${GENESIS_PATH}" ]]; then
    echo "[setup] reusing existing genesis at ${GENESIS_PATH}"
else
    echo "[setup] writing genesis (1 validator) ..."
    "${SUBTICK_BIN}" genesis --key "${KEY_PATH}" --output "${GENESIS_PATH}"
fi

cat > "${CONFIG_PATH}" <<EOF
[node]
name = "subtick-demo"
data_dir = "./demo_node/data"
chain_id = 1

[network]
listen_addr = "127.0.0.1:19100"
peers = []
max_peers = 50
max_per_ip = 10

[consensus]
key_path = "./demo_node/keys/v0.key"
validator_index = 0
genesis_path = "./demo_node/genesis.json"
EOF

PUBKEY=$(grep -m1 '"pubkey"' "${GENESIS_PATH}" | sed 's/.*"\([0-9a-f]\{64\}\)".*/\1/')
echo
echo "[setup] done."
echo "  key:     ${KEY_PATH}"
echo "  genesis: ${GENESIS_PATH}"
echo "  config:  ${CONFIG_PATH}"
echo "  pubkey:  ${PUBKEY}"
echo
echo "Next: ./scripts/demo/start-validator.sh"
