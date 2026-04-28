#!/usr/bin/env bash
# Phase 3 Public Testnet — one-time setup.
#
# Generates a 4-validator + 4-user testnet under ./testnet_public/. Idempotent:
# existing keys / genesis / configs are preserved. Pubkeys are extracted from
# `subtick keygen` JSON output to assemble a manual genesis.json (the binary's
# `genesis --validators N` mode emits random keys without their seeds, so
# we hand-roll the JSON instead).
#
# Output:
#   testnet_public/keys/validator_{0..3}.key   32-byte hex Ed25519 seeds
#   testnet_public/keys/user_{0..3}.key        same — for developer onboarding
#   testnet_public/genesis.json                4 validators (10M stake each)
#                                              + 8 funded accounts (1B each user, 100M each validator)
#   testnet_public/configs/config_{0..3}.toml  per-validator config
#   testnet_public/data_{0..3}/                empty data dirs for sled
#
# Ports (single-box default; override in TESTNET.md for multi-machine):
#   API:  127.0.0.1:8080  (validator_0 only)
#   P2P:  127.0.0.1:1910{0..3}

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NET_DIR="${REPO_ROOT}/testnet_public"
KEYS_DIR="${NET_DIR}/keys"
CONFIGS_DIR="${NET_DIR}/configs"
GENESIS="${NET_DIR}/genesis.json"

VALIDATOR_STAKE=10000000          # 10M stake per validator
VALIDATOR_BALANCE=100000000       # 100M balance per validator account
USER_BALANCE=1000000000           # 1B per user account
P2P_BASE_PORT="${P2P_BASE_PORT:-19100}"   # 19100..19103

SUBTICK_BIN="${REPO_ROOT}/subtick/target/release/subtick"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    SUBTICK_BIN="${SUBTICK_BIN}.exe"
fi
if [[ ! -x "${SUBTICK_BIN}" ]]; then
    echo "[setup] building subtick (release + api feature) ..."
    (cd "${REPO_ROOT}/subtick" && cargo build --release --features api)
fi

mkdir -p "${KEYS_DIR}" "${CONFIGS_DIR}"
for i in 0 1 2 3; do
    mkdir -p "${NET_DIR}/data_${i}"
done

# ── Keygen helpers ─────────────────────────────────────────────────────────

# Extract the pubkey field from `subtick keygen` JSON output (no jq dependency).
extract_pubkey() {
    grep -m1 -oE '"pubkey":"[0-9a-f]{64}"' "$1" | sed 's/.*"\([0-9a-f]\{64\}\)"/\1/'
}

# Generate a key if missing; print its pubkey to stdout.
ensure_key() {
    local label="$1" out="${KEYS_DIR}/$1.key" tmp="${NET_DIR}/.${1}.json"
    if [[ -f "${out}" ]]; then
        # Existing key: derive pubkey by running keygen against /dev/null is
        # not safe (would overwrite). Instead, ask subtick to print info... no
        # such command, so we re-derive via a tiny Node helper using the SDK.
        local seed_hex
        seed_hex="$(cat "${out}")"
        node --input-type=module -e "
            import {derivePublicKey} from '${REPO_ROOT//\\//}/sdk/js/src/index.js';
            process.stdout.write(derivePublicKey(Buffer.from(process.argv[1], 'hex')).toString('hex'));
        " "${seed_hex}"
    else
        "${SUBTICK_BIN}" keygen --output "${out}" > "${tmp}"
        local pk
        pk="$(extract_pubkey "${tmp}")"
        rm -f "${tmp}"
        printf '%s' "${pk}"
    fi
}

# Make sure SDK is installed for the pubkey derivation in `ensure_key` for
# pre-existing keys.
if [[ ! -d "${REPO_ROOT}/sdk/js/node_modules" ]]; then
    echo "[setup] installing SDK deps (npm install) ..."
    (cd "${REPO_ROOT}/sdk/js" && npm install --silent)
fi

echo "[setup] generating validator keys ..."
V0_PK=$(ensure_key validator_0)
V1_PK=$(ensure_key validator_1)
V2_PK=$(ensure_key validator_2)
V3_PK=$(ensure_key validator_3)
echo "  validator_0: ${V0_PK}"
echo "  validator_1: ${V1_PK}"
echo "  validator_2: ${V2_PK}"
echo "  validator_3: ${V3_PK}"

echo "[setup] generating user keys (funded but not validators) ..."
U0_PK=$(ensure_key user_0)
U1_PK=$(ensure_key user_1)
U2_PK=$(ensure_key user_2)
U3_PK=$(ensure_key user_3)
echo "  user_0: ${U0_PK}"
echo "  user_1: ${U1_PK}"
echo "  user_2: ${U2_PK}"
echo "  user_3: ${U3_PK}"

# ── Genesis (hand-rolled JSON) ─────────────────────────────────────────────

if [[ -f "${GENESIS}" ]]; then
    echo "[setup] reusing existing genesis at ${GENESIS}"
else
    echo "[setup] writing genesis (4 validators + 4 users funded) ..."
    cat > "${GENESIS}" <<EOF
{
  "chain_id": 1,
  "validators": [
    { "pubkey": "${V0_PK}", "weight": 1, "stake": ${VALIDATOR_STAKE} },
    { "pubkey": "${V1_PK}", "weight": 1, "stake": ${VALIDATOR_STAKE} },
    { "pubkey": "${V2_PK}", "weight": 1, "stake": ${VALIDATOR_STAKE} },
    { "pubkey": "${V3_PK}", "weight": 1, "stake": ${VALIDATOR_STAKE} }
  ],
  "accounts": [
    { "pubkey": "${V0_PK}", "balance": ${VALIDATOR_BALANCE} },
    { "pubkey": "${V1_PK}", "balance": ${VALIDATOR_BALANCE} },
    { "pubkey": "${V2_PK}", "balance": ${VALIDATOR_BALANCE} },
    { "pubkey": "${V3_PK}", "balance": ${VALIDATOR_BALANCE} },
    { "pubkey": "${U0_PK}", "balance": ${USER_BALANCE} },
    { "pubkey": "${U1_PK}", "balance": ${USER_BALANCE} },
    { "pubkey": "${U2_PK}", "balance": ${USER_BALANCE} },
    { "pubkey": "${U3_PK}", "balance": ${USER_BALANCE} }
  ]
}
EOF
fi

# ── Per-validator configs ──────────────────────────────────────────────────

# Build the comma-separated peers list once: every validator points at the
# OTHER three validators' P2P ports.
write_config() {
    local idx="$1"
    local out="${CONFIGS_DIR}/config_${idx}.toml"
    if [[ -f "${out}" ]]; then
        echo "[setup] reusing existing config_${idx}"
        return
    fi
    local listen="127.0.0.1:$((P2P_BASE_PORT + idx))"
    local peers=""
    for j in 0 1 2 3; do
        if [[ "${j}" != "${idx}" ]]; then
            local p="\"127.0.0.1:$((P2P_BASE_PORT + j))\""
            if [[ -z "${peers}" ]]; then peers="${p}"; else peers="${peers}, ${p}"; fi
        fi
    done
    cat > "${out}" <<EOF
[node]
name = "subtick-testnet-${idx}"
data_dir = "./testnet_public/data_${idx}"
chain_id = 1

[network]
listen_addr = "${listen}"
peers = [${peers}]
max_peers = 50
max_per_ip = 10

[consensus]
key_path = "./testnet_public/keys/validator_${idx}.key"
validator_index = ${idx}
genesis_path = "./testnet_public/genesis.json"
EOF
}

for i in 0 1 2 3; do
    write_config "${i}"
done

echo
echo "[setup] testnet ready under ${NET_DIR}"
echo "  configs:  ${CONFIGS_DIR}/config_{0..3}.toml"
echo "  genesis:  ${GENESIS}"
echo "  user keys: ${KEYS_DIR}/user_{0..3}.key  (1B funded each — give these to devs)"
echo
echo "Next:"
echo "  ./scripts/testnet/start-all.sh"
