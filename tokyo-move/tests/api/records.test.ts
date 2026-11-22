import { afterEach, describe, expect, it } from 'vitest';
import { Client, DEMO_HOUSEHOLD_ID, OTHER_HOUSEHOLD_ID, countRows, givePassword, loginAs, makeHarness, recordRow, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const noteBody = (extra: Record<string, unknown> = {}) => ({ type: 'note', title: 'A note', data: { body: 'Plain words' }, ...extra });

describe('snapshot', () => {
  it('returns everything the UI needs, without raw source', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const res = await c.get('/api/snapshot');
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.people.map((p: any) => p.id)).toEqual(['avery', 'jun', 'mochi']);
    expect(s.me).toMatchObject({ mode: 'local-demo', person: { id: 'avery' } });
    expect(s.records.length).toBeGreaterThan(100);
    const withSource = s.records.filter((r: any) => r.source);
    expect(withSource.length).toBeGreaterThan(0);
    for (const r of withSource) expect(r.source.raw).toEqual({});
    expect(s.task_links.length).toBeGreaterThan(0);
    expect(s.last_import).toMatchObject({ source_label: 'Fictional demo' });
    expect(s.last_review_completed_at).toBeNull();
    expect(s.scenarios.map((x: any) => x.key)).toEqual(['planning', 'condo_delay', 'combined_stress']);
    expect(Object.keys(s.settings).sort()).toEqual(['jp_holidays', 'plan_baseline', 'planning_target', 'task_adapter', 'traveler_gates']);
    expect(s.settings.task_adapter).toMatchObject({ name: 'fixture', can_write: true });
    expect(Array.isArray(s.settings.traveler_gates)).toBe(true);
  });

  it('merges stored scenario settings over the defaults', async () => {
    const h = await harness();
    h.db.prepare("INSERT INTO settings (household_id, key, value) VALUES (?, 'scenarios', ?)").run(
      DEMO_HOUSEHOLD_ID,
      JSON.stringify([{ key: 'condo_delay', extra_us_months: 5 }, { key: 'custom', label: 'Custom', fx_factor: 0.8, extra_us_months: 1, horizon_months: 6 }]),
    );
    const c = await loginAs(h, 'avery');
    const s = (await c.get('/api/snapshot')).body.scenarios;
    expect(s.find((x: any) => x.key === 'condo_delay')).toMatchObject({ extra_us_months: 5, fx_factor: 1, label: 'Condo delay' });
    expect(s.find((x: any) => x.key === 'custom')).toMatchObject({ fx_factor: 0.8 });
    expect(s).toHaveLength(4);
  });

  it('safe defaults when the household has no stored settings', async () => {
    const h = await harness();
    h.db.prepare('DELETE FROM settings').run();
    const c = await loginAs(h, 'avery');
    const s = (await c.get('/api/snapshot')).body.settings;
    expect(s.traveler_gates).toEqual([]);
    expect(s.jp_holidays).toEqual([]);
    expect(s.plan_baseline).toEqual({ baseline_on: null, reviewed_on: null, source_label: 'Fictional demo household' });
  });
});

describe('visibility and households', () => {
  it('both adults see shared records but not each other\'s private notes', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const shared = (await avery.post('/api/records', noteBody({ title: 'Shared note' }))).body.record;
    const priv = (await avery.post('/api/records', noteBody({ title: 'Avery private', visibility: 'private' }))).body.record;
    expect(priv.visibility).toBe('private');

    const averySnap = (await avery.get('/api/snapshot')).body;
    const junSnap = (await jun.get('/api/snapshot')).body;
    const ids = (s: any) => s.records.map((r: any) => r.id);
    expect(ids(averySnap)).toContain(priv.id);
    expect(ids(junSnap)).toContain(shared.id);
    expect(ids(junSnap)).not.toContain(priv.id);

    expect((await jun.get(`/api/records/${priv.id}`)).status).toBe(404);
    expect((await jun.get('/api/records?type=note')).body.records.map((r: any) => r.id)).not.toContain(priv.id);
    expect((await jun.patch(`/api/records/${priv.id}`, { baseVersion: 1, changes: { title: 'hijack' } })).status).toBe(404);
    expect((await jun.post(`/api/records/${priv.id}/status`, { baseVersion: 1, status: 'archived' })).status).toBe(404);
    expect((await jun.get(`/api/audit?record_id=${priv.id}`)).status).toBe(404);
    const junAudit = (await jun.get('/api/audit?limit=500')).body.entries;
    expect(junAudit.some((e: any) => e.record_id === priv.id)).toBe(false);
    const junExport = (await jun.get('/api/export?format=json')).body;
    expect(junExport.records.some((r: any) => r.id === priv.id)).toBe(false);
    expect(recordRow(h.db, priv.id).title).toBe('Avery private');
  });

  it('only the creator may change visibility', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const shared = (await avery.post('/api/records', noteBody())).body.record;
    const denied = await jun.patch(`/api/records/${shared.id}`, { baseVersion: shared.version, changes: { visibility: 'private' } });
    expect(denied.status).toBe(403);
    const imported = await jun.patch('/api/records/milestone:W06', { baseVersion: 1, changes: { visibility: 'private' } });
    expect(imported.status).toBe(403);
    const ok = await avery.patch(`/api/records/${shared.id}`, { baseVersion: shared.version, changes: { visibility: 'private' } });
    expect(ok.status).toBe(200);
    expect((await jun.get(`/api/records/${shared.id}`)).status).toBe(404);
  });

  it('another household gets 404 for ids it does not own, and an empty view of the first household', async () => {
    const h = await harness({ secondHousehold: true });
    const avery = await loginAs(h, 'avery');
    // zed has no password yet; give one and sign in.
    await givePassword(h.db, 'zed');
    const z = new Client(h.app);
    expect((await z.passwordLogin('zed')).status).toBe(200);

    const averySnap = (await avery.get('/api/snapshot')).body;
    const zedSnap = (await z.get('/api/snapshot')).body;
    expect(zedSnap.records.map((r: any) => r.id)).toEqual(['note:Z1']);
    expect(zedSnap.people.map((p: any) => p.id)).toEqual(['zed']);
    expect(zedSnap.task_links).toEqual([]);
    expect(zedSnap.last_import).toBeNull();
    expect(averySnap.records.some((r: any) => r.id === 'note:Z1')).toBe(false);

    for (const rec of ['milestone:W06', 'decision:D02', 'anchor:TN', 'cost:B01']) {
      expect((await z.get(`/api/records/${rec}`)).status, rec).toBe(404);
    }
    const before = recordRow(h.db, 'milestone:W06');
    expect((await z.patch('/api/records/milestone:W06', { baseVersion: before.version, changes: { title: 'x' } })).status).toBe(404);
    expect((await z.post('/api/records/milestone:W06/status', { baseVersion: before.version, status: 'in_progress' })).status).toBe(404);
    expect((await z.post('/api/decisions/decision:D02/approve', { baseVersion: 1, option_id: 'opt-1' })).status).toBe(404);
    expect((await z.put('/api/anchors/TN', { baseVersion: 1, date: '2027-01-01', confidence: 'planned' })).status).toBe(404);
    expect((await z.post('/api/anchors/TN/preview', { date: '2027-01-01' })).status).toBe(404);
    expect((await z.get('/api/audit?record_id=milestone:W06')).status).toBe(404);
    expect((await z.get('/api/audit?limit=500')).body.entries).toEqual([]);
    expect((await z.get('/api/tasks')).body.task_links).toEqual([]);
    expect((await z.patch('/api/tasks/tl-fixture-FX-0001', { baseVersion: 1, changes: { title: 'x' } })).status).toBe(404);
    expect((await z.get('/api/import/runs')).body.runs).toEqual([]);
    const exported = (await z.get('/api/export?format=json')).body;
    expect(exported.records.map((r: any) => r.id)).toEqual(['note:Z1']);
    expect(recordRow(h.db, 'milestone:W06').version).toBe(before.version);
    // A note linking to another household's record is rejected without revealing it exists.
    const link = await z.post('/api/records', noteBody({ data: { body: 'x', linked_record_id: 'milestone:W06' } }));
    expect(link.status).toBe(422);
    expect(OTHER_HOUSEHOLD_ID).toBe('other-household');
  });
});

describe('record detail', () => {
  it('returns full source, audit trail and linked notes', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const note = (await c.post('/api/records', noteBody({ data: { body: 'About W06', linked_record_id: 'milestone:W06' } }))).body.record;
    await c.patch('/api/records/milestone:W06', { baseVersion: 1, changes: { data: { next_action: 'Do the thing' } } });
    const res = await c.get('/api/records/milestone:W06');
    expect(res.status).toBe(200);
    expect(res.body.record.id).toBe('milestone:W06');
    expect(Object.keys(res.body.record.source.raw).length).toBeGreaterThan(0);
    expect(res.body.audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['update', 'import_create']));
    expect(res.body.linked_notes.map((n: any) => n.id)).toEqual([note.id]);
    expect(Array.isArray(res.body.task_links)).toBe(true);
  });
});

describe('creating records', () => {
  it('creates notes, risks, decisions, findings, cost lines and contacts as the session person', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const note = await c.post('/api/records', noteBody());
    expect(note.status).toBe(201);
    expect(note.body.record).toMatchObject({ type: 'note', created_by: 'jun', updated_by: 'jun', version: 1, visibility: 'household', source: null, status: 'active' });
    expect(note.body.record.id).toMatch(/^note:N-[0-9A-F]{10}$/);

    const risk = await c.post('/api/records', { type: 'risk', title: 'Lease slips', data: { severity: 'high', mitigation: 'Ask early' } });
    expect(risk.body.record.data).toMatchObject({ raid_kind: 'risk', severity: 'high', mitigation: 'Ask early', linked_records: [] });

    const decision = await c.post('/api/records', { type: 'decision', title: 'Pick a mover', data: { options: [{ label: 'Mover A' }, { label: 'Mover B', consequences: 'Costs more' }] } });
    expect(decision.body.record.data.options.map((o: any) => o.id)).toEqual(['opt-1', 'opt-2']);
    expect(decision.body.record.data.required_approvers).toEqual(['avery', 'jun']);
    expect(decision.body.record.status).toBe('open');

    const finding = await c.post('/api/records', { type: 'finding', title: 'Unclear label', data: { severity: 'low' } });
    expect(finding.body.record.data.disposition).toBe('open');

    const cost = await c.post('/api/records', { type: 'cost', title: 'Extra boxes', data: { section: 'one_time', description: 'Extra boxes', estimate: { amount: 120, currency: 'USD' } } });
    expect(cost.body.record.data).toMatchObject({ applicability: 'include', commitment_state: 'estimate', source_section: 'Added in Kadode', quote: null, paid: null });

    const contact = await c.post('/api/records', { type: 'contact', title: 'Packers', data: { name: 'Example Packers', role: 'Packing' } });
    expect(contact.body.record.data).toMatchObject({ relationship: 'potential', name: 'Example Packers' });

    const audit = (await c.get('/api/audit?limit=500')).body.entries.filter((e: any) => e.action === 'create');
    expect(audit).toHaveLength(6);
    expect(new Set(audit.map((a: any) => a.actor))).toEqual(new Set(['jun']));
    expect(audit[0].before).toBeNull();
  });

  it('refuses types that only imports create, and any client-supplied identity or system fields', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    for (const type of ['milestone', 'anchor', 'document', 'workstream']) {
      expect((await c.post('/api/records', { type, title: 'x', data: {} })).status, type).toBe(422);
    }
    for (const field of ['created_by', 'actor', 'id', 'household_id', 'version', 'source', 'status', 'key']) {
      const res = await c.post('/api/records', noteBody({ [field]: 'whatever' }));
      expect(res.status, field).toBe(422);
    }
    expect(countRows(h.db, 'records', "type = 'note'")).toBe(0);
  });

  it('validation failures return 422 and write nothing', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const before = { records: countRows(h.db, 'records'), audit: countRows(h.db, 'audit_log') };
    const bad: [string, unknown][] = [
      ['empty title', noteBody({ title: '' })],
      ['missing body', { type: 'note', title: 'x', data: {} }],
      ['unknown data field', noteBody({ data: { body: 'x', color: 'red' } })],
      ['control chars', noteBody({ title: 'bad\u0000title' })],
      ['bad owner', noteBody({ owner: 'nobody' })],
      ['pet owner', noteBody({ owner: 'mochi' })],
      ['bad visibility', noteBody({ visibility: 'public' })],
      ['linked record missing', noteBody({ data: { body: 'x', linked_record_id: 'milestone:NOPE' } })],
      ['negative money', { type: 'cost', title: 'x', data: { section: 'one_time', description: 'x', estimate: { amount: -1, currency: 'USD' } } }],
      ['bad currency', { type: 'cost', title: 'x', data: { section: 'one_time', description: 'x', estimate: { amount: 1, currency: 'EUR' } } }],
      ['exclude without reason', { type: 'cost', title: 'x', data: { section: 'one_time', description: 'x', applicability: 'exclude' } }],
      ['bad approver', { type: 'decision', title: 'x', data: { required_approvers: ['mochi'] } }],
      ['duplicate option ids', { type: 'decision', title: 'x', data: { options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] } }],
      ['not an object', '"just a string"'],
    ];
    for (const [name, body] of bad) {
      const res = await c.request('POST', '/api/records', body);
      expect(res.status, name).toBe(422);
      expect(res.body.error, name).toBe('validation');
    }
    expect(countRows(h.db, 'records')).toBe(before.records);
    expect(countRows(h.db, 'audit_log')).toBe(before.audit);
    const detail = (await c.post('/api/records', noteBody({ title: '' }))).body;
    expect(Array.isArray(detail.details)).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('Plain words'); // offending values are not echoed
  });
});

describe('editing records', () => {
  it('applies the allowlist, increments version, stamps the session person and tracks locally edited fields', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const before = (await c.get('/api/records/milestone:W06')).body.record;
    const newOwner = before.owner === 'together' ? 'jun' : 'together';
    const newPriority = before.data.priority === 'now' ? 'later' : 'now';
    const res = await c.patch('/api/records/milestone:W06', {
      baseVersion: before.version,
      changes: { title: 'Renamed milestone', owner: newOwner, data: { next_action: 'Call the office', priority: newPriority } },
      reason: 'clarifying',
    });
    expect(res.status).toBe(200);
    const r = res.body.record;
    expect(r).toMatchObject({ title: 'Renamed milestone', owner: newOwner, owner_proposed: false, version: before.version + 1, updated_by: 'jun' });
    expect(r.data.next_action).toBe('Call the office');
    expect(r.data.priority).toBe(newPriority);
    expect(r.data.contingency).toBe(before.data.contingency); // untouched fields survive
    expect(r.locally_edited).toEqual(expect.arrayContaining(['title', 'owner', 'data.next_action', 'data.priority']));
    expect(r.source.raw).toEqual({}); // PATCH responses never carry raw
    const row = recordRow(h.db, 'milestone:W06');
    expect(JSON.parse(row.locally_edited)).toEqual(expect.arrayContaining(['title', 'data.next_action']));
    const audit = (await c.get('/api/audit?record_id=milestone:W06')).body.entries[0];
    expect(audit).toMatchObject({ action: 'update', actor: 'jun', reason: 'clarifying' });
    expect(audit.before.title).toBe(before.title);
    expect(audit.after.title).toBe('Renamed milestone');
    expect(audit.after.data.next_action).toBe('Call the office');
  });

  it('merges one level deep inside object fields', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = (await c.get('/api/records/cost:B01')).body.record;
    // cost.phase may be null in the demo; set a full phase, then change one key of it.
    const set = await c.patch('/api/records/cost:B01', {
      baseVersion: m.version,
      changes: { data: { phase: { traveler: null, start_anchor: 'TN', start_date: null, end_anchor: null, end_date: null, months: 3, note: 'initial' } } },
    });
    expect(set.status).toBe(200);
    const merged = await c.patch('/api/records/cost:B01', { baseVersion: set.body.record.version, changes: { data: { phase: { months: 6 } } } });
    expect(merged.status).toBe(200);
    expect(merged.body.record.data.phase).toMatchObject({ months: 6, start_anchor: 'TN', note: 'initial' });
  });

  it('rejects envelope fields, protected data fields and unknown fields (nothing written)', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const v = recordRow(h.db, 'milestone:W06').version;
    const audits = countRows(h.db, 'audit_log');
    const attempts: Record<string, unknown>[] = [
      { source: { file: 'x' } }, { id: 'milestone:X' }, { key: 'X' }, { type: 'risk' }, { household_id: 'other-household' },
      { version: 99 }, { status: 'completed' }, { created_by: 'jun' }, { updated_by: 'jun' }, { locally_edited: [] }, { surprise: 1 },
    ];
    for (const changes of attempts) {
      const res = await c.patch('/api/records/milestone:W06', { baseVersion: v, changes });
      expect(res.status, JSON.stringify(changes)).toBe(422);
    }
    const dataAttempts: Record<string, unknown>[] = [
      { source: {} }, { id: 'x' }, { key: 'x' }, { type: 'x' }, { household_id: 'x' }, { version: 3 },
      { traveler_progress: {} }, { dependency_scope: { W03: ['avery'] } }, { status_reason: 'sneaky' }, { completion_evidence: [] },
      { traveler_scope: [] }, { dependencies: [] }, { phase: 'p1_now_nov2026' }, { linked_task_ids: [] }, { review_note: 'x' },
      { unknown_field: 1 }, { constructor: 'x' },
    ];
    for (const data of dataAttempts) {
      const res = await c.patch('/api/records/milestone:W06', { baseVersion: v, changes: { data } });
      expect(res.status, JSON.stringify(data)).toBe(422);
    }
    const proto = await c.request('PATCH', '/api/records/milestone:W06', `{"baseVersion":${v},"changes":{"data":{"__proto__":{"polluted":true}}}}`);
    expect([200, 422]).toContain(proto.status); // the key is stripped (or refused); it never reaches the record
    expect(({} as any).polluted).toBeUndefined();
    expect(recordRow(h.db, 'milestone:W06').data).not.toContain('polluted');
    expect(recordRow(h.db, 'milestone:W06').version).toBe(v);
    expect(countRows(h.db, 'audit_log')).toBe(audits);
  });

  it('validates values per field and reports paths without echoing values', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const v = recordRow(h.db, 'milestone:W06').version;
    const bad: Record<string, unknown>[] = [
      { review_date: '2027-02-30' }, { review_date: 'tomorrow' }, { priority: 'urgent' }, { next_action: '' }, { collaborators: 'one' },
      { deadline: { kind: 'wishful' } },
    ];
    for (const data of bad) {
      const res = await c.patch('/api/records/milestone:W06', { baseVersion: v, changes: { data } });
      expect(res.status, JSON.stringify(data)).toBe(422);
      expect(res.body.details[0].path).toMatch(/^data\./);
    }
    const ok = await c.patch('/api/records/milestone:W06', { baseVersion: v, changes: { data: { review_date: '2027-01-15' } } });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data.review_date).toBe('2027-01-15');
    const badOwner = await c.patch('/api/records/milestone:W06', { baseVersion: ok.body.record.version, changes: { owner: 'mochi' } });
    expect(badOwner.status).toBe(422);
  });

  it('edits inventory, property and workstream items with their own field lists', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const inv = (await c.get('/api/records/inventory:INV01')).body.record;
    const ok = await c.patch('/api/records/inventory:INV01', { baseVersion: inv.version, changes: { data: { location: 'Hallway closet', quantity: '3 boxes', disposition: 'Ship' } } });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data).toMatchObject({ location: 'Hallway closet', quantity: '3 boxes', disposition: 'Ship', category: inv.data.category });
    expect((await c.patch('/api/records/inventory:INV01', { baseVersion: ok.body.record.version, changes: { data: { category: 'Renamed' } } })).status).toBe(422);
    expect((await c.patch('/api/records/inventory:INV01', { baseVersion: ok.body.record.version, changes: { data: { surprise: 'x' } } })).status).toBe(422);
    const prop = (await c.get('/api/records/property:PROP01')).body.record;
    const p2 = await c.patch('/api/records/property:PROP01', { baseVersion: prop.version, changes: { data: { evidence_status: 'Contract re-read on paper' } } });
    expect(p2.body.record.data.evidence_status).toBe('Contract re-read on paper');
    expect((await c.patch('/api/records/property:PROP01', { baseVersion: p2.body.record.version, changes: { data: { milestone_links: [] } } })).status).toBe(422);
    const ws = (await c.get('/api/records?type=workstream')).body.records[0];
    const w2 = await c.patch(`/api/records/${ws.id}`, { baseVersion: ws.version, changes: { data: { next_action: 'Draft the checklist' } } });
    expect(w2.body.record.data.next_action).toBe('Draft the checklist');
    expect((await c.patch(`/api/records/${ws.id}`, { baseVersion: w2.body.record.version, changes: { data: { milestone_keys: [] } } })).status).toBe(422);
  });

  it('a no-op edit does not bump the version or write audit', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const r = (await c.get('/api/records/milestone:W06')).body.record;
    const audits = countRows(h.db, 'audit_log');
    const res = await c.patch('/api/records/milestone:W06', { baseVersion: r.version, changes: { title: r.title } });
    expect(res.status).toBe(200);
    expect(res.body.record.version).toBe(r.version);
    expect(countRows(h.db, 'audit_log')).toBe(audits);
  });

  it('concurrent edits: the second writer with the same baseVersion gets 409 and the server copy', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const base = (await avery.get('/api/records/milestone:W06')).body.record;
    const first = await avery.patch('/api/records/milestone:W06', { baseVersion: base.version, changes: { data: { next_action: 'Avery wording' } } });
    expect(first.status).toBe(200);
    const second = await jun.patch('/api/records/milestone:W06', { baseVersion: base.version, changes: { data: { next_action: 'Jun wording' } } });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('conflict');
    expect(second.body.details.server.data.next_action).toBe('Avery wording');
    expect(second.body.details.server.version).toBe(base.version + 1);
    expect(second.body.details.server_version).toBe(base.version + 1);
    expect(second.body.details.your_changes).toEqual({ data: { next_action: 'Jun wording' } });
    expect(recordRow(h.db, 'milestone:W06').version).toBe(base.version + 1);
    // Re-applying on the fresh version works.
    const retry = await jun.patch('/api/records/milestone:W06', { baseVersion: second.body.details.server_version, changes: { data: { next_action: 'Jun wording' } } });
    expect(retry.status).toBe(200);
  });
});

describe('persistence', () => {
  it('records, sessions-independent data and audit survive closing and reopening the database file', async () => {
    const first = await harness();
    const c = await loginAs(first, 'avery');
    const created = (await c.post('/api/records', noteBody({ title: 'Persist me' }))).body.record;
    await c.patch(`/api/records/${created.id}`, { baseVersion: 1, changes: { title: 'Persisted title' } });
    const { dbPath, dir } = first;
    await first.app.close();
    first.db.close();
    const second = await makeHarness({ dbPath, dir, seed: false });
    open.push(second);
    const c2 = await loginAs(second, 'avery');
    const got = await c2.get(`/api/records/${created.id}`);
    expect(got.status).toBe(200);
    expect(got.body.record).toMatchObject({ title: 'Persisted title', version: 2 });
    expect(got.body.audit.map((a: any) => a.action)).toEqual(['update', 'create']);
    expect(countRows(second.db, 'households')).toBe(1);
  });
});
