# @subtick/sdk

Thin Node.js wrapper for the Subtick HTTP/WS API. **Transport-only — no
transaction building, no caching, no business logic.** Just the four
endpoints, surfaced idiomatically.

> Phase 1 Step 2. The SDK contract follows the [API contract](../../subtick/API.md)
> exactly. Anything not in the API is out of scope.

## Install

```bash
cd sdk/js
npm install
```

Requires **Node 18+** (uses the native `fetch`).

## Quick start

```js
import { SubtickClient, subscribeEvents } from '@subtick/sdk';

const client = new SubtickClient({ baseUrl: 'http://127.0.0.1:8080' });

// Read state
const acc = await client.getAccount('edd571b0cb522c030d9602321b5bf201a6d3feae235470e51d26da0f5f328d5d');
console.log(acc); // { address, balance: '10000000000000000', nonce: 0 }

// Submit a pre-encoded signed tx (caller signs + bincodes; SDK is transport)
const res = await client.sendTx(txHex);
// → { accepted: true, txHash: '...', reason: null, retryable: false }

// Live event stream
const sub = subscribeEvents('http://127.0.0.1:8080', (event) => {
  if (event.type === 'BatchExecuted') console.log(event);
});
// later: sub.close();
```

## API

### `new SubtickClient({ baseUrl, timeoutMs })`

| Option       | Default                    | Notes                              |
|--------------|----------------------------|------------------------------------|
| `baseUrl`    | `http://127.0.0.1:8080`    | API root URL                       |
| `timeoutMs`  | `5000`                     | Per-request timeout (HTTP only)    |

### `client.sendTx(txHex)` → `{ accepted, txHash, reason, retryable }`

Submit a transaction. `txHex` is the hex-encoded `bincode` serialisation of
`Transaction` — identical to the wire format the network layer accepts via
`Message::SubmitTx`. **The SDK does not sign / encode** — that's the caller's
job (or a future builder package).

Throws `TxRejected` on 4xx; the error carries `.retryable`. Always inspect
that flag — it's the single source of truth for whether to backoff and resend
the same body or give up.

### `client.getBalance(address)` → `{ address, balance }`

`balance` is **u128 as decimal string** — JSON numbers can't hold values
above 2⁵³. Parse to `BigInt`, never to `Number`.

```js
const { balance } = await client.getBalance(addr);
const wei = BigInt(balance);
```

Throws `AccountNotFound` if the account has never been touched.

### `client.getAccount(address)` → `{ address, balance, nonce }`

Same caveat on `balance`. `nonce` is the strictly-monotone tx counter — your
next signed transaction must use `nonce + 1`.

### `client.health()` → `{ status, height, slot, accountCount }`

Liveness probe.

### `subscribeEvents(baseUrl, onEvent, opts)` → `EventSubscription`

Auto-reconnecting WebSocket subscriber. Backoff is fixed (1s → 2s → 4s, capped
at 10s). Frames:

```jsonc
{ "type": "BatchExecuted", "shard_id": 0, "batch_id": "...",
  "state_root": "...", "group_applied_txs": 256, "group_size": 1,
  "ts_unix_ms": 1745758000000, ... }
```

Slow consumers receive a one-shot `{ "type": "Lagged", "skipped": N }` instead
of being disconnected. After a `Lagged`, re-fetch any state you cared about
via `getAccount`.

`opts`:

| Field            | Type      | Default | Purpose                                |
|------------------|-----------|---------|----------------------------------------|
| `autoReconnect`  | `bool`    | `true`  | Reconnect on close                     |
| `onOpen`         | `() => void`              | `noop` | Called on every (re)connect           |
| `onClose`        | `(code, reason) => void`  | `noop` | Called on every close                 |
| `onError`        | `(err) => void`           | `noop` | Transport-level errors                |

Returned `EventSubscription` has one method: `.close()`.

## Errors

```js
import { SubtickError, TxRejected, AccountNotFound, TransportError } from '@subtick/sdk';
```

| Class              | When                                              | `.retryable`        |
|--------------------|---------------------------------------------------|---------------------|
| `TxRejected`       | Server returned 4xx on `/v1/tx`                   | from server         |
| `AccountNotFound`  | 404 on `/v1/balance` or `/v1/account`             | `false`             |
| `TransportError`   | Network failure, timeout, malformed response      | `true`              |
| `SubtickError`       | Base class — anything else                         | varies              |

## Demo scripts

```bash
# Tail the BatchExecuted stream
node examples/listen_events.js
node examples/listen_events.js http://127.0.0.1:18080

# Send a placeholder tx every second (server returns 400 — proves transport)
node examples/send_tx_loop.js
```

The `send_tx_loop` demo posts an invalid hex blob; the API rejects it with
`TxRejected`. This is intentional for v0 — real signed-tx flow needs the
builder (Phase 1 Step 3).

## What this SDK is NOT

- **Not a wallet.** No key management, no signing.
- **Not a tx builder.** No bincode emitter, no scope/payload helpers.
- **Not a cache.** Every read hits the API.
- **Not an indexer.** No history, no filters, no search.

Build those on top — don't pile them inside the SDK.

## Compatibility

| SDK version | API version | Notes                          |
|-------------|-------------|--------------------------------|
| `0.1.x`     | `v1`        | Phase 1 — locked surface       |
