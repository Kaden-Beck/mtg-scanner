import { CONDITIONS } from "@mtg/schemas";
import {
  cards,
  collectionItems,
  collectionItemTags,
  type NewCardRow,
  type NewCollectionItemRow,
  type NewCollectionItemTagRow,
} from "../db/schema";

/**
 * The drizzle instance, as a type only - `typeof import(...)` in a type
 * position emits no runtime import, so this doesn't drag in db/client and
 * its connection-opening side effect. The caller passes the connection in
 * (see `seedPerfFixture`).
 */
type Db = typeof import("../db/client")["db"];

/**
 * Deterministic synthetic data at NFR-1's target scale (110k printings /
 * 20k owned stacks), for the search benchmark in `perf.bench.test.ts`.
 *
 * Deterministic on purpose: a benchmark whose row distribution changes
 * between runs can't tell a real regression from a reshuffled fixture. No
 * faker dependency - a tiny LCG is enough and keeps the numbers stable
 * across machines and Node versions.
 */

/** Target scale from NFR-1. */
export const TARGET_CARD_COUNT = 110_000;
export const TARGET_COLLECTION_COUNT = 20_000;

// Matches the batch size bulk-cards.ts settled on: `cards` has ~36 columns,
// and SQLite caps bound parameters per statement, so larger batches fail at
// scale with "too many SQL variables" - the exact bug small mocked tests
// never surface.
const CARD_BATCH_SIZE = 200;
// collection_items has ~10 columns, so it has far more headroom.
const ITEM_BATCH_SIZE = 500;

/**
 * Numerical Recipes LCG. Not cryptographic and not meant to be - it just
 * has to be identical everywhere.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  // Every table below is a non-empty literal, so this is unreachable - but
  // it beats an assertion that would silently hand back undefined if one
  // ever became empty.
  if (value === undefined) throw new Error("pick() called with an empty table");
  return value;
}

// Spread across the dimensions the compiler actually filters on, so a query
// like `c:r t:creature` selects a meaningful slice rather than everything or
// nothing.
const COLOR_COMBOS: readonly string[][] = [
  [],
  ["W"],
  ["U"],
  ["B"],
  ["R"],
  ["G"],
  ["W", "U"],
  ["U", "B"],
  ["B", "R"],
  ["R", "G"],
  ["G", "W"],
  ["W", "U", "B"],
  ["U", "B", "R"],
  ["B", "R", "G"],
  ["W", "U", "B", "R", "G"],
];

const TYPE_LINES = [
  "Creature — Goblin Warrior",
  "Creature — Elf Druid",
  "Creature — Human Wizard",
  "Instant",
  "Sorcery",
  "Artifact",
  "Artifact — Equipment",
  "Enchantment",
  "Enchantment — Aura",
  "Land",
  "Basic Land — Mountain",
  "Planeswalker — Jace",
  "Legendary Creature — Dragon",
] as const;

const RARITIES = ["common", "uncommon", "rare", "mythic"] as const;
const FINISH_SETS: readonly string[][] = [["nonfoil"], ["foil"], ["nonfoil", "foil"], ["etched"]];
const ITEM_FINISHES = ["nonfoil", "foil", "etched"] as const;
const BINDERS = ["box1", "box2", "binder-red", "binder-blue", "trade-stack", ""] as const;
// Stored already-normalized, which is what `addTag` would have produced.
// The distribution matters more than the values: `cube` is deliberately the
// densest so `tag:cube` benchmarks a selective-ish EXISTS over a real
// working set rather than over three rows.
const TAG_POOL = ["cube", "trade", "edh staple", "deck", "sell"] as const;
const SET_COUNT = 250;

const ORACLE_SNIPPETS = [
  "Draw a card.",
  "Destroy target creature.",
  "Flying, vigilance.",
  "When this enters, gain 3 life.",
  "Counter target spell unless its controller pays {2}.",
  "Add one mana of any color.",
  "Trample, haste.",
  null,
] as const;

/**
 * A stable synthetic id. Not a real UUID - `cards.id` is a plain TEXT
 * column with no format validation, and nothing in the query path parses
 * it. (A schema boundary that *does* validate would reject this; see the
 * `z.uuid()` note in CLAUDE.md.)
 */
function cardId(index: number): string {
  return `perf-card-${index.toString().padStart(6, "0")}`;
}

function buildCard(index: number, random: () => number, now: Date): NewCardRow {
  const colors = pick(random, COLOR_COMBOS);
  const setIndex = index % SET_COUNT;
  return {
    id: cardId(index),
    oracleId: `perf-oracle-${(index % 90_000).toString().padStart(6, "0")}`,
    name: `Perf Card ${index.toString().padStart(6, "0")}`,
    layout: "normal",
    manaCost: colors.length === 0 ? "{2}" : `{${colors.join("}{")}}`,
    cmc: Math.floor(random() * 9),
    typeLine: pick(random, TYPE_LINES),
    oracleText: pick(random, ORACLE_SNIPPETS),
    colors,
    // Identity is a superset of colors in real data; keeping them equal is
    // close enough and keeps `c:` vs `id:` comparable.
    colorIdentity: colors,
    keywords: [],
    legalities: {},
    games: ["paper"],
    reserved: random() < 0.02,
    setCode: `p${setIndex.toString().padStart(2, "0")}`,
    setName: `Perf Set ${setIndex.toString()}`,
    setType: "expansion",
    collectorNumber: String(index),
    rarity: pick(random, RARITIES),
    releasedAt: "2026-01-01",
    artist: "Perf Artist",
    borderColor: "black",
    frame: "2015",
    fullArt: random() < 0.05,
    textless: random() < 0.02,
    promo: random() < 0.08,
    variation: random() < 0.05,
    finishes: pick(random, FINISH_SETS),
    cardFaces: null,
    imageUris: { small: `https://example.invalid/${index.toString()}.jpg` },
    scryfallUri: `https://example.invalid/card/${index.toString()}`,
    prices: {},
    createdAt: now,
    updatedAt: now,
  };
}

function buildItem(
  index: number,
  random: () => number,
  cardCount: number,
  now: Date,
): NewCollectionItemRow {
  // Spread owned stacks across the whole card table rather than the first
  // 20k rows, so predicates can't accidentally hit a contiguous hot page.
  const cardIndex = Math.floor(random() * cardCount);
  return {
    id: `perf-item-${index.toString().padStart(6, "0")}`,
    scryfallId: cardId(cardIndex),
    finish: pick(random, ITEM_FINISHES),
    condition: pick(random, CONDITIONS),
    quantity: 1 + Math.floor(random() * 4),
    isProxy: random() < 0.03,
    binderLocation: pick(random, BINDERS),
    language: "en",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 0-3 tags per stack, weighted so roughly 40% of stacks carry `cube`.
 * Deduped, because the (collection_item_id, tag) primary key would reject a
 * repeat and the benchmark must never depend on catching that.
 */
function buildTags(itemId: string, random: () => number, now: Date): NewCollectionItemTagRow[] {
  if (random() < 0.35) return [];
  const chosen = new Set<string>();
  if (random() < 0.6) chosen.add("cube");
  const extra = Math.floor(random() * 3);
  for (let i = 0; i < extra; i++) chosen.add(pick(random, TAG_POOL));
  return [...chosen].map((tag) => ({ collectionItemId: itemId, tag, createdAt: now }));
}

export interface SeedCounts {
  readonly cards: number;
  readonly collectionItems: number;
  readonly tags: number;
}

/**
 * Seeds the fixture into whatever DB `db` is currently bound to. Caller is
 * responsible for pointing `DATABASE_PATH` at a throwaway file first.
 *
 * `db` is passed in rather than imported, because the test harness has to
 * `vi.resetModules()` and dynamically re-import the client to get a fresh
 * connection - importing it here would capture a stale one.
 */
export function seedPerfFixture(
  db: Db,
  options: { cardCount?: number; collectionCount?: number; seed?: number } = {},
): SeedCounts {
  const cardCount = options.cardCount ?? TARGET_CARD_COUNT;
  const collectionCount = options.collectionCount ?? TARGET_COLLECTION_COUNT;
  const random = makeRandom(options.seed ?? 20_260_802);
  const now = new Date();

  // One transaction per batch, not one for the whole seed: a single
  // 110k-row transaction holds the write lock for the entire run and
  // balloons the WAL.
  let batch: NewCardRow[] = [];
  const flushCards = () => {
    if (batch.length === 0) return;
    const rows = batch;
    db.transaction((tx) => tx.insert(cards).values(rows).run());
    batch = [];
  };
  for (let i = 0; i < cardCount; i++) {
    batch.push(buildCard(i, random, now));
    if (batch.length >= CARD_BATCH_SIZE) flushCards();
  }
  flushCards();

  let items: NewCollectionItemRow[] = [];
  let tags: NewCollectionItemTagRow[] = [];
  let tagCount = 0;
  const flushItems = () => {
    if (items.length === 0) return;
    const itemRows = items;
    const tagRows = tags;
    // Items before their tags, inside one transaction. The foreign key is
    // enforced per statement, not at commit, so inserting a tag whose stack
    // hasn't been written yet fails immediately - the mid-loop ordering trap
    // from CLAUDE.md.
    db.transaction((tx) => {
      tx.insert(collectionItems).values(itemRows).run();
      if (tagRows.length > 0) tx.insert(collectionItemTags).values(tagRows).run();
    });
    tagCount += tagRows.length;
    items = [];
    tags = [];
  };
  // The stack uniqueness index (scryfallId + finish + condition + isProxy +
  // binderLocation + language) means random draws can collide. Ids are
  // sequential so the row itself is always unique; dedup on the natural key
  // instead of catching constraint failures mid-batch.
  const seen = new Set<string>();
  let generated = 0;
  let attempts = 0;
  const maxAttempts = collectionCount * 10;
  while (generated < collectionCount && attempts < maxAttempts) {
    attempts++;
    const item = buildItem(generated, random, cardCount, now);
    const key = [
      item.scryfallId,
      item.finish,
      item.condition,
      String(item.isProxy),
      item.binderLocation,
      item.language,
    ].join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    tags.push(...buildTags(item.id, random, now));
    generated++;
    if (items.length >= ITEM_BATCH_SIZE) flushItems();
  }
  flushItems();

  return { cards: cardCount, collectionItems: generated, tags: tagCount };
}
