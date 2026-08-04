import type { Recognizer } from "./harness.ts";

/**
 * The single place the accuracy gate looks for something to measure.
 *
 * Returns null today because no recognizer exists yet - T0 is KAD-39, T1
 * KAD-40, T2 KAD-44, T3 KAD-51, T4 KAD-47. The gate is wired end to end
 * around this so that landing a recognizer is one edit here rather than a
 * CI archaeology exercise, which is the whole reason KAD-37 ships before the
 * scanner instead of after it.
 *
 * Deliberately *not* a stub that returns plausible-looking candidates. A fake
 * recognizer would let a baseline be recorded against nothing, and the gate
 * would then spend the rest of the project defending a meaningless number.
 */
export function activeRecognizer(): Recognizer | null {
  return null;
}
