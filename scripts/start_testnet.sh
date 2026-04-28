#!/usr/bin/env bash
# Start a local N-node Subtick testnet.
#
# Usage:
#   ./scripts/start_testnet.sh [N] [base_port]
#
# Defaults: N=4, base_port=9000
#
# Steps:
#   1. cargo build --release
#   2. Generate N validator keys  -> testnet/keys/validator_<i>.key
#   3. Build shared genesis.json  -> testnet/genesis.json
#   4. Write per-node config.toml -> testnet/config_<i>.toml
#   5. Start each node in background, log to testnet/logs/node_<i>.log
#   6. Ctrl+C stops all nodes cleanly

set -euo pipefail

N="${1:-4}"
BASE_PORT="${2:-9000}"
BINARY="./target/release/subtick"
TDIR="./testnet"
KEYS_DIR="$TDIR/keys"
LOGS_DIR="$TDIR/logs"
GENESIS="$TDIR/genesis.json"

echo "=== Subtick Chain local testnet (N=$N, base_port=$BASE_PORT) ==="
echo ""

# ── 1. Build ───────────────────────────────────────────────────────────────────
echo "[1/4] cargo build --release ..."
cargo build --release --quiet
echo "      done."

# ── 2. Keys ────────────────────────────────────────────────────────────────────
echo "[2/4] Generating $N validator keys ..."
mkdir -p "$KEYS_DIR" "$LOGS_DIR"

# Collect pubkeys into a file so Python can read them without shell quoting issues
PUBKEY_FILE="$TDIR/pubkeys.txt"
rm -f "$PUBKEY_FILE"

# Default: random keygen (legacy behaviour). The shard-distinct picker
# below activates only when SUBTICK_TESTNET_SPREAD_VALIDATORS=1 is set. Empty-
# block regression in late Stage B2 was correlated with shard-distinct
# validators + per-shard proposer; left off until root cause is fixed.
SPREAD_VALIDATORS="${SUBTICK_TESTNET_SPREAD_VALIDATORS:-0}"
NUM_SHARDS_FOR_PICK=4
declare -a TAKEN_SHARDS=()
shard_of_hex() {
    local hex="$1"
    local byte_dec=$((16#${hex:0:2}))
    echo $(( byte_dec % NUM_SHARDS_FOR_PICK ))
}
shard_taken() {
    local s="$1"
    for t in "${TAKEN_SHARDS[@]:-}"; do
        [ "$t" = "$s" ] && return 0
    done
    return 1
}

for i in $(seq 0 $((N - 1))); do
    KEY="$KEYS_DIR/validator_${i}.key"
    PK=""
    if [ "$SPREAD_VALIDATORS" = "1" ]; then
        for attempt in $(seq 1 256); do
            JSON=$("$BINARY" keygen --output "$KEY")
            PK=$(echo "$JSON" | sed 's/.*"pubkey":"\([^"]*\)".*/\1/')
            s=$(shard_of_hex "$PK")
            if shard_taken "$s"; then
                continue
            fi
            TAKEN_SHARDS+=("$s")
            break
        done
    else
        JSON=$("$BINARY" keygen --output "$KEY")
        PK=$(echo "$JSON" | sed 's/.*"pubkey":"\([^"]*\)".*/\1/')
    fi
    echo "$PK" >> "$PUBKEY_FILE"
    s_final=$(shard_of_hex "$PK")
    echo "      [$i] shard=${s_final}  ${PK:0:16}... -> $KEY"
done

# ── 3. Genesis ─────────────────────────────────────────────────────────────────
echo "[3/4] Building genesis.json ..."
python <<PYEOF
import json

with open("$PUBKEY_FILE") as f:
    pubkeys = [l.strip() for l in f if l.strip()]

validators = [{"pubkey": pk, "weight": 1, "stake": 10_000_000} for pk in pubkeys]
accounts   = [{"pubkey": pk, "balance": 10_000_000_000_000_000}  for pk in pubkeys]
genesis    = {"chain_id": 1, "validators": validators, "accounts": accounts}

with open("$GENESIS", "w") as f:
    json.dump(genesis, f, indent=2)
print(f"      {len(pubkeys)} validators written to $GENESIS")
PYEOF

# ── 4. Configs ─────────────────────────────────────────────────────────────────
echo "[4/4] Writing per-node config files ..."
for i in $(seq 0 $((N - 1))); do
    PORT=$((BASE_PORT + i))
    CFG="$TDIR/config_${i}.toml"

    # Build peers list: all other nodes
    PEERS=""
    for j in $(seq 0 $((N - 1))); do
        [ "$j" = "$i" ] && continue
        PPORT=$((BASE_PORT + j))
        PEERS="${PEERS}\"127.0.0.1:${PPORT}\", "
    done
    PEERS="[${PEERS%, }]"

    cat > "$CFG" <<TOML
[node]
name = "subtick-node-${i}"
data_dir = "$TDIR/data_${i}"
chain_id = 1

[network]
listen_addr = "0.0.0.0:${PORT}"
peers = ${PEERS}
max_peers = 50
max_per_ip = 10

[consensus]
key_path = "$KEYS_DIR/validator_${i}.key"
validator_index = ${i}
genesis_path = "$GENESIS"
TOML
    echo "      node=$i  port=$PORT  cfg=$CFG"
done

# ── 5. Start nodes ─────────────────────────────────────────────────────────────
echo ""
echo "Starting $N nodes ..."
PIDS=()
for i in $(seq 0 $((N - 1))); do
    LOG="$LOGS_DIR/node_${i}.log"
    "$BINARY" start --config "$TDIR/config_${i}.toml" > "$LOG" 2>&1 &
    PIDS+=($!)
    echo "  node $i  pid=${PIDS[-1]}  log=$LOG"
done

echo ""
echo "Testnet is running.  Ctrl+C to stop."
echo "  tail -f $LOGS_DIR/node_0.log    # stream node 0 JSON logs"
echo "  subtick status --config $TDIR/config_0.toml"
echo ""

trap 'echo ""; echo "Stopping all nodes ..."; kill "${PIDS[@]}" 2>/dev/null; echo "Stopped."; exit 0' INT TERM
wait
