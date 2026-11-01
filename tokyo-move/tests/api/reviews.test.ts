import { afterEach, describe, expect, it } from 'vitest';
import { countRows, loginAs, makeHarness, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('couple review', () => {
  it('starts, updates and completes a review; the next one remembers when the last finished', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const start = await avery.post('/api/reviews', {});
    expect(start.status).toBe(201);
    expect(start.body.resumed).toBe(false);
    const r = start.body.record;
    expect(r).toMatchObject({ type: 'review_session', status: 'in_progress', created_by: 'avery', visibility: 'household' });
    expect(r.data).toMatchObject({ started_at: '2026-10-29T20:00:00.000Z', completed_at: null, since: null, participants: ['avery'], decisions: [], summary: '' });

    // Starting again while one is open resumes it (no duplicates).
    const again = await jun.post('/api/reviews', {});
    expect(again.status).toBe(200);
    expect(again.body.resumed).toBe(true);
    expect(again.body.record.id).toBe(r.id);

    const upd = await jun.patch(`/api/reviews/${r.id}`, {
      baseVersion: r.version,
      changes: {
        participants: ['avery', 'jun'],
        reviewed_record_ids: ['milestone:W06', 'decision:D02'],
        decisions: [{ record_id: 'decision:D02', outcome: 'Go with the first option' }],
        summary: 'We looked at <b>two</b> things.\nSecond line & done.',
        next_review_on: '2026-11-12',
      },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.record.data.summary).toBe('We looked at <b>two</b> things.\nSecond line & done.'); // plain text, stored verbatim
    expect(upd.body.record.data.participants).toEqual(['avery', 'jun']);

    h.clock.now = new Date('2026-10-29T21:30:00.000Z');
    const done = await avery.post(`/api/reviews/${r.id}/complete`, { baseVersion: upd.body.record.version, decisions: [{ record_id: 'decision:D02', outcome: 'Go with the first option' }, { record_id: 'milestone:W07', outcome: 'Wait a week' }] });
    expect(done.status).toBe(200);
    expect(done.body.record.status).toBe('completed');
    expect(done.body.record.data.completed_at).toBe('2026-10-29T21:30:00.000Z');
    expect(done.body.record.data.reviewed_record_ids).toEqual(expect.arrayContaining(['milestone:W06', 'decision:D02', 'milestone:W07'])); // decisions are always linked
    const audit = (await avery.get(`/api/audit?record_id=${r.id}`)).body.entries;
    expect(audit[0]).toMatchObject({ action: 'review_complete', actor: 'avery' });

    // Completed reviews are immutable.
    const frozen = await avery.patch(`/api/reviews/${r.id}`, { baseVersion: done.body.record.version, changes: { summary: 'late edit' } });
    expect(frozen.status).toBe(409);
    expect((await avery.post(`/api/reviews/${r.id}/complete`, { baseVersion: done.body.record.version })).status).toBe(409);

    expect((await avery.get('/api/snapshot')).body.last_review_completed_at).toBe('2026-10-29T21:30:00.000Z');
    h.clock.now = new Date('2026-11-10T20:00:00.000Z');
    const next = await jun.post('/api/reviews', {});
    expect(next.body.resumed).toBe(false);
    expect(next.body.record.id).not.toBe(r.id);
    expect(next.body.record.data.since).toBe('2026-10-29T21:30:00.000Z');
  });

  it('rejects more than three decisions, unknown records and invalid fields (nothing written)', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const r = (await c.post('/api/reviews', {})).body.record;
    const four = ['decision:D01', 'decision:D02', 'decision:D03', 'decision:D04'].map((id) => ({ record_id: id, outcome: 'ok' }));
    const audits = countRows(h.db, 'audit_log');
    expect((await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { decisions: four } })).status).toBe(422);
    expect((await c.post(`/api/reviews/${r.id}/complete`, { baseVersion: r.version, decisions: four })).status).toBe(422);
    expect((await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { decisions: [{ record_id: 'decision:NOPE', outcome: 'x' }] } })).status).toBe(422);
    expect((await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { reviewed_record_ids: ['milestone:NOPE'] } })).status).toBe(422);
    expect((await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { participants: ['mochi'] } })).status).toBe(422);
    expect((await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { next_review_on: '2026-02-31' } })).status).toBe(422);
    expect((await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { summary: 'x'.repeat(6000) } })).status).toBe(422);
    expect((await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { status: 'completed' } })).status).toBe(422);
    expect(countRows(h.db, 'audit_log')).toBe(audits);
    const stale = await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version + 1, changes: { summary: 'x' } });
    expect(stale.status).toBe(409);
    expect((await c.patch('/api/reviews/milestone:W06', { baseVersion: 1, changes: {} })).status).toBe(404);
  });

  it('keeps what the open review has covered, so resuming it starts where it stopped, and drops it when saved', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const r = (await avery.post('/api/reviews', {})).body.record;
    expect(r.data.progress ?? null).toBeNull();

    const progress = {
      step: 2,
      accepted: [{ id: 'milestone:W06', title: 'A shared step', owner: 'Jun' }],
      decisions: [{ id: 'decision:D02', title: 'A decision', outcome: 'Avery approved “the first option”' }],
      questions: [],
      change_count: 7,
    };
    const upd = await avery.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { progress } });
    expect(upd.status).toBe(200);
    expect(upd.body.record.version).toBe(r.version + 1);
    expect(upd.body.record.data.progress).toEqual(progress);
    // Nothing else about the review changed.
    expect(upd.body.record.data).toMatchObject({ summary: '', decisions: [], reviewed_record_ids: [], completed_at: null });

    // The other adult resuming the open review gets it back, with the same list and step (also on the snapshot).
    const again = await jun.post('/api/reviews', {});
    expect(again.body.resumed).toBe(true);
    expect(again.body.record.data.progress).toEqual(progress);
    const snap = (await jun.get('/api/snapshot')).body.records.find((x: { id: string }) => x.id === r.id);
    expect(snap.data.progress).toEqual(progress);

    // A stale save is refused with the newer record, so the page can merge and try again.
    const stale = await avery.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { progress: { ...progress, step: 3 } } });
    expect(stale.status).toBe(409);
    expect(stale.body.details.server.data.progress).toEqual(progress);

    // Completing records the summary and drops the working list.
    const done = await avery.post(`/api/reviews/${r.id}/complete`, { baseVersion: upd.body.record.version, summary: 'We looked at things.' });
    expect(done.status).toBe(200);
    expect(done.body.record.data.progress).toBeUndefined();
    expect(done.body.record.data.summary).toBe('We looked at things.');
  });

  it('refuses a progress list that is the wrong shape, too long, or names records that do not exist (nothing written)', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const r = (await c.post('/api/reviews', {})).body.record;
    const ok = { step: 1, accepted: [], decisions: [], questions: [], change_count: 0 };
    const audits = countRows(h.db, 'audit_log');
    const bad = async (progress: unknown) => (await c.patch(`/api/reviews/${r.id}`, { baseVersion: r.version, changes: { progress } })).status;
    expect(await bad({ ...ok, step: -1 })).toBe(422);
    expect(await bad({ ...ok, step: 1.5 })).toBe(422);
    expect(await bad({ ...ok, step: 10 })).toBe(422);
    expect(await bad({ ...ok, change_count: -3 })).toBe(422);
    expect(await bad({ ...ok, extra: true })).toBe(422);
    expect(await bad({ step: 1 })).toBe(422);
    expect(await bad({ ...ok, decisions: Array.from({ length: 21 }, () => ({ id: 'decision:D01', title: 't', outcome: 'o' })) })).toBe(422);
    expect(await bad({ ...ok, questions: [{ id: 'question:Q01', title: 'multi\nline', outcome: 'o' }] })).toBe(422);
    expect(await bad({ ...ok, accepted: [{ id: 'milestone:NOPE', title: 'x', owner: 'Jun' }] })).toBe(422);
    expect(await bad({ ...ok, accepted: [{ id: 'milestone:W06', title: 'x'.repeat(501), owner: 'Jun' }] })).toBe(422);
    expect(countRows(h.db, 'audit_log')).toBe(audits);
    expect(await bad(ok)).toBe(200);
  });

  it('can also be started through the generic create endpoint, and cannot be edited through the generic PATCH', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const res = await c.post('/api/records', { type: 'review_session', title: 'Saturday check-in', data: {} });
    expect(res.status).toBe(201);
    expect(res.body.record).toMatchObject({ type: 'review_session', title: 'Saturday check-in', status: 'in_progress' });
    const patch = await c.patch(`/api/records/${res.body.record.id}`, { baseVersion: 1, changes: { data: { summary: 'x' } } });
    expect(patch.status).toBe(422);
  });
});
