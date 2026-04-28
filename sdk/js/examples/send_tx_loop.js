// examples/send_tx_loop.js
//
// Sends one tx every 1 second to demonstrate the SDK's request/response path.
//
// **NOTE:** This v0 demo posts a placeholder hex blob — the API will reject
// it with HTTP 400 ("invalid signature" or similar). That's expected: it
// proves the SDK transport works end-to-end (request frames the call, the
// server validates and rejects, the SDK surfaces the typed `TxRejected`).
//
// A real signed-tx flow needs a transaction builder, which is Phase 1 Step 3
// (out of scope for the SDK package itself — SDK is transport-only).
//
// Usage:
//   node examples/send_tx_loop.js
//   node examples/send_tx_loop.js http://127.0.0.1:18080

import { SubtickClient, TxRejected, TransportError } from '../src/index.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:8080';
const client = new SubtickClient({ baseUrl });

// Placeholder hex — clearly invalid. Replace with real signed tx hex once
// the builder lands.
const PLACEHOLDER_TX_HEX =
  '01000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

let sent = 0;
let accepted = 0;
let rejected = 0;
let transport = 0;

console.log(`[send_tx_loop] base=${baseUrl} — Ctrl+C to stop`);

setInterval(async () => {
  sent += 1;
  try {
    const res = await client.sendTx(PLACEHOLDER_TX_HEX);
    accepted += 1;
    console.log(`#${sent} accepted: ${res.txHash}`);
  } catch (err) {
    if (err instanceof TxRejected) {
      rejected += 1;
      console.log(`#${sent} rejected: ${err.message} (retryable=${err.retryable})`);
    } else if (err instanceof TransportError) {
      transport += 1;
      console.log(`#${sent} transport error: ${err.message}`);
    } else {
      console.log(`#${sent} unknown error: ${err.message}`);
    }
  }
  if (sent % 10 === 0) {
    console.log(
      `  -- sent=${sent} accepted=${accepted} rejected=${rejected} transport=${transport}`,
    );
  }
}, 1000);
