import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvCell } from '../../src/server/domain/export-service';
import { latestMigrationVersion } from '../../src/server/db/db';
import { Client, countRows, givePassword, loginAs, makeHarness, recordRow, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

/** Minimal RFC 4180 parser for assertions. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && src[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe('export', () => {
  it('JSON export has a header and everything visible to the caller', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const priv = (await c.post('/api/records', { type: 'note', title: 'Private one', data: { body: 'mine' }, visibility: 'private' })).body.record;
    const res = await c.get('/api/export?format=json');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-disposition'])).toMatch(/attachment; filename="kadode-export-2026-10-29\.json"/);
    const x = res.body;
    expect(x.export).toMatchObject({ app: 'kadode', mode: 'local-demo', generated_at: '2026-10-29T20:00:00.000Z', schema_version: latestMigrationVersion(), format_version: 1 });
    expect(x.export.counts.records).toBe(x.records.length);
    expect(x.people.map((p: any) => p.id)).toEqual(['avery', 'jun', 'mochi']);
    expect(x.records.some((r: any) => r.id === priv.id)).toBe(true);
    expect(x.records.find((r: any) => r.id === 'milestone:W06').source.raw).not.toEqual({}); // full source in the export
    expect(x.task_links.length).toBe(3);
    expect(x.import_runs).toHaveLength(1);
    expect(x.audit.length).toBeGreaterThan(x.records.length - 1);
    expect(x.audit.some((a: any) => a.record_id === priv.id)).toBe(true);
    const jun = await loginAs(h, 'jun');
    const junX = (await jun.get('/api/export?format=json')).body;
    expect(junX.records.some((r: any) => r.id === priv.id)).toBe(false);
    expect(junX.audit.some((a: any) => a.record_id === priv.id)).toBe(false);
  });

  it('CSV export flattens fields and neutralises spreadsheet formulas', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const titles = ['=HYPERLINK("http://example.invalid","click")', '+1+1', '-2+3', '@SUM(A1)', 'plain, with "quotes"'];
    const bodies = ['=SUM(0)', '+1', '-2', '@x', '\ttab first', 'two\nlines, "quoted"'];
    for (const [i, body] of bodies.entries()) {
      const title = titles[i] ?? `Title ${i}`;
      expect((await c.post('/api/records', { type: 'note', title, data: { body } })).status).toBe(201);
    }
    const res = await c.get('/api/export?format=csv&type=note');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    expect(res.raw.startsWith('\uFEFF')).toBe(true);
    const rows = parseCsv(res.raw);
    const header = rows[0]!;
    expect(header.slice(0, 6)).toEqual(['id', 'type', 'key', 'title', 'status', 'owner']);
    expect(header).toContain('data.body');
    const titleCol = header.indexOf('title');
    const bodyCol = header.indexOf('data.body');
    const gotTitles = rows.slice(1).map((r) => r[titleCol]);
    expect(gotTitles).toEqual(expect.arrayContaining([`'=HYPERLINK("http://example.invalid","click")`, `'+1+1`, `'-2+3`, `'@SUM(A1)`, 'plain, with "quotes"']));
    const gotBodies = rows.slice(1).map((r) => r[bodyCol]);
    expect(gotBodies).toEqual(expect.arrayContaining([`'=SUM(0)`, `'+1`, `'-2`, `'@x`, `'\ttab first`, 'two\nlines, "quoted"']));
    for (const r of rows.slice(1)) {
      expect(r[titleCol]!).not.toMatch(/^[=+\-@\t\r]/);
      expect(r[bodyCol]!).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(csvCell('=1')).toBe("'=1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });

  it('flattens nested money fields on cost lines', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const rows = parseCsv((await c.get('/api/export?format=csv&type=cost')).raw);
    const header = rows[0]!;
    expect(header.some((x) => x.startsWith('data.estimate.'))).toBe(true);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r.length).toBe(header.length);
  });

  it('validates the export query', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    expect((await c.get('/api/export?format=csv')).status).toBe(422);
    expect((await c.get('/api/export?format=csv&type=bogus')).status).toBe(422);
    expect((await c.get('/api/export?format=xml')).status).toBe(422);
    expect((await c.get('/api/export?format=json&extra=1')).status).toBe(422);
  });
});

describe('backup and restore', () => {
  it('backs up with an integrity check and lists the file', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const res = await c.post('/api/admin/backup', {});
    expect(res.status).toBe(201);
    const b = res.body.backup;
    expect(b.name).toMatch(/^kadode-20261029T200000Z\.db$/);
    expect(b.integrity).toBe('ok');
    const file = join(h.dir, 'backups', b.name);
    expect(existsSync(file)).toBe(true);
    const copy = new Database(file, { readonly: true });
    expect((copy.pragma('integrity_check') as any[])[0].integrity_check).toBe('ok');
    expect((copy.prepare("SELECT COUNT(*) AS n FROM records").get() as any).n).toBe(countRows(h.db, 'records'));
    copy.close();
    // A second backup in the same second gets a distinct name.
    const second = (await c.post('/api/admin/backup', {})).body.backup;
    expect(second.name).not.toBe(b.name);
    const list = (await c.get('/api/admin/backups')).body.backups;
    expect(list.map((x: any) => x.name).sort()).toEqual([b.name, second.name].sort());
  });

  it('restores an earlier state, takes a pre-restore backup and keeps the session', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m0 = recordRow(h.db, 'milestone:W06');
    const backup = (await c.post('/api/admin/backup', {})).body.backup;

    // Change things after the backup.
    const note = (await c.post('/api/records', { type: 'note', title: 'After the backup', data: { body: 'x' } })).body.record;
    await c.patch('/api/records/milestone:W06', { baseVersion: m0.version, changes: { title: 'Edited later' } });
    await c.post('/api/tasks', { title: 'Later task', due_mode: 'blank' });
    expect(recordRow(h.db, 'milestone:W06').title).toBe('Edited later');

    expect((await c.post('/api/admin/restore', { backup: backup.name })).status).toBe(422); // confirmation required
    expect((await c.post('/api/admin/restore', { backup: backup.name, confirm: 'restore' })).status).toBe(422);
    const res = await c.post('/api/admin/restore', { backup: backup.name, confirm: 'RESTORE' });
    expect(res.status).toBe(200);
    expect(res.body.restore).toMatchObject({ restored_from: backup.name, schema_migrated: false, session_invalidated: false });
    expect(res.body.restore.pre_restore_backup).toMatch(/-pre-restore\.db$/);
    expect(existsSync(join(h.dir, 'backups', res.body.restore.pre_restore_backup))).toBe(true);

    expect(recordRow(h.db, 'milestone:W06').title).toBe(m0.title);
    expect(recordRow(h.db, 'milestone:W06').version).toBe(m0.version);
    expect(recordRow(h.db, note.id)).toBeUndefined();
    expect(countRows(h.db, 'task_links')).toBe(3);
    // Still signed in (the same users exist), and the restore itself is audited.
    const audit = (await c.get('/api/audit?limit=5')).body.entries;
    expect(audit[0]).toMatchObject({ action: 'restore', actor: 'avery' });
    expect(audit[0].after.restored_from).toBe(backup.name);
    expect((await c.get('/api/records/milestone:W06')).body.record.title).toBe(m0.title);
    // The pre-restore backup holds the later state, so the restore itself is reversible.
    const pre = new Database(join(h.dir, 'backups', res.body.restore.pre_restore_backup), { readonly: true });
    expect((pre.prepare("SELECT title FROM records WHERE id = 'milestone:W06'").get() as any).title).toBe('Edited later');
    pre.close();
  });

  it('rejects path traversal, odd names and missing files', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    writeFileSync(join(h.dir, 'secret.db'), 'x');
    for (const name of ['../kadode.db', '../../etc/passwd', '/etc/passwd', 'backups/../x.db', 'kadode-x.db', 'secret.db', 'kadode-20261029T200000Z.db/..', '..\\x.db', '']) {
      const res = await c.post('/api/admin/restore', { backup: name, confirm: 'RESTORE' });
      expect(res.status, name).toBe(422);
    }
    expect((await c.post('/api/admin/restore', { backup: 'kadode-20200101T000000Z.db', confirm: 'RESTORE' })).status).toBe(404);
    expect(countRows(h.db, 'records')).toBeGreaterThan(100);
    expect(existsSync(join(h.dir, 'backups'))).toBe(false); // nothing was created by the refused attempts
  });

  it('refuses a corrupt backup and a backup from a newer schema, leaving data untouched', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const dir = join(h.dir, 'backups');
    const good = (await c.post('/api/admin/backup', {})).body.backup;
    // Corrupt copy
    writeFileSync(join(dir, 'kadode-20260101T000000Z.db'), Buffer.from('this is not a sqlite database at all'.repeat(40)));
    const corrupt = await c.post('/api/admin/restore', { backup: 'kadode-20260101T000000Z.db', confirm: 'RESTORE' });
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.message).toMatch(/could not be read|integrity/);
    // Newer schema
    copyFileSync(join(dir, good.name), join(dir, 'kadode-20260102T000000Z.db'));
    const newer = new Database(join(dir, 'kadode-20260102T000000Z.db'));
    newer.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, '099_future.sql', 'now')").run();
    newer.close();
    const res = await c.post('/api/admin/restore', { backup: 'kadode-20260102T000000Z.db', confirm: 'RESTORE' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/newer/);
    expect(countRows(h.db, 'records')).toBeGreaterThan(100);
    expect(readdirSync(dir).filter((f) => f.includes('pre-restore'))).toEqual([]);
  });

  it('migrates an older backup before restoring it', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const good = (await c.post('/api/admin/backup', {})).body.backup;
    const dir = join(h.dir, 'backups');
    const old = join(dir, 'kadode-20260103T000000Z.db');
    copyFileSync(join(dir, good.name), old);
    const conn = new Database(old);
    conn.exec('ALTER TABLE task_links DROP COLUMN pending_changes');
    conn.prepare('DELETE FROM schema_migrations WHERE version = 2').run();
    conn.close();
    await c.post('/api/records', { type: 'note', title: 'Will vanish', data: { body: 'x' } });
    const res = await c.post('/api/admin/restore', { backup: 'kadode-20260103T000000Z.db', confirm: 'RESTORE' });
    expect(res.status).toBe(200);
    expect(res.body.restore.schema_migrated).toBe(true);
    expect(countRows(h.db, 'records', "type = 'note'")).toBe(0);
    expect(h.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: latestMigrationVersion() });
    // The live database still works with the restored data and new-column code paths.
    const t = await c.post('/api/tasks', { title: 'After migrate', due_mode: 'blank' });
    expect(t.body.outcome).toBe('synced');
  });

  it('requires re-login when the restored users differ', async () => {
    const h = await harness();
    const admin = await loginAs(h, 'avery');
    const backup = (await admin.post('/api/admin/backup', {})).body.backup;
    // A user created after the backup signs in, then the backup is restored.
    h.db.prepare("INSERT INTO users (id, household_id, person_id, username, password_hash, is_dev_identity, disabled, created_at) VALUES ('user:later', 'demo-household', 'jun', 'jun-later', NULL, 0, 0, '2026-10-29T00:00:00.000Z')").run();
    await givePassword(h.db, 'jun-later');
    const later = new Client(h.app);
    expect((await later.passwordLogin('jun-later')).status).toBe(200);
    expect((await later.get('/api/me')).status).toBe(200);
    const res = await later.post('/api/admin/restore', { backup: backup.name, confirm: 'RESTORE' });
    expect(res.status).toBe(200);
    expect(res.body.restore.session_invalidated).toBe(true);
    expect(later.cookie).toBeNull(); // cookie cleared
    expect((await later.get('/api/me')).status).toBe(401);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'jun-later'").get()).toEqual({ n: 0 });
    // The other session survives because its user still exists.
    expect((await admin.get('/api/me')).status).toBe(200);
  });

  it('admin restore is refused when the database holds several households', async () => {
    const h = await harness({ secondHousehold: true });
    const c = await loginAs(h, 'avery');
    const backup = (await c.post('/api/admin/backup', {})).body.backup;
    expect(backup.name).toBeTruthy();
    const res = await c.post('/api/admin/restore', { backup: backup.name, confirm: 'RESTORE' });
    expect(res.status).toBe(403);
  });
});
