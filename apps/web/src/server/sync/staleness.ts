// Split out from status.ts so this is unit-testable without pulling in
// db/client.ts (which opens a real sqlite connection at module-evaluation
// time) - see sync-status-format.ts for the same "extract the pure part"
// pattern.

// AC2: prices displayed more than 24h after the last successful sync must
// be visibly marked stale - bulk prices update at most once daily upstream,
// so anything older than that is dangerously out of date.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isStale(lastSyncedAt: Date | null, now: Date): boolean {
  if (!lastSyncedAt) return false;
  return now.getTime() - lastSyncedAt.getTime() > STALE_AFTER_MS;
}
