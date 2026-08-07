export {
  COLLECTOR_NUMBER_STRATEGIES,
  type CropStrategy,
  type CropStrategyName,
  NUMBER_LINE_STRATEGY,
  SET_LINE_STRATEGY,
  TITLE_STRATEGY,
} from "./crop.ts";
export type { OcrEngine } from "./engine.ts";
export { detectFoilCard, type PreprocessMode, preprocessModeFor } from "./foil.ts";
export {
  type CropRect,
  clampNormRect,
  cropRgba,
  type NormRect,
  type RgbaImage,
  scaleRgbaNearest,
  toPixelRect,
  upscaleForOcr,
} from "./image.ts";
export {
  isRejectedOcrText,
  type ParsedCollectorNumber,
  parseCollectorNumber,
  sanitizeCardName,
  sanitizeOcrText,
} from "./parse.ts";
export { grayToRgba, preprocessForOcr } from "./preprocess.ts";
export {
  mergeSplitParses,
  type RecognizeCardTitleResult,
  type RecognizeCollectorNumberOptions,
  type RecognizeCollectorNumberResult,
  recognizeCardTitle,
  recognizeCollectorNumber,
} from "./recognize.ts";
export {
  EARLY_EXIT_SCORE,
  type OcrAttempt,
  type ScoredOcrResult,
  scoreOcrAttempt,
} from "./score.ts";
