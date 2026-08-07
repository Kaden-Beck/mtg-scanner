/**
 * Decoded RGBA pixels shared by crop / foil / preprocess. Decoding stays
 * outside this package (canvas in the browser, sharp in Node) — same split
 * as `@mtg/phash`.
 */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Length `width * height * 4`, row-major RGBA. */
  readonly data: Uint8ClampedArray;
}

export interface CropRect {
  /** Inclusive left edge in pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Normalized crop of a card-aligned frame (0–1 fractions of width/height). */
export interface NormRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function clampNormRect(rect: NormRect): NormRect {
  const x = Math.min(1, Math.max(0, rect.x));
  const y = Math.min(1, Math.max(0, rect.y));
  const width = Math.min(1 - x, Math.max(0, rect.width));
  const height = Math.min(1 - y, Math.max(0, rect.height));
  return { x, y, width, height };
}

export function toPixelRect(image: RgbaImage, rect: NormRect): CropRect {
  const n = clampNormRect(rect);
  const x = Math.floor(n.x * image.width);
  const y = Math.floor(n.y * image.height);
  const width = Math.max(1, Math.floor(n.width * image.width));
  const height = Math.max(1, Math.floor(n.height * image.height));
  return {
    x: Math.min(x, Math.max(0, image.width - 1)),
    y: Math.min(y, Math.max(0, image.height - 1)),
    width: Math.min(width, image.width - x),
    height: Math.min(height, image.height - y),
  };
}

/** Copy a rectangular region into a new RGBA buffer. */
export function cropRgba(image: RgbaImage, rect: CropRect): RgbaImage {
  const { x, y, width, height } = rect;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * image.width + x) * 4;
    const dstStart = row * width * 4;
    data.set(image.data.subarray(srcStart, srcStart + width * 4), dstStart);
  }
  return { width, height, data };
}

/**
 * Nearest-neighbor upscale. Phone CN crops are often only ~20–40px tall —
 * Tesseract needs glyphs closer to ~30px+ to stop guessing.
 */
export function scaleRgbaNearest(image: RgbaImage, scale: number): RgbaImage {
  const s = Math.max(1, Math.floor(scale));
  if (s === 1) return image;
  const width = image.width * s;
  const height = image.height * s;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.floor(y / s);
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor(x / s);
      const si = (sy * image.width + sx) * 4;
      const di = (y * width + x) * 4;
      data[di] = image.data[si] ?? 0;
      data[di + 1] = image.data[si + 1] ?? 0;
      data[di + 2] = image.data[si + 2] ?? 0;
      data[di + 3] = image.data[si + 3] ?? 255;
    }
  }
  return { width, height, data };
}

/** Scale up until height reaches `minHeight` (capped), for OCR readability. */
export function upscaleForOcr(
  image: RgbaImage,
  options: { minHeight?: number; maxScale?: number } = {},
): RgbaImage {
  const minHeight = options.minHeight ?? 64;
  const maxScale = options.maxScale ?? 4;
  if (image.height >= minHeight) return image;
  const scale = Math.min(maxScale, Math.ceil(minHeight / Math.max(1, image.height)));
  return scaleRgbaNearest(image, scale);
}
