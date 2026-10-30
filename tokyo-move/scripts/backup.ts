/** Back up the database. Usage: npm run backup [-- --list] */
import { openDb } from '../src/server/db/db';
import { createBackup, listBackups } from '../src/server/domain/backup-service';
import { dataDirFromEnv, dbPathFromEnv, parseArgs } from './_cli';

const { flags } = parseArgs(process.argv.slice(2));
const dataDir = dataDirFromEnv();

if (flags.has('list')) {
  const list = listBackups(dataDir);
  if (list.length === 0) console.log('No backups yet.');
  for (const b of list) console.log(`${b.name}  ${b.bytes} bytes  ${b.created_at}`);
} else {
  const db = openDb(dbPathFromEnv());
  try {
    const info = await createBackup(db, dataDir, new Date());
    console.log(`Backup written: ${dataDir}/backups/${info.name} (${info.bytes} bytes, integrity ${info.integrity})`);
  } finally {
    db.close();
  }
}
