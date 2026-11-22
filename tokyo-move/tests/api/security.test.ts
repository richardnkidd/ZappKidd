/**
 * Regression tests for the independent security review (SEC-001 ... SEC-016). Each test is named after its finding.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { requestGuard } from '../../src/server/http/security';
import { DEMO_HOUSEHOLD_ID as CONFIG_DEMO_ID } from '../../src/server/config';
import { openDb, type Db } from '../../src/server/db/db';
import { resolveRuntimeConfig, startupChecks } from '../../src/server/runtime';
import { csvCell, needsFormulaGuard } from '../../src/server/domain/export-service';
import { DEMO_HOUSEHOLD_ID as FIXTURE_DEMO_ID } from '../../fixtures/demo/bundle';
import { Client, ORIGIN, PASSWORD, countRows, givePassword, loginAs, makeHarness, recordRow, type Harness } from './helpers';

const open: Harness[] = [];
const cleanup: (() => void)[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
  while (cleanup.length) cleanup.pop()!();
});

const ROOT = resolve(import.meta.dirname, '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kadode-sec-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A database that looks like a real (non-demo) household: one password user, no development identities. */
function realishDb(path: string): Db {
  const db = openDb(path);
  db.prepare("INSERT INTO households (id, name, home_timezone, display_timezone, data_label, created_at) VALUES ('real-household', 'Real household', 'Asia/Tokyo', 'Asia/Tokyo', 'Imported plan (test stand-in)', '2026-10-01T00:00:00.000Z')").run();
  for (const [id, name] of [['avery', 'Avery'], ['jun', 'Jun']] as const) {
    db.prepare("INSERT INTO people (id, household_id, display_name, kind, aliases, descriptor, anchors) VALUES (?, 'real-household', ?, 'adult', '[]', NULL, '{}')").run(id, name);
  }
  db.prepare("INSERT INTO users (id, household_id, person_id, username, password_hash, is_dev_identity, disabled, created_at) VALUES ('user:avery', 'real-household', 'avery', 'avery-login', NULL, 0, 0, '2026-10-01T00:00:00.000Z')").run();
  return db;
}

/* ------------------------------------------------------------------ */

describe('SEC-001 DNS rebinding: Host allowlist', () => {
  it('SEC-001 answers 421 to any Host that is not configured, on public, protected and static routes alike', async () => {
    const h = await harness({ webRoot: null });
    const rebind = 'rebind.attacker.example:8930';
    const evil = new Client(h.app, { host: rebind, origin: `http://${rebind}` });
    expect((await evil.get('/api/health')).status).toBe(421);
    expect((await evil.get('/api/auth/identities')).status).toBe(421);
    const login = await evil.post('/api/auth/dev-login', { person_id: 'avery' });
    expect(login.status).toBe(421);
    expect(login.cookies).toEqual([]);
    expect(countRows(h.db, 'sessions')).toBe(0);
    // Even a perfectly valid session cookie is useless on a foreign Host (no data leaves).
    const good = await loginAs(h, 'avery');
    evil.cookie = good.cookie;
    expect((await evil.get('/api/snapshot')).status).toBe(421);
    expect((await evil.get('/api/export?format=json')).status).toBe(421);
    expect((await evil.post('/api/admin/backup', {})).status).toBe(421);
    expect((await evil.get('/')).status).toBe(421);
    // Missing Host is refused too.
    const bare = await h.app.inject({ method: 'GET', url: '/api/health', headers: { host: '' } });
    expect(bare.statusCode).toBe(421);
  });

  it('SEC-001 allows loopback only on the bound port, in any case, and refuses other ports', async () => {
    const h = await harness({ port: 8787, publicOrigin: undefined as unknown as string });
    const hosts = [['127.0.0.1:8787', 200], ['localhost:8787', 200], ['LOCALHOST:8787', 200], ['[::1]:8787', 200], ['localhost:9999', 421], ['localhost', 421], ['127.0.0.1:80', 421], ['0.0.0.0:8787', 421], ['kadode.test', 421]] as const;
    for (const [host, status] of hosts) {
      const res = await h.app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(res.statusCode, host).toBe(status);
    }
  });

  it('SEC-001 compares Origin with the configured origins, never with the request\'s own Host', async () => {
    const h = await harness({ port: 8787, publicOrigin: 'https://home.example.ts.net' });
    const send = async (host: string, origin: string) => {
      const c = new Client(h.app, { host, origin });
      return c.post('/api/auth/dev-login', { person_id: 'avery' });
    };
    expect((await send('home.example.ts.net', 'https://home.example.ts.net')).status).toBe(200);
    expect((await send('127.0.0.1:8787', 'http://127.0.0.1:8787')).status).toBe(200);
    // A TLS proxy that rewrites Host to loopback still presents the public Origin.
    expect((await send('127.0.0.1:8787', 'https://home.example.ts.net')).status).toBe(200);
    // Origin matching the (allowed) Host is not enough when it is not a configured origin: wrong scheme, wrong port, other site.
    expect((await send('home.example.ts.net', 'http://home.example.ts.net')).status).toBe(403);
    expect((await send('home.example.ts.net', 'https://evil.example')).status).toBe(403);
    expect((await send('localhost:8787', 'http://127.0.0.1:8787')).status).toBe(200); // both loopback spellings are configured
    expect((await send('localhost:8787', 'http://localhost:9999')).status).toBe(403);
    // An unconfigured host is rejected before Origin is even looked at, whatever Origin says.
    expect((await send('rebind.attacker.example:8787', 'http://rebind.attacker.example:8787')).status).toBe(421);
    expect((await send('home.example.ts.net:8787', 'https://home.example.ts.net')).status).toBe(421);
  });

  it('SEC-001 extra dev origins (the Vite server) add their host as well', async () => {
    const h = await harness({ port: 8787, allowedOrigins: ['http://127.0.0.1:5173'] });
    const ok = await h.app.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:5173' } });
    expect(ok.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:5174' } })).statusCode).toBe(421);
  });
});

/* ------------------------------------------------------------------ */

describe('SEC-002 the default mode must not open a real database', () => {
  it('SEC-002 refuses an unset KADODE_MODE when KADODE_DB is set, but still defaults to the demo database', () => {
    expect(() => resolveRuntimeConfig({ KADODE_DB: '/data/real/kadode.db' })).toThrow(/KADODE_MODE must be set explicitly/);
    expect(() => resolveRuntimeConfig({ KADODE_DB: '/data/real/kadode.db', KADODE_MODE: '' })).toThrow(/KADODE_MODE/);
    expect(resolveRuntimeConfig({ KADODE_DB: '/data/real/kadode.db', KADODE_MODE: 'local' }).mode).toBe('local');
    const demo = resolveRuntimeConfig({}, '/work');
    expect(demo.mode).toBe('local-demo');
    expect(demo.dbPath).toBe('/work/private/data/kadode-demo.db');
  });

  it('SEC-002 local-demo refuses a database holding a household that is not the fictional demo', () => {
    const db = realishDb(join(tmp(), 'real.db'));
    const cfg = resolveRuntimeConfig({ KADODE_MODE: 'local-demo' });
    expect(() => startupChecks(db, cfg)).toThrow(/local-demo/);
    expect(countRows(db, 'users', 'is_dev_identity = 1')).toBe(0);
    db.close();
  });

  it('SEC-002 development identities are only planned for the demo household, or for local mode with the flag', async () => {
    const real = realishDb(join(tmp(), 'real.db'));
    expect(startupChecks(real, resolveRuntimeConfig({ KADODE_MODE: 'local' })).devIdentityHouseholds).toEqual([]);
    expect(startupChecks(real, resolveRuntimeConfig({ KADODE_MODE: 'local', KADODE_DEV_IDENTITIES: '1' })).devIdentityHouseholds).toEqual(['real-household']);
    real.close();
    const h = await harness();
    expect(startupChecks(h.db, resolveRuntimeConfig({})).devIdentityHouseholds).toEqual([CONFIG_DEMO_ID]);
    expect(startupChecks(h.db, resolveRuntimeConfig({ KADODE_MODE: 'local' })).devIdentityHouseholds).toEqual([]);
    expect(CONFIG_DEMO_ID).toBe(FIXTURE_DEMO_ID);
  });

  it('SEC-002 index.ts exits non-zero and writes no development identities when the mode is forgotten', () => {
    const dir = tmp();
    const dbPath = join(dir, 'kadode.db');
    realishDb(dbPath).close();
    const run = (extra: Record<string, string>) =>
      spawnSync(TSX, [join(ROOT, 'src', 'server', 'index.ts')], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', KADODE_DB: dbPath, KADODE_DATA_DIR: dir, PORT: '8941', ...extra },
      });
    const forgot = run({});
    expect(forgot.status).toBe(1);
    expect(forgot.stderr).toMatch(/KADODE_MODE must be set explicitly/);
    const explicitDemo = run({ KADODE_MODE: 'local-demo' });
    expect(explicitDemo.status).toBe(1);
    expect(explicitDemo.stderr).toMatch(/local-demo/);
    const db = openDb(dbPath);
    expect(countRows(db, 'users', 'is_dev_identity = 1')).toBe(0);
    db.close();
  }, 90_000);
});

/* ------------------------------------------------------------------ */

describe('SEC-003 LAN exposure is refused, not warned about', () => {
  it('SEC-003 refuses KADODE_LAN with development identities in local mode', () => {
    expect(() => resolveRuntimeConfig({ KADODE_MODE: 'local', KADODE_DEV_IDENTITIES: '1', KADODE_LAN: '1' })).toThrow(/KADODE_LAN/);
    // Password-only local mode and the fictional demo may still be shared on a trusted network (with a warning).
    expect(resolveRuntimeConfig({ KADODE_MODE: 'local', KADODE_LAN: '1' }).warnings.join(' ')).toMatch(/network/i);
    expect(resolveRuntimeConfig({ KADODE_LAN: '1' }).host).toBe('0.0.0.0');
  });

  it('SEC-003 refuses production and staging on non-loopback HTTP unless a TLS proxy is declared', () => {
    for (const mode of ['production', 'staging']) {
      const base = { KADODE_MODE: mode, KADODE_COOKIE_SECURE: '1', KADODE_LAN: '1' };
      expect(() => resolveRuntimeConfig(base), mode).toThrow(/KADODE_TRUST_PROXY/);
      expect(() => resolveRuntimeConfig({ ...base, KADODE_TRUST_PROXY: '0' }), mode).toThrow(/KADODE_TRUST_PROXY/);
      expect(() => resolveRuntimeConfig({ ...base, KADODE_COOKIE_SECURE: '', KADODE_TRUST_PROXY: '1' }), mode).toThrow(/KADODE_COOKIE_SECURE/);
      expect(resolveRuntimeConfig({ ...base, KADODE_TRUST_PROXY: '1' }).host, mode).toBe('0.0.0.0');
      // Loopback is always fine.
      expect(resolveRuntimeConfig({ KADODE_MODE: mode, KADODE_COOKIE_SECURE: '1' }).host).toBe('127.0.0.1');
    }
  });

  it('SEC-003 validates the public origin', () => {
    const base = { KADODE_MODE: 'production', KADODE_COOKIE_SECURE: '1' };
    expect(resolveRuntimeConfig({ ...base, KADODE_PUBLIC_ORIGIN: 'https://home.example.ts.net' }).publicOrigin).toBe('https://home.example.ts.net');
    expect(() => resolveRuntimeConfig({ ...base, KADODE_PUBLIC_ORIGIN: 'http://home.example.ts.net' })).toThrow(/https/);
    expect(() => resolveRuntimeConfig({ ...base, KADODE_PUBLIC_ORIGIN: 'https://home.example.ts.net/app' })).toThrow(/origin/);
    expect(() => resolveRuntimeConfig({ ...base, KADODE_PUBLIC_ORIGIN: 'not a url' })).toThrow(/KADODE_PUBLIC_ORIGIN/);
  });
});

/* ------------------------------------------------------------------ */

describe('SEC-005 login rate limit holds under concurrency', () => {
  async function user(h: Harness) {
    h.db.prepare("UPDATE users SET is_dev_identity = 0 WHERE username = 'dev-jun'").run();
    await givePassword(h.db, 'dev-jun');
  }

  it('SEC-005 at most five of twenty concurrent wrong guesses are evaluated; the rest are refused up front', async () => {
    const h = await harness();
    await user(h);
    const c = new Client(h.app);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => c.passwordLogin('dev-jun', `wrong guess number ${i}`)));
    const counts: Record<number, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    expect(counts[401]).toBe(5);
    expect(counts[429]).toBe(15);
    expect(results.find((r) => r.status === 429)!.headers['retry-after']).toBeDefined();
    // The right password cannot sneak in either, concurrently or afterwards.
    const mixed = await Promise.all([c.passwordLogin('dev-jun', PASSWORD), c.passwordLogin('dev-jun', PASSWORD)]);
    expect(mixed.map((r) => r.status)).toEqual([429, 429]);
  });

  it('SEC-005 a correct password among a concurrent burst still wins only while the budget lasts', async () => {
    const h = await harness();
    await user(h);
    const c = new Client(h.app);
    const burst = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => c.passwordLogin('dev-jun', `nope nope nope ${i}`)),
      c.passwordLogin('dev-jun', PASSWORD),
      ...Array.from({ length: 10 }, (_, i) => c.passwordLogin('dev-jun', `late guess ${i}`)),
    ]);
    expect(burst.filter((r) => r.status === 200)).toHaveLength(1);
    expect(burst.filter((r) => r.status === 401)).toHaveLength(4);
    expect(burst.filter((r) => r.status === 429)).toHaveLength(10);
  });

  it('SEC-005 a username is capped across addresses, and an address across usernames', async () => {
    const h = await harness();
    await user(h);
    for (let i = 0; i < 10; i += 1) {
      const c = new Client(h.app, { remoteAddress: `198.51.100.${i + 1}` });
      expect((await c.passwordLogin('dev-jun', 'wrong wrong wrong')).status).toBe(401);
    }
    const fresh = new Client(h.app, { remoteAddress: '198.51.100.200' });
    expect((await fresh.passwordLogin('dev-jun', PASSWORD)).status).toBe(429);
    const one = new Client(h.app, { remoteAddress: '203.0.113.50' });
    for (let i = 0; i < 30; i += 1) expect((await one.passwordLogin(`someone-${i}`, 'wrong wrong wrong')).status).toBe(401);
    expect((await one.passwordLogin('someone-new', 'wrong wrong wrong')).status).toBe(429);
  });

  it('SEC-005 a successful sign-in forgives earlier failures of that user', async () => {
    const h = await harness();
    await user(h);
    const c = new Client(h.app);
    for (let i = 0; i < 4; i += 1) await c.passwordLogin('dev-jun', 'wrong wrong wrong');
    expect((await c.passwordLogin('dev-jun', PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i += 1) expect((await c.passwordLogin('dev-jun', 'wrong wrong wrong')).status).toBe(401);
  });
});

describe('SEC-006 trusted proxy is one hop from loopback only', () => {
  async function user(h: Harness) {
    h.db.prepare("UPDATE users SET is_dev_identity = 0 WHERE username = 'dev-jun'").run();
    await givePassword(h.db, 'dev-jun');
  }

  it('SEC-006 a network client cannot rotate X-Forwarded-For to escape the limit', async () => {
    const h = await harness({ trustProxy: true });
    await user(h);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const c = new Client(h.app, { remoteAddress: '203.0.113.9' }); // not loopback: its X-Forwarded-For is ignored
      statuses.push((await c.request('POST', '/api/auth/login', { username: 'dev-jun', password: 'wrong wrong wrong' }, { 'x-forwarded-for': `10.9.8.${i}` })).status);
    }
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  it('SEC-006 behind a loopback proxy the real client is the entry the proxy appended, not the forged ones', async () => {
    const h = await harness({ trustProxy: true });
    await user(h);
    const c = new Client(h.app); // peer 127.0.0.1 = the proxy
    const attempt = (xff: string) => c.request('POST', '/api/auth/login', { username: 'nobody-here', password: 'wrong wrong wrong' }, { 'x-forwarded-for': xff });
    for (let i = 0; i < 5; i += 1) expect((await attempt(`forged-${i}, 198.51.100.7`)).status).toBe(401);
    expect((await attempt('another-forgery, 198.51.100.7')).status).toBe(429); // same real client
    expect((await attempt('another-forgery, 198.51.100.8')).status).toBe(401); // a different real client
  });
});

/* ------------------------------------------------------------------ */

describe('SEC-008 undo cannot bypass who may do what', () => {
  it('SEC-008 only the approver can undo an approval', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d = (await avery.get('/api/records/decision:D02')).body.record;
    await avery.post('/api/decisions/decision:D02/approve', { baseVersion: d.version, option_id: 'opt-1' });
    const entry = (await avery.get('/api/audit?record_id=decision:D02')).body.entries[0];
    expect(entry.action).toBe('approve');
    const denied = await jun.post(`/api/audit/${entry.id}/undo`, {});
    expect(denied.status).toBe(403);
    expect(JSON.parse(recordRow(h.db, 'decision:D02').data).approvals).toHaveLength(1);
    expect((await avery.post(`/api/audit/${entry.id}/undo`, {})).status).toBe(200);
  });

  it('SEC-008 nobody can use undo-of-an-undo to put back or remove another person\'s approval', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d = (await avery.get('/api/records/decision:D02')).body.record;
    await avery.post('/api/decisions/decision:D02/approve', { baseVersion: d.version, option_id: 'opt-1' });
    const approve = (await avery.get('/api/audit?record_id=decision:D02')).body.entries[0];
    const undone = await avery.post(`/api/audit/${approve.id}/undo`, {});
    expect(undone.status).toBe(200);
    // jun tries to "redo" avery's approval by undoing avery's undo.
    const redo = await jun.post(`/api/audit/${undone.body.undo_entry_id}/undo`, {});
    expect(redo.status).toBe(403);
    expect(JSON.parse(recordRow(h.db, 'decision:D02').data).approvals).toEqual([]);
    // jun approves, avery cannot withdraw jun's approval by undoing something older either.
    const fresh = (await jun.get('/api/records/decision:D02')).body.record;
    await jun.post('/api/decisions/decision:D02/approve', { baseVersion: fresh.version, option_id: 'opt-1' });
    const junEntry = (await jun.get('/api/audit?record_id=decision:D02')).body.entries[0];
    expect((await avery.post(`/api/audit/${junEntry.id}/undo`, {})).status).toBe(403);
  });

  it('SEC-008 only the creator can undo a visibility change', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const note = (await avery.post('/api/records', { type: 'note', title: 'Shared note', data: { body: 'x' } })).body.record;
    const toPrivate = await avery.patch(`/api/records/${note.id}`, { baseVersion: note.version, changes: { visibility: 'private' } });
    const backToShared = await avery.patch(`/api/records/${note.id}`, { baseVersion: toPrivate.body.record.version, changes: { visibility: 'household' } });
    expect(backToShared.status).toBe(200);
    // jun can see the shared note again, but cannot reverse the creator-only visibility decision through undo.
    const newest = (await avery.get(`/api/audit?record_id=${note.id}`)).body.entries[0];
    expect(newest.after.visibility).toBe('household');
    expect((await jun.post(`/api/audit/${newest.id}/undo`, {})).status).toBe(403);
    expect(recordRow(h.db, note.id).visibility).toBe('household');
    expect((await avery.post(`/api/audit/${newest.id}/undo`, {})).status).toBe(200);
    expect(recordRow(h.db, note.id).visibility).toBe('private');
  });
});

/* ------------------------------------------------------------------ */

describe('SEC-009 private records do not leak through task links or reviews', () => {
  async function privateNoteWithTask(h: Harness) {
    const avery = await loginAs(h, 'avery');
    const note = (await avery.post('/api/records', { type: 'note', title: 'Private clinic note', data: { body: 'secret body' }, visibility: 'private' })).body.record;
    const task = await avery.post('/api/tasks', { title: 'PRIVATE: call the clinic', notes: 'PRIVATE notes: dosage', record_id: note.id, due_mode: 'blank' });
    expect(task.status).toBe(201);
    return { avery, note, task: task.body.task };
  }

  it('SEC-009 the other adult cannot list, see in the snapshot, export, read, edit, complete or sync a task linked to a private record', async () => {
    const h = await harness();
    const { avery, note, task } = await privateNoteWithTask(h);
    const jun = await loginAs(h, 'jun');
    const leak = (raw: string) => expect(raw).not.toContain('PRIVATE');
    expect(((await avery.get('/api/tasks')).body.task_links as any[]).some((t) => t.id === task.id)).toBe(true);
    leak((await jun.get('/api/tasks')).raw);
    leak((await jun.get('/api/snapshot')).raw);
    leak((await jun.get('/api/export?format=json')).raw);
    leak((await jun.get('/api/audit?limit=500')).raw);
    expect((await jun.get(`/api/records/${note.id}`)).status).toBe(404);
    expect((await jun.patch(`/api/tasks/${task.id}`, { baseVersion: task.version, changes: { title: 'hijacked' } })).status).toBe(404);
    expect((await jun.post(`/api/tasks/${task.id}/complete`, { baseVersion: task.version, evidence: 'x' })).status).toBe(404);
    expect((await jun.post(`/api/tasks/${task.id}/retry`, {})).status).toBe(404);
    const sync = await jun.post('/api/tasks/sync', {});
    leak(sync.raw);
    expect(h.db.prepare('SELECT title FROM task_links WHERE id = ?').get(task.id)).toEqual({ title: 'PRIVATE: call the clinic' });
    // Anchor previews build their deadline context from the same links.
    leak((await jun.post('/api/anchors/TN/preview', { date: '2027-08-01' })).raw);
    // The owner still sees and edits it normally; making the record shared makes the task visible again.
    expect((await avery.patch(`/api/tasks/${task.id}`, { baseVersion: task.version, changes: { title: 'PRIVATE: call the clinic today' } })).status).toBe(200);
    await avery.patch(`/api/records/${note.id}`, { baseVersion: note.version, changes: { visibility: 'household' } });
    expect(((await jun.get('/api/tasks')).body.task_links as any[]).some((t) => t.id === task.id)).toBe(true);
  });

  it('SEC-009 a shared review cannot name private records, and the other adult can still edit the review', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const note = (await avery.post('/api/records', { type: 'note', title: 'Mine', data: { body: 'x' }, visibility: 'private' })).body.record;
    const review = (await avery.post('/api/reviews', {})).body.record;
    const refused = await avery.patch(`/api/reviews/${review.id}`, {
      baseVersion: review.version,
      changes: { decisions: [{ record_id: note.id, outcome: 'PRIVATE outcome text' }] },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/private/i);
    const refusedIds = await avery.patch(`/api/reviews/${review.id}`, { baseVersion: review.version, changes: { reviewed_record_ids: [note.id] } });
    expect(refusedIds.status).toBe(422);
    expect(recordRow(h.db, review.id).version).toBe(review.version);
    // Shared records work for both, and the second adult is never blocked by ids the first one added.
    const ok = await avery.patch(`/api/reviews/${review.id}`, { baseVersion: review.version, changes: { reviewed_record_ids: ['milestone:W06'] } });
    expect(ok.status).toBe(200);
    const byJun = await jun.patch(`/api/reviews/${review.id}`, { baseVersion: ok.body.record.version, changes: { summary: 'Looked at W06' } });
    expect(byJun.status).toBe(200);
    // Even if a record in the review is made private later, editing other parts of the review keeps working for the other adult.
    const shared = (await avery.post('/api/records', { type: 'note', title: 'Shared then private', data: { body: 'x' } })).body.record;
    const withShared = await avery.patch(`/api/reviews/${review.id}`, { baseVersion: byJun.body.record.version, changes: { reviewed_record_ids: ['milestone:W06', shared.id] } });
    expect(withShared.status).toBe(200);
    await avery.patch(`/api/records/${shared.id}`, { baseVersion: shared.version, changes: { visibility: 'private' } });
    const later = await jun.patch(`/api/reviews/${review.id}`, { baseVersion: withShared.body.record.version, changes: { summary: 'Edited after the note became private' } });
    expect(later.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */

function buildConfigForGuard() {
  return { allowedHosts: ['kadode.test'], allowedOrigins: [ORIGIN] } as never;
}

describe('SEC-012 encoded paths cannot dodge the /api hooks', () => {
  it('SEC-012 rejects percent-encoded /api variants and dot segments before any handler runs', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const sessions = countRows(h.db, 'sessions');
    expect((await c.get('/%61pi/health')).status).toBe(400);
    expect((await c.get('/%61pi/me')).status).toBe(400);
    expect((await c.get('/api/records/%2e%2e%2fsnapshot')).status).toBe(400);
    expect((await c.get('/%')).status).toBe(400);
    // Neither CSRF-free logout nor an Origin-free dev-login gets through the encoded door.
    const plain = await h.app.inject({ method: 'POST', url: '/%61pi/auth/logout', headers: { host: 'kadode.test', 'content-type': 'text/plain', cookie: c.cookie! }, payload: 'x' });
    expect(plain.statusCode).toBe(400);
    const noOrigin = await h.app.inject({ method: 'POST', url: '/%61pi/auth/dev-login', headers: { host: 'kadode.test', 'content-type': 'application/json' }, payload: '{"person_id":"avery"}' });
    expect(noOrigin.statusCode).toBe(400);
    expect(noOrigin.headers['set-cookie']).toBeUndefined();
    expect(countRows(h.db, 'sessions')).toBe(sessions);
    // app.inject collapses dot segments before the app sees them, so the guard is also checked directly on raw targets
    // (what a real socket delivers).
    const guard = requestGuard(buildConfigForGuard());
    for (const url of ['/%2e%2e/api/me', '/api/%2e%2e/api/me', '/api/records/%2e%2e%2fsnapshot', '/api/./me', '/api/records/..%5csnapshot', '/api/me%00', '/%61pi/me?x=1']) {
      await expect(guard({ headers: { host: 'kadode.test' }, url } as never), url).rejects.toMatchObject({ status: 400 });
    }
    await expect(guard({ headers: { host: 'kadode.test' }, url: '/api/records/milestone%3AW06?type=x' } as never)).resolves.toBeUndefined();
    // Legitimate encodings (record ids contain ':') keep working.
    expect((await c.get('/api/records/milestone%3AW06')).status).toBe(200);
    expect((await c.get('/api/records/milestone:W06')).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */

describe('SEC-014 files and directories are private', () => {
  it('SEC-014 new databases, their directory and WAL files are 0600/0700 even under a permissive umask', () => {
    const previous = process.umask(0o022);
    try {
      const base = tmp();
      const dbPath = join(base, 'nested', 'data', 'kadode.db');
      const db = openDb(dbPath);
      db.prepare("INSERT INTO households (id, name, home_timezone, display_timezone, data_label, created_at) VALUES ('h', 'H', 'Asia/Tokyo', 'Asia/Tokyo', 'x', 'now')").run();
      const mode = (p: string) => statSync(p).mode & 0o777;
      expect(mode(join(base, 'nested', 'data'))).toBe(0o700);
      expect(mode(dbPath)).toBe(0o600);
      expect(mode(`${dbPath}-wal`)).toBe(0o600);
      expect(mode(`${dbPath}-shm`)).toBe(0o600);
      db.close();
    }
    finally {
      process.umask(previous);
    }
  });

  it('SEC-014 an existing world-readable database file and data directory are tightened when opened', () => {
    const previous = process.umask(0o022);
    try {
      const base = tmp();
      const dir = join(base, 'data');
      const dbPath = join(dir, 'kadode.db');
      openDb(dbPath).close();
      chmodSync(dir, 0o755);
      chmodSync(dbPath, 0o644);
      openDb(dbPath).close();
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previous);
    }
  });

  it('SEC-014 backups are 0600 in a 0700 directory', async () => {
    const previous = process.umask(0o022);
    try {
      const h = await harness();
      const c = await loginAs(h, 'avery');
      const b = (await c.post('/api/admin/backup', {})).body.backup;
      expect(statSync(join(h.dir, 'backups', b.name)).mode & 0o777).toBe(0o600);
      expect(statSync(join(h.dir, 'backups')).mode & 0o777).toBe(0o700);
    } finally {
      process.umask(previous);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('SEC-016 CSV formula guard', () => {
  it('SEC-016 also guards leading whitespace and fullwidth/normalized signs', () => {
    for (const cell of [' =1+1', ' =1+1', '​=1+1', '  \t@SUM(A1)', '＝1+1', '＋1', '－2+3', '＠SUM(A1)', ' -2+3', '\t=x', '\r=x', '=x', '+x', '-x', '@x']) {
      expect(needsFormulaGuard(cell), JSON.stringify(cell)).toBe(true);
      expect(csvCell(cell), JSON.stringify(cell)).toMatch(/^"?'/);
    }
    for (const cell of ['plain', 'a=b', '5 - 3', '', '12', 'hello world', '(=x)']) expect(needsFormulaGuard(cell), JSON.stringify(cell)).toBe(false);
    expect(csvCell(-5)).toBe('-5'); // real numbers stay numbers
  });

  it('SEC-016 the export applies it to titles and data', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    await c.post('/api/records', { type: 'note', title: ' =1+1', data: { body: '＝cmd|calc' } });
    const csv = (await c.get('/api/export?format=csv&type=note')).raw;
    expect(csv).toContain("' =1+1");
    expect(csv).toContain("'＝cmd|calc");
    expect(csv).not.toMatch(/,\s?=1\+1/);
  });
});
