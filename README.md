# Subtick

Subtick executes transactions in ~130 ms — no blocks, no waiting.

**No blocks. No batching. No waiting.**

---

## Live Demo

→ **[https://subtick.dev/demo](https://subtick.dev/demo)**

Click **Send** → transaction executes in ~130 ms.

---

## Quickstart

```bash
npm install @subtick/sdk
```

```js
import { SubtickClient } from '@subtick/sdk';

const c = new SubtickClient({ baseUrl: 'https://subtick.dev' });
await c.health();
// { status: 'ok', height: …, slot: …, account_count: 8 }
```

---

## What it is

- Real-time execution (~130 ms)
- Signed transactions (Ed25519)
- Live state via WebSocket

It is **not** a token, a wallet, a DEX, or anything that promises money.

---

## API

```
https://subtick.dev
```

| Method | Path                 | Use                            |
|--------|----------------------|--------------------------------|
| GET    | `/health`            | liveness + chain status        |
| POST   | `/v1/tx`             | submit signed transaction      |
| GET    | `/v1/balance/:addr`  | balance                        |
| GET    | `/v1/account/:addr`  | balance + nonce                |
| WS     | `/v1/events`         | live execution stream          |

Full reference: [`subtick/API.md`](subtick/API.md).

---

## SDKs

- **JavaScript / TypeScript** — [`sdk/js/`](sdk/js/) · `npm install @subtick/sdk`
- **Python 3.9+** — [`sdk/python/`](sdk/python/) · `pip install subtick-sdk`

---

## Full example — signed transfer

```js
import { SubtickClient, buildSignedTransfer, derivePublicKey } from '@subtick/sdk';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const seed   = Buffer.from(readFileSync('user.key', 'utf8').trim(), 'hex');
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
├── subtick/         validator + executor + API binary
├── sdk/js/          @subtick/sdk
├── sdk/python/      subtick-sdk
├── apps/game/       game-economy demo (real txs, terminal)
├── apps/agents/     AI-agents-marketplace demo (real txs, terminal)
└── scripts/testnet/ 4-validator orchestration scripts
```

---

Try the demo → **[https://subtick.dev/demo](https://subtick.dev/demo)**

If it feels fast, give it a ⭐

---

## License

Subtick uses an **open-core** model:

| Tree                                 | License                        |
|--------------------------------------|--------------------------------|
| `subtick/` — chain core (validator, executor, API) | **Source-available, proprietary** ([LICENSE](LICENSE)) |
| `sdk/js/` — `@subtick/sdk`           | MIT ([sdk/js/LICENSE](sdk/js/LICENSE))         |
| `sdk/python/` — `subtick-sdk`        | MIT ([sdk/python/LICENSE](sdk/python/LICENSE)) |
| `apps/game/`, `apps/agents/` — demos | MIT ([apps/game/LICENSE](apps/game/LICENSE), [apps/agents/LICENSE](apps/agents/LICENSE)) |
| `scripts/` — testnet orchestration   | MIT ([scripts/LICENSE](scripts/LICENSE))       |

The chain core (`subtick/`) is **source-available and proprietary**. You
may view, read, and study the code, but you may not use, modify, or
distribute it — and you may not run it as a service or offer a competing
chain — without prior written permission. The SDKs and demos are MIT so
you can build on top of the public testnet freely.

For commercial licensing of the chain core, contact the project owners.

> Subtick is in a stabilization phase. Parts of the core will be opened
> progressively under more permissive licenses as the architecture
> stabilizes and the experiments settle.
