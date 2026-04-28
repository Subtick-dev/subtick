// @subtick/sdk — public surface.
//
// Phase 1 transport-only wrapper. Four endpoints + transaction builder.

export { SubtickClient } from './client.js';
export { EventSubscription, subscribeEvents } from './events.js';
export { SubtickError, TxRejected, AccountNotFound, TransportError } from './errors.js';
export {
  buildSignedTransfer,
  derivePublicKey,
  ed25519Sign,
  importEd25519PrivateKey,
  TX_VERSION,
  CHAIN_ID,
  GAS_TRANSFER,
  MIN_FEE,
} from './tx_builder.js';
