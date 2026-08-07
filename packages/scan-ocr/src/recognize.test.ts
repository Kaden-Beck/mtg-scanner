import { describe, expect, it } from "vitest";
import type { OcrEngine } from "./engine.ts";
import type { RgbaImage } from "./image.ts";
import { recognizeCollectorNumber } from "./recognize.ts";
import { EARLY_EXIT_SCORE, scoreOcrAttempt } from "./score.ts";

describe("scoreOcrAttempt", () => {
  it("scores a full set+number parse highly", () => {
    const scored = scoreOcrAttempt({
      strategy: "optimal",
      text: "FDN U 0125",
      confidence: 0.9,
    });
    expect(scored.parsed.setCode).toBe("fdn");
    expect(scored.parsed.collectorNumber).toBe("0125");
    expect(scored.score).toBeGreaterThanOrEqual(EARLY_EXIT_SCORE);
  });

  it("scores number-only below early-exit", () => {
    const scored = scoreOcrAttempt({
      strategy: "optimal",
      text: "0125",
      confidence: null,
    });
    expect(scored.score).toBeLessThan(EARLY_EXIT_SCORE);
  });
});

describe("recognizeCollectorNumber", () => {
  function solid(width: number, height: number): RgbaImage {
    const data = new Uint8ClampedArray(width * height * 4);
    data.fill(128);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { width, height, data };
  }

  it("stops early after split number+set lines clear the threshold", async () => {
    let calls = 0;
    const engine: OcrEngine = {
      recognize: () => {
        calls += 1;
        // Call 1 = number line, call 2 = set line; both return a full parse so
        // the merged result early-exits before combined-strip fallbacks.
        return Promise.resolve({ text: "FDN U 0125", confidence: 0.95 });
      },
    };
    const result = await recognizeCollectorNumber(solid(100, 140), { engine });
    expect(calls).toBe(2);
    expect(result.best?.parsed.setCode).toBe("fdn");
    expect(result.best?.parsed.collectorNumber).toBe("0125");
    expect(result.attempts.length).toBeGreaterThanOrEqual(2);
  });

  it("tries further strategies when the first parse is weak", async () => {
    const texts = ["xx", "garbage", "xx", "MH2 250", "unused"];
    let i = 0;
    const engine: OcrEngine = {
      recognize: () => {
        const text = texts[i] ?? "";
        i += 1;
        return Promise.resolve({ text, confidence: null });
      },
    };
    const result = await recognizeCollectorNumber(solid(100, 140), { engine });
    expect(i).toBeGreaterThan(2);
    expect(result.best?.parsed.setCode).toBe("mh2");
    expect(result.best?.parsed.collectorNumber).toBe("250");
  });
});
