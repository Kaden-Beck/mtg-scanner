import {
  CORPUS_CONDITIONS,
  CORPUS_FINISHES,
  CORPUS_FRAMES,
  CORPUS_LIGHTING,
  CORPUS_SLEEVES,
  type CorpusCondition,
  type CorpusEntry,
  type CorpusFinish,
  type CorpusFrame,
  type CorpusLighting,
  type CorpusSleeve,
} from "@mtg/corpus";
import type { CardRow } from "../db/schema.ts";

/**
 * Input parsing and entry assembly for `pnpm corpus:label` (KAD-36).
 *
 * Pure, so the parsing rules are cheap to test - the readline shell in
 * `label-cli.ts` stays thin, and the DB lookups live in `lookup.ts`. Same
 * split as `color-identity.ts` / `hydrate.ts`.
 *
 * The design goal is that labelling 400 photographs costs two tokens each.
 * Everything derivable from the local `cards` table is derived rather than
 * asked, and everything that is asked persists until it changes, because
 * the shoot is batched by stratum (see `inital-scan-plan.md`).
 */

/** Strata that carry over from one photo to the next. */
export interface StickyStrata {
  condition: CorpusCondition;
  finish: CorpusFinish;
  sleeve: CorpusSleeve;
  lighting: CorpusLighting;
  /** Overrides frame derivation. Unset means "trust the card row". */
  frame?: CorpusFrame;
}

export const DEFAULT_STICKY: StickyStrata = {
  condition: "NM",
  finish: "nonfoil",
  sleeve: "none",
  lighting: "bright",
};

export type LabelCommand = "skip" | "back" | "quit" | "help";

export type ParsedInput =
  | { kind: "command"; command: LabelCommand }
  | {
      kind: "card";
      setCode: string;
      collectorNumber: string;
      strata: Partial<StickyStrata>;
      notes: string;
    }
  | { kind: "error"; message: string };

const COMMANDS: Record<string, LabelCommand> = {
  skip: "skip",
  s: "skip",
  back: "back",
  b: "back",
  quit: "quit",
  q: "quit",
  "?": "help",
  help: "help",
};

/**
 * Which stratum a bare token belongs to.
 *
 * The five vocabularies are disjoint, which is what lets a token be placed
 * without the user naming its axis - `foil` can only be a finish. A test
 * asserts the disjointness, so adding a colliding value to any vocabulary
 * fails loudly rather than silently making one axis unreachable.
 */
function classifyToken(token: string): Partial<StickyStrata> | null {
  const lower = token.toLowerCase();
  const upper = token.toUpperCase();

  // `.find` rather than `.some` + a cast: it returns the vocabulary's own
  // element type already narrowed, so the value reaches the result properly
  // typed with no assertion.
  const condition = CORPUS_CONDITIONS.find((value) => value === upper);
  if (condition) return { condition };

  const finish = CORPUS_FINISHES.find((value) => value === lower);
  if (finish) return { finish };

  const sleeve = CORPUS_SLEEVES.find((value) => value === lower);
  if (sleeve) return { sleeve };

  const lighting = CORPUS_LIGHTING.find((value) => value === lower);
  if (lighting) return { lighting };

  const frame = CORPUS_FRAMES.find((value) => value === lower);
  if (frame) return { frame };

  return null;
}

/**
 * Parses one line of input.
 *
 * An unrecognized token is an **error**, never ignored: silently dropping a
 * mistyped `fol` would label a foil as nonfoil, and a stratum that is
 * quietly wrong is worse than one that is missing - it makes the per-slice
 * accuracy report lie rather than merely be incomplete.
 */
export function parseLabelInput(raw: string): ParsedInput {
  const [body = "", ...noteParts] = raw.split("#");
  const notes = noteParts.join("#").trim();
  const tokens = body.trim().split(/\s+/).filter(Boolean);

  const first = tokens[0];
  if (!first)
    return { kind: "error", message: "Type a set code and collector number, or ? for help." };

  const command = COMMANDS[first.toLowerCase()];
  if (command) return { kind: "command", command };

  const collectorNumber = tokens[1];
  if (!collectorNumber) {
    return {
      kind: "error",
      message: `Need a collector number too, e.g. "${first} 168".`,
    };
  }

  const strata: Partial<StickyStrata> = {};
  for (const token of tokens.slice(2)) {
    const classified = classifyToken(token);
    if (!classified) {
      return {
        kind: "error",
        message: `Don't recognize "${token}". Known values: ${knownTokens()}`,
      };
    }
    Object.assign(strata, classified);
  }

  return {
    kind: "card",
    setCode: first.toLowerCase(),
    collectorNumber,
    strata,
    notes,
  };
}

export function knownTokens(): string {
  return [
    ...CORPUS_CONDITIONS,
    ...CORPUS_FINISHES,
    ...CORPUS_SLEEVES,
    ...CORPUS_LIGHTING,
    ...CORPUS_FRAMES,
  ].join(" ");
}

export function applySticky(sticky: StickyStrata, update: Partial<StickyStrata>): StickyStrata {
  return { ...sticky, ...update };
}

export function formatSticky(sticky: StickyStrata): string {
  const frame = sticky.frame ?? "(from card)";
  return `condition=${sticky.condition} finish=${sticky.finish} sleeve=${sticky.sleeve} lighting=${sticky.lighting} frame=${frame}`;
}

/**
 * Frame from the card row, or null when it cannot be decided.
 *
 * `borderless` is a border colour rather than a frame in Scryfall's model,
 * and it wins because it is what actually changes where the collector-number
 * strip sits - which is the reason the harness stratifies on frame at all.
 *
 * `showcase` is a frame *effect*, which `cards` does not store, and `future`
 * is a real Scryfall frame with no slot in the corpus vocabulary. Both
 * return null so the user is asked rather than mislabelled.
 */
export function deriveFrame(card: Pick<CardRow, "frame" | "borderColor">): CorpusFrame | null {
  if (card.borderColor === "borderless") return "borderless";
  const match = CORPUS_FRAMES.find((value) => value === card.frame);
  return match ?? null;
}

export interface BuildEntryInput {
  image: string;
  card: CardRow;
  sticky: StickyStrata;
  sharedArt: boolean;
  notes: string;
}

export type BuildEntryResult = { ok: true; entry: CorpusEntry } | { ok: false; message: string };

export function buildEntry(input: BuildEntryInput): BuildEntryResult {
  const { image, card, sticky, sharedArt, notes } = input;

  const frame = sticky.frame ?? deriveFrame(card);
  if (!frame) {
    return {
      ok: false,
      message:
        `Can't derive a frame for this card (frame="${card.frame}", border="${card.borderColor}"). ` +
        `Add one explicitly, e.g. "${card.setCode} ${card.collectorNumber} showcase".`,
    };
  }

  if (card.oracleId === null) {
    // Both levels of ground truth are required, and oracle-level accuracy is
    // half of what the harness reports. A card with no oracle id cannot be
    // scored, so it must not enter the corpus at all.
    return {
      ok: false,
      message: `"${card.name}" has no oracle_id and cannot be scored. Skip this photo.`,
    };
  }

  return {
    ok: true,
    entry: {
      image,
      scryfallId: card.id,
      oracleId: card.oracleId,
      name: card.name,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      condition: sticky.condition,
      finish: sticky.finish,
      sleeve: sticky.sleeve,
      frame,
      lighting: sticky.lighting,
      sharedArt,
      notes,
    },
  };
}

/**
 * Sticky strata carried over from the last labelled entry, so resuming picks
 * up mid-batch instead of silently snapping back to "NM nonfoil unsleeved
 * bright".
 *
 * That reset is the kind of thing nobody notices until forty foils are
 * labelled nonfoil. `frame` is deliberately *not* restored: it is derived per
 * card, and an override that outlived the session it was typed in would be a
 * worse bug than the one this fixes.
 */
export function stickyFromLastEntry(entries: CorpusEntry[]): StickyStrata | null {
  const last = entries.at(-1);
  if (!last) return null;
  return {
    condition: last.condition,
    finish: last.finish,
    sleeve: last.sleeve,
    lighting: last.lighting,
  };
}

/** Images with no entry yet, in directory order - what makes the tool
 *  resumable across sessions. */
export function pendingImages(allImages: string[], labelled: CorpusEntry[]): string[] {
  const done = new Set(labelled.map((entry) => entry.image));
  return allImages.filter((image) => !done.has(image));
}
