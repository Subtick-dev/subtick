// Phase 1 Step 3 smoke — real signed Transfer end-to-end.
//
// Steps:
//   1. Load testnet/keys/validator_0.key (genesis-funded sender).
//   2. Read sender's current nonce + slot from the API.
//   3. Build a signed Transfer to a random recipient.
//   4. Submit via SDK — expect HTTP 202 (`accepted: true`).
//   5. Subscribe to /v1/events and wait for a `BatchExecuted` frame.
//   6. Re-read sender + recipient via /v1/account; assert nonce + balances moved.
//
// Exits non-zero on any step that fails.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import {
  SubtickClient,
  buildSignedTransfer,
  derivePublicKey,
  subscribeEvents,
} from '../src/index.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:18080';
const keyPath = process.argv[3] || '../../subtick/testnet/keys/validator_0.key';

console.log(`[smoke] base=${baseUrl} key=${keyPath}`);

// 1. Load the sender's key (hex-encoded 32-byte seed).
const seedHex = readFileSync(keyPath, 'utf8').trim();
const seed = Buffer.from(seedHex, 'hex');
if (seed.length !== 32) {
  console.error(`[smoke] expected 32-byte hex seed, got ${seed.length} bytes`);
  process.exit(2);
}
const senderPub = derivePublicKey(seed);
const senderHex = senderPub.toString('hex');
console.log(`[smoke] sender pubkey: ${senderHex}`);

const client = new SubtickClient({ baseUrl });

// 2. Health + sender state.
const health = await client.health();
console.log(`[smoke] api ok — height=${health.height} slot=${health.slot}`);

const senderBefore = await client.getAccount(senderHex);
console.log(`[smoke] sender before — balance=${senderBefore.balance} nonce=${senderBefore.nonce}`);

// 3. Build the tx.
const recipient = randomBytes(32);
const recipientHex = recipient.toString('hex');
const amount = 100n;
const ttl = BigInt(health.slot) + 10_000n;

const txHex = buildSignedTransfer({
  privateKey: seed,
  senderPubkey: senderPub,
  recipient,
  amount,
  nonce: senderBefore.nonce,
  ttl,
});
console.log(
  `[smoke] tx built — recipient=${recipientHex.slice(0, 12)}... amount=${amount} ` +
    `nonce=${senderBefore.nonce} ttl=${ttl} hex_len=${txHex.length}`,
);

// 4. Subscribe BEFORE submit so we don't miss the executed frame.
//    Wait for a frame that ACTUALLY applied a tx (group_applied_txs > 0) —
//    the orderer fires empty BatchExecuted frames every round when there's
//    nothing pending, so we have to filter past those to find ours.
let executedFrame = null;
let allFrames = 0;
const sub = subscribeEvents(
  baseUrl,
  (event) => {
    if (event.type !== 'BatchExecuted') return;
    allFrames += 1;
    console.log(
      `[ws] frame#${allFrames} shard=${event.shard_id} ` +
        `applied=${event.group_applied_txs} ` +
        `rej_nonce=${event.group_rejected_nonce} ` +
        `rej_bal=${event.group_rejected_balance} ` +
        `batch=${event.batch_id.slice(0, 12)}...`,
    );
    if (executedFrame === null && event.group_applied_txs > 0) {
      executedFrame = event;
    }
  },
  {
    onOpen: () => console.log('[ws] connected'),
    onError: (err) => console.log(`[ws] error: ${err.message}`),
  },
);

// Give the WS upgrade ~250ms to settle.
await sleep(250);

// 5. Submit.
let submit;
try {
  submit = await client.sendTx(txHex);
  console.log(`[smoke] sendTx accepted: ${submit.txHash}`);
} catch (err) {
  console.error(`[smoke] sendTx FAILED: ${err.message} (status=${err.status})`);
  sub.close();
  process.exit(3);
}
if (!submit.accepted) {
  console.error(`[smoke] expected accepted=true, got ${JSON.stringify(submit)}`);
  sub.close();
  process.exit(4);
}

// 6. Wait up to 10 s for a BatchExecuted frame.
const frameDeadline = Date.now() + 10_000;
while (executedFrame === null && Date.now() < frameDeadline) {
  await sleep(100);
}
if (executedFrame === null) {
  console.error('[smoke] no BatchExecuted frame received within 10s — block path may be off');
  sub.close();
  process.exit(5);
}

// 7. Re-read state.
await sleep(500); // let state apply settle
const senderAfter = await client.getAccount(senderHex);
console.log(`[smoke] sender after — balance=${senderAfter.balance} nonce=${senderAfter.nonce}`);

let recipientAfter;
try {
  recipientAfter = await client.getAccount(recipientHex);
  console.log(
    `[smoke] recipient after — balance=${recipientAfter.balance} nonce=${recipientAfter.nonce}`,
  );
} catch (err) {
  console.log(`[smoke] recipient lookup: ${err.message}`);
  recipientAfter = { balance: '0', nonce: 0 };
}

// 8. Assertions.
const senderBeforeBal = BigInt(senderBefore.balance);
const senderAfterBal = BigInt(senderAfter.balance);
const recipientAfterBal = BigInt(recipientAfter.balance);

const balanceDelta = senderBeforeBal - senderAfterBal;
const nonceDelta = senderAfter.nonce - senderBefore.nonce;

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

// Note (v0 executor — apply_batch_to_delta in dag/state_apply.rs):
// The Phase 6 v1.5 executor's apply phase deducts the transferred AMOUNT
// only, not the fee. Fee burn / validator reward is out of scope until the
// executor's economic finalisation step lands. So the sender balance delta
// equals exactly `amount`, not `amount + fee`.
check('nonce incremented by 1', nonceDelta === 1, `delta=${nonceDelta}`);
check(
  'sender balance dropped by amount (v0 executor: no fee burn yet)',
  balanceDelta === amount,
  `delta=${balanceDelta} expected=${amount}`,
);
check('recipient credited by amount', recipientAfterBal === amount, `recipient=${recipientAfterBal}`);
check('BatchExecuted applied=1 frame received', executedFrame !== null, '<no frame>');

sub.close();
console.log(`\nresult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
