import { copyFileSync, existsSync, unlinkSync } from "node:fs";

/**
 * Copies a backup file over the live DB path. Must run with the app not
 * accepting writes (stop it first - see db:restore / README "Backup &
 * Restore"). Removes stale WAL/SHM sidecar files at the destination first,
 * since leaving old WAL frames next to a freshly-restored main file would
 * have them replayed on next open, silently reintroducing pre-restore
 * writes.
 */
export function restoreFromBackup(backupFilePath: string, dbPath: string): void {
  if (!existsSync(backupFilePath)) {
    throw new Error(`Backup file not found: ${backupFilePath}`);
  }

  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${dbPath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }

  copyFileSync(backupFilePath, dbPath);
}
