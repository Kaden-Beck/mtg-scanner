import type { Comparator, OperatorKey } from "./ast";
import { QuerySyntaxError, UnsupportedOperatorError } from "./errors";
import { OPERATOR_ALIASES } from "./operators";

export type Token =
  | { readonly kind: "lparen"; readonly position: number }
  | { readonly kind: "rparen"; readonly position: number }
  | { readonly kind: "minus"; readonly position: number }
  | { readonly kind: "and"; readonly position: number }
  | { readonly kind: "or"; readonly position: number }
  | { readonly kind: "word"; readonly position: number; readonly value: string }
  | {
      readonly kind: "operator";
      readonly position: number;
      readonly operator: OperatorKey;
      readonly comparator: Comparator;
      readonly value: string;
    };

/**
 * Splits a scanned term into key / comparator / value. Two-character
 * comparators are listed before their single-character prefixes so `!=`,
 * `>=` and `<=` aren't shadowed by `>`/`<`/`=` — regex alternation is
 * leftmost-first, not longest-match.
 */
const TERM_PATTERN = /^([A-Za-z]+)(:|!=|>=|<=|>|<|=)([\s\S]*)$/;

/** Narrows the regex's comparator capture without a type assertion. */
const COMPARATORS: Readonly<Record<string, Comparator>> = {
  ":": ":",
  "=": "=",
  "!=": "!=",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
};

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/** Strips one layer of surrounding double quotes, if present. */
function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Scans a single term starting at `start`, stopping at the first unquoted
 * whitespace or paren. A `"` toggles quoted mode, in which whitespace and
 * parens are ordinary characters. Quotes are left in the returned raw text
 * so the caller can still tell `c:""` (explicitly empty) from `c:` and
 * strip them at the right level.
 */
function scanTerm(input: string, start: number): { raw: string; next: number } {
  let index = start;
  let inQuotes = false;

  while (index < input.length) {
    const char = input[index];
    if (char === undefined) break;
    if (char === '"') {
      inQuotes = !inQuotes;
      index += 1;
      continue;
    }
    if (!inQuotes && (isWhitespace(char) || char === "(" || char === ")")) break;
    index += 1;
  }

  if (inQuotes) {
    throw new QuerySyntaxError(
      `Unterminated quote starting at position ${String(start)} — add a closing '"'.`,
    );
  }

  return { raw: input.slice(start, index), next: index };
}

/**
 * Turns a term into an operator token, or `null` if it isn't shaped like
 * `key<comparator>value` at all (i.e. it's a bare word / name search). A
 * recognized shape with an unknown key is an error, never a quiet fallback
 * to a name search — that's KAD-18's "explicit, not silent" requirement.
 */
function toOperatorToken(raw: string, position: number): Token | null {
  const match = TERM_PATTERN.exec(raw);
  if (match === null) return null;

  const [, key, comparatorText, rawValue] = match;
  if (key === undefined || comparatorText === undefined || rawValue === undefined) return null;

  const comparator = COMPARATORS[comparatorText];
  if (comparator === undefined) return null;

  const operator = OPERATOR_ALIASES[key.toLowerCase()];
  if (operator === undefined) {
    throw new UnsupportedOperatorError(key);
  }

  const value = unquote(rawValue);
  if (value === "") {
    throw new QuerySyntaxError(
      `The "${key}${comparator}" search operator requires a value (at position ${String(position)}).`,
    );
  }

  return { kind: "operator", position, operator, comparator, value };
}

/**
 * Lexes a raw query string into a flat token array. Every failure here is a
 * thrown `QueryParseError` subclass naming the specific problem; the
 * tokenizer never emits a best-effort token for input it didn't understand.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === undefined) break;

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ kind: "lparen", position: index });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ kind: "rparen", position: index });
      index += 1;
      continue;
    }

    // Negation is only a MINUS in term-leading position; a `-` *inside* a
    // term (hyphenated card names) is swallowed by scanTerm below, since
    // this branch only fires where a new token is about to start.
    if (char === "-") {
      tokens.push({ kind: "minus", position: index });
      index += 1;
      continue;
    }

    const { raw, next } = scanTerm(input, index);
    const position = index;
    index = next;

    // Exact case only — `and`/`or` are legitimate card-name words.
    if (raw === "AND") {
      tokens.push({ kind: "and", position });
      continue;
    }
    if (raw === "OR") {
      tokens.push({ kind: "or", position });
      continue;
    }

    tokens.push(toOperatorToken(raw, position) ?? { kind: "word", position, value: unquote(raw) });
  }

  return tokens;
}

/** Human-readable token label, for error messages that name what went wrong. */
export function describeToken(token: Token): string {
  switch (token.kind) {
    case "lparen":
      return "'('";
    case "rparen":
      return "')'";
    case "minus":
      return "'-'";
    case "and":
      return "'AND'";
    case "or":
      return "'OR'";
    case "word":
      return `'${token.value}'`;
    case "operator":
      return `'${token.operator}${token.comparator}${token.value}'`;
  }
}
