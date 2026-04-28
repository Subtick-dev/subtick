#!/usr/bin/env bash
# Phase 3 Public Testnet — graceful stop of all 4 validators.
#
# Reads PIDs from testnet_public/pids/ and sends SIGTERM. Falls back to
# SIGKILL after 5 s if any validator hasn't exited.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDS_DIR="${REPO_ROOT}/testnet_public/pids"

if [[ ! -d "${PIDS_DIR}" ]]; then
    echo "[stop] no pid dir at ${PIDS_DIR} — nothing to stop"
    exit 0
fi

pids=()
for f in "${PIDS_DIR}"/validator_*.pid; do
    [[ -f "${f}" ]] || continue
    pid="$(cat "${f}")"
    if kill -0 "${pid}" 2> /dev/null; then
        pids+=("${pid}")
        echo "[stop] SIGTERM pid=${pid} ($(basename "${f}" .pid))"
        kill -TERM "${pid}" || true
    fi
    rm -f "${f}"
done

if [[ ${#pids[@]} -eq 0 ]]; then
    echo "[stop] no live validators found"
    exit 0
fi

# Give them 5s to exit cleanly.
for _ in 1 2 3 4 5; do
    sleep 1
    alive=0
    for pid in "${pids[@]}"; do
        if kill -0 "${pid}" 2> /dev/null; then
            alive=$((alive + 1))
        fi
    done
    if [[ "${alive}" -eq 0 ]]; then
        echo "[stop] all validators exited cleanly"
        exit 0
    fi
done

echo "[stop] some validators still alive — SIGKILL"
for pid in "${pids[@]}"; do
    kill -KILL "${pid}" 2> /dev/null || true
done
echo "[stop] done"
