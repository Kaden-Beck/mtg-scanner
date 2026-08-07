import type { RgbaImage } from "./image.ts";

/**
 * Pluggable OCR backend. Browser v1 is Tesseract.js; a later ROCm worker can
 * implement the same shape with PaddleOCR-VL without changing crop/score.
 */
export interface OcrEngine {
  /**
   * Read text from an RGBA crop. `confidence` is 0–1 when the engine
   * exposes it; return null rather than inventing a number.
   */
  recognize(image: RgbaImage): Promise<{ text: string; confidence: number | null }>;
}
