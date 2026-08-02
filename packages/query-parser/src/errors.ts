/** Base class for anything `parseQuery` throws — never a silent bad parse. */
export class QueryParseError extends Error {}

export class QuerySyntaxError extends QueryParseError {
  constructor(message: string) {
    super(message);
    this.name = "QuerySyntaxError";
  }
}

/** Thrown the moment the tokenizer sees `word:` where `word` isn't a v1 operator key. */
export class UnsupportedOperatorError extends QueryParseError {
  readonly operator: string;

  constructor(operator: string) {
    super(`Unsupported search operator "${operator}:" — this app doesn't recognize it.`);
    this.name = "UnsupportedOperatorError";
    this.operator = operator;
  }
}
