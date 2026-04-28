// Submitter abstraction — swaps the SDK call shape between v0 placeholder
// (transport-only validation) and Phase 1 Step 3 real signed Transfer txs.
//
// Same return contract for both, so `actions.js` doesn't care which is wired:
//   { kind: 'accepted'|'rejected'|'transport'|'unknown',
//     latencyMs: number,
//     status?: number, retryable?: boolean, reason?: string }

import {
  TxRejected,
  TransportError,
  buildSignedTransfer,
  derivePublicKey,
} from '../../../sdk/js/src/index.js';
import { randomTxPlaceholder } from './utils.js';

/** Thin wrapper over an awaited submit so all submitters share counters. */
async function timed(call) {
  const t0 = performance.now();
  try {
    const body = await call();
    return { kind: 'accepted', latencyMs: performance.now() - t0, body };
  } catch (err) {
    const latencyMs = performance.now() - t0;
    if (err instanceof TxRejected) {
      return {
        kind: 'rejected',
        latencyMs,
        status: err.status,
        retryable: err.retryable,
        reason: err.message,
      };
    }
    if (err instanceof TransportError) {
      return { kind: 'transport', latencyMs, reason: err.message };
    }
    return { kind: 'unknown', latencyMs, reason: String(err.message ?? err) };
  }
}

/**
 * v0 placeholder submitter — posts a random invalid hex blob. The API
 * rejects with HTTP 400; that rejection IS the v0 success signal.
 */
export class PlaceholderSubmitter {
  constructor(client) {
    this.client = client;
  }
  async init() {} // no-op
  async submit() {
    return timed(() => this.client.sendTx(randomTxPlaceholder()));
  }
}

/**
 * Real signed Transfer submitter — uses one funded sender for every
 * action. Recipients cycle through the player addresses so gold flows
 * between actual demo participants on-chain.
 *
 * Nonce is read once from `getAccount` at init and incremented locally on
 * every accepted tx. If the chain rejects (e.g. mempool full), we resync
 * from `getAccount` so we don't drift.
 */
export class RealTxSubmitter {
  /**
   * @param {object} opts
   * @param {object} opts.client                    SubtickClient
   * @param {Buffer|Uint8Array} opts.privateKey     32-byte sender seed
   * @param {string[]} opts.recipientPool           hex addresses to cycle through
   * @param {bigint} [opts.amount=1n]               per-tx amount
   */
  constructor({ client, privateKey, recipientPool, amount = 1n }) {
    if (!privateKey || privateKey.length !== 32) {
      throw new TypeError('privateKey must be 32 bytes');
    }
    if (!Array.isArray(recipientPool) || recipientPool.length === 0) {
      throw new TypeError('recipientPool must be non-empty');
    }
    this.client = client;
    this.privateKey = privateKey;
    this.senderPub = derivePublicKey(privateKey);
    this.senderHex = this.senderPub.toString('hex');
    this.recipientPool = recipientPool.map((h) => Buffer.from(h, 'hex'));
    this.amount = typeof amount === 'bigint' ? amount : BigInt(amount);
    this._nonce = null;
    this._ttl = null;
    this._idx = 0;
  }

  async init() {
    const acc = await this.client.getAccount(this.senderHex);
    this._nonce = BigInt(acc.nonce);
    const h = await this.client.health();
    // TTL = current_slot + 100k; the smoke uses 10k, this is conservative
    // for a long-running app.
    this._ttl = BigInt(h.slot) + 100_000n;
    return {
      sender: this.senderHex,
      startingNonce: this._nonce,
      startingBalance: acc.balance,
      ttl: this._ttl,
    };
  }

  async _resyncNonce() {
    try {
      const acc = await this.client.getAccount(this.senderHex);
      this._nonce = BigInt(acc.nonce);
    } catch {
      /* keep stale value; next call will retry */
    }
  }

  async submit() {
    if (this._nonce === null) {
      throw new Error('RealTxSubmitter.init() not called');
    }
    const recipient = this.recipientPool[this._idx % this.recipientPool.length];
    this._idx += 1;
    const txHex = buildSignedTransfer({
      privateKey: this.privateKey,
      senderPubkey: this.senderPub,
      recipient,
      amount: this.amount,
      nonce: this._nonce,
      ttl: this._ttl,
    });
    const t0 = performance.now();
    try {
      const body = await this.client.sendTx(txHex);
      this._nonce += 1n;
      return { kind: 'accepted', latencyMs: performance.now() - t0, body };
    } catch (err) {
      const latencyMs = performance.now() - t0;
      if (err instanceof TxRejected) {
        // Nonce reuse / stale — pull fresh from chain so the next attempt
        // doesn't compound the drift.
        if (err.status === 400 || err.retryable === false) {
          await this._resyncNonce();
        }
        return {
          kind: 'rejected',
          latencyMs,
          status: err.status,
          retryable: err.retryable,
          reason: err.message,
        };
      }
      if (err instanceof TransportError) {
        return { kind: 'transport', latencyMs, reason: err.message };
      }
      return { kind: 'unknown', latencyMs, reason: String(err.message ?? err) };
    }
  }
}
