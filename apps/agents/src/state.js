// In-process ledger for agents.
//
// Tracks gold balances per agent_id and a running task counter. Operator's
// rule "no persistence" — restart wipes this. When the on-chain tx-builder
// lands the ledger flips role to a cache of `client.getAccount(...)` reads.

export class AgentLedger {
  /**
   * @param {Iterable<{id: string, startingGold: number}>} agents
   */
  constructor(agents) {
    /** @type {Map<string, number>} */
    this.gold = new Map();
    for (const a of agents) this.gold.set(a.id, a.startingGold);
    this._tasksCompleted = 0;
    this._tasksAbandoned = 0;
    this._tasksSkipped = 0;
  }

  // ── reads ────────────────────────────────────────────────────────────

  goldOf(id) {
    return this.gold.get(id) ?? 0;
  }

  /** Sum of gold across all agents — handy invariant in logs. */
  totalGold() {
    let s = 0;
    for (const v of this.gold.values()) s += v;
    return s;
  }

  taskStats() {
    return {
      completed: this._tasksCompleted,
      abandoned: this._tasksAbandoned,
      skipped: this._tasksSkipped,
    };
  }

  topByGold(n = 3) {
    return [...this.gold.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id, gold]) => ({ id, gold }));
  }

  // ── writes ───────────────────────────────────────────────────────────

  /**
   * Move gold from buyer to seller. Throws (without partial mutation) if
   * the buyer is short. Returns the moved amount.
   */
  transfer(from, to, amount) {
    if (from === to) throw new Error('cannot pay self');
    if (amount <= 0) throw new Error('amount must be > 0');
    if (!this.gold.has(from)) throw new Error(`unknown payer: ${from}`);
    if (!this.gold.has(to)) throw new Error(`unknown payee: ${to}`);
    const fromGold = this.gold.get(from);
    if (fromGold < amount) {
      throw new Error(`insufficient gold: ${fromGold} < ${amount}`);
    }
    this.gold.set(from, fromGold - amount);
    this.gold.set(to, this.gold.get(to) + amount);
    return amount;
  }

  noteCompleted() {
    this._tasksCompleted += 1;
  }
  noteAbandoned() {
    this._tasksAbandoned += 1;
  }
  noteSkipped() {
    this._tasksSkipped += 1;
  }
}
