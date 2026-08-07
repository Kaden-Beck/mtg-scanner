import { type Condition, conditionSchema, type Finish, finishSchema } from "@mtg/schemas";
import { z } from "zod";

/**
 * Client-side bulk scan session (KAD-49). Persisted in sessionStorage so a
 * refresh mid-box keeps the running list; full DB sessions are KAD-50.
 */

export const SCAN_SESSION_STORAGE_KEY = "mtg.scan.session.v1";

export type FinishDefault = Finish | "auto";

export interface ScanSessionDefaults {
  readonly condition: Condition;
  /** `auto` = foil heuristic / confirm override wins each card. */
  readonly finish: FinishDefault;
  readonly binderLocation: string;
}

export interface ScanSessionEntry {
  readonly id: string;
  readonly collectionItemId: string;
  readonly scryfallId: string;
  readonly name: string;
  readonly setCode: string;
  readonly collectorNumber: string;
  readonly finish: Finish;
  readonly condition: Condition;
  readonly quantityDelta: number;
  readonly committedAt: string;
}

export interface ScanSessionState {
  readonly defaults: ScanSessionDefaults;
  readonly entries: readonly ScanSessionEntry[];
}

export const DEFAULT_SCAN_SESSION: ScanSessionState = {
  defaults: {
    condition: "NM",
    finish: "auto",
    binderLocation: "",
  },
  entries: [],
};

const finishDefaultSchema = z.union([z.literal("auto"), finishSchema]);

const scanSessionEntrySchema = z.object({
  id: z.string().min(1),
  collectionItemId: z.uuid(),
  scryfallId: z.uuid(),
  name: z.string(),
  setCode: z.string(),
  collectorNumber: z.string(),
  finish: finishSchema,
  condition: conditionSchema,
  quantityDelta: z.number().int().positive(),
  committedAt: z.string().min(1),
});

const scanSessionDefaultsSchema = z.object({
  condition: conditionSchema.default("NM"),
  finish: finishDefaultSchema.default("auto"),
  binderLocation: z.string().default(""),
});

const scanSessionStateSchema = z.object({
  defaults: scanSessionDefaultsSchema.default({
    condition: "NM",
    finish: "auto",
    binderLocation: "",
  }),
  entries: z
    .array(z.unknown())
    .default([])
    .transform((rows) => {
      const entries: ScanSessionEntry[] = [];
      for (const row of rows) {
        const parsed = scanSessionEntrySchema.safeParse(row);
        if (parsed.success) entries.push(parsed.data);
      }
      return entries;
    }),
});

export function parseScanSession(raw: unknown): ScanSessionState {
  const parsed = scanSessionStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SCAN_SESSION;
}

function readJson(text: string): unknown {
  return JSON.parse(text);
}

export function readScanSession(storage: Storage): ScanSessionState {
  try {
    const raw = storage.getItem(SCAN_SESSION_STORAGE_KEY);
    if (!raw) return DEFAULT_SCAN_SESSION;
    return parseScanSession(readJson(raw));
  } catch {
    return DEFAULT_SCAN_SESSION;
  }
}

export function writeScanSession(storage: Storage, state: ScanSessionState): void {
  storage.setItem(SCAN_SESSION_STORAGE_KEY, JSON.stringify(state));
}

export function withDefaults(
  state: ScanSessionState,
  patch: Partial<ScanSessionDefaults>,
): ScanSessionState {
  return {
    ...state,
    defaults: { ...state.defaults, ...patch },
  };
}

export function withEntryAppended(
  state: ScanSessionState,
  entry: ScanSessionEntry,
): ScanSessionState {
  return {
    ...state,
    entries: [entry, ...state.entries],
  };
}

export function withEntryRemoved(state: ScanSessionState, entryId: string): ScanSessionState {
  return {
    ...state,
    entries: state.entries.filter((e) => e.id !== entryId),
  };
}

/**
 * Prefer a sticky finish default when set; otherwise use the foil heuristic
 * suggestion from this capture.
 */
export function resolveCommitFinish(
  defaults: ScanSessionDefaults,
  foilLikely: boolean,
  confirmOverride?: Finish,
): Finish {
  if (confirmOverride) return confirmOverride;
  if (defaults.finish !== "auto") return defaults.finish;
  return foilLikely ? "foil" : "nonfoil";
}
