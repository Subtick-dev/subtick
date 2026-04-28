// Entry point: parse CLI flags, construct ledger + client + loop, run.
//
// Usage:
//   node run.js                                   # 8 players, 1Hz, until Ctrl+C
//   node run.js --players 16 --tick-ms 250
//   node run.js --base-url http://127.0.0.1:18080 --duration 60
//   node run.js --no-ws                           # skip the event subscription

import { readFileSync } from 'node:fs';

import { SubtickClient, subscribeEvents } from '../../sdk/js/src/index.js';
import { Ledger } from './src/ledger.js';
import { GameLoop } from './src/loop.js';
import { PlaceholderSubmitter, RealTxSubmitter } from './src/chain.js';
import { randomAddress } from './src/utils.js';

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.baseUrl ?? 'http://127.0.0.1:8080';
const playerCount = Number(args.players ?? 8);
const tickMs = Number(args.tickMs ?? 1000);
// `--duration 0` (or omitted) → run forever. Any positive number is in seconds.
const durationRaw = args.duration === undefined ? 0 : Number(args.duration);
const durationS = durationRaw <= 0 ? Infinity : durationRaw;
const startingGold = Number(args.startingGold ?? 1000);
const itemCount = Number(args.items ?? 12);
const enableWs = !args.noWs;
const senderKeyPath = typeof args.senderKey === 'string' ? args.senderKey : null;

if (!Number.isFinite(playerCount) || playerCount < 2) {
  console.error('--players must be >= 2');
  process.exit(2);
}

const players = Array.from({ length: playerCount }, () => randomAddress());
const ledger = new Ledger(players, startingGold, itemCount);
const client = new SubtickClient({ baseUrl, timeoutMs: 5000 });

console.log(
  `[game] base=${baseUrl} players=${playerCount} tick=${tickMs}ms ` +
    `duration=${durationS === Infinity ? '∞' : `${durationS}s`} items=${itemCount}`,
);

// Health check first so we fail fast if the API isn't reachable.
try {
  const h = await client.health();
  console.log(`[game] api ok — height=${h.height} accounts=${h.accountCount}`);
} catch (err) {
  console.error(`[game] api unreachable at ${baseUrl}: ${err.message}`);
  process.exit(3);
}

// Submitter — placeholder by default, real signed Transfers when --sender-key is given.
let submitter;
if (senderKeyPath) {
  const seedHex = readFileSync(senderKeyPath, 'utf8').trim();
  const seed = Buffer.from(seedHex, 'hex');
  if (seed.length !== 32) {
    console.error(`[game] sender key must be 32-byte hex (got ${seed.length})`);
    process.exit(2);
  }
  submitter = new RealTxSubmitter({
    client,
    privateKey: seed,
    recipientPool: players,
    amount: 1n,
  });
  const meta = await submitter.init();
  console.log(
    `[game] real-tx mode: sender=${meta.sender.slice(0, 12)}... ` +
      `nonce=${meta.startingNonce} balance=${meta.startingBalance} ttl=${meta.ttl}`,
  );
} else {
  submitter = new PlaceholderSubmitter(client);
  console.log('[game] placeholder mode: every action posts an invalid hex blob (server returns 400)');
}

// WebSocket event subscription (optional — game doesn't depend on it).
let sub = null;
const loop = new GameLoop({
  ledger,
  players,
  client,
  submitter,
  tickMs,
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
  console.log('\n[game] SIGINT — stopping');
  loop.stop();
  if (sub) sub.close();
});

await loop.run(durationS === Infinity ? Infinity : durationS * 1000);

if (sub) sub.close();
console.log('[game] exited cleanly');
process.exit(0);

// ── argv parser ────────────────────────────────────────────────────────────

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
