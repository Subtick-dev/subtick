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
├── sdk/js/          @subtick/sdk
├── sdk/python/      subtick-sdk
├── apps/game/       game-economy demo (real txs, terminal)
└── apps/agents/     AI-agents-marketplace demo (real txs, terminal)
```

---

Try the demo → **[https://subtick.dev/demo](https://subtick.dev/demo)**

If it feels fast, give it a ⭐

---

## License

Subtick uses an **open-core** model:

| Tree                                 | License                        |
|--------------------------------------|--------------------------------|
| Chain core (validator, executor, API) | **Private — not in this repo** |
| `sdk/js/` — `@subtick/sdk`           | MIT ([sdk/js/LICENSE](sdk/js/LICENSE))         |
| `sdk/python/` — `subtick-sdk`        | MIT ([sdk/python/LICENSE](sdk/python/LICENSE)) |
| `apps/game/`, `apps/agents/` — demos | MIT ([apps/game/LICENSE](apps/game/LICENSE), [apps/agents/LICENSE](apps/agents/LICENSE)) |
| `scripts/`                           | MIT ([scripts/LICENSE](scripts/LICENSE))       |

The chain core that powers `subtick.dev` is currently kept private. The
SDKs and demo apps in this repository are MIT-licensed so you can build
freely against the public testnet.

> Subtick is in a stabilization phase. Parts of the core will be opened
> progressively under permissive licenses as the architecture stabilizes
> and the experiments settle.

For commercial licensing, contact the project owners.
