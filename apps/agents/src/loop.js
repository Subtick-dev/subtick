// Agent loop — schedules cycles, accumulates stats, prints periodic line.
//
// One in-flight cycle at a time. Run multiple loop instances in separate
// processes for higher rate; the SDK is stateless and the chain handles
// concurrent ingress fine.

import { runRequestCycle } from './protocol.js';
import { sleep } from './utils.js';

class LatencyDigest {
  constructor() {
    this._samples = [];
  }
  record(ms) {
    this._samples.push(ms);
    if (this._samples.length > 5_000) this._samples.shift();
  }
  snapshot() {
    if (this._samples.length === 0) return { count: 0 };
    const sorted = [...this._samples].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
      count: sorted.length,
      mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
      p50: at(0.50),
      p95: at(0.95),
      p99: at(0.99),
      max: sorted[sorted.length - 1],
    };
  }
}

export class AgentLoop {
  /**
   * @param {object} opts
   * @param {object[]} opts.buyers              Buyer agents (round-robin).
   * @param {object[]} opts.providers           Data + Compute agents.
   * @param {object} opts.ledger
   * @param {object} opts.client                SubtickClient
   * @param {number} [opts.tickMs=500]
   * @param {number} [opts.statsEveryMs=10_000]
   * @param {boolean} [opts.verbose=false]      One line per protocol phase.
   * @param {(line: string) => void} [opts.print=console.log]
   */
  constructor(opts) {
    this.buyers = opts.buyers;
    this.providers = opts.providers;
    this.ledger = opts.ledger;
    this.client = opts.client;
    this.submitter = opts.submitter;
    this.tickMs = opts.tickMs ?? 500;
    this.statsEveryMs = opts.statsEveryMs ?? 10_000;
    this.verbose = opts.verbose ?? false;
    this.print = opts.print ?? ((s) => console.log(s));

    this._stop = false;
    this._cycle = 0;
    this._buyerIdx = 0;
    this._latency = new LatencyDigest();   // SDK round-trip
    this._cycleLatency = new LatencyDigest(); // Whole cycle wall time
    this._submitCounts = { accepted: 0, rejected: 0, transport: 0, unknown: 0 };
    this._outcomeCounts = { completed: 0, abandoned: 0, skipped: 0 };
    this._wsFrames = 0;
    this._wsLagged = 0;
    this._lastStatsAt = Date.now();
    this._cycleErrors = 0;
  }

  noteWsFrame(event) {
    if (event?.type === 'Lagged') this._wsLagged += 1;
    else this._wsFrames += 1;
  }

  /** Run for `durationMs`; `Infinity` for forever. */
  async run(durationMs = Infinity) {
    const startedAt = Date.now();
    const endAt = durationMs === Infinity ? Infinity : startedAt + durationMs;

    while (!this._stop && Date.now() < endAt) {
      const cycleStart = performance.now();
      const buyer = this.buyers[this._buyerIdx % this.buyers.length];
      this._buyerIdx += 1;

      try {
        const out = await runRequestCycle({
          buyer,
          agents: this.providers,
          ledger: this.ledger,
          submitter: this.submitter,
          log: this.verbose ? this._verboseLog.bind(this) : undefined,
        });
        this._cycle += 1;
        this._outcomeCounts[out.outcome] += 1;

        if (out.outcome === 'completed') {
          this.ledger.noteCompleted();
          this._submitCounts[out.submit.kind] += 1;
          this._latency.record(out.submit.latencyMs);
        } else if (out.outcome === 'abandoned') {
          this.ledger.noteAbandoned();
        } else {
          this.ledger.noteSkipped();
        }

        // Compact log only when not verbose.
        if (!this.verbose) {
          this._compactLog(out);
        }
      } catch (err) {
        this._cycleErrors += 1;
        this.print(`[err] cycle: ${err.message}`);
      }

      this._cycleLatency.record(performance.now() - cycleStart);

      if (Date.now() - this._lastStatsAt >= this.statsEveryMs) {
        this._emitStats();
        this._lastStatsAt = Date.now();
      }

      const elapsed = performance.now() - cycleStart;
      const wait = Math.max(0, this.tickMs - elapsed);
      if (wait > 0) await sleep(wait);
    }

    this._emitStats(true);
  }

  stop() {
    this._stop = true;
  }

  // ── output ─────────────────────────────────────────────────────────────

  _compactLog(out) {
    const n = `#${this._cycle}`;
    const r = out.req;
    if (out.outcome === 'skipped') {
      this.print(`${n} req(${r.type}, b=${r.budget}) skip(${out.reason})`);
      return;
    }
    if (out.outcome === 'abandoned') {
      this.print(`${n} req(${r.type}, b=${r.budget}) abandon(all-over-budget)`);
      return;
    }
    const submit = out.submit;
    const submitTag = submit.kind === 'rejected' ? `pay(rej, ${submit.latencyMs.toFixed(1)}ms)`
      : submit.kind === 'accepted' ? `pay(ACC, ${submit.latencyMs.toFixed(1)}ms)`
      : `pay(${submit.kind}, ${submit.latencyMs.toFixed(1)}ms)`;
    this.print(
      `${n} req(${r.type}, b=${r.budget}) ` +
        `accept(${out.pick.agentId}:${out.pick.price}) ` +
        `${submitTag} done(took=${out.result.took_ms.toFixed(1)}ms)`,
    );
  }

  _verboseLog(entry) {
    const r = entry.req ? `${entry.req.id}/${entry.req.type}` : '?';
    if (entry.phase === 'request') {
      this.print(`  → request ${r} budget=${entry.req.budget} buyer=${entry.req.buyer}`);
    } else if (entry.phase === 'quotes') {
      const q = entry.quotes.map((x) => `${x.agentId}:${x.price}/${x.eta_ms}ms`).join(' ');
      this.print(`  ← quotes ${r} [${q}]`);
    } else if (entry.phase === 'accept') {
      this.print(`  ✓ accept ${r} winner=${entry.pick.agentId} price=${entry.pick.price}`);
    } else if (entry.phase === 'pay') {
      this.print(`  $ pay     ${r} kind=${entry.submit.kind} latency=${entry.submit.latencyMs.toFixed(1)}ms`);
    } else if (entry.phase === 'done') {
      this.print(`  ★ done    ${r} took=${entry.result.took_ms.toFixed(1)}ms`);
    } else if (entry.phase === 'abandoned' || entry.phase === 'skipped') {
      this.print(`  ⤬ ${entry.phase} ${r} reason=${entry.reason}`);
    }
  }

  _emitStats(final = false) {
    const lat = this._latency.snapshot();
    const cyc = this._cycleLatency.snapshot();
    const top = this.ledger.topByGold(3);
    const tag = final ? 'FINAL' : 'stats';
    this.print(
      `[${tag}] cycle=${this._cycle} ` +
        `out(comp=${this._outcomeCounts.completed} abn=${this._outcomeCounts.abandoned} ` +
        `skp=${this._outcomeCounts.skipped} err=${this._cycleErrors}) ` +
        `sdk(acc=${this._submitCounts.accepted} rej=${this._submitCounts.rejected} ` +
        `tx=${this._submitCounts.transport} ?=${this._submitCounts.unknown}) ` +
        `lat(p50=${fmt(lat.p50)} p95=${fmt(lat.p95)} p99=${fmt(lat.p99)}) ` +
        `cycle(p95=${fmt(cyc.p95)}) ` +
        `ws(${this._wsFrames}/${this._wsLagged}) ` +
        `top=[${top.map((t) => `${t.id}:${t.gold}`).join(' ')}] ` +
        `gold_total=${this.ledger.totalGold()}`,
    );
  }
}

function fmt(v) {
  if (v == null) return '-';
  return v >= 100 ? `${v.toFixed(0)}ms` : `${v.toFixed(1)}ms`;
}
