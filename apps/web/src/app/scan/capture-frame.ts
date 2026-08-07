/**
 * Map the on-screen scan guide back into camera pixels.
 *
 * The preview uses CSS `object-cover` inside a 3:4 box plus an inset guide.
 * `HTMLVideoElement` pixel buffers are the raw sensor frame — grabbing
 * `videoWidth`×`videoHeight` ignores both, so OCR crops land on artist /
 * language / rarity chrome instead of the collector-number strip.
 */

/** Must match the guide overlay (`inset-[8%]` / style inset). */
export const SCAN_GUIDE_INSET = 0.08;

export interface SourceRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/**
 * Source crop that `object-fit: cover` would show in a dest box of size
 * `destW`×`destH`.
 */
export function objectCoverSourceRect(
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
): SourceRect {
  if (sourceW <= 0 || sourceH <= 0 || destW <= 0 || destH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(1, sourceW), sh: Math.max(1, sourceH) };
  }
  const sourceRatio = sourceW / sourceH;
  const destRatio = destW / destH;
  if (sourceRatio > destRatio) {
    const sw = sourceH * destRatio;
    return { sx: (sourceW - sw) / 2, sy: 0, sw, sh: sourceH };
  }
  const sh = sourceW / destRatio;
  return { sx: 0, sy: (sourceH - sh) / 2, sw: sourceW, sh };
}

/** Cover rect, then shrink by a uniform inset (guide frame). */
export function guideSourceRect(
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
  inset: number = SCAN_GUIDE_INSET,
): SourceRect {
  const cover = objectCoverSourceRect(sourceW, sourceH, destW, destH);
  const t = Math.min(0.45, Math.max(0, inset));
  return {
    sx: cover.sx + cover.sw * t,
    sy: cover.sy + cover.sh * t,
    sw: cover.sw * (1 - 2 * t),
    sh: cover.sh * (1 - 2 * t),
  };
}

export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Sample the pixels inside the visible guide from a live `<video>`.
 * Falls back to the full frame when layout size is not ready yet.
 */
export function rgbaFromVideoGuide(
  video: HTMLVideoElement,
  inset: number = SCAN_GUIDE_INSET,
): RgbaFrame {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  const destW = video.clientWidth || sourceW;
  const destH = video.clientHeight || sourceH;
  const { sx, sy, sw, sh } = guideSourceRect(sourceW, sourceH, destW, destH, inset);

  const width = Math.max(1, Math.round(sw));
  const height = Math.max(1, Math.round(sh));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}
