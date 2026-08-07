import type { NormRect } from "./image.ts";

/**
 * Region crops for a *card-aligned* guide frame.
 *
 * Modern frames (e.g. SOS) print a two-line bottom-left strip:
 *   C 0041
 *   SOS • EN ★ Artist Name
 * One fat crop feeds Tesseract rarity, number, set, language, and artist at
 * once. Split crops keep the number line and the set token separate; the
 * title band is a miss-fallback (name + set), not the primary path.
 *
 * Ideas only (no code copy): hobbyist CN OCR used multi-crop + early exit;
 * vision scanners that also read the title use it as a secondary signal.
 */
export type CropStrategyName =
  | "numberLine"
  | "setLine"
  | "optimal"
  | "wider"
  | "offsetUp"
  | "offsetLeft"
  | "title";

export interface CropStrategy {
  readonly name: CropStrategyName;
  readonly rect: NormRect;
}

/** Primary: rarity + collector number only (`C 0041`). */
export const NUMBER_LINE_STRATEGY: CropStrategy = {
  name: "numberLine",
  rect: { x: 0.02, y: 0.895, width: 0.32, height: 0.04 },
};

/** Primary: set code only — stop before EN / artist on the second line. */
export const SET_LINE_STRATEGY: CropStrategy = {
  name: "setLine",
  rect: { x: 0.02, y: 0.935, width: 0.2, height: 0.04 },
};

/** Title / name bar — miss fallback when CN lookup fails. */
export const TITLE_STRATEGY: CropStrategy = {
  name: "title",
  rect: { x: 0.06, y: 0.035, width: 0.7, height: 0.085 },
};

/**
 * Combined-strip fallbacks when split lines miss (older one-line prints like
 * `FDN U 0125`, slight misalignment).
 */
export const COLLECTOR_NUMBER_STRATEGIES: readonly CropStrategy[] = [
  NUMBER_LINE_STRATEGY,
  SET_LINE_STRATEGY,
  { name: "optimal", rect: { x: 0.02, y: 0.905, width: 0.42, height: 0.07 } },
  { name: "wider", rect: { x: 0.0, y: 0.88, width: 0.5, height: 0.11 } },
  { name: "offsetUp", rect: { x: 0.02, y: 0.86, width: 0.42, height: 0.09 } },
  { name: "offsetLeft", rect: { x: 0.0, y: 0.9, width: 0.38, height: 0.08 } },
];
