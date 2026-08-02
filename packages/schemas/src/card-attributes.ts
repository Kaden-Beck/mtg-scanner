import { z } from "zod";
import { assertNever } from "./assert-never";

/** Physical finish of a printed copy. */
export const FINISHES = ["nonfoil", "foil", "etched"] as const;
export const finishSchema = z.enum(FINISHES);
export type Finish = z.infer<typeof finishSchema>;

export function finishLabel(finish: Finish): string {
  switch (finish) {
    case "nonfoil":
      return "Nonfoil";
    case "foil":
      return "Foil";
    case "etched":
      return "Etched Foil";
    default:
      return assertNever(finish);
  }
}

/** Collection-grading condition scale, worst to best is DMG -> NM. */
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export const conditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof conditionSchema>;

export function conditionLabel(condition: Condition): string {
  switch (condition) {
    case "NM":
      return "Near Mint";
    case "LP":
      return "Lightly Played";
    case "MP":
      return "Moderately Played";
    case "HP":
      return "Heavily Played";
    case "DMG":
      return "Damaged";
    default:
      return assertNever(condition);
  }
}
