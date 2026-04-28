# @subtick/game — Phase 2A Game Economy MVP

First product on top of Subtick. A simulated trading economy that exercises
the [`@subtick/sdk`](../../sdk/js/) transport against a running `subtick api`.

> **What this is**: an off-chain ledger demo with N players who earn / send /
> trade gold and items, while every action submits a placeholder tx through
> the SDK so the chain sees a steady transport stream.
>
> **What this is NOT (yet)**: a real on-chain economy. The chain rejects
> placeholder txs with HTTP 400 — that rejection IS the transport-validation
> signal for v0. Real on-chain transfers wait for the tx-builder (a separate
> Phase 1 Step 3 deliverable). When that lands, swap `submitPlaceholder` in
> `src/actions.js` for a signed-Transfer constructor; nothing else changes.

## Why off-chain for v0?

Operator's hard rules for Phase 2A: no API change, no chain change, no
new endpoints, no tx-builder. The game has to consume only what's already
shipped (`@subtick/sdk` over the locked Phase 1 API). The cleanest split:

| Layer            | Lives in    | Purpose                                |
|------------------|-------------|----------------------------------------|
| Player + items   | game memory | Real game state                        |
| Gold transfers   | game memory | Real economy logic                     |
| Network calls    | SDK → API   | Validate transport under realistic mix |
| WS subscription  | SDK → API   | Validate the event channel             |

When the builder unblocks, the off-chain ledger flips role to a *cache* of
on-chain reads, and the placeholder tx becomes a real signed `Transfer`.

## Run

```bash
# 1. Start subtick with the API enabled (separate terminal):
cd ../../subtick
cargo build --release --features api
./target/release/subtick api \
    --config testnet_api_smoke/config.toml \
    --listen 127.0.0.1:18080

# 2. Install SDK deps (once):
cd ../sdk/js && npm install

# 3. Run the game:
cd ../../apps/game
node run.js                                  # defaults: 8 players, 1Hz, ∞
node run.js --base-url http://127.0.0.1:18080 --duration 60
node run.js --players 16 --tick-ms 250 --duration 30
```

### CLI flags

| Flag               | Default                    | Notes                                  |
|--------------------|----------------------------|----------------------------------------|
| `--base-url`       | `http://127.0.0.1:8080`    | API root                               |
| `--players`        | `8`                        | Player count (≥ 2)                     |
| `--tick-ms`        | `1000`                     | Time between actions                   |
| `--duration`       | `Infinity`                 | Run length in seconds (omit for forever)|
| `--starting-gold`  | `1000`                     | Initial balance per player             |
| `--items`          | `12`                       | World item count                       |
| `--no-ws`          | off                        | Skip WS subscription                   |

## Output

```
[game] base=http://127.0.0.1:18080 players=8 tick=1000ms duration=60s items=12
[game] api ok — height=0 accounts=4
[ws] connected
[stats] tick=10 acts(earn=4 xfer=4 trade=2 skip=0 err=0) sdk(acc=0 rej=10 tx=0 ?=0) lat(p50=2.1ms p95=3.8ms p99=5.0ms max=8.2ms) ws(frames=0 lagged=0) top=[a3f2c1:1085 7be4d2:1064 ...]
[stats] tick=20 acts(earn=11 xfer=6 trade=3 skip=0 err=0) sdk(acc=0 rej=20 tx=0 ?=0) lat(p50=2.0ms p95=3.6ms p99=5.1ms max=12.4ms) ws(frames=0 lagged=0) top=[...]
...
```

Field guide:

| Group   | Field         | Meaning                                                 |
|---------|---------------|---------------------------------------------------------|
| `acts`  | earn          | Successful "earn" actions (gold minted)                 |
|         | xfer          | Successful gold transfers                               |
|         | trade         | Successful item trades                                  |
|         | skip          | Action conditions unmet (sender empty, no items, etc.)  |
|         | err           | Unexpected exceptions (should be 0)                     |
| `sdk`   | acc           | API responded 202 (will be 0 with placeholders)         |
|         | rej           | API responded 4xx (`TxRejected`) — **expected** for v0  |
|         | tx            | TransportError (network failure, timeout)               |
|         | ?             | Unknown error class                                     |
| `lat`   | p50/p95/p99   | SDK round-trip latency in ms                            |
| `ws`    | frames        | `BatchExecuted` events received                         |
|         | lagged        | Slow-consumer skip-ahead notices                        |
| `top`   |               | Top 3 players by gold                                   |

## Architecture

```
┌──────────────────────────── apps/game ─────────────────────────────┐
│                                                                     │
│   run.js                                                            │
│     │ parse CLI, build players, start subscription                  │
│     ▼                                                               │
│   src/loop.js  ──pick action──▶ src/actions.js                     │
│     │                              │                                │
│     │                              ├─ ledger.earn/transfer/trade   │
│     │                              │  (off-chain economy)          │
│     │                              ▼                                │
│     │                         @subtick/sdk: client.sendTx(placeholder)│
│     │                              │                                │
│     │                              ▼                                │
│     │                    subtick api  →  HTTP 400 TxRejected          │
│     │                              ▼                                │
│     │                         (counted as `rej`)                    │
│     │                                                               │
│     ▼                                                               │
│   src/loop.js  ──stats every 10s──▶ stdout                          │
│                                                                     │
│   subscribeEvents(...) ── BatchExecuted frames ──▶ loop.noteWsFrame │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Design rules (don't break)

- ❌ no signing / bincode / wallet code in `apps/game/`
- ❌ no chain modifications, no new API endpoints
- ❌ no Subtick crate imports — every chain interaction goes through `@subtick/sdk`
- ❌ no off-chain *durable* state — ledger is in-memory; restart wipes it
- ✔ thin: action logic + ledger + SDK calls + stats — nothing else

## What flips when Phase 1 Step 3 (tx-builder) lands

A single function: `submitPlaceholder(client)` in `src/actions.js`. Replace
its body with:

```js
const tx = buildSignedTransfer(seller, buyer, price, /* nonce */);
const out = await client.sendTx(tx);
return { kind: 'accepted', latencyMs: ..., body: out };
```

…and stats will start showing `acc>0` while the chain produces real
`BatchExecuted` events. No other file changes required.

## Phase 2B handoff

When this loop is stable and visibly hitting rejection-as-expected at the
configured rate, Phase 2B (AI Agents) starts in `apps/agents/`. The AI
agents reuse this same ledger pattern — gold balances + SDK transport —
plus a simple request/response price-discovery flow.
