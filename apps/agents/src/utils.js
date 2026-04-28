// Tiny helpers — same shape as apps/game/src/utils.js, deliberately not
// shared because cross-app coupling adds risk for a tiny win.

import { randomBytes } from 'node:crypto';

export function randomAddress() {
  return randomBytes(32).toString('hex');
}

export function randInt(lo, hi) {
  return Math.floor(lo + Math.random() * (hi - lo));
}

export function pick(arr) {
  if (arr.length === 0) throw new Error('pick from empty array');
  return arr[randInt(0, arr.length)];
}

/** Random 16-byte hex blob — invalid bincode, varies per call. */
export function randomTxPlaceholder() {
  return randomBytes(16).toString('hex');
}

/** Monotonically increasing id with a short prefix, for human-readable logs. */
let _seq = 0;
export function nextId(prefix) {
  _seq += 1;
  return `${prefix}_${_seq.toString(36).padStart(4, '0')}`;
}

/** Sleep helper for the loop's pacing. */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
