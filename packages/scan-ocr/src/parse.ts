/**
 * Parse OCR text from a collector-number strip into set code + number.
 *
 * Scryfall collector numbers are text ("168a", "★12", leading zeroes). Set
 * codes are 3–5 alphanumerics. Patterns seen in the wild:
 *   "FDN U 0125", "123/456 SET", "MH2 250", "0125"
 *   "C 0041" / "SOS EN Erin Fong"  (modern two-line strip)
 */

export interface ParsedCollectorNumber {
  readonly setCode: string | null;
  readonly collectorNumber: string | null;
  readonly raw: string;
}

const KEYWORD_FALSE_POSITIVES = new Set([
  "sacrifice",
  "destroy",
  "exile",
  "creatures",
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "planeswalker",
  "battlefield",
  "target",
  "player",
]);

const RARITY_LETTERS = new Set(["C", "U", "R", "M", "L", "S", "P", "T", "B"]);

/** Printed on the CN strip next to the set; never a set code. */
const LANGUAGE_CODES = new Set([
  "en",
  "jp",
  "ja",
  "de",
  "fr",
  "it",
  "es",
  "pt",
  "ko",
  "ru",
  "zhs",
  "zht",
  "ph",
  "qya",
  "eng",
]);

const SET_LIKE = /^[A-Za-z0-9]{3,5}$/;
const SET_TOKEN = /^[A-Za-z]{2,5}\d{0,2}$/;
const DIGITS_ONLY = /^\d+$/;
const COLLECTOR_TOKEN = /^\d{1,5}[a-zA-Z★†]?$/;
const STAR_COLLECTOR = /^\d+[★†]$/;
const SLASH_PATTERN = /\b(\d{1,5}[a-zA-Z★†]?)\s*\/\s*\d{1,5}\b/;
const BARE_NUMBER = /\b(\d{1,5}[a-zA-Z★†]?)\b/;

function isLanguageCode(token: string): boolean {
  return LANGUAGE_CODES.has(token.toLowerCase());
}

function isSetCandidate(token: string): boolean {
  if (DIGITS_ONLY.test(token)) return false;
  if (RARITY_LETTERS.has(token.toUpperCase()) && token.length === 1) return false;
  if (isLanguageCode(token)) return false;
  if (!SET_TOKEN.test(token) && !SET_LIKE.test(token)) return false;
  return token.length >= 3 && token.length <= 5;
}

/** Strip junk OCR often invents around the CN strip. */
export function sanitizeOcrText(raw: string): string {
  return raw
    .replace(/[|\]{}()<>"'`,;:~•·]/g, " ")
    .replace(/[^\w\s/*★†]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRejectedOcrText(raw: string): boolean {
  // Truncation markers must be checked on the raw string — sanitize strips `.`.
  if (raw.includes("..")) return true;
  const cleaned = sanitizeOcrText(raw);
  if (cleaned.length < 3 || cleaned.length > 40) return true;
  const lower = cleaned.toLowerCase();
  for (const word of KEYWORD_FALSE_POSITIVES) {
    if (lower.includes(word)) return true;
  }
  return false;
}

/**
 * Best-effort parse. Returns null fields when a component cannot be read;
 * callers decide whether that is enough to look up.
 */
export function parseCollectorNumber(raw: string): ParsedCollectorNumber {
  if (isRejectedOcrText(raw)) {
    return { setCode: null, collectorNumber: null, raw: sanitizeOcrText(raw) };
  }

  const cleaned = sanitizeOcrText(raw);
  const tokens = cleaned.split(" ").filter(Boolean);

  // Pattern: "123/456 SET" or "123/456"
  const slash = SLASH_PATTERN.exec(cleaned);
  if (slash?.[1]) {
    const setFromEnd = tokens.find((t) => isSetCandidate(t));
    return {
      setCode: setFromEnd ? setFromEnd.toLowerCase() : null,
      collectorNumber: slash[1],
      raw: cleaned,
    };
  }

  let setCode: string | null = null;
  let collectorNumber: string | null = null;

  for (const t of tokens) {
    if (setCode === null && isSetCandidate(t)) {
      setCode = t.toLowerCase();
    }
    if (COLLECTOR_TOKEN.test(t) || STAR_COLLECTOR.test(t)) {
      // Prefer the longest digit run (0041 over a stray "1").
      if (
        collectorNumber === null ||
        t.replace(/\D/g, "").length > collectorNumber.replace(/\D/g, "").length
      ) {
        collectorNumber = t;
      }
    }
  }

  if (collectorNumber === null) {
    const bare = BARE_NUMBER.exec(cleaned);
    if (bare?.[1]) collectorNumber = bare[1];
  }

  if (setCode === null) {
    for (const t of tokens) {
      if (isSetCandidate(t)) {
        setCode = t.toLowerCase();
        break;
      }
    }
  }

  return { setCode, collectorNumber, raw: cleaned };
}

/** Clean a title-bar OCR string into a plausible card name. */
export function sanitizeCardName(raw: string): string | null {
  const cleaned = raw
    .replace(/[|\]{}()<>"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  const lower = cleaned.toLowerCase();
  for (const word of KEYWORD_FALSE_POSITIVES) {
    if (lower === word) return null;
  }
  // Titles are words; reject pure digit noise from a bad crop.
  if (/^\d+$/.test(cleaned)) return null;
  return cleaned;
}
