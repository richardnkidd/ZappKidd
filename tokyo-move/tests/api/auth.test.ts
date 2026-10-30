import { afterEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { buildApp } from '../../src/server/app';
import { resolveRuntimeConfig } from '../../src/server/runtime';
import { hashPassword, verifyPassword } from '../../src/server/auth/password';
import { Client, DEMO_HOUSEHOLD_ID, HOST, ORIGIN, PASSWORD, countRows, givePassword, loginAs, makeHarness, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('authentication required', () => {
  it('answers 401 for every protected endpoint without a session', async () => {
    const h = await harness();
    const c = new Client(h.app);
    const gets = ['/api/me', '/api/snapshot', '/api/records', '/api/records/milestone:W06', '/api/audit', '/api/tasks', '/api/export?format=json', '/api/import/runs', '/api/admin/backups'];
    for (const url of gets) expect((await c.get(url)).status, url).toBe(401);
    const posts = ['/api/records', '/api/records/milestone:W06/status', '/api/decisions/decision:D02/approve', '/api/tasks', '/api/tasks/sync', '/api/reviews', '/api/admin/backup', '/api/audit/x/undo', '/api/anchors/TN/preview'];
    for (const url of posts) expect((await c.post(url, {})).status, url).toBe(401);
    expect((await c.patch('/api/records/milestone:W06', {})).status).toBe(401);
    expect((await c.put('/api/anchors/TN', {})).status).toBe(401);
    const body = (await c.get('/api/snapshot')).body;
    expect(body.error).toBe('unauthenticated');
  });

  it('health is public and reports the mode', async () => {
    const h = await harness();
    const res = await new Client(h.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: 'local-demo' });
  });

  it('unknown API paths are JSON 404s (after authentication)', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const res = await c.get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('development identities are mode-gated', () => {
  it('work in local-demo: list, sign in, /api/me', async () => {
    const h = await harness();
    const c = new Client(h.app);
    const list = await c.get('/api/auth/identities');
    expect(list.status).toBe(200);
    expect(list.body.identities.map((i: any) => i.person_id).sort()).toEqual(['avery', 'jun']);
    await c.devLogin('jun');
    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ mode: 'local-demo', dev_identities_enabled: true, person: { id: 'jun' }, user: { person_id: 'jun', household_id: DEMO_HOUSEHOLD_ID } });
  });

  it('are refused in production and staging even though the rows exist', async () => {
    for (const mode of ['production', 'staging'] as const) {
      const h = await harness({ mode });
      const c = new Client(h.app);
      const ident = await c.get('/api/auth/identities');
      expect(ident.status, mode).toBe(403);
      expect(ident.body.error).toBe('not_authorized_in_mode');
      const login = await c.post('/api/auth/dev-login', { person_id: 'avery' });
      expect(login.status, mode).toBe(403);
      expect(login.body.error).toBe('not_authorized_in_mode');
      expect(c.cookie).toBeNull();
      expect(countRows(h.db, 'users', 'is_dev_identity = 1')).toBeGreaterThan(0);
    }
  });

  it('are refused in local mode unless KADODE_DEV_IDENTITIES is set', async () => {
    const off = await harness({ mode: 'local' });
    const c1 = new Client(off.app);
    expect((await c1.get('/api/auth/identities')).body.error).toBe('not_authorized_in_mode');
    expect((await c1.post('/api/auth/dev-login', { person_id: 'avery' })).status).toBe(403);

    const on = await harness({ mode: 'local', devIdentities: true });
    const c2 = new Client(on.app);
    expect((await c2.get('/api/auth/identities')).status).toBe(200);
    await c2.devLogin('avery');
    expect((await c2.get('/api/me')).body.mode).toBe('local');
  });

  it('a stale session of a development identity stops working when the app runs in production', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    expect((await c.get('/api/me')).status).toBe(200);
    const sameDb = await buildApp({ db: h.db, mode: 'production', dataDir: h.dir, taskAdapter: h.adapter, publicOrigin: ORIGIN });
    try {
      const res = await sameDb.inject({ method: 'GET', url: '/api/me', headers: { host: HOST, cookie: c.cookie! } });
      expect(res.statusCode).toBe(401);
    } finally {
      await sameDb.close();
    }
  });

  it('a development identity with a password still cannot sign in with it in production', async () => {
    const h = await harness({ mode: 'production' });
    await givePassword(h.db, 'dev-avery');
    const res = await new Client(h.app).passwordLogin('dev-avery');
    expect(res.status).toBe(401);
  });

  it('buildApp refuses an unsafe production configuration', async () => {
    const h = await harness();
    await expect(buildApp({ db: h.db, mode: 'production', dataDir: h.dir, devIdentities: true })).rejects.toThrow(/Development identities/);
    await expect(buildApp({ db: h.db, mode: 'staging', dataDir: h.dir, cookieSecure: false })).rejects.toThrow(/secure cookies/);
    await expect(buildApp({ db: h.db, mode: 'production', dataDir: h.dir, allowMissingOrigin: true })).rejects.toThrow(/allowMissingOrigin/);
  });
});

describe('startup rules (runtime config)', () => {
  const base = { KADODE_COOKIE_SECURE: '1' };
  it('refuses production/staging with dev identities or without secure cookies', () => {
    expect(() => resolveRuntimeConfig({ ...base, KADODE_MODE: 'production', KADODE_DEV_IDENTITIES: '1' })).toThrow(/KADODE_DEV_IDENTITIES/);
    expect(() => resolveRuntimeConfig({ KADODE_MODE: 'staging' })).toThrow(/KADODE_COOKIE_SECURE/);
    expect(() => resolveRuntimeConfig({ KADODE_MODE: 'production', KADODE_COOKIE_SECURE: 'false' })).toThrow(/KADODE_COOKIE_SECURE/);
    expect(resolveRuntimeConfig({ ...base, KADODE_MODE: 'production' }).mode).toBe('production');
  });
  it('defaults to local-demo on loopback with its own database file', () => {
    const cfg = resolveRuntimeConfig({}, '/work/project');
    expect(cfg).toMatchObject({ mode: 'local-demo', host: '127.0.0.1', port: 8787 });
    expect(cfg.dbPath).toBe('/work/project/private/data/kadode-demo.db');
    expect(resolveRuntimeConfig({ KADODE_MODE: 'local' }, '/work/project').dbPath).toBe('/work/project/private/data/kadode.db');
  });
  it('binds beyond loopback only with KADODE_LAN=1, and warns', () => {
    expect(() => resolveRuntimeConfig({ HOST: '0.0.0.0' })).toThrow(/KADODE_LAN/);
    const lan = resolveRuntimeConfig({ KADODE_LAN: '1' });
    expect(lan.host).toBe('0.0.0.0');
    expect(lan.warnings.join(' ')).toMatch(/network/i);
  });
});

describe('password login', () => {
  it('hashes with scrypt and verifies', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong password!', hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, null)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'scrypt$999999999$8$1$AAAA$AAAA')).toBe(false);
  });

  it('signs in, returns a generic error otherwise, and works in production', async () => {
    const h = await harness({ mode: 'production' });
    await givePassword(h.db, 'dev-avery'); // dev identity: must still be refused
    // A real user for jun:
    h.db.prepare("UPDATE users SET is_dev_identity = 0 WHERE username = 'dev-jun'").run();
    await givePassword(h.db, 'dev-jun');
    const c = new Client(h.app);
    const bad = await c.passwordLogin('dev-jun', 'not the password 123');
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe('Invalid username or password');
    const unknown = await c.passwordLogin('nobody', PASSWORD);
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(bad.body.message);
    const ok = await c.passwordLogin('dev-jun');
    expect(ok.status).toBe(200);
    expect(ok.body.me.person.id).toBe('jun');
    expect(ok.cookies[0]).toMatchObject({ name: 'kadode_session', httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('rate-limits repeated failures per username and address, then recovers', async () => {
    const h = await harness();
    h.db.prepare("UPDATE users SET is_dev_identity = 0 WHERE username = 'dev-jun'").run();
    await givePassword(h.db, 'dev-jun');
    const c = new Client(h.app);
    for (let i = 0; i < 5; i += 1) expect((await c.passwordLogin('dev-jun', 'wrong wrong wrong')).status).toBe(401);
    const blocked = await c.passwordLogin('dev-jun', PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // A different username is not blocked by this bucket.
    expect((await c.passwordLogin('someone-else', 'wrong')).status).toBe(401);
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60 * 1000);
    expect((await c.passwordLogin('dev-jun', PASSWORD)).status).toBe(200);
  });
});

describe('sessions', () => {
  it('stores only a hash of the token and sets a hardened cookie', async () => {
    const h = await harness();
    const c = new Client(h.app);
    const res = await c.post('/api/auth/dev-login', { person_id: 'avery' });
    const cookie = res.cookies.find((x) => x.name === 'kadode_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie.secure).toBeFalsy(); // local-demo over plain http
    expect(cookie.value.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    const rows = h.db.prepare('SELECT * FROM sessions').all() as { id_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id_hash).not.toBe(cookie.value);
    expect(rows[0]!.id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(cookie.value);
  });

  it('marks the cookie Secure when configured', async () => {
    const h = await harness({ cookieSecure: true });
    const res = await new Client(h.app).post('/api/auth/dev-login', { person_id: 'avery' });
    expect(res.cookies.find((x) => x.name === 'kadode_session')!.secure).toBe(true);
  });

  it('slides while in use (14 days idle) but never lives past 30 days from creation', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const day = 24 * 60 * 60 * 1000;
    const at = (days: number) => {
      h.clock.now = new Date(new Date('2026-10-29T20:00:00.000Z').getTime() + days * day);
    };
    for (const d of [10, 20, 28]) {
      at(d);
      expect((await c.get('/api/me')).status, `day ${d}`).toBe(200); // each use extends the idle window
    }
    at(29.9);
    expect((await c.get('/api/me')).status).toBe(200);
    at(30.1);
    expect((await c.get('/api/me')).status).toBe(401); // absolute lifetime reached although it was used the day before
    expect(countRows(h.db, 'sessions')).toBe(0);
  });

  it('expires after 14 idle days', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const day = 24 * 60 * 60 * 1000;
    h.clock.now = new Date(h.clock.now.getTime() + 13 * day);
    expect((await c.get('/api/me')).status).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 14.1 * day);
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('the cookie lifetime follows the remaining session time', async () => {
    const h = await harness();
    const c = new Client(h.app);
    const login = await c.post('/api/auth/dev-login', { person_id: 'avery' });
    expect(login.cookies[0]!.maxAge).toBe(30 * 24 * 60 * 60);
    const day = 24 * 60 * 60 * 1000;
    const t0 = h.clock.now.getTime();
    h.clock.now = new Date(t0 + 12 * day);
    expect((await c.get('/api/me')).cookies[0]!.maxAge).toBe(14 * 24 * 60 * 60); // idle window
    h.clock.now = new Date(t0 + 20 * day);
    expect((await c.get('/api/me')).cookies[0]!.maxAge).toBe(10 * 24 * 60 * 60); // capped by the 30-day lifetime
  });

  it('logout ends the session on the server', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const token = c.cookie!;
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect(countRows(h.db, 'sessions')).toBe(0);
    const stale = new Client(h.app);
    stale.cookie = token;
    expect((await stale.get('/api/me')).status).toBe(401);
  });
});

describe('CSRF and request hygiene', () => {
  it('rejects mutating requests without a matching Origin', async () => {
    const h = await harness();
    const ok = await loginAs(h, 'avery');
    const noOrigin = new Client(h.app, { origin: null });
    noOrigin.cookie = ok.cookie;
    const res = await noOrigin.post('/api/records', { type: 'note', title: 'x', data: { body: 'x' } });
    expect(res.status).toBe(403);
    const cross = new Client(h.app, { origin: 'http://evil.example' });
    cross.cookie = ok.cookie;
    expect((await cross.post('/api/records', { type: 'note', title: 'x', data: { body: 'x' } })).status).toBe(403);
    expect((await cross.post('/api/auth/logout')).status).toBe(403);
    expect(countRows(h.db, 'records', "type = 'note'")).toBe(0);
    expect(countRows(h.db, 'sessions')).toBe(1);
  });

  it('rejects a non-JSON content type and cross-site fetch metadata', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const form = await c.request('POST', '/api/records', 'type=note', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(403);
    const plain = await c.request('POST', '/api/records', '{}', { 'content-type': 'text/plain' });
    expect(plain.status).toBe(403);
    const site = await c.request('POST', '/api/records', { type: 'note', title: 'x', data: { body: 'x' } }, { 'sec-fetch-site': 'cross-site' });
    expect(site.status).toBe(403);
  });

  it('accepts the same-origin Origin, an allowed dev origin, and (test flag) a missing Origin', async () => {
    const h = await harness({ allowedOrigins: ['http://localhost:5173'], allowMissingOrigin: true });
    const c = await loginAs(h, 'avery');
    const body = { type: 'note', title: 'hello', data: { body: 'hello' } };
    expect((await c.post('/api/records', body)).status).toBe(201);
    const dev = new Client(h.app, { origin: 'http://localhost:5173' });
    dev.cookie = c.cookie;
    expect((await dev.post('/api/records', body)).status).toBe(201);
    const bare = new Client(h.app, { origin: null });
    bare.cookie = c.cookie;
    expect((await bare.post('/api/records', body)).status).toBe(201);
    // Origin with a default port still matches the Host header.
    const withPort = new Client(h.app, { origin: 'http://kadode.test:80' });
    withPort.cookie = c.cookie;
    expect((await withPort.post('/api/records', body)).status).toBe(201);
  });

  it('sets strict security headers and never exposes X-Powered-By', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const res = await c.get('/api/snapshot');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('limits body size and rejects malformed JSON', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const big = await c.request('POST', '/api/records', JSON.stringify({ type: 'note', title: 'x', data: { body: 'y'.repeat(300 * 1024) } }));
    expect(big.status).toBe(413);
    const bad = await c.request('POST', '/api/records', '{not json');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('validation');
    const empty = await c.request('POST', '/api/auth/logout', '');
    expect(empty.status).toBe(200);
  });

  it('does not let a __proto__ key through', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const res = await c.request('POST', '/api/records', '{"type":"note","title":"x","data":{"body":"x"},"__proto__":{"polluted":true}}');
    expect(res.status).toBe(201);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('never logs request bodies, passwords, cookies or session tokens', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });
    const h = await harness({ logger: { level: 'trace', stream } });
    h.db.prepare("UPDATE users SET is_dev_identity = 0 WHERE username = 'dev-jun'").run();
    await givePassword(h.db, 'dev-jun');
    const c = new Client(h.app);
    await c.passwordLogin('dev-jun', 'a-very-secret-login-phrase');
    const login = await c.passwordLogin('dev-jun', PASSWORD);
    expect(login.status).toBe(200);
    const token = c.cookie!.split('=')[1]!;
    await c.post('/api/records', { type: 'note', title: 'private diary title', data: { body: 'top secret note body' }, visibility: 'private' });
    await c.get('/api/snapshot?probe=querystring-secret');
    await c.get('/api/nope-with-error');
    const log = chunks.join('');
    expect(log.length).toBeGreaterThan(100);
    for (const secret of ['a-very-secret-login-phrase', PASSWORD, token, 'top secret note body', 'private diary title', 'querystring-secret']) {
      expect(log, secret).not.toContain(secret);
    }
  });
});
