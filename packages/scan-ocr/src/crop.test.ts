import { describe, expect, it } from "vitest";
import {
  COLLECTOR_NUMBER_STRATEGIES,
  NUMBER_LINE_STRATEGY,
  SET_LINE_STRATEGY,
  TITLE_STRATEGY,
} from "./crop.ts";
import { cropRgba, type RgbaImage, toPixelRect } from "./image.ts";

function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

describe("collector number crop strategies", () => {
  it("keeps every strategy inside the unit square", () => {
    for (const s of [...COLLECTOR_NUMBER_STRATEGIES, TITLE_STRATEGY]) {
      expect(s.rect.x).toBeGreaterThanOrEqual(0);
      expect(s.rect.y).toBeGreaterThanOrEqual(0);
      expect(s.rect.x + s.rect.width).toBeLessThanOrEqual(1.0001);
      expect(s.rect.y + s.rect.height).toBeLessThanOrEqual(1.0001);
    }
  });

  it("keeps the number line above the set line", () => {
    expect(NUMBER_LINE_STRATEGY.rect.y + NUMBER_LINE_STRATEGY.rect.height).toBeLessThanOrEqual(
      SET_LINE_STRATEGY.rect.y + 0.001,
    );
  });

  it("keeps the set line narrow so artist text stays out", () => {
    expect(SET_LINE_STRATEGY.rect.width).toBeLessThanOrEqual(0.25);
  });

  it("maps optimal crop to a bottom-left pixel region", () => {
    const image = solid(100, 140, [0, 0, 0, 255]);
    const optimal = COLLECTOR_NUMBER_STRATEGIES.find((s) => s.name === "optimal");
    expect(optimal).toBeDefined();
    if (optimal === undefined) return;
    const pixel = toPixelRect(image, optimal.rect);
    expect(pixel.y).toBeGreaterThan(image.height * 0.88);
    expect(pixel.y + pixel.height).toBeLessThanOrEqual(image.height);
    expect(pixel.x).toBeLessThan(image.width * 0.2);
    expect(pixel.width).toBeGreaterThan(10);
    expect(pixel.height).toBeGreaterThan(5);
  });

  it("copies the requested region", () => {
    const image = solid(10, 10, [10, 20, 30, 255]);
    const i = (3 * 10 + 2) * 4;
    image.data[i] = 255;
    image.data[i + 1] = 0;
    image.data[i + 2] = 0;
    const cropped = cropRgba(image, { x: 2, y: 3, width: 1, height: 1 });
    expect(cropped.width).toBe(1);
    expect(cropped.height).toBe(1);
    expect([...cropped.data.slice(0, 3)]).toEqual([255, 0, 0]);
  });
});
