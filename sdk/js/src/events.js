// Subtick SDK — WebSocket event subscriber.
//
// Subscribes to `WS /v1/events` and delivers BatchExecuted frames to the
// caller's callback. Handles disconnect with simple exponential backoff
// (1s → 2s → 4s, capped at 10s). On a `Lagged` frame from the server, the
// callback receives `{ type: 'Lagged', skipped: N }` so the caller can
// decide whether to re-fetch state.
//
// No buffering, no replay, no resume cursors. The server's broadcast channel
// already absorbs reasonable jitter; if a client falls more than ~5 seconds
// behind it gets `Lagged` and skips ahead.

import WebSocket from 'ws';

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 10_000];

export class EventSubscription {
  /**
   * @param {string} url   ws:// or wss:// URL ending in `/v1/events`.
   * @param {(event: object) => void} onEvent
   * @param {object} [opts]
   * @param {boolean} [opts.autoReconnect=true]
   * @param {(err: Error) => void} [opts.onError]   Called for transport-level errors.
   * @param {() => void}           [opts.onOpen]    Called on successful (re)connect.
   * @param {(code: number, reason: string) => void} [opts.onClose]
   */
  constructor(url, onEvent, { autoReconnect = true, onError, onOpen, onClose } = {}) {
    this.url = url;
    this.onEvent = onEvent;
    this.autoReconnect = autoReconnect;
    this.onError = onError ?? (() => {});
    this.onOpen = onOpen ?? (() => {});
    this.onClose = onClose ?? (() => {});

    this._ws = null;
    this._closed = false;
    this._reconnectIdx = 0;
    this._reconnectTimer = null;

    this._connect();
  }

  /** Close the subscription and stop reconnecting. */
  close() {
    this._closed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.close(1000, 'client closed');
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  _connect() {
    if (this._closed) return;

    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.onError(err);
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    ws.on('open', () => {
      this._reconnectIdx = 0;
      this.onOpen();
    });

    ws.on('message', (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch (err) {
        this.onError(new Error(`malformed event frame: ${err.message}`));
        return;
      }
      try {
        this.onEvent(parsed);
      } catch (err) {
        this.onError(err);
      }
    });

    ws.on('error', (err) => {
      this.onError(err);
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf?.toString('utf8') ?? '';
      this.onClose(code, reason);
      if (!this._closed && this.autoReconnect) {
        this._scheduleReconnect();
      }
    });
  }

  _scheduleReconnect() {
    if (this._closed) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this._reconnectIdx, RECONNECT_DELAYS_MS.length - 1)];
    this._reconnectIdx += 1;
    this._reconnectTimer = setTimeout(() => this._connect(), delay);
  }
}

/**
 * Convenience: subscribe to `BatchExecuted` events on the API base URL.
 *
 * @param {string} baseUrl   e.g. 'http://127.0.0.1:8080' (auto-converted to ws://).
 * @param {(event: object) => void} onEvent
 * @param {object} [opts]
 * @returns {EventSubscription}
 */
export function subscribeEvents(baseUrl, onEvent, opts) {
  const wsUrl = baseUrl.replace(/^http(s?):/, 'ws$1:').replace(/\/$/, '') + '/v1/events';
  return new EventSubscription(wsUrl, onEvent, opts);
}
