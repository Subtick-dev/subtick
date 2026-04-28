// Subtick SDK — HTTP client.
//
// Thin wrapper over the 4 Subtick API endpoints. No business logic, no caching,
// no transaction building. Callers pass pre-encoded `txHex` (hex-encoded
// bincode of `Transaction`) and receive every server-side field unchanged.
//
// Uses native `fetch` (Node 18+, modern browsers). No external HTTP deps.

import { SubtickError, TxRejected, AccountNotFound, TransportError } from './errors.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT_MS = 5000;

export class SubtickClient {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl='http://127.0.0.1:8080']
   * @param {number} [opts.timeoutMs=5000]  Per-request timeout (HTTP only).
   * @param {object} [opts.fetch]           Optional fetch override (testing).
   */
  constructor({ baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this._fetch = fetchImpl ?? globalThis.fetch;
    if (!this._fetch) {
      throw new Error('fetch is not available — use Node 18+ or pass a fetch implementation');
    }
  }

  /**
   * Submit a signed transaction.
   *
   * @param {string} txHex  Hex-encoded bincode of `Transaction`. The SDK does
   *                        NOT build / sign / encode — the caller supplies the
   *                        wire-ready blob.
   * @returns {Promise<{accepted: boolean, txHash: string|null, reason: string|null, retryable: boolean}>}
   * @throws  {TxRejected} on server-side rejection (4xx). `.retryable` indicates
   *                       whether resubmitting the same body could succeed.
   */
  async sendTx(txHex) {
    if (typeof txHex !== 'string' || txHex.length === 0) {
      throw new SubtickError('txHex must be a non-empty hex string', { retryable: false });
    }
    const res = await this._http('POST', '/v1/tx', { tx: txHex });
    const body = await this._json(res);
    const result = {
      accepted: !!body.accepted,
      txHash: body.tx_hash ?? null,
      reason: body.reason ?? null,
      retryable: !!body.retryable,
    };
    if (!result.accepted) {
      throw new TxRejected(result.reason || `tx rejected (HTTP ${res.status})`, {
        status: res.status,
        retryable: result.retryable,
        body: result,
      });
    }
    return result;
  }

  /**
   * Read an account's balance.
   *
   * @param {string} address  32-byte pubkey, hex (with or without `0x`).
   * @returns {Promise<{address: string, balance: string}>} balance is a u128
   *          decimal string — parse to BigInt, never to Number.
   * @throws {AccountNotFound} if the account has never been touched.
   */
  async getBalance(address) {
    const res = await this._http('GET', `/v1/balance/${encodeURIComponent(address)}`);
    if (res.status === 404) throw new AccountNotFound(address);
    const body = await this._json(res);
    if (!res.ok) {
      throw new SubtickError(body.error || `balance lookup failed (HTTP ${res.status})`, {
        status: res.status,
        retryable: res.status >= 500,
        body,
      });
    }
    return body;
  }

  /**
   * Read an account's full state (balance + nonce).
   *
   * @param {string} address  32-byte pubkey, hex.
   * @returns {Promise<{address: string, balance: string, nonce: number}>}
   * @throws {AccountNotFound} if the account has never been touched.
   */
  async getAccount(address) {
    const res = await this._http('GET', `/v1/account/${encodeURIComponent(address)}`);
    if (res.status === 404) throw new AccountNotFound(address);
    const body = await this._json(res);
    if (!res.ok) {
      throw new SubtickError(body.error || `account lookup failed (HTTP ${res.status})`, {
        status: res.status,
        retryable: res.status >= 500,
        body,
      });
    }
    return body;
  }

  /**
   * Liveness probe.
   *
   * @returns {Promise<{status: string, height: number, slot: number, accountCount: number}>}
   */
  async health() {
    const res = await this._http('GET', '/health');
    const body = await this._json(res);
    if (!res.ok) {
      throw new SubtickError(`health check failed (HTTP ${res.status})`, {
        status: res.status,
        retryable: true,
        body,
      });
    }
    return {
      status: body.status,
      height: body.height,
      slot: body.slot,
      accountCount: body.account_count,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  async _http(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return res;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new TransportError(`request timed out after ${this.timeoutMs}ms`, err);
      }
      throw new TransportError(`network error: ${err.message}`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  async _json(res) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new TransportError(`malformed JSON response (HTTP ${res.status}): ${text.slice(0, 100)}`, err);
    }
  }
}
