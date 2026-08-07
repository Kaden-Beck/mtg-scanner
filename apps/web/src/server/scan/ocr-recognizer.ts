import type { Recognizer, RecognizerOutput } from "@mtg/corpus";
import { type OcrEngine, type RgbaImage, recognizeCollectorNumber } from "@mtg/scan-ocr";
import { findPrinting } from "../corpus/lookup.ts";
import { createNodeTesseractEngine, loadRgbaFromFile } from "./node-tesseract.ts";

export interface OcrRecognizerOptions {
  readonly engine?: OcrEngine;
  readonly loadImage?: (path: string) => Promise<RgbaImage>;
}

/**
 * OCR-primary corpus recognizer (KAD-44 / ADR-008).
 *
 * Reports tier T2 so metrics stay comparable if T1 pHash returns later.
 */
export function createOcrRecognizer(options: OcrRecognizerOptions = {}): Recognizer {
  const engine = options.engine ?? createNodeTesseractEngine();
  const loadImage = options.loadImage ?? loadRgbaFromFile;

  return async (imagePath: string): Promise<RecognizerOutput> => {
    const image = await loadImage(imagePath);
    const result = await recognizeCollectorNumber(image, { engine });
    const setCode = result.best?.parsed.setCode;
    const collectorNumber = result.best?.parsed.collectorNumber;
    if (!setCode || !collectorNumber) {
      return { candidates: [], tier: "T2" };
    }

    const resolved = findPrinting(setCode, collectorNumber);
    if (!resolved) {
      return { candidates: [], tier: "T2" };
    }

    return {
      tier: "T2",
      candidates: [
        {
          scryfallId: resolved.card.id,
          oracleId: resolved.card.oracleId ?? resolved.card.id,
        },
      ],
    };
  };
}
