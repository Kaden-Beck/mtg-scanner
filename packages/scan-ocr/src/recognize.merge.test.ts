import { describe, expect, it } from "vitest";
import { mergeSplitParses } from "./recognize.ts";

describe("mergeSplitParses", () => {
  it("takes the number from the number line and set from the set line", () => {
    expect(
      mergeSplitParses(
        { setCode: null, collectorNumber: "0041", raw: "C 0041" },
        { setCode: "sos", collectorNumber: null, raw: "SOS" },
      ),
    ).toEqual({
      setCode: "sos",
      collectorNumber: "0041",
      raw: "C 0041 SOS",
    });
  });
});
