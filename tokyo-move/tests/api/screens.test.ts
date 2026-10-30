/**
 * Fields edited by the Money, Documents, Contacts, Future work, Settings and Data screens.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Client, DEMO_HOUSEHOLD_ID, countRows, givePassword, loginAs, makeHarness, recordRow, type Harness } from './helpers';

const open: Harness[] = [];
async function harness(opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(opts);
  open.push(h);
  return h;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const patch = (c: Client, id: string, version: number, data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  c.patch(`/api/records/${id}`, { baseVersion: version, changes: { data, ...extra } });

describe('cost lines', () => {
  async function line(c: Client) {
    return (await c.get('/api/records/cost:B01')).body.record;
  }

  it('edits amounts with exactly one currency each, and unknown money stays null', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const b = await line(c);
    const ok = await patch(c, b.id, b.version, {
      estimate: { amount: 150000, currency: 'JPY' },
      quote: { amount: 1200.5, currency: 'USD' },
      committed: null,
      paid: { amount: 0, currency: 'USD' },
      unpaid_balance: null,
      payer: 'Avery',
      quote_source: 'Written quote',
      quote_date: '2026-10-20',
      deposit_due: '2026-12-01',
      refundable: 'partial',
      uncertainty: 'Depends on volume',
      commitment_state: 'quote',
      duplication_check: 'Not in the moving quote',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data).toMatchObject({
      estimate: { amount: 150000, currency: 'JPY' },
      quote: { amount: 1200.5, currency: 'USD' },
      committed: null,
      paid: { amount: 0, currency: 'USD' },
      quote_date: '2026-10-20',
      deposit_due: '2026-12-01',
      refundable: 'partial',
      commitment_state: 'quote',
    });
    expect(ok.body.record.locally_edited).toEqual(expect.arrayContaining(['data.estimate', 'data.quote', 'data.deposit_due']));
  });

  it('rejects malformed money, dates and enums without writing', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const b = await line(c);
    const audits = countRows(h.db, 'audit_log');
    const bad: Record<string, unknown>[] = [
      { estimate: { amount: -1, currency: 'USD' } },
      { estimate: { amount: 10, currency: 'EUR' } },
      { estimate: { amount: 10 } },
      { estimate: { amount: '10', currency: 'USD' } },
      { estimate: { amount: 10, currency: 'USD', alt_currency: 'JPY', alt_amount: 1500 } }, // one currency per amount
      { estimate: { amount: 10, currency: ['USD', 'JPY'] } },
      { estimate: 10 },
      { quote: { amount: 1e15, currency: 'USD' } },
      { quote_date: '2026-02-30' },
      { deposit_due: 'next month' },
      { refundable: 'maybe' },
      { commitment_state: 'sort_of' },
      { applicability: 'skip' },
      { phase: { traveler: null, start_anchor: null, start_date: null, end_anchor: null, end_date: null, months: -1, note: null } },
      { phase: { traveler: null, start_anchor: null, start_date: '2027-13-01', end_anchor: null, end_date: null, months: 2, note: null } },
      { section: 'one_time' }, // not editable
      { source_section: 'x' },
    ];
    for (const data of bad) {
      const res = await patch(c, b.id, b.version, data);
      expect(res.status, JSON.stringify(data)).toBe(422);
    }
    expect(recordRow(h.db, b.id).version).toBe(b.version);
    expect(countRows(h.db, 'audit_log')).toBe(audits);
  });

  it('excluding a line requires a reason, now and when the reason is removed later', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const b = await line(c);
    expect((await patch(c, b.id, b.version, { applicability: 'exclude' })).status).toBe(422);
    expect((await patch(c, b.id, b.version, { applicability: 'exclude', exclusion_reason: '   ' })).status).toBe(422);
    const ok = await patch(c, b.id, b.version, { applicability: 'exclude', exclusion_reason: 'Covered by the mover' });
    expect(ok.status).toBe(200);
    const clear = await patch(c, b.id, ok.body.record.version, { exclusion_reason: null });
    expect(clear.status).toBe(422);
    const back = await patch(c, b.id, ok.body.record.version, { applicability: 'include' });
    expect(back.status).toBe(200);
  });

  it('phases merge one level and validate months', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const b = await line(c);
    const phase = { traveler: 'avery', start_anchor: 'TN', start_date: null, end_anchor: 'TR', end_date: null, months: null, note: null };
    const one = await patch(c, b.id, b.version, { phase });
    expect(one.status).toBe(200);
    const two = await patch(c, b.id, one.body.record.version, { phase: { months: 0, note: 'Short stay' } });
    expect(two.body.record.data.phase).toMatchObject({ traveler: 'avery', start_anchor: 'TN', months: 0, note: 'Short stay' });
    const three = await patch(c, b.id, two.body.record.version, { phase: null });
    expect(three.body.record.data.phase).toBeNull();
  });

  it('user-added cost lines go through the same validation', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const ok = await c.post('/api/records', {
      type: 'cost',
      title: 'Airport transfer',
      data: { section: 'one_time', description: 'Airport transfer', quote: { amount: 9000, currency: 'JPY' }, quote_date: '2026-10-25', refundable: 'no', phase: { traveler: null, start_anchor: null, start_date: null, end_anchor: null, end_date: null, months: 1, note: null } },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.record.data).toMatchObject({ applicability: 'include', commitment_state: 'quote', quote: { amount: 9000, currency: 'JPY' }, estimate: null, paid: null });
    const rows = countRows(h.db, 'records');
    const bad: Record<string, unknown>[] = [
      { section: 'one_time', description: 'x', estimate: { amount: -5, currency: 'USD' } },
      { section: 'one_time', description: 'x', estimate: { amount: 5, currency: 'USD', extra: 1 } },
      { section: 'one_time', description: 'x', applicability: 'exclude' },
      { section: 'one_time', description: 'x', quote_date: '2026-02-30' },
      { section: 'one_time', description: 'x', phase: { traveler: null, start_anchor: null, start_date: null, end_anchor: null, end_date: null, months: -2, note: null } },
      { section: 'weekly', description: 'x' },
      { description: 'x' },
    ];
    for (const data of bad) expect((await c.post('/api/records', { type: 'cost', title: 'x', data })).status, JSON.stringify(data)).toBe(422);
    expect(countRows(h.db, 'records')).toBe(rows);
  });
});

describe('funding and income', () => {
  async function jun(c: Client) {
    return (await c.get('/api/records/funding:INC-JUN')).body.record;
  }

  it('edits exchange rate, cash snapshot and sources', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const funds = (await c.get('/api/records?type=funding')).body.records as any[];
    const fx = funds.find((f) => f.data.kind === 'fx_rate');
    expect(fx).toBeTruthy();
    expect(fx.data.jpy_per_usd).toBeNull(); // unknown stays unknown
    const ok = await patch(c, fx.id, fx.version, { jpy_per_usd: 151.5, as_of: '2026-10-28', source: 'Bank rate page' });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data.jpy_per_usd).toBe(151.5);
    for (const jpy_per_usd of [0, -3, 'abc', 100000]) expect((await patch(c, fx.id, ok.body.record.version, { jpy_per_usd })).status, String(jpy_per_usd)).toBe(422);
    expect((await patch(c, fx.id, ok.body.record.version, { jpy_per_usd: null })).status).toBe(200);
    const cash = funds.find((f) => f.data.kind === 'cash_snapshot');
    const c2 = await patch(c, cash.id, cash.version, { amount: { amount: 40000, currency: 'USD' }, as_of: '2026-10-28', evidence: 'Statement viewed' });
    expect(c2.status).toBe(200);
    expect((await patch(c, cash.id, c2.body.record.version, { amount: { amount: 5, currency: 'USD' }, as_of: '2026-02-30' })).status).toBe(422);
  });

  it('a planning-zero income line cannot turn non-zero without verified_lawful, a source and an as_of date', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const l = await jun(c);
    expect(l.data).toMatchObject({ income_status: 'planning_zero', amount: { amount: 0 } });
    const audits = countRows(h.db, 'audit_log');
    const attempts: Record<string, unknown>[] = [
      { amount: { amount: 2000, currency: 'USD' } }, // still planning_zero
      { amount: { amount: 2000, currency: 'USD' }, income_status: 'unverified' },
    ];
    for (const data of attempts) expect((await patch(c, l.id, l.version, data)).status, JSON.stringify(data)).toBe(422);
    // verified_lawful but without a source or date -> 422 (blank them out first)
    h.db.prepare("UPDATE records SET data = json_set(data, '$.source', NULL, '$.as_of', NULL) WHERE id = 'funding:INC-JUN'").run();
    const bare = await jun(c);
    const noEvidence = await patch(c, bare.id, bare.version, { amount: { amount: 2000, currency: 'USD' }, income_status: 'verified_lawful' });
    expect(noEvidence.status).toBe(422);
    const paths = noEvidence.body.details.map((d: any) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['data.source', 'data.as_of']));
    expect(noEvidence.body.details.some((d: any) => d.path === 'data.income_status')).toBe(false);
    expect(countRows(h.db, 'audit_log')).toBe(audits);

    const ok = await patch(c, bare.id, bare.version, { amount: { amount: 2000, currency: 'USD' }, income_status: 'verified_lawful', source: 'Signed offer reviewed by the adviser', as_of: '2026-10-29' });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data).toMatchObject({ income_status: 'verified_lawful', amount: { amount: 2000 }, planning_zero_origin: true });
    expect(ok.body.record.locally_edited).toContain('data.planning_zero_origin');
  });

  it('cannot dodge the rule in two steps, and zero-income statuses cannot carry an amount', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const l = await jun(c);
    const away = await patch(c, l.id, l.version, { income_status: 'unverified' }); // leaves planning-zero, amount still 0
    expect(away.status).toBe(200);
    expect(away.body.record.data.planning_zero_origin).toBe(true);
    const sneaky = await patch(c, l.id, away.body.record.version, { amount: { amount: 900, currency: 'USD' } });
    expect(sneaky.status).toBe(422);
    const noneWithAmount = await patch(c, l.id, away.body.record.version, { income_status: 'confirmed_none', amount: { amount: 1, currency: 'USD' } });
    expect(noneWithAmount.status).toBe(422);
    const none = await patch(c, l.id, away.body.record.version, { income_status: 'confirmed_none' });
    expect(none.status).toBe(200);
  });

  it('the other adult\'s unverified line may hold an estimate, but marking it verified needs evidence', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const l = (await c.get('/api/records/funding:INC-AVERY')).body.record;
    const est = await patch(c, l.id, l.version, { amount: { amount: 3000, currency: 'USD' } });
    expect(est.status).toBe(200); // unverified estimates are allowed (and are not counted by the budget)
    const noSource = await patch(c, l.id, est.body.record.version, { income_status: 'verified_lawful' });
    expect(noSource.status).toBe(422);
    const ok = await patch(c, l.id, est.body.record.version, { income_status: 'verified_lawful', source: 'Adviser letter', as_of: '2026-10-29' });
    expect(ok.status).toBe(200);
  });
});

describe('documents', () => {
  it('edits lifecycle dates, custodian and accepts only https links', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const d = (await c.get('/api/records?type=document')).body.records[0];
    const ok = await patch(c, d.id, d.version, {
      requested_at: '2026-10-01',
      received_at: '2026-10-15T08:30:00Z',
      reviewed_at: '2026-10-16',
      accepted_by_authority_at: null,
      accepted_by: 'Municipal office',
      expiry: '2027-04-01',
      refresh_trigger: 'Reissue if dates change',
      custodian: 'Avery',
      link: 'https://drive.example.org/restricted/file/abc',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data).toMatchObject({ received_at: '2026-10-15T08:30:00Z', expiry: '2027-04-01', accepted_by: 'Municipal office', custodian: 'Avery', link: 'https://drive.example.org/restricted/file/abc' });
    let v = ok.body.record.version;
    const badLinks = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://drive.example.org/file', 'file:///etc/passwd', 'ftp://example.org/x', '//example.org/x', 'https://user:pass@example.org/x', 'not a url', ' https://example.org', 'https://'];
    for (const link of badLinks) expect((await patch(c, d.id, v, { link })).status, link).toBe(422);
    const bad: Record<string, unknown>[] = [{ requested_at: '2026-02-30' }, { received_at: 'yesterday' }, { expiry: '2027-13-01' }, { expiry: '2027-04-01T00:00:00Z' }, { reviewed_at: 5 }, { accepted_by: 'x'.repeat(400) }];
    for (const data of bad) expect((await patch(c, d.id, v, data)).status, JSON.stringify(data)).toBe(422);
    const cleared = await patch(c, d.id, v, { link: null, expiry: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.record.data.link).toBeNull();
    expect(recordRow(h.db, d.id).version).toBe(cleared.body.record.version);
  });

  it('completion-evidence links are https only too', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const m = (await c.get('/api/records/milestone:W06')).body.record;
    for (const link of ['http://example.org/r', 'javascript:alert(1)', 'data:text/plain,hi']) {
      const res = await c.post('/api/records/milestone:W06/status', { baseVersion: m.version, status: 'completed', evidence: { summary: 'Done', link } });
      expect(res.status, link).toBe(422);
    }
  });
});

describe('contacts and future work', () => {
  it('a relationship beyond "potential" needs a recorded basis', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const potential = (await c.get('/api/records?type=contact')).body.records.find((r: any) => r.data.relationship === 'potential');
    expect(potential).toBeTruthy();
    expect((await patch(c, potential.id, potential.version, { relationship: 'contacted' })).status).toBe(422);
    expect((await patch(c, potential.id, potential.version, { relationship: 'contacted', relationship_basis: '  ' })).status).toBe(422);
    expect((await patch(c, potential.id, potential.version, { relationship: 'colleague', relationship_basis: 'x' })).status).toBe(422);
    const ok = await patch(c, potential.id, potential.version, { relationship: 'contacted', relationship_basis: 'Sent an enquiry email on 2026-10-27' });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data).toMatchObject({ relationship: 'contacted', relationship_basis: 'Sent an enquiry email on 2026-10-27' });
    // Moving back to potential needs no basis; unrelated edits to an older contact without a basis are not blocked.
    const back = await patch(c, potential.id, ok.body.record.version, { relationship: 'potential', relationship_basis: null });
    expect(back.status).toBe(200);
    const engaged = (await c.get('/api/records?type=contact')).body.records.find((r: any) => r.data.relationship === 'engaged');
    expect((await patch(c, engaged.id, engaged.version, { role: 'Updated role' })).status).toBe(200);
  });

  it('new contacts follow the same rule', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    expect((await c.post('/api/records', { type: 'contact', title: 'X', data: { name: 'X', relationship: 'engaged' } })).status).toBe(422);
    const ok = await c.post('/api/records', { type: 'contact', title: 'X', data: { name: 'X', relationship: 'engaged', relationship_basis: 'Existing client of theirs' } });
    expect(ok.status).toBe(201);
    expect(ok.body.record.data.relationship_basis).toBe('Existing client of theirs');
    const pot = await c.post('/api/records', { type: 'contact', title: 'Y', data: { name: 'Y' } });
    expect(pot.body.record.data).toMatchObject({ relationship: 'potential', relationship_basis: null });
  });

  it('future-work interest accepts only the four values or null', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const f = (await c.get('/api/records?type=future_option')).body.records[0];
    let v = f.version;
    for (const interest of ['not_now', 'curious', 'exploring', 'paused', null]) {
      const res = await patch(c, f.id, v, { interest });
      expect(res.status, String(interest)).toBe(200);
      expect(res.body.record.data.interest).toBe(interest);
      v = res.body.record.version;
    }
    for (const interest of ['committed', 'yes', 3, '']) expect((await patch(c, f.id, v, { interest })).status, String(interest)).toBe(422);
  });
});

describe('household settings', () => {
  it('changes the display timezone and scenarios, household-scoped and audited', async () => {
    const h = await harness({ secondHousehold: true });
    await givePassword(h.db, 'zed');
    const z = new Client(h.app);
    await z.passwordLogin('zed');
    const c = await loginAs(h, 'avery');

    const tz = await c.put('/api/settings/display_timezone', { value: 'Asia/Tokyo', reason: 'We are travelling' });
    expect(tz.status).toBe(200);
    expect(tz.body).toMatchObject({ key: 'display_timezone', value: 'Asia/Tokyo' });
    expect((await c.get('/api/me')).body.household.display_timezone).toBe('Asia/Tokyo');
    expect((await c.get('/api/snapshot')).body.me.household.display_timezone).toBe('Asia/Tokyo');
    expect((await z.get('/api/me')).body.household.display_timezone).toBe('Asia/Tokyo'); // zed's own household was already Tokyo
    expect(h.db.prepare('SELECT display_timezone FROM households WHERE id = ?').get('other-household')).toEqual({ display_timezone: 'Asia/Tokyo' });
    expect(h.db.prepare('SELECT home_timezone FROM households WHERE id = ?').get(DEMO_HOUSEHOLD_ID)).toEqual({ home_timezone: 'Pacific/Honolulu' }); // home zone untouched

    const sc = await c.put('/api/settings/scenarios', {
      value: [{ key: 'condo_delay', extra_us_months: 6 }, { key: 'rate_drop', label: 'Rate drop', fx_factor: 0.85, extra_us_months: 0, horizon_months: 3 }],
    });
    expect(sc.status).toBe(200);
    expect(sc.body.effective.map((s: any) => s.key)).toEqual(['planning', 'condo_delay', 'combined_stress', 'rate_drop']);
    expect(sc.body.effective.find((s: any) => s.key === 'condo_delay')).toMatchObject({ extra_us_months: 6, fx_factor: 1, label: 'Condo delay' });
    const snap = (await c.get('/api/snapshot')).body;
    expect(snap.scenarios.find((s: any) => s.key === 'rate_drop').fx_factor).toBe(0.85);
    // The other household keeps its own (default) scenarios.
    expect((await z.get('/api/snapshot')).body.scenarios).toHaveLength(3);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE household_id = 'other-household' AND key = 'scenarios'").get()).toEqual({ n: 0 });

    const audit = (await c.get('/api/audit?limit=10')).body.entries.filter((e: any) => e.action === 'update' && e.record_id === null);
    expect(audit.map((e: any) => e.after.setting)).toEqual(['scenarios', 'display_timezone']);
    expect(audit[1]).toMatchObject({ actor: 'avery', reason: 'We are travelling', before: { setting: 'display_timezone', value: 'Pacific/Honolulu' }, after: { value: 'Asia/Tokyo' } });
    // Settings audit entries are not undoable.
    expect((await c.post(`/api/audit/${audit[0].id}/undo`, {})).status).toBe(422);
    // A no-op write is not audited.
    const before = countRows(h.db, 'audit_log');
    expect((await c.put('/api/settings/display_timezone', { value: 'Asia/Tokyo' })).status).toBe(200);
    expect(countRows(h.db, 'audit_log')).toBe(before);
  });

  it('only display_timezone and scenarios are editable, and values are validated', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const settingsBefore = JSON.stringify(h.db.prepare('SELECT * FROM settings ORDER BY household_id, key').all());
    for (const key of ['traveler_gates', 'plan_baseline', 'jp_holidays', 'task_adapter', '_import.jp_holidays', 'home_timezone', 'nope']) {
      const res = await c.put(`/api/settings/${key}`, { value: [] });
      expect(res.status, key).toBe(422);
    }
    for (const value of ['Europe/Paris', 'Asia/Tokyo ', 5, null, undefined]) {
      expect((await c.put('/api/settings/display_timezone', value === undefined ? {} : { value })).status, String(value)).toBe(422);
    }
    const badScenarios: unknown[] = [
      'x', [{ key: 'planning', fx_factor: 0 }], [{ key: 'planning', fx_factor: -1 }], [{ key: 'planning', extra_us_months: -1 }],
      [{ key: 'planning', extra_us_months: 1.5 }], [{ key: 'planning', horizon_months: 0 }], [{ key: 'brand_new' }],
      [{ key: 'planning' }, { key: 'planning' }], [{ key: 'planning', surprise: 1 }], [{ key: 'bad key!' }],
      Array.from({ length: 11 }, (_, i) => ({ key: `s${i}`, label: 'x', fx_factor: 1, extra_us_months: 0, horizon_months: 3 })),
    ];
    for (const value of badScenarios) expect((await c.put('/api/settings/scenarios', { value })).status, JSON.stringify(value)?.slice(0, 60)).toBe(422);
    expect((await c.put('/api/settings/scenarios', { value: [], extra: 1 })).status).toBe(422);
    expect(JSON.stringify(h.db.prepare('SELECT * FROM settings ORDER BY household_id, key').all())).toBe(settingsBefore);
    expect((await c.put('/api/settings/display_timezone', { value: 'Pacific/Honolulu' })).status).toBe(200);
  });

  it('detects a stale base value', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    await avery.put('/api/settings/scenarios', { value: [{ key: 'planning', label: 'Base case' }] });
    const stale = await jun.put('/api/settings/scenarios', { base: [], value: [{ key: 'planning', label: 'Jun case' }] });
    expect(stale.status).toBe(409);
    expect(stale.body.details.server_value).toEqual([{ key: 'planning', label: 'Base case' }]);
    const ok = await jun.put('/api/settings/scenarios', { base: stale.body.details.server_value, value: [{ key: 'planning', label: 'Jun case' }] });
    expect(ok.status).toBe(200);
    expect((await jun.put('/api/settings/display_timezone', { base: 'Asia/Tokyo', value: 'Pacific/Honolulu' })).status).toBe(409);
  });

  it('requires a session', async () => {
    const h = await harness();
    const c = new Client(h.app);
    expect((await c.put('/api/settings/scenarios', { value: [] })).status).toBe(401);
    expect((await c.get('/api/settings')).status).toBe(401);
  });

  it('never lists internal _import.* baseline keys, in the snapshot or the settings list', async () => {
    const h = await harness();
    const ins = h.db.prepare('INSERT OR REPLACE INTO settings (household_id, key, value) VALUES (?, ?, ?)');
    ins.run(DEMO_HOUSEHOLD_ID, '_import.traveler_gates', '[{"person_id":"leak-canary"}]');
    ins.run(DEMO_HOUSEHOLD_ID, '_import.jp_holidays', '["2099-01-01"]');
    ins.run(DEMO_HOUSEHOLD_ID, '_internal_flag', '"leak-canary"');
    const c = await loginAs(h, 'avery');
    const snap = (await c.get('/api/snapshot')).raw;
    expect(snap).not.toContain('leak-canary');
    expect(snap).not.toContain('2099-01-01');
    expect(Object.keys((await c.get('/api/snapshot')).body.settings).sort()).toEqual(['jp_holidays', 'plan_baseline', 'task_adapter', 'traveler_gates']);
    const list = (await c.get('/api/settings')).body;
    expect(JSON.stringify(list)).not.toContain('leak-canary');
    expect(Object.keys(list.settings).some((k) => k.startsWith('_'))).toBe(false);
    expect(list.settings).toHaveProperty('traveler_gates');
    expect(list.settings.display_timezone).toBe('Pacific/Honolulu');
    expect(list.editable).toEqual(['display_timezone', 'scenarios']);
    expect((await c.put('/api/settings/_import.jp_holidays', { value: [] })).status).toBe(422);
    const export_ = (await c.get('/api/export?format=json')).raw;
    expect(export_).not.toContain('leak-canary');
  });
});

describe('import receipts at real-run scale', () => {
  function insertReceipts(h: Harness, runId: string, n: number, recordFor: (i: number) => string = (i) => `milestone:W${String((i % 20) + 1).padStart(2, '0')}`) {
    const stmt = h.db.prepare(
      `INSERT INTO import_changes (id, household_id, import_run_id, record_id, change, field, before, after, rationale, correction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    h.db.transaction(() => {
      for (let i = 0; i < n; i += 1) {
        const corrected = i % 7 === 0;
        stmt.run(`bulk-${i}`, DEMO_HOUSEHOLD_ID, runId, recordFor(i), corrected ? 'correction_applied' : 'source_updated', 'data.x', JSON.stringify(`b${i}`), JSON.stringify(`a${i}`), 'bulk', corrected ? (i % 14 === 0 ? 'CORR-A' : 'CORR-B') : null);
      }
    })();
  }

  it('paginates ~1,400 receipts and filters by correction_id', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const runId = (await c.get('/api/import/runs')).body.runs[0].id;
    const base = (await c.get(`/api/import/runs/${runId}/changes?limit=1`)).body.total;
    insertReceipts(h, runId, 1400);
    const first = (await c.get(`/api/import/runs/${runId}/changes?limit=500&offset=0`)).body;
    expect(first).toMatchObject({ total: base + 1400, limit: 500, offset: 0 });
    expect(first.changes).toHaveLength(500);
    const seen = new Set<string>(first.changes.map((x: any) => x.id));
    for (let offset = 500; offset < first.total; offset += 500) {
      const page = (await c.get(`/api/import/runs/${runId}/changes?limit=500&offset=${offset}`)).body;
      for (const ch of page.changes) {
        expect(seen.has(ch.id)).toBe(false);
        seen.add(ch.id);
      }
    }
    expect(seen.size).toBe(base + 1400);
    expect((await c.get(`/api/import/runs/${runId}/changes?limit=2000`)).status).toBe(200);
    expect((await c.get(`/api/import/runs/${runId}/changes?limit=2001`)).status).toBe(422);
    expect((await c.get(`/api/import/runs/${runId}/changes?offset=-1`)).status).toBe(422);

    const a = (await c.get(`/api/import/runs/${runId}/changes?correction_id=CORR-A&limit=1000`)).body;
    const b = (await c.get(`/api/import/runs/${runId}/changes?correction_id=CORR-B&limit=1000`)).body;
    expect(a.total).toBe(Math.ceil(1400 / 14));
    expect(b.total).toBe(Math.ceil(1400 / 7) - Math.ceil(1400 / 14));
    expect(a.changes.every((x: any) => x.correction_id === 'CORR-A')).toBe(true);
    expect(a.changes).toHaveLength(a.total);
    const paged = (await c.get(`/api/import/runs/${runId}/changes?correction_id=CORR-B&limit=10&offset=10`)).body;
    expect(paged.changes).toHaveLength(10);
    expect(paged.changes[0].id).toBe(b.changes[10].id);
    expect(paged.total).toBe(b.total);
    expect((await c.get(`/api/import/runs/${runId}/changes?correction_id=NOPE`)).body).toMatchObject({ total: 0, changes: [] });
  });

  it('record detail returns at most 100 receipts for the record, newest first, across runs', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const runId = (await c.get('/api/import/runs')).body.runs[0].id;
    h.db.prepare("INSERT INTO import_runs (id, household_id, started_at, finished_at, source_label, files, fileset_sha256, counts, status, summary) VALUES ('run-2', ?, '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:01.000Z', 'Second run', '[]', 'abc', '{}', 'completed', '')").run(DEMO_HOUSEHOLD_ID);
    insertReceipts(h, runId, 400, () => 'milestone:W01');
    h.db.prepare("INSERT INTO import_changes (id, household_id, import_run_id, record_id, change, field, before, after, rationale, correction_id) VALUES ('latest-one', ?, 'run-2', 'milestone:W01', 'source_updated', 'title', NULL, NULL, 'newest', NULL)").run(DEMO_HOUSEHOLD_ID);
    const detail = (await c.get('/api/records/milestone:W01')).body;
    expect(detail.import_changes).toHaveLength(100);
    expect(detail.import_changes[0].id).toBe('latest-one');
    expect(new Set(detail.import_changes.map((x: any) => x.import_run_id))).toEqual(new Set(['run-2', runId]));
    expect(detail.import_changes.every((x: any) => x.record_id === 'milestone:W01')).toBe(true);
  });
});

describe('applies_to, sensitivity and carry_on_arrival', () => {
  it('applies_to merges per traveler, validates people and values, is audited and tracked as locally edited', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    for (const id of ['milestone:W06', (await c.get('/api/records?type=arrival')).body.records[0].id]) {
      const r = (await c.get(`/api/records/${id}`)).body.record;
      const first = await patch(c, id, r.version, { applies_to: { jun: 'no' } });
      expect(first.status, id).toBe(200);
      expect(first.body.record.data.applies_to).toMatchObject({ jun: 'no' });
      expect(first.body.record.locally_edited).toContain('data.applies_to');
      // Setting another traveler's answer keeps the first one (and a pet is a person of the household too).
      const second = await patch(c, id, first.body.record.version, { applies_to: { avery: 'yes', mochi: 'unknown' } });
      expect(second.status).toBe(200);
      expect(second.body.record.data.applies_to).toMatchObject({ jun: 'no', avery: 'yes', mochi: 'unknown' });
      // Changing one answer leaves the others alone.
      const third = await patch(c, id, second.body.record.version, { applies_to: { jun: 'yes' } });
      expect(third.body.record.data.applies_to).toMatchObject({ jun: 'yes', avery: 'yes', mochi: 'unknown' });
      const entry = (await c.get(`/api/audit?record_id=${encodeURIComponent(id)}`)).body.entries[0];
      expect(entry).toMatchObject({ action: 'update', actor: 'avery' });
      expect(entry.before.data.applies_to.jun).toBe('no');
      expect(entry.after.data.applies_to.jun).toBe('yes');
      // Re-sending the same answers is a no-op: no version bump, no audit.
      const audits = countRows(h.db, 'audit_log');
      const same = await patch(c, id, third.body.record.version, { applies_to: { jun: 'yes' } });
      expect(same.body.record.version).toBe(third.body.record.version);
      expect(countRows(h.db, 'audit_log')).toBe(audits);
      // Rejections write nothing.
      const v = third.body.record.version;
      for (const applies_to of [{ nobody: 'yes' }, { jun: 'maybe' }, { jun: true }, { jun: null }, 'yes', null, ['jun'], { constructor: 'yes' }]) {
        expect((await patch(c, id, v, { applies_to })).status, JSON.stringify(applies_to)).toBe(422);
      }
      expect(recordRow(h.db, id).version).toBe(v);
    }
    const risk = (await c.get('/api/records?type=risk')).body.records[0];
    expect((await patch(c, risk.id, risk.version, { applies_to: { jun: 'no' } })).status).toBe(422); // only milestones and arrival items
  });

  it('applies_to answers by one adult are not erased when the other sets theirs', async () => {
    const h = await harness();
    const avery = await loginAs(h, 'avery');
    const jun = await loginAs(h, 'jun');
    const m = (await avery.get('/api/records/milestone:W06')).body.record;
    const a = await patch(avery, m.id, m.version, { applies_to: { avery: 'yes' } });
    const b = await patch(jun, m.id, a.body.record.version, { applies_to: { jun: 'no' } });
    expect(b.body.record.data.applies_to).toMatchObject({ avery: 'yes', jun: 'no' });
    // A stale write still gets the normal conflict, not a silent overwrite.
    expect((await patch(jun, m.id, a.body.record.version, { applies_to: { jun: 'yes' } })).status).toBe(409);
  });

  it('sensitivity is a closed set (or null) on milestones, arrival items and documents only', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    const doc = (await c.get('/api/records?type=document')).body.records[0];
    const arrival = (await c.get('/api/records?type=arrival')).body.records[0];
    const milestone = (await c.get('/api/records/milestone:W06')).body.record;
    for (const rec of [doc, arrival, milestone]) {
      let v = rec.version;
      for (const sensitivity of ['medical', 'financial', 'identity', null]) {
        const res = await patch(c, rec.id, v, { sensitivity });
        expect(res.status, `${rec.type} ${sensitivity}`).toBe(200);
        expect(res.body.record.data.sensitivity).toBe(sensitivity);
        v = res.body.record.version;
      }
      for (const sensitivity of ['secret', 'Medical', '', 3, ['medical']]) {
        expect((await patch(c, rec.id, v, { sensitivity })).status, JSON.stringify(sensitivity)).toBe(422);
      }
    }
    const risk = (await c.get('/api/records?type=risk')).body.records[0];
    expect((await patch(c, risk.id, risk.version, { sensitivity: 'medical' })).status).toBe(422);
    const contact = (await c.get('/api/records?type=contact')).body.records[0];
    expect((await patch(c, contact.id, contact.version, { sensitivity: 'identity' })).status).toBe(422);
  });

  it('carry_on_arrival lists people of the household, on documents only', async () => {
    const h = await harness();
    const c = await loginAs(h, 'jun');
    const doc = (await c.get('/api/records?type=document')).body.records[0];
    const ok = await patch(c, doc.id, doc.version, { carry_on_arrival: ['avery', 'mochi', 'avery'] });
    expect(ok.status).toBe(200);
    expect(ok.body.record.data.carry_on_arrival).toEqual(['avery', 'mochi']); // duplicates collapse
    expect(ok.body.record.locally_edited).toContain('data.carry_on_arrival');
    const cleared = await patch(c, doc.id, ok.body.record.version, { carry_on_arrival: [] });
    expect(cleared.body.record.data.carry_on_arrival).toEqual([]);
    const v = cleared.body.record.version;
    for (const carry_on_arrival of [['nobody'], 'avery', null, [1], Array.from({ length: 11 }, () => 'avery')]) {
      expect((await patch(c, doc.id, v, { carry_on_arrival })).status, JSON.stringify(carry_on_arrival)).toBe(422);
    }
    const milestone = (await c.get('/api/records/milestone:W06')).body.record;
    expect((await patch(c, milestone.id, milestone.version, { carry_on_arrival: ['avery'] })).status).toBe(422);
    expect(recordRow(h.db, doc.id).version).toBe(v);
  });
});

describe('read-only importer settings: first_review and staging_analysis', () => {
  const firstReview = { decision_keys: ['D02', 'D03', 'D04'], note: 'Start with the housing choice.' };
  const staging = { relocation: { pattern: 'one adult first' }, immigration: { statement: 'Adviser to confirm the sequence.', implied_sequence_for_adviser_to_confirm: ['a', 'b'] }, nationality_branches: [{ if: 'x', then: 'y' }] };

  it('appear in the snapshot settings and the settings list, scoped to the household, and stay read-only', async () => {
    const h = await harness({ secondHousehold: true });
    const ins = h.db.prepare('INSERT OR REPLACE INTO settings (household_id, key, value) VALUES (?, ?, ?)');
    ins.run(DEMO_HOUSEHOLD_ID, 'first_review', JSON.stringify(firstReview));
    ins.run(DEMO_HOUSEHOLD_ID, 'staging_analysis', JSON.stringify(staging));
    ins.run(DEMO_HOUSEHOLD_ID, '_import.first_review', JSON.stringify({ decision_keys: ['LEAK'] }));
    ins.run(DEMO_HOUSEHOLD_ID, '_import.staging_analysis', JSON.stringify({ leak: 'LEAK' }));
    const c = await loginAs(h, 'avery');

    const snap = await c.get('/api/snapshot');
    expect(snap.body.settings.first_review).toEqual(firstReview);
    expect(snap.body.settings.staging_analysis).toEqual(staging);
    expect(snap.raw).not.toContain('LEAK');
    const list = await c.get('/api/settings');
    expect(list.body.settings.first_review).toEqual(firstReview);
    expect(list.body.settings.staging_analysis).toEqual(staging);
    expect(list.raw).not.toContain('LEAK');
    expect(list.body.editable).toEqual(['display_timezone', 'scenarios']);

    // Read-only: not in the PUT allowlist.
    for (const key of ['first_review', 'staging_analysis']) {
      const res = await c.put(`/api/settings/${key}`, { value: { decision_keys: [] } });
      expect(res.status, key).toBe(422);
    }
    expect(JSON.parse((h.db.prepare("SELECT value FROM settings WHERE household_id = ? AND key = 'first_review'").get(DEMO_HOUSEHOLD_ID) as any).value)).toEqual(firstReview);

    // Another household sees neither.
    await givePassword(h.db, 'zed');
    const z = new Client(h.app);
    await z.passwordLogin('zed');
    const zs = (await z.get('/api/snapshot')).body.settings;
    expect(zs).not.toHaveProperty('first_review');
    expect(zs).not.toHaveProperty('staging_analysis');
    expect((await z.get('/api/settings')).body.settings).not.toHaveProperty('first_review');
  });

  it('are left out when absent or malformed (the optional fields are never null)', async () => {
    const h = await harness();
    const c = await loginAs(h, 'avery');
    expect(Object.keys((await c.get('/api/snapshot')).body.settings).sort()).toEqual(['jp_holidays', 'plan_baseline', 'task_adapter', 'traveler_gates']);
    const ins = h.db.prepare('INSERT OR REPLACE INTO settings (household_id, key, value) VALUES (?, ?, ?)');
    ins.run(DEMO_HOUSEHOLD_ID, 'first_review', '"not an object"');
    ins.run(DEMO_HOUSEHOLD_ID, 'staging_analysis', '[1,2]');
    const bad = (await c.get('/api/snapshot')).body.settings;
    expect(bad).not.toHaveProperty('first_review');
    expect(bad).not.toHaveProperty('staging_analysis');
    ins.run(DEMO_HOUSEHOLD_ID, 'first_review', JSON.stringify({ decision_keys: ['D02', 5, null] }));
    expect((await c.get('/api/snapshot')).body.settings.first_review).toEqual({ decision_keys: ['D02'] });
  });
});
