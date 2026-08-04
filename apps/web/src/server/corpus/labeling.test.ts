import {
  CORPUS_CONDITIONS,
  CORPUS_FINISHES,
  CORPUS_FRAMES,
  CORPUS_LIGHTING,
  CORPUS_SLEEVES,
  type CorpusEntry,
} from "@mtg/corpus";
import { describe, expect, it } from "vitest";
import { buildCard } from "../decks/test-cards";
import {
  applySticky,
  buildEntry,
  DEFAULT_STICKY,
  deriveFrame,
  formatSticky,
  parseLabelInput,
  pendingImages,
  type StickyStrata,
  stickyFromLastEntry,
} from "./labeling";

const CARD_ID = "6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84";
const ORACLE_ID = "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e";

describe("stratum vocabularies", () => {
  it("are disjoint, which is what lets a bare token be placed", () => {
    // If two axes ever share a value, `foil` stops being unambiguous and one
    // axis silently becomes unreachable from the shorthand. Fail here rather
    // than mislabelling a corpus.
    const all = [
      ...CORPUS_CONDITIONS.map((v) => v.toLowerCase()),
      ...CORPUS_FINISHES,
      ...CORPUS_SLEEVES,
      ...CORPUS_LIGHTING,
      ...CORPUS_FRAMES,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("parseLabelInput", () => {
  it("parses a bare set and collector number", () => {
    const parsed = parseLabelInput("dom 168");
    expect(parsed).toMatchObject({ kind: "card", setCode: "dom", collectorNumber: "168" });
  });

  it("lowercases the set code but leaves the collector number alone", () => {
    // Collector numbers are text: "168a", "★12" and leading zeroes are real.
    const parsed = parseLabelInput("DOM 168a");
    expect(parsed).toMatchObject({ setCode: "dom", collectorNumber: "168a" });
  });

  it("places strata tokens on the right axis without being told which", () => {
    const parsed = parseLabelInput("c19 241 foil lp clear low");
    expect(parsed).toMatchObject({
      kind: "card",
      strata: { finish: "foil", condition: "LP", sleeve: "clear", lighting: "low" },
    });
  });

  it("accepts a condition in either case", () => {
    expect(parseLabelInput("dom 168 lp")).toMatchObject({ strata: { condition: "LP" } });
    expect(parseLabelInput("dom 168 LP")).toMatchObject({ strata: { condition: "LP" } });
  });

  it("takes an explicit frame override", () => {
    expect(parseLabelInput("mh2 250 showcase")).toMatchObject({ strata: { frame: "showcase" } });
  });

  it("rejects an unrecognized token rather than ignoring it", () => {
    // A silently dropped "fol" would label a foil as nonfoil, which makes
    // the per-slice accuracy report lie rather than merely be incomplete.
    const parsed = parseLabelInput("dom 168 fol");
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") expect(parsed.message).toContain("fol");
  });

  it("asks for a collector number when only a set is given", () => {
    const parsed = parseLabelInput("dom");
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") expect(parsed.message).toContain("dom 168");
  });

  it("errors on an empty line instead of advancing", () => {
    expect(parseLabelInput("").kind).toBe("error");
    expect(parseLabelInput("   ").kind).toBe("error");
  });

  it("takes a trailing note after #", () => {
    const parsed = parseLabelInput("dom 168 foil # glare across the top-left");
    expect(parsed).toMatchObject({
      kind: "card",
      strata: { finish: "foil" },
      notes: "glare across the top-left",
    });
  });

  it("keeps a # inside the note itself", () => {
    const parsed = parseLabelInput("dom 168 # see photo #3");
    expect(parsed).toMatchObject({ notes: "see photo #3" });
  });

  it("has no note when none was given", () => {
    expect(parseLabelInput("dom 168")).toMatchObject({ notes: "" });
  });

  it("recognizes the commands and their short forms", () => {
    expect(parseLabelInput("skip")).toEqual({ kind: "command", command: "skip" });
    expect(parseLabelInput("s")).toEqual({ kind: "command", command: "skip" });
    expect(parseLabelInput("back")).toEqual({ kind: "command", command: "back" });
    expect(parseLabelInput("q")).toEqual({ kind: "command", command: "quit" });
    expect(parseLabelInput("?")).toEqual({ kind: "command", command: "help" });
  });

  it("tolerates ragged whitespace", () => {
    expect(parseLabelInput("  dom   168   foil  ")).toMatchObject({
      setCode: "dom",
      collectorNumber: "168",
      strata: { finish: "foil" },
    });
  });
});

describe("applySticky", () => {
  it("carries values forward until changed", () => {
    let sticky: StickyStrata = { ...DEFAULT_STICKY };
    sticky = applySticky(sticky, { finish: "foil", condition: "LP" });
    expect(sticky).toMatchObject({ finish: "foil", condition: "LP", lighting: "bright" });

    // Only the finish changes; the condition persists.
    sticky = applySticky(sticky, { finish: "nonfoil" });
    expect(sticky).toMatchObject({ finish: "nonfoil", condition: "LP" });
  });

  it("does not mutate the input", () => {
    const sticky: StickyStrata = { ...DEFAULT_STICKY };
    applySticky(sticky, { finish: "foil" });
    expect(sticky.finish).toBe("nonfoil");
  });
});

describe("formatSticky", () => {
  it("shows that frame comes from the card when unset", () => {
    expect(formatSticky(DEFAULT_STICKY)).toContain("frame=(from card)");
  });

  it("shows an explicit frame override", () => {
    expect(formatSticky({ ...DEFAULT_STICKY, frame: "showcase" })).toContain("frame=showcase");
  });
});

describe("deriveFrame", () => {
  it("reads the frame off the card", () => {
    expect(deriveFrame({ frame: "2015", borderColor: "black" })).toBe("2015");
    expect(deriveFrame({ frame: "1993", borderColor: "black" })).toBe("1993");
  });

  it("lets a borderless border win over the frame", () => {
    // Borderless is what actually moves the collector-number strip, which is
    // the reason frame is a stratum at all.
    expect(deriveFrame({ frame: "2015", borderColor: "borderless" })).toBe("borderless");
  });

  it("gives up on a frame with no slot in the vocabulary", () => {
    // Scryfall's "future" frame. Null so the user is asked rather than
    // mislabelled.
    expect(deriveFrame({ frame: "future", borderColor: "black" })).toBeNull();
  });
});

describe("buildEntry", () => {
  const card = buildCard(CARD_ID, {
    oracleId: ORACLE_ID,
    name: "Llanowar Elves",
    setCode: "dom",
    collectorNumber: "168",
    frame: "2015",
    borderColor: "black",
  });

  it("assembles a complete entry from the card and the sticky strata", () => {
    const built = buildEntry({
      image: "images/IMG_001.jpg",
      card,
      sticky: { ...DEFAULT_STICKY, finish: "foil", condition: "MP" },
      sharedArt: true,
      notes: "glare",
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.entry).toEqual({
      image: "images/IMG_001.jpg",
      scryfallId: CARD_ID,
      oracleId: ORACLE_ID,
      name: "Llanowar Elves",
      setCode: "dom",
      collectorNumber: "168",
      condition: "MP",
      finish: "foil",
      sleeve: "none",
      frame: "2015",
      lighting: "bright",
      sharedArt: true,
      notes: "glare",
    } satisfies CorpusEntry);
  });

  it("prefers an explicit frame override to the card's own frame", () => {
    const built = buildEntry({
      image: "a.jpg",
      card,
      sticky: { ...DEFAULT_STICKY, frame: "showcase" },
      sharedArt: false,
      notes: "",
    });
    expect(built.ok && built.entry.frame).toBe("showcase");
  });

  it("refuses rather than guessing when the frame cannot be derived", () => {
    const built = buildEntry({
      image: "a.jpg",
      card: buildCard(CARD_ID, { oracleId: ORACLE_ID, frame: "future" }),
      sticky: DEFAULT_STICKY,
      sharedArt: false,
      notes: "",
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.message).toContain("showcase");
  });

  it("refuses a card with no oracle id", () => {
    // Oracle-level accuracy is half of what the harness reports, so a card
    // that cannot be scored must not enter the corpus at all.
    const built = buildEntry({
      image: "a.jpg",
      card: buildCard(CARD_ID, { oracleId: null }),
      sticky: DEFAULT_STICKY,
      sharedArt: false,
      notes: "",
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.message).toContain("oracle_id");
  });
});

function entry(image: string, overrides: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    image,
    scryfallId: CARD_ID,
    oracleId: ORACLE_ID,
    name: "x",
    setCode: "dom",
    collectorNumber: "1",
    condition: "NM",
    finish: "nonfoil",
    sleeve: "none",
    frame: "2015",
    lighting: "bright",
    sharedArt: false,
    notes: "",
    ...overrides,
  };
}

describe("stickyFromLastEntry", () => {
  it("is null for an empty manifest, so the defaults apply", () => {
    expect(stickyFromLastEntry([])).toBeNull();
  });

  it("resumes mid-batch instead of snapping back to the defaults", () => {
    // The reset is the kind of thing nobody notices until forty foils have
    // been labelled nonfoil.
    const resumed = stickyFromLastEntry([
      entry("a.jpg"),
      entry("b.jpg", { finish: "foil", condition: "MP", sleeve: "clear", lighting: "low" }),
    ]);
    expect(resumed).toEqual({
      condition: "MP",
      finish: "foil",
      sleeve: "clear",
      lighting: "low",
    });
  });

  it("does not restore a frame override", () => {
    // Frame is derived per card; an override outliving its session would be
    // a worse bug than the one this fixes.
    const resumed = stickyFromLastEntry([entry("a.jpg", { frame: "showcase" })]);
    expect(resumed?.frame).toBeUndefined();
  });
});

describe("pendingImages", () => {
  it("is everything when nothing is labelled", () => {
    expect(pendingImages(["a.jpg", "b.jpg"], [])).toEqual(["a.jpg", "b.jpg"]);
  });

  it("skips already-labelled photos, which is what makes it resumable", () => {
    expect(pendingImages(["a.jpg", "b.jpg", "c.jpg"], [entry("b.jpg")])).toEqual([
      "a.jpg",
      "c.jpg",
    ]);
  });

  it("preserves directory order", () => {
    expect(pendingImages(["a.jpg", "b.jpg", "c.jpg"], [entry("a.jpg")])).toEqual([
      "b.jpg",
      "c.jpg",
    ]);
  });

  it("is empty once every photo is labelled", () => {
    expect(pendingImages(["a.jpg"], [entry("a.jpg")])).toEqual([]);
  });
});
