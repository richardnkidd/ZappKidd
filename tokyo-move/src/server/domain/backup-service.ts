/**
 * Backup and restore of the SQLite database.
 * - backup: better-sqlite3 online backup into <dataDir>/backups/kadode-<UTC timestamp>.db, then integrity_check on the copy.
 * - restore: validate name/integrity/schema (migrating a temp copy if older), take a pre-restore backup, then replace
 *   table contents in-process inside ONE transaction (ATTACH; per table DELETE + INSERT SELECT; DETACH).
 *   Sessions are kept except those whose user no longer exists after the restore.
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, chmodSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { Db } from '../db/db';
import { latestMigrationVersion, migrate } from '../db/db';
import { HttpError, validationError } from '../http/errors';
import { appendAudit } from './audit';

export const BACKUP_NAME = /^kadode-\d{8}T\d{6}Z(-\d{2})?(-pre-restore)?\.db$/;

export interface BackupInfo {
  name: string;
  bytes: number;
  created_at: string;
  integrity?: 'ok';
}

export function backupsDir(dataDir: string): string {
  return join(dataDir, 'backups');
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Resolve a backup file name to a path inside the backups directory; rejects anything that is not a plain name. */
export function resolveBackupPath(dataDir: string, name: string): string {
  if (typeof name !== 'string' || basename(name) !== name || !BACKUP_NAME.test(name)) {
    throw validationError('Invalid backup name', [{ path: 'backup', message: 'Expected a file name like kadode-20261029T120000Z.db' }]);
  }
  const dir = resolve(backupsDir(dataDir));
  const full = resolve(dir, name);
  if (!full.startsWith(dir + sep)) throw validationError('Invalid backup name', [{ path: 'backup', message: 'Not inside the backups directory' }]);
  if (!existsSync(full)) throw new HttpError(404, 'not_found', 'Backup not found');
  return full;
}

export function integrityCheck(path: string): string[] {
  const conn = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = conn.pragma('integrity_check') as { integrity_check: string }[];
    return rows.map((r) => r.integrity_check);
  } finally {
    conn.close();
  }
}

export async function createBackup(db: Db, dataDir: string, now: Date, kind: 'manual' | 'pre-restore' = 'manual'): Promise<BackupInfo> {
  const dir = backupsDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = `kadode-${stamp(now)}`;
  const suffix = kind === 'pre-restore' ? '-pre-restore' : '';
  let name = `${base}${suffix}.db`;
  for (let n = 1; existsSync(join(dir, name)); n += 1) {
    if (n > 99) throw new Error('too many backups in the same second');
    name = `${base}-${String(n).padStart(2, '0')}${suffix}.db`;
  }
  const dest = join(dir, name);
  try {
    await db.backup(dest);
    // Make the copy a single self-contained file, then verify it.
    const conn = new Database(dest);
    try {
      conn.pragma('journal_mode = DELETE');
      const rows = conn.pragma('integrity_check') as { integrity_check: string }[];
      if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('integrity_check failed on the backup copy');
    } finally {
      conn.close();
    }
    chmodSync(dest, 0o600);
  } catch (e) {
    rmSync(dest, { force: true });
    rmSync(`${dest}-wal`, { force: true });
    rmSync(`${dest}-shm`, { force: true });
    throw e;
  }
  return { name, bytes: statSync(dest).size, created_at: now.toISOString(), integrity: 'ok' };
}

export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupsDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => BACKUP_NAME.test(f))
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, bytes: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

export interface RestoreActor {
  householdId: string;
  personId: string;
  tokenHash?: string;
}

export interface RestoreResult {
  restored_from: string;
  pre_restore_backup: string;
  schema_migrated: boolean;
  tables: number;
  /** true when the caller's own session no longer exists after the restore (they must sign in again) */
  session_invalidated: boolean;
}

const SKIP_TABLES = new Set(['schema_migrations', 'sessions']);
const q = (id: string) => `"${id.replaceAll('"', '""')}"`;

export async function restoreBackup(
  db: Db,
  opts: { dataDir: string; backupPath: string; actor: RestoreActor | null; now: Date },
): Promise<RestoreResult> {
  const { dataDir, backupPath, actor, now } = opts;
  mkdirSync(dataDir, { recursive: true });
  const work = mkdtempSync(join(dataDir, '.restore-'));
  try {
    // 1. Validate a temp copy (never the original): integrity, schema version, migrate if older.
    const candidate = join(work, 'candidate.db');
    copyFileSync(backupPath, candidate);
    let migrated = false;
    let conn: Database.Database;
    try {
      conn = new Database(candidate);
      conn.pragma('integrity_check');
    } catch {
      throw validationError('The backup could not be read as a database', [{ path: 'backup', message: 'Not a readable SQLite file' }]);
    }
    try {
      const check = conn.pragma('integrity_check') as { integrity_check: string }[];
      if (check.length !== 1 || check[0]?.integrity_check !== 'ok') {
        throw validationError('The backup failed its integrity check', [{ path: 'backup', message: 'integrity_check did not return ok' }]);
      }
      const hasMigrations = conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
      const version = hasMigrations ? ((conn.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0) : 0;
      if (version === 0) throw validationError('Not a Kadode backup', [{ path: 'backup', message: 'No schema version found' }]);
      const latest = latestMigrationVersion();
      if (version > latest) {
        throw validationError('The backup was made by a newer version of Kadode', [{ path: 'backup', message: `Backup schema ${version} is newer than this build (${latest})` }]);
      }
      if (version < latest) {
        migrate(conn);
        migrated = true;
      }
      conn.pragma('journal_mode = DELETE');
    } finally {
      conn.close();
    }

    // 2. Safety net: a backup of the live database first.
    const pre = await createBackup(db, dataDir, now, 'pre-restore');

    // 3. Replace contents in one transaction.
    db.prepare('ATTACH DATABASE ? AS restore_src').run(candidate);
    let tableCount = 0;
    try {
      const mainTables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
        .map((r) => r.name)
        .filter((n) => !SKIP_TABLES.has(n));
      db.transaction(() => {
        db.pragma('defer_foreign_keys = ON');
        for (const t of mainTables) {
          const mainCols = (db.prepare(`PRAGMA main.table_info(${q(t)})`).all() as { name: string }[]).map((c) => c.name);
          const srcCols = new Set((db.prepare(`PRAGMA restore_src.table_info(${q(t)})`).all() as { name: string }[]).map((c) => c.name));
          const cols = mainCols.filter((c) => srcCols.has(c));
          db.exec(`DELETE FROM main.${q(t)}`);
          if (srcCols.size > 0) {
            const list = cols.map(q).join(', ');
            db.exec(`INSERT INTO main.${q(t)} (${list}) SELECT ${list} FROM restore_src.${q(t)}`);
          }
          tableCount += 1;
        }
        db.exec('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)');
        if (actor) {
          const hh = db.prepare('SELECT 1 FROM households WHERE id = ?').get(actor.householdId);
          if (hh) {
            appendAudit(db, {
              householdId: actor.householdId,
              at: now.toISOString(),
              actor: actor.personId,
              recordId: null,
              action: 'restore',
              before: null,
              after: { restored_from: basename(backupPath), pre_restore_backup: pre.name },
              reason: 'Database restored from backup',
            });
          }
        }
      })();
    } finally {
      db.exec('DETACH DATABASE restore_src');
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    const invalidated = actor?.tokenHash
      ? db.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get(actor.tokenHash) === undefined
      : false;
    return {
      restored_from: basename(backupPath),
      pre_restore_backup: pre.name,
      schema_migrated: migrated,
      tables: tableCount,
      session_invalidated: invalidated,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
