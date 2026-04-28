// Public testnet end-to-end smoke — laptop → Hetzner server
// Verifies: pubkey derive, account read, signed transfer, balance delta.

import { SubtickClient, buildSignedTransfer, derivePublicKey, subscribeEvents } from '../src/index.js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE_URL = process.env.SUBTICK_RPC || 'https://subtick.dev';
const KEY_PATH = process.env.KEY || `${process.env.TEMP || '/tmp'}/user0.key`;

const seed = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
const client = new SubtickClient({ baseUrl: BASE_URL });

const sender = derivePublicKey(seed);
console.log(`[smoke] sender pubkey: ${sender.toString('hex')}`);

const before = await client.getAccount(sender.toString('hex'));
console.log(`[smoke] before:  balance=${before.balance} nonce=${before.nonce}`);

const slot = (await client.health()).slot;
const recipient = randomBytes(32);
const amount = 12345n;

const txHex = buildSignedTransfer({
  privateKey: seed,
  recipient,
  amount,
  nonce: BigInt(before.nonce),
  ttl: BigInt(slot) + 10000n,
});

const submitT0 = Date.now();
const result = await client.sendTx(txHex);
const submitMs = Date.now() - submitT0;
console.log(`[smoke] sendTx (${submitMs} ms): ${JSON.stringify(result)}`);

if (!result.accepted) {
  console.error('[smoke] FAIL — tx rejected');
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 1500));

const after = await client.getAccount(sender.toString('hex'));
console.log(`[smoke] after:   balance=${after.balance} nonce=${after.nonce}`);

const delta = BigInt(before.balance) - BigInt(after.balance);
const nonceDelta = after.nonce - before.nonce;

const recv = await client.getAccount(recipient.toString('hex'));
console.log(`[smoke] recipient: balance=${recv.balance}`);

const ok = delta === amount && nonceDelta === 1 && BigInt(recv.balance) === amount;
console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'} — sender_delta=${delta} nonce_delta=${nonceDelta} recipient=${recv.balance}`);
process.exit(ok ? 0 : 1);
