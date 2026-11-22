/**
 * Real-data import tests. They read the private source package from TOKYO_SOURCE_DIR and are skipped when it is not set,
 * so the public repository never needs (or contains) any household data.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyBundle } from '../../src/import/apply';
import { applyCorrections, BUILTIN_CORRECTIONS, excludedIds, loadCorrectionFiles, mergeCorrections } from '../../src/import/corrections';
import { parseSourcePackage } from '../../src/import/normalize';
import { openDb, type Db } from '../../src/server/db/db';
import { anchorsFrom, collectDeadlines, previewAnchorChange } from '../../src/shared/deadlines';
import { travelerReadiness } from '../../src/shared/readiness';
import type { TravelerGateConfig } from '../../src/shared/engine-contracts';
import type { BaseRecord, FundingData, HouseholdSettings, ImportBundle, MilestoneData, Person } from '../../src/shared/types';

const dir = process.env.TOKYO_SOURCE_DIR;
const TODAY = '2026-10-29';

interface Loaded {
  records: BaseRecord[];
  people: Person[];
  settings: Partial<HouseholdSettings>;
}

function load(db: Db): Loaded {
  const rows = db.prepare('SELECT * FROM records').all() as Record<string, any>[];
  const records = rows.map((r) => ({
    id: r.id, household_id: r.household_id, type: r.type, key: r.key, title: r.title, status: r.status, owner: r.owner, owner_proposed: r.owner_proposed === 1,
    visibility: r.visibility, created_by: r.created_by, data: JSON.parse(r.data), source: r.source ? JSON.parse(r.source) : null, version: r.version,
    created_at: r.created_at, updated_at: r.updated_at, updated_by: r.updated_by,
  })) as BaseRecord[];
  const people = (db.prepare('SELECT * FROM people').all() as Record<string, any>[]).map((p) => ({
    id: p.id, household_id: p.household_id, display_name: p.display_name, kind: p.kind, aliases: JSON.parse(p.aliases), descriptor: p.descriptor, anchors: JSON.parse(p.anchors),
  })) as Person[];
  const settings: Record<string, unknown> = {};
  for (const s of db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE '\\_import.%' ESCAPE '\\'").all() as { key: string; value: string }[]) settings[s.key] = JSON.parse(s.value);
  return { records, people, settings: settings as Partial<HouseholdSettings> };
}

function walk(path: string, out: string[] = []): string[] {
  const st = statSync(path);
  if (st.isDirectory()) for (const f of readdirSync(path)) walk(join(path, f), out);
  else if (/\.(ts|tsx|json|md)$/.test(path)) out.push(path);
  return out;
}

describe.skipIf(!dir)('real source package', () => {
  const root = resolve(dir ?? '.');
  let bundle: ImportBundle;
  let db: Db;
  let first: ReturnType<typeof applyBundle>;
  let corrections: ReturnType<typeof mergeCorrections>;
  let state: Loaded;
  /** Items the household's scope corrections leave out of the import ("outside the move"); empty without them. */
  let leftOut: Set<string>;

  beforeAll(() => {
    bundle = parseSourcePackage(root);
    corrections = mergeCorrections(BUILTIN_CORRECTIONS, loadCorrectionFiles(join(root, '..', 'corrections')).corrections);
    db = openDb(':memory:');
    first = applyBundle(db, bundle, { now: new Date('2026-10-29T12:00:00Z'), corrections });
    state = load(db);
    leftOut = new Set(excludedIds(applyCorrections(bundle, corrections).receipts));
  });
  afterAll(() => db?.close());

  it('keeps every declared ID and count', () => {
    expect(first.status).toBe('completed');
    const c = bundle.validation.counts;
    for (const [type, expected] of Object.entries(bundle.validation.expected)) expect(c[type], type).toBe(expected);
    // Every declared item is either stored or left out as outside the move (with a receipt).
    const stored = (type: string) => state.records.filter((r) => r.type === type).length + [...leftOut].filter((id) => id.startsWith(`${type}:`)).length;
    for (const [type, expected] of Object.entries(bundle.validation.expected)) expect(stored(type), type).toBeGreaterThanOrEqual(expected);
    const keys = (type: string) => new Set(state.records.filter((r) => r.type === type).map((r) => r.key));
    const range = (prefix: string, n: number, digits: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(digits, '0')}`);
    for (const [type, ids] of [
      ['milestone', range('W', 71, 2)], ['workstream', range('S', 29, 2)], ['question', range('Q', 78, 3)], ['decision', range('D', 23, 2)],
      ['risk', range('R', 18, 2)], ['document', range('DOC', 37, 2)], ['cost', range('B', 49, 2)], ['arrival', range('A', 15, 2)],
    ] as [string, string[]][]) {
      const have = keys(type);
      expect(ids.filter((id) => !have.has(id) && !leftOut.has(`${type}:${id}`)), type).toEqual([]);
    }
    expect(keys('evidence').size).toBeGreaterThanOrEqual(57); // reviewers may add entries
    expect(bundle.validation.dangling_refs).toEqual([]);
  });

  it('derives people from the data, applies overrides, and keeps source text as written', () => {
    expect(state.people.map((p) => p.kind).sort()).toEqual(['adult', 'adult', 'pet']);
    const adults = state.people.filter((p) => p.kind === 'adult');
    expect(adults.every((p) => p.anchors.residence && p.anchors.health_eligibility && p.anchors.pension_eligibility)).toBe(true);
    const aliased = state.people.filter((p) => p.aliases.length > 0);
    expect(aliased.length).toBeGreaterThan(0);
    // an alias resolves owner text to the same person id, while source text stays verbatim in raw
    const alias = aliased[0]!.aliases[0]!;
    const withAlias = state.records.find((r) => r.source && Object.values(r.source.raw).some((v) => typeof v === 'string' && new RegExp(`\\b${alias}\\b`).test(v)));
    if (withAlias) expect(JSON.stringify(withAlias.source?.raw)).toContain(alias);
    expect(state.people.find((p) => p.kind === 'pet')?.anchors.residence ?? null).toBeNull();
  });

  it('imports anchors as awaiting (or as dates the household set), household T/D as coordination only, in the right zones', () => {
    const anchors = anchorsFrom(state.records);
    const byCode = new Map(anchors.map((a) => [a.code, a]));
    expect(byCode.get('T')?.coordination_only).toBe(true);
    expect(byCode.get('D')?.coordination_only).toBe(true);
    for (const a of anchors) {
      // The source sets no dates. A date only arrives through a reviewed household answer, which says where it came from.
      if (a.date === null) expect(a.confidence, a.code).toBe('awaiting');
      else {
        expect(['tentative', 'planned', 'booked', 'actual'], a.code).toContain(a.confidence);
        expect(a.evidence, a.code).toBeTruthy();
      }
      expect(a.timezone, a.code).toBe(/^(D|D[A-Z])$/.test(a.code) ? 'Pacific/Honolulu' : 'Asia/Tokyo');
    }
    for (const p of state.people) {
      expect(byCode.get(p.anchors.arrival)?.traveler).toBe(p.id);
      expect(byCode.get(p.anchors.departure)?.coordination_only).toBe(false);
    }
  });

  it('is idempotent: a repeat import changes nothing; a new fileset hash with identical content creates no duplicates', () => {
    const recordCount = state.records.length;
    const again = applyBundle(db, parseSourcePackage(root), { now: new Date('2026-10-30T12:00:00Z'), corrections });
    expect(again.status).toBe('no_changes');
    expect(db.prepare('SELECT COUNT(*) AS n FROM records').get()).toEqual({ n: recordCount });

    const bumped = parseSourcePackage(root);
    bumped.files = [...bumped.files, { name: 'extra.txt', sha256: 'f'.repeat(64), bytes: 1 }];
    const third = applyBundle(db, bumped, { now: new Date('2026-10-31T12:00:00Z'), corrections });
    expect(third.status).toBe('completed');
    expect(third.created).toBe(0);
    expect(third.updated).toBe(0);
    expect(third.corrections).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM records').get()).toEqual({ n: recordCount });
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_runs').get()).toEqual({ n: 3 });
  });

  it('preserves completed records and receipts, and keeps local edits across a new source version', () => {
    const w01 = state.records.find((r) => r.id === 'milestone:W01')!;
    expect(w01.status).toBe('completed');
    expect((w01.data as unknown as MilestoneData).completion_evidence.length).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM import_changes WHERE change = 'created' AND record_id NOT LIKE 'setting:%'").get()).toEqual({ n: state.records.length });
    expect((db.prepare("SELECT COUNT(*) AS n FROM import_changes WHERE change = 'correction_applied'").get() as { n: number }).n).toBeGreaterThan(0);

    // simulate an in-app status change, then a new source version
    db.prepare("UPDATE records SET status = 'in_progress', locally_edited = ? WHERE id = 'milestone:W01'").run(JSON.stringify(['status']));
    const v2 = parseSourcePackage(root);
    v2.files = [{ name: 'Tokyo_Relocation_Workbook.xlsx', sha256: 'e'.repeat(64), bytes: 1 }];
    const res = applyBundle(db, v2, { now: new Date('2026-11-01T12:00:00Z'), corrections });
    expect(res.kept_local).toBe(1);
    expect(db.prepare("SELECT status FROM records WHERE id = 'milestone:W01'").get()).toEqual({ status: 'in_progress' });
    db.prepare("UPDATE records SET status = 'completed', locally_edited = '[]' WHERE id = 'milestone:W01'").run();
  });

  it('C-001: residence completion no longer depends on optional future work, with a before/after receipt', () => {
    const w45 = state.records.find((r) => r.id === 'milestone:W45')!;
    const d = w45.data as unknown as MilestoneData;
    expect(d.dependencies).not.toContain('W65');
    // Later reviewed wording may mention W65 to say it is independent; it must never tie closure to it.
    expect(d.completion_criteria).not.toMatch(/closure[^.;]*\btracked in W65\b/);
    expect(d.completion_criteria.length).toBeGreaterThan(20);
    expect(d.contingency).not.toMatch(/\bW65\b/);
    // The generic correction on its own removes the reference entirely and keeps the rest of the text.
    const only = applyCorrections(bundle, BUILTIN_CORRECTIONS.filter((c) => c.id === 'C-001')).bundle.records.find((r) => r.id === 'milestone:W45')!;
    const od = only.data as unknown as MilestoneData;
    expect(od.dependencies).not.toContain('W65');
    expect(od.completion_criteria).not.toMatch(/\bW65\b/);
    expect(od.completion_criteria.length).toBeGreaterThan(20);
    // the preserved source row still shows what the workbook said
    expect(JSON.stringify(w45.source?.raw)).toMatch(/\bW65\b/);
    const receipts = db.prepare("SELECT field, before, after FROM import_changes WHERE correction_id = 'C-001' AND record_id = 'milestone:W45' AND change = 'correction_applied'").all() as { field: string; before: string; after: string }[];
    expect(receipts.length).toBeGreaterThan(0);
    const crit = receipts.find((r) => r.field === 'data.completion_criteria')!;
    expect(JSON.parse(crit.before)).toMatch(/\bW65\b/);
    expect(JSON.parse(crit.after)).not.toMatch(/\bW65\b/);
    expect(state.records.some((r) => r.type === 'milestone' && (r.data as unknown as MilestoneData).dependencies.includes('W65') && r.key === 'W45')).toBe(false);
  });

  it('C-002: W60 and W64 stay household rows and every traveler has an own review and release dated from their own departure', () => {
    const find = (key: string) => state.records.find((r) => r.id === `milestone:${key}`);
    for (const parent of ['W60', 'W64']) {
      expect((find(parent)!.data as unknown as MilestoneData).traveler_scope).toEqual([]);
      for (const p of state.people) {
        const child = find(`${parent}.${p.id}`);
        expect(child, `${parent}.${p.id}`).toBeDefined();
        const cd = child!.data as unknown as MilestoneData;
        expect(cd.parent_key).toBe(parent);
        expect(cd.traveler_scope).toEqual([p.id]);
        expect(cd.deadline?.anchor).toBe(p.anchors.departure);
        expect(cd.deadline?.kind).toBe('internal_target');
        expect(cd.deadline?.offset).toBe(parent === 'W60' ? -14 : 0);
        expect(['T', 'D']).not.toContain(cd.deadline?.anchor);
        const rule = state.records.find((r) => r.type === 'deadline_rule' && (r.data as { linked_records?: string[] }).linked_records?.includes(`${parent}.${p.id}`));
        expect(rule, `rule for ${parent}.${p.id}`).toBeDefined();
        expect((rule!.data as { traveler_scope: string }).traveler_scope).toBe(p.id);
      }
    }
    // dated from the traveler's own departure, not household D
    const adult = state.people.find((p) => p.kind === 'adult')!;
    const records = state.records.map((r) => (r.id === `anchor:${adult.anchors.departure}` ? ({ ...r, data: { ...r.data, date: '2027-07-20' } } as BaseRecord) : r));
    const ds = collectDeadlines({ records, people: state.people, today: TODAY });
    const own = ds.find((d) => d.rule_id && d.deadline.anchor === adult.anchors.departure && d.deadline.offset === -14);
    expect(own?.deadline.date).toBe('2027-07-06');
    expect(ds.filter((d) => d.traveler !== adult.id && d.deadline.date === '2027-07-06')).toEqual([]);
  });

  it("changing the pet's arrival leaves adult deadlines unchanged, even when the adults have dates", () => {
    const pet = state.people.find((p) => p.kind === 'pet')!;
    const adults = state.people.filter((p) => p.kind === 'adult');
    let records = state.records;
    const setDate = (code: string, date: string) => {
      records = records.map((r) => (r.id === `anchor:${code}` ? ({ ...r, data: { ...r.data, date, confidence: 'planned' } } as BaseRecord) : r));
    };
    adults.forEach((a, i) => {
      setDate(a.anchors.arrival, `2027-07-0${i + 1}`);
      setDate(a.anchors.departure, `2027-06-2${i}`);
      if (a.anchors.residence) setDate(a.anchors.residence, `2027-07-1${i}`);
    });
    setDate(pet.anchors.arrival, '2027-09-14');
    setDate(pet.anchors.departure, '2027-09-13');
    const ctx = { records, people: state.people, today: TODAY };
    for (const code of [pet.anchors.arrival, pet.anchors.departure]) {
      const preview = previewAnchorChange(ctx, code, '2027-10-20');
      expect(preview.traveler).toBe(pet.id);
      expect(preview.changes.length).toBeGreaterThan(0);
      // only the pet's own deadlines move; a household-level rule that is explicitly dated from the pet's anchor may also move
      expect(preview.changes.every((c) => c.traveler === pet.id || c.traveler === 'household')).toBe(true);
      expect(preview.changes.some((c) => c.traveler === pet.id)).toBe(true);
      for (const c of preview.changes.filter((x) => x.traveler === 'household')) {
        const rule = records.find((r) => r.type === 'deadline_rule' && `rule:${r.key}` === c.deadline_id);
        expect([pet.anchors.arrival, pet.anchors.departure]).toContain((rule?.data as { anchor?: string } | undefined)?.anchor);
      }
      expect(preview.changes.some((c) => adults.some((a) => a.id === c.traveler))).toBe(false);
      expect(preview.unaffected_travelers.sort()).toEqual(adults.map((a) => a.id).sort());
    }
    const before = collectDeadlines(ctx).filter((d) => adults.some((a) => a.id === d.traveler));
    const changed = records.map((r) => (r.id === `anchor:${pet.anchors.arrival}` ? ({ ...r, data: { ...r.data, date: '2027-12-01' } } as BaseRecord) : r));
    const after = collectDeadlines({ ...ctx, records: changed }).filter((d) => adults.some((a) => a.id === d.traveler));
    expect(after.map((d) => [d.id, d.deadline.date])).toEqual(before.map((d) => [d.id, d.deadline.date]));
  });

  it('a household T/D rule is coordination only and no legal rule uses a household date', () => {
    const rules = state.records.filter((r) => r.type === 'deadline_rule');
    for (const r of rules) {
      const d = r.data as { anchor: string; traveler_scope: string; kind: string };
      if (d.anchor === 'T' || d.anchor === 'D') {
        expect(d.traveler_scope, r.key).toBe('household');
        expect(d.kind, r.key).not.toBe('legal');
      }
    }
    // milestones dated from T/D are household internal targets, never legal and never tied to one traveler
    for (const m of state.records.filter((r) => r.type === 'milestone')) {
      const dl = (m.data as unknown as MilestoneData).deadline;
      if (dl && (dl.anchor === 'T' || dl.anchor === 'D')) {
        expect(dl.traveler, m.key).toBe('household');
        expect(dl.kind, m.key).toBe('internal_target');
        expect(dl.basis, m.key).toMatch(/^Household coordination helper/);
      }
    }
  });

  it('the nonworking adult reaches ready_to_release with no future-work item completed', () => {
    const funding = state.records.filter((r) => r.type === 'funding').map((r) => r.data as unknown as FundingData);
    const zero = funding.find((f) => f.kind === 'income' && f.income_status === 'planning_zero');
    expect(zero?.person_id).toBeTruthy();
    const person = state.people.find((p) => p.id === zero!.person_id)!;
    const gates = (state.settings.traveler_gates as TravelerGateConfig[]).find((g) => g.person_id === person.id)!;
    expect(gates).toBeDefined();
    // Later-work items are optional, or left out as outside the move; either way none of them is a gate.
    const FUTURE = ['W05', 'W58', 'W65', 'W67', 'W68', 'W69'];
    const optionalKeys = FUTURE.filter((k) => !leftOut.has(`milestone:${k}`));
    for (const k of optionalKeys) expect(state.records.some((r) => r.id === `milestone:${k}`), k).toBe(true);
    for (const k of FUTURE) {
      expect(gates.required_before_departure, k).not.toContain(k);
      expect(gates.required_at_or_after_arrival, k).not.toContain(k);
    }

    // A conditional step is "yes", "no" or still unknown: the record's own answer for this adult wins over the gate config.
    const answerOf = (c: TravelerGateConfig['conditional'][number]) => {
      const rec = state.records.find((r) => r.key === c.key && ['milestone', 'arrival', 'horizon'].includes(r.type));
      return ((rec?.data as { applies_to?: Record<string, string> } | undefined)?.applies_to?.[person.id] ?? c.applies) as 'yes' | 'no' | 'unknown';
    };
    const yesKeys = gates.conditional.filter((c) => answerOf(c) === 'yes').map((c) => c.key);
    const unknownKeys = gates.conditional.filter((c) => answerOf(c) === 'unknown').map((c) => c.key);

    // mark this adult's required gates (and "yes" conditionals) completed in memory; no optional item is touched
    const need = new Set([...gates.required_before_departure, ...yesKeys]);
    need.delete(gates.release_key ?? '');
    let done = state.records.map((r) => {
      if (!need.has(r.key) || !['milestone', 'arrival', 'horizon'].includes(r.type)) return r;
      const data = structuredClone(r.data) as Record<string, any>;
      if (data.traveler_progress) for (const p of Object.values<any>(data.traveler_progress)) p.status = 'completed';
      return { ...r, status: 'completed', data } as BaseRecord;
    });
    // Every required step done, but some conditional steps are still unanswered: not ready yet, and the headline says how many.
    if (unknownKeys.length > 0) {
      const pending = travelerReadiness(person, done, gates, TODAY);
      expect(pending.state).toBe('preparing');
      expect(pending.headline).toMatch(new RegExp(`${unknownKeys.length} steps? still needs? a yes or no`));
      expect(pending.conditional_unknown.map((g) => g.key).sort()).toEqual([...unknownKeys].sort());
    }
    // Answer them "no" for this adult (on the records, as the household would): now the adult is ready, with no future-work item done.
    done = done.map((r) => {
      if (!unknownKeys.includes(r.key) || !['milestone', 'arrival', 'horizon'].includes(r.type)) return r;
      return { ...r, data: { ...r.data, applies_to: { ...((r.data as { applies_to?: object }).applies_to ?? {}), [person.id]: 'no' } } } as BaseRecord;
    });
    const result = travelerReadiness(person, done, gates, TODAY);
    expect(result.blockers).toEqual([]);
    expect(result.open).toEqual([]);
    expect(result.state).toBe('ready_to_release');
    expect(result.headline).not.toMatch(/%/);
    expect((result.not_needed ?? []).map((n) => n.key).sort()).toEqual(expect.arrayContaining([...unknownKeys].sort()));
    // the simulation completes only gates; every optional item keeps exactly the status it was imported with
    for (const k of optionalKeys) expect(done.find((r) => r.id === `milestone:${k}`)?.status).toBe(state.records.find((r) => r.id === `milestone:${k}`)?.status);
    expect(need.size).toBeGreaterThan(0);
    for (const k of optionalKeys) expect(need.has(k)).toBe(false);
    // before any gate is completed the same traveler is not ready
    expect(travelerReadiness(person, state.records, gates, TODAY).state).not.toBe('ready_to_release');
  });

  it('W67 and Q077 reflect the bounded local evidence review without claiming rights or demand', () => {
    if (leftOut.has('milestone:W67')) {
      // The household left career exploration out of the move plan; both items go together.
      expect(leftOut.has('question:Q077')).toBe(true);
      return;
    }
    const w67 = state.records.find((r) => r.id === 'milestone:W67')!;
    expect(w67.status).toBe('completed');
    const text = (w67.data as unknown as MilestoneData).completion_evidence.map((e) => e.summary).join(' ');
    expect(text).toMatch(/unverified/);
    const q = state.records.find((r) => r.id === 'question:Q077')!;
    expect((q.data as { disposition: string }).disposition).toMatch(/^(carry_forward|already_answered)$/);
    expect(JSON.stringify(q.data)).toMatch(/unverified/);
  });

  it('keeps imported structure honest: statuses, owners, review dates, contacts, costs and task snapshot', () => {
    const ms = state.records.filter((r) => r.type === 'milestone' && !(r.data as unknown as MilestoneData).parent_key);
    for (const m of ms) {
      const d = m.data as unknown as MilestoneData;
      // The source only uses the first four; a reviewed household answer may also mark a step not applicable, or as
      // waiting on someone outside the household (for example an agency's confirmation).
      expect(['planned', 'in_progress', 'blocked', 'completed', 'not_applicable', 'waiting_external'], m.key).toContain(m.status);
      if (m.status === 'blocked' || m.status === 'not_applicable' || m.status === 'waiting_external') expect(d.status_reason, m.key).toBeTruthy();
      expect(d.source_status, m.key).toBeTruthy();
      expect(['together', 'unassigned', ...state.people.map((p) => p.id)], m.key).toContain(m.owner);
      expect(d.deadline?.kind === 'legal' && (d.deadline.anchor === 'T' || d.deadline.anchor === 'D'), m.key).toBeFalsy();
    }
    const deferred = ms.filter((m) => (m.data as unknown as MilestoneData).source_status === 'Deferred — conditional');
    expect(deferred.length).toBeGreaterThan(0);
    // Deferred, conditional work never gates a traveler.
    const gateKeys = new Set((state.settings.traveler_gates as TravelerGateConfig[]).flatMap((g) => [...g.required_before_departure, ...g.required_at_or_after_arrival]));
    for (const m of deferred) expect(gateKeys.has(m.key), m.key).toBe(false);
    // contacts: nobody is "engaged" or "contacted" without a recorded basis
    for (const c of state.records.filter((r) => r.type === 'contact')) {
      const d = c.data as { relationship: string; relationship_basis: string; status_boundary: string };
      expect(d.relationship_basis, c.key).toBeTruthy();
      if (d.relationship === 'potential') expect(d.relationship_basis).toMatch(/No interaction or booking/);
    }
    // costs: every amount is unknown (null), never 0
    for (const c of state.records.filter((r) => r.type === 'cost')) {
      const d = c.data as { estimate: unknown; quote: unknown; committed: unknown; unpaid_balance: unknown; applicability: string; exclusion_reason: string | null };
      // Source lines are all "review"; a reviewed household answer may exclude one, always with a reason.
      expect(['review', 'exclude']).toContain(d.applicability);
      if (d.applicability === 'exclude') expect(d.exclusion_reason).toBeTruthy();
      expect(d.estimate ?? d.quote ?? d.committed ?? d.unpaid_balance).toBeNull();
    }
    // task snapshot is read only
    expect(state.settings.task_adapter).toMatchObject({ name: 'snapshot', can_write: false });
    const links = db.prepare('SELECT adapter, sync_state, last_synced_at FROM task_links').all() as { adapter: string; sync_state: string; last_synced_at: string | null }[];
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.adapter === 'snapshot' && l.sync_state === 'snapshot' && l.last_synced_at === null)).toBe(true);
    // questions keep both the workbook status and the newer local review disposition
    const q = state.records.filter((r) => r.type === 'question');
    expect(q.every((r) => (r.data as { source_disposition: string }).source_disposition)).toBe(true);
    // Every one of the 78 plan questions is accounted for: in the app, or left out as outside the move (with a receipt).
    const leftOut = excludedIds(applyCorrections(bundle, corrections).receipts).filter((id) => id.startsWith('question:'));
    expect(q.filter((r) => (r.data as { local_disposition: string | null }).local_disposition !== null).length + leftOut.length).toBe(78);
  });

  it('no household name, contact or commitment label appears in committed code, fixtures or tests', () => {
    const sensitive = new Set<string>();
    for (const p of state.people) {
      sensitive.add(p.display_name);
      for (const a of p.aliases) sensitive.add(a);
    }
    for (const r of state.records.filter((x) => x.type === 'contact' || x.type === 'existing_commitment')) sensitive.add(r.title);
    const repo = process.cwd();
    const files = [
      ...walk(join(repo, 'src', 'import')), ...walk(join(repo, 'fixtures', 'demo')), ...walk(join(repo, 'tests', 'unit')), join(repo, 'scripts', 'import.ts'),
      ...['dates', 'deadlines', 'readiness', 'budget'].map((n) => join(repo, 'src', 'shared', `${n}.ts`)),
    ].filter((f) => existsSync(f) && !f.endsWith('real-import.test.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const s of sensitive) {
        if (s.length < 3) continue;
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
        if (re.test(text)) offenders.push(`${f.replace(repo, '')}: ${s.length} chars`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
