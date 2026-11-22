import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCorrections, BUILTIN_CORRECTIONS, loadCorrectionFiles, mergeCorrections, parseCorrectionFile, type Correction } from '../../src/import/corrections';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import { collectDeadlines } from '../../src/shared/deadlines';
import type { ImportBundle, MilestoneData, QuestionData } from '../../src/shared/types';
import { toBaseRecords, toPeople } from './helpers';

function get(bundle: ImportBundle, id: string) {
  const r = bundle.records.find((x) => x.id === id);
  if (!r) throw new Error(`missing ${id}`);
  return r;
}

function addMilestone(bundle: ImportBundle, key: string, title: string, data: Partial<MilestoneData>, status = 'planned'): void {
  const base = get(bundle, 'milestone:W01');
  bundle.records.push({
    ...structuredClone(base),
    id: `milestone:${key}`,
    key,
    title,
    status,
    data: { ...structuredClone(base.data), completion_evidence: [], traveler_scope: [], dependencies: [], dependency_scope: undefined, ...data } as Record<string, unknown>,
    source: null,
  });
}

describe('op interpreter', () => {
  const corrections: Correction[] = [
    {
      id: 'T-OPS',
      title: 'ops',
      rationale: 'testing',
      ops: [
        { op: 'set', record: 'milestone:W02', path: 'data.priority', value: 'later' },
        { op: 'set', record: 'milestone:W02', path: 'data.deadline.basis', value: 'nested path' },
        { op: 'add', record: 'milestone:W02', path: 'data.traveler_scope', value: 'jun' },
        { op: 'add', record: 'milestone:W02', path: 'data.traveler_scope', value: 'jun' }, // already present
        { op: 'remove', record: 'milestone:W03', path: 'data.dependencies', value: 'W06' },
        { op: 'remove', record: 'milestone:W03', path: 'data.dependencies', value: 'W99' }, // not present
        { op: 'replace_text', record: 'milestone:W02', path: 'data.next_action', find: 'Ask the adviser', replace: 'Ask the adviser (in writing)' },
        { op: 'replace_text', record: 'milestone:W02', path: 'data.next_action', find: 'not in the text', replace: 'x' },
        { op: 'set', record: 'milestone:W404', path: 'data.priority', value: 'now' }, // record missing
        { op: 'set', record: 'milestone:W02', path: 'data.__proto__.polluted', value: true },
        { op: 'create', record: { type: 'deadline_rule', key: 'RULE-NEW', title: 'New rule', status: 'active', data: { label: 'New rule' } } },
        { op: 'create', record: { type: 'deadline_rule', key: 'RULE-NEW', title: 'Duplicate', status: 'active', data: {} } },
        { op: 'setting', key: 'jp_holidays', value: ['2027-01-01'] },
      ],
    },
  ];

  it('applies each op, never fails on a missing target, and reports a receipt per op', () => {
    const bundle = buildDemoBundle();
    const { bundle: out, receipts } = applyCorrections(bundle, corrections);
    const w02 = get(out, 'milestone:W02').data as unknown as MilestoneData;
    expect(w02.priority).toBe('later');
    expect(w02.traveler_scope).toEqual(['avery', 'jun']);
    expect(w02.next_action).toContain('(in writing)');
    expect((get(out, 'milestone:W03').data as unknown as MilestoneData).dependencies).toEqual(['W01', 'W02']);
    expect(get(out, 'deadline_rule:RULE-NEW').created_by).toBe('import');
    expect(out.settings.jp_holidays).toEqual(['2027-01-01']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    expect(receipts).toHaveLength(corrections[0]!.ops!.length);
    const by = (i: number) => receipts[i]!;
    expect(by(0)).toMatchObject({ outcome: 'applied', field: 'data.priority', before: 'now', after: 'later', correction_id: 'T-OPS', record_id: 'milestone:W02' });
    expect(by(3)).toMatchObject({ outcome: 'not_applicable' });
    expect(by(4)).toMatchObject({ outcome: 'applied', before: ['W01', 'W02', 'W06'], after: ['W01', 'W02'] });
    expect(by(5)).toMatchObject({ outcome: 'not_applicable' });
    expect(by(7)).toMatchObject({ outcome: 'not_applicable' }); // replace_text with missing text is a receipt, not a failure
    expect(by(8)).toMatchObject({ outcome: 'not_applicable', record_id: 'milestone:W404' });
    expect(by(9)).toMatchObject({ outcome: 'not_applicable' });
    expect(by(10)).toMatchObject({ outcome: 'applied', record_id: 'deadline_rule:RULE-NEW' });
    expect(by(11)).toMatchObject({ outcome: 'not_applicable' });
    expect(by(12)).toMatchObject({ outcome: 'applied', record_id: 'setting:jp_holidays' });
  });

  it('does not mutate the input bundle', () => {
    const bundle = buildDemoBundle();
    const before = JSON.stringify(bundle);
    applyCorrections(bundle, corrections);
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it('strip_clause removes only the matching clause and keeps the rest', () => {
    const bundle = buildDemoBundle();
    get(bundle, 'milestone:W02').data.completion_criteria = 'Documents received and checked; interim conditions noted; final closure tracked in W65';
    get(bundle, 'milestone:W02').data.contingency = 'Use the approved route. Closure tracked in W65 only. Never overstay.';
    const { bundle: out } = applyCorrections(bundle, [
      { id: 'T-S', title: 's', rationale: 'r', ops: [
        { op: 'strip_clause', record: 'milestone:W02', path: 'data.completion_criteria', pattern: '\\bW65\\b' },
        { op: 'strip_clause', record: 'milestone:W02', path: 'data.contingency', pattern: '\\bW65\\b' },
      ] },
    ]);
    expect(get(out, 'milestone:W02').data.completion_criteria).toBe('Documents received and checked; interim conditions noted.');
    expect(get(out, 'milestone:W02').data.contingency).toBe('Use the approved route. Never overstay.');
  });
});

describe('correction files', () => {
  it('parses the reviewer file shape and rejects malformed ones', () => {
    const text = JSON.stringify({ corrections: [{ id: 'RV-1', title: 't', rationale: 'r', source: 'x#1', ops: [{ op: 'set', record: 'milestone:W01', path: 'data.priority', value: 'now' }, { op: 'setting', key: 'traveler_gates', value: [] }] }] });
    const parsed = parseCorrectionFile(text, 'a.json');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'RV-1', source: 'x#1' });
    expect(() => parseCorrectionFile(JSON.stringify({ corrections: [{ id: 'X', ops: [{ op: 'explode', record: 'a', path: 'b' }] }] }), 'bad.json')).toThrow(/unknown or missing "op"/);
    expect(() => parseCorrectionFile(JSON.stringify({ nope: 1 }), 'bad.json')).toThrow(/expected/);
    expect(() => parseCorrectionFile(JSON.stringify({ corrections: [{ id: 'X', ops: [{ op: 'set', record: 'a', path: 'b' }] }] }), 'bad.json')).toThrow(/needs "value"/);
  });

  it('loads *.json in file-name order; a loaded correction replaces a built-in with the same id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kadode-corr-'));
    try {
      const mk = (id: string) => JSON.stringify({ corrections: [{ id, title: id, rationale: 'r', ops: [] }] });
      writeFileSync(join(dir, '20-b.json'), mk('B-2'));
      writeFileSync(join(dir, '10-a.json'), mk('A-1'));
      writeFileSync(join(dir, 'C-003.json'), mk('C-003'));
      writeFileSync(join(dir, 'notes.txt'), 'ignored');
      const loaded = loadCorrectionFiles(dir);
      expect(loaded.corrections.map((c) => c.id)).toEqual(['A-1', 'B-2', 'C-003']);
      expect(loaded.files.map((f) => f.name)).toEqual(['10-a.json', '20-b.json', 'C-003.json']);
      const merged = mergeCorrections(BUILTIN_CORRECTIONS, loaded.corrections);
      expect(merged.map((c) => c.id)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'A-1', 'B-2']);
      expect(merged.find((c) => c.id === 'C-003')?.ops).toEqual([]); // replaced in place
      expect(loadCorrectionFiles(join(dir, 'missing')).corrections).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('built-in corrections are no-ops when their targets are absent', () => {
  it('produce no receipts for the demo household', () => {
    const { receipts } = applyCorrections(buildDemoBundle(), BUILTIN_CORRECTIONS);
    expect(receipts).toEqual([]);
  });
});

describe('C-001: residence completion does not depend on optional future work', () => {
  it('removes W65 from W45 dependencies and strips only the clause that ties closure to W65', () => {
    const bundle = buildDemoBundle();
    addMilestone(bundle, 'W45', 'Entry permissions', {
      dependencies: ['W02', 'W65'],
      completion_criteria: 'Documents received; interim conditions noted; final residence closure tracked in W65',
      contingency: 'Use the approved route or defer.',
    });
    addMilestone(bundle, 'W65', 'Later optional work', { optional_future_work: true });
    const { bundle: out, receipts } = applyCorrections(bundle, BUILTIN_CORRECTIONS.filter((c) => c.id === 'C-001'));
    const w45 = get(out, 'milestone:W45').data as unknown as MilestoneData;
    expect(w45.dependencies).toEqual(['W02']);
    expect(w45.completion_criteria).toBe('Documents received; interim conditions noted.');
    expect(w45.contingency).toBe('Use the approved route or defer.');
    expect(receipts.filter((r) => r.outcome === 'applied')).toHaveLength(2);
    const dep = receipts.find((r) => r.field === 'data.dependencies');
    expect(dep).toMatchObject({ before: ['W02', 'W65'], after: ['W02'], correction_id: 'C-001' });
  });
});

describe('C-002: traveler-specific readiness review and release', () => {
  it("creates W60.<person> and W64.<person> for each traveler, dated from each traveler's own departure", () => {
    const bundle = buildDemoBundle();
    for (const g of bundle.settings.traveler_gates!) g.release_key = null;
    addMilestone(bundle, 'W60', 'Readiness review', {
      traveler_scope: [],
      dependencies: ['W02', 'W13'],
      dependency_scope: { W13: ['mochi'] },
      deadline: { date: null, kind: 'internal_target', basis: 'Household helper', source_ids: [], jurisdiction: 'household', timezone: 'Asia/Tokyo', verified_on: null, traveler: 'household', anchor: 'T', offset: -14, unit: 'calendar_days' },
    });
    addMilestone(bundle, 'W64', 'Final release', { dependencies: ['W60'] });
    const { bundle: out, receipts } = applyCorrections(bundle, BUILTIN_CORRECTIONS.filter((c) => c.id === 'C-002'));

    for (const id of ['avery', 'jun', 'mochi']) {
      expect(out.records.some((r) => r.id === `milestone:W60.${id}`)).toBe(true);
      expect(out.records.some((r) => r.id === `milestone:W64.${id}`)).toBe(true);
      expect(out.records.some((r) => r.id === `deadline_rule:RULE-READINESS-REVIEW-${id.toUpperCase()}`)).toBe(true);
      expect(out.records.some((r) => r.id === `deadline_rule:RULE-FINAL-DEPARTURE-RELEASE-${id.toUpperCase()}`)).toBe(true);
    }
    const parent = get(out, 'milestone:W60').data as unknown as MilestoneData;
    expect(parent.traveler_scope).toEqual([]);
    const avery60 = get(out, 'milestone:W60.avery').data as unknown as MilestoneData;
    expect(avery60).toMatchObject({ parent_key: 'W60', traveler_scope: ['avery'], dependencies: ['W02'] });
    expect(avery60.deadline).toMatchObject({ anchor: 'DN', offset: -14, kind: 'internal_target', traveler: 'avery', rule_id: 'RULE-READINESS-REVIEW-AVERY' });
    const mochi60 = get(out, 'milestone:W60.mochi').data as unknown as MilestoneData;
    expect(mochi60.dependencies).toEqual(['W02', 'W13']); // the pet-scoped dependency stays with the pet
    expect(mochi60.deadline).toMatchObject({ anchor: 'DP', offset: -14 });
    const jun64 = get(out, 'milestone:W64.jun').data as unknown as MilestoneData;
    expect(jun64.dependencies).toEqual(['W60.jun']);
    expect(jun64.deadline).toMatchObject({ anchor: 'DR', offset: 0, kind: 'internal_target' });
    expect(receipts.filter((r) => r.outcome === 'applied').length).toBeGreaterThan(10);

    // The per-traveler dates come from each traveler's own anchors, never from household T/D.
    const records = toBaseRecords(out);
    const deadlines = collectDeadlines({ records, people: toPeople(out), today: '2026-10-29' });
    const find = (id: string) => deadlines.find((d) => d.id === id);
    expect(find('rule:RULE-READINESS-REVIEW-AVERY')?.deadline.date).toBe('2027-06-21'); // DN 2027-07-05 − 14
    expect(find('rule:RULE-FINAL-DEPARTURE-RELEASE-AVERY')?.deadline.date).toBe('2027-07-05');
    expect(find('rule:RULE-READINESS-REVIEW-JUN')?.state).toBe('awaiting_date'); // Jun's departure is not set
    expect(find('rule:RULE-READINESS-REVIEW-MOCHI')?.deadline.date).toBe('2027-08-30'); // DP 2027-09-13 − 14
    // gates point at the traveler's own review and release
    const gates = out.settings.traveler_gates!;
    expect(gates.find((g) => g.person_id === 'avery')?.required_before_departure).toContain('W60.avery');
    expect(gates.find((g) => g.person_id === 'jun')?.release_key).toBe('W64.jun');
  });

  it('supersedes the workbook per-person release rule that the new rule replaces', () => {
    const bundle = buildDemoBundle();
    addMilestone(bundle, 'W64', 'Final release', {});
    const { bundle: out } = applyCorrections(bundle, BUILTIN_CORRECTIONS.filter((c) => c.id === 'C-002'));
    const old = get(out, 'deadline_rule:RULE-AVERY-RELEASE');
    expect(old.status).toBe('superseded');
    expect((old.data as { superseded_by?: string }).superseded_by).toBe('RULE-FINAL-DEPARTURE-RELEASE-AVERY');
  });
});

describe('C-003 and C-004', () => {
  it('C-003 completes W67 with a caveat and moves Q077 to carry-forward, only where the superseded state exists', () => {
    const bundle = buildDemoBundle();
    addMilestone(bundle, 'W67', 'Review personal repo', { source_status: 'Waiting — repo unavailable here', status_reason: 'The local repository was unavailable.' }, 'blocked');
    const base = get(bundle, 'question:Q010');
    bundle.records.push({ ...structuredClone(base), id: 'question:Q077', key: 'Q077', title: 'Local repo', data: { ...structuredClone(base.data), known: 'The personal repo is not mounted here.', disposition: 'waiting_blocked', local_note: null } as Record<string, unknown> });
    const { bundle: out } = applyCorrections(bundle, BUILTIN_CORRECTIONS.filter((c) => c.id === 'C-003'));
    const w67 = get(out, 'milestone:W67');
    expect(w67.status).toBe('completed');
    const d = w67.data as unknown as MilestoneData;
    expect(d.status_reason).toBeNull();
    expect(d.completion_evidence[0]?.summary).toMatch(/remain unverified/);
    const q = get(out, 'question:Q077').data as unknown as QuestionData;
    expect(q.disposition).toBe('carry_forward');
    expect(q.local_note).toMatch(/remain unverified/);
  });

  it('C-004 flags optional future work, empties its traveler scope and removes it from every gate list', () => {
    const bundle = buildDemoBundle();
    addMilestone(bundle, 'W68', 'Validate options', { traveler_scope: ['jun'] });
    bundle.settings.traveler_gates!.find((g) => g.person_id === 'jun')!.required_before_departure.push('W68');
    const { bundle: out, receipts } = applyCorrections(bundle, BUILTIN_CORRECTIONS.filter((c) => c.id === 'C-004'));
    const d = get(out, 'milestone:W68').data as unknown as MilestoneData;
    expect(d.optional_future_work).toBe(true);
    expect(d.traveler_scope).toEqual([]);
    const jun = out.settings.traveler_gates!.find((g) => g.person_id === 'jun')!;
    expect(jun.required_before_departure).not.toContain('W68');
    expect(jun.explicitly_not_gates.some((g) => g.key === 'W68')).toBe(true);
    expect(receipts.some((r) => r.record_id === 'setting:traveler_gates' && r.outcome === 'applied')).toBe(true);
    // W05 in the demo is already optional, so it produces no operation
    expect(receipts.some((r) => r.record_id === 'milestone:W05')).toBe(false);
  });
});
