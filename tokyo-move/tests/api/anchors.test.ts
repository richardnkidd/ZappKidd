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

describe('anchor preview', () => {
  it('returns the affected deadlines without writing anything', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const before = { records: JSON.stringify(h.db.prepare('SELECT id, version, data FROM records ORDER BY id').all()), audit: countRows(h.db, 'audit_log') };
    const res = await c.post('/api/anchors/TN/preview', { date: '2027-08-01' });
    expect(res.status).toBe(200);
    const p = res.body.preview;
    expect(p).toMatchObject({ anchor: 'TN', before: '2027-07-06', after: '2027-08-01' });
    expect(Array.isArray(p.changes)).toBe(true);
    expect(p.changes.length).toBeGreaterThan(0);
    expect(p.unaffected_travelers).toEqual(expect.arrayContaining(['jun']));
    expect(Array.isArray(p.warnings)).toBe(true);
    expect(JSON.stringify(h.db.prepare('SELECT id, version, data FROM records ORDER BY id').all())).toBe(before.records);
    expect(countRows(h.db, 'audit_log')).toBe(before.audit);

    const cleared = await c.post('/api/anchors/TN/preview', { date: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.preview.after).toBeNull();
  });

  it('validates the body and anchor code', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    expect((await c.post('/api/anchors/TN/preview', { date: '2027-02-30' })).status).toBe(422);
    expect((await c.post('/api/anchors/TN/preview', { date: 'next week' })).status).toBe(422);
    expect((await c.post('/api/anchors/TN/preview', {})).status).toBe(422);
    expect((await c.post('/api/anchors/TN/preview', { date: '2027-08-01', extra: 1 })).status).toBe(422);
    expect((await c.post('/api/anchors/NOPE/preview', { date: '2027-08-01' })).status).toBe(404);
  });
});

describe('anchor change', () => {
  it('applies, audits as anchor_change, and records the locally edited fields', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const a = (await c.get('/api/records/anchor:TR')).body.record;
    expect(a.data.date).toBeNull();
    const res = await c.put('/api/anchors/TR', { baseVersion: a.version, date: '2027-02-10', confidence: 'tentative', evidence: 'Agreed with the landlord' });
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ version: a.version + 1, updated_by: 'jun' });
    expect(res.body.record.data).toMatchObject({ date: '2027-02-10', confidence: 'tentative', evidence: 'Agreed with the landlord' });
    expect(res.body.record.locally_edited).toEqual(expect.arrayContaining(['data.date', 'data.confidence', 'data.evidence']));
    expect(res.body.preview).toMatchObject({ anchor: 'TR', after: '2027-02-10' });
    const entry = (await c.get('/api/audit?record_id=anchor:TR')).body.entries[0];
    expect(entry).toMatchObject({ action: 'anchor_change', actor: 'jun' });
    expect(entry.before.data.date).toBeNull();
    expect(entry.after.data.date).toBe('2027-02-10');
  });

  it('rejects bad dates, inconsistent confidence and stale versions without writing', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const a = (await c.get('/api/records/anchor:TR')).body.record;
    const audits = countRows(h.db, 'audit_log');
    const bad: Record<string, unknown>[] = [
      { baseVersion: a.version, date: '2027-02-30', confidence: 'planned' },
      { baseVersion: a.version, date: '10/02/2027', confidence: 'planned' },
      { baseVersion: a.version, date: '2027-02-10', confidence: 'awaiting' },
      { baseVersion: a.version, date: null, confidence: 'planned' },
      { baseVersion: a.version, date: '2027-02-10', confidence: 'maybe' },
      { baseVersion: a.version, date: '2027-02-10' },
      { baseVersion: a.version, date: '2027-02-10', confidence: 'planned', code: 'TN' },
    ];
    for (const body of bad) expect((await c.put('/api/anchors/TR', body)).status, JSON.stringify(body)).toBe(422);
    const stale = await c.put('/api/anchors/TR', { baseVersion: a.version + 3, date: '2027-02-10', confidence: 'planned' });
    expect(stale.status).toBe(409);
    expect(stale.body.details.server.id).toBe('anchor:TR');
    expect(recordRow(h.db, 'anchor:TR').version).toBe(a.version);
    expect(countRows(h.db, 'audit_log')).toBe(audits);
  });

  it('clearing a date sets it back to awaiting; other travelers\' anchors are untouched', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const a = (await c.get('/api/records/anchor:TN')).body.record;
    const other = (await c.get('/api/records/anchor:TR')).body.record;
    const res = await c.put('/api/anchors/TN', { baseVersion: a.version, date: null, confidence: 'awaiting' });
    expect(res.status).toBe(200);
    expect(res.body.record.data.date).toBeNull();
    expect((await c.get('/api/records/anchor:TR')).body.record).toMatchObject({ version: other.version });
  });

  it('PATCH cannot edit an anchor', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const a = (await c.get('/api/records/anchor:TN')).body.record;
    expect((await c.patch('/api/records/anchor:TN', { baseVersion: a.version, changes: { data: { date: '2028-01-01' } } })).status).toBe(422);
  });
});
