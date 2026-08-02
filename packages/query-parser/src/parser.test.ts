import { describe, expect, it } from "vitest";
import type { Comparator, OperatorKey, QueryNode } from "./ast";
import { QuerySyntaxError, UnsupportedOperatorError } from "./errors";
import { OPERATOR_ALIASES } from "./operators";
import { parseQuery } from "./parser";

/** Terse AST constructors, so the expectation tables stay readable. */
const op = (operator: OperatorKey, comparator: Comparator, value: string): QueryNode => ({
  kind: "operator",
  operator,
  comparator,
  value,
});
const name = (value: string): QueryNode => ({ kind: "name", value });
const not = (child: QueryNode): QueryNode => ({ kind: "not", child });
const and = (...children: QueryNode[]): QueryNode => ({ kind: "and", children });
const or = (...children: QueryNode[]): QueryNode => ({ kind: "or", children });

describe("parseQuery — operator vocabulary", () => {
  const aliasCases: readonly [alias: string, canonical: OperatorKey][] = [
    ["c", "color"],
    ["color", "color"],
    ["id", "identity"],
    ["identity", "identity"],
    ["t", "type"],
    ["type", "type"],
    ["o", "oracle"],
    ["oracle", "oracle"],
    ["cmc", "cmc"],
    ["set", "set"],
    ["e", "set"],
    ["r", "rarity"],
    ["rarity", "rarity"],
    ["is", "is"],
    ["owned", "owned"],
    ["binder", "binder"],
    ["tag", "tag"],
    ["condition", "condition"],
  ];

  it.each(aliasCases)("maps %s: to the %s operator", (alias, canonical) => {
    expect(parseQuery(`${alias}:x`)).toEqual(op(canonical, ":", "x"));
  });

  it("covers every alias in the table", () => {
    expect(aliasCases.map(([alias]) => alias).sort()).toEqual(Object.keys(OPERATOR_ALIASES).sort());
  });

  it("lowercases the operator key but preserves the value's case", () => {
    expect(parseQuery("C:RG")).toEqual(op("color", ":", "RG"));
  });

  it("recognizes tag: syntactically even though storage lands in Sprint 4", () => {
    expect(parseQuery("tag:combo")).toEqual(op("tag", ":", "combo"));
  });
});

describe("parseQuery — comparators", () => {
  const comparators: readonly Comparator[] = [":", "=", "!=", ">", ">=", "<", "<="];

  it.each(comparators)("records %s verbatim without normalizing it", (comparator) => {
    expect(parseQuery(`cmc${comparator}3`)).toEqual(op("cmc", comparator, "3"));
  });

  it("prefers the two-character comparator over its single-character prefix", () => {
    // `>=` must not lex as `>` with a value of "=3".
    expect(parseQuery("cmc>=3")).toEqual(op("cmc", ">=", "3"));
    expect(parseQuery("cmc<=3")).toEqual(op("cmc", "<=", "3"));
    expect(parseQuery("cmc!=3")).toEqual(op("cmc", "!=", "3"));
  });
});

describe("parseQuery — terms, names, and quoting", () => {
  const cases: readonly [input: string, expected: QueryNode][] = [
    ["bolt", name("bolt")],
    ['"Lightning Bolt"', name("Lightning Bolt")],
    ['o:"draw a card"', op("oracle", ":", "draw a card")],
    ['t:"legendary creature"', op("type", ":", "legendary creature")],
    // `and`/`or` are only keywords in exact uppercase — plenty of card
    // names contain the lowercase words.
    ["and", name("and")],
    ["or", name("or")],
    // A `-` mid-term is part of the word, not a negation.
    ["Ne'er-do-well", name("Ne'er-do-well")],
    ["t:creature-token", op("type", ":", "creature-token")],
  ];

  it.each(cases)("parses %s", (input, expected) => {
    expect(parseQuery(input)).toEqual(expected);
  });
});

describe("parseQuery — boolean structure", () => {
  const cases: readonly [input: string, expected: QueryNode][] = [
    // Juxtaposition is an implicit AND, and is identical to an explicit one.
    ["c:rg t:creature", and(op("color", ":", "rg"), op("type", ":", "creature"))],
    ["c:rg AND t:creature", and(op("color", ":", "rg"), op("type", ":", "creature"))],
    // Flattened, not right-nested.
    ["a b c", and(name("a"), name("b"), name("c"))],
    ["a OR b OR c", or(name("a"), name("b"), name("c"))],
    // AND binds tighter than OR.
    ["a b OR c", or(and(name("a"), name("b")), name("c"))],
    ["a OR b c", or(name("a"), and(name("b"), name("c")))],
    // Negation binds tightest.
    ["-is:reserved", not(op("is", ":", "reserved"))],
    ["t:goblin -c:r", and(op("type", ":", "goblin"), not(op("color", ":", "r")))],
    ["-a OR b", or(not(name("a")), name("b"))],
    ["--a", not(not(name("a")))],
    // Parens reset precedence.
    ["(a OR b) c", and(or(name("a"), name("b")), name("c"))],
    ["-(a OR b)", not(or(name("a"), name("b")))],
    ["((a))", name("a")],
    [
      "c:r (t:goblin OR t:elf) -is:promo",
      and(
        op("color", ":", "r"),
        or(op("type", ":", "goblin"), op("type", ":", "elf")),
        not(op("is", ":", "promo")),
      ),
    ],
  ];

  it.each(cases)("parses %s", (input, expected) => {
    expect(parseQuery(input)).toEqual(expected);
  });

  it("ignores redundant whitespace", () => {
    expect(parseQuery("  c:rg   AND\tt:creature  ")).toEqual(parseQuery("c:rg AND t:creature"));
  });
});

describe("parseQuery — unsupported operators (KAD-18)", () => {
  const unsupported = ["foo", "mana", "power", "toughness", "loyalty", "artist", "year"];

  it.each(unsupported)("rejects %s: by name instead of falling back to a name search", (key) => {
    expect(() => parseQuery(`${key}:x`)).toThrow(UnsupportedOperatorError);
    try {
      parseQuery(`${key}:x`);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedOperatorError);
      expect((error as UnsupportedOperatorError).operator).toBe(key);
      expect((error as Error).message).toContain(`"${key}:"`);
    }
  });

  it("rejects an unsupported operator anywhere in the query, not just first", () => {
    expect(() => parseQuery("c:r AND power:3")).toThrow(UnsupportedOperatorError);
  });
});

describe("parseQuery — syntax errors", () => {
  const cases: readonly [label: string, input: string, messagePart: string][] = [
    ["empty query", "", "Empty query"],
    ["whitespace-only query", "   \t ", "Empty query"],
    ["operator with no value", "c:", "requires a value"],
    ["operator with an empty quoted value", 'c:""', "requires a value"],
    ["comparator with no value", "cmc>=", "requires a value"],
    ["unterminated quote", 'o:"draw a card', "Unterminated quote"],
    ["unclosed paren", "(c:r", "Unclosed '('"],
    ["unclosed nested paren", "(c:r OR (t:goblin)", "Unclosed '('"],
    ["stray closing paren", "c:r)", "no matching '('"],
    ["dangling AND", "c:r AND", "after 'AND'"],
    ["dangling OR", "c:r OR", "after 'OR'"],
    ["dangling negation", "c:r -", "after '-'"],
    ["negation with nothing at all", "-", "after '-'"],
    ["leading AND", "AND c:r", "Unexpected 'AND'"],
    ["leading OR", "OR c:r", "Unexpected 'OR'"],
    ["empty parens", "()", "Unexpected ')'"],
    ["AND before a closing paren", "(c:r AND)", "after 'AND'"],
  ];

  it.each(cases)("rejects %s", (_label, input, messagePart) => {
    expect(() => parseQuery(input)).toThrow(QuerySyntaxError);
    expect(() => parseQuery(input)).toThrow(messagePart);
  });
});
