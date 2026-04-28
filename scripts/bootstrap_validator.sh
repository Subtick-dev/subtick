#!/usr/bin/env bash
# Bootstrap a single validator from scratch on a fresh machine.
#
# Usage:
#   ./scripts/bootstrap_validator.sh --genesis <path> --index <n> [--port <p>] [--peers <addr,...>]
#
# This script:
#   1. Generates a signing key (skipped if ./validator.key already exists).
#   2. Writes a config.toml pointing at the provided genesis file.
#   3. Prints the node's public key so the operator can register it in genesis.
#   4. Starts the node (unless --dry-run is passed).

set -euo pipefail

BINARY="${SUBTICK_BIN:-./target/release/subtick}"
KEY_PATH="./validator.key"
CONFIG_PATH="./config.toml"
PORT="9000"
GENESIS_PATH=""
VALIDATOR_INDEX=""
PEERS="[]"
DRY_RUN=false

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --genesis)   GENESIS_PATH="$2"; shift 2 ;;
        --index)     VALIDATOR_INDEX="$2"; shift 2 ;;
        --port)      PORT="$2"; shift 2 ;;
        --peers)     PEERS="[$2]"; shift 2 ;;
        --key)       KEY_PATH="$2"; shift 2 ;;
        --dry-run)   DRY_RUN=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$GENESIS_PATH" ] || [ -z "$VALIDATOR_INDEX" ]; then
    echo "Usage: $0 --genesis <path> --index <n> [--port <p>] [--peers \"addr1\",\"addr2\"]"
    exit 1
fi

# ── Step 1: Generate key (if not present) ─────────────────────────────────────
if [ ! -f "$KEY_PATH" ]; then
    echo "Generating validator key at $KEY_PATH ..."
    RESULT=$("$BINARY" keygen --output "$KEY_PATH")
    echo "$RESULT"
else
    echo "Using existing key at $KEY_PATH"
    PUBKEY=$(cat "$KEY_PATH" | tr -d '[:space:]')
    echo "{\"key_file\":\"$KEY_PATH\",\"note\":\"existing key reused\"}"
fi

# ── Step 2: Write config.toml ─────────────────────────────────────────────────
cat > "$CONFIG_PATH" <<TOML
[node]
name = "subtick-validator-${VALIDATOR_INDEX}"
data_dir = "./data"
chain_id = 1

[network]
listen_addr = "0.0.0.0:${PORT}"
peers = ${PEERS}
max_peers = 50
max_per_ip = 3

[consensus]
key_path = "${KEY_PATH}"
validator_index = ${VALIDATOR_INDEX}
genesis_path = "${GENESIS_PATH}"
TOML

echo "{\"status\":\"config_written\",\"config\":\"$CONFIG_PATH\"}"

# ── Step 3: Print status ───────────────────────────────────────────────────────
"$BINARY" status --config "$CONFIG_PATH"

# ── Step 4: Start (unless dry-run) ────────────────────────────────────────────
if $DRY_RUN; then
    echo "{\"status\":\"dry_run\",\"message\":\"node not started. Run: $BINARY start --config $CONFIG_PATH\"}"
else
    echo "{\"status\":\"starting\",\"config\":\"$CONFIG_PATH\"}"
    exec "$BINARY" start --config "$CONFIG_PATH"
fi
