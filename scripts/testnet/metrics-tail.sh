#!/usr/bin/env bash
# Phase 3 Public Testnet — rolling metrics tail.
#
# Aggregates validator_0's MetricsTick lines into a compact summary printed
# every 5 s. Diff-based — shows tx/sec, batches/sec, error counters since
# the previous tick.
#
# Usage:
#   ./scripts/testnet/metrics-tail.sh
#   ./scripts/testnet/metrics-tail.sh /path/to/validator_0.log

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="${1:-${REPO_ROOT}/testnet_public/logs/validator_0.log}"

if [[ ! -f "${LOG}" ]]; then
    echo "[metrics] log not found at ${LOG}" >&2
    exit 1
fi

# Use Node + the SDK's own JSON parser (no jq/awk gymnastics with deeply
# nested histograms). Reads new bytes since last poll, parses MetricsTick
# / BatchExecuted lines, prints compact diffs.
exec node --input-type=module -e "
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[1];
let offset = 0;
const counters = {
  tx_ingested_total: 0,
  tx_executed_total: 0,
  rej_invalid_format: 0,
  rej_sig_ingress: 0,
  rej_stale_nonce: 0,
  rej_mempool_full: 0,
  rej_other: 0,
};
const batchCounts = { frames: 0, applied: 0, rejected_nonce: 0, rejected_balance: 0 };
let prevCounters = { ...counters };
let prevBatch = { ...batchCounts };
let lastT = Date.now();

console.log('[metrics] tailing', path);
console.log('[metrics] (every 5s) tx_in/sec  tx_exec/sec  batches/sec  applied/sec  rej_total');

async function poll() {
  const size = statSync(path).size;
  if (size <= offset) return;
  const stream = createReadStream(path, { start: offset, end: size - 1 });
  offset = size;
  const rl = createInterface({ input: stream });
  for await (const line of rl) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'MetricsTick') {
      for (const k of Object.keys(counters)) if (typeof obj[k] === 'number') counters[k] = obj[k];
    } else if (obj.type === 'BatchExecuted') {
      batchCounts.frames += 1;
      batchCounts.applied += Number(obj.group_applied_txs || 0);
      batchCounts.rejected_nonce += Number(obj.group_rejected_nonce || 0);
      batchCounts.rejected_balance += Number(obj.group_rejected_balance || 0);
    }
  }
}

setInterval(async () => {
  try { await poll(); } catch (e) { console.log('[poll] err', e.message); return; }
  const now = Date.now();
  const dt = (now - lastT) / 1000;
  lastT = now;
  const dIn = counters.tx_ingested_total - prevCounters.tx_ingested_total;
  const dExec = counters.tx_executed_total - prevCounters.tx_executed_total;
  const dFrames = batchCounts.frames - prevBatch.frames;
  const dApplied = batchCounts.applied - prevBatch.applied;
  const rejTotal = counters.rej_invalid_format + counters.rej_sig_ingress
    + counters.rej_stale_nonce + counters.rej_mempool_full + counters.rej_other;
  const dRej = rejTotal - (prevCounters.rej_total || 0);
  prevCounters = { ...counters, rej_total: rejTotal };
  prevBatch = { ...batchCounts };
  console.log(
    '[' + new Date().toISOString().slice(11, 19) + '] ' +
    'tx_in=' + (dIn / dt).toFixed(1) + '/s  ' +
    'tx_exec=' + (dExec / dt).toFixed(1) + '/s  ' +
    'batches=' + (dFrames / dt).toFixed(1) + '/s  ' +
    'applied=' + (dApplied / dt).toFixed(1) + '/s  ' +
    'rej_delta=' + dRej + '  ' +
    'totals(in=' + counters.tx_ingested_total + ' exec=' + counters.tx_executed_total + ')'
  );
}, 5000);

process.on('SIGINT', () => { console.log('\\n[metrics] stopped'); process.exit(0); });
" "${LOG}"
