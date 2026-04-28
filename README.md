# Subtick

Subtick is a real-time execution network.

**No blocks. No waiting.**

Send a transaction → it executes in ~130 ms.

> **Live demo:** [https://subtick.dev/demo](https://subtick.dev/demo) — click the button, watch a real signed transfer execute end-to-end against a live network with the latency printed every time.
>
> **API:** [https://subtick.dev](https://subtick.dev)

---

## 30-second quickstart

```bash
npm install @subtick/sdk
```

```js
import { SubtickClient, buildSignedTransfer, derivePublicKey } from '@subtick/sdk';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const seed = Buffer.from(readFileSync('user.key', 'utf8').trim(), 'hex');
const client = new SubtickClient({ baseUrl: 'https://subtick.dev' });

const sender  = derivePublicKey(seed);
const account = await client.getAccount(sender.toString('hex'));
const slot    = (await client.health()).slot;

const tx = buildSignedTransfer({
  privateKey: seed,
  recipient: randomBytes(32),
  amount: 100n,
  nonce: account.nonce,
  ttl: BigInt(slot) + 10_000n,
});

await client.sendTx(tx);
// { accepted: true, txHash: '…' }
```

Pre-funded test keys ship under `testnet_public/keys/user_{0..3}.key` —
each holds 1 B units. Real Ed25519 signatures, real on-chain state, no mock.

---

## What it is

Subtick is real-time transaction execution.

Every transaction is signed in the SDK, accepted by an HTTP API in single-digit milliseconds, and applied to live state in about 130 ms — visible to anyone subscribed to the WebSocket stream the moment it executes.

It is built for AI agents (which need to pay each other in real time) and game economies (which generate one transaction per player action).

It is **not** a token, a wallet, a DEX, or anything that promises money.

---

## What it isn't

- A blockchain (no blocks)
- A token launch (no token)
- A wallet (BYO Ed25519 key)
- An exchange (no orderbook, no AMM)

---

## API

| Method | Path                 | Use                                  |
|--------|----------------------|--------------------------------------|
| GET    | `/health`            | liveness + chain status              |
| POST   | `/v1/tx`             | submit hex-encoded signed tx         |
| GET    | `/v1/balance/:addr`  | u128 balance as decimal string       |
| GET    | `/v1/account/:addr`  | balance + nonce                      |
| WS     | `/v1/events`         | live execution stream                |

Full reference: [`subtick/API.md`](subtick/API.md).

---

## SDKs

- **JavaScript / TypeScript** — [`sdk/js/`](sdk/js/) · `npm install @subtick/sdk`
- **Python 3.9+** — [`sdk/python/`](sdk/python/) · `pip install subtick-sdk`

Both ship a transport client + canonical TX builder + Ed25519 signer.
Wire format is identical across both.

---

## Run a node yourself

The same code that runs the public testnet runs locally. See
[`TESTNET.md`](TESTNET.md) for the 4-validator orchestration scripts —
boots a full network on a single box in under a minute.

```bash
./scripts/testnet/setup.sh
./scripts/testnet/start-all.sh
curl http://127.0.0.1:8080/health
```

---

## Status

| Layer            | Status   |
|------------------|----------|
| HTTP/WS API      | live     |
| JS + Python SDKs | live     |
| Public testnet   | live (`subtick.dev`) |
| Mainnet token    | not planned for this phase |

Honest about what's missing in the v0 contract:
- No fee deduction yet (explicit deferral)
- No auth, no rate limit, no historical queries on the API
- No on-chain faucet (claim a `user_*.key` from the bundle)

See [`TESTNET.md` § Known limits](TESTNET.md#known-limits) for the full list.

---

## Layout

```
.
├── subtick/         Rust validator + executor + API binary
├── sdk/js/          @subtick/sdk
├── sdk/python/      subtick-sdk
├── apps/game/       game-economy demo (real txs, terminal)
├── apps/agents/     AI-agents-marketplace demo (real txs, terminal)
└── scripts/testnet/ 4-validator orchestration scripts
```

---

Built in the open. PRs welcome. License: MIT.
