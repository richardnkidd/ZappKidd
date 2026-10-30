import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureTaskAdapter, ScriptTaskAdapter, SnapshotTaskAdapter } from '../../src/server/tasks';
import { parseFailure } from '../../src/server/tasks/fixture';
import { DEMO_HOUSEHOLD_ID, countRows, loginAs, makeHarness, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const fixture = (h: Harness) => h.adapter as FixtureTaskAdapter;
const store = (h: Harness) => JSON.parse(readFileSync(join(h.dir, 'task-fixture-store.json'), 'utf8')) as { tasks: { id: string; title: string; due: string | null; status: string; revision: number; notes: string | null }[] };
const journal = (h: Harness, linkId: string) =>
  h.db.prepare('SELECT operation, outcome FROM task_sync_journal WHERE task_link_id = ? ORDER BY rowid').all(linkId) as { operation: string; outcome: string }[];

describe('fixture adapter: propose -> capture -> readback -> synced', () => {
  it('creates in the store, reads it back, and only then marks the link synced', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const res = await c.post('/api/tasks', { title: 'Call the shipping company', record_id: 'milestone:W06', owner: 'avery', due_mode: 'explicit', due: '2026-12-01' });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('synced');
    const t = res.body.task;
    expect(t).toMatchObject({
      title: 'Call the shipping company',
      due: '2026-12-01',
      due_basis: 'explicit',
      sync_state: 'synced',
      adapter: 'fixture',
      canonical_id: 'FX-0004',
      record_id: 'milestone:W06',
      owner: 'avery',
      status: 'open',
      remote_revision: '1',
      last_error: null,
      pending_changes: null,
    });
    expect(t.last_synced_at).toBe('2026-10-29T20:00:00.000Z');
    expect(store(h).tasks.find((x) => x.id === 'FX-0004')).toMatchObject({ title: 'Call the shipping company', due: '2026-12-01', status: 'open' });
    expect(journal(h, t.id)).toEqual([{ operation: 'create', outcome: 'ok' }, { operation: 'readback', outcome: 'ok' }]);
    const actions = (await c.get('/api/audit?record_id=milestone:W06')).body.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['task_propose', 'task_sync']));
    const list = (await c.get('/api/tasks')).body;
    expect(list.adapter).toMatchObject({ name: 'fixture', can_write: true });
    expect(list.task_links.map((x: any) => x.id)).toContain(t.id);
  });

  it('default due is 14 days after creation in the household timezone; blank stays null; explicit is kept', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    // 2026-10-29T20:00Z is still 10-29 in Honolulu (home timezone) -> +14 = 2026-11-12.
    const def = (await c.post('/api/tasks', { title: 'Default due', due_mode: 'default' })).body.task;
    expect(def).toMatchObject({ due: '2026-11-12', due_basis: 'default_14_days', sync_state: 'synced' });
    // 2026-10-30T07:00Z: Tokyo is already 10-30 16:00, Honolulu is 10-29 21:00. The household zone (Honolulu) decides.
    h.clock.now = new Date('2026-10-30T07:00:00.000Z');
    const edge = (await c.post('/api/tasks', { title: 'Edge of day', due_mode: 'default' })).body.task;
    expect(edge.due).toBe('2026-11-12');
    h.clock.now = new Date('2026-10-30T11:00:00.000Z'); // Honolulu 10-30 01:00
    const next = (await c.post('/api/tasks', { title: 'Next day', due_mode: 'default' })).body.task;
    expect(next.due).toBe('2026-11-13');
    const blank = (await c.post('/api/tasks', { title: 'No due date', due_mode: 'blank' })).body.task;
    expect(blank).toMatchObject({ due: null, due_basis: 'left_blank', sync_state: 'synced' });
    expect(store(h).tasks.find((x) => x.id === blank.canonical_id)!.due).toBeNull();
    const explicit = (await c.post('/api/tasks', { title: 'Explicit', due_mode: 'explicit', due: '2027-02-01' })).body.task;
    expect(explicit).toMatchObject({ due: '2027-02-01', due_basis: 'explicit' });
  });

  it('never recalculates existing due dates', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const before = (await c.get('/api/tasks')).body.task_links.map((t: any) => [t.id, t.due, t.due_basis]);
    await c.post('/api/tasks', { title: 'New one', due_mode: 'default' });
    h.clock.now = new Date('2026-11-20T00:00:00.000Z');
    await c.post('/api/tasks/sync', {});
    const after = (await c.get('/api/tasks')).body.task_links.filter((t: any) => before.some((b: any) => b[0] === t.id)).map((t: any) => [t.id, t.due, t.due_basis]);
    expect(after.sort()).toEqual(before.sort());
  });

  it('validates the proposal', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const rows = countRows(h.db, 'task_links');
    const bad: Record<string, unknown>[] = [
      { title: 'x', due_mode: 'explicit' },
      { title: 'x', due_mode: 'default', due: '2026-12-01' },
      { title: 'x', due_mode: 'blank', due: '2026-12-01' },
      { title: 'x', due_mode: 'explicit', due: '2026-13-01' },
      { title: '', due_mode: 'blank' },
      { title: 'x' },
      { title: 'x', due_mode: 'blank', owner: 'nobody' },
      { title: 'x', due_mode: 'blank', record_id: 'milestone:NOPE' },
      { title: 'x', due_mode: 'blank', sync_state: 'synced' },
    ];
    for (const body of bad) expect((await c.post('/api/tasks', body)).status, JSON.stringify(body)).toBe(422);
    expect(countRows(h.db, 'task_links')).toBe(rows);
    expect(store(h).tasks).toHaveLength(3);
  });

  it('edits through the adapter with readback and bumps the revision', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const t = (await c.post('/api/tasks', { title: 'Original title', due_mode: 'explicit', due: '2026-12-01' })).body.task;
    const res = await c.patch(`/api/tasks/${t.id}`, { baseVersion: t.version, changes: { title: 'Better title', due: '2026-12-15', notes: 'Bring the receipt' } });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('synced');
    expect(res.body.task).toMatchObject({ title: 'Better title', due: '2026-12-15', due_basis: 'explicit', notes: 'Bring the receipt', sync_state: 'synced', remote_revision: '2', pending_changes: null });
    expect(store(h).tasks.find((x) => x.id === t.canonical_id)).toMatchObject({ title: 'Better title', due: '2026-12-15', revision: 2 });
    // Stale version is refused.
    const stale = await c.patch(`/api/tasks/${t.id}`, { baseVersion: t.version, changes: { title: 'Stale' } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('conflict');
    expect(stale.body.details.task_link.title).toBe('Better title');
    // Clearing the due date records that it was left blank.
    const blank = await c.patch(`/api/tasks/${t.id}`, { baseVersion: res.body.task.version, changes: { due: null } });
    expect(blank.body.task).toMatchObject({ due: null, due_basis: 'left_blank', sync_state: 'synced' });
    expect((await c.patch(`/api/tasks/${t.id}`, { baseVersion: blank.body.task.version, changes: {} })).status).toBe(422);
    expect((await c.patch(`/api/tasks/${t.id}`, { baseVersion: blank.body.task.version, changes: { sync_state: 'synced' } })).status).toBe(422);
  });

  it('completes with evidence, via the adapter, and reads it back', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const t = (await c.post('/api/tasks', { title: 'Mail the form', due_mode: 'blank' })).body.task;
    expect((await c.post(`/api/tasks/${t.id}/complete`, { baseVersion: t.version })).status).toBe(422);
    expect((await c.post(`/api/tasks/${t.id}/complete`, { baseVersion: t.version, evidence: '  ' })).status).toBe(422);
    const res = await c.post(`/api/tasks/${t.id}/complete`, { baseVersion: t.version, evidence: 'Postal receipt in the folder' });
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ status: 'done', sync_state: 'synced', pending_changes: null });
    const remote = store(h).tasks.find((x) => x.id === t.canonical_id)!;
    expect(remote.status).toBe('done');
    expect(remote.notes).toContain('Postal receipt in the folder');
    const audit = (await c.get('/api/audit?limit=20')).body.entries.find((e: any) => e.action === 'task_complete');
    expect(audit).toMatchObject({ actor: 'avery', reason: 'Postal receipt in the folder' });
    expect(journal(h, t.id).map((j) => j.operation)).toEqual(['create', 'readback', 'complete', 'readback']);
  });
});

describe('fixture adapter: failures, retry and conflicts', () => {
  it('a failed create becomes an error, retry captures it exactly once', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    fixture(h).failNext = 'create';
    const res = await c.post('/api/tasks', { title: 'Will fail first', due_mode: 'blank' });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('error');
    expect(res.body.task).toMatchObject({ sync_state: 'error', canonical_id: null });
    expect(res.body.task.last_error).toMatch(/failure/i);
    expect(store(h).tasks).toHaveLength(3);
    expect(journal(h, res.body.task.id)).toEqual([{ operation: 'create', outcome: 'error' }]);

    const retry = await c.post(`/api/tasks/${res.body.task.id}/retry`, {});
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe('synced');
    expect(retry.body.task).toMatchObject({ sync_state: 'synced', canonical_id: 'FX-0004', last_error: null });
    expect(store(h).tasks).toHaveLength(4);
    // Retrying a synced row is a no-op: no duplicate in the store.
    expect((await c.post(`/api/tasks/${res.body.task.id}/retry`, {})).body.outcome).toBe('synced');
    expect(store(h).tasks).toHaveLength(4);
  });

  it('a failed readback keeps the created id; retry verifies without creating a duplicate', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    fixture(h).failNext = 'readback';
    const res = await c.post('/api/tasks', { title: 'Readback hiccup', due_mode: 'explicit', due: '2026-12-20' });
    expect(res.body.outcome).toBe('error');
    expect(res.body.task).toMatchObject({ sync_state: 'error', canonical_id: 'FX-0004' });
    expect(res.body.task.last_error).toMatch(/reading it back/);
    expect(store(h).tasks).toHaveLength(4);
    const retry = await c.post(`/api/tasks/${res.body.task.id}/retry`, {});
    expect(retry.body.task).toMatchObject({ sync_state: 'synced', canonical_id: 'FX-0004' });
    expect(store(h).tasks).toHaveLength(4);
  });

  it('refresh takes the store\'s version when it drifted behind the app\'s back', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const t = (await c.post('/api/tasks', { title: 'Will drift', due_mode: 'explicit', due: '2026-12-20' })).body.task;
    fixture(h).mutateExternally(t.canonical_id, { due: '2026-12-31' });
    const sync = await c.post('/api/tasks/sync', {});
    expect(sync.body.refreshed).toBeGreaterThan(0);
    const refreshed = sync.body.task_links.find((x: any) => x.id === t.id);
    expect(refreshed).toMatchObject({ due: '2026-12-31', sync_state: 'synced', remote_revision: '2' }); // store wins on refresh
  });

  it('a readback that does not match what was sent is an error, never synced', async () => {
    class Drifting extends FixtureTaskAdapter {
      override async get(id: string) {
        const t = await super.get(id);
        return t ? { ...t, due: '2030-01-01' } : t;
      }
    }
    const dir = (await harness()).dir;
    const h = await harness({ adapter: new Drifting({ dataDir: dir }), dbPath: undefined });
    const c = await loginAs(h, 'avery');
    const res = await c.post('/api/tasks', { title: 'Mismatch', due_mode: 'explicit', due: '2026-12-01' });
    expect(res.body.outcome).toBe('error');
    expect(res.body.task).toMatchObject({ sync_state: 'error', last_synced_at: null });
    expect(res.body.task.last_error).toMatch(/did not match/);
    expect(journal(h, res.body.task.id).map((j) => j.outcome)).toEqual(['ok', 'mismatch']);
  });

  it('a failed update keeps the requested change for retry', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const t = (await c.post('/api/tasks', { title: 'Before', due_mode: 'blank' })).body.task;
    fixture(h).failNext = 'update';
    const res = await c.patch(`/api/tasks/${t.id}`, { baseVersion: t.version, changes: { title: 'After' } });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('error');
    expect(res.body.task).toMatchObject({ title: 'Before', sync_state: 'error', pending_changes: { title: 'After' } });
    expect(store(h).tasks.find((x) => x.id === t.canonical_id)!.title).toBe('Before');
    const retry = await c.post(`/api/tasks/${t.id}/retry`, {});
    expect(retry.body.task).toMatchObject({ title: 'After', sync_state: 'synced', pending_changes: null });
    expect(store(h).tasks.find((x) => x.id === t.canonical_id)!.title).toBe('After');
  });

  it('a failed completion can be retried', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const t = (await c.post('/api/tasks', { title: 'Finish me', due_mode: 'blank' })).body.task;
    fixture(h).failNext = 'complete';
    const res = await c.post(`/api/tasks/${t.id}/complete`, { baseVersion: t.version, evidence: 'Proof' });
    expect(res.body.outcome).toBe('error');
    expect(res.body.task.status).toBe('open');
    const retry = await c.post(`/api/tasks/${t.id}/retry`, {});
    expect(retry.body.task).toMatchObject({ status: 'done', sync_state: 'synced' });
  });

  it('an edit against a task changed in the store is a conflict and overwrites nothing', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const t = (await c.post('/api/tasks', { title: 'Shared task', due_mode: 'blank' })).body.task;
    fixture(h).mutateExternally(t.canonical_id, { title: 'Changed in the task system' });
    const res = await c.patch(`/api/tasks/${t.id}`, { baseVersion: t.version, changes: { title: 'My edit' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conflict');
    expect(res.body.details.task_link).toMatchObject({ sync_state: 'conflict' });
    expect(res.body.details.remote_task.title).toBe('Changed in the task system');
    expect(store(h).tasks.find((x) => x.id === t.canonical_id)!.title).toBe('Changed in the task system');
    const retry = await c.post(`/api/tasks/${t.id}/retry`, {});
    expect(retry.status).toBe(409);
    // Refreshing takes the store's version; then the edit can be re-applied.
    const sync = await c.post('/api/tasks/sync', {});
    const link = sync.body.task_links.find((x: any) => x.id === t.id);
    expect(link).toMatchObject({ title: 'Changed in the task system', sync_state: 'synced' });
    const again = await c.patch(`/api/tasks/${t.id}`, { baseVersion: link.version, changes: { title: 'My edit' } });
    expect(again.body.task).toMatchObject({ title: 'My edit', sync_state: 'synced' });
  });

  it('a task missing from the store is reported on refresh', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    h.db.prepare("UPDATE task_links SET canonical_id = 'FX-9999' WHERE id = 'tl-fixture-FX-0001'").run();
    const sync = await c.post('/api/tasks/sync', {});
    expect(sync.body.failed).toBe(1);
    expect(sync.body.task_links.find((x: any) => x.id === 'tl-fixture-FX-0001')).toMatchObject({ sync_state: 'error' });
  });
});

describe('snapshot adapter (read-only)', () => {
  it('leaves proposals pending capture, allows editing the proposal, refuses everything else', async () => {
    const h = await harness();
    h.db.prepare("UPDATE task_links SET adapter = 'snapshot', sync_state = 'snapshot'").run();
    const snapshotAdapter = new SnapshotTaskAdapter(h.db);
    const h2 = await harness({ adapter: snapshotAdapter, dbPath: h.dbPath, dir: h.dir, seed: false });
    const c = await loginAs(h2, 'avery');

    const res = await c.post('/api/tasks', { title: 'Needs a writer', due_mode: 'default', record_id: 'milestone:W06' });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('pending_capture');
    expect(res.body.task).toMatchObject({ sync_state: 'pending_capture', canonical_id: null, last_error: null, due: '2026-11-12', adapter: 'snapshot' });
    expect(res.body.adapter).toMatchObject({ name: 'snapshot', can_write: false });
    expect(journal(h2, res.body.task.id)).toEqual([{ operation: 'create', outcome: 'ok' }]);
    expect(existsSync(join(h2.dir, 'task-fixture-store.json'))).toBe(true); // created by the first harness only

    // The proposal itself can be edited locally and stays pending.
    const edit = await c.patch(`/api/tasks/${res.body.task.id}`, { baseVersion: res.body.task.version, changes: { title: 'Needs a writer (edited)', due: '2026-12-31' } });
    expect(edit.status).toBe(200);
    expect(edit.body.task).toMatchObject({ title: 'Needs a writer (edited)', due: '2026-12-31', due_basis: 'explicit', sync_state: 'pending_capture' });

    // Not authorized: retry, complete and editing a snapshot copy of a real task.
    expect((await c.post(`/api/tasks/${res.body.task.id}/retry`, {})).status).toBe(403);
    expect((await c.post(`/api/tasks/${res.body.task.id}/complete`, { baseVersion: edit.body.task.version, evidence: 'x' })).status).toBe(403);
    const snap = (await c.get('/api/tasks')).body.task_links.find((x: any) => x.id === 'tl-fixture-FX-0001');
    const denied = await c.patch('/api/tasks/tl-fixture-FX-0001', { baseVersion: snap.version, changes: { title: 'nope' } });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/not authorized/i);
    expect((await c.post('/api/tasks/tl-fixture-FX-0001/complete', { baseVersion: snap.version, evidence: 'x' })).status).toBe(403);
    // Sync is a harmless no-op.
    const sync = await c.post('/api/tasks/sync', {});
    expect(sync.body).toMatchObject({ refreshed: 0, skipped_reason: 'read_only_adapter' });
  });

  it('every adapter-level write throws "not authorized"', async () => {
    const h = await harness();
    const a = new SnapshotTaskAdapter(h.db);
    expect(a.canWrite).toBe(false);
    await expect(a.create({ title: 'x', due: null })).rejects.toThrow(/not authorized/i);
    await expect(a.update('FX-0001', { title: 'x' })).rejects.toThrow(/not authorized/i);
    await expect(a.complete('FX-0001', 'e')).rejects.toThrow(/not authorized/i);
    h.db.prepare("UPDATE task_links SET adapter = 'snapshot'").run();
    const scoped = a.scope!(DEMO_HOUSEHOLD_ID);
    expect((await scoped.list()).map((t) => t.id).sort()).toEqual(['FX-0001', 'FX-0002', 'FX-0003']);
    expect(await scoped.get('FX-0001')).toMatchObject({ id: 'FX-0001', status: 'open', revision: 1 });
    expect(await a.scope!('other-household').list()).toEqual([]);
  });
});

describe('script adapter stub', () => {
  it('refuses unless live writes are approved and a command is configured - and even then is not enabled in this build', async () => {
    for (const config of [
      { command: null, liveWrites: undefined },
      { command: 'task-cli', liveWrites: undefined },
      { command: null, liveWrites: 'approved' },
      { command: 'task-cli', liveWrites: 'approved' },
    ]) {
      const a = new ScriptTaskAdapter(config);
      expect(a.canWrite).toBe(false);
      await expect(a.create({ title: 'x', due: null })).rejects.toThrow(/not authorized/i);
      await expect(a.update('1', {})).rejects.toThrow(/not authorized/i);
      await expect(a.complete('1', 'e')).rejects.toThrow(/not authorized/i);
      await expect(a.list()).rejects.toThrow(/not authorized/i);
      await expect(a.get('1')).rejects.toThrow(/not authorized/i);
    }
  });
});

describe('fixture store file', () => {
  it('is seeded from the demo fixture, written atomically and survives a new adapter instance', async () => {
    const h = await harness();
    const file = join(h.dir, 'task-fixture-store.json');
    expect(existsSync(file)).toBe(true);
    expect(store(h).tasks.map((t) => t.id)).toEqual(['FX-0001', 'FX-0002', 'FX-0003']);
    const created = await fixture(h).create({ title: 'Persisted', due: '2027-01-01' });
    expect(created.revision).toBe(1);
    const again = new FixtureTaskAdapter({ dataDir: h.dir });
    expect((await again.get(created.id))?.title).toBe('Persisted');
    expect((await again.create({ title: 'Second', due: null })).id).toBe('FX-0005');
    expect(existsSync(`${file}.tmp`)).toBe(false);
    expect((await again.update(created.id, { title: 'x' }, 99).catch((e) => e.code))).toBe('revision_conflict');
  });

  it('parses the failure-injection setting', () => {
    expect(parseFailure('create')).toBe('create');
    expect(parseFailure('readback')).toBe('readback');
    expect(parseFailure('explode')).toBeNull();
    expect(parseFailure(undefined)).toBeNull();
  });
});
