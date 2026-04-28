# Subtick Public Testnet

A 4-validator network you can talk to with `@subtick/sdk`. Quorum is 3 of 4,
so the chain keeps producing batches even if one validator goes down. The
API is a thin HTTP/WS facade in front of the executor; everything is real
on-chain state.

> **Status:** Phase 3 — testnet only. v0 contract: no auth, no rate limit,
> no fee burn yet. See [Known limits](#known-limits).

## Live public endpoint

```
https://subtick.dev
```

A 4-validator cluster running on a Hetzner Helsinki node. Anyone can talk
to it with the SDK — the four `user_*.key` seeds in `testnet_public/keys/`
are pre-funded on this network. Pick one (each has 1B units), mention which
one you took in the Discord/issues so others don't collide on nonces.

```bash
curl https://subtick.dev/health
# {"status":"ok","height":N,"slot":N,"account_count":8}
```

---

## TL;DR — first signed transaction in 5 minutes

```bash
# 1. Clone the SDK and install
git clone <this repo>
cd "Agis Chain/sdk/js"
npm install

# 2. Point at the public testnet
export SUBTICK_RPC=https://subtick.dev

# 3. Send a tx (uses the demo user_0 key included in this repo)
node -e "
import { SubtickClient, buildSignedTransfer, derivePublicKey } from './src/index.js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const seed = Buffer.from(readFileSync('../../testnet_public/keys/user_0.key', 'utf8').trim(), 'hex');
const client = new SubtickClient({ baseUrl: process.env.SUBTICK_RPC });
const sender = derivePublicKey(seed);
const acc = await client.getAccount(sender.toString('hex'));
const slot = (await client.health()).slot;

const tx = buildSignedTransfer({
  privateKey: seed,
  recipient: randomBytes(32),
  amount: 100n,
  nonce: acc.nonce,
  ttl: BigInt(slot) + 10000n,
});
const out = await client.sendTx(tx);
console.log('accepted', out);
" --input-type=module
```

If the API responds 202 with a tx hash, you're on. The matching `BatchExecuted`
frame will arrive on the WebSocket stream within ~1 second.

---

## What's running

```
┌─────────────────── public IP : 8080 ──────────────────┐
│   validator_0  (api + consensus + executor)            │
└──────────┬──────────┬──────────┬───────────────────────┘
           │ p2p      │ p2p      │ p2p
   ┌───────▼──┐  ┌────▼─────┐  ┌─▼────────┐
   │ validator│  │ validator│  │ validator│
   │     1    │  │    2     │  │    3     │
   └──────────┘  └──────────┘  └──────────┘
```

| Item            | Default                              | Public override                       |
|-----------------|--------------------------------------|---------------------------------------|
| API listen      | `127.0.0.1:8080`                     | `API_LISTEN=0.0.0.0:8080`             |
| P2P listen      | `127.0.0.1:1910{0..3}`               | per-node `[network] listen_addr`      |
| Quorum          | 3 of 4                               | unchanged                             |
| Sharding        | sharded, 4 active                    | unchanged                             |
| Block path      | disabled (Phase 6 executor sole)     | unchanged                             |
| Fee burn        | not yet (v0)                         | unchanged                             |

---

## Setup (operator)

```bash
# One-time: keys, genesis, configs, data dirs
./scripts/testnet/setup.sh

# Boot all 4 validators (validator_0 hosts the API)
./scripts/testnet/start-all.sh
# or for a public bind:
API_LISTEN=0.0.0.0:8080 ./scripts/testnet/start-all.sh

# Status + metrics
./scripts/testnet/health.sh
./scripts/testnet/metrics-tail.sh

# Stop
./scripts/testnet/stop-all.sh
```

`setup.sh` produces:
- `testnet_public/keys/validator_{0..3}.key` (10M staked, 100M balance each)
- `testnet_public/keys/user_{0..3}.key`      (1B balance each — give these to devs)
- `testnet_public/genesis.json`              (4 validators + 8 funded accounts)
- `testnet_public/configs/config_{0..3}.toml`

---

## Multi-machine deploy

The single-box default is for orchestration validation. To deploy on N hosts:

1. Run `setup.sh` once on a coordinating box — copies the genesis to all hosts.
2. Edit each `testnet_public/configs/config_${idx}.toml`:
   - `[network] listen_addr = "0.0.0.0:19100"`  (the same port for all hosts)
   - `[network] peers = ["host1.example.com:19100", "host2.example.com:19100", ...]` (omit self)
3. Open ports:
   - `8080` (HTTP/WS) — only on the API host (validator_0 by default)
   - `19100` (P2P) — on every validator
4. `setup.sh` doesn't need to run on validators 1–3 if you copy `keys/`, `genesis.json`, and the matching `config_${idx}.toml` to that host.
5. Each validator runs its own systemd unit / tmux pane (`subtick start --config ...` for 1/2/3, `subtick api --config ... --listen 0.0.0.0:8080` for 0). Same env vars as the local script.

Quorum tolerates one-node failure; you can roll restarts of validators 1, 2, or 3 without losing liveness.

---

## Developer onboarding

### Install the SDK

```bash
# JavaScript / Node 18+
npm install @subtick/sdk      # or use the local copy under sdk/js/

# Python 3.9+
pip install subtick-sdk        # or `pip install -e sdk/python/`
```

### Get a funded user key

The testnet ships with 4 pre-funded accounts under `testnet_public/keys/user_{0..3}.key`.
Pick one (each is funded with 1B units) — tell other devs which one you took
so you don't collide on nonces.

For production wallets you'd generate your own:

```js
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { derivePublicKey } from '@subtick/sdk';

const seed = randomBytes(32);
writeFileSync('mykey.bin', seed.toString('hex'));
console.log('pubkey:', derivePublicKey(seed).toString('hex'));
```

…then ask the operator to fund that pubkey via genesis on the next testnet
restart. (No on-chain faucet in v0.)

### Send your first signed transfer

```js
import {
  SubtickClient,
  buildSignedTransfer,
  derivePublicKey,
} from '@subtick/sdk';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const seed = Buffer.from(
  readFileSync('testnet_public/keys/user_0.key', 'utf8').trim(),
  'hex',
);
const client = new SubtickClient({ baseUrl: 'http://127.0.0.1:8080' });

const sender = derivePublicKey(seed);
const account = await client.getAccount(sender.toString('hex'));
const slot = (await client.health()).slot;

const txHex = buildSignedTransfer({
  privateKey: seed,
  recipient: randomBytes(32),
  amount: 100n,
  nonce: account.nonce,
  ttl: BigInt(slot) + 10_000n,
});

const result = await client.sendTx(txHex);
console.log(result);
// { accepted: true, txHash: '...', reason: null, retryable: false }
```

### Subscribe to live events

```js
import { subscribeEvents } from '@subtick/sdk';

subscribeEvents('http://127.0.0.1:8080', (event) => {
  if (event.type === 'BatchExecuted' && event.group_applied_txs > 0) {
    console.log('batch', event.batch_id.slice(0, 12), 'applied', event.group_applied_txs);
  }
});
```

Slow consumers receive a one-shot `{ type: 'Lagged', skipped: N }` instead
of being disconnected.

### Run the demo apps against the testnet

```bash
# Game economy — random earn / transfer / trade actions, real txs
BASE_URL=http://127.0.0.1:8080 \
KEY=testnet_public/keys/user_0.key \
node apps/game/run.js \
  --base-url "$BASE_URL" --players 8 --tick-ms 200 --duration 0 \
  --sender-key "$KEY"

# AI agents marketplace — request → quote → pay → execute, real txs
BASE_URL=http://127.0.0.1:8080 \
KEY=testnet_public/keys/user_1.key \
node apps/agents/run.js \
  --base-url "$BASE_URL" --buyers 2 --data 2 --compute 2 --tick-ms 200 \
  --duration 0 --sender-key "$KEY"
```

Use **different user keys** for game vs agents (they're distinct senders, so
no nonce contention between them).

### Python equivalent

```python
from subtick_sdk import SubtickClient, build_signed_transfer, derive_public_key
from pathlib import Path
import secrets

seed = bytes.fromhex(Path("testnet_public/keys/user_0.key").read_text().strip())
client = SubtickClient(base_url="http://127.0.0.1:8080")

sender = derive_public_key(seed)
account = client.get_account(sender.hex())
slot = client.health().slot

tx_hex = build_signed_transfer(
    private_key=seed,
    recipient=secrets.token_bytes(32),
    amount=100,
    nonce=account.nonce,
    ttl=slot + 10_000,
)
result = client.send_tx(tx_hex)
print(result)
```

---

## API reference (recap)

| Method | Path                 | Use                                  |
|--------|----------------------|--------------------------------------|
| GET    | `/health`            | `{status, height, slot, account_count}` |
| POST   | `/v1/tx`             | submit hex-encoded signed tx         |
| GET    | `/v1/balance/:addr`  | u128 balance as decimal string       |
| GET    | `/v1/account/:addr`  | balance + nonce                      |
| WS     | `/v1/events`         | `BatchExecuted` stream + `Lagged`    |

Full contract: [`subtick/API.md`](subtick/API.md).

---

## Known limits

| Limit                                | Why                                       |
|--------------------------------------|-------------------------------------------|
| No fee deduction yet                 | Phase 6 v1.5 executor — explicit deferral |
| Cross-shard recipient lands in sender's shadow | Same delta, single shard's commit thread; SDK reads cope via fallback scan |
| No auth / rate-limit on API          | Locked v0 contract — deliberate           |
| No historical queries / pagination   | Locked v0 contract — out of scope         |
| No persistence guarantees            | Genesis is fixed at boot; user-funded accounts are reset across testnet restarts unless you re-add them to genesis |
| No on-chain faucet                   | Devs claim from `testnet_public/keys/user_{0..3}.key` or ask the operator to fund their pubkey on the next reset |

Everything that ISN'T in this list is real:
- Real Ed25519 signatures
- Real SHA-256 canonical hashing
- Real sharded state, real DAG batches
- Real consensus (Phase 6 orderer + executor)
- Real WebSocket events tied to commit-thread

---

## Test scenarios validated locally

These ran end-to-end on a single box during Phase 3 bring-up. Each finishes
with `acc>0` / `comp>0`, 0 fatal errors. Reproduce by running the four
scripts (`setup.sh` + `start-all.sh` + the corresponding scenario).

| # | Scenario                | Result snippet                                        |
|---|-------------------------|-------------------------------------------------------|
| 1 | SDK single-user (smoke) | 4/4 PASS (nonce+1, balance−amount, recipient+amount, BatchExecuted) |
| 2 | Game only               | 50 ticks, **acc=50 / rej=0**, p99 5.9 ms, 28 WS frames |
| 3 | Agents only             | 23 paid cycles, **acc=23 / rej=0**, p99 3.9 ms        |
| 4 | Game + Agents (different sender keys) | both stable, 0 nonce contention             |
| 5 | External user (curl from another shell) | 200 OK on /tx with valid signed body       |

---

## Troubleshooting

| Symptom                                   | Fix                                                         |
|-------------------------------------------|-------------------------------------------------------------|
| `setup.sh` complains about `subtick` missing | Run `cargo build --release --features api` once             |
| `start-all.sh` says "API failed to come up" | Check `testnet_public/logs/validator_0.log` — usually peer connectivity or stale data dirs (`FRESH=1 ./scripts/testnet/start-all.sh`) |
| `acc=0` after running an app              | The chosen user key has drifted — re-pick a different user key OR wipe `testnet_public/data_*` and restart |
| `health.sh` says `DEAD` for a pid         | Validator crashed — log shows why; `start-all.sh` is idempotent on PIDs |
| `wscat` not installed                     | Use `node scripts/demo/event-monitor.js http://...`         |
| Cross-LAN performance worse than local    | TCP RTT dominates the orderer loop; per Phase 4B Step 4B.4 memory, expect ~50% of single-box throughput on real LAN |

---

## What's next

After the testnet is live and stable, **Phase 4** opens:
- Developer adoption (publish SDK to npm + PyPI)
- Small hackathon
- First external integrations
- Writing about real on-chain agent / game flows

Operator-driven from here. No more chain or API changes in v0.
