/**
 * An image as decoded pixels. Deliberately structural rather than a class or
 * a library type: `ImageData` in the browser and a raw buffer out of `sharp`
 * in Node both satisfy it without an adapter, which is what lets this
 * package be the single hashing implementation on both sides (KAD-25).
 */
export interface RgbaImage {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** A single-channel image. Same shape, one byte per pixel. */
export interface GrayImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * Rec. 601 luma coefficients, scaled to integers so the conversion is exact
 * on every platform.
 *
 * Floating-point weights would be fine numerically, but this package's whole
 * value is that two environments produce *identical* hashes; integer math
 * removes any question of the browser and Node rounding a threshold pixel
 * differently. The same reasoning applies to every rounding decision below.
 */
const R_WEIGHT = 299;
const G_WEIGHT = 587;
const B_WEIGHT = 114;

/**
 * RGBA → luma. Alpha is ignored rather than composited: card images are
 * opaque, and picking a background colour to composite against would be an
 * invented parameter that the two environments could disagree on.
 */
export function toGrayscale(image: RgbaImage): GrayImage {
  const { data, width, height } = image;
  const expected = width * height * 4;
  if (data.length !== expected) {
    throw new Error(
      `image data length ${String(data.length)} does not match ${String(width)}x${String(height)} RGBA (expected ${String(expected)})`,
    );
  }

  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    // Non-null assertions would be noise here - the length check above
    // guarantees these are in range, and `?? 0` documents the same thing
    // without changing behaviour.
    const r = data[p] ?? 0;
    const g = data[p + 1] ?? 0;
    const b = data[p + 2] ?? 0;
    out[i] = Math.round((r * R_WEIGHT + g * G_WEIGHT + b * B_WEIGHT) / 1000);
  }
  return { data: out, width, height };
}
