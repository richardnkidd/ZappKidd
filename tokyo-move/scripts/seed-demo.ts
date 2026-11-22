/**
 * Create a fresh fictional demo database: applyBundle(buildDemoBundle()) then development identities.
 * Usage: npm run seed:demo [-- --db <path>] [--reset]
 * Refuses to touch a database that already holds a household unless --reset is given AND the file name contains
 * "demo" (so real data can never be wiped by accident).
 */
import { existsSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { openDb } from '../src/server/db/db';
import { ensureDevIdentities } from '../src/server/auth/users';
import { FIXTURE_STORE_FILE } from '../src/server/tasks/fixture';
import { applyBundle } from '../src/import/apply';
import { buildDemoBundle } from '../fixtures/demo/bundle';
import { dataDirFromEnv, flagString, parseArgs } from './_cli';

const { flags } = parseArgs(process.argv.slice(2));
const dataDir = dataDirFromEnv();
const dbPath = flagString(flags, 'db') ?? join(dataDir, 'kadode-demo.db');
const reset = flags.has('reset');

if (existsSync(dbPath)) {
  if (!reset) {
    console.error(`${dbPath} already exists. Pass --reset to recreate it (only allowed for files with "demo" in the name).`);
    process.exit(1);
  }
  if (!basename(dbPath).toLowerCase().includes('demo')) {
    console.error(`Refusing to reset ${dbPath}: the file name does not contain "demo".`);
    process.exit(1);
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  rmSync(join(dirname(dbPath), FIXTURE_STORE_FILE), { force: true });
  rmSync(join(dataDir, FIXTURE_STORE_FILE), { force: true });
}

const db = openDb(dbPath);
const result = applyBundle(db, buildDemoBundle(), { actor: 'system' });
const households = db.prepare('SELECT id FROM households').all() as { id: string }[];
let identities = 0;
for (const h of households) identities += ensureDevIdentities(db, h.id).length;
console.log(`Demo database ready at ${dbPath}`);
console.log(`  import: ${result.status}, ${result.changes} change(s); development identities: ${identities}`);
db.close();
