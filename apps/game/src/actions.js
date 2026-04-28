// Game actions = (ledger mutation, SDK transport call).
//
// Each action does TWO independent things:
//   1. Mutate the off-chain ledger (the "real" game state for v0).
//   2. Submit a placeholder hex tx to the API via @subtick/sdk so we exercise
//      the transport. The API rejects every placeholder with HTTP 400 — that
//      rejection IS the success signal: it proves the SDK request frame, the
//      server response parse, and the typed `TxRejected` propagation work.
//
// When Phase 1 Step 3 (tx-builder) lands, swap `submitPlaceholder` for a
// real signed-Transfer constructor and remove the rejection-tolerance in
// stats. Nothing else here changes.

import { pick, pickTwo, randInt } from './utils.js';
import { ITEM_TYPES } from './ledger.js';

// `ctx.submit` is supplied by `run.js` — either a `PlaceholderSubmitter` (v0
// transport-only) or a `RealTxSubmitter` (Phase 1 Step 3 real signed
// Transfers). Both expose the same `.submit()` shape, so this file is
// agnostic.

/** "Earn" action — mint random gold to a random player. */
export async function earn(ctx) {
  const { ledger, players, submitter } = ctx;
  const player = pick(players);
  const amount = randInt(10, 100);
  ledger.earn(player, amount);
  const submit = await submitter.submit();
  return { type: 'earn', player, amount, submit };
}

/** "Transfer" — move gold between two distinct players. Skips on insufficient balance. */
export async function transfer(ctx) {
  const { ledger, players, submitter } = ctx;
  const [from, to] = pickTwo(players);
  // Cap at sender's balance so we never throw.
  const max = Math.min(ledger.goldOf(from), 200);
  if (max < 1) return { type: 'transfer', skipped: 'sender_empty', from, to };
  const amount = randInt(1, max + 1);
  ledger.transfer(from, to, amount);
  const submit = await submitter.submit();
  return { type: 'transfer', from, to, amount, submit };
}

/** "Trade" — buyer pays seller for one of seller's items at item-type base price ± 30%. */
export async function trade(ctx) {
  const { ledger, players, submitter } = ctx;
  const [buyer, seller] = pickTwo(players);
  const item = ledger.randomSellableItem(seller);
  if (!item) return { type: 'trade', skipped: 'seller_no_items', buyer, seller };

  const tpl = ITEM_TYPES.find((t) => t.id === item.type);
  const variation = 0.7 + Math.random() * 0.6; // 0.7×–1.3×
  const price = Math.max(1, Math.floor((tpl?.basePrice ?? 100) * variation));
  if (ledger.goldOf(buyer) < price) {
    return { type: 'trade', skipped: 'buyer_short', buyer, seller, price };
  }
  ledger.trade(buyer, seller, item.id, price);
  const submit = await submitter.submit();
  return { type: 'trade', buyer, seller, itemId: item.id, price, submit };
}

/** Default action mix used by the loop unless overridden. */
export const DEFAULT_MIX = [
  { name: 'earn',     fn: earn,     weight: 5 },
  { name: 'transfer', fn: transfer, weight: 3 },
  { name: 'trade',    fn: trade,    weight: 2 },
];
