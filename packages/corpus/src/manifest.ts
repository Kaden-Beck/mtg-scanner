import { z } from "zod";

/**
 * The golden recognition corpus manifest (KAD-36).
 *
 * This file is the *contract* between the photographs and every consumer of
 * them - the KAD-37 accuracy harness today, threshold tuning (KAD-53) and
 * throughput profiling (KAD-54) later. It is deliberately written before any
 * recognition code exists, so the recognition problem has a measurable
 * definition of success up front rather than one reverse-engineered from
 * whatever the first implementation happens to do.
 *
 * Every field that is not ground truth is a *stratum*: something the corpus
 * must vary across so accuracy can be reported per-slice. A corpus that is
 * 95% accurate overall but 40% accurate on foils is a corpus that has not
 * told you the thing you needed to know, and it cannot tell you unless the
 * axis was recorded at capture time. Recording them later is not possible -
 * nobody can look at a photo and reliably say whether it was sleeved.
 */

/** Physical wear, matching the collection's own vocabulary (KAD-12). */
export const CORPUS_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export const corpusConditionSchema = z.enum(CORPUS_CONDITIONS);
export type CorpusCondition = z.infer<typeof corpusConditionSchema>;

export const CORPUS_FINISHES = ["nonfoil", "foil", "etched"] as const;
export const corpusFinishSchema = z.enum(CORPUS_FINISHES);
export type CorpusFinish = z.infer<typeof corpusFinishSchema>;

/**
 * Sleeving matters more than it looks: a glossy sleeve adds specular
 * highlights and a second set of edges for segmentation (T0) to lock onto.
 */
export const CORPUS_SLEEVES = ["none", "clear", "opaque-back"] as const;
export const corpusSleeveSchema = z.enum(CORPUS_SLEEVES);
export type CorpusSleeve = z.infer<typeof corpusSleeveSchema>;

/**
 * Frame era, because the collector-number strip OCR (T2) reads a different
 * place on each, and old frames have no strip at all.
 */
export const CORPUS_FRAMES = ["1993", "1997", "2003", "2015", "showcase", "borderless"] as const;
export const corpusFrameSchema = z.enum(CORPUS_FRAMES);
export type CorpusFrame = z.infer<typeof corpusFrameSchema>;

export const CORPUS_LIGHTING = ["bright", "indoor", "low", "harsh-glare"] as const;
export const corpusLightingSchema = z.enum(CORPUS_LIGHTING);
export type CorpusLighting = z.infer<typeof corpusLightingSchema>;

/**
 * One photographed card.
 *
 * `scryfallId` is printing-level truth and `oracleId` is card-level truth.
 * Both are required because the harness reports accuracy at both levels and
 * they fail differently: a scanner that always returns *a* Sol Ring but the
 * wrong printing scores 100% oracle and near-0% printing, and that gap is
 * the single most important number the corpus produces.
 */
export const corpusEntrySchema = z.object({
  /** Path to the image, relative to the manifest's own directory. */
  image: z.string().min(1),

  /** Ground truth: the exact printing photographed. */
  scryfallId: z.uuid(),
  /** Ground truth: the oracle card, shared across its printings. */
  oracleId: z.uuid(),

  /** Human-readable, for reading a failure report without a DB lookup. */
  name: z.string().min(1),
  setCode: z.string().min(1),
  collectorNumber: z.string().min(1),

  condition: corpusConditionSchema,
  finish: corpusFinishSchema,
  sleeve: corpusSleeveSchema,
  frame: corpusFrameSchema,
  lighting: corpusLightingSchema,

  /**
   * True when this artwork appears on more than one printing.
   *
   * The hard case the AC calls out explicitly, and the one that caps
   * printing-level accuracy: pHash cannot separate two printings that share
   * an illustration, so these are exactly the cards that must escalate to
   * OCR (T2) rather than being answered confidently and wrongly at T1.
   * Tracked as its own flag so the harness can report accuracy with and
   * without them - a headline number that quietly excludes them is a lie,
   * and one that buries them is unactionable.
   */
  sharedArt: z.boolean(),

  /** Anything unusual about this shot, for triaging a surprising failure. */
  notes: z.string().default(""),
});

export type CorpusEntry = z.infer<typeof corpusEntrySchema>;

export const corpusManifestSchema = z.object({
  version: z.literal(1),
  /** Free text: camera, lens, surface, anything that would be needed to
   *  reproduce or extend the shoot consistently. */
  capture: z.string().default(""),
  entries: z.array(corpusEntrySchema),
});

export type CorpusManifest = z.infer<typeof corpusManifestSchema>;

export interface ManifestProblem {
  /** Index into `entries`, or -1 for a whole-manifest problem. */
  index: number;
  message: string;
}

/**
 * Checks the things Zod cannot: uniqueness, and whether the corpus actually
 * covers the strata KAD-36 asks for.
 *
 * Split from the schema on purpose. A manifest that parses but photographs
 * 400 near-mint unsleeved modern-frame cards in bright light is *valid* and
 * *useless* - it would report 99% accuracy and predict nothing about a
 * played foil under a lamp. These checks are what make "stratified" a
 * property that is enforced rather than merely intended.
 */
export function validateManifest(manifest: CorpusManifest): ManifestProblem[] {
  const problems: ManifestProblem[] = [];

  const seenImages = new Set<string>();
  manifest.entries.forEach((entry, index) => {
    if (seenImages.has(entry.image)) {
      problems.push({ index, message: `duplicate image path: ${entry.image}` });
    }
    seenImages.add(entry.image);
  });

  return [...problems, ...coverageProblems(manifest)];
}

/** The AC's target range. Below the floor the per-stratum numbers are noise. */
export const MIN_ENTRIES = 300;
export const MAX_ENTRIES = 500;

/**
 * How thin a stratum may get before its accuracy number stops meaning
 * anything. At 10 photos one failure moves the number 10 points, so a slice
 * below this is reported but must not be trusted.
 */
export const MIN_STRATUM = 10;

function coverageProblems(manifest: CorpusManifest): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const total = manifest.entries.length;

  if (total < MIN_ENTRIES) {
    problems.push({
      index: -1,
      message: `corpus has ${String(total)} entries, below the ${String(MIN_ENTRIES)} minimum`,
    });
  }
  if (total > MAX_ENTRIES) {
    problems.push({
      index: -1,
      message: `corpus has ${String(total)} entries, above the ${String(MAX_ENTRIES)} maximum`,
    });
  }

  // Each axis needs at least two represented values, or it is not a
  // stratum - it is a constant that happens to be recorded.
  for (const [axis, values] of Object.entries(strataCounts(manifest))) {
    const present = Object.entries(values).filter(([, count]) => count > 0);
    if (present.length < 2) {
      problems.push({
        index: -1,
        message: `stratum "${axis}" has only ${String(present.length)} value(s) represented; the corpus cannot report accuracy across it`,
      });
    }
  }

  const sharedArt = manifest.entries.filter((entry) => entry.sharedArt).length;
  if (sharedArt < MIN_STRATUM) {
    problems.push({
      index: -1,
      message: `only ${String(sharedArt)} shared-art entries; the AC calls these out specifically as the case that caps printing-level accuracy`,
    });
  }

  return problems;
}

/**
 * The stratified axes, each with an explicit accessor.
 *
 * A lookup table rather than dynamic key access on `CorpusEntry`: indexing by
 * a computed key needs a cast back to `keyof CorpusEntry`, and the accessor
 * gives the same iteration for free while staying checked.
 */
const AXES: { name: string; values: readonly string[]; read: (entry: CorpusEntry) => string }[] = [
  { name: "condition", values: CORPUS_CONDITIONS, read: (entry) => entry.condition },
  { name: "finish", values: CORPUS_FINISHES, read: (entry) => entry.finish },
  { name: "sleeve", values: CORPUS_SLEEVES, read: (entry) => entry.sleeve },
  { name: "frame", values: CORPUS_FRAMES, read: (entry) => entry.frame },
  { name: "lighting", values: CORPUS_LIGHTING, read: (entry) => entry.lighting },
];

/** Counts per value on every stratum, for the coverage report. */
export function strataCounts(manifest: CorpusManifest): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const axis of AXES) {
    const counts: Record<string, number> = {};
    // Seeded with zeroes so an unrepresented value shows up as a gap rather
    // than being absent, which is the information the coverage table exists
    // to convey.
    for (const value of axis.values) counts[value] = 0;
    for (const entry of manifest.entries) {
      const key = axis.read(entry);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    result[axis.name] = counts;
  }

  result["sharedArt"] = {
    true: manifest.entries.filter((entry) => entry.sharedArt).length,
    false: manifest.entries.filter((entry) => !entry.sharedArt).length,
  };
  return result;
}

export function parseManifest(raw: unknown): CorpusManifest {
  return corpusManifestSchema.parse(raw);
}
