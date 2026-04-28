# @subtick/agents — Phase 2B AI Agents MVP

Machine economy on top of Subtick. Three agent types — **Buyer**, **Data**,
**Compute** — run an in-memory request → quote → pay → execute handshake,
exercising the [`@subtick/sdk`](../../sdk/js/) transport against a running
`subtick api`.

> **What this is**: a deterministic in-process protocol where a buyer asks
> for a task, eligible providers quote, the buyer picks the lowest fitting
> price, "pays" by submitting a placeholder tx through the SDK, and the
> winning provider returns a mock result.
>
> **What this is NOT (yet)**: a real on-chain marketplace. Same as `apps/game/`,
> the chain rejects placeholder txs with HTTP 400 — that's the v0 transport
> validation signal. Real on-chain payments wait for the tx-builder.

## Why in-memory for v0?

Operator's hard rules for Phase 2B:
- ❌ no networking between agents (no socket, no IPC)
- ❌ no persistence (restart wipes all state)
- ❌ no async complexity (single tick = one full cycle)
- ❌ no tx-builder yet
- ✔ deterministic flow per cycle
- ✔ same SDK + API surface as Phase 1 / 2A

In-memory keeps the demo a tight 200-line core; agent-to-agent networking
is a separate concern that belongs to a later phase.

## Run

```bash
# 1. Make sure subtick api is running (separate terminal):
cd ../../subtick
./target/release/subtick api \
    --config testnet_api_smoke/config.toml \
    --listen 127.0.0.1:18080

# 2. Make sure the SDK has its npm deps:
cd ../sdk/js && npm install

# 3. Run the agents:
cd ../../apps/agents
node run.js                                      # 2 buyers, 2 data, 2 compute, 500ms tick, ∞
node run.js --duration 30                        # finite run
node run.js --verbose --duration 10              # one line per protocol phase
node run.js --buyers 4 --data 3 --compute 3      # bigger marketplace
node run.js --tick-ms 100 --duration 30          # 10 cycles/sec
```

### CLI flags

| Flag           | Default                    | Notes                                   |
|----------------|----------------------------|-----------------------------------------|
| `--base-url`   | `http://127.0.0.1:8080`    | API root                                |
| `--buyers`     | `2`                        | Buyer agents (round-robin per cycle)    |
| `--data`       | `2`                        | DataAgent providers                     |
| `--compute`    | `2`                        | ComputeAgent providers                  |
| `--tick-ms`    | `500`                      | Time between cycles                     |
| `--duration`   | `Infinity`                 | Run length in seconds                   |
| `--verbose`    | off                        | One log line per protocol phase         |
| `--no-ws`      | off                        | Skip WS subscription                    |

## Protocol

Each tick runs one cycle:

```
buyer.makeRequest() ────┐
                         │ { id, type ∈ {data,compute}, budget }
                         ▼
   eligible providers ─▶ quote() ─▶ [{agentId, price, eta_ms}, …]
                         │
                         ▼
   buyer.pickBest(quotes, budget)
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       null (all over budget)   winner
              │                     │
       outcome=abandoned            ▼
                          submitPlaceholder(client)
                                    │  ← HTTP 400 = success signal v0
                                    ▼
                          ledger.transfer(buyer, winner, price)
                                    │
                                    ▼
                          winner.execute(req)
                                    │
                                    ▼
                                outcome=completed
```

A cycle has three possible outcomes:

| Outcome      | Trigger                                | Counter   |
|--------------|----------------------------------------|-----------|
| `completed`  | Winner exists + buyer has gold         | `comp`    |
| `abandoned`  | All quotes exceed buyer's budget       | `abn`     |
| `skipped`    | No eligible providers, or buyer broke  | `skp`     |

## Output (default — compact)

```
[agents] base=http://127.0.0.1:18080 buyers=2 data=2 compute=2 tick=500ms duration=30s verbose=false
[agents] api ok — height=0 accounts=4
[ws] connected
#1 req(data, b=72) accept(data_2:48) pay(rej, 1.7ms) done(took=0.0ms)
#2 req(compute, b=104) accept(compute_1:75) pay(rej, 1.5ms) done(took=0.0ms)
#3 req(data, b=39) abandon(all-over-budget)
#4 req(compute, b=130) accept(compute_2:88) pay(rej, 1.4ms) done(took=0.0ms)
...
[stats] cycle=20 out(comp=14 abn=6 skp=0 err=0) sdk(acc=0 rej=14 tx=0 ?=0) lat(p50=1.6ms p95=3.1ms p99=4.0ms) cycle(p95=3.5ms) ws(0/0) top=[data_2:1240 compute_1:980 ...] gold_total=10000
[FINAL] cycle=58 out(comp=39 abn=18 skp=1 err=0) sdk(acc=0 rej=39 ...) ...
```

## Output (`--verbose`)

```
  → request req_0001/data budget=72 buyer=buyer_1
  ← quotes  req_0001/data [data_1:55/8ms data_2:48/4ms]
  ✓ accept  req_0001/data winner=data_2 price=48
  $ pay     req_0001/data kind=rejected latency=1.7ms
  ★ done    req_0001/data took=0.0ms
```

## Field guide

| Group     | Field        | Meaning                                                  |
|-----------|--------------|----------------------------------------------------------|
| `out`     | comp         | Cycles that paid + executed                              |
|           | abn          | All quotes were over budget — buyer walked away          |
|           | skp          | No eligible agents OR buyer's local gold < winning quote |
|           | err          | Unexpected exceptions (must be 0)                        |
| `sdk`     | acc          | API responded 202 (will be 0 with placeholders)          |
|           | rej          | API responded 4xx (`TxRejected`) — **expected** for v0   |
|           | tx           | TransportError                                           |
|           | ?            | Unknown error class                                      |
| `lat`     | p50/p95/p99  | SDK round-trip latency                                   |
| `cycle`   | p95          | Whole-cycle wall time including SDK                      |
| `ws`      | frames/lag   | BatchExecuted received / Lagged notices                  |
| `top`     |              | Top 3 agents by gold balance                             |
| `gold_total` |           | Sum of all balances — invariant (off-chain ledger)       |

## Architecture

```
┌──────────────────────── apps/agents ─────────────────────────┐
│                                                                │
│   run.js                                                       │
│     │ build cast (buyers + providers), wire ledger + client    │
│     ▼                                                          │
│   src/loop.js  ──pick buyer (round-robin)─▶ src/protocol.js   │
│     │                                            │             │
│     │                                            ├─ buyer.makeRequest()
│     │                                            ├─ providers.filter(canHandle).quote()
│     │                                            ├─ buyer.pickBest()
│     │                                            ├─ submitPlaceholder() ── @subtick/sdk
│     │                                            ├─ ledger.transfer() (off-chain)
│     │                                            └─ winner.execute()
│     ▼                                                          │
│   stats every 10s ──▶ stdout                                   │
│                                                                │
│   subscribeEvents(...) ── BatchExecuted ──▶ loop.noteWsFrame   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Design rules (don't break)

- ❌ no signing / bincode / wallet code
- ❌ no agent-to-agent IPC, no networking, no shared mutable state outside `AgentLedger`
- ❌ no persistence — restart wipes everything
- ❌ no chain modifications, no SDK extensions
- ✔ thin: protocol + 3 classes + ledger + loop — nothing else

## What flips when Phase 1 Step 3 (tx-builder) lands

1. Replace `submitPlaceholder` in `src/protocol.js` with a real signed
   `Transfer(buyer → winner, price)` call.
2. Gate the off-chain `ledger.transfer(...)` on `submit.kind === 'accepted'`
   (only mutate after the chain accepts).
3. Stats show `acc>0`, `BatchExecuted` frames flow on the WS subscription,
   and the demo becomes a real machine economy on Subtick.

No other files change.

## Comparison with `apps/game/`

| Aspect              | Game                          | Agents                          |
|---------------------|-------------------------------|----------------------------------|
| Actors              | N players                     | Buyers + Providers (Data/Compute)|
| Trigger             | Random (50/30/20 weighted)    | Buyer round-robin                |
| Action shape        | earn / transfer / trade       | request → quote → pay → execute  |
| Decision            | Random                        | Cheapest fitting quote           |
| State               | Gold + items                  | Gold + task counter              |
| SDK use             | One placeholder per action    | One placeholder per cycle        |
| Outcome variability | success / skip                | completed / abandoned / skipped  |

Both apps share the same hard rules and pivot point — the chain integration
flips together when the tx-builder lands.
