/**
 * Collector-number OCR helpers for the OCR-primary scanner (KAD-44).
 *
 * Pure geometry / scoring / parsing live here. Decoding and the concrete OCR
 * engine (Tesseract.js in the browser, later PaddleOCR-VL on the worker) stay
 * outside so this package stays isomorphic and license-clean.
 */
export { COLLECTOR_NUMBER_STRATEGIES, type CropStrategy, type CropStrategyName } from "./crop.ts";
export type { OcrEngine } from "./engine.ts";
export { detectFoilCard, type PreprocessMode, preprocessModeFor } from "./foil.ts";
export {
  type CropRect,
  clampNormRect,
  cropRgba,
  type NormRect,
  type RgbaImage,
  toPixelRect,
} from "./image.ts";
export {
  isRejectedOcrText,
  type ParsedCollectorNumber,
  parseCollectorNumber,
  sanitizeOcrText,
} from "./parse.ts";
export { grayToRgba, preprocessForOcr } from "./preprocess.ts";
export {
  type RecognizeCollectorNumberOptions,
  type RecognizeCollectorNumberResult,
  recognizeCollectorNumber,
} from "./recognize.ts";
export {
  EARLY_EXIT_SCORE,
  type OcrAttempt,
  type ScoredOcrResult,
  scoreOcrAttempt,
} from "./score.ts";
