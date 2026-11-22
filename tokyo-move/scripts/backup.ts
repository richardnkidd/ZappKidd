/** Back up the database. Usage: npm run backup [-- --list]. Fails if the database does not exist or is empty. */
import { createBackup, listBackups } from '../src/server/domain/backup-service';
import { cliMain, dataDirFromEnv, openExistingDb, parseArgs } from './_cli';

await cliMain(async () => {
  const { flags } = parseArgs(process.argv.slice(2));
  const dataDir = dataDirFromEnv();

  if (flags.has('list')) {
    const list = listBackups(dataDir);
    if (list.length === 0) console.log('No backups yet.');
    for (const b of list) console.log(`${b.name}  ${b.bytes} bytes  ${b.created_at}`);
    return;
  }
  const { db, path, households, records } = openExistingDb();
  try {
    const info = await createBackup(db, dataDir, new Date());
    console.log(`Backed up ${path} (${households} household(s), ${records} record(s))`);
    console.log(`Backup written: ${dataDir}/backups/${info.name} (${info.bytes} bytes, integrity ${info.integrity})`);
  } finally {
    db.close();
  }
});
