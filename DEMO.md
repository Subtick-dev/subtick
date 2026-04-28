# Subtick — Live Demo Runbook

5-minute setup, then a self-running demo of the full Subtick stack — chain →
API → SDK → game + agents → live WebSocket events. Real signed transfers,
real on-chain state.

> **Phase 2C** — packaging only. No new product code; everything below ran
> end-to-end during Phase 1 Step 3 validation:
> - `apps/game/`     → 32 cycles, **acc=32 / rej=0**, 17 WS frames, p99 5 ms
> - `apps/agents/`   → 23 paid cycles, **acc=23 / rej=0**, 14 WS frames, p99 3.9 ms

---

## 1. Prereqs

| Tool          | Version           | Notes                              |
|---------------|-------------------|------------------------------------|
| **Linux** (or macOS) | recent | Windows works in Git Bash too |
| **Rust**      | 1.75+             | `cargo` on PATH                    |
| **Node.js**   | 18+               | uses native `fetch`                |
| **bash**      | any               | scripts use `set -euo pipefail`    |
| 8 vCPUs       |                   | comfortable; works on 4            |
| 4 GB RAM      |                   | plenty                             |

No external services, no Docker, no DB. Single binary + a Node app.

---

## 2. Build

```bash
git clone <this repo>
cd "Agis Chain"

# Build subtick once (~50s release build, ~117 dead-code warnings, no errors)
cd subtick
cargo build --release --features api
cd ..
```

The default validator binary already exists; the `api` feature additively
gates `tokio + axum + tower-http`. Without `--features api`, nothing changes.

---

## 3. One-time setup — keys + genesis

```bash
./scripts/demo/setup-genesis.sh
```

What it does:
1. Generates a fresh Ed25519 validator key under `demo_node/keys/v0.key`.
2. Writes a **single-validator genesis** under `demo_node/genesis.json`
   (quorum = 1 → solo self-vote works).
3. Writes `demo_node/config.toml` pointing at the above.

Output:
```
[setup] key:     demo_node/keys/v0.key
[setup] genesis: demo_node/genesis.json
[setup] config:  demo_node/config.toml
[setup] pubkey:  <64-char hex>
```

The pubkey is the genesis-funded sender used by the demo apps.

---

## 4. Start the validator + API

In **terminal 1**:

```bash
./scripts/demo/start-validator.sh
```

Defaults to `127.0.0.1:8080`. To bind publicly:

```bash
API_LISTEN=0.0.0.0:8080 ./scripts/demo/start-validator.sh
```

Look for these markers in the boot log:

```jsonc
{"type":"NodeStarting","role":"validator", ...}
{"type":"ApiThreadSpawned","listen":"0.0.0.0:8080"}
{"type":"ExecutorStarted","shards":4, ...}
{"type":"OrdererStarted","quorum":1,"validator_count":1}
{"type":"BlockPathDisabled","executor_authoritative":true}
{"type":"ApiListening","listen":"0.0.0.0:8080"}
{"type":"NodeReady","validators":1}
```

Verify it responds:

```bash
curl -s http://127.0.0.1:8080/health
# → {"status":"ok","height":0,"slot":0,"account_count":1}
```

---

## 5. Tail BatchExecuted live

In **terminal 2**:

```bash
node scripts/demo/event-monitor.js
# or against a public node:
node scripts/demo/event-monitor.js http://1.2.3.4:8080
```

Output (idle; orderer fires empty rounds when no traffic):

```
[ws]     connected
[stats]  frames/s=0.0  applied/s=0.0  total_frames=0  total_applied=0  lagged=0
```

Once the game / agents start, you'll see:

```
[batch]  shard=1  applied=1  rejected_nonce=0  rejected_balance=0  batch=ab12...  state_root=cd34...
[batch]  shard=2  applied=1  rejected_nonce=0  rejected_balance=0  batch=ef56...  state_root=78ab...
[stats]  frames/s=2.3  applied/s=2.3  total_frames=12  total_applied=12  lagged=0
```

---

## 6. Run the game

In **terminal 3**:

```bash
./scripts/demo/start-game.sh
```

Defaults: 8 players, 200 ms tick, infinite duration, real signed Transfers.
Output:

```
[game] base=http://127.0.0.1:8080 players=8 tick=200ms items=12
[game] real-tx mode: sender=715431d970b0... nonce=0 balance=100000000 ttl=...
[ws] connected
[stats] tick=20 acts(earn=11 xfer=6 trade=3 skip=0 err=0) sdk(acc=20 rej=0 tx=0 ?=0) ...
[stats] tick=40 acts(earn=22 xfer=12 trade=6 skip=0 err=0) sdk(acc=40 rej=0 tx=0 ?=0) ...
```

Tweak with env vars:
```bash
PLAYERS=16 TICK_MS=100 ./scripts/demo/start-game.sh
BASE_URL=http://server.example.com:8080 ./scripts/demo/start-game.sh
```

---

## 7. Run the AI agents

In **terminal 4**:

```bash
./scripts/demo/start-agents.sh
# or with the per-cycle protocol trace:
VERBOSE=1 ./scripts/demo/start-agents.sh
```

Default cast: 2 buyers / 2 data providers / 2 compute providers. Output:

```
[agents] real-tx mode: sender=715431d970b0... nonce=42 balance=99999958 ttl=...
[ws] connected
#1 req(data, b=72) accept(data_2:48) pay(ACC, 1.7ms) done(took=0.0ms)
#2 req(compute, b=104) accept(compute_1:75) pay(ACC, 1.5ms) done(took=0.0ms)
#3 req(data, b=39) abandon(all-over-budget)
...
[stats] cycle=20 out(comp=14 abn=6 skp=0 err=0) sdk(acc=14 rej=0 tx=0 ?=0) ...
```

---

## 8. The talking points (≈ 60 seconds)

1. **Open terminal 2 (event-monitor)** — show empty BatchExecuted stream.
2. **Open terminal 3 (game)** — point to `acc=N rej=0`.
3. **Watch terminal 2** — `[batch]` lines start scrolling.
4. **Open terminal 4 (agents)** — `pay(ACC, ...)` per cycle.
5. **Final pitch:**

> _"There are no blocks. Each transaction is signed in the SDK, accepted by_
> _the API in 1–5 ms, ordered by the consensus layer, and executed by_
> _per-shard worker threads. The_ `BatchExecuted` _frames you see are real_
> _state mutations — sender nonce incrementing, balance moving, recipient_
> _accounts materialising. Same code path the load tests pushed past 100K_
> _peak per shard. This isn't a mock — it's the system."_

Optional: in any terminal, prove the state moved:

```bash
SENDER=$(cat demo_node/genesis.json | grep -m1 '"pubkey"' | grep -oE '[0-9a-f]{64}')
curl -s "http://127.0.0.1:8080/v1/account/${SENDER}"
# → {"address":"...","balance":"99999XXX","nonce":NNN}
```

`nonce` increments by ≥ 1 every accepted tx.

---

## 9. Demo flow (single terminal alternative)

If you only have one terminal, run everything in the background:

```bash
./scripts/demo/setup-genesis.sh
./scripts/demo/start-validator.sh > demo.log 2>&1 &
sleep 5
node scripts/demo/event-monitor.js > monitor.log 2>&1 &
./scripts/demo/start-game.sh > game.log 2>&1 &
./scripts/demo/start-agents.sh > agents.log 2>&1 &

# tail any of them:
tail -f monitor.log
```

Stop everything with:

```bash
pkill -f "node run.js"; pkill -f "event-monitor"; pkill -x subtick
```

---

## 10. Known v0 limits (be honest about these)

| Limit                                | Why                                       |
|--------------------------------------|-------------------------------------------|
| Fees not deducted from sender        | Phase 6 v1.5 executor — explicit deferral |
| Cross-shard recipient lands in sender's shadow | Same delta, same shard commit thread |
| No auth / rate-limit on API          | Locked v0 contract — deliberate           |
| No historical queries / pagination   | Locked v0 contract — deliberate           |
| Single validator (quorum = 1)        | Demo solo; multi-host scripts in `subtick/` |
| `permissive` CORS                    | Demo only — lock down for prod            |

Core system is real:
- Real ed25519 signatures
- Real SHA-256 canonical hashing
- Real sharded state, real DAG batches, real consensus
- Real WebSocket events tied to commit thread

---

## 11. Troubleshooting

| Symptom                                  | Fix                                                              |
|------------------------------------------|------------------------------------------------------------------|
| `subtick binary not found`                 | Run `cargo build --release --features api` (see `setup-genesis.sh`) |
| `subtick api unreachable`                  | Validator not running — check terminal 1                          |
| `[ws] error: connect ECONNREFUSED`       | API not listening on the URL the app is pointed at                |
| Ports in use                             | Set `API_LISTEN` to a free port                                   |
| `acc=0 rej=N` in game/agents             | Sender nonce drifted — restart the app, it re-reads from chain    |
| Lots of `applied=0` empty BatchExecuted  | Normal — orderer ticks every ~30 ms even with no payload          |
| `rejected_nonce > 0` when running both apps | Game + agents share the demo sender key, so they race on nonces. Each app self-recovers via `_resyncNonce` on rejection. Not a bug — it actually demonstrates strict on-chain ordering under contention. To eliminate it, run only one app at a time, or generate a second funded account (Phase 3 multi-validator setup).|

Logs to inspect:

| File                  | When                              |
|-----------------------|-----------------------------------|
| terminal 1 stderr     | Validator boot, executor stats    |
| terminal 3 stdout     | Game stats every 10 s             |
| terminal 4 stdout     | Agent cycle results               |
| terminal 2 stdout     | Live BatchExecuted frames         |

---

## 12. After the demo

Per the master plan, **Phase 3 = Public Testnet**:

- Same binary on N nodes (use `subtick/run_multihost_validators.sh` as a starting point)
- `subtick genesis --validators N` for a multi-validator genesis
- Open the API on each node behind a load balancer
- Publish [API.md](subtick/API.md) + the SDK READMEs
- Invite developers
