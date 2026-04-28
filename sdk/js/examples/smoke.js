// Smoke harness for the JS SDK against a running subtick api.
// Exits non-zero if any step fails. Used by the Phase 1 Step 2 validation.

import {
  SubtickClient,
  subscribeEvents,
  AccountNotFound,
  TxRejected,
  TransportError,
} from '../src/index.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:18080';
const KNOWN_ADDR =
  'edd571b0cb522c030d9602321b5bf201a6d3feae235470e51d26da0f5f328d5d';
const ZERO_ADDR =
  '0000000000000000000000000000000000000000000000000000000000000000';

let pass = 0;
let fail = 0;
function ok(name) {
  pass += 1;
  console.log(`PASS ${name}`);
}
function bad(name, err) {
  fail += 1;
  console.log(`FAIL ${name}: ${err?.message ?? err}`);
}

const client = new SubtickClient({ baseUrl });

async function main() {
  // 1. health
  try {
    const h = await client.health();
    if (h.status === 'ok' && h.accountCount > 0) ok('health');
    else bad('health', `unexpected payload ${JSON.stringify(h)}`);
  } catch (e) {
    bad('health', e);
  }

  // 2. balance for funded account
  try {
    const b = await client.getBalance(KNOWN_ADDR);
    if (typeof b.balance === 'string' && BigInt(b.balance) > 0n) ok('getBalance funded');
    else bad('getBalance funded', `unexpected ${JSON.stringify(b)}`);
  } catch (e) {
    bad('getBalance funded', e);
  }

  // 3. account for funded account (balance + nonce)
  try {
    const a = await client.getAccount(KNOWN_ADDR);
    if (a.address === KNOWN_ADDR && BigInt(a.balance) > 0n && a.nonce === 0) ok('getAccount funded');
    else bad('getAccount funded', `unexpected ${JSON.stringify(a)}`);
  } catch (e) {
    bad('getAccount funded', e);
  }

  // 4. balance for unknown account → AccountNotFound
  try {
    await client.getBalance(ZERO_ADDR);
    bad('getBalance zero-addr', 'expected AccountNotFound');
  } catch (e) {
    if (e instanceof AccountNotFound) ok('getBalance zero-addr → AccountNotFound');
    else bad('getBalance zero-addr', e);
  }

  // 5. sendTx with placeholder hex → TxRejected (4xx)
  try {
    await client.sendTx('deadbeef');
    bad('sendTx invalid', 'expected TxRejected');
  } catch (e) {
    if (e instanceof TxRejected) ok(`sendTx invalid → TxRejected (status=${e.status})`);
    else bad('sendTx invalid', e);
  }

  // 6. sendTx with non-hex → TxRejected
  try {
    await client.sendTx('zzzz');
    bad('sendTx non-hex', 'expected TxRejected');
  } catch (e) {
    if (e instanceof TxRejected) ok('sendTx non-hex → TxRejected');
    else bad('sendTx non-hex', e);
  }

  // 7. WS subscription opens (we don't expect events under this idle smoke,
  //    but the open callback proves the upgrade worked).
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      bad('subscribeEvents open', 'no onOpen within 3s');
      sub.close();
      resolve();
    }, 3000);
    const sub = subscribeEvents(
      baseUrl,
      () => {}, // ignore events
      {
        onOpen: () => {
          clearTimeout(timeout);
          ok('subscribeEvents → onOpen');
          sub.close();
          resolve();
        },
        onError: () => {},
      },
    );
  });

  // 8. transport error: refuse a closed port → TransportError
  try {
    const dead = new SubtickClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1500 });
    await dead.health();
    bad('TransportError on closed port', 'expected TransportError');
  } catch (e) {
    if (e instanceof TransportError) ok('TransportError on closed port');
    else bad('TransportError on closed port', e);
  }

  console.log(`\nresult: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(2);
});
