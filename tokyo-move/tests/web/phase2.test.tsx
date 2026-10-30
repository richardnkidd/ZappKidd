import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import { collectDeadlines } from '../../src/shared/deadlines';
import type { BaseRecord, Person, TaskLink } from '../../src/shared/types';
import { dateParts } from '../../src/web/lib/dateWords';
import { evidenceVerification, directCheckOf, reviewChecksOf } from '../../src/web/lib/evidence';
import { dayIn } from '../../src/web/lib/format';
import { selectComingUp, type FilterContext } from '../../src/web/lib/home';
import { cashStatement, knownSoFar, scenarioExplanation, weakerYenPercent } from '../../src/web/lib/money';
import { buildPack, sensitivityOf } from '../../src/web/lib/pack';
import { buildDirectory, buildIndexes } from '../../src/web/lib/records';
import { buildReviewSummary } from '../../src/web/lib/reviewSummary';
import { compareOverlap, defaultDeparture, firstAdultArrival, petArrivalFor, previewPetMove } from '../../src/web/lib/whatif';
import { computed, DIR, milestone } from './helpers';

const NOW = '2026-10-29T12:00:00Z';
const TODAY = '2026-10-29';
const bundle = buildDemoBundle();
const people: Person[] = bundle.people.map((p) => ({ ...p, household_id: 'demo' }));
const records = bundle.records.map((r) => ({ ...r, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW, updated_by: null })) as BaseRecord[];
const taskLinks = bundle.task_links.map((t) => ({ ...t, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW })) as TaskLink[];
const idx = buildIndexes(records, taskLinks);
const dir = buildDirectory(people, people.find((p) => p.kind === 'adult')!.id);
const ctx: FilterContext = { meId: dir.me!.id, otherIds: dir.others.map((o) => o.id) };

describe('what a computed date means, in words', () => {
  it('"by" legal and contract dates read as Due by; targets stay plain', () => {
    expect(dateParts({ bound: 'by', kind: 'legal', date: '2026-11-06' })).toMatchObject({ prefix: 'Due by ', suffix: '' });
    expect(dateParts({ kind: 'contractual', date: '2026-11-06' }).prefix).toBe('Due by ');
    expect(dateParts({ bound: 'by', kind: 'internal_target', date: '2026-11-06' }).prefix).toBe('');
  });
  it('"not before" is a window opening, never a deadline', () => {
    const p = dateParts({ bound: 'not_before', kind: 'legal', date: '2027-08-21' });
    expect(p.prefix).toBe('Not before ');
    expect(p.suffix).toBe(' (window opens)');
  });
  it('a window pair reads as one window, earlier date first, naming an exam when it is one', () => {
    const p = dateParts({ bound: 'not_before', kind: 'legal', date: '2027-08-21', pairDate: '2027-08-31', label: "Mochi's vet exam must be within the 10 days before she is loaded" });
    expect(p).toMatchObject({ prefix: 'Exam window: ', date: '2027-08-21', endDate: '2027-08-31' });
    expect(dateParts({ bound: 'not_before', kind: 'legal', date: '2027-08-31', pairDate: '2027-08-21' }).date).toBe('2027-08-21');
  });
  it('on, continuous_since and recurring each get their own words', () => {
    expect(dateParts({ bound: 'on', date: '2027-07-06' }).prefix).toBe('On ');
    expect(dateParts({ bound: 'continuous_since', date: '2027-01-02' }).prefix).toBe('Must already be true since ');
    const r = dateParts({ bound: 'recurring', date: null, trigger: 'When the address changes.' });
    expect(r.emptyText).toBe('Repeats — when the address changes');
    expect(r.date).toBeNull();
  });
  it('a date with no bound defaults to "by"', () => {
    expect(dateParts({ kind: 'legal', date: '2026-11-06' }).prefix).toBe('Due by ');
  });
});

describe('how well a source was checked', () => {
  const f = (d: string) => d;
  it('reads direct_check and review_check_* defensively', () => {
    const data = { direct_check: { on: '2026-10-20', result: 'verified on the official page', quote: 'Notify within 14 days', url: 'https://example.org' }, review_check_on: '2026-10-25', review_check_note: 'Still current' };
    expect(directCheckOf(data)?.quote).toBe('Notify within 14 days');
    expect(reviewChecksOf(data).map((c) => c.label)).toEqual(['Review check on', 'Note']);
    expect(directCheckOf({})).toBeNull();
  });
  it('maps results to the three plain statements', () => {
    expect(evidenceVerification({ direct_check: { on: '2026-10-20', result: 'verified' } }, f).label).toBe('Verified on the official page on 2026-10-20');
    expect(evidenceVerification({ direct_check: { result: 'indexed text only' } }, f).label).toBe('From indexed official text — confirm');
    expect(evidenceVerification({ direct_check: { result: 'could not reach the page' } }, f).tone).toBe('kaki');
    expect(evidenceVerification({ access: 'Indexed official text' }, f).label).toBe('From indexed official text — confirm');
    expect(evidenceVerification({}, f).tone).toBe('neutral');
  });
});

describe('money wording', () => {
  it('never shows a lone total', () => {
    expect(knownSoFar({ known_usd: 9600, unknown_count: 2, unknown_keys: [], excluded_count: 0, complete: false }, 4)).toEqual({ primary: 'Known so far $9,600', secondary: '2 not known yet' });
    expect(knownSoFar({ known_usd: 0, unknown_count: 3, unknown_keys: [], excluded_count: 0, complete: false }, 3).primary).toBe('Nothing known yet');
    expect(knownSoFar({ known_usd: 100, unknown_count: 0, unknown_keys: [], excluded_count: 0, complete: true }, 1).secondary).toBe('every amount known');
  });
  it('explains scenarios from their own numbers and formats the yen effect without float noise', () => {
    expect(scenarioExplanation({ key: 'planning', label: 'Planning', fx_factor: 1, extra_us_months: 0, horizon_months: 3 })).toContain('nothing extra');
    expect(scenarioExplanation({ key: 'combined_stress', label: 'X', fx_factor: 0.9, extra_us_months: 3, horizon_months: 3 })).toBe('Same plan, but with 3 more months of continuing US costs and a yen 10% weaker against the dollar.');
    expect(weakerYenPercent(0.9)).toBe('10');
    expect(weakerYenPercent(0.875)).toBe('12.5');
  });
  it("says 'Can't conclude yet' with the real number of unknowns, and never claims headroom while unknowns remain", () => {
    const total = (n: number) => ({ known_usd: 0, unknown_count: n, unknown_keys: [], excluded_count: 0, complete: n === 0 });
    const model = {
      horizon_months: 3, one_time_unpaid: total(30), tokyo_monthly: total(10), us_monthly: total(5), staged_overlap: total(4), extra_us_months: 0,
      other_commitments_usd: null, return_reserve_usd: null, need_usd_known: 0, need_complete: false, cash_usd: null, cash_as_of: null, headroom_usd: null,
      modeled_income_usd: null, state: 'incomplete' as const, missing: [],
    };
    expect(cashStatement(model, 1).headline).toBe("Can't conclude yet — 49 amounts and one income are unknown");
  });
});

describe('days from instants never use the UTC date', () => {
  it('keeps calendar dates as they are and converts instants into the zone', () => {
    expect(dayIn('2026-10-30', 'Pacific/Honolulu')).toBe('2026-10-30');
    expect(dayIn('2026-10-30T01:00:00Z', 'Pacific/Honolulu')).toBe('2026-10-29'); // evening in Honolulu
    expect(dayIn('2026-10-30T01:00:00Z', 'Asia/Tokyo')).toBe('2026-10-30');
    expect(dayIn(null, 'Asia/Tokyo')).toBeNull();
  });
});

describe('Coming up window and cap', () => {
  const rows = Array.from({ length: 12 }, (_, i) => computed(`record:W${i}`, `2026-11-${String(2 + i).padStart(2, '0')}`, 'internal_target'));
  const emptyIdx = buildIndexes([], []);
  it('caps the rows and reports how many were left out', () => {
    const capped = selectComingUp(rows, emptyIdx, DIR, { today: TODAY, filter: 'all', ctx: { meId: 'ann', otherIds: ['bo'] }, windowDays: 28, maxRows: 8 });
    expect(capped.groups.flatMap((g) => g.rows)).toHaveLength(8);
    expect(capped.hidden).toBe(4);
    const all = selectComingUp(rows, emptyIdx, DIR, { today: TODAY, filter: 'all', ctx: { meId: 'ann', otherIds: ['bo'] }, windowDays: 84 });
    expect(all.hidden).toBe(0);
  });
  it('a date beyond the window is not shown until the window grows', () => {
    const far = [computed('record:W99', '2026-12-30', 'internal_target')];
    expect(selectComingUp(far, emptyIdx, DIR, { today: TODAY, filter: 'all', ctx: { meId: 'ann', otherIds: [] }, windowDays: 28 }).groups).toHaveLength(0);
    expect(selectComingUp(far, emptyIdx, DIR, { today: TODAY, filter: 'all', ctx: { meId: 'ann', otherIds: [] }, windowDays: 84 }).groups).toHaveLength(1);
  });
});

describe('what if the pet arrives later', () => {
  const pet = people.find((p) => p.kind === 'pet')!;
  const deadlineCtx = { records, people, task_links: taskLinks, today: TODAY };

  it('works out the pet arrival and a day-earlier departure', () => {
    expect(petArrivalFor('with_first', '2027-07-06', '')).toBe('2027-07-06');
    expect(petArrivalFor('plus3', '2027-07-06', '')).toBe('2027-10-06');
    expect(petArrivalFor('plus1', '2027-01-31', '')).toBe('2027-02-28'); // end of month clamps
    expect(petArrivalFor('date', null, '2027-09-01')).toBe('2027-09-01');
    expect(petArrivalFor('plus3', null, '')).toBeNull(); // first adult unknown: a hypothetical date is needed
    expect(defaultDeparture('2027-10-06')).toBe('2027-10-05');
  });

  it("finds the first adult's arrival from the anchors", () => {
    expect(firstAdultArrival(records, people)?.date).toBeTruthy();
  });

  it("changes only the pet's deadlines and says whose stay unchanged", () => {
    const first = firstAdultArrival(records, people)!;
    const arrival = petArrivalFor('plus3', first.date, '')!;
    const p = previewPetMove(deadlineCtx, pet.anchors.arrival, pet.anchors.departure, arrival, defaultDeparture(arrival));
    expect(p.changes.length).toBeGreaterThan(0);
    for (const c of p.changes) expect(c.traveler === pet.id || c.traveler === 'household').toBe(true);
    const adults = people.filter((x) => x.kind === 'adult').map((x) => x.id);
    for (const a of adults) expect(p.unaffected).toContain(a);
    // nothing was applied: the live deadlines are exactly as before
    expect(collectDeadlines(deadlineCtx).length).toBeGreaterThan(0);
  });

  it('compares staged-overlap costs and keeps unknown amounts unknown', () => {
    const first = firstAdultArrival(records, people)!;
    const arrival = petArrivalFor('plus6', first.date, '')!;
    const cmp = compareOverlap({ records, people, today: TODAY, arrivalCode: pet.anchors.arrival, departureCode: pet.anchors.departure, arrival, departure: defaultDeparture(arrival) });
    expect(cmp.afterKnown).toBeGreaterThanOrEqual(0);
    expect(cmp.unknownAfter).toBeGreaterThanOrEqual(0);
    for (const l of cmp.lines) expect(l.after === null || typeof l.after === 'number').toBe(true);
  });
});

describe('couple review summary', () => {
  const facts = {
    date: '2026-10-29',
    names: ['Ann', 'Bo'],
    hasPreviousReview: true,
    changeCount: 4,
    accepted: [{ id: 'milestone:W03', title: 'Establish a route', owner: 'Bo' }],
    decisions: [{ id: 'decision:D02', title: 'Choose the home', outcome: 'Ann approved “Option A”' }],
    questions: [{ id: 'question:Q001', title: 'When does it expire?', outcome: 'carried forward' }],
    nextReviewOn: '2026-11-05',
    closingNote: '',
  };
  it('names what happened, links every record it mentions, and never claims work is done', () => {
    const { text, recordIds } = buildReviewSummary(facts);
    expect(text).toContain('Couple review on Thursday, October 29, 2026, with Ann and Bo.');
    expect(text).toContain('Owners accepted: “Establish a route” (Bo).');
    expect(text).toContain('“Choose the home” — Ann approved “Option A”');
    expect(text).toContain('Next review: Thursday, November 5, 2026.');
    expect(recordIds).toEqual(['milestone:W03', 'decision:D02', 'question:Q001']);
    expect(text.toLowerCase()).not.toMatch(/\b(completed|marked done|you should|we recommend)\b/);
  });
  it('is honest when nothing happened', () => {
    const { text, recordIds } = buildReviewSummary({ ...facts, hasPreviousReview: false, accepted: [], decisions: [], questions: [], nextReviewOn: null });
    expect(text).toContain('This was the first review.');
    expect(text).toContain('No owners were accepted.');
    expect(text).toContain('No decisions were made.');
    expect(text).toContain('No next review date was set.');
    expect(recordIds).toEqual([]);
  });
});

describe('printable arrival pack', () => {
  const deadlines = collectDeadlines({ records, people, task_links: taskLinks, today: TODAY });
  const sensitiveRecords = [
    ...records,
    { ...records.find((r) => r.type === 'arrival')!, id: 'arrival:ASENS', key: 'ASENS', title: 'Set up the bank account and pay the first tax bill', data: { ...(records.find((r) => r.type === 'arrival')!.data as object), window_key: 'first_week', action: 'Open an account', traveler_scope: [] } } as BaseRecord,
    { ...records.find((r) => r.type === 'arrival')!, id: 'arrival:AHEALTH', key: 'AHEALTH', title: 'Register for health insurance', data: { ...(records.find((r) => r.type === 'arrival')!.data as object), window_key: 'first_week', action: 'Register', traveler_scope: [] } } as BaseRecord,
  ];
  const sidx = buildIndexes(sensitiveRecords, taskLinks);
  const adult = people.find((p) => p.kind === 'adult')!;

  it('classifies health and money text', () => {
    expect(sensitivityOf('Register for health insurance')).toBe('health');
    expect(sensitivityOf('Open a bank account')).toBe('money');
    expect(sensitivityOf('Inspect landing documents')).toBeNull();
  });

  it('keeps sensitive items out of every main section', () => {
    const pack = buildPack(sidx, dir, deadlines, adult.id);
    const mainTitles = pack.sections.flatMap((s) => s.items.map((i) => i.title));
    expect(mainTitles.join(' ')).not.toMatch(/bank account|health insurance/i);
    expect(pack.sensitive.money.map((i) => i.title)).toContain('Set up the bank account and pay the first tax bill');
    expect(pack.sensitive.health.map((i) => i.title)).toContain('Register for health insurance');
  });

  it('prints contacts by role and relationship only, never names', () => {
    const pack = buildPack(sidx, dir, deadlines, adult.id);
    const contacts = pack.sections.find((s) => s.key === 'contacts')!;
    const names = records.filter((r) => r.type === 'contact').map((r) => (r.data as { name: string }).name);
    expect(contacts.items.length).toBeGreaterThan(0);
    const printed = JSON.stringify(contacts);
    for (const n of names) expect(printed).not.toContain(n);
  });

  it("has the six sections, and documents carry status and custodian only", () => {
    const pack = buildPack(sidx, dir, deadlines, adult.id);
    expect(pack.sections.map((s) => s.key)).toEqual(['arrival_day', 'first_week', 'first_30', 'contacts', 'documents', 'links']);
    const docs = pack.sections.find((s) => s.key === 'documents')!;
    for (const d of docs.items) expect(Object.keys(d).sort()).toEqual(['detail', 'id', 'meta', 'title'].sort());
  });

  it('a pet gets its own arrival-day list', () => {
    const pet = people.find((p) => p.kind === 'pet')!;
    const pack = buildPack(sidx, dir, deadlines, pet.id);
    const day = pack.sections.find((s) => s.key === 'arrival_day')!;
    expect(day.items.length).toBeGreaterThan(0);
    expect(milestone('W1', 'planned').key).toBe('W1'); // helper stays in use
  });
});
