// examples/listen_events.js
//
// Subscribes to the API's BatchExecuted stream and prints frames as they
// arrive. Demonstrates the SDK's WS subscriber, including auto-reconnect
// and the `Lagged` slow-consumer signal.
//
// To see real BatchExecuted events, run a 4-validator testnet and drive
// load with `subtick fast-load` in another terminal — this script just reads.
//
// Usage:
//   node examples/listen_events.js
//   node examples/listen_events.js http://127.0.0.1:18080

import { subscribeEvents } from '../src/index.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:8080';
console.log(`[listen_events] connecting to ${baseUrl}/v1/events — Ctrl+C to stop`);

let frames = 0;
let lagged = 0;

const sub = subscribeEvents(
  baseUrl,
  (event) => {
    frames += 1;
    if (event.type === 'Lagged') {
      lagged += 1;
      console.log(`[lag] skipped=${event.skipped} (total lag events: ${lagged})`);
      return;
    }
    if (event.type === 'BatchExecuted') {
      console.log(
        `#${frames} BatchExecuted shard=${event.shard_id} batch=${event.batch_id.slice(0, 12)}... ` +
          `applied=${event.group_applied_txs} size=${event.group_size} ts=${event.ts_unix_ms}`,
      );
      return;
    }
    console.log(`#${frames} ${event.type ?? '<unknown>'}: ${JSON.stringify(event)}`);
  },
  {
    onOpen: () => console.log('[ws] connected'),
    onClose: (code, reason) =>
      console.log(`[ws] closed code=${code} reason=${reason || '(none)'}`),
    onError: (err) => console.log(`[ws] error: ${err.message}`),
  },
);

process.on('SIGINT', () => {
  console.log(`\n[listen_events] stopping — frames=${frames} lagged=${lagged}`);
  sub.close();
  process.exit(0);
});
