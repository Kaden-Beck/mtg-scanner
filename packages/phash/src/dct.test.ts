import { describe, expect, it } from "vitest";
import { dct2d } from "./dct";
import { resizeGray } from "./resize";

describe("dct2d", () => {
  it("puts all the energy in DC for a constant block", () => {
    const flat = new Array(64).fill(10);
    const out = dct2d(flat, 8);
    expect(out[0]).toBeCloseTo(640, 6); // 64 samples x 10, unscaled
    for (let i = 1; i < 64; i++) expect(out[i] ?? 0).toBeCloseTo(0, 6);
  });

  it("matches the direct definition on a small block", () => {
    // A separable implementation is an optimization of the O(n^4) sum; if
    // the two ever disagree, the separation is wrong.
    const n = 4;
    const input = [1, 5, 3, 9, 2, 8, 4, 6, 7, 0, 2, 4, 3, 3, 1, 8];
    const fast = dct2d(input, n);

    for (let v = 0; v < n; v++) {
      for (let u = 0; u < n; u++) {
        let expected = 0;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            expected +=
              (input[y * n + x] ?? 0) *
              Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) *
              Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n));
          }
        }
        expect(fast[v * n + u] ?? 0).toBeCloseTo(expected, 6);
      }
    }
  });

  it("separates a horizontal gradient into the first row of coefficients", () => {
    const n = 8;
    const input: number[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) input.push(x * 10);
    const out = dct2d(input, n);

    // Varies only in x, so every coefficient with v > 0 must vanish.
    for (let v = 1; v < n; v++) {
      for (let u = 0; u < n; u++) expect(out[v * n + u] ?? 0).toBeCloseTo(0, 6);
    }
    expect(Math.abs(out[1] ?? 0)).toBeGreaterThan(1);
  });

  it("is linear", () => {
    const a = Array.from({ length: 16 }, (_, i) => i);
    const b = Array.from({ length: 16 }, (_, i) => 16 - i);
    const sum = dct2d(
      a.map((value, i) => value + (b[i] ?? 0)),
      4,
    );
    const separate = dct2d(a, 4);
    const other = dct2d(b, 4);
    for (let i = 0; i < 16; i++) {
      expect(sum[i] ?? 0).toBeCloseTo((separate[i] ?? 0) + (other[i] ?? 0), 6);
    }
  });

  it("rejects a block whose length does not match n", () => {
    expect(() => dct2d([1, 2, 3], 8)).toThrow(/expects 64 samples/);
  });
});

describe("resizeGray", () => {
  it("returns the same image when the size already matches", () => {
    const image = { data: new Uint8ClampedArray([1, 2, 3, 4]), width: 2, height: 2 };
    expect(resizeGray(image, 2, 2)).toBe(image);
  });

  it("averages the source rectangle each destination pixel covers", () => {
    const image = { data: new Uint8ClampedArray([0, 10, 20, 30]), width: 2, height: 2 };
    expect([...resizeGray(image, 1, 1).data]).toEqual([15]);
  });

  it("covers the source exactly once, with no gaps and no overlap", () => {
    // A 3 -> 2 downscale is the case where naive rounding drops or
    // double-counts a row.
    const data = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 60, 60, 60]);
    const out = resizeGray({ data, width: 3, height: 3 }, 1, 2);
    // Rows 0 (empty) and rows 1-2 (one empty, one at 60) average to 0 and 30.
    expect([...out.data]).toEqual([0, 30]);
  });

  it("upscales by replication rather than failing", () => {
    const image = { data: new Uint8ClampedArray([0, 100]), width: 2, height: 1 };
    expect([...resizeGray(image, 4, 1).data]).toEqual([0, 0, 100, 100]);
  });

  it("preserves a flat image exactly at any target size", () => {
    const data = new Uint8ClampedArray(64 * 64).fill(77);
    const out = resizeGray({ data, width: 64, height: 64 }, 32, 32);
    expect([...out.data].every((value) => value === 77)).toBe(true);
  });

  it("rejects a non-positive target", () => {
    const image = { data: new Uint8ClampedArray(4), width: 2, height: 2 };
    expect(() => resizeGray(image, 0, 8)).toThrow(/must be positive/);
  });
});
