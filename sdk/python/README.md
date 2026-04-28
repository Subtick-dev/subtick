# subtick-sdk (Python)

Thin synchronous Python wrapper for the Subtick HTTP/WS API. **Transport-only —
no transaction building, no caching, no business logic.**

> Phase 1 Step 2. The SDK contract follows the [API contract](../../subtick/API.md)
> exactly. Anything not in the API is out of scope.

## Install

```bash
cd sdk/python
pip install -e .
# or, lighter:
pip install requests websocket-client
```

Requires **Python 3.9+**.

## Quick start

```python
from subtick_sdk import SubtickClient, subscribe_events, TxRejected

client = SubtickClient(base_url="http://127.0.0.1:8080")

# Read state — balance is a Python int (parsed from u128 decimal string).
acc = client.get_account("edd571b0cb522c030d9602321b5bf201a6d3feae235470e51d26da0f5f328d5d")
print(acc)        # Account(address='edd571...', balance=10000000000000000, nonce=0)

# Submit a pre-encoded signed tx (caller signs + bincodes; SDK is transport).
try:
    result = client.send_tx(tx_hex)
    print(result)  # TxResult(accepted=True, tx_hash='...', reason=None, retryable=False)
except TxRejected as e:
    print("rejected:", e, "retryable:", e.retryable)

# Live event stream — runs on a background thread.
sub = subscribe_events(
    "http://127.0.0.1:8080",
    on_event=lambda ev: print(ev),
)
# … later:
sub.stop()
```

## API

### `SubtickClient(base_url='http://127.0.0.1:8080', timeout_s=5.0, session=None)`

| Param         | Default                   | Notes                                    |
|---------------|---------------------------|------------------------------------------|
| `base_url`    | `http://127.0.0.1:8080`   | API root URL                             |
| `timeout_s`   | `5.0`                     | Per-request timeout                      |
| `session`     | new `requests.Session()`  | Reuse a connection-pooled session        |

### `client.send_tx(tx_hex: str) -> TxResult`

Submit a transaction. ``tx_hex`` is the hex-encoded ``bincode`` serialisation
of ``Transaction`` — identical to the wire format the network layer accepts
via ``Message::SubmitTx``. **The SDK does not sign / encode** — that's the
caller's job (or a future builder package).

Raises ``TxRejected`` on 4xx; the error carries ``.retryable``. Always
inspect that flag — it's the single source of truth for whether to backoff
and resend the same body or give up.

```python
@dataclass(frozen=True)
class TxResult:
    accepted: bool
    tx_hash: str | None
    reason: str | None
    retryable: bool
```

### `client.get_balance(address: str) -> int`

Returns the account balance as a Python ``int`` (Python ints are unbounded,
so no precision loss on u128).

Raises ``AccountNotFound`` if the account has never been touched.

### `client.get_account(address: str) -> Account`

Returns balance + nonce. ``nonce`` is the strictly-monotone tx counter —
your next signed transaction must use ``nonce + 1``.

```python
@dataclass(frozen=True)
class Account:
    address: str
    balance: int   # parsed losslessly
    nonce: int
```

### `client.health() -> Health`

Liveness probe.

### `subscribe_events(base_url, on_event, ...) -> EventSubscription`

Auto-reconnecting WebSocket subscriber. Backoff is fixed (1s → 2s → 4s,
capped at 10s). Runs on a background thread; ``.stop()`` is safe from any
thread.

| kwarg            | Default            | Purpose                                |
|------------------|--------------------|----------------------------------------|
| `auto_reconnect` | `True`             | Reconnect on close                     |
| `on_open`        | `noop`             | Called on every (re)connect            |
| `on_close`       | `noop`             | Called on every close                  |
| `on_error`       | `noop`             | Transport-level errors                 |
| `daemon`         | `True`             | Background thread daemon flag          |

Frame schema:

```python
{
  "type": "BatchExecuted",
  "shard_id": 0,
  "batch_id": "...",
  "state_root": "...",
  "group_applied_txs": 256,
  "group_rejected_nonce": 0,
  "group_rejected_balance": 0,
  "group_size": 1,
  "ts_unix_ms": 1745758000000,
}
```

Slow consumers receive a one-shot ``{"type": "Lagged", "skipped": N}``
instead of being disconnected. After a ``Lagged``, re-fetch any state you
cared about via ``get_account``.

## Errors

```python
from subtick_sdk import SubtickError, TxRejected, AccountNotFound, TransportError
```

| Class              | When                                              | `.retryable`        |
|--------------------|---------------------------------------------------|---------------------|
| `TxRejected`       | Server returned 4xx on `/v1/tx`                   | from server         |
| `AccountNotFound`  | 404 on `/v1/balance` or `/v1/account`             | `False`             |
| `TransportError`   | Network failure, timeout, malformed response      | `True`              |
| `SubtickError`       | Base class — anything else                         | varies              |

## Demo

```bash
# Combined: WS subscription + 1-tx-per-second send loop
python examples/python_demo.py
python examples/python_demo.py http://127.0.0.1:18080
```

The send loop posts an invalid hex blob; the API rejects it with
``TxRejected``. This is intentional for v0 — real signed-tx flow needs the
builder (Phase 1 Step 3).

## What this SDK is NOT

- **Not a wallet.** No key management, no signing.
- **Not a tx builder.** No bincode emitter, no scope/payload helpers.
- **Not a cache.** Every read hits the API.
- **Not an indexer.** No history, no filters, no search.

Build those on top — don't pile them inside the SDK.
