import type { GrayImage } from "./gray";

/**
 * Box-filter downscale to an exact target size.
 *
 * **This function is why the package exists in the shape it does.** Decoding
 * is environment-specific and unavoidably so, but resizing is not, and every
 * decoder ships its own resampler with its own filter and its own rounding.
 * If the hash index were built with `sharp`'s resize and the scanner used
 * `canvas`'s, the two would produce different hashes for the same artwork and
 * matching would simply fail - a bug that would not surface until a corpus
 * run, by which point tens of thousands of images have been hashed wrong.
 * So: decoded pixels come in, and every step from here to the hash lives in
 * this package.
 *
 * A box filter (average over the source rectangle each destination pixel
 * covers) is the right choice rather than a compromise. It is what a pHash
 * wants - a low-pass prefilter before a 32x32 DCT - and it is simple enough
 * to be obviously identical across environments, which bilinear-with-
 * edge-cases is not.
 *
 * Source rectangles are computed in integer arithmetic and cover the input
 * exactly once, with no gaps and no overlap, so upscaling and non-integer
 * ratios both behave.
 */
export function resizeGray(image: GrayImage, width: number, height: number): GrayImage {
  if (width <= 0 || height <= 0) {
    throw new Error(`resize target must be positive, got ${String(width)}x${String(height)}`);
  }
  if (image.width === width && image.height === height) return image;
  if (image.width === 0 || image.height === 0) {
    throw new Error("cannot resize an image with a zero dimension");
  }

  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    // Integer edges, so adjacent destination rows share a boundary exactly.
    const y0 = Math.floor((y * image.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));

    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * image.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));

      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * image.width;
        for (let sx = x0; sx < x1; sx++) {
          sum += image.data[row + sx] ?? 0;
          count++;
        }
      }
      out[y * width + x] = Math.round(sum / count);
    }
  }

  return { data: out, width, height };
}
