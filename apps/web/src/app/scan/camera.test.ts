import { describe, expect, it } from "vitest";
import {
  buildVideoConstraints,
  listVideoInputs,
  pickVideoDeviceId,
  readStoredDeviceId,
  SCAN_VIDEO_DEVICE_STORAGE_KEY,
  writeStoredDeviceId,
} from "./camera";

function fakeDevice(kind: MediaDeviceKind, deviceId: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: "g",
    kind,
    label: deviceId,
    toJSON: () => ({}),
  };
}

describe("camera device helpers", () => {
  it("persists the selected device id", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    writeStoredDeviceId(storage, "cam-2");
    expect(readStoredDeviceId(storage)).toBe("cam-2");
    expect(store.get(SCAN_VIDEO_DEVICE_STORAGE_KEY)).toBe("cam-2");
  });

  it("lists only video inputs", () => {
    const devices = [
      fakeDevice("audioinput", "a"),
      fakeDevice("videoinput", "v1"),
      fakeDevice("videoinput", "v2"),
    ];
    expect(listVideoInputs(devices).map((d) => d.deviceId)).toEqual(["v1", "v2"]);
  });

  it("reuses a stored device when still present", () => {
    const devices = [fakeDevice("videoinput", "v1"), fakeDevice("videoinput", "v2")];
    expect(pickVideoDeviceId(devices, "v2")).toBe("v2");
    expect(pickVideoDeviceId(devices, "gone")).toBeNull();
  });

  it("asks for a high-res environment camera when no device is stored", () => {
    expect(buildVideoConstraints(null)).toEqual({
      facingMode: { ideal: "environment" },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    });
    expect(buildVideoConstraints("v1")).toEqual({
      deviceId: { exact: "v1" },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    });
  });
});
