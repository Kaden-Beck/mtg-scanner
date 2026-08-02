import { z } from "zod";
import { SCRYFALL_REQUEST_HEADERS } from "./user-agent";

const bulkDataEntrySchema = z.object({
  type: z.string(),
  updated_at: z.string(),
  jsonl_download_uri: z.string(),
});

const bulkDataListSchema = z.object({
  data: z.array(bulkDataEntrySchema),
});

export interface BulkDataMeta {
  downloadUri: string;
  sourceUpdatedAt: string;
}

/**
 * Scryfall's bulk-data endpoint only exposes `jsonl_download_uri` now (no
 * plain-JSON `download_uri`) - confirmed against the live API 2026-08-02,
 * not assumed. Every bulk file is gzip-compressed JSONL.
 */
export async function fetchBulkDataMeta(
  bulkType: "default_cards",
  fetchImpl: typeof fetch = fetch,
): Promise<BulkDataMeta> {
  const response = await fetchImpl("https://api.scryfall.com/bulk-data", {
    headers: SCRYFALL_REQUEST_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`Scryfall /bulk-data returned ${String(response.status)}`);
  }
  const { data } = bulkDataListSchema.parse(await response.json());
  const entry = data.find((item) => item.type === bulkType);
  if (!entry) {
    throw new Error(`No bulk-data entry found for type "${bulkType}"`);
  }
  return { downloadUri: entry.jsonl_download_uri, sourceUpdatedAt: entry.updated_at };
}
