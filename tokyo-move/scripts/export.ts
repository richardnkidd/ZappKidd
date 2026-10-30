/**
 * Export everything to JSON plus one CSV per record type (Sheets-ready).
 * Usage: npm run export [-- --out <dir>] [--household <id>] [--person <id>]
 * Without --person only household-visible records are exported; with --person that person's private records are included.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../src/server/db/db';
import { exportCsv, exportJson } from '../src/server/domain/export-service';
import { RECORD_TYPES } from '../src/server/domain/schemas';
import { cliContext, dbPathFromEnv, flagString, parseArgs } from './_cli';

const { flags } = parseArgs(process.argv.slice(2));
const db = openDb(dbPathFromEnv());
try {
  const households = db.prepare('SELECT id FROM households ORDER BY id').all() as { id: string }[];
  const householdId = flagString(flags, 'household') ?? households[0]?.id;
  if (!householdId) throw new Error('The database has no household yet.');
  if (!flagString(flags, 'household') && households.length > 1) throw new Error('Several households found; pass --household <id>.');
  const { deps, ctx } = cliContext(db, householdId, flagString(flags, 'person') ?? null);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const out = resolve(flagString(flags, 'out') ?? join('private', 'exports', stamp));
  mkdirSync(out, { recursive: true, mode: 0o700 });
  writeFileSync(join(out, 'kadode-export.json'), JSON.stringify(exportJson(deps, ctx), null, 2), { mode: 0o600 });
  let csvFiles = 0;
  for (const type of RECORD_TYPES) {
    const csv = exportCsv(deps, ctx, type);
    if (csv.split('\r\n').length <= 2) continue; // header only
    writeFileSync(join(out, `${type}.csv`), csv, { mode: 0o600 });
    csvFiles += 1;
  }
  console.log(`Exported to ${out} (1 JSON file, ${csvFiles} CSV files).`);
} finally {
  db.close();
}
