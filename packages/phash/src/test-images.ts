import type { GrayImage, RgbaImage } from "./gray";

/**
 * Deterministic synthetic images for the test suite.
 *
 * Generated rather than committed as binary fixtures, per the plan: a
 * checked-in PNG tells a future reader nothing about *why* it should hash to
 * a particular value, and a generator can produce the resize and
 * recompression variants the robustness tests need without a fixture per
 * variant. Nothing here is card art - these are shapes and gradients chosen
 * to have structure at the low frequencies a pHash actually looks at.
 *
 * Not a `.test.ts` file: Vitest's node project globs those, and this module
 * contains helpers rather than tests.
 */

/**
 * Mulberry32. A seeded PRNG, because `Math.random()` in a test that asserts
 * an exact hash would be a flake generator.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A synthetic "artwork": a diagonal gradient, an off-centre bright disc, a
 * dark bar, and a little fixed noise. The asymmetry matters - a symmetric
 * pattern produces a degenerate DCT block where many coefficients sit on the
 * median and single-bit ties become arbitrary.
 */
export function syntheticArt(width: number, height: number, seed = 12345): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  const random = seededRandom(seed);
  const cx = width * 0.38;
  const cy = height * 0.42;
  const radius = Math.min(width, height) * 0.22;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      let value = 40 + 120 * (u * 0.6 + v * 0.4);

      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < radius * radius) value += 90;
      if (v > 0.72 && v < 0.83) value -= 60;

      // Small and seeded: enough to break exact ties, far too little to move
      // a low-frequency coefficient across the median.
      value += (random() - 0.5) * 6;
      data[y * width + x] = Math.round(value);
    }
  }
  return { data, width, height };
}

/** A second, clearly different image, for the "different images differ" cases. */
export function syntheticAlternate(width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Concentric rings: high structure, nothing in common with the gradient
      // and disc above.
      const dx = x / width - 0.5;
      const dy = y / height - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      data[y * width + x] = Math.round(128 + 100 * Math.sin(r * 40));
    }
  }
  return { data, width, height };
}

/** Widen a single-channel image to opaque RGBA, for the `phash` entry point. */
export function toRgba(gray: GrayImage): RgbaImage {
  const data = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0; i < gray.data.length; i++) {
    const value = gray.data[i] ?? 0;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { data, width: gray.width, height: gray.height };
}

/**
 * The standard JPEG luminance quantization table (Annex K), scaled by
 * `quality` the way libjpeg does.
 */
function quantizationTable(quality: number): number[] {
  const base = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
    92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
  ];
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  return base.map((value) => Math.min(255, Math.max(1, Math.floor((value * scale + 50) / 100))));
}

/**
 * JPEG recompression, simulated by doing what JPEG actually does to the
 * luma channel: split into 8x8 blocks, forward DCT, divide by the
 * quantization table, round, multiply back, inverse DCT.
 *
 * This is the whole of JPEG's lossy step. What it leaves out - entropy
 * coding, chroma subsampling - is either lossless or irrelevant to a
 * grayscale hash, so the degradation here is faithful rather than a stand-in
 * for it. Doing it this way also keeps the robustness AC free of a binary
 * fixture per quality level and free of an image-codec dependency in a
 * package whose entire premise is that it does not depend on one.
 */
export function jpegLikeDegrade(image: GrayImage, quality: number): GrayImage {
  const table = quantizationTable(quality);
  const out = new Uint8ClampedArray(image.data.length);

  for (let by = 0; by < image.height; by += 8) {
    for (let bx = 0; bx < image.width; bx += 8) {
      // Level-shift to [-128, 127], as JPEG does before the transform.
      const block = new Float64Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(bx + x, image.width - 1);
          const sy = Math.min(by + y, image.height - 1);
          block[y * 8 + x] = (image.data[sy * image.width + sx] ?? 0) - 128;
        }
      }

      const coefficients = forwardDct8(block);
      for (let i = 0; i < 64; i++) {
        const q = table[i] ?? 1;
        coefficients[i] = Math.round((coefficients[i] ?? 0) / q) * q;
      }
      const restored = inverseDct8(coefficients);

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const dx = bx + x;
          const dy = by + y;
          if (dx >= image.width || dy >= image.height) continue;
          out[dy * image.width + dx] = Math.round((restored[y * 8 + x] ?? 0) + 128);
        }
      }
    }
  }
  return { data: out, width: image.width, height: image.height };
}

/** Orthonormal scaling factor for an 8-point DCT. */
function alpha(u: number): number {
  return u === 0 ? Math.SQRT1_2 : 1;
}

function forwardDct8(block: Float64Array): Float64Array {
  const out = new Float64Array(64);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          sum +=
            (block[y * 8 + x] ?? 0) *
            Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }
      out[v * 8 + u] = 0.25 * alpha(u) * alpha(v) * sum;
    }
  }
  return out;
}

function inverseDct8(coefficients: Float64Array): Float64Array {
  const out = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          sum +=
            alpha(u) *
            alpha(v) *
            (coefficients[v * 8 + u] ?? 0) *
            Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }
      out[y * 8 + x] = 0.25 * sum;
    }
  }
  return out;
}
