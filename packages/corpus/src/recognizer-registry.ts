import type { Recognizer } from "@mtg/corpus";

/**
 * The single place the accuracy gate looks for something to measure.
 *
 * Defaults to null. The web app's OCR-primary recognizer (KAD-44 / ADR-008)
 * registers itself from `apps/web/src/server/scan/gate-cli.ts` before the
 * harness runs — packages/corpus stays free of DB / sharp / Tesseract deps.
 *
 * Deliberately *not* a stub that returns plausible-looking candidates. A fake
 * recognizer would let a baseline be recorded against nothing, and the gate
 * would then spend the rest of the project defending a meaningless number.
 */
let registered: Recognizer | null = null;

export function registerRecognizer(recognizer: Recognizer | null): void {
  registered = recognizer;
}

export function activeRecognizer(): Recognizer | null {
  return registered;
}
