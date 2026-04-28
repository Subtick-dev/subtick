// Subtick SDK — transaction builder.
//
// Two-step pipeline:
//   1. Compute the canonical signed bytes (`encodeUnsignedCanonical`).
//   2. Sign with ed25519 over those bytes.
//   3. Compose the wire Transaction (bincode).
//   4. Hex-encode the wire.
//
// Crypto: Node's built-in `node:crypto` Ed25519. To import a raw 32-byte
// seed we wrap it in a fixed PKCS#8 DER prefix — no third-party crypto deps.

import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';

import {
  TX_TYPE_TRANSFER,
  accountResourceId,
  encodeTransferPayload,
  encodeUnsignedCanonical,
} from './wire/canonical.js';
import { encodeTransactionWire } from './wire/bincode.js';

// ── Protocol constants (mirror subtick/src/types/transaction.rs) ────────────
export const TX_VERSION = 1;
export const CHAIN_ID = 1;
export const GAS_TRANSFER = 21_000;
export const MIN_FEE = GAS_TRANSFER;

// ── PKCS#8 wrapper for raw Ed25519 seed (RFC 8410) ────────────────────────
//
// Hex layout:
//   30 2e                          SEQUENCE (46)
//   02 01 00                       INTEGER 0 (version)
//   30 05                          SEQUENCE (5)
//     06 03 2b 65 70                OID 1.3.101.112 (Ed25519)
//   04 22                          OCTET STRING (34)
//     04 20                          OCTET STRING (32)  ← inner CurvePrivateKey
//     <32-byte seed>
//
// The 32-byte seed is appended at runtime to make a 48-byte DER blob.
const PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

/**
 * Import a raw 32-byte Ed25519 seed as a Node `KeyObject`.
 *
 * @param {Buffer|Uint8Array} seed  exactly 32 bytes
 * @returns {KeyObject}
 */
export function importEd25519PrivateKey(seed) {
  if (!seed || seed.length !== 32) {
    throw new TypeError(`Ed25519 seed must be 32 bytes (got ${seed?.length})`);
  }
  const der = Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)], PKCS8_PREFIX.length + 32);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/**
 * Derive the 32-byte Ed25519 public key from a 32-byte seed.
 *
 * @param {Buffer|Uint8Array} seed
 * @returns {Buffer} 32 bytes
 */
export function derivePublicKey(seed) {
  const priv = importEd25519PrivateKey(seed);
  const pub = createPublicKey(priv);
  // SubjectPublicKeyInfo DER for Ed25519 is 44 bytes; the last 32 are the
  // raw public key. Verified against ed25519-dalek round-trips.
  const der = pub.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
}

/**
 * Sign an arbitrary message with a 32-byte Ed25519 seed.
 *
 * @param {Buffer|Uint8Array} seed
 * @param {Buffer|Uint8Array} message
 * @returns {Buffer} 64-byte signature
 */
export function ed25519Sign(seed, message) {
  const priv = importEd25519PrivateKey(seed);
  // Ed25519 doesn't take a hash alg — pass null.
  return cryptoSign(null, Buffer.from(message), priv);
}

// ── Transfer builder ──────────────────────────────────────────────────────

/**
 * Build a signed Transfer transaction and return the hex blob ready to feed
 * to `client.sendTx`.
 *
 * Required:
 * @param {Buffer|Uint8Array} opts.privateKey   32-byte Ed25519 seed
 * @param {Buffer|Uint8Array} opts.recipient    32-byte recipient pubkey
 * @param {bigint|number}     opts.amount       u128 amount (use BigInt for large)
 * @param {bigint|number}     opts.nonce        u64 — must equal sender's current on-chain nonce
 * @param {bigint|number}     opts.ttl          u64 — last valid slot (TTL >= state.slot)
 *
 * Optional (sane defaults):
 * @param {Buffer|Uint8Array} [opts.senderPubkey]   if omitted, derived from privateKey
 * @param {number}            [opts.chainId=1]
 * @param {number}            [opts.domainId=0]
 * @param {bigint|number}     [opts.maxFee=21000]   must be >= MIN_FEE
 * @param {bigint|number}     [opts.priorityFee=0]
 * @param {bigint|number}     [opts.gasLimit=21000]
 * @param {Buffer|Uint8Array} [opts.assetId]        defaults to all-zero (native token)
 * @param {number}            [opts.shardId=0]
 *
 * @returns {string}   hex-encoded wire Transaction (input for `client.sendTx`)
 */
export function buildSignedTransfer(opts) {
  const {
    privateKey,
    recipient,
    amount,
    nonce,
    ttl,
    senderPubkey: senderPubkeyOpt,
    chainId = CHAIN_ID,
    domainId = 0,
    maxFee = MIN_FEE,
    priorityFee = 0,
    gasLimit = GAS_TRANSFER,
    assetId,
    shardId = 0,
  } = opts;

  if (!privateKey || privateKey.length !== 32) {
    throw new TypeError('privateKey must be 32 bytes');
  }
  if (!recipient || recipient.length !== 32) {
    throw new TypeError('recipient must be 32 bytes');
  }

  const senderPubkey = senderPubkeyOpt
    ? Buffer.from(senderPubkeyOpt)
    : derivePublicKey(privateKey);
  if (senderPubkey.length !== 32) {
    throw new TypeError('senderPubkey must be 32 bytes');
  }

  const asset = assetId ? Buffer.from(assetId) : Buffer.alloc(32); // native = zero
  const amountBig = typeof amount === 'bigint' ? amount : BigInt(amount);
  if (amountBig <= 0n) {
    throw new RangeError('amount must be > 0 (zero amount is rejected)');
  }

  const payloadBytes = encodeTransferPayload(Buffer.from(recipient), asset, amountBig);

  const readSet = [accountResourceId(senderPubkey)];
  const writeSet = [
    accountResourceId(senderPubkey),
    accountResourceId(Buffer.from(recipient)),
  ];

  const unsigned = {
    version: TX_VERSION,
    chainId,
    domainId,
    txType: TX_TYPE_TRANSFER,
    nonce,
    senderPubkey,
    maxFee,
    priorityFee,
    gasLimit,
    ttl,
    scopeId: null,
    readSet,
    writeSet,
    payload: payloadBytes,
  };

  // 1. canonical bytes (signed)
  const canonical = encodeUnsignedCanonical(unsigned);

  // 2. sign
  const signature = ed25519Sign(privateKey, canonical);
  if (signature.length !== 64) {
    // Defensive — Node's Ed25519 always returns 64 bytes, but if a future
    // runtime change ever breaks that, we want a loud error here, not on
    // the chain side.
    throw new Error(`unexpected signature length: ${signature.length}`);
  }

  // 3. compose the wire Transaction (bincode)
  const wire = encodeTransactionWire({
    inner: {
      version: TX_VERSION,
      chainId,
      domainId,
      txType: TX_TYPE_TRANSFER,
      nonce,
      senderPubkey,
      maxFee,
      priorityFee,
      gasLimit,
      ttl,
      scopeId: null,
      readSet,
      writeSet,
      payloadKind: 'Transfer',
      payloadInner: {
        recipient: Buffer.from(recipient),
        assetId: asset,
        amount: amountBig,
      },
    },
    signature,
    shardId,
  });

  // 4. hex
  return wire.toString('hex');
}
