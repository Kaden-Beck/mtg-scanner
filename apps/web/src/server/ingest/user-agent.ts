/**
 * Scryfall flags library-default User-Agents (e.g. bare "node-fetch") as
 * junk traffic and blocks it (KAD-8 AC5). Every request to their API or CDN
 * must carry this.
 */
export const SCRYFALL_REQUEST_HEADERS: HeadersInit = {
  "User-Agent": "MTGScannerApp/0.1 (+https://github.com/kadenb12/mtg-scanner)",
  Accept: "application/json",
};
