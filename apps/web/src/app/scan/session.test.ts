import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_SESSION,
  parseScanSession,
  resolveCommitFinish,
  withDefaults,
  withEntryAppended,
  withEntryRemoved,
} from "./session";

describe("parseScanSession", () => {
  it("returns defaults for garbage input", () => {
    expect(parseScanSession(null)).toEqual(DEFAULT_SCAN_SESSION);
    expect(parseScanSession("nope")).toEqual(DEFAULT_SCAN_SESSION);
  });

  it("keeps valid entries and drops broken ones", () => {
    const parsed = parseScanSession({
      defaults: { condition: "LP", finish: "foil", binderLocation: "box-1" },
      entries: [
        {
          id: "a",
          collectionItemId: "0000419b-0bba-4488-8f7a-6194544ce91e",
          scryfallId: "0000419b-0bba-4488-8f7a-6194544ce91e",
          name: "Forest",
          setCode: "blb",
          collectorNumber: "280",
          finish: "foil",
          condition: "LP",
          quantityDelta: 1,
          committedAt: "2026-08-07T00:00:00.000Z",
        },
        { id: "bad" },
      ],
    });
    expect(parsed.defaults).toEqual({
      condition: "LP",
      finish: "foil",
      binderLocation: "box-1",
    });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.name).toBe("Forest");
  });
});

describe("session reducers", () => {
  it("updates defaults and list entries", () => {
    let state = withDefaults(DEFAULT_SCAN_SESSION, { condition: "MP", binderLocation: "A1" });
    expect(state.defaults.condition).toBe("MP");
    const entry = {
      id: "e1",
      collectionItemId: "0000419b-0bba-4488-8f7a-6194544ce91e",
      scryfallId: "0000419b-0bba-4488-8f7a-6194544ce91e",
      name: "Forest",
      setCode: "blb",
      collectorNumber: "280",
      finish: "nonfoil" as const,
      condition: "MP" as const,
      quantityDelta: 1,
      committedAt: "2026-08-07T00:00:00.000Z",
    };
    state = withEntryAppended(state, entry);
    expect(state.entries).toHaveLength(1);
    state = withEntryRemoved(state, "e1");
    expect(state.entries).toHaveLength(0);
  });
});

describe("resolveCommitFinish", () => {
  it("uses auto foil heuristic when finish default is auto", () => {
    expect(resolveCommitFinish(DEFAULT_SCAN_SESSION.defaults, true)).toBe("foil");
    expect(resolveCommitFinish(DEFAULT_SCAN_SESSION.defaults, false)).toBe("nonfoil");
  });

  it("prefers sticky finish default over heuristic", () => {
    const defaults = { ...DEFAULT_SCAN_SESSION.defaults, finish: "etched" as const };
    expect(resolveCommitFinish(defaults, true)).toBe("etched");
  });

  it("lets the confirm override win", () => {
    const defaults = { ...DEFAULT_SCAN_SESSION.defaults, finish: "foil" as const };
    expect(resolveCommitFinish(defaults, false, "nonfoil")).toBe("nonfoil");
  });
});
