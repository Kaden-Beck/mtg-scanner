/**
 * Isomorphic 64-bit perceptual hashing (KAD-25).
 *
 * The package takes *decoded pixels* and never an encoded image. Decoding is
 * environment-specific - `createImageBitmap` in a browser, `sharp` or
 * `jpeg-js` in Node - but resize, grayscale, DCT and binarization all live
 * here and are the only implementation, so a hash computed while building
 * the index and a hash computed while scanning are bit-identical. See the
 * comment on `resizeGray` for why that constraint is the load-bearing design
 * decision in this package.
 */
export type { HashMatch } from "./distance";
export { bytesToHash, findClosest, findWithin, hammingDistance, hashToBytes } from "./distance";
export { type GrayImage, type RgbaImage, toGrayscale } from "./gray";
export { DCT_SIZE, HASH_BITS, HASH_BLOCK, phash, phashFromGray } from "./hash";
export { resizeGray } from "./resize";
