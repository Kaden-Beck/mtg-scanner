import type { RgbaImage } from "@mtg/phash";
import sharp from "sharp";

/**
 * Decodes encoded image bytes to raw RGBA pixels (KAD-24).
 *
 * **Decode only.** `sharp` is fully capable of resizing and of producing
 * grayscale directly, and it must do neither: every step from pixels to hash
 * belongs to `packages/phash`, which is the only way the index built here and
 * a hash computed by a browser scanner can agree. Using libvips' resampler
 * here would produce an index that only matches itself - see the comment on
 * `resizeGray`. This is the entire reason the decode boundary is its own
 * module rather than three lines inline in the job.
 *
 * `sharp` over the pure-JS `jpeg-js` because the Dockerfile already carries
 * what a native addon needs - `better-sqlite3` put python3/make/g++ in the
 * deps stage and the runner copies the compiled `node_modules` from the
 * builder at matching paths - so the second native dependency costs nothing
 * that the first did not already pay for. It also decodes PNG, which
 * `jpeg-js` would not, and Scryfall's image hosts are not contractually
 * bound to keep serving JPEG forever.
 */
export async function decodeToRgba(bytes: Uint8Array): Promise<RgbaImage> {
  // `ensureAlpha` guarantees 4 channels whatever the source had, which is
  // what `RgbaImage` promises its consumers; `phash` validates the length
  // against width x height x 4 and would throw otherwise.
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
