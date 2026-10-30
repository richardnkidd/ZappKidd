/**
 * Command-line scripts end to end against a temporary demo database (spawns tsx, so these are slower).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../src/server/app';
import { openDb } from '../../src/server/db/db';
import { Client, PASSWORD } from './helpers';

const ROOT = resolve(import.meta.dirname, '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
let dir: string;
let dbPath: string;

function run(script: string, args: string[] = [], opts: { input?: string; env?: Record<string, string> } = {}) {
  const res = spawnSync(TSX, [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: opts.input,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', KADODE_DATA_DIR: dir, KADODE_DB: dbPath, KADODE_MODE: 'local', ...opts.env },
    timeout: 60_000,
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kadode-cli-'));
  dbPath = join(dir, 'kadode-demo.db');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('scripts', () => {
  it('seed-demo creates a fresh demo database and refuses to overwrite without --reset', () => {
    const seeded = run('seed-demo.ts', ['--db', dbPath]);
    expect(seeded.status, seeded.out).toBe(0);
    expect(seeded.out).toMatch(/Demo database ready/);
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) AS n FROM records').get() as any).n).toBeGreaterThan(100);
    expect((db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_dev_identity = 1').get() as any).n).toBe(2);
    db.close();
    const again = run('seed-demo.ts', ['--db', dbPath]);
    expect(again.status).toBe(1);
    expect(again.out).toMatch(/--reset/);
    expect(run('seed-demo.ts', ['--db', dbPath, '--reset']).status).toBe(0);
    // Never resets a file that does not look like the demo.
    const real = join(dir, 'kadode.db');
    expect(run('seed-demo.ts', ['--db', real]).status).toBe(0);
    const refused = run('seed-demo.ts', ['--db', real, '--reset']);
    expect(refused.status).toBe(1);
    expect(refused.out).toMatch(/demo/);
    expect(existsSync(real)).toBe(true);
  }, 90_000);

  it('migrate reports the schema version', () => {
    const res = run('migrate.ts');
    expect(res.status, res.out).toBe(0);
    expect(res.out).toMatch(/schema version 2/);
  }, 30_000);

  it('set-password reads stdin, creates a login on request, and the password then works', async () => {
    const missing = run('set-password.ts', ['--username', 'nobody'], { input: `${PASSWORD}\n` });
    expect(missing.status).toBe(1);
    const short = run('set-password.ts', ['--username', 'avery-login', '--create', '--person', 'avery'], { input: 'short\n' });
    expect(short.status).toBe(1);
    expect(short.out).toMatch(/at least 12/);
    const ok = run('set-password.ts', ['--username', 'avery-login', '--create', '--person', 'avery'], { input: `${PASSWORD}\n` });
    expect(ok.status, ok.out).toBe(0);
    expect(ok.out).not.toContain(PASSWORD);

    const db = openDb(dbPath);
    const app = await buildApp({ db, mode: 'production', dataDir: dir, webRoot: null });
    try {
      const c = new Client(app);
      const res = await c.passwordLogin('avery-login');
      expect(res.status).toBe(200);
      expect(res.body.me.person.id).toBe('avery');
      expect((await c.get('/api/me')).status).toBe(200);
    } finally {
      await app.close();
      db.close();
    }
    const stored = new Database(dbPath, { readonly: true }).prepare("SELECT password_hash FROM users WHERE username = 'avery-login'").get() as { password_hash: string };
    expect(stored.password_hash.startsWith('scrypt$')).toBe(true);
    expect(stored.password_hash).not.toContain(PASSWORD);
  }, 60_000);

  it('disable-dev-identities switches them off', () => {
    const res = run('set-password.ts', ['--disable-dev-identities']);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toMatch(/Disabled 2/);
  }, 30_000);

  it('backup, export and restore round-trip', () => {
    const db = new Database(dbPath);
    const before = (db.prepare("SELECT title FROM records WHERE id = 'milestone:W06'").get() as any).title;
    db.close();
    const backup = run('backup.ts');
    expect(backup.status, backup.out).toBe(0);
    const name = readdirSync(join(dir, 'backups')).find((f) => f.endsWith('.db'))!;
    expect(name).toMatch(/^kadode-\d{8}T\d{6}Z\.db$/);
    expect(run('backup.ts', ['--list']).out).toContain(name);

    const changed = new Database(dbPath);
    changed.prepare("UPDATE records SET title = 'CHANGED' WHERE id = 'milestone:W06'").run();
    changed.close();

    const refused = run('restore.ts', [name]);
    expect(refused.status).toBe(2);
    expect(refused.out).toMatch(/--confirm RESTORE/);
    const restored = run('restore.ts', [name, '--confirm', 'RESTORE']);
    expect(restored.status, restored.out).toBe(0);
    expect(restored.out).toMatch(/Pre-restore backup/);
    const after = new Database(dbPath, { readonly: true });
    expect((after.prepare("SELECT title FROM records WHERE id = 'milestone:W06'").get() as any).title).toBe(before);
    after.close();
    expect(run('restore.ts', ['../etc/passwd', '--confirm', 'RESTORE']).status).not.toBe(0);

    const out = join(dir, 'export-out');
    const exp = run('export.ts', ['--out', out]);
    expect(exp.status, exp.out).toBe(0);
    const json = JSON.parse(readFileSync(join(out, 'kadode-export.json'), 'utf8'));
    expect(json.export.app).toBe('kadode');
    expect(json.records.length).toBeGreaterThan(100);
    expect(existsSync(join(out, 'milestone.csv'))).toBe(true);
    expect(readFileSync(join(out, 'cost.csv'), 'utf8')).toContain('data.estimate.amount');
  }, 120_000);
});
