import { describe, expect, it } from "vitest";
import { hammingDistance } from "./distance";
import { toGrayscale } from "./gray";
import { DCT_SIZE, HASH_BITS, phash, phashFromGray } from "./hash";
import { resizeGray } from "./resize";
import { jpegLikeDegrade, syntheticAlternate, syntheticArt, toRgba } from "./test-images";

describe("phash", () => {
  /**
   * The known-image → known-hash fixture (KAD-25 AC3).
   *
   * The literal is not meaningful on its own - it is a regression lock. Any
   * change to the resize filter, the DCT, the median rule or the bit order
   * moves it, and moving it silently is the failure this test exists to
   * prevent: the index and the scanner must agree, and a hash index built by
   * one version of this code is not comparable to a scan from another.
   * Changing it deliberately means rebuilding the index (KAD-24).
   */
  it("hashes a known image to a known value", () => {
    const hash = phashFromGray(syntheticArt(128, 128));
    expect(hash.toString(16).padStart(16, "0")).toBe("8d4d3236c951cece");
  });

  it("produces a 64-bit value", () => {
    const hash = phashFromGray(syntheticArt(128, 128));
    expect(hash).toBeGreaterThanOrEqual(0n);
    expect(hash).toBeLessThan(1n << BigInt(HASH_BITS));
  });

  it("is deterministic across repeated runs", () => {
    const image = syntheticArt(128, 128);
    expect(phashFromGray(image)).toBe(phashFromGray(image));
  });

  it("gives different images different hashes", () => {
    const a = phashFromGray(syntheticArt(128, 128));
    const b = phashFromGray(syntheticAlternate(128, 128));
    expect(a).not.toBe(b);
    // Not merely unequal - unrelated images should be far apart, or the
    // distance threshold a recognizer picks would be meaningless.
    expect(hammingDistance(a, b)).toBeGreaterThan(10);
  });

  it("reaches the same hash through the RGBA entry point", () => {
    const gray = syntheticArt(96, 96);
    expect(phash(toRgba(gray))).toBe(phashFromGray(gray));
  });

  /**
   * The isomorphism guarantee, tested at the seam where it is actually at
   * risk: a caller whose decoder hands back a different source size must
   * still land on the same hash, because the resize that matters happens in
   * this package rather than in the decoder.
   */
  it("hashes the same content identically from different source sizes", () => {
    const large = phashFromGray(syntheticArt(256, 256));
    const small = phashFromGray(syntheticArt(64, 64));
    expect(hammingDistance(large, small)).toBeLessThanOrEqual(4);
  });

  it("ignores alpha rather than compositing it", () => {
    const gray = syntheticArt(64, 64);
    const opaque = toRgba(gray);
    const transparent = {
      ...opaque,
      data: opaque.data.map((value, i) => (i % 4 === 3 ? 0 : value)),
    };
    expect(phash(transparent)).toBe(phash(opaque));
  });

  it("rejects data that does not match the stated dimensions", () => {
    expect(() => phash({ data: new Uint8ClampedArray(16), width: 4, height: 4 })).toThrow(
      /does not match/,
    );
  });

  it("handles a flat image without dividing by zero", () => {
    const data = new Uint8ClampedArray(64 * 64).fill(128);
    const hash = phashFromGray({ data, width: 64, height: 64 });
    // Every AC coefficient is 0 and so is the median, so no bit is strictly
    // greater: a featureless image hashes to zero rather than to garbage.
    expect(hash).toBe(0n);
  });
});

describe("phash robustness (KAD-25 AC3)", () => {
  const original = syntheticArt(256, 256);
  const originalHash = phashFromGray(original);

  it.each([
    ["mild downscale", 200],
    ["heavier downscale", 128],
    ["downscale to the DCT size itself", DCT_SIZE],
  ])("survives a %s", (_label, size) => {
    const resized = resizeGray(original, size, size);
    expect(hammingDistance(originalHash, phashFromGray(resized))).toBeLessThanOrEqual(6);
  });

  it("survives a non-square rescale", () => {
    // A scan will not have preserved the aspect ratio perfectly.
    const stretched = resizeGray(original, 210, 190);
    expect(hammingDistance(originalHash, phashFromGray(stretched))).toBeLessThanOrEqual(8);
  });

  it.each([
    ["high quality", 90],
    ["ordinary web quality", 75],
    ["visibly lossy", 50],
  ])("survives JPEG recompression at %s", (_label, quality) => {
    const degraded = jpegLikeDegrade(original, quality);
    expect(hammingDistance(originalHash, phashFromGray(degraded))).toBeLessThanOrEqual(6);
  });

  it("survives recompression and rescaling together", () => {
    // The realistic case: an image that has been through both.
    const mangled = resizeGray(jpegLikeDegrade(original, 70), 180, 180);
    expect(hammingDistance(originalHash, phashFromGray(mangled))).toBeLessThanOrEqual(8);
  });

  it("survives a uniform brightness shift", () => {
    // The DC coefficient absorbs this, which is precisely why it is excluded
    // from the median - see the comment in hash.ts.
    const brighter = {
      ...original,
      data: original.data.map((value) => Math.min(255, value + 25)),
    };
    expect(hammingDistance(originalHash, phashFromGray(brighter))).toBeLessThanOrEqual(2);
  });

  it("still separates unrelated images by more than it separates variants", () => {
    // The property that actually matters for recognition: the worst
    // same-image distance has to be comfortably below the best
    // different-image distance, or no threshold exists that works.
    const variant = phashFromGray(resizeGray(jpegLikeDegrade(original, 60), 150, 150));
    const unrelated = phashFromGray(syntheticAlternate(256, 256));
    expect(hammingDistance(originalHash, variant)).toBeLessThan(
      hammingDistance(originalHash, unrelated),
    );
  });
});

describe("toGrayscale", () => {
  it("weights the channels by Rec. 601 luma", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const gray = toGrayscale({ data, width: 2, height: 1 });
    expect(gray.data[0]).toBe(Math.round((255 * 299) / 1000));
    expect(gray.data[1]).toBe(Math.round((255 * 587) / 1000));
  });
});
