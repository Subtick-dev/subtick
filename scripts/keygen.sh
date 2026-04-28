#!/usr/bin/env bash
# Generate validator signing keys for N nodes.
#
# Usage:
#   ./scripts/keygen.sh [N] [output_dir]
#
# Defaults: N=4, output_dir=./testnet/keys
#
# Each key is written to <output_dir>/validator_<i>.key as a 64-char hex string.
# The corresponding public key is printed to stdout as JSON.

set -euo pipefail

N="${1:-4}"
OUT="${2:-./testnet/keys}"
BINARY="${SUBTICK_BIN:-./target/release/subtick}"

mkdir -p "$OUT"
echo "Generating $N validator key(s) in $OUT ..."

PUBKEYS=()
for i in $(seq 0 $((N - 1))); do
    KEY_PATH="$OUT/validator_${i}.key"
    RESULT=$("$BINARY" keygen --output "$KEY_PATH")
    PUBKEY=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['pubkey'])" 2>/dev/null \
             || echo "$RESULT" | grep -o '"pubkey":"[^"]*"' | cut -d'"' -f4)
    PUBKEYS+=("$PUBKEY")
    echo "  [$i] $PUBKEY -> $KEY_PATH"
done

echo ""
echo "Done. Use these pubkeys in your genesis.json validators array."
