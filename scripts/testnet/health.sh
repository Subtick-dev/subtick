#!/usr/bin/env bash
# Phase 3 Public Testnet — quick status snapshot.
#
# Pulls /health from validator_0's API and shows the most-recent metrics tick
# from each validator's log. Treat 200 + height advancing as "all good".
#
# Usage:
#   ./scripts/testnet/health.sh
#   API_URL=http://server.example.com:8080 ./scripts/testnet/health.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOGS_DIR="${REPO_ROOT}/testnet_public/logs"
API_URL="${API_URL:-http://127.0.0.1:8080}"

echo "── /health ──────────────────────────────────────────────"
if ! curl -fs "${API_URL}/health" 2> /dev/null; then
    echo "  API not reachable at ${API_URL}/health"
    echo "  Check: ./scripts/testnet/start-all.sh"
    exit 2
fi
echo
echo

echo "── per-validator: tx_ingested_total / tx_executed_total ──"
for i in 0 1 2 3; do
    log="${LOGS_DIR}/validator_${i}.log"
    if [[ ! -f "${log}" ]]; then
        echo "  validator_${i}: <no log>"
        continue
    fi
    last_metrics=$(grep -oE '"tx_ingested_total":[0-9]+,"type":"MetricsTick"' "${log}" | tail -1 || true)
    last_exec=$(grep -oE '"tx_executed_total":[0-9]+' "${log}" | tail -1 || true)
    ingested="${last_metrics##*\"tx_ingested_total\":}"
    ingested="${ingested%%,*}"
    exec="${last_exec##*:}"
    printf "  validator_%d: ingested=%s executed=%s\n" "${i}" "${ingested:-0}" "${exec:-0}"
done

echo
echo "── BatchExecuted summary ────────────────────────────────"
for i in 0 1 2 3; do
    log="${LOGS_DIR}/validator_${i}.log"
    [[ -f "${log}" ]] || { echo "  validator_${i}: <no log>"; continue; }
    total=$(grep -c '"type":"BatchExecuted"' "${log}" || true)
    applied=$(grep -oE '"group_applied_txs":[0-9]+' "${log}" | awk -F: '{s+=$2} END{print s+0}')
    printf "  validator_%d: frames=%s applied_total=%s\n" "${i}" "${total:-0}" "${applied}"
done

echo
echo "── PIDs ─────────────────────────────────────────────────"
for f in "${REPO_ROOT}/testnet_public/pids"/validator_*.pid; do
    [[ -f "${f}" ]] || continue
    pid=$(cat "${f}")
    name=$(basename "${f}" .pid)
    if kill -0 "${pid}" 2> /dev/null; then
        printf "  %s: %s ALIVE\n" "${name}" "${pid}"
    else
        printf "  %s: %s DEAD\n" "${name}" "${pid}"
    fi
done
