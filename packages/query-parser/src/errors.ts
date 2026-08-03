import { SUPPORTED_OPERATORS } from "./operators";

/** Base class for anything `parseQuery` throws — never a silent bad parse. */
export class QueryParseError extends Error {}

export class QuerySyntaxError extends QueryParseError {
  constructor(message: string) {
    super(message);
    this.name = "QuerySyntaxError";
  }
}

// There was also an `UnimplementedOperatorError` here, for a v1 operator
// the grammar accepted but the compiler had no storage behind. `tag:` was
// its only thrower, and KAD-22 built that storage — so the class, its
// error kind, and the UI branch that rendered it all came out with it
// rather than being left as a dead type and an unreachable heading. Every
// v1 operator now compiles; reintroducing this is a handful of lines the
// day something is genuinely deferred again.

/** Thrown the moment the tokenizer sees `word:` where `word` isn't a v1 operator key. */
export class UnsupportedOperatorError extends QueryParseError {
  readonly operator: string;

  constructor(operator: string) {
    super(
      `Unsupported search operator "${operator}:" — this app doesn't recognize it. Supported operators: ${SUPPORTED_OPERATORS.join(", ")}.`,
    );
    this.name = "UnsupportedOperatorError";
    this.operator = operator;
  }
}
