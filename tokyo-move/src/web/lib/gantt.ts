/**
 * Plan timeline (Gantt) model. Pure, so it can be unit-tested without React.
 *
 * Honesty rules this file enforces:
 *  - A bar that ends at a real computed date is "firm". A bar placed only by its phase window is "phase". A bar placed
 *    by the household's planning target (because a departure date is not set) is "target". The three never look alike.
 *  - A check-in (`review_date`) is a marker, never a deadline and never the end of a firm bar.
 *  - Nothing is placed by guesswork: with no phase and no date, or a departure-relative phase and neither a departure
 *    date nor a planning target, the item goes to "Not placed yet".
 *  - The planning target only decides where undated, departure-relative work is drawn. It is never shown as a deadline.
 */
import { addCalendarDays, addCalendarMonths, diffDays, isCivilDate } from '@shared/dates';
import { DEADLINE_KIND_LABEL, PHASE_LABEL, PHASE_ORDER, PHASE_SHORT_LABEL, WORK_STATUS_LABEL } from '@shared/labels';
import type { AnchorData, DeadlineKind, PhaseKey, Person, PlanningTarget, WorkStatus } from '@shared/types';
import { civil } from './format';
import type { PlanItemData } from './plan';

/* ------------------------------------------------------------------ phase windows */

type PhaseRule =
  /** A window fixed on the calendar. `from: 'baseline'` starts at the plan baseline (or today when there is none). */
  | { kind: 'calendar'; from: 'baseline' | string; to: string }
  /** A window measured in days from a departure date D. `to: 'three_years'` runs to D plus three years. */
  | { kind: 'relative'; from: number; to: number | 'three_years' };

/** The one table of phase windows. Keep it exhaustive: adding a phase key must fail to compile until it is placed here. */
export const PHASE_RULES: Record<PhaseKey, PhaseRule> = {
  p1_now_nov2026: { kind: 'calendar', from: 'baseline', to: '2026-11-30' },
  p2_nov_dec2026: { kind: 'calendar', from: '2026-11-01', to: '2026-12-31' },
  p3_jan_mar2027: { kind: 'calendar', from: '2027-01-01', to: '2027-03-31' },
  p4_stage_minus_90: { kind: 'relative', from: -90, to: -61 },
  p5_final_60_30_14: { kind: 'relative', from: -60, to: -1 },
  p6_departure_to_day90: { kind: 'relative', from: 0, to: 90 },
  p7_three_year: { kind: 'relative', from: 90, to: 'three_years' },
};

/** Where a departure date came from: a real travel date, or the household's planning target standing in for one. */
export interface DepartureRef {
  date: string;
  source: 'anchor' | 'target';
}

/** Departure dates the household has actually set (null = awaiting). */
export interface DepartureAnchors {
  household: string | null;
  byTraveler: Record<string, string | null>;
}

const validDate = (d: unknown): string | null => (typeof d === 'string' && isCivilDate(d) ? d : null);

/** Anchors are identified by their meaning ("… departure") or the household helper code `D`; see normalize.ts. */
function isDepartureAnchor(a: Partial<AnchorData>): boolean {
  return a.code === 'D' || /\bdeparture\b/i.test(a.meaning ?? '');
}

export function departureAnchors(anchors: Partial<AnchorData>[], people: Pick<Person, 'id' | 'anchors'>[]): DepartureAnchors {
  const byCode = new Map<string, Partial<AnchorData>>();
  for (const a of anchors) if (a.code) byCode.set(a.code, a);
  const byTraveler: Record<string, string | null> = {};
  for (const p of people) {
    const code = p.anchors?.departure;
    const own = code ? byCode.get(code) : undefined;
    const found = own ?? anchors.find((a) => a.traveler === p.id && isDepartureAnchor(a));
    byTraveler[p.id] = validDate(found?.date);
  }
  const household = anchors.find((a) => a.traveler === 'household' && isDepartureAnchor(a));
  return { household: validDate(household?.date), byTraveler };
}

/** The earliest of the dates that are set (civil dates sort as text), or null when none is. */
function earliestSet(dates: readonly (string | null | undefined)[]): string | null {
  const set = dates.filter((d): d is string => typeof d === 'string' && d !== '').sort();
  return set[0] ?? null;
}

/**
 * Which departure D an item's departure-relative phase hangs on:
 *  - scoped to exactly one known person: that person's own date (never filled in from anyone else's);
 *  - scoped to several people: the EARLIEST departure date set among the people in that scope, because shared work has to
 *    be done before the first of them leaves; when none of them has a date, the household departure;
 *  - scoped to nobody in particular (household-wide): the household departure.
 * When that date is not set, the planning target stands in (flagged as the target), and with no target there is no D.
 */
export function departureFor(scope: readonly string[], dep: DepartureAnchors, target: PlanningTarget | null): DepartureRef | null {
  const people = [...new Set(scope)];
  let date: string | null;
  if (people.length === 1) {
    const who = people[0]!;
    date = who in dep.byTraveler ? dep.byTraveler[who] ?? null : dep.household;
  } else if (people.length > 1) {
    date = earliestSet(people.map((p) => dep.byTraveler[p])) ?? dep.household;
  } else {
    date = dep.household;
  }
  if (date) return { date, source: 'anchor' };
  return target ? { date: target.date, source: 'target' } : null;
}

export interface PhaseWindow {
  phase: PhaseKey;
  start: string;
  end: string;
  /** calendar: fixed dates; anchor: from a set departure date; target: from the planning target. */
  source: 'calendar' | 'anchor' | 'target';
}

export interface PhaseContext {
  today: string;
  baselineOn: string | null;
  departure: DepartureRef | null;
}

export function phaseWindow(phase: PhaseKey, ctx: PhaseContext): PhaseWindow | null {
  const rule = PHASE_RULES[phase];
  if (!rule) return null;
  if (rule.kind === 'calendar') {
    const end = rule.to;
    let start = rule.from === 'baseline' ? (validDate(ctx.baselineOn) ?? ctx.today) : rule.from;
    if (start > end) start = end; // a stale baseline never makes the window run backwards
    return { phase, start, end, source: 'calendar' };
  }
  if (!ctx.departure) return null;
  const d = ctx.departure.date;
  return {
    phase,
    start: addCalendarDays(d, rule.from),
    end: rule.to === 'three_years' ? addCalendarMonths(d, 36) : addCalendarDays(d, rule.to),
    source: ctx.departure.source,
  };
}

/* ------------------------------------------------------------------ placing items */

export type GanttBasis = 'firm' | 'phase' | 'target';
export type GanttTone = 'normal' | 'blocked' | 'done';
export type UnplacedReason = 'no_phase' | 'needs_departure' | 'only_check_in';

export interface GanttItem {
  id: string;
  key: string;
  title: string;
  status: string;
  owner: string | null;
  ownerProposed: boolean;
  item: PlanItemData;
  tone: GanttTone;
  /** Unclipped extent of the bar, or null when the item is only a check-in marker (or not placed). */
  start: string | null;
  end: string | null;
  /** How the bar's extent is known; null when there is no bar. */
  basis: GanttBasis | null;
  /** Diamond at the end of a firm bar. */
  deadline: { date: string; kind: DeadlineKind } | null;
  /** Hollow-circle check-in marker. Never a deadline. */
  checkIn: string | null;
  /** The check-in date is shared by several items in the chart, so it is drawn once in Key dates and not on this row. */
  sharedCheckIn: boolean;
  window: PhaseWindow | null;
  placed: boolean;
  unplacedReason: UnplacedReason | null;
}

export function toneOf(status: string): GanttTone {
  if (status === 'blocked') return 'blocked';
  if (status === 'completed' || status === 'eliminated' || status === 'not_applicable') return 'done';
  return 'normal';
}

export interface PlaceInput {
  items: PlanItemData[];
  today: string;
  baselineOn: string | null;
  target: PlanningTarget | null;
  departures: DepartureAnchors;
}

/** Days before a date that a bar starts when its phase window starts on or after it (or when there is no window). */
export const FALLBACK_LEAD_DAYS = 14;

export function placeItem(it: PlanItemData, input: Omit<PlaceInput, 'items'>): GanttItem {
  const { m } = it;
  const phase = m.data?.phase ?? null;
  // A traveler the household marked "does not apply" for this item does not set its timing.
  const appliesTo = m.data?.applies_to ?? {};
  const scope = (m.data?.traveler_scope ?? []).filter((p) => appliesTo[p] !== 'no');
  const departure = phase && PHASE_RULES[phase]?.kind === 'relative' ? departureFor(scope, input.departures, input.target) : null;
  const window = phase ? phaseWindow(phase, { today: input.today, baselineOn: input.baselineOn, departure }) : null;

  const base: GanttItem = {
    id: m.id,
    key: m.key,
    title: m.title,
    status: m.status,
    owner: m.owner ?? null,
    ownerProposed: Boolean(m.owner_proposed),
    item: it,
    tone: toneOf(m.status),
    start: null,
    end: null,
    basis: null,
    deadline: null,
    checkIn: null,
    sharedCheckIn: false,
    window,
    placed: false,
    unplacedReason: null,
  };

  const date = validDate(it.date);
  const real = date && it.dateKind && it.dateKind !== 'review_date' ? { date, kind: it.dateKind } : null;
  const windowBasis: GanttBasis = window?.source === 'target' ? 'target' : 'phase';

  if (real) {
    const start = window && window.start < real.date ? window.start : addCalendarDays(real.date, -FALLBACK_LEAD_DAYS);
    return { ...base, start, end: real.date, basis: 'firm', deadline: real, placed: true };
  }
  if (date && it.dateKind === 'review_date') {
    return { ...base, start: window?.start ?? null, end: window?.end ?? null, basis: window ? windowBasis : null, checkIn: date, placed: true };
  }
  if (window) return { ...base, start: window.start, end: window.end, basis: windowBasis, placed: true };
  return { ...base, unplacedReason: phase ? 'needs_departure' : 'no_phase' };
}

/** A check-in date shared by at least this many items in the chart is one marker in Key dates, not a circle on every row. */
export const SHARED_CHECK_IN_MIN = 3;

export function placeItems(input: PlaceInput): GanttItem[] {
  const placed = input.items.map((it) => placeItem(it, input));
  const counts = new Map<string, number>();
  for (const g of placed) if (g.checkIn) counts.set(g.checkIn, (counts.get(g.checkIn) ?? 0) + 1);
  return placed.map((g) => {
    if (!g.checkIn || (counts.get(g.checkIn) ?? 0) < SHARED_CHECK_IN_MIN) return g;
    // The row keeps its phase bar. With no bar of its own, a shared check-in is not enough to place it anywhere.
    if (g.basis === null) return { ...g, sharedCheckIn: true, placed: false, unplacedReason: g.item.m.data?.phase ? 'needs_departure' : 'only_check_in' };
    return { ...g, sharedCheckIn: true };
  });
}

export interface SharedCheckIn {
  date: string;
  items: GanttItem[];
  /** "Check-in · Nov 11, 2026 · 60 items · not scheduled" */
  label: string;
}

/** The shared check-in dates, earliest first, with the items that sit on each. */
export function sharedCheckIns(placed: GanttItem[]): SharedCheckIn[] {
  const byDate = new Map<string, GanttItem[]>();
  for (const g of placed) if (g.sharedCheckIn && g.checkIn) byDate.set(g.checkIn, [...(byDate.get(g.checkIn) ?? []), g]);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, items]) => ({ date, items, label: `Check-in · ${civil(date, 'short')} · ${items.length} ${items.length === 1 ? 'item' : 'items'} · not scheduled` }));
}

/** Position used to order a row: where its bar starts (or its check-in sits), then where it ends. */
function spanKey(g: GanttItem): [string, string] {
  const own = g.sharedCheckIn ? null : g.checkIn;
  return [g.start ?? own ?? '9999-12-31', g.end ?? own ?? '9999-12-31'];
}

/** Staircase order: where the bar starts (or the check-in sits), then where it ends, then title, so a group reads as a cascade. */
export function compareSpan(a: GanttItem, b: GanttItem): number {
  const [as, ae] = spanKey(a);
  const [bs, be] = spanKey(b);
  if (as !== bs) return as < bs ? -1 : 1;
  if (ae !== be) return ae < be ? -1 : 1;
  return a.title.localeCompare(b.title) || a.key.localeCompare(b.key, undefined, { numeric: true });
}

/** The thin summary bar of a group header: from its earliest start to its latest end (check-ins count where they sit). */
export function groupSpan(items: GanttItem[]): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const g of items) {
    const own = g.sharedCheckIn ? null : g.checkIn; // a shared check-in is drawn once in Key dates and says nothing about this group
    for (const d of [g.start, own]) if (d && (start === null || d < start)) start = d;
    for (const d of [g.end, own]) if (d && (end === null || d > end)) end = d;
  }
  return start && end ? { start, end } : null;
}

export type GroupMode = 'traveler' | 'area';

/** Stored choices for the chart. Anything unknown (or blocked storage) falls back to the defaults: By traveler, To day 90. */
export const parseGroupPref = (v: string | null | undefined): GroupMode => (v === 'area' ? 'area' : 'traveler');
export const parseRangePref = (v: string | null | undefined): GanttRangeMode => (v === 'three_years' ? 'three_years' : 'day90');

/**
 * Where the small month axis is repeated inside the chart (when the main axis cannot stay in view): at the first group, and
 * again at any group that starts at least `every` visible rows after the last one. `rows` is the number of rows each group
 * shows (0 while it is folded).
 */
export function compactAxisRows(rows: number[], every = 8): boolean[] {
  let since = every;
  return rows.map((n) => {
    const show = since >= every;
    since = (show ? 0 : since) + n;
    return show;
  });
}

export interface ItemGroup<T> {
  key: string;
  title: string;
  items: T[];
}

/** One group per person (in the order given), then "Shared" for items scoped to several people or to the household. */
export function groupByTraveler(items: GanttItem[], people: Pick<Person, 'id' | 'display_name'>[]): ItemGroup<GanttItem>[] {
  const known = new Set(people.map((p) => p.id));
  const out: ItemGroup<GanttItem>[] = people.map((p) => ({ key: p.id, title: p.display_name, items: [] }));
  const shared: ItemGroup<GanttItem> = { key: 'shared', title: 'Shared', items: [] };
  for (const g of items) {
    const scope = g.item.m.data?.traveler_scope ?? [];
    const only = scope.length === 1 && known.has(scope[0]!) ? scope[0]! : null;
    (only ? out.find((o) => o.key === only)! : shared).items.push(g);
  }
  return [...out, shared].filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------ markers */

export interface DepartureMarker {
  date: string;
  names: string[];
  /** anchor: a set travel date (solid line). target: the planning target standing in for a date that is not set (dashed). */
  basis: 'anchor' | 'target';
  label: string;
}

/**
 * One vertical marker per distinct departure date. A person without a set date falls back to the planning target
 * (dashed). The household helper date only gets its own marker when it differs from every traveler's marker.
 */
export function departureMarkers(dep: DepartureAnchors, people: Pick<Person, 'id' | 'display_name'>[], target: PlanningTarget | null): DepartureMarker[] {
  const entries: { name: string; date: string | null; household: boolean }[] = [
    ...people.map((p) => ({ name: p.display_name, date: dep.byTraveler[p.id] ?? null, household: false })),
    { name: 'Household', date: dep.household, household: true },
  ];
  const resolved = entries
    .map((e) => (e.date ? { ...e, date: e.date, basis: 'anchor' as const } : target ? { ...e, date: target.date, basis: 'target' as const } : null))
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const personDates = new Set(resolved.filter((e) => !e.household && e.basis === 'anchor').map((e) => e.date));
  const groups = new Map<string, DepartureMarker>();
  for (const e of resolved) {
    if (e.household && e.basis === 'anchor' && personDates.has(e.date)) continue;
    const k = `${e.basis}|${e.date}`;
    const g = groups.get(k) ?? { date: e.date, names: [], basis: e.basis, label: '' };
    g.names.push(e.name);
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      label:
        g.basis === 'anchor'
          ? `${g.names.join(', ')} ${g.names.length > 1 ? 'depart' : 'departs'}`
          : `${g.names.join(', ')}: not set — ${target!.label} target`,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.basis === b.basis ? 0 : a.basis === 'anchor' ? -1 : 1));
}

/**
 * The departure the phase strip is drawn against. The strip describes shared work, so it follows the same rule as an item
 * scoped to everyone: the earliest traveler date that is set, else the household date, else the planning target.
 */
export function referenceDeparture(dep: DepartureAnchors, target: PlanningTarget | null): DepartureRef | null {
  const own = earliestSet(Object.values(dep.byTraveler)) ?? dep.household;
  if (own) return { date: own, source: 'anchor' };
  return target ? { date: target.date, source: 'target' } : null;
}

/** One line for the collapsed "Travel dates" summary. `fmt` writes a civil date. */
export function travelSummary(dep: DepartureAnchors, people: Pick<Person, 'id' | 'display_name'>[], target: PlanningTarget | null, fmt: (d: string) => string = (d) => civil(d, 'short')): string {
  const rows = people.map((p) => ({ name: p.display_name, date: dep.byTraveler[p.id] ?? null }));
  if (rows.every((r) => !r.date)) {
    return target ? `Not set yet — the chart uses the ${target.label} target` : 'Not set yet — later phases cannot be placed on the chart';
  }
  return rows.map((r) => (r.date ? `${r.name}: ${fmt(r.date)}` : `${r.name}: not set${target ? ` (uses the ${target.label} target)` : ''}`)).join(' · ');
}

/* ------------------------------------------------------------------ range and axis */

export type GanttRangeMode = 'day90' | 'three_years';

export interface GanttRange {
  mode: GanttRangeMode;
  /** First day shown (the first of a month, or of a quarter in the three-year range). */
  start: string;
  /** Last day shown (the last day of a month, or of a quarter). */
  end: string;
}

const first = (d: string) => `${d.slice(0, 7)}-01`;
export const monthStart = first;
export const monthEnd = (d: string) => addCalendarDays(addCalendarMonths(first(d), 1), -1);
export function quarterStart(d: string): string {
  const m = Number(d.slice(5, 7));
  return `${d.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
}
export const quarterEnd = (d: string) => addCalendarDays(addCalendarMonths(quarterStart(d), 3), -1);

/**
 * "To day 90": from the start of the month of the earlier of today and the plan baseline, to the latest departure
 * (or planning target) plus 90 days. "Three years": the same start (to a quarter), to the latest departure plus three years.
 */
export function chartRange(mode: GanttRangeMode, o: { today: string; baselineOn: string | null; markerDates: string[] }): GanttRange {
  const baseline = validDate(o.baselineOn);
  const earliest = baseline && baseline < o.today ? baseline : o.today;
  const latest = o.markerDates.length > 0 ? o.markerDates.reduce((a, b) => (a > b ? a : b)) : null;
  if (mode === 'day90') {
    const start = monthStart(earliest);
    const floor = addCalendarMonths(start, 6);
    const raw = latest ? addCalendarDays(latest, 90) : addCalendarMonths(start, 12);
    return { mode, start, end: monthEnd(raw > floor ? raw : floor) };
  }
  const start = quarterStart(earliest);
  const floor = addCalendarMonths(start, 12);
  const raw = latest ? addCalendarMonths(latest, 36) : addCalendarMonths(start, 36);
  return { mode, start, end: quarterEnd(raw > floor ? raw : floor) };
}

export interface AxisColumn {
  label: string;
  start: string;
  end: string;
  x: number;
  w: number;
}

export interface GanttAxis {
  range: GanttRange;
  unit: 'month' | 'quarter';
  columns: AxisColumn[];
  years: { label: string; x: number; w: number }[];
  pxPerDay: number;
  width: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Column geometry. The shortest month (or quarter) is `unitPx` wide, so no column is narrower than that. */
export function buildAxis(range: GanttRange, unitPx: number): GanttAxis {
  const unit = range.mode === 'day90' ? 'month' : 'quarter';
  const step = unit === 'month' ? 1 : 3;
  const pxPerDay = unitPx / (unit === 'month' ? 28 : 90);
  const columns: AxisColumn[] = [];
  for (let cursor = range.start; cursor <= range.end; ) {
    const next = addCalendarMonths(cursor, step);
    const m = Number(cursor.slice(5, 7));
    columns.push({
      label: unit === 'month' ? MONTHS[m - 1]! : `Q${Math.floor((m - 1) / 3) + 1}`,
      start: cursor,
      end: addCalendarDays(next, -1),
      x: diffDays(range.start, cursor) * pxPerDay,
      w: diffDays(cursor, next) * pxPerDay,
    });
    cursor = next;
  }
  const years: GanttAxis['years'] = [];
  for (const c of columns) {
    const label = c.start.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.label === label) last.w += c.w;
    else years.push({ label, x: c.x, w: c.w });
  }
  const last = columns[columns.length - 1];
  return { range, unit, columns, years, pxPerDay, width: last ? last.x + last.w : 0 };
}

/** Left edge of a day, in pixels from the start of the axis. */
export function dayX(axis: GanttAxis, date: string): number {
  return diffDays(axis.range.start, date) * axis.pxPerDay;
}

export interface Clipped {
  start: string;
  end: string;
  /** The span begins before the first day shown / ends after the last day shown. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** The whole span lies outside the range; start and end are then pinned to that edge. */
  offRange: 'before' | 'after' | null;
}

export function clipSpan(start: string, end: string, range: Pick<GanttRange, 'start' | 'end'>): Clipped {
  if (end < range.start) return { start: range.start, end: range.start, continuesBefore: true, continuesAfter: false, offRange: 'before' };
  if (start > range.end) return { start: range.end, end: range.end, continuesBefore: false, continuesAfter: true, offRange: 'after' };
  return {
    start: start < range.start ? range.start : start,
    end: end > range.end ? range.end : end,
    continuesBefore: start < range.start,
    continuesAfter: end > range.end,
    offRange: null,
  };
}

/** A single date (check-in, today) against the range: pinned to the edge when outside. */
export function clipDate(date: string, range: Pick<GanttRange, 'start' | 'end'>): { date: string; offRange: 'before' | 'after' | null } {
  if (date < range.start) return { date: range.start, offRange: 'before' };
  if (date > range.end) return { date: range.end, offRange: 'after' };
  return { date, offRange: null };
}

/* ------------------------------------------------------------------ phase strip */

export interface PhaseBand {
  phase: PhaseKey;
  label: string;
  title: string;
  start: string;
  end: string;
  source: PhaseWindow['source'];
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Overlapping bands (for example Now and November–December) sit on separate lanes. */
  lane: number;
}

export function phaseBands(ctx: PhaseContext, range: GanttRange): PhaseBand[] {
  const out: PhaseBand[] = [];
  const laneEnds: string[] = [];
  const windows = PHASE_ORDER.map((p) => phaseWindow(p, ctx)).filter((w): w is PhaseWindow => w !== null);
  windows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (const w of windows) {
    if (w.end < range.start || w.start > range.end) continue;
    const c = clipSpan(w.start, w.end, range);
    let lane = laneEnds.findIndex((e) => e < c.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = c.end;
    out.push({
      phase: w.phase,
      label: PHASE_SHORT_LABEL[w.phase],
      title: `${PHASE_LABEL[w.phase]} (${civil(w.start, 'short')} to ${civil(w.end, 'short')})`,
      start: c.start,
      end: c.end,
      source: w.source,
      continuesBefore: c.continuesBefore,
      continuesAfter: c.continuesAfter,
      lane,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ words */

export interface Timing {
  kind: 'firm' | 'phase' | 'target' | 'checkin' | 'none';
  /** Plain-language timing for the accessible name and the detail popover. */
  text: string;
}

/** How an item's timing is known, in words. The same sentence feeds the aria-label and the popover. */
export function timingText(g: GanttItem, target: PlanningTarget | null, range?: Pick<GanttRange, 'start' | 'end'>): Timing {
  const parts: string[] = [];
  let kind: Timing['kind'];
  if (!g.placed) {
    return {
      kind: 'none',
      text:
        g.unplacedReason === 'needs_departure'
          ? 'not placed yet: waiting for a departure date or planning target'
          : g.unplacedReason === 'only_check_in'
            ? 'not placed yet: only the household check-in so far, which is not a deadline'
            : 'not placed yet: no phase or date',
    };
  }
  if (g.basis === 'firm' && g.deadline) {
    kind = 'firm';
    parts.push(`ends ${civil(g.deadline.date, 'short')} (${DEADLINE_KIND_LABEL[g.deadline.kind].toLowerCase()})`);
  } else if (g.basis === 'target') {
    kind = 'target';
    parts.push(`placed using the ${target?.label ?? 'planning'} target; set travel dates to make it exact`);
  } else if (g.basis === 'phase') {
    kind = 'phase';
    const phase = g.item.m.data?.phase;
    parts.push(`timing from its phase (${phase ? PHASE_SHORT_LABEL[phase] : 'phase'}), no firm date`);
  } else {
    kind = 'checkin';
  }
  if (g.checkIn) parts.push(`${g.sharedCheckIn ? 'household check-in' : 'check-in'} on ${civil(g.checkIn, 'short')}, not a deadline`);
  if (range && g.start && g.end) {
    const c = clipSpan(g.start, g.end, range);
    if (c.offRange === 'before') parts.push('this falls before the chart starts');
    else if (c.offRange === 'after') parts.push('this falls after the chart ends');
    else if (c.continuesAfter) parts.push('continues beyond the end of the chart');
    else if (c.continuesBefore) parts.push('began before the chart starts');
  }
  return { kind, text: parts.join('; ') };
}

/** The accessible name of a bar, for example "Choose a home, owner Jun, planned, ends Feb 12, 2027 (our target)". */
export function barLabel(g: GanttItem, ownerLabel: string, target: PlanningTarget | null, range?: Pick<GanttRange, 'start' | 'end'>): string {
  const status = (WORK_STATUS_LABEL[g.status as WorkStatus] ?? g.status).toLowerCase();
  return `${g.title}, owner ${ownerLabel}, ${status}, ${timingText(g, target, range).text}`;
}
