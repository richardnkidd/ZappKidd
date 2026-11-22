import { afterEach, describe, expect, it } from 'vitest';
import { ensureDevIdentities, listDevIdentities } from '../../src/server/auth/users';
import { Client, DEMO_HOUSEHOLD_ID, OTHER_HOUSEHOLD_ID, countRows, givePassword, loginAs, makeHarness, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('import receipts', () => {
  it('lists runs and the changes of a run, and attaches receipts to a record', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const runs = (await c.get('/api/import/runs')).body.runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ source_label: 'Fictional demo' });
    const page = (await c.get(`/api/import/runs/${runs[0].id}/changes?limit=5&offset=0`)).body;
    expect(page.run.id).toBe(runs[0].id);
    expect(page.changes).toHaveLength(5);
    expect(page.total).toBeGreaterThan(100);
    expect((await c.get(`/api/import/runs/${runs[0].id}/changes?limit=5000`)).status).toBe(422);
    expect((await c.get('/api/import/runs/nope/changes')).status).toBe(404);
    const detail = (await c.get('/api/records/milestone:W06')).body;
    expect(detail.import_changes.length).toBeGreaterThan(0);
    expect(detail.import_changes.every((x: any) => x.record_id === 'milestone:W06')).toBe(true);
  });

  it('does not show another household\'s runs', async () => {
    const h = await harness({ secondHousehold: true });
    await givePassword(h.db, 'zed');
    const z = new Client(h.app);
    await z.passwordLogin('zed');
    expect((await z.get('/api/import/runs')).body.runs).toEqual([]);
    const runId = (h.db.prepare('SELECT id FROM import_runs').get() as { id: string }).id;
    expect((await z.get(`/api/import/runs/${runId}/changes`)).status).toBe(404);
  });
});

describe('development identity bookkeeping', () => {
  it('creates one identity per adult, idempotently, and never for pets', async () => {
    const h = await harness();
    const before = countRows(h.db, 'users');
    const again = ensureDevIdentities(h.db, DEMO_HOUSEHOLD_ID);
    expect(countRows(h.db, 'users')).toBe(before);
    expect(again.map((i) => i.person_id)).toEqual(['avery', 'jun']);
    const rows = h.db.prepare('SELECT username, is_dev_identity, password_hash FROM users ORDER BY username').all() as any[];
    expect(rows.map((r) => r.username)).toEqual(['dev-avery', 'dev-jun']);
    for (const r of rows) expect(r).toMatchObject({ is_dev_identity: 1, password_hash: null });
  });

  it('keeps usernames unique across households and asks which household when a person id is ambiguous', async () => {
    const h = await harness({ secondHousehold: true });
    // A second household that also has an adult named "avery".
    h.db.prepare("INSERT INTO people (id, household_id, display_name, kind, aliases, descriptor, anchors) VALUES ('avery', ?, 'Another Avery', 'adult', '[]', NULL, '{}')").run(OTHER_HOUSEHOLD_ID);
    const created = ensureDevIdentities(h.db, OTHER_HOUSEHOLD_ID);
    expect(created.map((i) => i.username).sort()).toEqual(['dev-other-household-avery', 'dev-zed']);
    expect(created.find((i) => i.person_id === 'avery')!.username).toBe('dev-other-household-avery');
    expect(listDevIdentities(h.db).length).toBe(4);
    const c = new Client(h.app);
    const ambiguous = await c.post('/api/auth/dev-login', { person_id: 'avery' });
    expect(ambiguous.status).toBe(422);
    const ok = await c.post('/api/auth/dev-login', { person_id: 'avery', household_id: OTHER_HOUSEHOLD_ID });
    expect(ok.status).toBe(200);
    expect(ok.body.me.household.id).toBe(OTHER_HOUSEHOLD_ID);
    expect((await c.get('/api/snapshot')).body.records.map((r: any) => r.id)).toEqual(['note:Z1']);
    expect((await new Client(h.app).post('/api/auth/dev-login', { person_id: 'nobody' })).status).toBe(404);
  });
});
