import type { RgbaImage } from "./image.ts";

/**
 * Cheap foil heuristic: specular glare on foils raises local brightness
 * variance and desaturates hue coherence in the art region. No ML.
 *
 * Returns true when the sampled art window looks foil-like. Tuned to be
 * slightly aggressive — false foil is cheaper than missing a foil (the
 * user can override finish before commit).
 */
export function detectFoilCard(image: RgbaImage): boolean {
  // Sample the central art window (avoid frame chrome and CN strip).
  const x0 = Math.floor(image.width * 0.12);
  const x1 = Math.floor(image.width * 0.88);
  const y0 = Math.floor(image.height * 0.18);
  const y1 = Math.floor(image.height * 0.62);
  if (x1 <= x0 || y1 <= y0) return false;

  let count = 0;
  let sumL = 0;
  let sumL2 = 0;
  let sumSat = 0;
  let hot = 0;

  // Subsample for speed — every 4th pixel is enough for a variance signal.
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i] ?? 0;
      const g = image.data[i + 1] ?? 0;
      const b = image.data[i + 2] ?? 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const sat = max === 0 ? 0 : (max - min) / max;
      sumL += l;
      sumL2 += l * l;
      sumSat += sat;
      if (l > 220 && sat < 0.25) hot += 1;
      count += 1;
    }
  }

  if (count < 16) return false;
  const meanL = sumL / count;
  const variance = sumL2 / count - meanL * meanL;
  const meanSat = sumSat / count;
  const hotFraction = hot / count;

  // Foils: bright specular speckles (hotFraction) and/or high luminance
  // variance with depressed average saturation.
  return hotFraction >= 0.04 || (variance >= 2800 && meanSat <= 0.45);
}

export type PreprocessMode = "normal" | "foil";

export function preprocessModeFor(image: RgbaImage): PreprocessMode {
  return detectFoilCard(image) ? "foil" : "normal";
}
