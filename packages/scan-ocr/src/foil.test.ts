import { describe, expect, it } from "vitest";
import { detectFoilCard } from "./foil.ts";
import type { RgbaImage } from "./image.ts";

function fill(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("detectFoilCard", () => {
  it("returns false for flat matte colour", () => {
    const image = fill(80, 110, () => [40, 90, 50]);
    expect(detectFoilCard(image)).toBe(false);
  });

  it("returns true when the art window has specular hotspots", () => {
    const image = fill(80, 110, (x, y) => {
      // Checker of near-white desaturated speckles in the art band.
      if (y > 25 && y < 60 && (x + y) % 7 === 0) return [250, 250, 245];
      return [30, 80, 40];
    });
    expect(detectFoilCard(image)).toBe(true);
  });
});
