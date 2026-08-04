import { describe, expect, it } from "vitest";
import {
  type CorpusEntry,
  type CorpusManifest,
  corpusEntrySchema,
  MIN_ENTRIES,
  parseManifest,
  strataCounts,
  validateManifest,
} from "./manifest.ts";

function entry(overrides: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    image: "images/001.jpg",
    scryfallId: "6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84",
    oracleId: "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e",
    name: "Sol Ring",
    setCode: "c19",
    collectorNumber: "241",
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

/** Indexes a non-empty tuple without `noUncheckedIndexedAccess` widening the
 *  result to `| undefined`, which `exactOptionalPropertyTypes` then rejects. */
function cycle<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) throw new Error("cycle over an empty list");
  return value;
}

/** A manifest that satisfies every coverage rule, so a test can introduce
 *  exactly one defect and assert on it. */
function healthyManifest(): CorpusManifest {
  const entries: CorpusEntry[] = [];
  const conditions = ["NM", "LP", "MP", "HP", "DMG"] as const;
  const finishes = ["nonfoil", "foil", "etched"] as const;
  const sleeves = ["none", "clear", "opaque-back"] as const;
  const frames = ["1993", "1997", "2003", "2015", "showcase", "borderless"] as const;
  const lightings = ["bright", "indoor", "low", "harsh-glare"] as const;

  for (let index = 0; index < MIN_ENTRIES; index += 1) {
    entries.push(
      entry({
        image: `images/${String(index).padStart(3, "0")}.jpg`,
        condition: cycle(conditions, index),
        finish: cycle(finishes, index),
        sleeve: cycle(sleeves, index),
        frame: cycle(frames, index),
        lighting: cycle(lightings, index),
        // Every 5th, comfortably over MIN_STRATUM.
        sharedArt: index % 5 === 0,
      }),
    );
  }
  return { version: 1, capture: "test fixture", entries };
}

describe("corpusEntrySchema", () => {
  it("accepts a well-formed entry", () => {
    expect(() => corpusEntrySchema.parse(entry())).not.toThrow();
  });

  it("defaults notes to an empty string", () => {
    const { notes, ...withoutNotes } = entry();
    expect(notes).toBe("");
    expect(corpusEntrySchema.parse(withoutNotes).notes).toBe("");
  });

  it("rejects a placeholder UUID", () => {
    // z.uuid() enforces the version and variant nibbles, so a memorable
    // repeated-digit id fails even though a text column would take it.
    expect(() =>
      corpusEntrySchema.parse(entry({ scryfallId: "11111111-1111-1111-1111-111111111111" })),
    ).toThrow();
  });

  it("requires both levels of ground truth", () => {
    const { oracleId, ...withoutOracle } = entry();
    expect(oracleId).toBeDefined();
    expect(() => corpusEntrySchema.parse(withoutOracle)).toThrow();
  });

  it("rejects an unknown stratum value", () => {
    expect(() => corpusEntrySchema.parse(entry({ lighting: "candlelit" as never }))).toThrow();
  });

  it("rejects an empty image path", () => {
    expect(() => corpusEntrySchema.parse(entry({ image: "" }))).toThrow();
  });
});

describe("parseManifest", () => {
  it("rejects a manifest with no version", () => {
    expect(() => parseManifest({ entries: [] })).toThrow();
  });

  it("defaults capture notes", () => {
    expect(parseManifest({ version: 1, entries: [] }).capture).toBe("");
  });
});

describe("validateManifest", () => {
  it("passes a healthy corpus", () => {
    expect(validateManifest(healthyManifest())).toEqual([]);
  });

  it("catches a duplicate image path", () => {
    // Two rows pointing at one photo means one card is scored twice and
    // another is never scored at all.
    const manifest = healthyManifest();
    const first = manifest.entries[0];
    const second = manifest.entries[1];
    if (!first || !second) throw new Error("fixture too small");
    second.image = first.image;

    const problems = validateManifest(manifest);
    expect(problems.some((problem) => problem.message.includes("duplicate image path"))).toBe(true);
  });

  it("catches an undersized corpus", () => {
    const manifest = healthyManifest();
    manifest.entries = manifest.entries.slice(0, 50);
    const problems = validateManifest(manifest);
    expect(problems.some((problem) => problem.message.includes("below the 300 minimum"))).toBe(
      true,
    );
  });

  it("catches an oversized corpus", () => {
    const manifest = healthyManifest();
    manifest.entries = [
      ...manifest.entries,
      ...manifest.entries.map((item, index) => ({ ...item, image: `dup/${String(index)}.jpg` })),
    ];
    const problems = validateManifest(manifest);
    expect(problems.some((problem) => problem.message.includes("above the 500 maximum"))).toBe(
      true,
    );
  });

  it("catches a stratum that is really a constant", () => {
    // 400 near-mint cards is a valid manifest and a useless corpus: it would
    // report 99% accuracy and predict nothing about a played card.
    const manifest = healthyManifest();
    for (const item of manifest.entries) item.condition = "NM";

    const problems = validateManifest(manifest);
    expect(
      problems.some(
        (problem) =>
          problem.message.includes('stratum "condition"') && problem.message.includes("only 1"),
      ),
    ).toBe(true);
  });

  it("catches too few shared-art entries", () => {
    // The AC calls these out specifically as the case that caps
    // printing-level accuracy.
    const manifest = healthyManifest();
    for (const item of manifest.entries) item.sharedArt = false;

    const problems = validateManifest(manifest);
    expect(problems.some((problem) => problem.message.includes("shared-art"))).toBe(true);
  });

  it("reports every problem at once rather than stopping at the first", () => {
    // Fixing a corpus one error per run means re-shooting cards one error
    // per run.
    const manifest: CorpusManifest = { version: 1, capture: "", entries: [entry(), entry()] };
    const problems = validateManifest(manifest);
    expect(problems.length).toBeGreaterThan(2);
  });

  it("points at the offending entry by index where it can", () => {
    const manifest = healthyManifest();
    const first = manifest.entries[0];
    const second = manifest.entries[1];
    if (!first || !second) throw new Error("fixture too small");
    second.image = first.image;

    const duplicate = validateManifest(manifest).find((problem) =>
      problem.message.includes("duplicate"),
    );
    expect(duplicate?.index).toBe(1);
  });
});

describe("strataCounts", () => {
  it("counts every value on every axis, including zeroes", () => {
    const counts = strataCounts({
      version: 1,
      capture: "",
      entries: [entry({ condition: "NM" }), entry({ image: "b.jpg", condition: "LP" })],
    });
    expect(counts["condition"]?.["NM"]).toBe(1);
    expect(counts["condition"]?.["LP"]).toBe(1);
    // Present with a zero rather than absent - the gap is the information.
    expect(counts["condition"]?.["DMG"]).toBe(0);
  });

  it("reports the shared-art split", () => {
    const counts = strataCounts({
      version: 1,
      capture: "",
      entries: [entry({ sharedArt: true }), entry({ image: "b.jpg", sharedArt: false })],
    });
    expect(counts["sharedArt"]?.["true"]).toBe(1);
    expect(counts["sharedArt"]?.["false"]).toBe(1);
  });
});
