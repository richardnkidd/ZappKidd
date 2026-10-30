/**
 * SQLite connection + migrations. Shared by the server, the importer and CLI scripts.
 * OWNER: backend agent (initial version by lead).
 */
import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync, existsSync, chmodSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Default database path. Real data lives under the gitignored private/ directory. */
export function defaultDbPath(): string {
  return process.env.KADODE_DB ?? join(process.cwd(), 'private', 'data', 'kadode.db');
}

/**
 * Create `dir` with mode 0700 and tighten an existing one to 0700, except the home directory, the filesystem root and
 * the system temp directory (never change those).
 */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const full = resolve(dir);
  if (full === resolve(homedir()) || full === resolve(tmpdir()) || full === dirname(full)) return;
  try {
    if ((statSync(full).mode & 0o077) !== 0) chmodSync(full, 0o700);
  } catch {
    // not ours to change; the files inside are 0600 anyway
  }
}

export interface OpenOptions {
  /** Fail instead of creating the file (backup, restore, export and password scripts must never invent a database). */
  mustExist?: boolean;
}

/**
 * Open (and migrate) the database. New files are created private: directories 0700, database and WAL/SHM 0600
 * (existing database files are tightened to 0600 too).
 */
export function openDb(path: string = defaultDbPath(), opts: OpenOptions = {}): Db {
  if (path !== ':memory:') {
    if (opts.mustExist && !existsSync(path)) {
      throw new Error(`No database at ${path}. Check KADODE_DB and KADODE_MODE (a new empty database is never created by this command).`);
    }
    ensurePrivateDir(dirname(path));
  }
  const db = new Database(path, opts.mustExist ? { fileMustExist: true } : undefined);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  if (path !== ':memory:') {
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      try {
        chmodSync(f, 0o600);
      } catch {
        // the -wal/-shm files may not exist yet; that is fine
      }
    }
  }
  return db;
}

/** Number of households and records, for CLI sanity output. */
export function describeDb(db: Db): { households: number; records: number } {
  const h = db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number };
  const r = db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number };
  return { households: h.n, records: r.n };
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
