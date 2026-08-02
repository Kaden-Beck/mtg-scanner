import { SUPPORTED_OPERATORS } from "./operators";

/** Base class for anything `parseQuery` throws — never a silent bad parse. */
export class QueryParseError extends Error {}

export class QuerySyntaxError extends QueryParseError {
  constructor(message: string) {
    super(message);
    this.name = "QuerySyntaxError";
  }
}

/**
 * A real v1 operator that parses fine but has no storage behind it yet.
 * Distinct from `UnsupportedOperatorError` (which means "never heard of
 * it") so the UI can say "coming soon" rather than "you typo'd". Thrown by
 * the compiler, not the parser — the grammar genuinely accepts these.
 */
export class UnimplementedOperatorError extends QueryParseError {
  readonly operator: string;

  constructor(operator: string, message: string) {
    super(message);
    this.name = "UnimplementedOperatorError";
    this.operator = operator;
  }
}

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
