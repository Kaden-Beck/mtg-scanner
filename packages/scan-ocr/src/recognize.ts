import { COLLECTOR_NUMBER_STRATEGIES, type CropStrategy } from "./crop.ts";
import type { OcrEngine } from "./engine.ts";
import { detectFoilCard, type PreprocessMode } from "./foil.ts";
import { cropRgba, type RgbaImage, toPixelRect } from "./image.ts";
import { grayToRgba, preprocessForOcr } from "./preprocess.ts";
import { EARLY_EXIT_SCORE, type ScoredOcrResult, scoreOcrAttempt } from "./score.ts";

export interface RecognizeCollectorNumberOptions {
  readonly engine: OcrEngine;
  /** Override foil detection when the session already knows finish. */
  readonly preprocessMode?: PreprocessMode;
  /** Strategies to try; defaults to COLLECTOR_NUMBER_STRATEGIES. */
  readonly strategies?: readonly CropStrategy[];
  readonly earlyExitScore?: number;
}

export interface RecognizeCollectorNumberResult {
  readonly best: ScoredOcrResult | null;
  readonly attempts: readonly ScoredOcrResult[];
  readonly foilLikely: boolean;
  readonly preprocessMode: PreprocessMode;
}

/**
 * Multi-strategy collector-number OCR with scored early exit.
 *
 * The input image must already be a card-aligned guide-frame capture — this
 * does not segment or perspective-correct.
 */
export async function recognizeCollectorNumber(
  image: RgbaImage,
  options: RecognizeCollectorNumberOptions,
): Promise<RecognizeCollectorNumberResult> {
  const foilLikely = detectFoilCard(image);
  const mode = options.preprocessMode ?? (foilLikely ? "foil" : "normal");
  const strategies = options.strategies ?? COLLECTOR_NUMBER_STRATEGIES;
  const earlyExit = options.earlyExitScore ?? EARLY_EXIT_SCORE;

  const attempts: ScoredOcrResult[] = [];
  let best: ScoredOcrResult | null = null;

  for (const strategy of strategies) {
    const pixel = toPixelRect(image, strategy.rect);
    const cropped = cropRgba(image, pixel);
    const gray = preprocessForOcr(cropped, mode);
    const prepared = grayToRgba(gray, cropped.width, cropped.height);
    const { text, confidence } = await options.engine.recognize(prepared);
    const scored = scoreOcrAttempt({
      strategy: strategy.name,
      text,
      confidence,
    });
    attempts.push(scored);
    if (best === null || scored.score > best.score) {
      best = scored;
    }
    if (scored.score >= earlyExit && scored.parsed.setCode && scored.parsed.collectorNumber) {
      break;
    }
  }

  return { best, attempts, foilLikely, preprocessMode: mode };
}
