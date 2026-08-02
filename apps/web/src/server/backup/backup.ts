import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { getSqlite } from "../db/client";

// Mirrors db/client.ts's own DATABASE_PATH resolution - duplicated rather
// than imported (same as db/migrate.ts does), since process.cwd() must be
// read fresh here rather than captured at db/client.ts's module-load time.
function resolveDbPath(): string {
  return process.env["DATABASE_PATH"] ?? path.join(process.cwd(), "data", "mtg.db");
}

function resolveBackupDir(): string {
  return process.env["BACKUP_DIR"] ?? path.join(path.dirname(resolveDbPath()), "backups");
}

export interface BackupResult {
  filePath: string;
  fileSizeBytes: number;
  durationMs: number;
}

/**
 * Uses better-sqlite3's `.backup()`, a wrapper around SQLite's own online
 * backup API - safe to run against a live, writable database (AC1:
 * "without stopping the app"), unlike copying the file directly which could
 * capture a torn write mid-transaction. Produces a single self-contained
 * file that needs no WAL/SHM sidecar files to be valid.
 */
export async function runBackup(): Promise<BackupResult> {
  const dir = resolveBackupDir();
  mkdirSync(dir, { recursive: true });

  const fileName = `mtg-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const filePath = path.join(dir, fileName);

  const start = Date.now();
  await getSqlite().backup(filePath);
  const durationMs = Date.now() - start;

  const fileSizeBytes = statSync(filePath).size;
  return { filePath, fileSizeBytes, durationMs };
}
