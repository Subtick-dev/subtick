// Tiny helpers — no deps, no business logic.

import { randomBytes } from 'node:crypto';

/** Returns a random 32-byte address as 64-char hex (no `0x` prefix). */
export function randomAddress() {
  return randomBytes(32).toString('hex');
}

/** Inclusive-exclusive integer in `[lo, hi)`. */
export function randInt(lo, hi) {
  return Math.floor(lo + Math.random() * (hi - lo));
}

/** Uniformly pick one element from `arr`. Throws if empty. */
export function pick(arr) {
  if (arr.length === 0) throw new Error('pick from empty array');
  return arr[randInt(0, arr.length)];
}

/** Pick two distinct elements from `arr`. Throws if `arr.length < 2`. */
export function pickTwo(arr) {
  if (arr.length < 2) throw new Error('need at least 2 elements');
  const a = randInt(0, arr.length);
  let b = randInt(0, arr.length - 1);
  if (b >= a) b += 1;
  return [arr[a], arr[b]];
}

/** Weighted choice: `weights` is an array of non-negative numbers; returns the index. */
export function weightedPick(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) throw new Error('weights sum must be > 0');
  const r = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i += 1) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}

/** A 16-byte hex blob — just to vary placeholder tx bodies between actions. */
export function randomTxPlaceholder() {
  // The body is intentionally invalid bincode; the API rejects it with 400.
  // Varying it per-action makes the request stream visually distinguishable
  // and avoids any server-side dedup short-circuits.
  return randomBytes(16).toString('hex');
}
