import type { NormRect } from "./image.ts";

/**
 * Collector-number strip strategies for a *card-aligned* guide frame.
 *
 * Modern frames put set code + collector number in the bottom-left. These
 * are fixed fractions of the framed card — not CV-detected regions. Wider /
 * offset variants exist so a slightly misaligned guide still yields a
 * readable crop without falling back to full-card OCR.
 *
 * Ideas only (no code copy): hobbyist scanners that succeeded on CN OCR
 * used multi-crop fallback with early exit on a scored hit.
 */
export type CropStrategyName = "optimal" | "wider" | "offsetUp" | "offsetLeft";

export interface CropStrategy {
  readonly name: CropStrategyName;
  readonly rect: NormRect;
}

/**
 * Fractions assume the user has aligned the physical card to an on-screen
 * guide that fills most of the frame (MTG portrait aspect ≈ 63:88).
 */
export const COLLECTOR_NUMBER_STRATEGIES: readonly CropStrategy[] = [
  // Tight bottom-left strip: number + set code.
  { name: "optimal", rect: { x: 0.02, y: 0.88, width: 0.42, height: 0.09 } },
  // Wider horizontally and vertically for borderless / slight misalign.
  { name: "wider", rect: { x: 0.0, y: 0.84, width: 0.55, height: 0.14 } },
  // Nudge up when the card sits low in the guide.
  { name: "offsetUp", rect: { x: 0.02, y: 0.82, width: 0.45, height: 0.1 } },
  // Nudge left for cards shifted right in the guide.
  { name: "offsetLeft", rect: { x: 0.0, y: 0.87, width: 0.4, height: 0.1 } },
];
