import { describe, expect, it } from "vitest";
import { bytesToHash, findClosest, findWithin, hammingDistance, hashToBytes } from "./distance";
import { HASH_BITS } from "./hash";
import { seededRandom } from "./test-images";

describe("hammingDistance", () => {
  it("is zero for identical hashes", () => {
    expect(hammingDistance(0xdeadbeefcafef00dn, 0xdeadbeefcafef00dn)).toBe(0);
  });

  it("counts differing bits", () => {
    expect(hammingDistance(0b0000n, 0b1011n)).toBe(3);
  });

  it("is symmetric", () => {
    const random = seededRandom(99);
    for (let i = 0; i < 50; i++) {
      const a = BigInt(Math.floor(random() * 2 ** 32)) << 32n;
      const b = BigInt(Math.floor(random() * 2 ** 32));
      expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
    }
  });

  it("saturates at the hash width for complementary hashes", () => {
    const all = (1n << 64n) - 1n;
    expect(hammingDistance(0n, all)).toBe(HASH_BITS);
  });

  it("obeys the triangle inequality", () => {
    // Not decorative: a recognizer's distance threshold only means anything
    // if the metric is actually a metric.
    const random = seededRandom(7);
    const draw = () => BigInt(Math.floor(random() * 2 ** 32)) << 32n;
    for (let i = 0; i < 25; i++) {
      const [a, b, c] = [draw(), draw(), draw()];
      expect(hammingDistance(a, c)).toBeLessThanOrEqual(
        hammingDistance(a, b) + hammingDistance(b, c),
      );
    }
  });
});

describe("findClosest", () => {
  const haystack = BigUint64Array.from([
    0x0000000000000000n,
    0x00000000000000ffn,
    0xff00000000000000n,
  ]);

  it("finds an exact match", () => {
    expect(findClosest(0x00000000000000ffn, haystack)).toEqual({ index: 1, distance: 0 });
  });

  it("finds the nearest inexact match", () => {
    // One bit off entry 1.
    expect(findClosest(0x00000000000000fen, haystack)).toEqual({ index: 1, distance: 1 });
  });

  /**
   * The case that matters most for recognition: a query with no real match
   * must report nothing rather than the least-bad row. Returning a confident
   * wrong card is worse than returning none.
   */
  it("returns null when nothing is within maxDistance", () => {
    expect(findClosest(0x0f0f0f0f0f0f0f0fn, haystack, 4)).toBeNull();
  });

  it("returns null for an empty index", () => {
    expect(findClosest(1n, new BigUint64Array(0))).toBeNull();
  });

  it("keeps the first of two equally distant entries, deterministically", () => {
    const ties = BigUint64Array.from([0b0001n, 0b0010n]);
    expect(findClosest(0b0011n, ties)).toEqual({ index: 0, distance: 1 });
  });

  /**
   * The AC's performance claim, asserted rather than assumed: ~110k
   * printings scanned linearly in single-digit milliseconds is what makes a
   * vector database unnecessary. Generous bound - this reports, it does not
   * gate CI wall-clock (the same rule the search benchmark follows).
   */
  it("scans a 110k-hash index fast enough to need no index structure", () => {
    const random = seededRandom(4242);
    const haystack110k = new BigUint64Array(110_000);
    for (let i = 0; i < haystack110k.length; i++) {
      haystack110k[i] =
        (BigInt(Math.floor(random() * 2 ** 32)) << 32n) | BigInt(Math.floor(random() * 2 ** 32));
    }
    const needle = (haystack110k[109_999] ?? 0n) ^ 0b101n;

    const started = performance.now();
    const match = findClosest(needle, haystack110k);
    const elapsed = performance.now() - started;

    // Correctness first: a benchmark that stopped finding anything would
    // otherwise benchmark as gloriously fast.
    expect(match?.index).toBe(109_999);
    expect(elapsed).toBeLessThan(250);
  });
});

describe("findWithin", () => {
  const haystack = BigUint64Array.from([0b0000n, 0b0001n, 0b0011n, 0b1111n]);

  it("returns every match inside the radius, nearest first", () => {
    expect(findWithin(0b0000n, haystack, 2)).toEqual([
      { index: 0, distance: 0 },
      { index: 1, distance: 1 },
      { index: 2, distance: 2 },
    ]);
  });

  it("returns nothing when the radius excludes everything", () => {
    expect(findWithin(0b0111n, BigUint64Array.from([0b1000n]), 3)).toEqual([]);
  });

  it("breaks distance ties by index, so the order is stable", () => {
    const ties = BigUint64Array.from([0b0010n, 0b0001n]);
    expect(findWithin(0b0011n, ties, 1).map((match) => match.index)).toEqual([0, 1]);
  });
});

describe("hashToBytes / bytesToHash", () => {
  it("encodes big-endian", () => {
    expect([...hashToBytes(0x0102030405060708n)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("round-trips", () => {
    const random = seededRandom(31337);
    for (let i = 0; i < 50; i++) {
      const hash =
        (BigInt(Math.floor(random() * 2 ** 32)) << 32n) | BigInt(Math.floor(random() * 2 ** 32));
      expect(bytesToHash(hashToBytes(hash))).toBe(hash);
    }
  });

  it("round-trips the extremes", () => {
    const all = (1n << 64n) - 1n;
    expect(bytesToHash(hashToBytes(0n))).toBe(0n);
    expect(bytesToHash(hashToBytes(all))).toBe(all);
    // The high bit set is where a signed-vs-unsigned mistake would show up.
    expect(hashToBytes(all)).toHaveLength(8);
  });

  it("always produces exactly 8 bytes, including for small values", () => {
    expect(hashToBytes(1n)).toHaveLength(8);
    expect([...hashToBytes(1n)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("refuses a wrong-length buffer rather than guessing", () => {
    expect(() => bytesToHash(new Uint8Array(4))).toThrow(/8 bytes/);
  });

  /** The shape KAD-24 will store and KAD-25's AC4 will load at boot. */
  it("loads a packed blob into a BigUint64Array unchanged", () => {
    const hashes = [0x0102030405060708n, 0xffffffffffffffffn, 0n];
    const blob = new Uint8Array(hashes.length * 8);
    hashes.forEach((hash, i) => {
      blob.set(hashToBytes(hash), i * 8);
    });

    const loaded = BigUint64Array.from(
      hashes.map((_, i) => bytesToHash(blob.subarray(i * 8, i * 8 + 8))),
    );
    expect([...loaded]).toEqual(hashes);
  });
});
