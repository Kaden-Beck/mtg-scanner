import type { OcrEngine, RgbaImage } from "@mtg/scan-ocr";
import sharp from "sharp";

/**
 * Node Tesseract adapter for the corpus gate. Browser capture uses
 * `apps/web/src/app/scan/tesseract-engine.ts` (canvas); this path uses sharp
 * so the same `@mtg/scan-ocr` crop/score loop can run offline in CI/local.
 */
export function createNodeTesseractEngine(): OcrEngine {
  let workerPromise: Promise<import("tesseract.js").Worker> | null = null;

  async function getWorker() {
    workerPromise ??= (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/★† ",
      });
      return worker;
    })();
    return workerPromise;
  }

  return {
    async recognize(image: RgbaImage) {
      const worker = await getWorker();
      const png = await sharp(Buffer.from(image.data), {
        raw: { width: image.width, height: image.height, channels: 4 },
      })
        .png()
        .toBuffer();
      const result = await worker.recognize(png);
      const confidence =
        typeof result.data.confidence === "number" ? result.data.confidence / 100 : null;
      return { text: result.data.text, confidence };
    },
  };
}

export async function loadRgbaFromFile(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
}
