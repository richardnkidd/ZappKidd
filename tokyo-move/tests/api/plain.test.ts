import { afterEach, describe, expect, it } from 'vitest';
import { applyBundle } from '../../src/import/apply';
import type { Correction } from '../../src/import/corrections';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import { loginAs, makeHarness, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const DAY = 86_400_000;

describe('plain wording through PATCH', () => {
  it('accepts the plain fields on a decision, merges plain_options per option, and records history', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const d = (await avery.get('/api/records/decision:D02')).body.record;
    const res = await avery.patch(`/api/records/${d.id}`, {
      baseVersion: d.version,
      changes: { data: { plain_title: 'Where the plan lives', plain_question: 'Where do we keep the plan?', plain_summary: 'One home keeps us in step.', plain_delay: 'We keep two lists.', plain_options: { 'opt-1': 'Use this app.' } } },
    });
    expect(res.status).toBe(200);
    expect(res.body.record.data.plain_question).toBe('Where do we keep the plan?');
    expect(res.body.record.data.plain_options).toEqual({ 'opt-1': 'Use this app.' });
    expect(res.body.record.locally_edited).toEqual(expect.arrayContaining(['data.plain_question', 'data.plain_options']));
    expect(res.body.record.data.question).toBe(d.data.question); // imported wording untouched

    const more = await avery.patch(`/api/records/${d.id}`, { baseVersion: res.body.record.version, changes: { data: { plain_options: { 'opt-2': 'Use a sheet.' } } } });
    expect(more.body.record.data.plain_options).toEqual({ 'opt-1': 'Use this app.', 'opt-2': 'Use a sheet.' });

    const history = (await avery.get(`/api/audit?record_id=${d.id}`)).body.entries;
    expect(history.filter((e: any) => e.action === 'update')).toHaveLength(2);
    expect(history[0].after.data.plain_options).toEqual({ 'opt-1': 'Use this app.', 'opt-2': 'Use a sheet.' });
  });

  it('accepts plain fields on questions and milestones, and clears with null', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const q = (await avery.get('/api/records/question:Q007')).body.record;
    const r1 = await avery.patch(`/api/records/${q.id}`, { baseVersion: q.version, changes: { data: { plain_question: 'When do the passports expire?', plain_title: 'Passport dates' } } });
    expect(r1.status).toBe(200);
    const m = (await avery.get('/api/records/milestone:W19')).body.record;
    const r2 = await avery.patch(`/api/records/${m.id}`, { baseVersion: m.version, changes: { data: { plain_next: 'Pick three areas.', plain_summary: 'We need a place to live.' } } });
    expect(r2.status).toBe(200);
    expect(r2.body.record.data.plain_next).toBe('Pick three areas.');
    const r3 = await avery.patch(`/api/records/${m.id}`, { baseVersion: r2.body.record.version, changes: { data: { plain_next: null } } });
    expect(r3.body.record.data.plain_next).toBeNull();
  });

  it('rejects over-long, multi-line and wrongly shaped wording, and plain fields on types that do not take them', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const d = (await avery.get('/api/records/decision:D02')).body.record;
    const patch = (data: Record<string, unknown>, id = d.id, version = d.version) => avery.patch(`/api/records/${id}`, { baseVersion: version, changes: { data } });
    for (const bad of [
      { plain_title: 'x'.repeat(161) },
      { plain_question: 'x'.repeat(301) },
      { plain_summary: 'x'.repeat(301) },
      { plain_delay: 'x'.repeat(201) },
      { plain_question: 'two\nlines?' },
      { plain_options: { 'opt-1': 'x'.repeat(241) } },
      { plain_options: { 'opt-1': 5 } },
      { plain_options: 'text' },
    ]) {
      const res = await patch(bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    const m = (await avery.get('/api/records/milestone:W19')).body.record;
    expect((await patch({ plain_next: 'x'.repeat(161) }, m.id, m.version)).status).toBe(422);
    expect((await patch({ plain_delay: 'Not for milestones' }, m.id, m.version)).status).toBe(422);
    const after = (await avery.get('/api/records/decision:D02')).body.record;
    expect(after.version).toBe(d.version); // nothing was saved
  });

  it('applies the normal version check', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d = (await avery.get('/api/records/decision:D02')).body.record;
    const first = await avery.patch(`/api/records/${d.id}`, { baseVersion: d.version, changes: { data: { plain_question: 'Where do we keep the plan?' } } });
    expect(first.status).toBe(200);
    const stale = await jun.patch(`/api/records/${d.id}`, { baseVersion: d.version, changes: { data: { plain_question: 'Which app holds the plan?' } } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('conflict');
    expect(stale.body.details.server.data.plain_question).toBe('Where do we keep the plan?');
  });

  it('can still be edited after the decision was approved (the imported question stays frozen)', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const d = (await avery.get('/api/records/decision:D04')).body.record;
    expect(d.data.approvals).toHaveLength(1);
    const res = await avery.patch(`/api/records/${d.id}`, { baseVersion: d.version, changes: { data: { plain_question: 'What is our spending limit?' } } });
    expect(res.status).toBe(200);
    expect(res.body.record.data.approvals).toHaveLength(1);
    expect(res.body.record.status).toBe('proposed');
  });
});

describe('corrections fill the plain fields', () => {
  const correction = (question: string, label: string): Correction => ({
    id: 'plain-wording-1',
    title: 'Plain wording for the plan-home decision',
    rationale: 'Said in plain words.',
    ops: [
      { op: 'set', record: 'decision:D02', path: 'data.plain_question', value: question },
      { op: 'set', record: 'decision:D02', path: 'data.plain_options.opt-1', value: label },
    ],
  });
  const reimport = (h: Harness, tag: string, corrections: Correction[]) => {
    const b = buildDemoBundle();
    b.files = [{ name: 'demo-plan.json', sha256: `plain-${tag}`, bytes: 1 }];
    return applyBundle(h.db, b, { now: new Date('2026-10-30T12:00:00Z'), corrections });
  };

  it('sets plain_question and a plain_options entry (creating the object), survives a re-import, and an in-app edit wins', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    expect((await avery.get('/api/records/decision:D02')).body.record.data.plain_options).toBeUndefined();

    const first = reimport(h, '1', [correction('Where do we keep the plan?', 'Use this app.')]);
    expect(first.status).toBe('completed');
    let d = (await avery.get('/api/records/decision:D02')).body.record;
    expect(d.data.plain_question).toBe('Where do we keep the plan?');
    expect(d.data.plain_options).toEqual({ 'opt-1': 'Use this app.' });
    expect(d.locally_edited ?? []).not.toContain('data.plain_question');

    // Same correction, new source version: the wording is still there.
    reimport(h, '2', [correction('Where do we keep the plan?', 'Use this app.')]);
    d = (await avery.get('/api/records/decision:D02')).body.record;
    expect(d.data.plain_question).toBe('Where do we keep the plan?');
    expect(d.data.plain_options).toEqual({ 'opt-1': 'Use this app.' });

    // A person rewrites the question in the app.
    const edited = await avery.patch(`/api/records/decision:D02`, { baseVersion: d.version, changes: { data: { plain_question: 'Which app holds our plan?' } } });
    expect(edited.status).toBe(200);

    // The correction changes later: the in-app question is kept, the untouched option label follows the correction.
    const third = reimport(h, '3', [correction('Where should the plan live?', 'Use Kadode.')]);
    expect(third.kept_local).toBeGreaterThanOrEqual(1);
    d = (await avery.get('/api/records/decision:D02')).body.record;
    expect(d.data.plain_question).toBe('Which app holds our plan?');
    expect(d.data.plain_options).toEqual({ 'opt-1': 'Use Kadode.' });
    const kept = h.db.prepare("SELECT field FROM import_changes WHERE import_run_id = ? AND change = 'local_kept'").all(third.run.id) as { field: string }[];
    expect(kept.map((k) => k.field)).toContain('data.plain_question');
  });
});

describe('reopen a decision', () => {
  async function rejected(h: Harness) {
    const avery = await loginAs(h, 'avery');
    const d = (await avery.get('/api/records/decision:D02')).body.record;
    const r = await avery.post(`/api/decisions/${d.id}/reject`, { baseVersion: d.version, rationale: 'Not this one' });
    expect(r.status).toBe(200);
    return { avery, rec: r.body.record };
  }

  it('returns a rejected decision to open, clears approvals, and records it in history', async () => {
    const h = await harness();
    const { avery, rec } = await rejected(h);
    const res = await avery.post(`/api/decisions/${rec.id}/reopen`, { baseVersion: rec.version });
    expect(res.status).toBe(200);
    expect(res.body.record.status).toBe('open');
    expect(res.body.reopened_from).toBe('rejected');
    expect(res.body.decision).toMatchObject({ state: 'open', decided_option_id: null, awaiting: ['avery', 'jun'] });
    expect(res.body.record.data.approvals).toEqual([]);
    expect(res.body.record.data.history_note).toContain('Avery reopened this on 2026-10-29');
    const audit = (await avery.get(`/api/audit?record_id=${rec.id}`)).body.entries;
    expect(audit[0]).toMatchObject({ action: 'reopen', actor: 'avery' });
  });

  it('reopens a put-off decision and a decided one (clearing both approvals)', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const d5 = (await jun.get('/api/records/decision:D05')).body.record;
    expect(d5.status).toBe('deferred');
    const r5 = await jun.post(`/api/decisions/${d5.id}/reopen`, { baseVersion: d5.version }); // from the import, within 7 days
    expect(r5.status).toBe(200);
    expect(r5.body.reopened_from).toBe('deferred');

    const d3 = (await avery.get('/api/records/decision:D03')).body.record;
    const a = await avery.post(`/api/decisions/${d3.id}/approve`, { baseVersion: d3.version, option_id: 'opt-2' });
    const b = await jun.post(`/api/decisions/${d3.id}/approve`, { baseVersion: a.body.record.version, option_id: 'opt-2' });
    expect(b.body.record.status).toBe('approved');
    const re = await avery.post(`/api/decisions/${d3.id}/reopen`, { baseVersion: b.body.record.version });
    expect(re.status).toBe(200);
    expect(re.body.reopened_from).toBe('approved');
    expect(re.body.record).toMatchObject({ status: 'open', data: expect.objectContaining({ approvals: [], decided_option_id: null, decided_at: null }) });
  });

  it('is refused after seven days with a clear message, and allowed on day seven', async () => {
    const h = await harness();
    const { avery, rec } = await rejected(h);
    h.clock.now = new Date(h.clock.now.getTime() + 7 * DAY);
    const ok = await avery.post(`/api/decisions/${rec.id}/reopen`, { baseVersion: rec.version });
    expect(ok.status).toBe(200);

    const h2 = await harness();
    const r2 = await rejected(h2);
    h2.clock.now = new Date(h2.clock.now.getTime() + 7 * DAY + 1000);
    const late = await r2.avery.post(`/api/decisions/${r2.rec.id}/reopen`, { baseVersion: r2.rec.version });
    expect(late.status).toBe(422);
    expect(late.body.message).toContain('more than 7 days ago');
    expect((await r2.avery.get(`/api/records/${r2.rec.id}`)).body.record.status).toBe('rejected');
  });

  it('needs the current version, and a decision that is actually settled', async () => {
    const h = await harness();
    const { avery, rec } = await rejected(h);
    // Only adults can have a login at all, so the server's adult check on reopen is a second line of defence.
    expect((await avery.post(`/api/decisions/${rec.id}/reopen`, { baseVersion: rec.version - 1 || 99 })).status).toBe(409);
    const open = (await avery.get('/api/records/decision:D03')).body.record;
    expect((await avery.post(`/api/decisions/${open.id}/reopen`, { baseVersion: open.version })).status).toBe(422);
    expect((await avery.post(`/api/decisions/${rec.id}/reopen`, { baseVersion: rec.version, extra: 1 })).status).toBe(422);
    expect((await avery.post('/api/decisions/milestone:W19/reopen', { baseVersion: 1 })).status).toBe(422);
  });

  it('the reopened decision can be decided again', async () => {
    const h = await harness();
    const { avery, rec } = await rejected(h);
    const re = await avery.post(`/api/decisions/${rec.id}/reopen`, { baseVersion: rec.version });
    const again = await avery.post(`/api/decisions/${rec.id}/approve`, { baseVersion: re.body.record.version, option_id: 'opt-1' });
    expect(again.status).toBe(200);
    expect(again.body.record.status).toBe('proposed');
  });
});

describe('undo after marking done', () => {
  it('returns previous_status and an audit id that restores the item', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const m = (await avery.get('/api/records/milestone:W19')).body.record;
    expect(m.status).toBe('planned');
    const done = await avery.post(`/api/records/${m.id}/status`, { baseVersion: m.version, status: 'completed', evidence: 'Marked done in the app.' });
    expect(done.status).toBe(200);
    expect(done.body.record.status).toBe('completed');
    expect(done.body.previous_status).toBe('planned');
    expect(typeof done.body.undo_audit_id).toBe('string');
    const undo = await avery.post(`/api/audit/${done.body.undo_audit_id}/undo`, {});
    expect(undo.status).toBe(200);
    expect(undo.body.record.status).toBe('planned');
    expect(undo.body.record.data.completion_evidence).toEqual([]);
  });

  it('works for one traveler on a shared item, and is refused once someone else changed the item', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const m = (await avery.get('/api/records/milestone:W19')).body.record;
    const done = await avery.post(`/api/records/${m.id}/status`, { baseVersion: m.version, status: 'in_progress' });
    expect(done.body.previous_status).toBe('planned');
    const other = await jun.post(`/api/records/${m.id}/status`, { baseVersion: done.body.record.version, status: 'blocked', reason: 'Waiting' });
    expect(other.status).toBe(200);
    const undo = await avery.post(`/api/audit/${done.body.undo_audit_id}/undo`, {});
    expect(undo.status).toBe(409);
  });
});

describe('since you last looked and your turn', () => {
  it('exposes last_seen_at and marks the plan seen without audit noise', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    expect((await avery.get('/api/snapshot')).body.last_seen_at).toBeNull();
    expect((await avery.get('/api/snapshot')).body.last_seen_at).toBeNull(); // reading does not mark it
    const first = await avery.post('/api/me/seen', {});
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ previous_seen_at: null, last_seen_at: '2026-10-29T20:00:00.000Z' });
    h.clock.now = new Date('2026-10-30T08:00:00.000Z');
    expect((await avery.get('/api/snapshot')).body.last_seen_at).toBe('2026-10-29T20:00:00.000Z');
    expect((await jun.get('/api/snapshot')).body.last_seen_at).toBeNull(); // per person
    const second = await avery.post('/api/me/seen', {});
    expect(second.body).toEqual({ previous_seen_at: '2026-10-29T20:00:00.000Z', last_seen_at: '2026-10-30T08:00:00.000Z' });
    const settings = (await avery.get('/api/settings')).body.settings;
    expect(Object.keys(settings).some((k) => k.includes('seen'))).toBe(false);
    expect((await h.app.inject({ method: 'POST', url: '/api/me/seen', headers: { host: 'kadode.test', origin: 'http://kadode.test', 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(401);
  });

  it('lets the snapshot and audit answer "Jun chose X, now it is my turn" and "what Jun changed"', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    await avery.post('/api/me/seen', {});
    h.clock.now = new Date('2026-10-30T09:00:00.000Z');
    const d = (await jun.get('/api/records/decision:D03')).body.record;
    await jun.post(`/api/decisions/${d.id}/approve`, { baseVersion: d.version, option_id: 'opt-2' });

    const snap = (await avery.get('/api/snapshot')).body;
    const rec = snap.records.find((r: any) => r.id === 'decision:D03');
    // Your turn: proposed, the other adult has an approval, I do not.
    expect(rec.status).toBe('proposed');
    const theirs = rec.data.approvals.find((a: any) => a.person_id === 'jun');
    expect(theirs.option_id).toBe('opt-2');
    expect(rec.data.approvals.some((a: any) => a.person_id === 'avery')).toBe(false);
    expect(rec.data.plain_options[theirs.option_id]).toBeTruthy();
    // Changed by the other adult since I last looked: the record envelope, and exact detail from the audit log.
    expect(rec.updated_by).toBe('jun');
    expect(rec.updated_at > snap.last_seen_at).toBe(true);
    const entries = (await avery.get(`/api/audit?since=${encodeURIComponent(snap.last_seen_at)}`)).body.entries;
    expect(entries.filter((e: any) => e.actor === 'jun')).toHaveLength(1);
    expect(entries[0].after.data.approvals.find((a: any) => a.person_id === 'jun').option_id).toBe('opt-2');
  });
});

describe('answering a question from anywhere', () => {
  it('lets an adult set data.answer and mark it answered with the version check', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const q = (await avery.get('/api/records/question:Q007')).body.record;
    expect(q.data.disposition).toBe('question');
    const res = await avery.patch(`/api/records/${q.id}`, { baseVersion: q.version, changes: { data: { disposition: 'already_answered', answer: 'Avery in 2028, Jun in 2027.' } } });
    expect(res.status).toBe(200);
    expect(res.body.record.data).toMatchObject({ disposition: 'already_answered', answer: 'Avery in 2028, Jun in 2027.' });
    expect(res.body.record.locally_edited).toEqual(expect.arrayContaining(['data.answer', 'data.disposition']));
    const stale = await jun.patch(`/api/records/${q.id}`, { baseVersion: q.version, changes: { data: { answer: 'Different' } } });
    expect(stale.status).toBe(409);
    expect((await avery.patch(`/api/records/${q.id}`, { baseVersion: res.body.record.version, changes: { data: { answer: 'x'.repeat(5001) } } })).status).toBe(422);
  });

  it('derives the status from the disposition, the same way the importer does', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const openCount = async () => ((await avery.get('/api/snapshot')).body.records as any[]).filter((r) => r.type === 'question' && r.status === 'open').length;
    const before = await openCount();
    let q = (await avery.get('/api/records/question:Q007')).body.record;
    expect(q.status).toBe('open');

    const steps: [string, string][] = [
      ['already_answered', 'answered'],
      ['not_applicable', 'not_applicable'],
      ['explicitly_excluded', 'excluded'],
      ['waiting_blocked', 'open'],
      ['carry_forward', 'open'],
      ['question', 'open'],
    ];
    for (const [disposition, status] of steps) {
      const res = await avery.patch(`/api/records/${q.id}`, { baseVersion: q.version, changes: { data: { disposition } } });
      expect(res.status, disposition).toBe(200);
      q = res.body.record;
      expect(q.status, disposition).toBe(status);
    }

    // Answering takes it out of the open count everywhere (the snapshot is what every screen counts from).
    const answered = await avery.patch(`/api/records/${q.id}`, { baseVersion: q.version, changes: { data: { disposition: 'already_answered', answer: 'Yes.' } } });
    expect(answered.body.record.status).toBe('answered');
    expect(answered.body.record.locally_edited).toContain('status');
    expect(await openCount()).toBe(before - 1);

    // Editing only the answer text leaves the status alone.
    const edit = await avery.patch(`/api/records/${q.id}`, { baseVersion: answered.body.record.version, changes: { data: { answer: 'Yes, both.' } } });
    expect(edit.body.record.status).toBe('answered');
  });
});
