import type { PreprocessMode } from "./foil.ts";
import type { RgbaImage } from "./image.ts";

export type { PreprocessMode };

/**
 * Lightweight grayscale + contrast stretch for OCR. Foil mode biases toward
 * crushing specular highlights so the CN glyphs stay readable.
 *
 * Returns a single-channel buffer (one byte per pixel) — engines that need
 * RGBA can expand it.
 */
export function preprocessForOcr(image: RgbaImage, mode: PreprocessMode): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.width * image.height);
  let min = 255;
  let max = 0;
  const gray = new Uint8ClampedArray(image.width * image.height);

  for (let i = 0, p = 0; i < image.data.length; i += 4, p += 1) {
    const r = image.data[i] ?? 0;
    const g = image.data[i + 1] ?? 0;
    const b = image.data[i + 2] ?? 0;
    // Rec. 601 luma.
    let v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (mode === "foil" && v > 230) {
      // Crush specular whites toward mid-gray so they don't dominate.
      v = 180;
    }
    gray[p] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const span = Math.max(1, max - min);
  for (let p = 0; p < gray.length; p += 1) {
    const v = gray[p] ?? 0;
    out[p] = Math.round(((v - min) / span) * 255);
  }
  return out;
}

/** Expand grayscale to RGBA for engines that only accept color buffers. */
export function grayToRgba(gray: Uint8ClampedArray, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < gray.length; p += 1) {
    const v = gray[p] ?? 0;
    const i = p * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width, height, data };
}
