// In-memory game ledger.
//
// Holds:
//   * player gold balances
//   * item ownership (item_id → owner_address, or undefined if unsold)
//
// All quantities are JS Number (BigInt is overkill for game-scale balances:
// rewards are 10–100 gold, item prices ≤ 10k). Operator unblocks Phase 1
// Step 3 (tx-builder) → swap this off-chain ledger for chain reads via the
// SDK; nothing else changes.

const ITEM_TYPES = [
  { id: 'sword',   basePrice: 250, name: 'Iron Sword' },
  { id: 'shield',  basePrice: 180, name: 'Wooden Shield' },
  { id: 'potion',  basePrice:  40, name: 'Health Potion' },
  { id: 'gem',     basePrice: 800, name: 'Rare Gem' },
  { id: 'scroll',  basePrice: 120, name: 'Map Scroll' },
];

export class Ledger {
  /**
   * @param {string[]} addresses     Player addresses (32-byte hex).
   * @param {number}   startingGold  Initial balance per player.
   * @param {number}   itemCount     How many items exist in the world.
   */
  constructor(addresses, startingGold = 1000, itemCount = 12) {
    /** @type {Map<string, number>} address → gold */
    this.gold = new Map(addresses.map((a) => [a, startingGold]));

    /** @type {Map<string, {type: string, owner: string|null, name: string}>} item_id → record */
    this.items = new Map();
    for (let i = 0; i < itemCount; i += 1) {
      const tpl = ITEM_TYPES[i % ITEM_TYPES.length];
      const owner = addresses[i % addresses.length] ?? null;
      this.items.set(`item_${i.toString().padStart(3, '0')}_${tpl.id}`, {
        type: tpl.id,
        name: tpl.name,
        owner,
      });
    }
  }

  // ── reads ──────────────────────────────────────────────────────────────

  goldOf(addr) {
    return this.gold.get(addr) ?? 0;
  }

  itemsOf(addr) {
    const out = [];
    for (const [id, rec] of this.items) {
      if (rec.owner === addr) out.push({ id, ...rec });
    }
    return out;
  }

  topPlayers(n = 3) {
    return [...this.gold.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([addr, gold]) => ({ addr, gold }));
  }

  itemDistribution() {
    const dist = {};
    for (const [, rec] of this.items) {
      const k = rec.owner ? rec.owner.slice(0, 8) : '<unowned>';
      dist[k] = (dist[k] ?? 0) + 1;
    }
    return dist;
  }

  // ── writes (validated; never go negative, never duplicate-own) ────────

  /**
   * Mint gold to a player (an "earn" action). Returns the amount actually
   * granted (always equal to `amount` for v0 — no caps yet).
   */
  earn(addr, amount) {
    if (!this.gold.has(addr)) throw new Error(`unknown player ${addr.slice(0, 8)}`);
    if (amount <= 0) throw new Error('earn amount must be > 0');
    this.gold.set(addr, this.goldOf(addr) + amount);
    return amount;
  }

  /**
   * Move gold between players. Throws if `from` lacks balance or addresses
   * are equal. Returns the moved amount on success.
   */
  transfer(from, to, amount) {
    if (from === to) throw new Error('cannot transfer to self');
    if (amount <= 0) throw new Error('transfer amount must be > 0');
    if (!this.gold.has(from)) throw new Error(`unknown sender ${from.slice(0, 8)}`);
    if (!this.gold.has(to)) throw new Error(`unknown recipient ${to.slice(0, 8)}`);
    const fromGold = this.goldOf(from);
    if (fromGold < amount) throw new Error(`insufficient gold: ${fromGold} < ${amount}`);
    this.gold.set(from, fromGold - amount);
    this.gold.set(to, this.goldOf(to) + amount);
    return amount;
  }

  /**
   * Trade an item from `seller` to `buyer` at `price`. Atomically:
   *   1. buyer.gold -= price
   *   2. seller.gold += price
   *   3. item.owner = buyer
   * Throws (without partial mutation) if any precondition fails.
   */
  trade(buyer, seller, itemId, price) {
    if (buyer === seller) throw new Error('cannot trade with self');
    const item = this.items.get(itemId);
    if (!item) throw new Error(`unknown item ${itemId}`);
    if (item.owner !== seller) throw new Error(`item ${itemId} not owned by seller`);
    if (price <= 0) throw new Error('trade price must be > 0');
    if (this.goldOf(buyer) < price) {
      throw new Error(`buyer short: ${this.goldOf(buyer)} < ${price}`);
    }
    // All preconditions hold — apply.
    this.gold.set(buyer, this.goldOf(buyer) - price);
    this.gold.set(seller, this.goldOf(seller) + price);
    item.owner = buyer;
    return { itemId, price };
  }

  /** A player owns at least one item we can offer for trade. */
  randomSellableItem(seller) {
    const owned = this.itemsOf(seller);
    return owned.length > 0 ? owned[Math.floor(Math.random() * owned.length)] : null;
  }
}

export { ITEM_TYPES };
