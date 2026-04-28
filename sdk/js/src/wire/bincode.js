// Minimal bincode 1.x encoder for the exact shape of `Transaction`.
//
// Bincode 1.x default config (matches subtick Cargo.toml `bincode = "1"`):
//   * little-endian
//   * fixed-int encoding (no varint)
//   * Vec<T> / serialize_bytes prefix length as 8-byte u64 LE
//   * `[u8; N]` → N raw bytes (no length prefix)
//   * enum    → 4-byte u32 LE **variant index** (0-based, NOT the explicit
//                #[repr] discriminant — important for TxType / TxPayload)
//   * Option  → 1-byte tag (0 = None, 1 = Some) followed by T if Some
//
// Only the subset needed by `encodeTransactionWire` is implemented. Adding
// new tx types means extending `encodePayload`.

// ── bincode variant indices (NOT the canonical discriminants!) ────────────
const TX_TYPE_VARIANT = {
  Transfer: 0,
  Vm: 1,
};

const TX_PAYLOAD_VARIANT = {
  Transfer: 0,
  Vm: 1,
};

// ── primitives ────────────────────────────────────────────────────────────

class Writer {
  constructor() {
    this._chunks = [];
    this._len = 0;
  }
  pushBytes(b) {
    this._chunks.push(Buffer.from(b));
    this._len += b.length;
  }
  pushUint8(v) {
    const b = Buffer.alloc(1);
    b.writeUInt8(v, 0);
    this.pushBytes(b);
  }
  pushUint16LE(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v, 0);
    this.pushBytes(b);
  }
  pushUint32LE(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    this.pushBytes(b);
  }
  pushUint64LE(v) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(typeof v === 'bigint' ? v : BigInt(v), 0);
    this.pushBytes(b);
  }
  pushUint128LE(v) {
    const big = typeof v === 'bigint' ? v : BigInt(v);
    if (big < 0n || big >= 1n << 128n) {
      throw new RangeError(`u128 out of range: ${big}`);
    }
    const lo = big & 0xffffffffffffffffn;
    const hi = (big >> 64n) & 0xffffffffffffffffn;
    this.pushUint64LE(lo);
    this.pushUint64LE(hi);
  }
  /** Vec<T> length prefix: 8-byte u64 LE. */
  pushVecLen(n) {
    this.pushUint64LE(n);
  }
  /** serialize_bytes — same prefix as Vec<u8>. */
  pushBytesPrefixed(bytes) {
    this.pushVecLen(bytes.length);
    this.pushBytes(bytes);
  }
  pushVariantIndex(idx) {
    this.pushUint32LE(idx);
  }
  pushOptionNone() {
    this.pushUint8(0);
  }
  pushOptionSomeU32(v) {
    this.pushUint8(1);
    this.pushUint32LE(v);
  }
  finalize() {
    return Buffer.concat(this._chunks, this._len);
  }
}

// ── Transaction wire encoder ──────────────────────────────────────────────

/**
 * Bincode-encode the wire `Transaction` exactly as the subtick API expects.
 *
 * @param {object} tx
 * @param {object} tx.inner       UnsignedTransaction shape (camelCase or fields per encodeUnsignedCanonical input)
 * @param {Buffer|Uint8Array} tx.signature  64 bytes
 * @param {number} [tx.shardId=0] u8
 * @returns {Buffer}
 */
export function encodeTransactionWire(tx) {
  if (!tx.signature || tx.signature.length !== 64) {
    throw new TypeError(`signature must be 64 bytes (got ${tx.signature?.length})`);
  }
  const w = new Writer();
  encodeUnsignedBincode(w, tx.inner);
  w.pushBytesPrefixed(tx.signature);                 // sig_serde via serialize_bytes
  w.pushUint8(tx.shardId ?? 0);
  return w.finalize();
}

function encodeUnsignedBincode(w, u) {
  if (!u.senderPubkey || u.senderPubkey.length !== 32) {
    throw new TypeError('senderPubkey must be 32 bytes');
  }
  // version: u16 LE
  w.pushUint16LE(u.version);
  // chain_id: u32 LE
  w.pushUint32LE(u.chainId);
  // domain_id: u32 LE
  w.pushUint32LE(u.domainId);
  // tx_type: enum → variant index (NOT the explicit discriminant!)
  if (u.txType === 1) w.pushVariantIndex(TX_TYPE_VARIANT.Transfer);
  else if (u.txType === 2) w.pushVariantIndex(TX_TYPE_VARIANT.Vm);
  else throw new Error(`unknown txType ${u.txType}`);
  // nonce: u64
  w.pushUint64LE(u.nonce);
  // sender_pubkey: [u8; 32] — raw, no length
  w.pushBytes(u.senderPubkey);
  // max_fee, priority_fee, gas_limit, ttl: u64 LE
  w.pushUint64LE(u.maxFee);
  w.pushUint64LE(u.priorityFee);
  w.pushUint64LE(u.gasLimit);
  w.pushUint64LE(u.ttl);
  // scope_id: Option<u32>
  if (u.scopeId == null) w.pushOptionNone();
  else w.pushOptionSomeU32(u.scopeId);
  // read_set: Vec<[u8; 32]>
  w.pushVecLen(u.readSet.length);
  for (const r of u.readSet) {
    if (r.length !== 32) throw new TypeError('readSet entry must be 32 bytes');
    w.pushBytes(r);
  }
  // write_set: Vec<[u8; 32]>
  w.pushVecLen(u.writeSet.length);
  for (const ww of u.writeSet) {
    if (ww.length !== 32) throw new TypeError('writeSet entry must be 32 bytes');
    w.pushBytes(ww);
  }
  // payload: enum TxPayload
  encodePayload(w, u.payloadKind, u.payloadInner);
}

function encodePayload(w, kind, inner) {
  if (kind === 'Transfer') {
    w.pushVariantIndex(TX_PAYLOAD_VARIANT.Transfer);
    // TransferPayload: recipient[32] | asset_id[32] | amount u128 LE
    if (inner.recipient.length !== 32) throw new TypeError('recipient must be 32 bytes');
    if (inner.assetId.length !== 32) throw new TypeError('assetId must be 32 bytes');
    w.pushBytes(inner.recipient);
    w.pushBytes(inner.assetId);
    w.pushUint128LE(inner.amount);
  } else if (kind === 'Vm') {
    w.pushVariantIndex(TX_PAYLOAD_VARIANT.Vm);
    // VmPayload: accounts: Vec<[u8;32]> | bytecode: Vec<u8>
    w.pushVecLen(inner.accounts.length);
    for (const a of inner.accounts) {
      if (a.length !== 32) throw new TypeError('vm account must be 32 bytes');
      w.pushBytes(a);
    }
    w.pushVecLen(inner.bytecode.length);
    w.pushBytes(inner.bytecode);
  } else {
    throw new Error(`unknown payloadKind ${kind}`);
  }
}
