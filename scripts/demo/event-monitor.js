#!/usr/bin/env node
// Phase 2C demo — `wscat`-free WebSocket event tail.
//
// Subscribes to /v1/events on a running subtick api and prints each frame in
// human-readable form. Built on @subtick/sdk so it auto-reconnects, surfaces
// `Lagged` notices, and prints rolling rate stats every 5 seconds.
//
// Usage:
//   node scripts/demo/event-monitor.js
//   node scripts/demo/event-monitor.js http://127.0.0.1:8080
//   node scripts/demo/event-monitor.js http://1.2.3.4:8080

import { subscribeEvents } from '../../sdk/js/src/index.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:8080';
console.log(`[monitor] tailing ${baseUrl}/v1/events — Ctrl+C to stop`);

let total = 0;
let totalApplied = 0;
let lagged = 0;
let lastRolloverAt = Date.now();
let lastRolloverTotal = 0;
let lastRolloverApplied = 0;

setInterval(() => {
  const now = Date.now();
  const elapsed = (now - lastRolloverAt) / 1000;
  const dFrames = total - lastRolloverTotal;
  const dApplied = totalApplied - lastRolloverApplied;
  console.log(
    `[stats]  frames/s=${(dFrames / elapsed).toFixed(1)}  ` +
      `applied/s=${(dApplied / elapsed).toFixed(1)}  ` +
      `total_frames=${total}  total_applied=${totalApplied}  lagged=${lagged}`,
  );
  lastRolloverAt = now;
  lastRolloverTotal = total;
  lastRolloverApplied = totalApplied;
}, 5000);

const sub = subscribeEvents(
  baseUrl,
  (event) => {
    if (event.type === 'Lagged') {
      lagged += 1;
      console.log(`[lag]    skipped=${event.skipped} (cumulative lag events: ${lagged})`);
      return;
    }
    if (event.type !== 'BatchExecuted') {
      return;
    }
    total += 1;
    totalApplied += Number(event.group_applied_txs || 0);
    if (event.group_applied_txs > 0) {
      console.log(
        `[batch]  shard=${event.shard_id}  applied=${event.group_applied_txs}  ` +
          `rejected_nonce=${event.group_rejected_nonce}  ` +
          `rejected_balance=${event.group_rejected_balance}  ` +
          `batch=${event.batch_id.slice(0, 12)}...  ` +
          `state_root=${event.state_root.slice(0, 12)}...`,
      );
    }
  },
  {
    onOpen: () => console.log('[ws]     connected'),
    onClose: (code, reason) =>
      console.log(`[ws]     closed code=${code} reason=${reason || '(none)'}`),
    onError: (err) => console.log(`[ws]     error: ${err.message}`),
  },
);

process.on('SIGINT', () => {
  console.log(
    `\n[monitor] stopping — total_frames=${total} total_applied=${totalApplied} lagged=${lagged}`,
  );
  sub.close();
  process.exit(0);
});
