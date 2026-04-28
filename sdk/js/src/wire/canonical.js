// Subtick canonical signing encoding.
//
// Mirrors `UnsignedTransaction::encode()` in
// `subtick/src/types/transaction.rs:179` byte-for-byte. This is the exact
// payload that ed25519 signs over — NOT the bincode wire format.
//
// Layout (little-endian):
//   version          2 B
//   chain_id         4 B
//   domain_id        4 B
//   tx_type          2 B  ← explicit discriminant (Transfer = 1, Vm = 2)
//   nonce            8 B
//   sender_pubkey   32 B
//   max_fee          8 B
//   priority_fee     8 B
//   gas_limit        8 B
//   ttl              8 B
//   scope_id         4 B   ← 0 means "no scope" (None), Some(0) is rejected
//   read_set_count   2 B
//   write_set_count  2 B
//   read_set         read_set_count  × 32 B
//   write_set        write_set_count × 32 B
//   payload_len      4 B
//   payload          payload_len B   (80 B fixed for Transfer)

import { createHash } from 'node:crypto';

// ── tx_type discriminants (canonical layer — match #[repr(u16)]) ──────────
export const TX_TYPE_TRANSFER = 1;
export const TX_TYPE_VM = 2;

// ── ResourceType discriminants (for account_resource_id) ──────────────────
const RESOURCE_TYPE_ACCOUNT = 1;

// ── Transfer payload (fixed 80 B) ─────────────────────────────────────────

/**
 * Build the 80-byte Transfer payload.
 *
 * @param {Buffer|Uint8Array} recipient  32-byte pubkey
 * @param {Buffer|Uint8Array} assetId    32-byte asset id (zeros = native)
 * @param {bigint} amount                u128 amount
 * @returns {Buffer} 80-byte payload
 */
export function encodeTransferPayload(recipient, assetId, amount) {
  assert32(recipient, 'recipient');
  assert32(assetId, 'assetId');
  assertBigInt(amount, 'amount');
  if (amount < 0n || amount >= 1n << 128n) {
    throw new RangeError(`amount out of u128 range: ${amount}`);
  }
  const buf = Buffer.alloc(80);
  buf.set(recipient, 0);
  buf.set(assetId, 32);
  writeUint128LE(buf, 64, amount);
  return buf;
}

// ── Unsigned canonical encode ─────────────────────────────────────────────

/**
 * Encode an `UnsignedTransaction` into the canonical signing bytes.
 *
 * @param {object} u
 * @param {number} u.version
 * @param {number} u.chainId
 * @param {number} u.domainId
 * @param {number} u.txType                       1 = Transfer, 2 = Vm
 * @param {bigint|number} u.nonce
 * @param {Buffer|Uint8Array} u.senderPubkey      32 B
 * @param {bigint|number} u.maxFee
 * @param {bigint|number} u.priorityFee
 * @param {bigint|number} u.gasLimit
 * @param {bigint|number} u.ttl
 * @param {number|null} u.scopeId                 null/undefined → 0
 * @param {Array<Buffer|Uint8Array>} u.readSet    each 32 B
 * @param {Array<Buffer|Uint8Array>} u.writeSet   each 32 B
 * @param {Buffer|Uint8Array} u.payload           opaque (80 B for Transfer)
 * @returns {Buffer}
 */
export function encodeUnsignedCanonical(u) {
  assert32(u.senderPubkey, 'senderPubkey');
  for (const r of u.readSet) assert32(r, 'readSet entry');
  for (const w of u.writeSet) assert32(w, 'writeSet entry');

  const rsCount = Math.min(u.readSet.length, 0xffff);
  const wsCount = Math.min(u.writeSet.length, 0xffff);
  const payload = Buffer.from(u.payload);

  const cap =
    2 + 4 + 4 + 2 + 8 + 32 + 8 + 8 + 8 + 8 + 4 + 2 + 2
    + rsCount * 32 + wsCount * 32 + 4 + payload.length;

  const buf = Buffer.alloc(cap);
  let p = 0;
  buf.writeUInt16LE(u.version, p); p += 2;
  buf.writeUInt32LE(u.chainId, p); p += 4;
  buf.writeUInt32LE(u.domainId, p); p += 4;
  buf.writeUInt16LE(u.txType, p); p += 2;
  buf.writeBigUInt64LE(toBigInt(u.nonce), p); p += 8;
  buf.set(u.senderPubkey, p); p += 32;
  buf.writeBigUInt64LE(toBigInt(u.maxFee), p); p += 8;
  buf.writeBigUInt64LE(toBigInt(u.priorityFee), p); p += 8;
  buf.writeBigUInt64LE(toBigInt(u.gasLimit), p); p += 8;
  buf.writeBigUInt64LE(toBigInt(u.ttl), p); p += 8;
  buf.writeUInt32LE(u.scopeId == null ? 0 : u.scopeId, p); p += 4;
  buf.writeUInt16LE(rsCount, p); p += 2;
  buf.writeUInt16LE(wsCount, p); p += 2;
  for (let i = 0; i < rsCount; i += 1) {
    buf.set(u.readSet[i], p); p += 32;
  }
  for (let i = 0; i < wsCount; i += 1) {
    buf.set(u.writeSet[i], p); p += 32;
  }
  buf.writeUInt32LE(payload.length, p); p += 4;
  buf.set(payload, p); p += payload.length;

  return buf;
}

// ── Resource id ───────────────────────────────────────────────────────────

/**
 * Account resource id = SHA256( ResourceType::Account(2 B LE) || pubkey ).
 * Matches `subtick/src/scheduler/access.rs:23`.
 *
 * @param {Buffer|Uint8Array} pubkey  32 B
 * @returns {Buffer} 32 B
 */
export function accountResourceId(pubkey) {
  assert32(pubkey, 'pubkey');
  const input = Buffer.alloc(34);
  input.writeUInt16LE(RESOURCE_TYPE_ACCOUNT, 0);
  input.set(pubkey, 2);
  return createHash('sha256').update(input).digest();
}

// ── helpers ──────────────────────────────────────────────────────────────

function assert32(b, name) {
  if (!b || b.length !== 32) {
    throw new TypeError(`${name} must be 32 bytes (got ${b ? b.length : 'null'})`);
  }
}

function assertBigInt(v, name) {
  if (typeof v !== 'bigint') {
    throw new TypeError(`${name} must be a BigInt (got ${typeof v})`);
  }
}

function toBigInt(v) {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function writeUint128LE(buf, offset, value) {
  // u128 = two u64 LE limbs, low half first.
  const lo = value & 0xffffffffffffffffn;
  const hi = (value >> 64n) & 0xffffffffffffffffn;
  buf.writeBigUInt64LE(lo, offset);
  buf.writeBigUInt64LE(hi, offset + 8);
}
