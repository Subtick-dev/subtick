// Main game loop.
//
// On each tick the loop:
//   1. Picks one player (round-robin) and one action (weighted random).
//   2. Awaits the action — which mutates the ledger and submits a placeholder
//      tx through the SDK.
//   3. Updates rolling counters.
//   4. Periodically prints a stats line.
//
// One in-flight action per tick keeps timing predictable. For higher-rate
// load testing, run multiple loop instances in separate processes — the
// SDK is stateless and the chain handles concurrent ingress fine.

import { weightedPick } from './utils.js';
import { DEFAULT_MIX } from './actions.js';

class LatencyDigest {
  constructor() {
    this._samples = []; // bounded; we trim
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

export class GameLoop {
  /**
   * @param {object} opts
   * @param {object} opts.ledger
   * @param {string[]} opts.players
   * @param {object} opts.client            SubtickClient
   * @param {number} [opts.tickMs=1000]     Time between actions per tick.
   * @param {number} [opts.statsEveryMs=10000]
   * @param {Array}  [opts.mix=DEFAULT_MIX] Action mix.
   * @param {(line: string) => void} [opts.print=console.log]
   */
  constructor(opts) {
    this.ledger = opts.ledger;
    this.players = opts.players;
    this.client = opts.client;
    this.submitter = opts.submitter;
    this.tickMs = opts.tickMs ?? 1000;
    this.statsEveryMs = opts.statsEveryMs ?? 10_000;
    this.mix = opts.mix ?? DEFAULT_MIX;
    this.print = opts.print ?? ((s) => console.log(s));

    this._stop = false;
    this._tick = 0;
    this._counts = { earn: 0, transfer: 0, trade: 0, skipped: 0 };
    this._submitCounts = { accepted: 0, rejected: 0, transport: 0, unknown: 0 };
    this._latency = new LatencyDigest();
    this._wsFrames = 0;
    this._wsLagged = 0;
    this._lastStatsAt = Date.now();
    this._actionErrors = 0;
  }

  /** Forward WS frame counters here so stats render together. */
  noteWsFrame(event) {
    if (event?.type === 'Lagged') this._wsLagged += 1;
    else this._wsFrames += 1;
  }

  /** Run for `durationMs`. If `Infinity`, run until `.stop()`. */
  async run(durationMs = Infinity) {
    const startedAt = Date.now();
    const endAt = durationMs === Infinity ? Infinity : startedAt + durationMs;

    while (!this._stop && Date.now() < endAt) {
      const tickStart = Date.now();
      const idx = weightedPick(this.mix.map((m) => m.weight));
      const action = this.mix[idx];

      try {
        const result = await action.fn({
          ledger: this.ledger,
          players: this.players,
          client: this.client,
          submitter: this.submitter,
        });
        this._tick += 1;
        if (result.skipped) {
          this._counts.skipped += 1;
        } else {
          this._counts[result.type] += 1;
          if (result.submit) {
            this._submitCounts[result.submit.kind] += 1;
            this._latency.record(result.submit.latencyMs);
          }
        }
      } catch (err) {
        this._actionErrors += 1;
        this.print(`[err] ${action.name}: ${err.message}`);
      }

      if (Date.now() - this._lastStatsAt >= this.statsEveryMs) {
        this._emitStats();
        this._lastStatsAt = Date.now();
      }

      const elapsed = Date.now() - tickStart;
      const wait = Math.max(0, this.tickMs - elapsed);
      if (wait > 0) await sleep(wait);
    }

    this._emitStats(true);
  }

  stop() {
    this._stop = true;
  }

  _emitStats(final = false) {
    const lat = this._latency.snapshot();
    const top = this.ledger.topPlayers(3);
    const tag = final ? 'FINAL' : 'stats';
    this.print(
      `[${tag}] tick=${this._tick} ` +
        `acts(earn=${this._counts.earn} xfer=${this._counts.transfer} trade=${this._counts.trade} ` +
        `skip=${this._counts.skipped} err=${this._actionErrors}) ` +
        `sdk(acc=${this._submitCounts.accepted} rej=${this._submitCounts.rejected} ` +
        `tx=${this._submitCounts.transport} ?=${this._submitCounts.unknown}) ` +
        `lat(p50=${fmt(lat.p50)} p95=${fmt(lat.p95)} p99=${fmt(lat.p99)} max=${fmt(lat.max)}) ` +
        `ws(frames=${this._wsFrames} lagged=${this._wsLagged}) ` +
        `top=[${top.map((t) => `${t.addr.slice(0, 6)}:${t.gold}`).join(' ')}]`,
    );
  }
}

function fmt(v) {
  if (v == null) return '-';
  return v >= 100 ? `${v.toFixed(0)}ms` : `${v.toFixed(1)}ms`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
