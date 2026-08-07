import { describe, expect, it } from "vitest";
import { activeRecognizer, registerRecognizer } from "./recognizer-registry.ts";

describe("recognizer-registry", () => {
  it("starts empty and accepts a registration", () => {
    registerRecognizer(null);
    expect(activeRecognizer()).toBeNull();

    const stub = () => Promise.resolve({ candidates: [], tier: "T2" as const });
    registerRecognizer(stub);
    expect(activeRecognizer()).toBe(stub);

    registerRecognizer(null);
    expect(activeRecognizer()).toBeNull();
  });
});
