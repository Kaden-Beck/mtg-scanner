import {
  COLLECTOR_NUMBER_STRATEGIES,
  type CropStrategy,
  NUMBER_LINE_STRATEGY,
  SET_LINE_STRATEGY,
  TITLE_STRATEGY,
} from "./crop.ts";
import type { OcrEngine } from "./engine.ts";
import { detectFoilCard, type PreprocessMode } from "./foil.ts";
import { cropRgba, type RgbaImage, toPixelRect } from "./image.ts";
import { type ParsedCollectorNumber, sanitizeCardName } from "./parse.ts";
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

async function ocrCrop(
  image: RgbaImage,
  strategy: CropStrategy,
  engine: OcrEngine,
  mode: PreprocessMode,
): Promise<ScoredOcrResult> {
  const pixel = toPixelRect(image, strategy.rect);
  const cropped = cropRgba(image, pixel);
  const gray = preprocessForOcr(cropped, mode);
  const prepared = grayToRgba(gray, cropped.width, cropped.height);
  const { text, confidence } = await engine.recognize(prepared);
  return scoreOcrAttempt({
    strategy: strategy.name,
    text,
    confidence,
  });
}

/**
 * Merge split number-line + set-line OCR into one parse. Modern strips keep
 * `C 0041` and `SOS` on different lines; combining the two crops recovers
 * what a single fat crop confuses with EN / artist.
 */
export function mergeSplitParses(
  numberLine: ParsedCollectorNumber,
  setLine: ParsedCollectorNumber,
): ParsedCollectorNumber {
  return {
    setCode: setLine.setCode ?? numberLine.setCode,
    collectorNumber: numberLine.collectorNumber ?? setLine.collectorNumber,
    raw: [numberLine.raw, setLine.raw].filter(Boolean).join(" ").trim(),
  };
}

/**
 * Multi-strategy collector-number OCR with scored early exit.
 *
 * Tries split number/set lines first, then combined-strip fallbacks.
 * The input image must already be a card-aligned guide-frame capture.
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

  const numberAttempt = await ocrCrop(image, NUMBER_LINE_STRATEGY, options.engine, mode);
  const setAttempt = await ocrCrop(image, SET_LINE_STRATEGY, options.engine, mode);
  attempts.push(numberAttempt, setAttempt);

  const merged = mergeSplitParses(numberAttempt.parsed, setAttempt.parsed);
  if (merged.setCode && merged.collectorNumber) {
    const mergedScore = scoreOcrAttempt({
      strategy: "optimal",
      text: merged.raw,
      confidence: Math.max(
        numberAttempt.attempt.confidence ?? 0,
        setAttempt.attempt.confidence ?? 0,
      ),
    });
    // Force the merged parse (scoreOcrAttempt re-parses text; keep merged fields).
    const forced: ScoredOcrResult = {
      attempt: mergedScore.attempt,
      parsed: merged,
      score: Math.min(
        1,
        (merged.collectorNumber ? 0.55 : 0) +
          (merged.setCode ? 0.35 : 0) +
          0.1 * Math.max(numberAttempt.attempt.confidence ?? 0, setAttempt.attempt.confidence ?? 0),
      ),
    };
    attempts.push(forced);
    best = forced;
    if (forced.score >= earlyExit) {
      return { best, attempts, foilLikely, preprocessMode: mode };
    }
  }

  for (const strategy of strategies) {
    if (strategy.name === "numberLine" || strategy.name === "setLine") continue;
    const scored = await ocrCrop(image, strategy, options.engine, mode);
    attempts.push(scored);
    if (best === null || scored.score > best.score) {
      best = scored;
    }
    if (scored.score >= earlyExit && scored.parsed.setCode && scored.parsed.collectorNumber) {
      break;
    }
  }

  // If split got one half and a fallback got the other, merge the best pieces.
  if (best && (!best.parsed.setCode || !best.parsed.collectorNumber)) {
    const mergedBest = mergeSplitParses(
      {
        setCode: best.parsed.setCode,
        collectorNumber: best.parsed.collectorNumber,
        raw: best.parsed.raw,
      },
      {
        setCode: setAttempt.parsed.setCode ?? numberAttempt.parsed.setCode,
        collectorNumber: numberAttempt.parsed.collectorNumber ?? setAttempt.parsed.collectorNumber,
        raw: "",
      },
    );
    if (mergedBest.setCode && mergedBest.collectorNumber) {
      best = {
        attempt: best.attempt,
        parsed: mergedBest,
        score: Math.max(best.score, 0.9),
      };
    }
  }

  return { best, attempts, foilLikely, preprocessMode: mode };
}

export interface RecognizeCardTitleResult {
  readonly name: string | null;
  readonly raw: string;
  readonly confidence: number | null;
}

/** OCR the title bar for name+set fallback when CN lookup misses. */
export async function recognizeCardTitle(
  image: RgbaImage,
  options: { engine: OcrEngine; preprocessMode?: PreprocessMode },
): Promise<RecognizeCardTitleResult> {
  const mode = options.preprocessMode ?? "normal";
  const pixel = toPixelRect(image, TITLE_STRATEGY.rect);
  const cropped = cropRgba(image, pixel);
  const gray = preprocessForOcr(cropped, mode);
  const prepared = grayToRgba(gray, cropped.width, cropped.height);
  const { text, confidence } = await options.engine.recognize(prepared);
  return {
    name: sanitizeCardName(text),
    raw: text,
    confidence,
  };
}
