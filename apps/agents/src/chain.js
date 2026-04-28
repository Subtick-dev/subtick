// Submitter abstraction for the AI agents app.
//
// Identical contract to apps/game/src/chain.js: PlaceholderSubmitter posts
// invalid hex (HTTP 400 = transport validation), RealTxSubmitter signs and
// sends real Transfer txs. Both expose `.submit()` returning the same
// `{kind, latencyMs, ...}` shape so `protocol.js` is agnostic.

import {
  TxRejected,
  TransportError,
  buildSignedTransfer,
  derivePublicKey,
} from '../../../sdk/js/src/index.js';
import { randomTxPlaceholder } from './utils.js';

export class PlaceholderSubmitter {
  constructor(client) {
    this.client = client;
  }
  async init() {}
  async submit() {
    const tx = randomTxPlaceholder();
    const t0 = performance.now();
    try {
      const out = await this.client.sendTx(tx);
      return { kind: 'accepted', latencyMs: performance.now() - t0, body: out };
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
}

export class RealTxSubmitter {
  /**
   * @param {object} opts
   * @param {object} opts.client                   SubtickClient
   * @param {Buffer|Uint8Array} opts.privateKey    32-byte sender seed
   * @param {string[]} opts.recipientPool          hex addresses to cycle (agents' ids → 32B hashes)
   * @param {bigint} [opts.amount=1n]
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
      /* keep stale; next tick retries */
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
