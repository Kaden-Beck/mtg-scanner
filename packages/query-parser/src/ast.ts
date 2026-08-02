/**
 * Comparator recorded verbatim from the query text. `:` is deliberately not
 * normalized to `=` here — its default meaning differs per operator (e.g.
 * `>=` for color/identity, `=` for everything else), and that's semantic
 * knowledge the compiler owns, not the parser.
 */
export type Comparator = ":" | "=" | "!=" | ">" | ">=" | "<" | "<=";

/** The fixed v1 operator vocabulary. See `operators.ts` for key aliases. */
export type OperatorKey =
  | "color"
  | "identity"
  | "type"
  | "oracle"
  | "cmc"
  | "set"
  | "rarity"
  | "is"
  | "owned"
  | "binder"
  | "tag"
  | "condition";

export interface OperatorNode {
  readonly kind: "operator";
  readonly operator: OperatorKey;
  readonly comparator: Comparator;
  readonly value: string;
}

/** A bare word / quoted phrase with no operator prefix — implicit name search. */
export interface NameNode {
  readonly kind: "name";
  readonly value: string;
}

export interface NotNode {
  readonly kind: "not";
  readonly child: QueryNode;
}

export interface AndNode {
  readonly kind: "and";
  readonly children: readonly QueryNode[];
}

export interface OrNode {
  readonly kind: "or";
  readonly children: readonly QueryNode[];
}

export type QueryNode = OperatorNode | NameNode | NotNode | AndNode | OrNode;
