/**
 * Restore the database from a backup. Usage: npm run restore -- <backup name or path> --confirm RESTORE
 * A pre-restore backup of the current database is taken first. Stop the server before restoring from the CLI.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { openDb } from '../src/server/db/db';
import { resolveBackupPath, restoreBackup } from '../src/server/domain/backup-service';
import { dataDirFromEnv, dbPathFromEnv, flagString, parseArgs } from './_cli';

const { flags, positional } = parseArgs(process.argv.slice(2));
const target = positional[0];
if (!target) {
  console.error('Usage: npm run restore -- <backup file name or path> --confirm RESTORE');
  process.exit(2);
}
if (flagString(flags, 'confirm') !== 'RESTORE') {
  console.error('Restoring replaces the current database. Re-run with --confirm RESTORE to proceed.');
  process.exit(2);
}
const dataDir = dataDirFromEnv();
const backupPath = target.includes('/') || isAbsolute(target) ? resolve(target) : resolveBackupPath(dataDir, target);
if (!existsSync(backupPath)) {
  console.error(`Backup not found: ${backupPath}`);
  process.exit(1);
}
const db = openDb(dbPathFromEnv());
try {
  const result = await restoreBackup(db, { dataDir, backupPath, actor: null, now: new Date() });
  console.log(`Restored from ${result.restored_from}${result.schema_migrated ? ' (older schema migrated)' : ''}.`);
  console.log(`Pre-restore backup of the previous state: ${result.pre_restore_backup}`);
} finally {
  db.close();
}
