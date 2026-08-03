import { QueryParseError, UnsupportedOperatorError } from "@mtg/query-parser";

/**
 * Why a query didn't run. The distinction matters to the user: "I've never
 * heard of that operator" and "that operator is real but you've used it
 * wrong" call for different reactions, and collapsing them into one generic
 * "invalid search" is exactly the confidently-unhelpful failure KAD-18
 * exists to prevent.
 *
 * A third kind, `unimplemented-operator`, existed for operators the grammar
 * accepted but the compiler couldn't run. `tag:` was the only one; KAD-22
 * built it, so the kind came out rather than lingering as an unreachable
 * branch.
 */
export type QueryErrorKind = "unsupported-operator" | "syntax";

export interface QueryErrorPresentation {
  readonly kind: QueryErrorKind;
  /** Already user-facing: names the offending operator or token. */
  readonly message: string;
  /** The operator key at fault, when the failure is about a specific one. */
  readonly operator: string | null;
}

/**
 * Converts a thrown value into something renderable, or `null` if it isn't
 * a query error at all.
 *
 * `null` means "this is a real bug, rethrow it" — a genuine fault must not
 * get laundered into the search box as if the user had mistyped.
 */
export function toQueryErrorPresentation(error: unknown): QueryErrorPresentation | null {
  if (error instanceof UnsupportedOperatorError) {
    return { kind: "unsupported-operator", message: error.message, operator: error.operator };
  }
  if (error instanceof QueryParseError) {
    return { kind: "syntax", message: error.message, operator: null };
  }
  return null;
}
