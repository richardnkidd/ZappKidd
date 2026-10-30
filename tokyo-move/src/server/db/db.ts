/**
 * SQLite connection + migrations. Shared by the server, the importer and CLI scripts.
 * OWNER: backend agent (initial version by lead).
 */
import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Default database path. Real data lives under the gitignored private/ directory. */
export function defaultDbPath(): string {
  return process.env.KADODE_DB ?? join(process.cwd(), 'private', 'data', 'kadode.db');
}

export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: Db): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  const ran: number[] = [];
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(
      /CREATE TABLE IF NOT EXISTS schema_migrations[\s\S]*?\);/,
      '',
    );
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        file,
        new Date().toISOString(),
      );
    })();
    ran.push(version);
  }
  return ran;
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

/** Highest migration version shipped with this build. */
export function latestMigrationVersion(): number {
  return Math.max(
    0,
    ...readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.+\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 3))),
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}
