// Three agent classes — Buyer, Data, Compute.
//
// The whole protocol fits into 4 small methods. No async because v0 is
// single-tick / single-cycle: buyer asks, agents reply synchronously,
// buyer picks, payment fires (this is the only async — SDK call), agent
// "executes" by returning a mock result.
//
// All "intelligence" (price strategy, task selection) is intentionally
// trivial — this file proves the wiring, not a real marketplace.

import { nextId, pick, randInt } from './utils.js';

// ── Task types ─────────────────────────────────────────────────────────────

export const TASK_TYPES = ['data', 'compute'];

const PROVIDER_BASE_PRICE = {
  data:    50,  // typical price a DataAgent quotes
  compute: 80,  // typical price a ComputeAgent quotes
};

// ── BuyerAgent ─────────────────────────────────────────────────────────────

export class BuyerAgent {
  constructor({ id, startingGold = 5_000 }) {
    this.id = id;
    this.kind = 'buyer';
    this.startingGold = startingGold;
  }

  /** Build a fresh task request. */
  makeRequest() {
    const type = pick(TASK_TYPES);
    // Budget is a multiple of the base price ± slack so some cycles
    // legitimately fail the "all-over-budget" branch — that's the point of
    // the abandon path.
    const base = PROVIDER_BASE_PRICE[type];
    const budget = randInt(Math.floor(base * 0.6), Math.floor(base * 1.6) + 1);
    return { id: nextId('req'), type, budget, buyer: this.id };
  }

  /**
   * Pick the cheapest quote whose price is ≤ `req.budget`. Tie-break by
   * lowest `eta_ms` (faster wins on equal price). Returns null when no
   * quote fits.
   */
  pickBest(quotes, req) {
    const eligible = quotes.filter((q) => q.price <= req.budget);
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => a.price - b.price || a.eta_ms - b.eta_ms);
    return eligible[0];
  }
}

// ── Provider agents (Data + Compute share a tiny base) ────────────────────

class ProviderAgent {
  constructor({ id, kind, startingGold = 0, basePrice, etaRange }) {
    this.id = id;
    this.kind = kind;
    this.startingGold = startingGold;
    this._basePrice = basePrice;
    this._etaRange = etaRange; // [lo, hi] inclusive-exclusive
  }

  canHandle(taskType) {
    return taskType === this.kind;
  }

  /**
   * Quote a price for `req`. Strategy: base price ± 30% — different agents
   * end up with different offers so the buyer's `pickBest` does real work.
   */
  quote(req) {
    if (!this.canHandle(req.type)) return null;
    const variance = 0.7 + Math.random() * 0.6;
    const price = Math.max(1, Math.floor(this._basePrice * variance));
    const eta_ms = randInt(this._etaRange[0], this._etaRange[1]);
    return { agentId: this.id, price, eta_ms };
  }

  /**
   * Mock execution. v0 returns a tiny synthetic payload; flip to a real
   * worker (off-chain compute, dataset fetch, …) when the demo grows.
   */
  async execute(req) {
    const t0 = performance.now();
    // Deliberately a no-op delay — we don't want test runs to take forever.
    // Real agents would do meaningful work here; v0 is wiring only.
    return {
      taskId: req.id,
      agentId: this.id,
      type: this.kind,
      output: this._mockOutput(req),
      took_ms: performance.now() - t0,
    };
  }

  _mockOutput(req) {
    if (this.kind === 'data') {
      return { rows: randInt(10, 100), schema: ['ts', 'value'] };
    }
    return { gas_used: randInt(1_000, 10_000), result: Math.random().toFixed(6) };
  }
}

export class DataAgent extends ProviderAgent {
  constructor({ id, startingGold = 0 } = {}) {
    super({
      id,
      kind: 'data',
      startingGold,
      basePrice: PROVIDER_BASE_PRICE.data,
      etaRange: [3, 12],
    });
  }
}

export class ComputeAgent extends ProviderAgent {
  constructor({ id, startingGold = 0 } = {}) {
    super({
      id,
      kind: 'compute',
      startingGold,
      basePrice: PROVIDER_BASE_PRICE.compute,
      etaRange: [5, 25],
    });
  }
}
