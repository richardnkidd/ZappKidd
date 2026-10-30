/**
 * Deadline engine: rule → deadline, explicit deadlines, commitments, anchor-change preview.
 * OWNER: import/engines agent (signatures fixed by lead).
 * Invariants: a missing anchor yields 'awaiting_date' (never a guessed date); household T/D never drive a
 * traveler's legal deadline (nor any traveler-specific action); changing one traveler's anchor never changes another
 * traveler's deadlines.
 */
import { addBusinessDays, addCalendarDays, addCalendarMonths, compareCivil, diffDays, formatCivil, isCivilDate, weekday } from './dates';
import type { AnchorChangeEffect, AnchorChangePreview, ComputedDeadline, DeadlineState, TravelerDeadlines } from './engine-contracts';
import { calendarForRule, holidayName, holidaysAround, type HolidayCalendar } from './holidays';
import type {
  AnchorCode,
  AnchorData,
  BaseRecord,
  Deadline,
  DeadlineKind,
  Jurisdiction,
  DeadlineRuleData,
  DecisionData,
  DayUnit,
  ExistingCommitmentData,
  IanaZone,
  MilestoneData,
  Person,
  RecordType,
  RuleBound,
  TaskLink,
  TravelerAnchorCodes,
} from './types';

export interface DeadlineContext {
  records: BaseRecord[];
  people: Person[];
  task_links?: TaskLink[];
  today: string; // civil date in the household display zone
  /** due_soon threshold in days (default 14) */
  soon_days?: number;
  /** Optional Japanese public-holiday calendar (civil dates) for business-day math. Empty/absent = approximate. */
  jp_holidays?: string[];
}

export interface RuleComputeOptions {
  soonDays?: number;
  holidays?: ReadonlySet<string>;
}

const DEFAULT_SOON_DAYS = 14;
const COORDINATION_CODES: ReadonlySet<string> = new Set(['T', 'D']);
const DEFAULT_ZONE: IanaZone = 'Pacific/Honolulu';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function ofType<T extends RecordType, D>(records: BaseRecord[], type: T): BaseRecord<T, D>[] {
  return records.filter((r) => r.type === type) as unknown as BaseRecord<T, D>[];
}

function stateFor(date: string | null, today: string, soonDays: number): { state: DeadlineState; days_until: number | null } {
  if (date === null) return { state: 'awaiting_date', days_until: null };
  const n = diffDays(today, date);
  if (n < 0) return { state: 'overdue', days_until: n };
  if (n === 0) return { state: 'due_today', days_until: 0 };
  if (n <= soonDays) return { state: 'due_soon', days_until: n };
  return { state: 'upcoming', days_until: n };
}

/** Which holiday calendar applies to a date, and whether it is the household's own list or the computed one. */
interface CalendarChoice {
  calendar: HolidayCalendar | null;
  set: ReadonlySet<string>;
  /** True when the household supplied its own (Japanese) holiday list; false for the computed calendar. */
  explicit: boolean;
}

function chooseCalendar(
  jurisdiction: Jurisdiction | null | undefined,
  timezone: IanaZone | null | undefined,
  aroundDate: string,
  explicitJp?: ReadonlySet<string>,
): CalendarChoice {
  const calendar = calendarForRule(jurisdiction, timezone);
  if (calendar === 'JP' && explicitJp && explicitJp.size > 0) return { calendar, set: explicitJp, explicit: true };
  return { calendar, set: holidaysAround(calendar, aroundDate), explicit: false };
}

function shift(date: string, signedOffset: number, unit: DayUnit, choice: CalendarChoice): { date: string; approximate: boolean } {
  switch (unit) {
    case 'calendar_days':
      return { date: addCalendarDays(date, signedOffset), approximate: false };
    case 'calendar_months':
      return { date: addCalendarMonths(date, signedOffset), approximate: false };
    case 'business_days': {
      const r = addBusinessDays(date, signedOffset, choice.set.size > 0 ? choice.set : undefined);
      // A computed (or missing) calendar is never the official one: always label business-day results approximate.
      return { date: r.date, approximate: choice.explicit ? false : true };
    }
    default:
      return { date: addCalendarDays(date, signedOffset), approximate: false };
  }
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function nonBusinessDayDescription(date: string, holidays: ReadonlySet<string> | undefined, nameOf?: (d: string) => string | null): string | null {
  const wd = weekday(date);
  const weekend = wd === 0 || wd === 6;
  const holiday = !!holidays && holidays.has(date);
  if (!weekend && !holiday) return null;
  const name = holiday ? nameOf?.(date) ?? null : null;
  if (weekend) return `a ${WEEKDAY_NAMES[wd]}${name ? ` (${name})` : ''}`;
  return `a public holiday${name ? ` (${name})` : ''}`;
}

/**
 * Plain advice when a date lands on a weekend or public holiday, respecting what the date MEANS:
 *  - 'by' (default): must be done on or before it → "aim for <prior business day>".
 *  - 'not_before': the earliest allowed day (a window opens) → "the first business day inside it is <next business day>".
 *    It never suggests an earlier day.
 *  - 'on', 'continuous_since', 'recurring': no advice (null).
 * Returns null when the date is a business day.
 */
export function businessDayAdvice(
  date: string,
  bound: RuleBound | null | undefined,
  holidays?: ReadonlySet<string>,
  nameOf?: (d: string) => string | null,
): string | null {
  const b = bound ?? 'by';
  if (b !== 'by' && b !== 'not_before') return null;
  if (!isCivilDate(date)) return null;
  const off = nonBusinessDayDescription(date, holidays, nameOf);
  if (!off) return null;
  const cal = holidays && holidays.size > 0 ? holidays : undefined;
  if (b === 'by') {
    const prior = addBusinessDays(date, -1, cal).date;
    return `Falls on ${off} — aim for ${formatCivil(prior, 'weekday')}.`;
  }
  const next = addBusinessDays(date, 1, cal).date;
  return `The window opens on ${off}; the first business day inside it is ${formatCivil(next, 'weekday')}.`;
}

const ADVICE_KINDS: ReadonlySet<DeadlineKind> = new Set<DeadlineKind>(['legal', 'contractual', 'user_committed']);

/** Advice for an engine deadline: only for dates that carry an external obligation, using the right calendar. */
function adviceFor(date: string | null, bound: RuleBound, kind: DeadlineKind, applies: 'yes' | 'no' | 'unknown', choice: CalendarChoice): string | null {
  if (!date || applies === 'no' || !ADVICE_KINDS.has(kind)) return null;
  const text = businessDayAdvice(date, bound, choice.set, (d) => holidayName(choice.calendar, d));
  if (!text) return null;
  const computedHoliday = !choice.explicit && choice.calendar !== null && choice.set.has(date);
  return computedHoliday ? `${text} (The holiday calendar is computed; verify against the official calendar.)` : text;
}

function unitText(offset: number, unit: DayUnit): string {
  const n = Math.abs(offset);
  const word = unit === 'calendar_days' ? 'calendar day' : unit === 'business_days' ? 'business day' : 'calendar month';
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function isResolved(status: string): boolean {
  return status === 'completed' || status === 'not_applicable' || status === 'eliminated';
}

function applyRecordState(
  base: { state: DeadlineState; days_until: number | null },
  record: BaseRecord | undefined,
): { state: DeadlineState; days_until: number | null } {
  if (!record) return base;
  if (record.status === 'completed') return { state: 'met', days_until: base.days_until };
  if (record.status === 'not_applicable' || record.status === 'eliminated') return { state: 'not_applicable', days_until: base.days_until };
  return base;
}

function inferRole(anchor: AnchorCode, people: Person[]): keyof TravelerAnchorCodes | null {
  for (const p of people) {
    for (const role of Object.keys(p.anchors) as (keyof TravelerAnchorCodes)[]) {
      if (p.anchors[role] === anchor) return role;
    }
  }
  return null;
}

export function anchorsFrom(records: BaseRecord[]): AnchorData[] {
  const out: AnchorData[] = [];
  for (const r of records) {
    if (r.type !== 'anchor') continue;
    const d = r.data as unknown as Partial<AnchorData>;
    out.push({
      code: d.code ?? r.key,
      traveler: d.traveler ?? 'household',
      meaning: d.meaning ?? r.title,
      date: d.date ?? null,
      timezone: d.timezone ?? DEFAULT_ZONE,
      confidence: d.confidence ?? 'awaiting',
      evidence: d.evidence ?? null,
      coordination_only: d.coordination_only ?? COORDINATION_CODES.has(d.code ?? r.key),
    });
  }
  return out;
}

interface Resolved {
  date: string | null;
  approximate: boolean;
  basis: string;
  choice: CalendarChoice;
}

const NO_CALENDAR: CalendarChoice = { calendar: null, set: new Set<string>(), explicit: false };

/** Resolve a date from an anchor + signed offset, refusing household helpers for traveler-specific or legal use. */
function resolveFromAnchor(args: {
  anchorCode: string | null | undefined;
  anchors: Map<string, AnchorData>;
  signedOffset: number;
  unit: DayUnit;
  kind: DeadlineKind;
  traveler: string | null;
  label: string;
  basisText: string;
  jurisdiction: Jurisdiction | null;
  timezone: IanaZone | null;
  holidays?: ReadonlySet<string>;
}): Resolved {
  const { anchorCode, anchors, signedOffset, unit, kind, traveler, label, basisText, holidays, jurisdiction, timezone } = args;
  const anchor = anchorCode ? anchors.get(anchorCode) : undefined;
  if (!anchor) {
    return { date: null, approximate: false, basis: `Starts when ${label} is triggered.`, choice: NO_CALENDAR };
  }
  const coordination = anchor.coordination_only || COORDINATION_CODES.has(anchor.code);
  if (coordination && (traveler !== 'household' || kind === 'legal' || kind === 'contractual')) {
    return {
      date: null,
      approximate: false,
      basis: `${basisText} A household coordination date cannot date a traveler's own or a legal deadline; it needs that traveler's own date.`,
      choice: NO_CALENDAR,
    };
  }
  if (anchor.date === null) {
    return { date: null, approximate: false, basis: `${basisText} Awaiting: ${anchor.meaning}.`, choice: NO_CALENDAR };
  }
  const choice = chooseCalendar(jurisdiction, timezone, anchor.date, holidays);
  const shifted = shift(anchor.date, signedOffset, unit, choice);
  // The calendar for advice is chosen around the RESULT date, which may be in a later year than the anchor.
  const resultChoice = chooseCalendar(jurisdiction, timezone, shifted.date, holidays);
  return { date: shifted.date, approximate: shifted.approximate, basis: basisText, choice: resultChoice };
}

/* ------------------------------------------------------------------ */
/* rules                                                               */
/* ------------------------------------------------------------------ */

function ruleIsActive(rule: BaseRecord<'deadline_rule', DeadlineRuleData>): boolean {
  if (rule.status === 'superseded' || rule.status === 'inactive') return false;
  return !rule.data.superseded_by;
}

/** Expand rules to concrete per-traveler deadlines ('each_adult' rules produce one per adult). Non-active rules are skipped. */
export function computeRuleDeadlines(
  rules: BaseRecord<'deadline_rule', DeadlineRuleData>[],
  anchors: AnchorData[],
  people: Person[],
  today: string,
  opts: RuleComputeOptions = {},
): ComputedDeadline[] {
  const byCode = new Map(anchors.map((a) => [a.code, a]));
  const soon = opts.soonDays ?? DEFAULT_SOON_DAYS;
  const out: ComputedDeadline[] = [];

  for (const rule of rules) {
    if (!ruleIsActive(rule)) continue;
    const d = rule.data;
    const expansions: { traveler: string; code: string | null; name: string | null; suffix: string }[] = [];

    if (d.traveler_scope === 'each_adult') {
      const role = d.anchor_role ?? inferRole(d.anchor, people);
      for (const p of people.filter((x) => x.kind === 'adult')) {
        const code = role ? (p.anchors[role] ?? null) : null;
        expansions.push({ traveler: p.id, code, name: p.display_name, suffix: `:${p.id}` });
      }
    } else if (d.traveler_scope === 'household') {
      expansions.push({ traveler: 'household', code: d.anchor, name: null, suffix: '' });
    } else {
      expansions.push({ traveler: d.traveler_scope, code: d.anchor, name: null, suffix: '' });
    }

    for (const ex of expansions) {
      const signed = d.direction === 'before' ? -Math.abs(d.offset) : Math.abs(d.offset);
      const label = ex.name ? `${d.label} — ${ex.name}` : d.label;
      const basisText = `${unitText(d.offset, d.unit)} ${d.direction} ${anchorMeaning(byCode, ex.code, d.anchor)}.`;
      const resolved = resolveFromAnchor({
        anchorCode: ex.code,
        anchors: byCode,
        signedOffset: signed,
        unit: d.unit,
        kind: d.kind,
        traveler: ex.traveler,
        label: d.label,
        basisText,
        jurisdiction: d.jurisdiction,
        timezone: d.timezone,
        holidays: opts.holidays,
      });
      const bound: RuleBound = d.bound ?? 'by';
      const st = d.applies === 'no' ? { state: 'not_applicable' as DeadlineState, days_until: resolved.date ? diffDays(today, resolved.date) : null } : stateFor(resolved.date, today, soon);
      const deadline: Deadline = {
        date: resolved.date,
        kind: d.kind,
        basis: resolved.basis,
        source_ids: d.source_ids,
        jurisdiction: d.jurisdiction,
        timezone: d.timezone,
        verified_on: d.verified_on,
        traveler: ex.traveler,
        rule_id: rule.key,
        anchor: ex.code,
        offset: signed,
        unit: d.unit,
      };
      out.push({
        id: `rule:${rule.key}${ex.suffix}`,
        source: 'rule',
        rule_id: rule.key,
        record_id: rule.id,
        record_key: null,
        label,
        traveler: ex.traveler,
        kind: d.kind,
        deadline,
        state: st.state,
        days_until: st.days_until,
        approximate: resolved.approximate,
        applies: d.applies,
        bound,
        business_day_advice: adviceFor(resolved.date, bound, d.kind, d.applies, resolved.choice),
        verification: d.verification,
        linked_record_keys: [...d.linked_records],
      });
    }
  }
  return out;
}

function anchorMeaning(byCode: Map<string, AnchorData>, code: string | null, fallback: string): string {
  const a = code ? byCode.get(code) : undefined;
  return a ? a.meaning : (code ?? fallback);
}

/* ------------------------------------------------------------------ */
/* everything the UI shows                                             */
/* ------------------------------------------------------------------ */

function holidaySet(list: string[] | undefined): ReadonlySet<string> | undefined {
  return list && list.length > 0 ? new Set(list) : undefined;
}

function sortDeadlines(list: ComputedDeadline[]): ComputedDeadline[] {
  return list.sort((a, b) => {
    const ad = a.deadline.date;
    const bd = b.deadline.date;
    if (ad && bd) {
      const c = compareCivil(ad, bd);
      if (c !== 0) return c;
    } else if (ad && !bd) return -1;
    else if (!ad && bd) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** All deadlines the UI shows: rules + explicit record deadlines + existing commitments + review dates + task dues. */
export function collectDeadlines(ctx: DeadlineContext): ComputedDeadline[] {
  const soon = ctx.soon_days ?? DEFAULT_SOON_DAYS;
  const holidays = holidaySet(ctx.jp_holidays);
  const anchors = anchorsFrom(ctx.records);
  const byCode = new Map(anchors.map((a) => [a.code, a]));
  const byKey = new Map<string, BaseRecord>();
  for (const r of ctx.records) if (!byKey.has(r.key) || r.type === 'milestone') byKey.set(r.key, r);

  const rules = ofType<'deadline_rule', DeadlineRuleData>(ctx.records, 'deadline_rule');
  const ruleDeadlines = computeRuleDeadlines(rules, anchors, ctx.people, ctx.today, { soonDays: soon, holidays });
  const out: ComputedDeadline[] = [];

  // Superseded chain: a replaced rule hands its linked records (and any record pointing at it) to the active successor,
  // whose date, kind, verification and verified_on are the ones shown.
  const rulesByKey = new Map(rules.map((r) => [r.key, r]));
  const successorOf = (key: string): { active: BaseRecord<'deadline_rule', DeadlineRuleData> | null; chain: string[] } => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur = rulesByKey.get(key);
    while (cur && !ruleIsActive(cur)) {
      if (seen.has(cur.key)) return { active: null, chain };
      seen.add(cur.key);
      chain.push(cur.key);
      const next: string | null | undefined = cur.data.superseded_by;
      cur = next ? rulesByKey.get(next) : undefined;
    }
    return { active: cur ?? null, chain };
  };
  const linkTo = (targets: ComputedDeadline[], recordKeys: string[], chain: string[]): void => {
    for (const t of targets) {
      t.linked_record_keys = [...new Set([...(t.linked_record_keys ?? []), ...recordKeys])];
      if (chain.length > 0) t.superseded_rule_ids = [...new Set([...(t.superseded_rule_ids ?? []), ...chain])];
    }
  };
  for (const rule of rules) {
    if (ruleIsActive(rule)) continue;
    const { active, chain } = successorOf(rule.key);
    if (!active) continue;
    linkTo(ruleDeadlines.filter((d) => d.rule_id === active.key), rule.data.linked_records, chain);
  }

  // Rule deadlines: 'met' when every relevant linked record is resolved.
  for (const rd of ruleDeadlines) {
    const keys = rd.linked_record_keys ?? [];
    const relevant = keys
      .map((k) => byKey.get(k))
      .filter((r): r is BaseRecord => !!r)
      .filter((r) => {
        const scope = (r.data as { traveler_scope?: string[] }).traveler_scope ?? [];
        return rd.traveler === 'household' || rd.traveler === 'each_adult' || scope.length === 0 || scope.includes(rd.traveler as string);
      });
    if (rd.state !== 'not_applicable' && relevant.length > 0 && relevant.every((r) => isResolved(r.status))) {
      rd.state = relevant.every((r) => r.status === 'not_applicable' || r.status === 'eliminated') ? 'not_applicable' : 'met';
    }
    out.push(rd);
  }

  // Explicit record deadlines (milestones, arrival checks, horizon items) and decision needed-by dates.
  const bearers = ctx.records.filter((r) => r.type === 'milestone' || r.type === 'arrival' || r.type === 'horizon');
  const decisions = ofType<'decision', DecisionData>(ctx.records, 'decision');
  const pairs: { record: BaseRecord; dl: Deadline }[] = [];
  for (const r of bearers) {
    const dl = (r.data as { deadline?: Deadline | null }).deadline;
    if (dl) pairs.push({ record: r, dl });
  }
  for (const r of decisions) {
    if (r.data.needed_by) pairs.push({ record: r as unknown as BaseRecord, dl: r.data.needed_by });
  }
  for (const { record, dl } of pairs) {
    // A deadline derived from a rule is represented by the rule's own deadline; the record is linked to it.
    if (dl.rule_id) {
      const { active, chain } = successorOf(dl.rule_id);
      const candidates = active ? ruleDeadlines.filter((x) => x.rule_id === active.key) : [];
      const own = candidates.filter((x) => x.traveler === dl.traveler);
      const targets = own.length > 0 ? own : candidates;
      if (targets.length > 0) {
        linkTo(targets, [record.key], chain);
        continue;
      }
    }
    const r = resolveRecordDeadline(dl, byCode, holidays, record.title);
    const st = applyRecordState(stateFor(r.date, ctx.today, soon), record);
    out.push({
      id: `record:${record.key}`,
      source: 'record',
      rule_id: dl.rule_id ?? null,
      record_id: record.id,
      record_key: record.key,
      label: record.title,
      traveler: dl.traveler,
      kind: dl.kind,
      deadline: { ...dl, date: r.date, basis: r.basis },
      state: st.state,
      days_until: st.days_until,
      approximate: r.approximate,
      applies: 'yes',
      bound: 'by',
      business_day_advice: adviceFor(r.date, 'by', dl.kind, 'yes', r.choice),
    });
  }

  // Existing commitments (dated obligations recorded in the plan). Existing deadlines are never recalculated.
  for (const rec of ofType<'existing_commitment', ExistingCommitmentData>(ctx.records, 'existing_commitment')) {
    const c = rec.data;
    const date = c.recorded_date && isCivilDate(c.recorded_date) ? c.recorded_date : null;
    const commitChoice = date ? chooseCalendar(null, DEFAULT_ZONE, date, holidays) : NO_CALENDAR;
    let st = applyRecordState(stateFor(date, ctx.today, soon), rec as unknown as BaseRecord);
    // Old task dates recorded as history are not evidence of (non)completion: never show them as overdue.
    if (c.historical && st.state === 'overdue') {
      st = { state: 'historical', days_until: st.days_until };
    }
    out.push({
      id: `commitment:${rec.key}`,
      source: 'commitment',
      rule_id: null,
      record_id: rec.id,
      record_key: rec.key,
      label: rec.title,
      traveler: 'household',
      kind: c.deadline_kind,
      deadline: {
        date,
        kind: c.deadline_kind,
        basis: c.evidence_caution ? `${c.meaning}. ${c.evidence_caution}` : c.meaning,
        source_ids: [],
        jurisdiction: null,
        timezone: DEFAULT_ZONE,
        verified_on: null,
        traveler: 'household',
      },
      state: st.state,
      days_until: st.days_until,
      approximate: false,
      applies: 'yes',
      bound: c.deadline_kind === 'review_date' ? 'on' : 'by',
      business_day_advice: c.historical || c.deadline_kind === 'review_date' ? null : adviceFor(date, 'by', c.deadline_kind, 'yes', commitChoice),
      linked_record_keys: [...c.linked_records],
    });
  }

  // Review dates: planning checkpoints, never filing deadlines or expiries.
  for (const rec of ofType<'milestone', MilestoneData>(ctx.records, 'milestone')) {
    const review = rec.data.review_date;
    if (!review || !isCivilDate(review)) continue;
    const st = applyRecordState(stateFor(review, ctx.today, soon), rec as unknown as BaseRecord);
    out.push({
      id: `review:${rec.key}`,
      source: 'review',
      rule_id: null,
      record_id: rec.id,
      record_key: rec.key,
      label: `Review: ${rec.title}`,
      traveler: 'household',
      kind: 'review_date',
      deadline: {
        date: review,
        kind: 'review_date',
        basis: 'Planning review checkpoint. This is not a filing deadline or an expiry.',
        source_ids: [],
        jurisdiction: 'household',
        timezone: DEFAULT_ZONE,
        verified_on: null,
        traveler: 'household',
      },
      state: st.state,
      days_until: st.days_until,
      approximate: false,
      applies: 'yes',
      bound: 'on',
      business_day_advice: null,
    });
  }

  // Task due dates from the task store (or its snapshot).
  for (const link of ctx.task_links ?? []) {
    if (!link.due || !isCivilDate(link.due)) continue;
    // A proposal that no authorized writer has added to the task list yet is not a commitment: it has no date in
    // anyone's task list, so it never appears among deadlines (and can never be "overdue").
    if (link.sync_state === 'pending_capture' || !link.canonical_id) continue;
    let st = stateFor(link.due, ctx.today, soon);
    if (link.status === 'done') st = { state: 'met', days_until: st.days_until };
    else if (link.status === 'cancelled') st = { state: 'not_applicable', days_until: st.days_until };
    // A past date in a read-only, dated copy of the task list says nothing about whether the task was done.
    else if (link.sync_state === 'snapshot' && st.state === 'overdue') st = { state: 'historical', days_until: st.days_until };
    const person = link.owner && link.owner !== 'together' && link.owner !== 'unassigned' ? link.owner : 'household';
    out.push({
      id: `task:${link.id}`,
      source: 'task',
      rule_id: null,
      record_id: link.record_id,
      record_key: link.record_id ? (link.record_id.split(':')[1] ?? null) : null,
      label: link.title,
      traveler: person,
      kind: link.due_basis === 'explicit' ? 'user_committed' : 'internal_target',
      deadline: {
        date: link.due,
        kind: link.due_basis === 'explicit' ? 'user_committed' : 'internal_target',
        basis: link.due_basis === 'default_14_days'
          ? 'Default: 14 days after the task was created.'
          : link.due_basis === 'source'
            ? (st.state === 'historical'
              ? 'Date in the read-only task-list copy has passed. This does not show whether the task was done — check the task list.'
              : 'Date held by the task list (read-only copy).')
            : 'Date set on the task.',
        source_ids: [],
        jurisdiction: 'household',
        timezone: DEFAULT_ZONE,
        verified_on: null,
        traveler: person,
      },
      state: st.state,
      days_until: st.days_until,
      approximate: false,
      applies: 'yes',
      bound: 'by',
      business_day_advice: st.state === 'historical' || st.state === 'met' || st.state === 'not_applicable' ? null : adviceFor(link.due, 'by', link.due_basis === 'explicit' ? 'user_committed' : 'internal_target', 'yes', chooseCalendar(null, DEFAULT_ZONE, link.due, holidays)),
    });
  }

  return sortDeadlines(out);
}

function resolveRecordDeadline(dl: Deadline, anchors: Map<string, AnchorData>, holidays: ReadonlySet<string> | undefined, label: string): Resolved {
  if (dl.anchor && dl.offset !== undefined && dl.offset !== null && dl.unit) {
    return resolveFromAnchor({
      anchorCode: dl.anchor,
      anchors,
      signedOffset: dl.offset,
      unit: dl.unit,
      kind: dl.kind,
      traveler: typeof dl.traveler === 'string' ? dl.traveler : null,
      label,
      basisText: dl.basis,
      jurisdiction: dl.jurisdiction,
      timezone: dl.timezone,
      holidays,
    });
  }
  const date = dl.date && isCivilDate(dl.date) ? dl.date : null;
  return { date, approximate: false, basis: dl.basis, choice: date ? chooseCalendar(dl.jurisdiction, dl.timezone, date, holidays) : NO_CALENDAR };
}

/* ------------------------------------------------------------------ */
/* anchor-change preview                                               */
/* ------------------------------------------------------------------ */

/** Preview every deadline whose date would change if `code` moved to `newDate` (null = clear). Applies nothing. */
export function previewAnchorChange(ctx: DeadlineContext, code: AnchorCode, newDate: string | null): AnchorChangePreview {
  const anchors = anchorsFrom(ctx.records);
  const current = anchors.find((a) => a.code === code);
  const adultsAndPets = ctx.people.map((p) => p.id);
  const warnings: string[] = [];

  if (!current) {
    return { anchor: code, traveler: 'household', before: null, after: newDate, changes: [], unchanged_count: 0, unaffected_travelers: adultsAndPets, warnings: [`There is no date called "${code}" in this plan.`] };
  }
  if (newDate !== null && !isCivilDate(newDate)) {
    return { anchor: code, traveler: current.traveler, before: current.date, after: newDate, changes: [], unchanged_count: 0, unaffected_travelers: adultsAndPets, warnings: ['That is not a valid calendar date.'] };
  }

  const before = collectDeadlines(ctx);
  const nextRecords = ctx.records.map((r) =>
    r.type === 'anchor' && ((r.data as unknown as AnchorData).code ?? r.key) === code
      ? ({ ...r, data: { ...r.data, date: newDate } } as BaseRecord)
      : r,
  );
  const after = collectDeadlines({ ...ctx, records: nextRecords });
  const afterById = new Map(after.map((d) => [d.id, d]));

  const changes: AnchorChangeEffect[] = [];
  let unchanged = 0;
  for (const b of before) {
    const a = afterById.get(b.id);
    if (!a) continue;
    if (a.deadline.date === b.deadline.date) {
      unchanged++;
      continue;
    }
    changes.push({
      deadline_id: b.id,
      label: b.label,
      traveler: b.traveler,
      kind: b.kind,
      before: b.deadline.date,
      after: a.deadline.date,
      record_keys: b.linked_record_keys && b.linked_record_keys.length > 0 ? b.linked_record_keys : b.record_key ? [b.record_key] : [],
    });
  }

  const touched = new Set(changes.map((c) => c.traveler).filter((t): t is string => typeof t === 'string'));
  const unaffected = ctx.people.map((p) => p.id).filter((id) => id !== current.traveler && !touched.has(id));

  if (current.date === newDate) warnings.push('The date is unchanged.');
  if (newDate !== null && compareCivil(newDate, ctx.today) < 0) warnings.push('The new date is before today.');
  if (changes.some((c) => c.kind === 'legal')) warnings.push('This changes a legal deadline. Confirm the new date with the official source or your adviser.');
  if (newDate === null && changes.length > 0) warnings.push(`Clearing this date sends ${changes.length} deadline${changes.length === 1 ? '' : 's'} back to "Awaiting date".`);
  if (current.coordination_only) warnings.push("This is a household helper date. It never sets a traveler's own deadline.");

  return { anchor: code, traveler: current.traveler, before: current.date, after: newDate, changes, unchanged_count: unchanged, unaffected_travelers: unaffected, warnings };
}

/** Default due date for a newly proposed action: 14 calendar days after its creation date. */
export function defaultNewTaskDue(createdOn: string): string {
  return addCalendarDays(createdOn, 14);
}

/* ------------------------------------------------------------------ */
/* a traveler's own dates                                              */
/* ------------------------------------------------------------------ */

type DatePhase = 'before_departure' | 'after_arrival';

/**
 * The active rule deadlines that belong to one traveler (rules scoped to them, including each-adult expansions), split for
 * the readiness page: "Dates before leaving" and "After arrival". The split follows the anchor the rule is dated from:
 *  - the traveler's departure anchor: before leaving (unless the offset runs after departure);
 *  - the traveler's arrival anchor: before leaving when the date is BEFORE arrival (notices, exams), after arrival otherwise;
 *  - residence, health and pension eligibility anchors and status-expiry anchors (X…): after arrival;
 *  - any other anchor or an event trigger: by the direction of the offset (before ⇒ before leaving).
 * Rules that do not apply (applies = no) are left out. Sorted by date, dates still awaiting last.
 */
export function travelerDeadlines(personId: string, ctx: DeadlineContext): TravelerDeadlines {
  const person = ctx.people.find((p) => p.id === personId);
  const roleByCode = new Map<string, keyof TravelerAnchorCodes>();
  if (person) for (const role of Object.keys(person.anchors) as (keyof TravelerAnchorCodes)[]) {
    const code = person.anchors[role];
    if (code) roleByCode.set(code, role);
  }
  const classify = (d: ComputedDeadline): DatePhase => {
    const code = d.deadline.anchor ?? null;
    const offset = d.deadline.offset ?? 0;
    const role = code ? roleByCode.get(code) : undefined;
    if (role === 'departure') return offset > 0 ? 'after_arrival' : 'before_departure';
    if (role === 'arrival') return offset < 0 ? 'before_departure' : 'after_arrival';
    if (role === 'residence' || role === 'health_eligibility' || role === 'pension_eligibility') return 'after_arrival';
    if (code && code.startsWith('X')) return 'after_arrival';
    return offset < 0 ? 'before_departure' : 'after_arrival';
  };
  const mine = collectDeadlines(ctx).filter((d) => d.source === 'rule' && d.traveler === personId && d.applies !== 'no' && d.state !== 'not_applicable');
  return {
    before_departure: sortDeadlines(mine.filter((d) => classify(d) === 'before_departure')),
    after_arrival: sortDeadlines(mine.filter((d) => classify(d) === 'after_arrival')),
  };
}
