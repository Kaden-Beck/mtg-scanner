import {
  QueryParseError,
  UnimplementedOperatorError,
  UnsupportedOperatorError,
} from "@mtg/query-parser";

/**
 * Why a query didn't run. The distinction matters to the user: "I've never
 * heard of that operator" and "that operator is real but isn't wired up
 * yet" call for different reactions, and collapsing them into one generic
 * "invalid search" is exactly the confidently-unhelpful failure KAD-18
 * exists to prevent.
 */
export type QueryErrorKind = "unsupported-operator" | "unimplemented-operator" | "syntax";

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
  if (error instanceof UnimplementedOperatorError) {
    return { kind: "unimplemented-operator", message: error.message, operator: error.operator };
  }
  if (error instanceof QueryParseError) {
    return { kind: "syntax", message: error.message, operator: null };
  }
  return null;
}
