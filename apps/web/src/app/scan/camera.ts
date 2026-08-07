/**
 * Camera device selection helpers for the scanner (KAD-38).
 *
 * Pure enough to unit-test without a MediaStream: persistence is a storage
 * key + pick function; getUserMedia constraints are built separately.
 */

export const SCAN_VIDEO_DEVICE_STORAGE_KEY = "mtg-scan-video-device-id";

export function readStoredDeviceId(storage: Pick<Storage, "getItem">): string | null {
  return storage.getItem(SCAN_VIDEO_DEVICE_STORAGE_KEY);
}

export function writeStoredDeviceId(storage: Pick<Storage, "setItem">, deviceId: string): void {
  storage.setItem(SCAN_VIDEO_DEVICE_STORAGE_KEY, deviceId);
}

export function listVideoInputs(devices: readonly MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter((d) => d.kind === "videoinput");
}

/**
 * Prefer the stored device when still present; otherwise leave selection to
 * the browser (rear camera via facingMode on the initial getUserMedia).
 */
export function pickVideoDeviceId(
  devices: readonly MediaDeviceInfo[],
  storedId: string | null,
): string | null {
  const videos = listVideoInputs(devices);
  if (storedId && videos.some((d) => d.deviceId === storedId)) {
    return storedId;
  }
  return null;
}

export function buildVideoConstraints(deviceId: string | null): MediaTrackConstraints {
  if (deviceId) {
    return { deviceId: { exact: deviceId } };
  }
  // AC1: rear camera by default on phones.
  return { facingMode: { ideal: "environment" } };
}
