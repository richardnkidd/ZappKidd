/**
 * Restore the database from a backup.
 *   npm run restore -- <backup name or path> --confirm RESTORE
 *   npm run restore -- <backup name or path> --confirm RESTORE-INCLUDING-USERS
 * A plain RESTORE keeps the CURRENT users and passwords (and refuses a backup that holds users or development identities
 * the current database lacks); RESTORE-INCLUDING-USERS replaces the users table from the backup. A pre-restore backup of
 * the current database is taken first. Stop the server before restoring from the CLI.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { resolveBackupPath, restoreBackup } from '../src/server/domain/backup-service';
import { cliMain, dataDirFromEnv, flagString, openExistingDb, parseArgs } from './_cli';

await cliMain(async () => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const target = positional[0];
  const confirm = flagString(flags, 'confirm');
  if (!target) {
    console.error('Usage: npm run restore -- <backup file name or path> --confirm RESTORE');
    process.exit(2);
  }
  if (confirm !== 'RESTORE' && confirm !== 'RESTORE-INCLUDING-USERS') {
    console.error('Restoring replaces the current database. Re-run with --confirm RESTORE (keeps current users) or --confirm RESTORE-INCLUDING-USERS.');
    process.exit(2);
  }
  const dataDir = dataDirFromEnv();
  const { db, path } = openExistingDb({ allowEmpty: true }); // first: a missing database is the more fundamental problem
  try {
    const backupPath = target.includes('/') || isAbsolute(target) ? resolve(target) : resolveBackupPath(dataDir, target);
    if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);
    const result = await restoreBackup(db, { dataDir, backupPath, actor: null, now: new Date(), includeUsers: confirm === 'RESTORE-INCLUDING-USERS' });
    console.log(`Restored ${path} from ${result.restored_from}${result.schema_migrated ? ' (older schema migrated)' : ''}.`);
    console.log(`Pre-restore backup of the previous state: ${result.pre_restore_backup}`);
    console.log('All sessions were ended; everyone must sign in again.');
  } finally {
    db.close();
  }
});
