import type { OperatorKey } from "./ast.ts";

/**
 * Every recognized operator key/alias, lowercased, mapped to its canonical
 * `OperatorKey`. The parser's single source of truth for what counts as a
 * "known" operator — anything else shaped like `word:value` is an explicit
 * `UnsupportedOperatorError`, never a silent name search.
 */
export const OPERATOR_ALIASES: Readonly<Record<string, OperatorKey>> = {
  c: "color",
  color: "color",
  id: "identity",
  identity: "identity",
  t: "type",
  type: "type",
  o: "oracle",
  oracle: "oracle",
  cmc: "cmc",
  set: "set",
  e: "set",
  r: "rarity",
  rarity: "rarity",
  is: "is",
  owned: "owned",
  binder: "binder",
  tag: "tag",
  condition: "condition",
};
