// Subtick SDK — error classes.
//
// Every error carries the underlying HTTP status (when applicable) and the
// `retryable` flag from the server response, so callers can implement their
// own backoff policy without parsing error messages.

export class SubtickError extends Error {
  constructor(message, { status = null, retryable = false, body = null } = {}) {
    super(message);
    this.name = 'SubtickError';
    this.status = status;
    this.retryable = retryable;
    this.body = body;
  }
}

export class TxRejected extends SubtickError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'TxRejected';
  }
}

export class AccountNotFound extends SubtickError {
  constructor(address) {
    super(`account not found: ${address}`, { status: 404, retryable: false });
    this.name = 'AccountNotFound';
    this.address = address;
  }
}

export class TransportError extends SubtickError {
  constructor(message, cause) {
    super(message, { retryable: true });
    this.name = 'TransportError';
    if (cause) this.cause = cause;
  }
}
