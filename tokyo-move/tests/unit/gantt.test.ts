import { describe, expect, it } from 'vitest';
import type { ComputedDeadline } from '../../src/shared/engine-contracts';
import { collectDeadlines } from '../../src/shared/deadlines';
import type { AnchorData, DeadlineKind, MilestoneData, PhaseKey, PlanningTarget } from '../../src/shared/types';
import {
  barLabel,
  buildAxis,
  chartRange,
  clipDate,
  clipSpan,
  compactAxisRows,
  compareSpan,
  dayX,
  departureAnchors,
  departureFor,
  departureMarkers,
  groupByTraveler,
  groupSpan,
  parseGroupPref,
  parseRangePref,
  phaseBands,
  phaseWindow,
  placeItem,
  PHASE_RULES,
  placeItems,
  referenceDeparture,
  sharedCheckIns,
  SHARED_CHECK_IN_MIN,
  timingText,
  toneOf,
  travelSummary,
  type DepartureAnchors,
  type PlaceInput,
} from '../../src/web/lib/gantt';
import { buildPlanItems, type PlanItemData } from '../../src/web/lib/plan';
import { buildIndexes } from '../../src/web/lib/records';
import { demo, toBaseRecords } from './helpers';

const TODAY = '2026-10-30';
const TARGET: PlanningTarget = { date: '2027-07-01', label: 'July 2027' };
const NO_ANCHORS: DepartureAnchors = { household: null, byTraveler: { avery: null, jun: null, mochi: null } };
const SET: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: '2027-07-05', jun: null, mochi: '2027-09-13' } };
const PEOPLE = [
  { id: 'avery', display_name: 'Avery' },
  { id: 'jun', display_name: 'Jun' },
  { id: 'mochi', display_name: 'Mochi' },
];

/** A plan item built by hand: only what the timeline reads. */
function item(over: {
  key?: string;
  status?: string;
  phase?: PhaseKey | null;
  scope?: string[];
  date?: string | null;
  kind?: DeadlineKind | null;
  owner?: string;
  title?: string;
}): PlanItemData {
  const key = over.key ?? 'W99';
  const m = {
    id: `milestone:${key}`,
    key,
    type: 'milestone',
    title: over.title ?? `Item ${key}`,
    status: over.status ?? 'planned',
    owner: over.owner ?? 'avery',
    owner_proposed: false,
    data: { phase: over.phase === undefined ? null : over.phase, traveler_scope: over.scope ?? [] } as Partial<MilestoneData>,
  } as unknown as PlanItemData['m'];
  return {
    m,
    date: over.date ?? null,
    dateKind: over.kind ?? null,
    dateState: null,
    when: {} as PlanItemData['when'],
    unmet: [],
  };
}

const input = (over: Partial<PlaceInput> = {}): Omit<PlaceInput, 'items'> => ({
  today: TODAY,
  baselineOn: '2026-10-01',
  target: TARGET,
  departures: SET,
  ...over,
});

describe('phase windows: calendar phases', () => {
  const ctx = { today: TODAY, baselineOn: '2026-10-01', departure: null };
  it('Now runs from the plan baseline to the end of November 2026', () => {
    expect(phaseWindow('p1_now_nov2026', ctx)).toEqual({ phase: 'p1_now_nov2026', start: '2026-10-01', end: '2026-11-30', source: 'calendar' });
  });
  it('Now starts today when there is no baseline, and never runs backwards when the baseline is stale', () => {
    expect(phaseWindow('p1_now_nov2026', { ...ctx, baselineOn: null })?.start).toBe(TODAY);
    expect(phaseWindow('p1_now_nov2026', { ...ctx, baselineOn: 'not a date' })?.start).toBe(TODAY);
    const late = phaseWindow('p1_now_nov2026', { ...ctx, baselineOn: '2027-02-01', today: '2027-02-01' });
    expect(late?.start).toBe('2026-11-30');
    expect(late?.end).toBe('2026-11-30');
  });
  it('November to December 2026 and January to March 2027 are fixed', () => {
    expect(phaseWindow('p2_nov_dec2026', ctx)).toMatchObject({ start: '2026-11-01', end: '2026-12-31' });
    expect(phaseWindow('p3_jan_mar2027', ctx)).toMatchObject({ start: '2027-01-01', end: '2027-03-31' });
  });
  it('does not need a departure date', () => {
    expect(phaseWindow('p3_jan_mar2027', { ...ctx, departure: null })).not.toBeNull();
  });
});

describe('phase windows: relative to a departure', () => {
  const at = (date: string, source: 'anchor' | 'target' = 'anchor') => ({ today: TODAY, baselineOn: null, departure: { date, source } });
  it('90 days out, the final weeks, the first 90 days and the three-year horizon', () => {
    const c = at('2027-07-05');
    expect(phaseWindow('p4_stage_minus_90', c)).toMatchObject({ start: '2027-04-06', end: '2027-05-05', source: 'anchor' });
    expect(phaseWindow('p5_final_60_30_14', c)).toMatchObject({ start: '2027-05-06', end: '2027-07-04' });
    expect(phaseWindow('p6_departure_to_day90', c)).toMatchObject({ start: '2027-07-05', end: '2027-10-03' });
    expect(phaseWindow('p7_three_year', c)).toMatchObject({ start: '2027-10-03', end: '2030-07-05' });
  });
  it('windows from the planning target say so', () => {
    expect(phaseWindow('p5_final_60_30_14', at('2027-07-01', 'target'))).toMatchObject({ start: '2027-05-02', end: '2027-06-30', source: 'target' });
  });
  it('has no window without a departure date', () => {
    for (const p of ['p4_stage_minus_90', 'p5_final_60_30_14', 'p6_departure_to_day90', 'p7_three_year'] as const) {
      expect(phaseWindow(p, { today: TODAY, baselineOn: null, departure: null }), p).toBeNull();
    }
  });
});

describe('which departure an item hangs on', () => {
  it('uses the one traveler\'s own anchor, and the household anchor for household-wide work', () => {
    expect(departureFor(['mochi'], SET, TARGET)).toEqual({ date: '2027-09-13', source: 'anchor' });
    expect(departureFor(['avery'], SET, TARGET)).toEqual({ date: '2027-07-05', source: 'anchor' });
    expect(departureFor([], SET, TARGET)).toEqual({ date: '2027-07-05', source: 'anchor' });
  });
  it('a shared item hangs on the EARLIEST departure set among the people in its scope', () => {
    // Avery leaves first, so the work they share has to be done before May 3, not before the household's July date.
    const earlier: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: '2027-05-03', jun: null, mochi: '2027-09-13' } };
    expect(departureFor(['avery', 'jun'], earlier, TARGET)).toEqual({ date: '2027-05-03', source: 'anchor' });
    // One person's date set: that one, whichever side of the household date it falls.
    const later: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: null, jun: '2027-09-01', mochi: null } };
    expect(departureFor(['avery', 'jun'], later, TARGET)).toEqual({ date: '2027-09-01', source: 'anchor' });
    // Both set: the earlier one, in either order.
    const both: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: '2027-08-01', jun: '2027-07-20', mochi: null } };
    expect(departureFor(['avery', 'jun'], both, TARGET)).toEqual({ date: '2027-07-20', source: 'anchor' });
    expect(departureFor(['jun', 'avery'], both, TARGET)).toEqual({ date: '2027-07-20', source: 'anchor' });
    // Only the people named in the scope count; the dog's date does not pull a two-adult item later or earlier.
    expect(departureFor(['avery', 'jun'], { household: null, byTraveler: { avery: '2027-08-01', jun: null, mochi: '2027-01-01' } }, TARGET)).toEqual({ date: '2027-08-01', source: 'anchor' });
    expect(departureFor(['avery', 'mochi'], { household: null, byTraveler: { avery: '2027-08-01', jun: null, mochi: '2027-01-01' } }, TARGET)).toEqual({ date: '2027-01-01', source: 'anchor' });
  });
  it('a shared item with no traveler date falls back to the household departure, then to the flagged target', () => {
    const householdOnly: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: null, jun: null, mochi: '2027-09-13' } };
    expect(departureFor(['avery', 'jun'], householdOnly, TARGET)).toEqual({ date: '2027-07-05', source: 'anchor' });
    expect(departureFor(['avery', 'jun'], NO_ANCHORS, TARGET)).toEqual({ date: '2027-07-01', source: 'target' });
    expect(departureFor(['avery', 'jun'], NO_ANCHORS, null)).toBeNull();
  });
  it('the same person named twice is still one person (no household fallback for their unset date)', () => {
    const onlyHousehold: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: null, jun: null } };
    expect(departureFor(['jun', 'jun'], onlyHousehold, null)).toBeNull();
  });
  it('falls back to the planning target, flagged, when that date is not set', () => {
    expect(departureFor(['jun'], SET, TARGET)).toEqual({ date: '2027-07-01', source: 'target' });
    expect(departureFor([], NO_ANCHORS, TARGET)).toEqual({ date: '2027-07-01', source: 'target' });
  });
  it('is null with neither a set date nor a target', () => {
    expect(departureFor(['jun'], SET, null)).toBeNull();
    expect(departureFor([], NO_ANCHORS, null)).toBeNull();
  });
  it('a traveler\'s unset date is never filled in from the household date', () => {
    const onlyHousehold: DepartureAnchors = { household: '2027-07-05', byTraveler: { jun: null } };
    expect(departureFor(['jun'], onlyHousehold, null)).toBeNull();
  });
  it('places a shared item\'s departure-relative bar on the earliest traveler\'s date', () => {
    const earlier: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: '2027-05-03', jun: null, mochi: '2027-09-13' } };
    const g = placeItem(item({ phase: 'p5_final_60_30_14', scope: ['avery', 'jun'] }), input({ departures: earlier }));
    // Final 60 days run from Mar 4 to May 2 (D-60 .. D-1 around May 3), not from early May to early July.
    expect(g).toMatchObject({ basis: 'phase', start: '2027-03-04', end: '2027-05-02' });
    expect(g.window?.source).toBe('anchor');
  });
});

describe('placing items', () => {
  it('an absolute phase with no date spans its window as "timing from its phase"', () => {
    const g = placeItem(item({ phase: 'p3_jan_mar2027' }), input());
    expect(g).toMatchObject({ placed: true, basis: 'phase', start: '2027-01-01', end: '2027-03-31', deadline: null, checkIn: null });
    expect(timingText(g, TARGET).text).toBe('timing from its phase (Jan–Mar 2027), no firm date');
  });

  it('a relative phase with a set anchor uses that traveler\'s departure', () => {
    const g = placeItem(item({ phase: 'p5_final_60_30_14', scope: ['mochi'] }), input());
    expect(g).toMatchObject({ basis: 'phase', start: '2027-07-15', end: '2027-09-12' });
    expect(g.window?.source).toBe('anchor');
  });

  it('a relative phase with a missing anchor is placed by the planning target and says so', () => {
    const g = placeItem(item({ phase: 'p5_final_60_30_14', scope: ['jun'] }), input());
    expect(g).toMatchObject({ placed: true, basis: 'target', start: '2027-05-02', end: '2027-06-30' });
    expect(g.window?.source).toBe('target');
    expect(timingText(g, TARGET).text).toBe('placed using the July 2027 target; set travel dates to make it exact');
  });

  it('a relative phase with neither an anchor nor a target is not placed, with the reason', () => {
    const g = placeItem(item({ phase: 'p5_final_60_30_14', scope: ['jun'] }), input({ target: null }));
    expect(g).toMatchObject({ placed: false, basis: null, start: null, end: null, unplacedReason: 'needs_departure' });
    expect(timingText(g, null).text).toMatch(/not placed yet/);
  });

  it('no phase and no date is not placed', () => {
    const g = placeItem(item({ phase: null }), input());
    expect(g).toMatchObject({ placed: false, unplacedReason: 'no_phase' });
  });

  it('a real date ends a firm bar at that date and starts it at the phase window start', () => {
    const g = placeItem(item({ phase: 'p3_jan_mar2027', date: '2027-02-12', kind: 'internal_target' }), input());
    expect(g).toMatchObject({ basis: 'firm', start: '2027-01-01', end: '2027-02-12', deadline: { date: '2027-02-12', kind: 'internal_target' } });
    expect(barLabel(g, 'Jun', TARGET)).toBe('Item W99, owner Jun, planned, ends Feb 12, 2027 (our target)');
  });

  it('starts 14 days before the date when the window starts on or after it, or when there is no window', () => {
    expect(placeItem(item({ phase: 'p3_jan_mar2027', date: '2027-01-01', kind: 'legal' }), input())).toMatchObject({ start: '2026-12-18', end: '2027-01-01' });
    expect(placeItem(item({ phase: 'p3_jan_mar2027', date: '2026-12-01', kind: 'legal' }), input())).toMatchObject({ start: '2026-11-17', end: '2026-12-01' });
    // A relative phase whose departure is unknown still has a firm date: the bar ends there, 14 days long.
    expect(placeItem(item({ phase: 'p5_final_60_30_14', scope: ['jun'], date: '2027-06-01', kind: 'legal' }), input({ target: null }))).toMatchObject({
      placed: true,
      basis: 'firm',
      start: '2027-05-18',
      end: '2027-06-01',
    });
    expect(placeItem(item({ phase: null, date: '2027-06-01', kind: 'contractual' }), input())).toMatchObject({ placed: true, basis: 'firm', start: '2027-05-18' });
  });

  it('every real kind of date makes a firm bar with a deadline marker', () => {
    for (const kind of ['legal', 'contractual', 'user_committed', 'internal_target', 'estimate'] as const) {
      const g = placeItem(item({ phase: 'p3_jan_mar2027', date: '2027-03-01', kind }), input());
      expect(g.basis, kind).toBe('firm');
      expect(g.deadline?.kind, kind).toBe(kind);
    }
  });

  it('a check-in is a hollow marker on the phase bar and never a deadline', () => {
    const g = placeItem(item({ phase: 'p3_jan_mar2027', date: '2026-11-11', kind: 'review_date' }), input());
    expect(g).toMatchObject({ placed: true, basis: 'phase', start: '2027-01-01', end: '2027-03-31', checkIn: '2026-11-11', deadline: null });
    expect(timingText(g, TARGET).text).toBe('timing from its phase (Jan–Mar 2027), no firm date; check-in on Nov 11, 2026, not a deadline');
  });

  it('a check-in with no phase window is only a marker, and a target-placed phase stays target', () => {
    const lone = placeItem(item({ phase: null, date: '2026-11-11', kind: 'review_date' }), input());
    expect(lone).toMatchObject({ placed: true, basis: null, start: null, end: null, checkIn: '2026-11-11' });
    const byTarget = placeItem(item({ phase: 'p5_final_60_30_14', scope: ['jun'], date: '2026-11-11', kind: 'review_date' }), input());
    expect(byTarget.basis).toBe('target');
    expect(byTarget.checkIn).toBe('2026-11-11');
  });

  it('flags completed and blocked work (and anything set aside) so they never rely on colour alone', () => {
    expect(toneOf('completed')).toBe('done');
    expect(toneOf('eliminated')).toBe('done');
    expect(toneOf('not_applicable')).toBe('done');
    expect(toneOf('blocked')).toBe('blocked');
    for (const s of ['planned', 'in_progress', 'waiting_external']) expect(toneOf(s), s).toBe('normal');
    const blocked = placeItem(item({ phase: 'p2_nov_dec2026', status: 'blocked' }), input());
    expect(blocked.tone).toBe('blocked');
    expect(barLabel(blocked, 'Jun', TARGET)).toContain(', blocked, ');
    const done = placeItem(item({ phase: 'p2_nov_dec2026', status: 'completed' }), input());
    expect(done.tone).toBe('done');
    expect(barLabel(done, 'Jun', TARGET)).toContain(', done, ');
  });
});

describe('sorting and grouping', () => {
  it('sorts by bar start, then end, then title; check-in-only rows sit by their date', () => {
    const a = placeItem(item({ key: 'W10', phase: 'p3_jan_mar2027' }), input());
    const b = placeItem(item({ key: 'W11', phase: 'p2_nov_dec2026' }), input());
    const c = placeItem(item({ key: 'W12', phase: 'p2_nov_dec2026', date: '2026-11-20', kind: 'legal' }), input());
    const d = placeItem(item({ key: 'W13', phase: null, date: '2026-12-15', kind: 'review_date' }), input());
    expect([a, b, c, d].sort(compareSpan).map((g) => g.key)).toEqual(['W12', 'W11', 'W13', 'W10']);
  });

  it('reads as a staircase: same start and end fall back to the title, not the key', () => {
    const mk = (key: string, title: string, phase: PhaseKey) => placeItem(item({ key, title, phase }), input());
    const rows = [mk('W01', 'Zebra', 'p3_jan_mar2027'), mk('W02', 'Apple', 'p3_jan_mar2027'), mk('W03', 'Mango', 'p2_nov_dec2026'), mk('W04', 'Banana', 'p3_jan_mar2027')];
    expect(rows.sort(compareSpan).map((g) => g.title)).toEqual(['Mango', 'Apple', 'Banana', 'Zebra']);
    // Same start, different end: the one that ends first comes first, whatever its title.
    const early = placeItem(item({ key: 'W05', title: 'Zed', phase: 'p3_jan_mar2027', date: '2027-02-01', kind: 'legal' }), input());
    const late = placeItem(item({ key: 'W06', title: 'Abe', phase: 'p3_jan_mar2027' }), input());
    expect([late, early].sort(compareSpan).map((g) => g.title)).toEqual(['Zed', 'Abe']);
  });

  it('groups by traveler: each person in the order given, then Shared for several people or the household', () => {
    const g = (key: string, scope: string[]) => placeItem(item({ key, scope, phase: 'p3_jan_mar2027' }), input());
    const groups = groupByTraveler([g('W1', ['jun']), g('W2', ['avery', 'jun']), g('W3', []), g('W4', ['avery']), g('W5', ['mochi'])], PEOPLE);
    expect(groups.map((x) => [x.title, x.items.map((i) => i.key)])).toEqual([
      ['Avery', ['W4']],
      ['Jun', ['W1']],
      ['Mochi', ['W5']],
      ['Shared', ['W2', 'W3']],
    ]);
    expect(groupByTraveler([g('W3', [])], PEOPLE).map((x) => x.title)).toEqual(['Shared']);
    // The person order is the directory's, not alphabetical.
    const reversed = [...PEOPLE].reverse();
    expect(groupByTraveler([g('W1', ['jun']), g('W4', ['avery']), g('W5', ['mochi'])], reversed).map((x) => x.title)).toEqual(['Mochi', 'Jun', 'Avery']);
  });

  it('summarises a group as one span: earliest start to latest end, check-ins included, nothing when nothing is placed', () => {
    const phase = placeItem(item({ key: 'W1', phase: 'p3_jan_mar2027' }), input()); // 2027-01-01 .. 2027-03-31
    const dated = placeItem(item({ key: 'W2', phase: 'p2_nov_dec2026', date: '2026-12-10', kind: 'legal' }), input()); // 2026-11-01 .. 2026-12-10
    const checkIn = placeItem(item({ key: 'W3', phase: null, date: '2027-06-15', kind: 'review_date' }), input());
    const unplaced = placeItem(item({ key: 'W4', phase: null }), input());
    expect(groupSpan([phase, dated])).toEqual({ start: '2026-11-01', end: '2027-03-31' });
    expect(groupSpan([phase, checkIn])).toEqual({ start: '2027-01-01', end: '2027-06-15' });
    expect(groupSpan([checkIn])).toEqual({ start: '2027-06-15', end: '2027-06-15' });
    expect(groupSpan([unplaced])).toBeNull();
    expect(groupSpan([])).toBeNull();
  });

  it('remembers the grouping and range, and falls back to By traveler and To day 90 for anything else', () => {
    expect(parseGroupPref(null)).toBe('traveler');
    expect(parseGroupPref('traveler')).toBe('traveler');
    expect(parseGroupPref('area')).toBe('area');
    expect(parseGroupPref('workstream')).toBe('traveler');
    expect(parseRangePref(null)).toBe('day90');
    expect(parseRangePref('three_years')).toBe('three_years');
    expect(parseRangePref('day90')).toBe('day90');
    expect(parseRangePref('<script>')).toBe('day90');
  });

  it('repeats the small axis at every group when asked to, or every few rows otherwise', () => {
    expect(compactAxisRows([5, 3, 6, 2], 0)).toEqual([true, true, true, true]);
    expect(compactAxisRows([2, 2, 2, 2, 2, 2], 8)).toEqual([true, false, false, false, true, false]);
    expect(compactAxisRows([5, 30, 8, 1], 8)).toEqual([true, false, true, true]);
    expect(compactAxisRows([0, 0, 3], 8)).toEqual([true, false, false]);
    expect(compactAxisRows([], 8)).toEqual([]);
  });
});

describe('shared check-ins', () => {
  const REVIEW = '2026-11-11';
  const place = (items: PlanItemData[], over: Partial<PlaceInput> = {}) => placeItems({ items, today: TODAY, baselineOn: '2026-10-01', target: TARGET, departures: SET, ...over });
  const withCheckIn = (key: string, over: Parameters<typeof item>[0] = {}, date: string = REVIEW) => item({ key, phase: 'p3_jan_mar2027', date, kind: 'review_date', ...over });

  it('a date shared by three or more items in the chart is one marker; fewer keep their own circle', () => {
    expect(SHARED_CHECK_IN_MIN).toBe(3);
    const two = place([withCheckIn('W1'), withCheckIn('W2'), withCheckIn('W3', {}, '2026-12-01')]);
    expect(two.every((g) => !g.sharedCheckIn)).toBe(true);
    expect(sharedCheckIns(two)).toEqual([]);
    const three = place([withCheckIn('W1'), withCheckIn('W2'), withCheckIn('W3'), withCheckIn('W4', {}, '2026-12-01')]);
    expect(three.map((g) => g.sharedCheckIn)).toEqual([true, true, true, false]);
    // The date is still on each item, so words never lose it.
    expect(three.map((g) => g.checkIn)).toEqual([REVIEW, REVIEW, REVIEW, '2026-12-01']);
  });

  it('is counted over the items in the chart, so a filter can turn a shared date back into one-off circles', () => {
    const all = [withCheckIn('W1', { scope: ['avery'] }), withCheckIn('W2', { scope: ['avery'] }), withCheckIn('W3', { scope: ['jun'] }), withCheckIn('W4', { scope: [] })];
    expect(place(all).every((g) => g.sharedCheckIn)).toBe(true);
    const averyOnly = place(all.filter((i) => i.m.data.traveler_scope?.[0] === 'avery'));
    expect(averyOnly.map((g) => g.sharedCheckIn)).toEqual([false, false]);
  });

  it('draws one marker per shared date, earliest first, with the items on it and a plain label', () => {
    const rows = place([withCheckIn('W1'), withCheckIn('W2'), withCheckIn('W3'), withCheckIn('W4', {}, '2026-10-31'), withCheckIn('W5', {}, '2026-10-31'), withCheckIn('W6', {}, '2026-10-31'), withCheckIn('W7', {}, '2026-10-31')]);
    const shared = sharedCheckIns(rows);
    expect(shared.map((c) => [c.date, c.items.map((g) => g.key), c.label])).toEqual([
      ['2026-10-31', ['W4', 'W5', 'W6', 'W7'], 'Check-in · Oct 31, 2026 · 4 items · not scheduled'],
      [REVIEW, ['W1', 'W2', 'W3'], 'Check-in · Nov 11, 2026 · 3 items · not scheduled'],
    ]);
  });

  it('keeps the phase bar, and the accessible name still says there is a check-in that is not a deadline', () => {
    const [g] = place([withCheckIn('W1', { title: 'Choose a home', owner: 'jun' }), withCheckIn('W2'), withCheckIn('W3')]);
    expect(g).toMatchObject({ placed: true, basis: 'phase', start: '2027-01-01', end: '2027-03-31', deadline: null, sharedCheckIn: true });
    expect(barLabel(g!, 'Jun', TARGET)).toBe('Choose a home, owner Jun, planned, timing from its phase (Jan–Mar 2027), no firm date; household check-in on Nov 11, 2026, not a deadline');
    // A one-off check-in keeps the plain wording.
    const [one] = place([withCheckIn('W1')]);
    expect(timingText(one!, TARGET).text).toContain('; check-in on Nov 11, 2026, not a deadline');
  });

  it('a row whose only date was the shared check-in and that has no bar is not placed, with the reason', () => {
    const rows = place([withCheckIn('W1', { phase: null }), withCheckIn('W2'), withCheckIn('W3')]);
    expect(rows[0]).toMatchObject({ placed: false, basis: null, start: null, unplacedReason: 'only_check_in', sharedCheckIn: true, checkIn: REVIEW });
    expect(timingText(rows[0]!, TARGET).text).toMatch(/not placed yet: only the household check-in/);
    expect(rows[1]!.placed).toBe(true);
    // The same item on its own (a one-off check-in) is still just a marker on its row.
    expect(place([withCheckIn('W1', { phase: null })])[0]).toMatchObject({ placed: true, basis: null, checkIn: REVIEW, sharedCheckIn: false });
    // With a phase it cannot place (no departure, no target) the reason is the one that can be acted on.
    const noWindow = place([withCheckIn('W1', { phase: 'p5_final_60_30_14', scope: ['jun'] }), withCheckIn('W2'), withCheckIn('W3')], { target: null });
    expect(noWindow[0]).toMatchObject({ placed: false, unplacedReason: 'needs_departure' });
  });

  it('group spans and the staircase ignore a shared check-in, but not a one-off one', () => {
    const rows = place([withCheckIn('W1'), withCheckIn('W2'), withCheckIn('W3')]);
    // Without the shared date this group would start on Nov 11, 2026; it starts with its bars.
    expect(groupSpan(rows)).toEqual({ start: '2027-01-01', end: '2027-03-31' });
    const [one] = place([withCheckIn('W1')]);
    expect(groupSpan([one!])).toEqual({ start: '2026-11-11', end: '2027-03-31' });
    // A row with no bar sorts by its own date only when that date is its own.
    const early = place([withCheckIn('W1', { phase: null }, '2026-10-05'), withCheckIn('W2', { phase: null }, '2026-12-05')]);
    expect([...early].reverse().sort(compareSpan).map((g) => g.key)).toEqual(['W1', 'W2']);
    const shared = place([withCheckIn('W1', { phase: null }), withCheckIn('W2', { phase: null }), withCheckIn('W3', { phase: null })]);
    expect(groupSpan(shared)).toBeNull();
  });
});

describe('range, axis and clipping', () => {
  const markers = ['2027-07-01', '2027-07-05', '2027-09-13'];
  it('"To day 90" runs from the start of the earlier of today and the baseline to the latest departure plus 90 days', () => {
    const r = chartRange('day90', { today: TODAY, baselineOn: '2026-10-01', markerDates: markers });
    expect(r).toEqual({ mode: 'day90', start: '2026-10-01', end: '2027-12-31' });
    // A baseline earlier than today pulls the start back; one after today does not push it forward.
    expect(chartRange('day90', { today: TODAY, baselineOn: '2026-08-20', markerDates: markers }).start).toBe('2026-08-01');
    expect(chartRange('day90', { today: TODAY, baselineOn: '2027-01-05', markerDates: markers }).start).toBe('2026-10-01');
    expect(chartRange('day90', { today: TODAY, baselineOn: null, markerDates: markers }).start).toBe('2026-10-01');
  });
  it('"Three years" runs to the latest departure plus three years, in whole quarters', () => {
    const r = chartRange('three_years', { today: TODAY, baselineOn: '2026-10-01', markerDates: markers });
    expect(r).toEqual({ mode: 'three_years', start: '2026-10-01', end: '2030-09-30' });
    expect(chartRange('three_years', { today: '2026-11-14', baselineOn: null, markerDates: markers }).start).toBe('2026-10-01');
  });
  it('still gives a sensible range with no departures at all', () => {
    const a = chartRange('day90', { today: TODAY, baselineOn: null, markerDates: [] });
    expect(a.start).toBe('2026-10-01');
    expect(a.end >= '2027-09-30').toBe(true);
    const b = chartRange('three_years', { today: TODAY, baselineOn: null, markerDates: [] });
    expect(b.end >= '2029-09-30').toBe(true);
  });

  it('months are never narrower than the unit width and tile the range exactly', () => {
    const range = chartRange('day90', { today: TODAY, baselineOn: '2026-10-01', markerDates: markers });
    const axis = buildAxis(range, 72);
    expect(axis.unit).toBe('month');
    expect(axis.columns).toHaveLength(15);
    expect(axis.columns[0]).toMatchObject({ label: 'Oct', start: '2026-10-01', end: '2026-10-31', x: 0 });
    expect(axis.columns.at(-1)).toMatchObject({ label: 'Dec', end: '2027-12-31' });
    for (const c of axis.columns) expect(c.w, c.start).toBeGreaterThanOrEqual(72 - 1e-9);
    const sum = axis.columns.reduce((n, c) => n + c.w, 0);
    expect(axis.width).toBeCloseTo(sum, 6);
    for (let i = 1; i < axis.columns.length; i++) expect(axis.columns[i]!.x).toBeCloseTo(axis.columns[i - 1]!.x + axis.columns[i - 1]!.w, 6);
    expect(axis.years.map((y) => y.label)).toEqual(['2026', '2027']);
    expect(axis.years[0]!.w).toBeCloseTo(axis.columns[0]!.w + axis.columns[1]!.w + axis.columns[2]!.w, 6);
    expect(dayX(axis, '2026-10-01')).toBe(0);
    expect(dayX(axis, '2026-11-01')).toBeCloseTo(axis.columns[1]!.x, 6);
  });

  it('the three-year range is drawn in quarters with Q labels', () => {
    const range = chartRange('three_years', { today: TODAY, baselineOn: '2026-10-01', markerDates: markers });
    const axis = buildAxis(range, 72);
    expect(axis.unit).toBe('quarter');
    expect(axis.columns).toHaveLength(16);
    expect(axis.columns.slice(0, 3).map((c) => c.label)).toEqual(['Q4', 'Q1', 'Q2']);
    expect(axis.years.map((y) => y.label)).toEqual(['2026', '2027', '2028', '2029', '2030']);
    for (const c of axis.columns) expect(c.w).toBeGreaterThanOrEqual(72 - 1e-9);
  });

  it('clips a span to the range and marks where it continues', () => {
    const range = { start: '2026-10-01', end: '2027-12-31' };
    expect(clipSpan('2026-11-01', '2026-12-31', range)).toEqual({ start: '2026-11-01', end: '2026-12-31', continuesBefore: false, continuesAfter: false, offRange: null });
    expect(clipSpan('2027-10-03', '2030-07-05', range)).toEqual({ start: '2027-10-03', end: '2027-12-31', continuesBefore: false, continuesAfter: true, offRange: null });
    expect(clipSpan('2026-08-01', '2026-11-30', range)).toMatchObject({ start: '2026-10-01', continuesBefore: true, continuesAfter: false, offRange: null });
    expect(clipSpan('2026-01-01', '2026-02-01', range)).toMatchObject({ start: '2026-10-01', end: '2026-10-01', offRange: 'before' });
    expect(clipSpan('2028-01-01', '2028-02-01', range)).toMatchObject({ start: '2027-12-31', end: '2027-12-31', offRange: 'after' });
    expect(clipDate('2026-05-05', range)).toEqual({ date: '2026-10-01', offRange: 'before' });
    expect(clipDate('2027-05-05', range)).toEqual({ date: '2027-05-05', offRange: null });
  });

  it('the three-year horizon is only fully visible in the three-year range', () => {
    const w = phaseWindow('p7_three_year', { today: TODAY, baselineOn: null, departure: { date: '2027-07-05', source: 'anchor' } })!;
    const day90 = chartRange('day90', { today: TODAY, baselineOn: null, markerDates: markers });
    const three = chartRange('three_years', { today: TODAY, baselineOn: null, markerDates: markers });
    expect(clipSpan(w.start, w.end, day90)).toMatchObject({ continuesAfter: true, offRange: null });
    expect(clipSpan(w.start, w.end, three)).toMatchObject({ continuesAfter: false, continuesBefore: false, end: '2030-07-05' });
    const g = placeItem(item({ phase: 'p7_three_year', scope: ['avery'] }), input());
    expect(timingText(g, TARGET, day90).text).toContain('continues beyond the end of the chart');
    expect(timingText(g, TARGET, three).text).not.toContain('continues');
  });
});

describe('departure anchors and markers', () => {
  const anchors = (over: Record<string, string | null>): Partial<AnchorData>[] => [
    { code: 'D', traveler: 'household', meaning: 'Household coordination departure', date: over.D ?? null },
    { code: 'DN', traveler: 'avery', meaning: 'Avery departure', date: over.DN ?? null },
    { code: 'DR', traveler: 'jun', meaning: 'Jun departure', date: over.DR ?? null },
    { code: 'DP', traveler: 'mochi', meaning: 'Mochi departure / boarding', date: over.DP ?? null },
    { code: 'TN', traveler: 'avery', meaning: 'Avery arrival', date: '2027-07-06' },
  ];
  const people = [
    { id: 'avery', anchors: { arrival: 'TN', departure: 'DN' } },
    { id: 'jun', anchors: { arrival: 'TR', departure: 'DR' } },
    { id: 'mochi', anchors: { arrival: 'TP', departure: 'DP' } },
  ];

  it('reads each person\'s departure from the code on the person, and the household one by its code', () => {
    expect(departureAnchors(anchors({ D: '2027-07-05', DN: '2027-07-05', DP: '2027-09-13' }), people)).toEqual({
      household: '2027-07-05',
      byTraveler: { avery: '2027-07-05', jun: null, mochi: '2027-09-13' },
    });
  });
  it('finds a departure by its meaning when the person does not name the code, and ignores arrival and bad dates', () => {
    const bare = [{ id: 'avery', anchors: { arrival: 'ZZ', departure: 'ZZ' } }];
    expect(departureAnchors(anchors({ DN: '2027-07-05' }), bare).byTraveler.avery).toBe('2027-07-05');
    expect(departureAnchors(anchors({ DN: 'July' }), people).byTraveler.avery).toBeNull();
  });

  it('one solid marker per distinct date, dashed for the target, household only when it differs', () => {
    const dep: DepartureAnchors = { household: '2027-07-05', byTraveler: { avery: '2027-07-05', jun: null, mochi: '2027-09-13' } };
    expect(departureMarkers(dep, PEOPLE, TARGET)).toEqual([
      { date: '2027-07-01', names: ['Jun'], basis: 'target', label: 'Jun: not set — July 2027 target' },
      { date: '2027-07-05', names: ['Avery'], basis: 'anchor', label: 'Avery departs' },
      { date: '2027-09-13', names: ['Mochi'], basis: 'anchor', label: 'Mochi departs' },
    ]);
    const apart = departureMarkers({ ...dep, household: '2027-07-10' }, PEOPLE, TARGET);
    expect(apart.map((m) => m.label)).toContain('Household departs');
  });
  it('merges travelers who leave on the same day or share the target, and drops markers it has no date for', () => {
    expect(departureMarkers(NO_ANCHORS, PEOPLE, TARGET)).toEqual([
      { date: '2027-07-01', names: ['Avery', 'Jun', 'Mochi', 'Household'], basis: 'target', label: 'Avery, Jun, Mochi, Household: not set — July 2027 target' },
    ]);
    expect(departureMarkers(NO_ANCHORS, PEOPLE, null)).toEqual([]);
    const together = departureMarkers({ household: null, byTraveler: { avery: '2027-07-05', jun: '2027-07-05', mochi: null } }, PEOPLE, null);
    expect(together).toEqual([{ date: '2027-07-05', names: ['Avery', 'Jun'], basis: 'anchor', label: 'Avery, Jun depart' }]);
  });

  it('the phase strip follows the shared-work rule: earliest traveler date, else the household date, else the target', () => {
    expect(referenceDeparture(SET, TARGET)).toEqual({ date: '2027-07-05', source: 'anchor' });
    expect(referenceDeparture({ household: '2027-07-05', byTraveler: { avery: '2027-05-03', jun: null } }, TARGET)).toEqual({ date: '2027-05-03', source: 'anchor' });
    expect(referenceDeparture({ household: '2027-07-05', byTraveler: { avery: null, jun: null } }, TARGET)).toEqual({ date: '2027-07-05', source: 'anchor' });
    expect(referenceDeparture({ household: null, byTraveler: { a: '2027-08-01', b: '2027-07-20' } }, TARGET)).toEqual({ date: '2027-07-20', source: 'anchor' });
    expect(referenceDeparture(NO_ANCHORS, TARGET)).toEqual({ date: '2027-07-01', source: 'target' });
    expect(referenceDeparture(NO_ANCHORS, null)).toBeNull();
  });

  it('summarises the travel dates in one line', () => {
    expect(travelSummary(NO_ANCHORS, PEOPLE, TARGET)).toBe('Not set yet — the chart uses the July 2027 target');
    expect(travelSummary(NO_ANCHORS, PEOPLE, null)).toBe('Not set yet — later phases cannot be placed on the chart');
    expect(travelSummary(SET, PEOPLE, TARGET)).toBe('Avery: Jul 5, 2027 · Jun: not set (uses the July 2027 target) · Mochi: Sep 13, 2027');
    expect(travelSummary(SET, PEOPLE, null)).toBe('Avery: Jul 5, 2027 · Jun: not set · Mochi: Sep 13, 2027');
  });
});

describe('phase strip', () => {
  const range = chartRange('day90', { today: TODAY, baselineOn: '2026-10-01', markerDates: ['2027-07-05', '2027-09-13'] });
  const ctx = { today: TODAY, baselineOn: '2026-10-01', departure: { date: '2027-07-05', source: 'anchor' as const } };
  it('shows each phase once, with its short label, and puts overlapping bands on different lanes', () => {
    const bands = phaseBands(ctx, range);
    expect(bands.map((b) => b.label)).toEqual(['Now', 'Nov–Dec 2026', 'Jan–Mar 2027', '90 days out', 'Final weeks', 'First 90 days', 'Three years']);
    const now = bands.find((b) => b.phase === 'p1_now_nov2026')!;
    const novDec = bands.find((b) => b.phase === 'p2_nov_dec2026')!;
    expect(now.lane).not.toBe(novDec.lane);
    for (const lane of [0, 1]) {
      const inLane = bands.filter((b) => b.lane === lane).sort((a, b) => (a.start < b.start ? -1 : 1));
      for (let i = 1; i < inLane.length; i++) expect(inLane[i - 1]!.end < inLane[i]!.start, `lane ${lane}`).toBe(true);
    }
  });
  it('clips the three-year band in the day-90 range and marks it as continuing', () => {
    const p7 = phaseBands(ctx, range).find((b) => b.phase === 'p7_three_year')!;
    expect(p7).toMatchObject({ start: '2027-10-03', end: '2027-12-31', continuesAfter: true });
    const three = chartRange('three_years', { today: TODAY, baselineOn: '2026-10-01', markerDates: ['2027-07-05', '2027-09-13'] });
    expect(phaseBands(ctx, three).find((b) => b.phase === 'p7_three_year')).toMatchObject({ end: '2030-07-05', continuesAfter: false });
  });
  it('leaves out the relative phases without a departure, and marks target-based bands', () => {
    expect(phaseBands({ ...ctx, departure: null }, range).map((b) => b.phase)).toEqual(['p1_now_nov2026', 'p2_nov_dec2026', 'p3_jan_mar2027']);
    expect(phaseBands({ ...ctx, departure: { date: '2027-07-01', source: 'target' } }, range).find((b) => b.phase === 'p5_final_60_30_14')?.source).toBe('target');
  });
});

describe('the fictional demo household', () => {
  const { bundle, records, people } = demo();
  const taskLinks = bundle.task_links.map((l) => ({ ...l, household_id: bundle.household.id, version: 1, created_at: '', updated_at: '' })) as never[];
  const idx = buildIndexes(records, taskLinks);
  const deadlines = collectDeadlines({ records, people, task_links: taskLinks, today: TODAY });
  const byRecord = new Map<string, ComputedDeadline[]>();
  for (const d of deadlines) if (d.record_id) byRecord.set(d.record_id, [...(byRecord.get(d.record_id) ?? []), d]);
  const items = buildPlanItems(idx, byRecord, TODAY);
  const dep = departureAnchors(idx.anchors.map((a) => a.data), people);
  const target = bundle.settings.planning_target ?? null;
  const placed = placeItems({ items, today: TODAY, baselineOn: bundle.settings.plan_baseline?.baseline_on ?? null, target, departures: dep });
  const get = (key: string) => placed.find((g) => g.key === key)!;

  it('has a planning target and set departure dates for Avery and Mochi but not Jun', () => {
    expect(target).toEqual(expect.objectContaining({ date: '2027-07-01', label: 'July 2027' }));
    expect(dep).toEqual({ household: '2027-07-05', byTraveler: { avery: '2027-07-05', jun: null, mochi: '2027-09-13' } });
  });

  it('places every milestone: the demo plan has a phase or a date for each', () => {
    expect(placed).toHaveLength(items.length);
    expect(placed.filter((g) => !g.placed)).toEqual([]);
  });

  it('draws Jun\'s final-weeks work from the target and Mochi\'s from her real departure', () => {
    expect(get('W24')).toMatchObject({ basis: 'phase', start: '2027-05-06', end: '2027-07-04' }); // Avery: anchor DN 2027-07-05
    expect(get('W25')).toMatchObject({ basis: 'target', start: '2027-05-02', end: '2027-06-30' }); // Jun: DR not set, July 2027 target
    expect(get('W25').window?.source).toBe('target');
    expect(get('W26')).toMatchObject({ basis: 'phase', start: '2027-07-15', end: '2027-09-12' }); // Mochi: anchor DP 2027-09-13
    expect(get('W27')).toMatchObject({ basis: 'phase', start: '2027-07-05', end: '2027-10-03' }); // shared: household D 2027-07-05
    // Nothing that hangs on Jun's unset date is drawn as if it were firm or anchored.
    for (const g of placed.filter((p) => p.item.m.data.traveler_scope?.join() === 'jun' && PHASE_RULES[p.item.m.data.phase!]?.kind === 'relative')) {
      expect(g.basis, g.key).toBe('target');
    }
  });

  it('the four items that share the proposed Nov 11 check-in get one marker, not four circles', () => {
    const shared = sharedCheckIns(placed);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.label).toBe('Check-in · Nov 11, 2026 · 4 items · not scheduled');
    expect(shared[0]!.items.map((g) => g.key).sort()).toEqual(['W01', 'W02', 'W04', 'W22']);
    for (const g of shared[0]!.items) expect(g.basis, g.key).toBe('phase'); // their phase bars stay
    expect(groupSpan(shared[0]!.items.filter((g) => g.key === 'W22'))).toEqual({ start: '2027-01-01', end: '2027-03-31' });
  });

  it('keeps check-ins off the deadline marker', () => {
    const w22 = get('W22');
    expect(w22.checkIn).toBe('2026-11-11');
    expect(w22.deadline).toBeNull();
    expect(w22.basis).toBe('phase');
    expect(timingText(w22, target).text).toContain('not a deadline');
  });

  it('draws completed and blocked demo items with their flags, and a firm bar for a dated one', () => {
    expect(get('W01').tone).toBe('done');
    expect(get('W03').tone).toBe('blocked');
    expect(get('W06')).toMatchObject({ basis: 'firm', deadline: { kind: 'user_committed', date: '2026-11-11' } });
    expect(get('W06').end).toBe('2026-11-11');
  });

  it('is built from the same fictional records the rest of the tests use', () => {
    expect(toBaseRecords(bundle)).toHaveLength(records.length);
  });
});
