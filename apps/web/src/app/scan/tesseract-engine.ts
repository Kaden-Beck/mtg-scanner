import type { OcrEngine, RgbaImage } from "@mtg/scan-ocr";

/**
 * Browser Tesseract.js adapter (KAD-44 OCR engine v1).
 *
 * Loaded dynamically so the scan route's initial JS stays small until the
 * user actually captures a frame.
 */
export function createTesseractEngine(): OcrEngine {
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
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return { text: "", confidence: null };
      }
      const imageData = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
      ctx.putImageData(imageData, 0, 0);
      const result = await worker.recognize(canvas);
      const confidence =
        typeof result.data.confidence === "number" ? result.data.confidence / 100 : null;
      return { text: result.data.text, confidence };
    },
  };
}

/** Decode a video frame or ImageBitmap into an RGBA buffer for @mtg/scan-ocr. */
export function rgbaFromImageSource(
  source: CanvasImageSource,
  width: number,
  height: number,
): RgbaImage {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data };
}
