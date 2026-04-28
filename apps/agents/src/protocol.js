// One full request/quote/pay/execute handshake.
//
// All steps are deterministic given the inputs (RNG aside). Exactly one
// async point: the SDK round-trip in `submitPlaceholder`. Everything else
// is synchronous so a single cycle is easy to reason about.

/**
 * Run one cycle.
 *
 * @param {object} ctx
 * @param {object} ctx.buyer
 * @param {object[]} ctx.agents       Provider agents (Data/Compute).
 * @param {object} ctx.ledger
 * @param {object} ctx.submitter      `.submit()` → SDK Result (placeholder OR real-tx)
 * @param {(entry: object) => void} [ctx.log=noop]   Per-phase trace hook.
 *
 * Returns one of:
 *   { outcome: 'completed', req, pick, result, submit }
 *   { outcome: 'abandoned', req, reason }      (all quotes over budget OR no quotes)
 *   { outcome: 'skipped',   req, reason }      (no eligible agents OR buyer broke)
 */
export async function runRequestCycle({ buyer, agents, ledger, submitter, log = () => {} }) {
  // 1. request
  const req = buyer.makeRequest();
  log({ phase: 'request', req });

  // 2. eligible providers quote
  const eligible = agents.filter((a) => a.canHandle(req.type));
  if (eligible.length === 0) {
    log({ phase: 'skipped', req, reason: 'no_eligible_agents' });
    return { outcome: 'skipped', req, reason: 'no_eligible_agents' };
  }
  const quotes = eligible
    .map((a) => a.quote(req))
    .filter((q) => q !== null);
  log({ phase: 'quotes', req, quotes });

  // 3. buyer picks
  const pick = buyer.pickBest(quotes, req);
  if (!pick) {
    log({ phase: 'abandoned', req, quotes, reason: 'all_over_budget' });
    return { outcome: 'abandoned', req, reason: 'all_over_budget' };
  }
  log({ phase: 'accept', req, pick });

  // 4. local funds check (off-chain ledger)
  if (ledger.goldOf(buyer.id) < pick.price) {
    log({ phase: 'skipped', req, reason: 'buyer_short' });
    return { outcome: 'skipped', req, reason: 'buyer_short' };
  }

  // 5. Payment via the configured submitter (placeholder OR real Transfer).
  const submit = await submitter.submit();
  log({ phase: 'pay', req, pick, submit });

  // 6. update local ledger regardless of API outcome (v0: API is transport
  //    canary, not consensus). When the tx-builder lands, gate this on
  //    `submit.kind === 'accepted'` and remove the placeholder branch.
  ledger.transfer(buyer.id, pick.agentId, pick.price);

  // 7. agent executes the task
  const winner = eligible.find((a) => a.id === pick.agentId);
  const result = await winner.execute(req);
  log({ phase: 'done', req, pick, result });

  return { outcome: 'completed', req, pick, result, submit };
}
