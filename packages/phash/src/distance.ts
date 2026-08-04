import { HASH_BITS } from "./hash";

/** 64 one-bits, for masking a BigInt back into hash width. */
const MASK_64 = (1n << 64n) - 1n;

/**
 * Hamming distance between two hashes: the number of differing bits, 0 to 64.
 *
 * XOR then popcount. The popcount walks set bits (`v &= v - 1n` clears the
 * lowest one) rather than all 64 positions, so near-identical hashes - the
 * overwhelmingly common case when scanning - cost only a handful of
 * iterations.
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let v = (a ^ b) & MASK_64;
  let count = 0;
  while (v !== 0n) {
    v &= v - 1n;
    count++;
  }
  return count;
}

/**
 * A match found by scanning the index.
 *
 * `index` is the caller's own array position, deliberately not an
 * illustration id: this module stays free of any knowledge of what the
 * hashes identify, and the caller already holds the parallel array that
 * answers that.
 */
export interface HashMatch {
  readonly index: number;
  readonly distance: number;
}

/**
 * Linear scan over a packed index, returning the closest hash within
 * `maxDistance`, or null.
 *
 * `BigUint64Array` is the point (KAD-25's "hashes load into a typed array at
 * boot"): ~110k printings is 880 KB contiguous, and a full scan is
 * single-digit milliseconds - so the recognition path needs no vector
 * database, no index structure, and no approximate search. A brute-force
 * scan that is simply fast enough is worth a great deal more than an
 * approximate one that is faster.
 *
 * `maxDistance` is applied as a filter, not just a cutoff on the winner: a
 * scan that returns the least-bad match out of a corpus that contains
 * nothing resembling the query is how a recognizer confidently reports the
 * wrong card.
 */
export function findClosest(
  needle: bigint,
  haystack: BigUint64Array,
  maxDistance = HASH_BITS,
): HashMatch | null {
  let bestIndex = -1;
  let bestDistance = maxDistance + 1;

  for (let i = 0; i < haystack.length; i++) {
    const distance = hammingDistance(needle, haystack[i] ?? 0n);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      // Nothing can beat an exact match, and during an index build or a
      // re-scan of a known image this is the expected outcome.
      if (distance === 0) break;
    }
  }

  if (bestIndex === -1 || bestDistance > maxDistance) return null;
  return { index: bestIndex, distance: bestDistance };
}

/**
 * Every hash within `maxDistance`, nearest first.
 *
 * Separate from `findClosest` because the two answer different questions:
 * this one is for showing a human the plausible candidates when a scan is
 * ambiguous, and for that "how close was the runner-up" is the important
 * part. Ties keep index order, so the result is deterministic.
 */
export function findWithin(
  needle: bigint,
  haystack: BigUint64Array,
  maxDistance: number,
): HashMatch[] {
  const matches: HashMatch[] = [];
  for (let i = 0; i < haystack.length; i++) {
    const distance = hammingDistance(needle, haystack[i] ?? 0n);
    if (distance <= maxDistance) matches.push({ index: i, distance });
  }
  return matches.sort((a, b) => a.distance - b.distance || a.index - b.index);
}

/**
 * Big-endian 8-byte encoding, for the `art_phash` / `full_phash` BLOB
 * columns (KAD-24).
 *
 * Big-endian so a hex dump of the column reads in the same bit order the
 * hash is written in, which makes a stored hash and a logged one comparable
 * by eye. The pair below is the only place that byte order is decided.
 */
export function hashToBytes(hash: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let value = hash & MASK_64;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/** Inverse of `hashToBytes`. */
export function bytesToHash(bytes: Uint8Array): bigint {
  if (bytes.length !== 8) {
    throw new Error(`a hash is 8 bytes, got ${String(bytes.length)}`);
  }
  let hash = 0n;
  for (const byte of bytes) hash = (hash << 8n) | BigInt(byte);
  return hash;
}
