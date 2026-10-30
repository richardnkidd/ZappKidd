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

async function twoOptionDecision(c: any, extra: Record<string, unknown> = {}) {
  const res = await c.post('/api/records', {
    type: 'decision',
    title: 'Choose a shipping method',
    data: { question: 'How do we ship the boxes?', options: [{ label: 'By sea' }, { label: 'By air' }], ...extra },
  });
  expect(res.status).toBe(201);
  return res.body.record;
}

describe('decision approval', () => {
  it('becomes household-approved only when every required approver approved the same option', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d = await twoOptionDecision(avery);
    expect(d.status).toBe('open');

    const a1 = await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-1', note: 'Cheaper' });
    expect(a1.status).toBe(200);
    expect(a1.body.record.status).toBe('proposed');
    expect(a1.body.decision).toMatchObject({ state: 'proposed', awaiting: ['jun'], awaiting_text: 'awaiting Jun', decided_option_id: null, disagreement: false });
    expect(a1.body.record.data.approvals).toEqual([{ person_id: 'avery', at: '2026-10-29T20:00:00.000Z', option_id: 'opt-1', note: 'Cheaper' }]);
    expect(a1.body.record.data.decided_option_id).toBeNull();

    const j1 = await jun.post(`/api/decisions/${d.id}/approve`, { baseVersion: a1.body.record.version, option_id: 'opt-2' });
    expect(j1.body.record.status).toBe('proposed'); // different option: not approved
    expect(j1.body.decision).toMatchObject({ disagreement: true, awaiting: [], decided_option_id: null });

    const j2 = await jun.post(`/api/decisions/${d.id}/approve`, { baseVersion: j1.body.record.version, option_id: 'opt-1' });
    expect(j2.status).toBe(200);
    expect(j2.body.record.status).toBe('approved');
    expect(j2.body.decision).toMatchObject({ state: 'approved', decided_option_id: 'opt-1', awaiting: [], awaiting_text: null });
    expect(j2.body.record.data.decided_option_id).toBe('opt-1');
    expect(j2.body.record.data.decided_at).toBe('2026-10-29T20:00:00.000Z');
    expect(j2.body.record.data.approvals).toHaveLength(2); // one entry per person (changing replaces)

    // Changing an approval is allowed and audited; the decision stops being household-approved.
    const a2 = await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: j2.body.record.version, option_id: 'opt-2' });
    expect(a2.body.record.status).toBe('proposed');
    expect(a2.body.record.data.decided_option_id).toBeNull();
    expect(a2.body.record.data.decided_at).toBeNull();
    const audit = (await avery.get(`/api/audit?record_id=${d.id}`)).body.entries;
    expect(audit.filter((e: any) => e.action === 'approve').map((e: any) => e.actor)).toEqual(['avery', 'jun', 'jun', 'avery']);
  });

  it('works on imported decisions: awaiting the other person until they agree', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d = (await avery.get('/api/records/decision:D02')).body.record;
    expect(d.status).toBe('open');
    const first = await avery.post('/api/decisions/decision:D02/approve', { baseVersion: d.version, option_id: 'opt-1' });
    expect(first.body.record.status).toBe('proposed');
    expect(first.body.decision.awaiting_text).toBe('awaiting Jun');
    const detail = (await jun.get('/api/records/decision:D02')).body;
    expect(detail.decision).toMatchObject({ awaiting: ['jun'], awaiting_text: 'awaiting Jun' });
    const second = await jun.post('/api/decisions/decision:D02/approve', { baseVersion: first.body.record.version, option_id: 'opt-1' });
    expect(second.body.record.status).toBe('approved');
  });

  it('refuses people who are not required approvers, unknown options and non-decisions', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d = await twoOptionDecision(avery, { required_approvers: ['avery'] });
    expect((await jun.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-1' })).status).toBe(403);
    expect((await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-9' })).status).toBe(422);
    expect((await avery.post('/api/decisions/milestone:W06/approve', { baseVersion: 1, option_id: 'opt-1' })).status).toBe(422);
    expect((await avery.post('/api/decisions/decision:NOPE/approve', { baseVersion: 1, option_id: 'opt-1' })).status).toBe(404);
    const solo = await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-1' });
    expect(solo.body.record.status).toBe('approved'); // sole required approver
    expect(recordRow(h.db, d.id).status).toBe('approved');
  });

  it('uses the version check', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d = await twoOptionDecision(avery);
    await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-1' });
    const stale = await jun.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-1' });
    expect(stale.status).toBe(409);
    expect(stale.body.details.server.data.approvals).toHaveLength(1);
  });

  it('reject and defer need a rationale and clear any approval', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    let d = await twoOptionDecision(avery);
    const audits = countRows(h.db, 'audit_log');
    for (const verb of ['reject', 'defer']) {
      for (const body of [{ baseVersion: d.version }, { baseVersion: d.version, rationale: '' }, { baseVersion: d.version, rationale: '   ' }]) {
        expect((await avery.post(`/api/decisions/${d.id}/${verb}`, body)).status, verb).toBe(422);
      }
    }
    expect(countRows(h.db, 'audit_log')).toBe(audits);

    const approved = await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-1' });
    const deferred = await jun.post(`/api/decisions/${d.id}/defer`, { baseVersion: approved.body.record.version, rationale: 'Wait for the quote', revisit_on: '2027-01-10' });
    expect(deferred.status).toBe(200);
    expect(deferred.body.record.status).toBe('deferred');
    expect(deferred.body.record.data.revisit_on).toBe('2027-01-10');
    expect(deferred.body.record.data.history_note).toContain('Jun deferred on 2026-10-29: Wait for the quote');
    const rejected = await avery.post(`/api/decisions/${d.id}/reject`, { baseVersion: deferred.body.record.version, rationale: 'Too risky' });
    expect(rejected.body.record.status).toBe('rejected');
    expect(rejected.body.record.data.decided_option_id).toBeNull();
    expect(rejected.body.record.data.history_note).toContain('Avery rejected');
    expect((await avery.post(`/api/decisions/${d.id}/defer`, { baseVersion: deferred.body.record.version, rationale: 'x' })).status).toBe(409);
    const actions = (await avery.get(`/api/audit?record_id=${d.id}`)).body.entries.map((e: any) => e.action);
    expect(actions).toEqual(['reject', 'defer', 'approve', 'create']);
    d = rejected.body.record;
    // A rejected decision can be reopened by approving again.
    const again = await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-2' });
    expect(again.body.record.status).toBe('proposed');
  });

  it('editing options or approvers re-evaluates the decision', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const d = await twoOptionDecision(avery);
    const a = await avery.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-1' });
    expect(a.body.record.status).toBe('proposed');
    // Dropping jun from the approvers makes avery's approval sufficient.
    const edit = await avery.patch(`/api/records/${d.id}`, { baseVersion: a.body.record.version, changes: { data: { required_approvers: ['avery'] } } });
    expect(edit.status).toBe(200);
    expect(edit.body.record.status).toBe('approved');
    expect(edit.body.record.data.decided_option_id).toBe('opt-1');
    // Cannot remove an option somebody approved.
    const drop = await avery.patch(`/api/records/${d.id}`, { baseVersion: edit.body.record.version, changes: { data: { options: [{ id: 'opt-2', label: 'By air', consequences: null, source: 'household' }] } } });
    expect(drop.status).toBe(422);
  });
});
