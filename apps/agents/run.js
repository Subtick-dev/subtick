// Entry point: build buyers + providers, wire ledger + client + loop, run.
//
// Usage:
//   node run.js
//   node run.js --duration 30
//   node run.js --base-url http://127.0.0.1:18080 --buyers 2 --data 2 --compute 2
//   node run.js --verbose --duration 10
//   node run.js --tick-ms 100 --no-ws

import { readFileSync } from 'node:fs';

import { SubtickClient, subscribeEvents } from '../../sdk/js/src/index.js';
import {
  BuyerAgent,
  ComputeAgent,
  DataAgent,
} from './src/agents.js';
import { AgentLedger } from './src/state.js';
import { AgentLoop } from './src/loop.js';
import { PlaceholderSubmitter, RealTxSubmitter } from './src/chain.js';
import { randomAddress } from './src/utils.js';

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.baseUrl ?? 'http://127.0.0.1:8080';
const buyerCount = num(args.buyers, 2);
const dataCount = num(args.data, 2);
const computeCount = num(args.compute, 2);
const tickMs = num(args.tickMs, 500);
// `--duration 0` (or omitted) → run forever. Any positive number is in seconds.
const durationRawS = args.duration === undefined ? 0 : num(args.duration, 0);
const durationS = durationRawS <= 0 ? Infinity : durationRawS;
const verbose = !!args.verbose;
const enableWs = !args.noWs;
const senderKeyPath = typeof args.senderKey === 'string' ? args.senderKey : null;

if (buyerCount < 1) fatal('--buyers must be >= 1');
if (dataCount + computeCount < 1) fatal('need at least one provider (--data or --compute)');

// ── Build the cast ────────────────────────────────────────────────────────

const buyers = [];
for (let i = 0; i < buyerCount; i += 1) {
  buyers.push(new BuyerAgent({ id: `buyer_${i + 1}`, startingGold: 5_000 }));
}
const providers = [];
for (let i = 0; i < dataCount; i += 1) {
  providers.push(new DataAgent({ id: `data_${i + 1}` }));
}
for (let i = 0; i < computeCount; i += 1) {
  providers.push(new ComputeAgent({ id: `compute_${i + 1}` }));
}

const ledger = new AgentLedger([...buyers, ...providers]);
const client = new SubtickClient({ baseUrl, timeoutMs: 5000 });

console.log(
  `[agents] base=${baseUrl} buyers=${buyerCount} data=${dataCount} compute=${computeCount} ` +
    `tick=${tickMs}ms duration=${durationS === Infinity ? '∞' : `${durationS}s`} verbose=${verbose}`,
);

try {
  const h = await client.health();
  console.log(`[agents] api ok — height=${h.height} accounts=${h.accountCount}`);
} catch (err) {
  console.error(`[agents] api unreachable at ${baseUrl}: ${err.message}`);
  process.exit(3);
}

// ── Submitter — placeholder by default, real-tx when --sender-key is given.
let submitter;
if (senderKeyPath) {
  const seedHex = readFileSync(senderKeyPath, 'utf8').trim();
  const seed = Buffer.from(seedHex, 'hex');
  if (seed.length !== 32) {
    console.error(`[agents] sender key must be 32-byte hex (got ${seed.length})`);
    process.exit(2);
  }
  // Recipients = synthetic 32-byte addresses, one per agent. We don't reuse
  // agent.id (that's a string label), and reusing the validator's pubkey would
  // self-pay — so generate fresh addresses at startup. Kept hex-encoded.
  const recipientPool = [...buyers, ...providers].map(() => randomAddress());
  submitter = new RealTxSubmitter({
    client,
    privateKey: seed,
    recipientPool,
    amount: 1n,
  });
  const meta = await submitter.init();
  console.log(
    `[agents] real-tx mode: sender=${meta.sender.slice(0, 12)}... ` +
      `nonce=${meta.startingNonce} balance=${meta.startingBalance} ttl=${meta.ttl}`,
  );
} else {
  submitter = new PlaceholderSubmitter(client);
  console.log('[agents] placeholder mode: every cycle posts an invalid hex blob (server returns 400)');
}

// ── WS subscription (optional) ────────────────────────────────────────────

let sub = null;
const loop = new AgentLoop({
  buyers,
  providers,
  ledger,
  client,
  submitter,
  tickMs,
  verbose,
});

if (enableWs) {
  sub = subscribeEvents(
    baseUrl,
    (event) => loop.noteWsFrame(event),
    {
      onOpen: () => console.log('[ws] connected'),
      onClose: (code, reason) =>
        console.log(`[ws] closed code=${code} reason=${reason || '(none)'}`),
      onError: (err) => console.log(`[ws] error: ${err.message}`),
    },
  );
}

process.on('SIGINT', () => {
  console.log('\n[agents] SIGINT — stopping');
  loop.stop();
  if (sub) sub.close();
});

await loop.run(durationS === Infinity ? Infinity : durationS * 1000);

if (sub) sub.close();
console.log('[agents] exited cleanly');
process.exit(0);

// ── argv parser (mirror of game's) ────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = camel(a.slice(2));
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function num(v, dflt) {
  if (v === undefined || v === true) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) fatal(`expected number, got: ${v}`);
  return n;
}

function fatal(msg) {
  console.error(msg);
  process.exit(2);
}
