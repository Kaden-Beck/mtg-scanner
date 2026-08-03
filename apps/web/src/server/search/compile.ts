import type { Comparator, OperatorNode, QueryNode } from "@mtg/query-parser";
import { QuerySyntaxError } from "@mtg/query-parser";
import { CONDITIONS, normalizeTag } from "@mtg/schemas";
import { type Column, type SQL, sql } from "drizzle-orm";
import { cards, collectionItems, collectionItemTags } from "../db/schema";

/**
 * Compiles a parsed query AST into a drizzle `SQL` fragment suitable for a
 * WHERE clause over `collection_items JOIN cards ON
 * collection_items.scryfall_id = cards.id`.
 *
 * Every user-supplied value crosses into SQL as a bound parameter via the
 * `sql` tagged template - never string concatenation. LIKE patterns get
 * their wildcards escaped too, so a user typing `%` searches for a literal
 * percent sign instead of matching everything.
 */

/** WUBRG, in Scryfall's canonical order. */
const COLOR_LETTERS = ["W", "U", "B", "R", "G"] as const;
type ColorLetter = (typeof COLOR_LETTERS)[number];

/** `is:` values backed by a plain boolean column on `cards`. */
const IS_BOOLEAN_COLUMNS: Readonly<Record<string, Column>> = {
  reserved: cards.reserved,
  fullart: cards.fullArt,
  textless: cards.textless,
  promo: cards.promo,
  variation: cards.variation,
};

/** `is:` values backed by a membership test against the `finishes` JSON array. */
const IS_FINISHES = ["foil", "nonfoil", "etched"] as const;

const ALWAYS_TRUE = sql`1 = 1`;
const ALWAYS_FALSE = sql`1 = 0`;

/**
 * Neutralizes LIKE's own wildcards in user input. Without this, searching
 * for `100%` or `a_b` silently matches far more than the user asked for -
 * confidently-wrong results rather than an honest miss.
 */
function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function containsPredicate(column: SQL, value: string): SQL {
  return sql`${column} LIKE ${`%${escapeLike(value.toLowerCase())}%`} ESCAPE '\\'`;
}

/** `lower(col)`, with NULL folded to '' so `NOT (...)` doesn't evaluate to NULL. */
function lowerText(column: Column): SQL {
  return sql`lower(coalesce(${column}, ''))`;
}

/**
 * `:` means "contains", `=` means the whole field equals the value, `!=`
 * means "doesn't contain". Ordering comparators are meaningless on free
 * text and are rejected by name rather than silently coerced.
 */
function substringOperator(column: Column, node: OperatorNode): SQL {
  const lowered = lowerText(column);
  const value = node.value.toLowerCase();
  switch (node.comparator) {
    case ":":
      return containsPredicate(lowered, node.value);
    case "=":
      return sql`${lowered} = ${value}`;
    case "!=":
      return sql`NOT ${containsPredicate(lowered, node.value)}`;
    default:
      throw badComparator(node, "use ':' (contains), '=' (exact), or '!='");
  }
}

/** `:` and `=` are both exact equality here; only `!=` negates. */
function exactOperator(column: Column, node: OperatorNode, value: string): SQL {
  const lowered = lowerText(column);
  switch (node.comparator) {
    case ":":
    case "=":
      return sql`${lowered} = ${value.toLowerCase()}`;
    case "!=":
      return sql`${lowered} <> ${value.toLowerCase()}`;
    default:
      throw badComparator(node, "use ':', '=', or '!='");
  }
}

function badComparator(node: OperatorNode, hint: string): QuerySyntaxError {
  return new QuerySyntaxError(
    `The "${node.operator}" search operator doesn't support the "${node.comparator}" comparator — ${hint}.`,
  );
}

/**
 * Parses a color operand into a set of WUBRG letters. `c` is Scryfall's
 * colorless shorthand and yields the empty set.
 */
function parseColorSet(node: OperatorNode): Set<ColorLetter> {
  const letters = new Set<ColorLetter>();
  const raw = node.value.toLowerCase();

  if (raw === "c" || raw === "colorless") return letters;

  for (const char of raw) {
    const upper = char.toUpperCase();
    const match = COLOR_LETTERS.find((letter) => letter === upper);
    if (match === undefined) {
      throw new QuerySyntaxError(
        `"${char}" isn't a color in "${node.operator}:${node.value}" — use any of W, U, B, R, G, or 'c' for colorless.`,
      );
    }
    letters.add(match);
  }

  return letters;
}

/** The card's color array contains every letter in `letters`. */
function atLeastColors(column: Column, letters: ReadonlySet<ColorLetter>): SQL {
  const parts = [...letters].map(
    (letter) =>
      sql`EXISTS (SELECT 1 FROM json_each(coalesce(${column}, '[]')) WHERE json_each.value = ${letter})`,
  );
  return parts.length === 0 ? ALWAYS_TRUE : all(parts);
}

/** The card's color array contains nothing outside `letters`. */
function atMostColors(column: Column, letters: ReadonlySet<ColorLetter>): SQL {
  const parts = COLOR_LETTERS.filter((letter) => !letters.has(letter)).map(
    (letter) =>
      sql`NOT EXISTS (SELECT 1 FROM json_each(coalesce(${column}, '[]')) WHERE json_each.value = ${letter})`,
  );
  return parts.length === 0 ? ALWAYS_TRUE : all(parts);
}

/**
 * `c:`/`id:` default to `>=` ("at least these colors, possibly more") per
 * Scryfall; `=`/`<=`/`<`/`>`/`!=` are explicit overrides. The one wrinkle
 * is the empty (colorless) set: `>=` over an empty set is vacuously true,
 * which is never what `c:c` means, so a bare `:`/`>=` on colorless is read
 * as `=` instead.
 */
function colorOperator(column: Column, node: OperatorNode): SQL {
  const letters = parseColorSet(node);
  const atLeast = atLeastColors(column, letters);
  const atMost = atMostColors(column, letters);
  const isColorless = letters.size === 0;

  switch (node.comparator) {
    case ":":
    case ">=":
      return isColorless ? atMost : atLeast;
    case "=":
      return all([atLeast, atMost]);
    case "!=":
      return sql`NOT ${all([atLeast, atMost])}`;
    case "<=":
      return atMost;
    case ">":
      return all([atLeast, sql`NOT ${atMost}`]);
    case "<":
      return all([atMost, sql`NOT ${atLeast}`]);
  }
}

function cmcOperator(node: OperatorNode): SQL {
  const value = Number(node.value);
  if (!Number.isFinite(value)) {
    throw new QuerySyntaxError(
      `"${node.value}" isn't a number — "cmc" needs a numeric value, like cmc>=3.`,
    );
  }

  // A bare colon is `=` here: unlike color, a numeric field has no
  // "at least these" reading.
  const comparator: Comparator = node.comparator === ":" ? "=" : node.comparator;
  switch (comparator) {
    case "=":
      return sql`${cards.cmc} = ${value}`;
    case "!=":
      return sql`${cards.cmc} <> ${value}`;
    case ">":
      return sql`${cards.cmc} > ${value}`;
    case ">=":
      return sql`${cards.cmc} >= ${value}`;
    case "<":
      return sql`${cards.cmc} < ${value}`;
    case "<=":
      return sql`${cards.cmc} <= ${value}`;
    default:
      throw badComparator(node, "use =, !=, >, >=, <, or <=");
  }
}

function isOperator(node: OperatorNode): SQL {
  const value = node.value.toLowerCase();

  if (node.comparator !== ":" && node.comparator !== "=" && node.comparator !== "!=") {
    throw badComparator(node, "use ':' or '='");
  }

  const booleanColumn = IS_BOOLEAN_COLUMNS[value];
  const finish = IS_FINISHES.find((candidate) => candidate === value);

  let predicate: SQL;
  if (booleanColumn !== undefined) {
    predicate = sql`${booleanColumn} = 1`;
  } else if (finish !== undefined) {
    predicate = sql`EXISTS (SELECT 1 FROM json_each(${cards.finishes}) WHERE json_each.value = ${finish})`;
  } else {
    const known = [...Object.keys(IS_BOOLEAN_COLUMNS), ...IS_FINISHES].sort().join(", ");
    throw new QuerySyntaxError(
      `"is:${node.value}" isn't a supported filter — try one of: ${known}.`,
    );
  }

  return node.comparator === "!=" ? sql`NOT ${predicate}` : predicate;
}

/**
 * Every row in this compiler's base query is owned by construction (it's a
 * join through `collection_items`), so `owned:` is a documented no-op here.
 * It stays in the grammar because the same parser will run against a
 * full-catalog base query later, where it does real work.
 */
function ownedOperator(node: OperatorNode): SQL {
  const value = node.value.toLowerCase();
  if (value !== "true" && value !== "false") {
    throw new QuerySyntaxError(
      `"owned:${node.value}" isn't valid — use owned:true or owned:false.`,
    );
  }
  const wantOwned = value === "true";
  const negated = node.comparator === "!=";
  return wantOwned !== negated ? ALWAYS_TRUE : ALWAYS_FALSE;
}

function conditionOperator(node: OperatorNode): SQL {
  const upper = node.value.toUpperCase();
  const match = CONDITIONS.find((candidate) => candidate === upper);
  if (match === undefined) {
    throw new QuerySyntaxError(
      `"condition:${node.value}" isn't a known condition — use one of: ${CONDITIONS.join(", ")}.`,
    );
  }
  return exactOperator(collectionItems.condition, node, match);
}

/**
 * `tag:cube` is "this stack carries that tag" - an EXISTS against
 * `collection_item_tags` rather than a join, so a stack with three matching
 * tags still yields one row.
 *
 * The value goes through the same `normalizeTag` the write path uses, which
 * is the whole reason that function lives in `packages/schemas`: stored
 * tags are trimmed lowercase, and SQLite's default `=` is case-sensitive,
 * so a query normalized any other way would silently match nothing.
 *
 * A value that doesn't normalize to a tag at all can't match any stored row,
 * so it compiles to a constant false rather than an error - `tag:" "` is a
 * search with no results, not a malformed query. `-tag:cube` falls out of
 * the generic `NOT` handling in `compileQuery` for free.
 */
function tagOperator(node: OperatorNode): SQL {
  if (node.comparator !== ":" && node.comparator !== "=" && node.comparator !== "!=") {
    throw badComparator(node, "use ':', '=', or '!='");
  }

  const tag = normalizeTag(node.value);
  if (tag === null) return node.comparator === "!=" ? ALWAYS_TRUE : ALWAYS_FALSE;

  const predicate = sql`EXISTS (
    SELECT 1 FROM ${collectionItemTags}
    WHERE ${collectionItemTags.collectionItemId} = ${collectionItems.id}
      AND ${collectionItemTags.tag} = ${tag}
  )`;
  return node.comparator === "!=" ? sql`NOT ${predicate}` : predicate;
}

function compileOperator(node: OperatorNode): SQL {
  switch (node.operator) {
    case "color":
      return colorOperator(cards.colors, node);
    case "identity":
      return colorOperator(cards.colorIdentity, node);
    case "type":
      return substringOperator(cards.typeLine, node);
    case "oracle":
      return substringOperator(cards.oracleText, node);
    case "cmc":
      return cmcOperator(node);
    case "set":
      return exactOperator(cards.setCode, node, node.value);
    case "rarity":
      return exactOperator(cards.rarity, node, node.value);
    case "is":
      return isOperator(node);
    case "owned":
      return ownedOperator(node);
    case "binder":
      return substringOperator(collectionItems.binderLocation, node);
    case "condition":
      return conditionOperator(node);
    case "tag":
      return tagOperator(node);
  }
}

function all(parts: readonly SQL[]): SQL {
  return sql`(${sql.join([...parts], sql` AND `)})`;
}

function any(parts: readonly SQL[]): SQL {
  return sql`(${sql.join([...parts], sql` OR `)})`;
}

/**
 * @throws {QuerySyntaxError} a value or comparator that parses but can't
 *   mean anything against the schema (bad color letter, non-numeric `cmc`,
 *   unknown `is:` value, ordering comparator on a text field)
 */
export function compileQuery(node: QueryNode): SQL {
  switch (node.kind) {
    case "and":
      return all(node.children.map(compileQuery));
    case "or":
      return any(node.children.map(compileQuery));
    case "not":
      return sql`NOT ${compileQuery(node.child)}`;
    case "name":
      return containsPredicate(lowerText(cards.name), node.value);
    case "operator":
      return compileOperator(node);
  }
}
