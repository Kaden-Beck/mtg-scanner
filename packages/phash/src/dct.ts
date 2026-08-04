/**
 * Separable 2D DCT-II, the transform at the centre of a pHash.
 *
 * O(n^3) and separable (rows, then columns) rather than a fast DCT: at 32x32
 * that is ~65k multiply-adds per image, which is nothing next to decoding
 * and downloading the image in the first place. An FFT-based version would
 * be several times the code for a saving that never shows up in the profile,
 * and this package's correctness is load-bearing across two environments -
 * the readable implementation is the right trade.
 *
 * Orthonormal scaling is omitted deliberately. The hash binarizes each
 * coefficient against the median of the others, and a uniform positive scale
 * factor moves every coefficient and the median together - so it cannot
 * change a single bit. Leaving it out removes a step where two
 * implementations could disagree.
 */

/**
 * Cosine tables are cached per size: the same 32x32 basis is reused for
 * every image in a 47k-image index build, and recomputing ~1k cosines per
 * transform is pure waste.
 */
const cosineTables = new Map<number, Float64Array>();

function cosineTable(n: number): Float64Array {
  const cached = cosineTables.get(n);
  if (cached !== undefined) return cached;

  // table[u * n + x] = cos((2x + 1) * u * PI / 2n)
  const table = new Float64Array(n * n);
  for (let u = 0; u < n; u++) {
    for (let x = 0; x < n; x++) {
      table[u * n + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
    }
  }
  cosineTables.set(n, table);
  return table;
}

/**
 * 2D DCT-II of a square n x n block, returned row-major with the DC
 * coefficient at index 0.
 */
export function dct2d(input: ArrayLike<number>, n: number): Float64Array {
  if (input.length !== n * n) {
    throw new Error(
      `dct2d expects ${String(n * n)} samples for ${String(n)}x${String(n)}, got ${String(input.length)}`,
    );
  }
  const table = cosineTable(n);

  // Pass 1: transform each row.
  const rows = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const offset = y * n;
    for (let u = 0; u < n; u++) {
      let sum = 0;
      for (let x = 0; x < n; x++) {
        sum += (input[offset + x] ?? 0) * (table[u * n + x] ?? 0);
      }
      rows[offset + u] = sum;
    }
  }

  // Pass 2: transform each column of the result.
  const out = new Float64Array(n * n);
  for (let x = 0; x < n; x++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let y = 0; y < n; y++) {
        sum += (rows[y * n + x] ?? 0) * (table[v * n + y] ?? 0);
      }
      out[v * n + x] = sum;
    }
  }
  return out;
}
