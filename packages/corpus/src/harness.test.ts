import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluate, loadBaseline, loadManifest, runHarness, writeBaseline } from "./harness.ts";
import type { CorpusEntry, CorpusManifest } from "./manifest.ts";
import { rate } from "./metrics.ts";

let dir: string;

const PRINTING = "6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84";
const ORACLE = "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e";

function entry(overrides: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    image: "images/001.jpg",
    scryfallId: PRINTING,
    oracleId: ORACLE,
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

function manifest(entries: CorpusEntry[]): CorpusManifest {
  return { version: 1, capture: "test", entries };
}

function writeManifest(entries: CorpusEntry[]): void {
  writeFileSync(join(dir, "labels.json"), JSON.stringify(manifest(entries)));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mtg-corpus-harness-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runHarness", () => {
  it("times each call itself rather than trusting the recognizer", async () => {
    const run = await runHarness(
      manifest([entry()]),
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { candidates: [{ scryfallId: PRINTING, oracleId: ORACLE }], tier: "T1" as const };
      },
      dir,
    );
    expect(run.results).toHaveLength(1);
    expect(run.results[0]?.latencyMs).toBeGreaterThanOrEqual(10);
  });

  it("passes the recognizer a path under the image directory", async () => {
    const seen: string[] = [];
    await runHarness(
      manifest([entry({ image: "images/007.jpg" })]),
      async (path) => {
        seen.push(path);
        return await Promise.resolve({ candidates: [], tier: "T1" as const });
      },
      "/corpus",
    );
    expect(seen).toEqual([join("/corpus", "images/007.jpg")]);
  });

  it("records a throwing recognizer as an error rather than aborting the run", async () => {
    const run = await runHarness(
      manifest([entry({ image: "a.jpg" }), entry({ image: "b.jpg" })]),
      async (path) => {
        if (path.endsWith("a.jpg")) throw new Error("decode failed");
        return await Promise.resolve({
          candidates: [{ scryfallId: PRINTING, oracleId: ORACLE }],
          tier: "T1" as const,
        });
      },
      dir,
    );

    // The second image still ran.
    expect(run.results).toHaveLength(1);
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]?.image).toBe("a.jpg");
    expect(run.errors[0]?.message).toBe("decode failed");
  });

  it("lets a crashed image land in the report's missing count", async () => {
    // A recognizer that crashes on half the corpus must not post excellent
    // numbers on the half it survived.
    writeManifest([entry({ image: "a.jpg" }), entry({ image: "b.jpg" })]);
    const { report } = await evaluate({
      corpusDir: dir,
      recognize: async (path) => {
        if (path.endsWith("a.jpg")) throw new Error("boom");
        return await Promise.resolve({
          candidates: [{ scryfallId: PRINTING, oracleId: ORACLE }],
          tier: "T1" as const,
        });
      },
    });

    expect(report.evaluated).toBe(1);
    expect(report.missing).toBe(1);
  });
});

describe("evaluate", () => {
  it("scores a perfect recognizer at 100%", async () => {
    writeManifest([entry()]);
    const { report } = await evaluate({
      corpusDir: dir,
      recognize: async () =>
        await Promise.resolve({
          candidates: [{ scryfallId: PRINTING, oracleId: ORACLE }],
          tier: "T1" as const,
        }),
    });
    expect(rate(report.printing, "top1")).toBe(1);
    expect(rate(report.oracle, "top1")).toBe(1);
  });

  it("scores a recognizer that always returns nothing at 0%", async () => {
    writeManifest([entry()]);
    const { report } = await evaluate({
      corpusDir: dir,
      recognize: async () => await Promise.resolve({ candidates: [], tier: "T1" as const }),
    });
    expect(rate(report.printing, "top1")).toBe(0);
    expect(report.evaluated).toBe(1);
  });
});

describe("loadManifest", () => {
  it("rejects a malformed manifest instead of half-loading it", () => {
    writeFileSync(join(dir, "labels.json"), JSON.stringify({ version: 1, entries: [{}] }));
    expect(() => loadManifest(dir)).toThrow();
  });

  it("round-trips a written manifest", () => {
    writeManifest([entry()]);
    expect(loadManifest(dir).entries).toHaveLength(1);
  });
});

describe("loadBaseline", () => {
  it("is null when no baseline has been recorded", () => {
    // The first run legitimately has nothing to compare against; that is not
    // an error.
    expect(loadBaseline(dir)).toBeNull();
  });

  it("throws on a hand-edited baseline that is missing a metric", () => {
    // Read through a cast this would be `undefined`, making every delta NaN
    // and `NaN > tolerance` false - the gate would pass silently forever.
    writeFileSync(
      join(dir, "baseline.json"),
      JSON.stringify({
        version: 1,
        recordedAt: "2026-08-04",
        commit: "abc",
        corpusSize: 300,
        metrics: { oracleTop1: 0.9, oracleTop5: 0.95, printingTop1: 0.8 },
      }),
    );
    expect(() => loadBaseline(dir)).toThrow();
  });

  it("round-trips a written baseline", () => {
    writeBaseline(dir, {
      version: 1,
      recordedAt: "2026-08-04",
      commit: "abc1234",
      corpusSize: 350,
      metrics: { oracleTop1: 0.95, oracleTop5: 0.99, printingTop1: 0.9, printingTop5: 0.95 },
    });
    expect(loadBaseline(dir)?.corpusSize).toBe(350);
    expect(loadBaseline(dir)?.metrics.printingTop1).toBe(0.9);
  });
});
