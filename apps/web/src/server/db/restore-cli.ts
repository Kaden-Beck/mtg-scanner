import path from "node:path";
// `--experimental-strip-types` needs the explicit `.ts` extension on
// relative specifiers - Node's ESM loader doesn't do TS-style extensionless
// resolution the way tsc/vitest do. Confirmed by actually running this
// script (ERR_MODULE_NOT_FOUND without it); migrate.ts never hit this
// because it has no relative imports at all.
import { restoreFromBackup } from "../backup/restore.ts";

/**
 * Standalone restore script (KAD-15), mirrors migrate.ts's CLI pattern.
 * Run with the app stopped (a live process holds the WAL file open, and
 * restoring underneath it would be overwritten on the next checkpoint):
 *
 *   node --experimental-strip-types src/server/db/restore-cli.ts <backup-file>
 */
const backupFilePath = process.argv[2];
if (!backupFilePath) {
  console.error("Usage: restore-cli.ts <backup-file-path>");
  process.exit(1);
}

const dbPath = process.env["DATABASE_PATH"] ?? path.join(process.cwd(), "data", "mtg.db");
restoreFromBackup(backupFilePath, dbPath);
console.log(`Restored ${backupFilePath} -> ${dbPath}`);
