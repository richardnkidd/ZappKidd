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

const status = (c: any, id: string, version: number, body: Record<string, unknown>) =>
  c.post(`/api/records/${id}/status`, { baseVersion: version, ...body });

describe('status rules (server-enforced)', () => {
  it('completed requires non-empty evidence and records it with the session person', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const m = (await c.get('/api/records/milestone:W06')).body.record;
    const audits = countRows(h.db, 'audit_log');
    for (const evidence of [undefined, '', '   ', { summary: '  ' }]) {
      const res = await status(c, m.id, m.version, { status: 'completed', ...(evidence === undefined ? {} : { evidence }) });
      expect(res.status, JSON.stringify(evidence)).toBe(422);
      expect(res.body.details.some((d: any) => d.path === 'evidence')).toBe(true);
    }
    expect(recordRow(h.db, m.id).status).toBe(m.status);
    expect(recordRow(h.db, m.id).version).toBe(m.version);
    expect(countRows(h.db, 'audit_log')).toBe(audits);

    const ok = await status(c, m.id, m.version, { status: 'completed', evidence: { summary: 'Confirmation email received', link: 'https://example.org/receipt' } });
    expect(ok.status).toBe(200);
    expect(ok.body.record.status).toBe('completed');
    expect(ok.body.record.version).toBe(m.version + 1);
    const ev = ok.body.record.data.completion_evidence.at(-1);
    expect(ev).toMatchObject({ by: 'jun', summary: 'Confirmation email received', link: 'https://example.org/receipt' });
    expect(ev.at).toBe('2026-10-29T20:00:00.000Z');
    expect(ok.body.record.locally_edited).toEqual(expect.arrayContaining(['status', 'data.completion_evidence']));
    const entry = (await c.get(`/api/audit?record_id=${m.id}`)).body.entries[0];
    expect(entry).toMatchObject({ action: 'status_change', actor: 'jun' });
    expect(entry.before.status).toBe(m.status);
    expect(entry.after.status).toBe('completed');
  });

  it('accepts evidence given as a plain string and rejects unsafe links', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = (await c.get('/api/records/milestone:W06')).body.record;
    const bad = await status(c, m.id, m.version, { status: 'completed', evidence: { summary: 'ok', link: 'javascript:alert(1)' } });
    expect(bad.status).toBe(422);
    const ok = await status(c, m.id, m.version, { status: 'completed', evidence: 'Appointment held; notes filed' });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data.completion_evidence.at(-1).link).toBeNull();
  });

  it('eliminated, not_applicable and blocked require a reason', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    let v = (await c.get('/api/records/milestone:W06')).body.record.version;
    for (const st of ['eliminated', 'not_applicable', 'blocked']) {
      const missing = await status(c, 'milestone:W06', v, { status: st });
      expect(missing.status, st).toBe(422);
      const blank = await status(c, 'milestone:W06', v, { status: st, reason: '   ' });
      expect(blank.status, st).toBe(422);
      const ok = await status(c, 'milestone:W06', v, { status: st, reason: `Because ${st}` });
      expect(ok.status, st).toBe(200);
      expect(ok.body.record.data.status_reason).toBe(`Because ${st}`);
      v = ok.body.record.version;
    }
    // Leaving a reason-bearing status clears the stale reason.
    const back = await status(c, 'milestone:W06', v, { status: 'in_progress' });
    expect(back.status).toBe(200);
    expect(back.body.record.data.status_reason).toBeNull();
  });

  it('rejects unknown statuses for work records and honours baseVersion', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = (await c.get('/api/records/milestone:W06')).body.record;
    expect((await status(c, m.id, m.version, { status: 'done' })).status).toBe(422);
    expect((await status(c, m.id, m.version, { status: 'In Progress' })).status).toBe(422);
    const conflict = await status(c, m.id, m.version + 5, { status: 'in_progress' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.details.server.id).toBe(m.id);
    expect((await status(c, 'milestone:NOPE', 1, { status: 'in_progress' })).status).toBe(404);
  });

  it('decisions change state only through approve/reject/defer', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const d = (await c.get('/api/records/decision:D02')).body.record;
    for (const st of ['approved', 'proposed', 'rejected', 'deferred']) {
      expect((await status(c, d.id, d.version, { status: st, reason: 'x' })).status, st).toBe(422);
    }
    expect((await status(c, d.id, d.version, { status: 'superseded', reason: 'Replaced' })).status).toBe(200);
  });
});

describe('per-traveler progress', () => {
  async function sharedMilestone(c: any) {
    const snap = (await c.get('/api/snapshot')).body;
    const m = snap.records.find((r: any) => r.type === 'milestone' && Array.isArray(r.data.traveler_scope) && r.data.traveler_scope.includes('avery') && r.data.traveler_scope.includes('jun'));
    expect(m).toBeTruthy();
    return m;
  }

  it('updates only that traveler\'s progress and leaves the record-level status alone', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const m = await sharedMilestone(c);
    const res = await status(c, m.id, m.version, { traveler: 'jun', status: 'completed', evidence: 'Jun\'s part is done' });
    expect(res.status).toBe(200);
    const r = res.body.record;
    expect(r.status).toBe(m.status); // household view unchanged
    expect(r.version).toBe(m.version + 1);
    expect(r.data.traveler_progress.jun).toMatchObject({ status: 'completed', reason: null, updated_by: 'jun', updated_at: '2026-10-29T20:00:00.000Z' });
    expect(r.data.traveler_progress.jun.evidence).toHaveLength(1);
    expect(r.data.traveler_progress.jun.evidence[0]).toMatchObject({ by: 'jun', summary: "Jun's part is done" });
    expect(r.data.traveler_progress.avery).toEqual(m.data.traveler_progress?.avery); // other travelers untouched
    expect(r.data.completion_evidence).toEqual(m.data.completion_evidence); // record-level evidence untouched
    expect(r.locally_edited).toContain('data.traveler_progress');
    expect(r.locally_edited).not.toContain('status');
    const entry = (await c.get(`/api/audit?record_id=${m.id}`)).body.entries[0];
    expect(entry.action).toBe('status_change');
    expect(entry.before.data.traveler_progress?.jun).toEqual(m.data.traveler_progress?.jun);
    expect(entry.after.data.traveler_progress.jun.status).toBe('completed');
  });

  it('applies the same status rules to travelers', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = await sharedMilestone(c);
    const audits = countRows(h.db, 'audit_log');
    expect((await status(c, m.id, m.version, { traveler: 'avery', status: 'completed' })).status).toBe(422);
    expect((await status(c, m.id, m.version, { traveler: 'avery', status: 'blocked' })).status).toBe(422);
    expect((await status(c, m.id, m.version, { traveler: 'avery', status: 'not_applicable', reason: ' ' })).status).toBe(422);
    expect(countRows(h.db, 'audit_log')).toBe(audits);
    const blocked = await status(c, m.id, m.version, { traveler: 'avery', status: 'blocked', reason: 'Waiting for the route advice' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.record.data.traveler_progress.avery).toMatchObject({ status: 'blocked', reason: 'Waiting for the route advice' });
    // Evidence history is kept when a traveler reopens.
    const done = await status(c, m.id, blocked.body.record.version, { traveler: 'avery', status: 'completed', evidence: 'Done after all' });
    const reopened = await status(c, m.id, done.body.record.version, { traveler: 'avery', status: 'in_progress' });
    expect(reopened.body.record.data.traveler_progress.avery.evidence).toHaveLength(1);
    expect(reopened.body.record.data.traveler_progress.avery.status).toBe('in_progress');
  });

  it('refuses travelers who do not exist, are out of scope, or records without per-traveler progress', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = await sharedMilestone(c);
    expect((await status(c, m.id, m.version, { traveler: 'nobody', status: 'in_progress' })).status).toBe(422);
    expect((await status(c, m.id, m.version, { traveler: 'mochi', status: 'in_progress' })).status).toBe(422); // not in this item's scope
    const row = recordRow(h.db, 'milestone:W08');
    const data = JSON.parse(row.data);
    data.traveler_scope = ['avery'];
    h.db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
    expect((await status(c, row.id, row.version, { traveler: 'jun', status: 'in_progress' })).status).toBe(422);
    expect((await status(c, row.id, row.version, { traveler: 'avery', status: 'in_progress' })).status).toBe(200);
    const risk = (await c.get('/api/records?type=risk')).body.records[0];
    expect((await status(c, risk.id, risk.version, { traveler: 'avery', status: 'open' })).status).toBe(422);
    const unchanged = recordRow(h.db, m.id);
    expect(unchanged.version).toBe(m.version);
  });

  it('allows any person on an item with an empty traveler scope', async () => {
    const h = await harness();
    const row = recordRow(h.db, 'milestone:W06');
    const data = JSON.parse(row.data);
    data.traveler_scope = []; // household-coordination item
    h.db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
    const c = await loginAs(h, 'avery');
    const res = await status(c, row.id, row.version, { traveler: 'mochi', status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.record.data.traveler_progress.mochi.status).toBe('in_progress');
  });

  it('keeps traveler progress out of the generic edit endpoint', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = await sharedMilestone(c);
    for (const data of [{ traveler_progress: { avery: { status: 'completed', reason: null, evidence: [], updated_at: null, updated_by: null } } }, { dependency_scope: { W02: ['avery'] } }]) {
      const res = await c.patch(`/api/records/${m.id}`, { baseVersion: m.version, changes: { data } });
      expect(res.status).toBe(422);
    }
    const arrival = (await c.get('/api/records?type=arrival')).body.records[0];
    const res = await c.patch(`/api/records/${arrival.id}`, { baseVersion: arrival.version, changes: { data: { traveler_progress: {} } } });
    expect(res.status).toBe(422);
    expect(recordRow(h.db, m.id).version).toBe(m.version);
  });

  it('works on arrival items too', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const a = (await c.get('/api/records?type=arrival')).body.records.find((r: any) => r.data.traveler_scope.includes('avery'));
    const res = await status(c, a.id, a.version, { traveler: 'avery', status: 'planned' });
    expect(res.status).toBe(200);
    expect(res.body.record.status).toBe(a.status);
    expect(res.body.record.data.traveler_progress.avery.status).toBe('planned');
  });
});
