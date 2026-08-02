import type { QueryNode } from "./ast";
import { QuerySyntaxError } from "./errors";
import { describeToken, type Token, tokenize } from "./tokenizer";

/**
 * Recursive-descent parser over the flat token array. Precedence, loosest
 * to tightest:
 *
 * ```text
 * orExpr   := andExpr ("OR" andExpr)*
 * andExpr  := unary ("AND"? unary)*    // stops at OR / ')' / end
 * unary    := "-" unary | primary
 * primary  := "(" orExpr ")" | operatorTerm | bareWord
 * ```
 *
 * Juxtaposition is an implicit AND, so `c:r t:goblin` and `c:r AND
 * t:goblin` produce the same tree.
 */
class Parser {
  private readonly tokens: readonly Token[];
  private cursor = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }

  /** Consumes and returns the next token if it has `kind`, else leaves the cursor put. */
  private match(kind: Token["kind"]): Token | undefined {
    const token = this.peek();
    if (token?.kind !== kind) return undefined;
    this.cursor += 1;
    return token;
  }

  private advance(): Token | undefined {
    const token = this.peek();
    this.cursor += 1;
    return token;
  }

  /** True at end-of-input, or at a token only an outer rule may consume. */
  private atExpressionEnd(): boolean {
    const token = this.peek();
    return token === undefined || token.kind === "or" || token.kind === "rparen";
  }

  parse(): QueryNode {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing !== undefined) {
      // The only token that can survive to here is a `)` with no matching
      // `(` — parseAnd would have consumed anything else.
      throw new QuerySyntaxError(
        `Unexpected ${describeToken(trailing)} at position ${String(trailing.position)} — no matching '(' was opened.`,
      );
    }
    return node;
  }

  private parseOr(): QueryNode {
    const first = this.parseAnd();
    const rest: QueryNode[] = [];

    let orToken = this.match("or");
    while (orToken !== undefined) {
      if (this.atExpressionEnd()) {
        throw new QuerySyntaxError(
          `Expected a search term after 'OR' at position ${String(orToken.position)}.`,
        );
      }
      rest.push(this.parseAnd());
      orToken = this.match("or");
    }

    // Flattened, not right-nested: `a OR b OR c` is one 3-child OrNode.
    return rest.length === 0 ? first : { kind: "or", children: [first, ...rest] };
  }

  private parseAnd(): QueryNode {
    const first = this.parseUnary();
    const rest: QueryNode[] = [];

    while (!this.atExpressionEnd()) {
      const andToken = this.match("and");
      if (andToken !== undefined && this.atExpressionEnd()) {
        throw new QuerySyntaxError(
          `Expected a search term after 'AND' at position ${String(andToken.position)}.`,
        );
      }
      rest.push(this.parseUnary());
    }

    return rest.length === 0 ? first : { kind: "and", children: [first, ...rest] };
  }

  private parseUnary(): QueryNode {
    const minus = this.match("minus");
    if (minus === undefined) return this.parsePrimary();

    if (this.atExpressionEnd()) {
      throw new QuerySyntaxError(
        `Expected a search term after '-' at position ${String(minus.position)}.`,
      );
    }
    return { kind: "not", child: this.parseUnary() };
  }

  private parsePrimary(): QueryNode {
    const token = this.advance();

    if (token === undefined) {
      throw new QuerySyntaxError("Unexpected end of query — expected a search term.");
    }

    switch (token.kind) {
      case "lparen": {
        const inner = this.parseOr();
        const closing = this.advance();
        if (closing === undefined) {
          throw new QuerySyntaxError(
            `Unclosed '(' at position ${String(token.position)} — add a matching ')'.`,
          );
        }
        if (closing.kind !== "rparen") {
          throw new QuerySyntaxError(
            `Expected ')' but found ${describeToken(closing)} at position ${String(closing.position)}.`,
          );
        }
        return inner;
      }
      case "operator":
        return {
          kind: "operator",
          operator: token.operator,
          comparator: token.comparator,
          value: token.value,
        };
      case "word":
        return { kind: "name", value: token.value };
      default:
        throw new QuerySyntaxError(
          `Unexpected ${describeToken(token)} at position ${String(token.position)} — expected a search term.`,
        );
    }
  }
}

/**
 * Parses a Scryfall-style query string into a typed AST.
 *
 * An empty (or whitespace-only) query throws rather than producing an
 * "always true" node: a blank search box means "no filter at all", and
 * that's the caller's call to make before it ever gets here, not something
 * the parser should invent an AST shape for.
 *
 * @throws {QuerySyntaxError} malformed syntax (unclosed paren, dangling
 *   operator, missing value, unterminated quote, empty query)
 * @throws {UnsupportedOperatorError} a `key:value` term whose key isn't in
 *   the v1 operator vocabulary
 */
export function parseQuery(input: string): QueryNode {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new QuerySyntaxError("Empty query — enter at least one search term.");
  }
  return new Parser(tokens).parse();
}
