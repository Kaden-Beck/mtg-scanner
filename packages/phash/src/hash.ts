import { dct2d } from "./dct";
import { type GrayImage, type RgbaImage, toGrayscale } from "./gray";
import { resizeGray } from "./resize";

/** Working size for the DCT. 32x32 is the standard choice for a 64-bit pHash. */
export const DCT_SIZE = 32;
/** Edge of the retained low-frequency block: 8x8 = 64 coefficients = 64 bits. */
export const HASH_BLOCK = 8;
/** Bit width of the produced hash. */
export const HASH_BITS = HASH_BLOCK * HASH_BLOCK;

/**
 * 64-bit perceptual hash: grayscale -> 32x32 -> 2D DCT -> top-left 8x8
 * low-frequency block, binarized against the median.
 *
 * Bit order is fixed and documented because it is a wire format: bit 63 (the
 * most significant) is coefficient (0,0), running row-major to bit 0 at
 * (7,7). Anything that stores or compares these has to agree, so the choice
 * is stated rather than left to whatever the loop happened to do.
 */
export function phash(image: RgbaImage): bigint {
  return phashFromGray(toGrayscale(image));
}

/**
 * The same hash from an already-single-channel image, for callers whose
 * decoder can hand back grayscale directly and skip a conversion.
 */
export function phashFromGray(gray: GrayImage): bigint {
  const small = resizeGray(gray, DCT_SIZE, DCT_SIZE);
  const coefficients = dct2d(small.data, DCT_SIZE);

  // The top-left 8x8 block: the lowest frequencies, which is where the
  // structure a human would recognize lives. Note this reads a sub-block of
  // a 32-wide row, hence the stride.
  const block: number[] = [];
  for (let v = 0; v < HASH_BLOCK; v++) {
    for (let u = 0; u < HASH_BLOCK; u++) {
      block.push(coefficients[v * DCT_SIZE + u] ?? 0);
    }
  }

  // The DC coefficient (0,0) is excluded from the median.
  //
  // This is *the* pHash gotcha and the usual reason two implementations of
  // "the same" algorithm disagree. DC carries the image's overall
  // brightness, so it is typically an order of magnitude larger than every
  // AC coefficient; leaving it in drags the median far off the middle of the
  // real distribution and the resulting bits are mostly a statement about
  // exposure rather than about content.
  const ac = block.slice(1);

  /**
   * Coefficients are quantized to a relative grid before anything is
   * compared, and a featureless image is answered directly.
   *
   * Without this, binarizing is a bare `>` between two floats that may
   * differ only in the last few bits - and `Math.cos` is *not* guaranteed
   * identical across JavaScript engines. Two coefficients that are equal in
   * exact arithmetic can therefore land on opposite sides of the median in
   * Node and in a browser, which is precisely the isomorphism this package
   * exists to guarantee. Real artwork is nowhere near a tie, so this changes
   * no hash that mattered; a flat or near-flat region - a card back, a
   * blurred frame, an empty scanning mat - is *all* ties, and without the
   * guard it hashes to pure numerical noise rather than to a stable value.
   */
  const scale = Math.max(...ac.map(Math.abs));
  if (scale < FLAT_IMAGE_EPSILON) return 0n;

  const quantized = block.map((value) => Math.round((value / scale) * QUANTIZATION_STEPS));
  const median = medianOf(quantized.slice(1));

  let hash = 0n;
  for (let i = 0; i < HASH_BITS; i++) {
    // DC still gets a bit - it is simply not allowed to set the threshold.
    if ((quantized[i] ?? 0) > median) hash |= 1n << BigInt(HASH_BITS - 1 - i);
  }
  return hash;
}

/**
 * Below this largest-AC-coefficient magnitude the image carries no structure
 * at all. Pixels are 0-255 over a 32x32 block, so anything visible produces
 * AC coefficients of order 1 or more - while engine-level float noise sits
 * around 1e-10. Many orders of magnitude of daylight between the two.
 */
const FLAT_IMAGE_EPSILON = 1e-6;

/**
 * Coefficients are compared on a grid this many steps across, relative to
 * the largest AC coefficient. 2^20 is far finer than any difference that
 * distinguishes two artworks and far coarser than the ~1e-16 relative
 * disagreement two engines' `Math.cos` can produce.
 */
const QUANTIZATION_STEPS = 1 << 20;

/**
 * Median with the even-length case averaged rather than lower-biased.
 * Sorting a copy: the caller's block order is the bit order and must not be
 * disturbed.
 */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
