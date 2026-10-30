import { afterEach, describe, expect, it } from 'vitest';
import { countRows, loginAs, makeHarness, recordRow, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('audit trail', () => {
  it('lists newest first with before/after, filters by record, since and limit', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const v1 = (await c.get('/api/records/milestone:W06')).body.record.version;
    h.clock.now = new Date('2026-10-30T01:00:00.000Z');
    const e1 = await c.patch('/api/records/milestone:W06', { baseVersion: v1, changes: { title: 'First rename' } });
    h.clock.now = new Date('2026-10-30T02:00:00.000Z');
    const e2 = await c.patch('/api/records/milestone:W06', { baseVersion: e1.body.record.version, changes: { title: 'Second rename' } });
    h.clock.now = new Date('2026-10-30T03:00:00.000Z');
    await c.patch('/api/records/milestone:W07', { baseVersion: 1, changes: { title: 'Other' } });

    const one = (await c.get('/api/audit?record_id=milestone:W06')).body.entries;
    expect(one.slice(0, 2).map((e: any) => [e.action, e.after.title])).toEqual([['update', 'Second rename'], ['update', 'First rename']]);
    expect(one[0].before.title).toBe('First rename');
    expect(one[0]).toMatchObject({ actor: 'avery', record_id: 'milestone:W06', at: '2026-10-30T02:00:00.000Z', undone_by: null });
    expect(one.at(-1).action).toBe('import_create');

    const since = (await c.get('/api/audit?since=2026-10-30T01:30:00Z')).body.entries;
    expect(since.map((e: any) => e.after.title)).toEqual(['Other', 'Second rename']);
    const limited = (await c.get('/api/audit?limit=1')).body.entries;
    expect(limited).toHaveLength(1);
    expect(limited[0].after.title).toBe('Other');
    expect((await c.get('/api/audit?limit=0')).status).toBe(422);
    expect((await c.get('/api/audit?since=yesterday')).status).toBe(422);
    expect((await c.get('/api/audit?bogus=1')).status).toBe(422);
    expect((await c.get('/api/audit?record_id=milestone:NOPE')).status).toBe(404);
    void e2;
  });
});

describe('undo', () => {
  it('restores the previous state, records an undo entry and marks the original', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const before = (await c.get('/api/records/milestone:W06')).body.record;
    const edit = await c.patch('/api/records/milestone:W06', {
      baseVersion: before.version,
      changes: { title: 'Changed', data: { next_action: 'Changed action' } },
    });
    expect(edit.status).toBe(200);
    const entry = (await c.get('/api/audit?record_id=milestone:W06')).body.entries[0];

    const undo = await jun.post(`/api/audit/${entry.id}/undo`, { reason: 'Oops' });
    expect(undo.status).toBe(200);
    expect(undo.body.record.title).toBe(before.title);
    expect(undo.body.record.data.next_action).toBe(before.data.next_action);
    expect(undo.body.record.version).toBe(edit.body.record.version + 1);
    expect(undo.body.record.updated_by).toBe('jun');
    expect(undo.body.record.locally_edited).toEqual(before.locally_edited);
    const trail = (await c.get('/api/audit?record_id=milestone:W06')).body.entries;
    expect(trail[0]).toMatchObject({ action: 'undo', actor: 'jun', reason: 'Oops', id: undo.body.undo_entry_id });
    expect(trail[0].before.title).toBe('Changed');
    expect(trail[0].after.title).toBe(before.title);
    expect(trail.find((e: any) => e.id === entry.id).undone_by).toBe(undo.body.undo_entry_id);

    const again = await c.post(`/api/audit/${entry.id}/undo`, {});
    expect(again.status).toBe(409);
    expect(again.body.details.reason).toBe('already_undone');
  });

  it('is refused when the record changed after that entry', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const v = (await c.get('/api/records/milestone:W06')).body.record.version;
    const first = await c.patch('/api/records/milestone:W06', { baseVersion: v, changes: { title: 'One' } });
    const second = await c.patch('/api/records/milestone:W06', { baseVersion: first.body.record.version, changes: { title: 'Two' } });
    const entries = (await c.get('/api/audit?record_id=milestone:W06')).body.entries;
    const firstEntry = entries[1];
    expect(firstEntry.after.title).toBe('One');
    const refused = await c.post(`/api/audit/${firstEntry.id}/undo`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.details.reason).toBe('record_changed_since');
    expect(refused.body.details.server.title).toBe('Two');
    expect(recordRow(h.db, 'milestone:W06').title).toBe('Two');
    expect(recordRow(h.db, 'milestone:W06').version).toBe(second.body.record.version);
    // Undo newest first, then the older one becomes undoable.
    expect((await c.post(`/api/audit/${entries[0].id}/undo`, {})).status).toBe(200);
    expect((await c.post(`/api/audit/${firstEntry.id}/undo`, {})).status).toBe(200);
    expect(recordRow(h.db, 'milestone:W06').title).toBe((await c.get('/api/audit?record_id=milestone:W06&limit=500')).body.entries.at(-1).after.title);
  });

  it('can undo status changes, approvals and anchor changes', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = (await c.get('/api/records/milestone:W06')).body.record;
    const st = await c.post('/api/records/milestone:W06/status', { baseVersion: m.version, status: 'completed', evidence: 'Done' });
    const stEntry = (await c.get('/api/audit?record_id=milestone:W06')).body.entries[0];
    expect(stEntry.action).toBe('status_change');
    const undone = await c.post(`/api/audit/${stEntry.id}/undo`, {});
    expect(undone.body.record.status).toBe(m.status);
    expect(undone.body.record.data.completion_evidence).toEqual(m.data.completion_evidence);
    void st;

    const d = (await c.get('/api/records/decision:D02')).body.record;
    await c.post('/api/decisions/decision:D02/approve', { baseVersion: d.version, option_id: 'opt-1' });
    const apprEntry = (await c.get('/api/audit?record_id=decision:D02')).body.entries[0];
    const undoneApproval = await c.post(`/api/audit/${apprEntry.id}/undo`, {});
    expect(undoneApproval.body.record.status).toBe('open');
    expect(undoneApproval.body.record.data.approvals).toEqual([]);

    const a = (await c.get('/api/records/anchor:TR')).body.record;
    await c.put('/api/anchors/TR', { baseVersion: a.version, date: '2027-03-01', confidence: 'planned' });
    const anchorEntry = (await c.get('/api/audit?record_id=anchor:TR')).body.entries[0];
    expect(anchorEntry.action).toBe('anchor_change');
    const undoneAnchor = await c.post(`/api/audit/${anchorEntry.id}/undo`, {});
    expect(undoneAnchor.body.record.data.date).toBeNull();
    expect(undoneAnchor.body.record.data.confidence).toBe('awaiting');
  });

  it('refuses creation, import and unknown entries, and cannot reach other households or private records', async () => {
    const h = await harness({ secondHousehold: true });
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const created = (await avery.post('/api/records', { type: 'note', title: 'Mine', data: { body: 'x' }, visibility: 'private' })).body.record;
    const edit = await avery.patch(`/api/records/${created.id}`, { baseVersion: 1, changes: { title: 'Mine 2' } });
    expect(edit.status).toBe(200);
    const entries = (await avery.get(`/api/audit?record_id=${created.id}`)).body.entries;
    const createEntry = entries.find((e: any) => e.action === 'create');
    expect((await avery.post(`/api/audit/${createEntry.id}/undo`, {})).status).toBe(422);
    const importEntry = (await avery.get('/api/audit?record_id=milestone:W06')).body.entries.find((e: any) => e.action === 'import_create');
    expect((await avery.post(`/api/audit/${importEntry.id}/undo`, {})).status).toBe(422);
    expect((await avery.post('/api/audit/does-not-exist/undo', {})).status).toBe(404);
    // jun cannot undo avery's private-record change; it is as if it does not exist.
    const updateEntry = entries.find((e: any) => e.action === 'update');
    expect((await jun.post(`/api/audit/${updateEntry.id}/undo`, {})).status).toBe(404);
    expect(recordRow(h.db, created.id).title).toBe('Mine 2');
    expect(countRows(h.db, 'audit_log', "action = 'undo'")).toBe(0);
  });
});
