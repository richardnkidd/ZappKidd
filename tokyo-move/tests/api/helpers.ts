/**
 * Shared helpers for API tests. All data is the FICTIONAL demo household (fixtures/demo) plus a tiny second
 * household invented here. Databases are temporary files under os.tmpdir().
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/server/app';
import { openDb, type Db } from '../../src/server/db/db';
import { createUser, ensureDevIdentities, setUserPassword } from '../../src/server/auth/users';
import { applyBundle } from '../../src/import/apply';
import { buildDemoBundle, DEMO_HOUSEHOLD_ID } from '../../fixtures/demo/bundle';
import type { AppMode } from '../../src/shared/types';
import { FixtureTaskAdapter } from '../../src/server/tasks/fixture';
import type { TaskAdapter } from '../../src/server/tasks/adapter';

export const HOST = 'kadode.test';
export const ORIGIN = `http://${HOST}`;
export const PASSWORD = 'correct horse battery staple';
export const OTHER_HOUSEHOLD_ID = 'other-household';

export interface Harness {
  app: FastifyInstance;
  db: Db;
  dir: string;
  dbPath: string;
  clock: { now: Date };
  adapter: TaskAdapter;
  close(): Promise<void>;
}

export interface HarnessOptions extends Partial<Omit<BuildAppOptions, 'db' | 'dataDir'>> {
  /** Reuse an existing DB file path (persistence tests). */
  dbPath?: string;
  dir?: string;
  seed?: boolean;
  /** Add a second, unrelated household with one adult. */
  secondHousehold?: boolean;
  adapter?: 'fixture' | TaskAdapter;
}

export const START = new Date('2026-10-29T20:00:00.000Z');

export function insertSecondHousehold(db: Db): void {
  const at = '2026-10-01T00:00:00.000Z';
  db.prepare(
    "INSERT INTO households (id, name, home_timezone, display_timezone, data_label, created_at) VALUES (?, 'Other test household', 'Asia/Tokyo', 'Asia/Tokyo', 'Fictional second household', ?)",
  ).run(OTHER_HOUSEHOLD_ID, at);
  db.prepare("INSERT INTO people (id, household_id, display_name, kind, aliases, descriptor, anchors) VALUES ('zed', ?, 'Zed', 'adult', '[]', NULL, '{}')").run(OTHER_HOUSEHOLD_ID);
  db.prepare(
    `INSERT INTO records (id, household_id, type, key, title, status, owner, owner_proposed, visibility, created_by, data, source, locally_edited, version, created_at, updated_at, updated_by)
     VALUES ('note:Z1', ?, 'note', 'Z1', 'Zed note', 'active', NULL, 0, 'household', 'zed', '{"body":"Only the second household should see this","linked_record_id":null}', NULL, '[]', 1, ?, ?, 'zed')`,
  ).run(OTHER_HOUSEHOLD_ID, at, at);
  createUser(db, { householdId: OTHER_HOUSEHOLD_ID, personId: 'zed', username: 'zed' });
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'kadode-api-'));
  const dbPath = opts.dbPath ?? join(dir, 'kadode.db');
  const db = openDb(dbPath);
  const clock = { now: new Date(START) };
  if (opts.seed !== false) {
    const households = db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number };
    if (households.n === 0) {
      applyBundle(db, buildDemoBundle(), { actor: 'system', now: new Date(START) });
      ensureDevIdentities(db, DEMO_HOUSEHOLD_ID);
      if (opts.secondHousehold) insertSecondHousehold(db);
    }
  }
  const adapter: TaskAdapter =
    opts.adapter && opts.adapter !== 'fixture' ? opts.adapter : new FixtureTaskAdapter({ dataDir: dir, today: () => '2026-10-29' });
  const { dbPath: _p, dir: _d, seed: _s, secondHousehold: _h, adapter: _a, ...rest } = opts;
  const app = await buildApp({
    db,
    mode: 'local-demo' as AppMode,
    dataDir: dir,
    now: () => new Date(clock.now),
    taskAdapter: adapter,
    allowMissingOrigin: false,
    ...rest,
  });
  return {
    app,
    db,
    dir,
    dbPath,
    clock,
    adapter,
    async close() {
      await app.close();
      if (db.open) db.close();
      if (!opts.dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Reply<T = any> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | undefined>;
  raw: string;
  cookies: { name: string; value: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number }[];
}

/** A tiny HTTP client over app.inject that behaves like a browser: Host, Origin, JSON and a cookie jar. */
export class Client {
  cookie: string | null = null;
  constructor(
    readonly app: FastifyInstance,
    readonly opts: { origin?: string | null; host?: string } = {},
  ) {}

  async request<T = any>(method: InjectOptions['method'], url: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply<T>> {
    const headers: Record<string, string> = { host: this.opts.host ?? HOST, ...extra };
    const origin = this.opts.origin === undefined ? ORIGIN : this.opts.origin;
    if (origin !== null && method !== 'GET') headers.origin = origin;
    if (method !== 'GET' && headers['content-type'] === undefined) headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    const res = await this.app.inject({
      method,
      url,
      headers,
      ...(body === undefined ? {} : { payload: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    for (const c of res.cookies) {
      if (c.name === 'kadode_session') this.cookie = c.value === '' || (c.maxAge === 0) ? null : `kadode_session=${c.value}`;
    }
    let parsed: any = null;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      parsed = null;
    }
    return { status: res.statusCode, body: parsed, headers: res.headers as Reply['headers'], raw: res.body, cookies: res.cookies as Reply['cookies'] };
  }

  get = <T = any>(url: string) => this.request<T>('GET', url);
  post = <T = any>(url: string, body: unknown = {}) => this.request<T>('POST', url, body);
  patch = <T = any>(url: string, body: unknown) => this.request<T>('PATCH', url, body);
  put = <T = any>(url: string, body: unknown) => this.request<T>('PUT', url, body);

  /** Development-identity sign-in (local-demo). */
  async devLogin(personId: string, householdId?: string): Promise<this> {
    const res = await this.post('/api/auth/dev-login', { person_id: personId, ...(householdId ? { household_id: householdId } : {}) });
    if (res.status !== 200) throw new Error(`dev-login failed: ${res.status} ${res.raw}`);
    return this;
  }

  async passwordLogin(username: string, password = PASSWORD): Promise<Reply> {
    return this.post('/api/auth/login', { username, password });
  }
}

export async function loginAs(h: Harness, personId: string): Promise<Client> {
  return new Client(h.app).devLogin(personId);
}

/** Give a user a real password (for password-login tests). */
export async function givePassword(db: Db, username: string, password = PASSWORD): Promise<void> {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string };
  await setUserPassword(db, user.id, password);
}

export function recordRow(db: Db, id: string, householdId = DEMO_HOUSEHOLD_ID): any {
  return db.prepare('SELECT * FROM records WHERE household_id = ? AND id = ?').get(householdId, id);
}

export function countRows(db: Db, table: string, where = '1=1'): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
}
export { DEMO_HOUSEHOLD_ID };
