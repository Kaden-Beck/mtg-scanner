import type { CropStrategyName } from "./crop.ts";
import { type ParsedCollectorNumber, parseCollectorNumber } from "./parse.ts";

export interface OcrAttempt {
  readonly strategy: CropStrategyName;
  readonly text: string;
  /** Engine-reported confidence 0–1 when available; otherwise null. */
  readonly confidence: number | null;
}

export interface ScoredOcrResult {
  readonly attempt: OcrAttempt;
  readonly parsed: ParsedCollectorNumber;
  /** 0–1 composite score used for early-exit and ranking. */
  readonly score: number;
}

/**
 * Score an OCR attempt. Having both set and number beats number-only; engine
 * confidence is a tie-breaker when present.
 */
export function scoreOcrAttempt(attempt: OcrAttempt): ScoredOcrResult {
  const parsed = parseCollectorNumber(attempt.text);
  let score = 0;

  if (parsed.collectorNumber !== null) score += 0.55;
  if (parsed.setCode !== null) score += 0.35;

  if (attempt.confidence !== null) {
    score += 0.1 * Math.min(1, Math.max(0, attempt.confidence));
  } else if (parsed.collectorNumber !== null && parsed.setCode !== null) {
    score += 0.05;
  }

  // Prefer shorter cleaned text when both parse equally — less garbage.
  if (parsed.raw.length > 0 && parsed.raw.length <= 16) {
    score += 0.02;
  }

  return { attempt, parsed, score: Math.min(1, score) };
}

/** Stop trying more crops once we clear this — both set and number present. */
export const EARLY_EXIT_SCORE = 0.9;
