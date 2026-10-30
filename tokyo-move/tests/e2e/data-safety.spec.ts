import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { baseUrlFor, e2eDataDir } from './support/env';
import { expect, loaded, test, unique } from './support/fixtures';

/**
 * Data safety, exercised through the HTTP API exactly as the browser would (session cookie + same-origin header).
 *
 * These tests use their own server and database (the "safety" server) because a restore replaces the whole database.
 * They run in one browser project only (playwright.config.ts ignores this file in the phone projects) and one after another.
 */
test.use({ baseURL: baseUrlFor('safety') });
test.describe.configure({ mode: 'serial' });

const enc = encodeURIComponent;

test.describe('Export', () => {
  test('JSON export downloads as a file and carries the whole plan', async ({ api }) => {
    const avery = await api('avery');
    const res = await avery.ctx.get('/api/export?format=json');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="kadode-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await res.json();
    expect(body.export).toMatchObject({ app: 'kadode', mode: 'local-demo', format_version: 1 });
    expect(body.export.counts.records).toBe(body.records.length);
    expect(body.people.map((p: any) => p.id).sort()).toEqual(['avery', 'jun', 'mochi']);
    expect(body.records.length).toBeGreaterThan(50);
    for (const type of ['milestone', 'decision', 'risk', 'question', 'document', 'anchor']) {
      expect(body.records.some((r: any) => r.type === type), `has ${type} records`).toBe(true);
    }
    expect(body.import_runs.length).toBeGreaterThan(0);
    expect(body.audit.length).toBeGreaterThan(0);
    // No credentials or session material in an export that people will keep in a folder.
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/password_hash|scrypt\$|token_hash|kadode_session/i);
  });

  test('an export only contains what that person may see (private notes stay private)', async ({ api }, testInfo) => {
    const avery = await api('avery');
    const jun = await api('jun');
    const secret = unique('Only Avery should ever export this', testInfo);
    const note = await avery.post('/api/records', { type: 'note', title: secret, data: { body: secret }, visibility: 'private' });
    const mine = JSON.stringify(await avery.get('/api/export?format=json'));
    const theirs = JSON.stringify(await jun.get('/api/export?format=json'));
    expect(mine).toContain(secret);
    expect(theirs).not.toContain(secret);
    expect(theirs).not.toContain(note.record.id);
    // CSV too.
    const csv = await (await jun.ctx.get('/api/export?format=csv&type=note')).text();
    expect(csv).not.toContain(secret);
  });

  test('CSV export is a spreadsheet-ready file per record type and defuses formulas', async ({ api }, testInfo) => {
    const avery = await api('avery');
    const formula = `=HYPERLINK("http://example.invalid","${unique('click', testInfo)}")`;
    await avery.post('/api/records', { type: 'note', title: formula, data: { body: 'csv check' } });

    const res = await avery.ctx.get('/api/export?format=csv&type=milestone');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="kadode-milestone-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csv = await res.text();
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(20);
    expect(lines[0]).toMatch(/\bid\b/i);

    const notes = await (await avery.ctx.get('/api/export?format=csv&type=note')).text();
    expect(notes).toContain('HYPERLINK');
    // The dangerous text is stored as text: its cell never starts with = + - or @.
    for (const cell of notes.split(/[\r\n,]/)) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+@]HYPERLINK/);
    // CSV needs a record type.
    expect((await avery.ctx.get('/api/export?format=csv')).status()).toBe(422);
  });
});

test.describe('Backup and restore', () => {
  test('a backup taken now brings the earlier state back after later changes', async ({ api, page, signIn }, testInfo) => {
    let avery = await api('avery');
    const w06 = 'milestone:W06';
    const before = await avery.snapshot();
    const originalNext = (before.records as any[]).find((r) => r.id === w06).data.next_action as string;
    const recordCount = (before.records as any[]).length;

    // 1. Back up.
    const made = await avery.post('/api/admin/backup', {}, 201);
    expect(made.backup.name).toMatch(/^kadode-\d{8}T\d{6}Z(-\d{2})?\.db$/);
    expect(made.backup.integrity).toBe('ok');
    expect(made.backup.bytes).toBeGreaterThan(10_000);
    const listed = (await avery.get('/api/admin/backups')).backups as { name: string }[];
    expect(listed.map((b) => b.name)).toContain(made.backup.name);

    // 2. Change things afterwards: edit a field, add a note and a decision, change a status.
    const rec = await avery.record(w06);
    const changed = unique('CHANGED AFTER THE BACKUP', testInfo);
    await avery.patch(`/api/records/${enc(w06)}`, { baseVersion: rec.version, changes: { data: { next_action: changed } }, reason: 'e2e' });
    const note = await avery.post('/api/records', { type: 'note', title: 'Added after the backup', data: { body: 'should vanish on restore' } });
    const decision = await avery.post('/api/records', { type: 'decision', title: unique('Decision after backup', testInfo), data: { options: [{ label: 'A' }, { label: 'B' }] } });
    const w25 = await avery.record('milestone:W25');
    await avery.post(`/api/records/${enc('milestone:W25')}/status`, { baseVersion: w25.version, status: 'blocked', reason: 'changed after the backup' });
    const mutated = await avery.snapshot();
    expect((mutated.records as any[]).length).toBe(recordCount + 2);
    expect((await avery.record(w06)).data.next_action).toBe(changed);

    // 3. Restore needs the exact word; anything else is refused and nothing changes (and nobody is signed out).
    const refusedNoConfirm = await avery.raw('POST', '/api/admin/restore', { backup: made.backup.name });
    expect(refusedNoConfirm.status()).toBe(422);
    const refusedWrongWord = await avery.raw('POST', '/api/admin/restore', { backup: made.backup.name, confirm: 'yes' });
    expect(refusedWrongWord.status()).toBe(422);
    expect((await avery.record(w06)).data.next_action).toBe(changed);
    // Names that are not plain backup names are refused (no path tricks), and unknown backups are not found.
    for (const bad of ['../kadode-demo.db', '/etc/passwd', 'kadode-1.db', '..%2F..%2Fx']) {
      expect((await avery.raw('POST', '/api/admin/restore', { backup: bad, confirm: 'RESTORE' })).status(), `refuses ${bad}`).toBe(422);
    }
    expect((await avery.raw('POST', '/api/admin/restore', { backup: 'kadode-20200101T000000Z.db', confirm: 'RESTORE' })).status()).toBe(404);
    expect((await avery.ctx.get('/api/me')).status(), 'a refused restore signs nobody out').toBe(200);

    // 4. Restore. It ends EVERY session (this one included) and clears the cookie, so everyone signs in again.
    const res = await avery.raw('POST', '/api/admin/restore', { backup: made.backup.name, confirm: 'RESTORE' });
    expect(res.status()).toBe(200);
    const restored = await res.json();
    expect(restored.restore.restored_from).toBe(made.backup.name);
    expect(restored.restore.pre_restore_backup).toMatch(/-pre-restore\.db$/);
    expect(restored.restore.session_invalidated).toBe(true);
    expect(res.headers()['set-cookie'] ?? '', 'the session cookie is cleared').toMatch(/kadode_session=;/);
    expect((await avery.ctx.get('/api/me')).status(), 'the old session is gone').toBe(401);
    expect((await avery.ctx.get('/api/snapshot')).status()).toBe(401);

    // 5. Sign in again: the earlier state is back, exactly.
    avery = await api('avery');
    const after = await avery.snapshot();
    expect((after.records as any[]).length).toBe(recordCount);
    expect((await avery.record(w06)).data.next_action).toBe(originalNext);
    expect((await avery.raw('GET', `/api/records/${enc(note.record.id)}`)).status()).toBe(404);
    expect((await avery.raw('GET', `/api/records/${enc(decision.record.id)}`)).status()).toBe(404);
    expect((await avery.record('milestone:W25')).status).toBe(w25.status);
    // The restore itself is in the history (who did it, from which backup).
    const audit = (await avery.get('/api/audit?limit=20')).entries as { action: string; after: any }[];
    expect(audit.some((a) => a.action === 'restore' && a.after?.restored_from === made.backup.name)).toBe(true);
    // And the app itself opens for a person who signs in again.
    await signIn(page, 'avery', '/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Avery');

    // 6. The restore was itself undoable: the "just before restore" copy holds the later changes.
    const backups = (await avery.get('/api/admin/backups')).backups as { name: string }[];
    expect(backups.map((b) => b.name)).toContain(restored.restore.pre_restore_backup);
    await avery.post('/api/admin/restore', { backup: restored.restore.pre_restore_backup, confirm: 'RESTORE' }, 200);
    avery = await api('avery');
    expect((await avery.record(w06)).data.next_action).toBe(changed);
    expect((await avery.raw('GET', `/api/records/${enc(note.record.id)}`)).status()).toBe(200);
    // ...and back to the original again, so later tests see the plain demo.
    await avery.post('/api/admin/restore', { backup: made.backup.name, confirm: 'RESTORE' }, 200);
    avery = await api('avery');
    expect((await avery.record(w06)).data.next_action).toBe(originalNext);
  });

  test('a backup that would change who can sign in needs the longer confirmation word', async ({ api, playwright, baseURL }) => {
    // A backup taken while a second login exists, then that login is removed from the live database (as if someone
    // had deleted it). Restoring the backup would quietly bring the login back, so a plain RESTORE must refuse.
    const dbPath = join(e2eDataDir('safety'), 'kadode-demo.db');
    const extra = 'e2e-extra-login';
    const cli = (args: string[], input?: string) =>
      execFileSync(join(process.cwd(), 'node_modules', '.bin', 'tsx'), ['scripts/set-password.ts', ...args], {
        cwd: process.cwd(),
        env: { ...process.env, KADODE_MODE: 'local-demo', KADODE_DB: dbPath, KADODE_DATA_DIR: e2eDataDir('safety') },
        input,
        encoding: 'utf8',
      });
    const removeExtra = () => {
      const db = new Database(dbPath);
      try {
        db.exec(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = '${extra}'); DELETE FROM users WHERE username = '${extra}'`);
      } finally {
        db.close();
      }
    };
    const password = 'a long browser-test password';
    const avery = await api('avery');
    const marker = await avery.post('/api/records', { type: 'note', title: 'Marker before users differ', data: { body: 'still here after the refusal' } });
    expect(cli(['--username', extra, '--create', '--person', 'avery'], `${password}\n`)).toContain(`Created user "${extra}"`);
    try {
      const made = await avery.post('/api/admin/backup', {}, 201);
      removeExtra();

      // Plain RESTORE is refused with a 409 that says why and what to type instead. Nothing changed; nobody signed out.
      const refused = await avery.raw('POST', '/api/admin/restore', { backup: made.backup.name, confirm: 'RESTORE' });
      expect(refused.status()).toBe(409);
      const body = await refused.json();
      expect(body.details.reason).toBe('users_differ');
      expect(body.details.confirm_with).toBe('RESTORE-INCLUDING-USERS');
      expect(body.details.would_bring_back_users).toContain(extra);
      expect((await avery.ctx.get('/api/me')).status()).toBe(200);
      expect((await avery.raw('GET', `/api/records/${enc(marker.record.id)}`)).status()).toBe(200);
      const anon = await playwright.request.newContext({ baseURL });
      try {
        const login = await anon.post('/api/auth/login', { data: { username: extra, password }, headers: { Origin: new URL(baseURL!).origin } });
        expect(login.status(), 'the removed login still does not work after a refused restore').toBe(401);

        // The longer word restores the logins too, and the brought-back login works again.
        const ok = await avery.raw('POST', '/api/admin/restore', { backup: made.backup.name, confirm: 'RESTORE-INCLUDING-USERS' });
        expect(ok.status()).toBe(200);
        const restored = await ok.json();
        expect(restored.restore.users_replaced).toBe(true);
        expect(restored.restore.session_invalidated).toBe(true);
        expect((await avery.ctx.get('/api/me')).status()).toBe(401);
        const back = await anon.post('/api/auth/login', { data: { username: extra, password }, headers: { Origin: new URL(baseURL!).origin } });
        expect(back.status(), 'the restored login signs in').toBe(200);
      } finally {
        await anon.dispose();
      }
    } finally {
      removeExtra(); // leave the throw-away database as the plain demo
    }
  });

  test('the Data screen backs up and restores, and asks everyone to sign in again afterwards', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    const marker = unique('Added after the on-screen backup', testInfo);
    await signIn(page, 'avery', '/data');
    await loaded(page);
    const backups = page.getByRole('region', { name: 'Backups' });
    await backups.getByRole('button', { name: 'Back up now' }).click();
    await expect(backups.getByText(/Backup saved: kadode-\d{8}T\d{6}Z/)).toBeVisible();
    const note = await avery.post('/api/records', { type: 'note', title: marker, data: { body: marker } });

    // The restore dialog needs the word typed exactly; the button stays off until then.
    await backups.getByRole('button', { name: /^Restore/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Restore this backup?' });
    const confirm = dialog.getByRole('button', { name: 'Restore', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Type RESTORE to confirm' }).fill('restore');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Type RESTORE to confirm' }).fill('RESTORE');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Every session ended, so the next thing the person sees is the sign-in screen, not errors.
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await page.getByRole('button', { name: 'Avery', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    const again = await api('avery');
    expect((await again.raw('GET', `/api/records/${enc(note.record.id)}`)).status(), 'the note added after the backup is gone').toBe(404);
  });

  test('backups and restores need a signed-in person and a same-origin request', async ({ api, playwright, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const anon = await playwright.request.newContext({ baseURL });
    try {
      expect((await anon.get('/api/admin/backups')).status()).toBe(401);
      expect((await anon.post('/api/admin/backup', { data: {}, headers: { Origin: origin } })).status()).toBe(401);
      expect((await anon.get('/api/export?format=json')).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
    const avery = await api('avery');
    // A page on another website cannot trigger a backup or a restore: wrong or missing Origin is refused.
    expect((await avery.ctx.post('/api/admin/backup', { data: {}, headers: { Origin: 'http://evil.example' } })).status()).toBe(403);
    expect((await avery.ctx.post('/api/admin/backup', { data: {} })).status()).toBe(403);
    expect((await avery.ctx.post('/api/admin/restore', { data: { backup: 'kadode-20200101T000000Z.db', confirm: 'RESTORE' }, headers: { Origin: 'http://evil.example' } })).status()).toBe(403);
    // Writes must be JSON.
    expect((await avery.ctx.post('/api/admin/backup', { form: { a: 'b' }, headers: { Origin: avery.origin } })).status()).toBe(403);
  });

  test('requests addressed to any other host name are refused (DNS-rebinding guard)', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    try {
      for (const host of ['evil.example', 'localhost.evil.example:8922', `127.0.0.1.evil.example`]) {
        const res = await ctx.get('/api/health', { headers: { Host: host } });
        expect(res.status(), `Host: ${host}`).toBe(421);
      }
      // The names the app is really served on still work.
      expect((await ctx.get('/api/health')).status()).toBe(200);
      const port = new URL(baseURL!).port;
      expect((await ctx.get('/api/health', { headers: { Host: `localhost:${port}` } })).status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test('the server sends the security headers the design promises', async ({ page, baseURL }) => {
    const res = await page.goto('/');
    const h = res!.headers();
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-powered-by']).toBeUndefined();
    // The session cookie is HttpOnly and SameSite (it cannot be read by page scripts).
    const login = await page.context().request.post('/api/auth/dev-login', { data: { person_id: 'avery' }, headers: { Origin: new URL(baseURL!).origin } });
    const setCookie = login.headers()['set-cookie'] ?? '';
    expect(setCookie).toMatch(/kadode_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain('kadode_session');
  });
});
