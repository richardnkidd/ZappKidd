/**
 * Pure selection logic for the Home screen. No React, no fetching, so it can be unit-tested with synthetic records.
 * Date and deadline arithmetic comes from the shared engines; this file only chooses and groups what to show.
 */
import type { ComputedDeadline, DeadlineState } from '@shared/engine-contracts';
import { addCalendarDays, diffDays, formatCivil, weekday } from '@shared/dates';
import { PHASE_ORDER } from '@shared/labels';
import type { BaseRecord, DeadlineKind, DeadlineRuleData, OwnerRef, PhaseKey, Priority } from '@shared/types';
import { compareDates } from './format';
import { NO_WHEN, whenFor, type WhenInfo } from './when';
import { commitmentIsLinked, dataOf, isOpenWork, normalizedOwner, unmetDependencyKeys, type Commitment, type Decision, type Directory, type Indexes, type Milestone } from './records';

export type OwnerFilter = 'all' | 'needs_me' | 'mine' | 'other' | 'together' | 'unassigned' | 'waiting';

export interface FilterContext {
  meId: string | null;
  otherIds: string[];
  /** True when this record is waiting for the signed-in person's approval ("Needs me" includes it). */
  awaitingMe?: (rec: BaseRecord) => boolean;
}

export function matchesOwnerFilter(filter: OwnerFilter, owner: OwnerRef | null | undefined, status: string | null, ctx: FilterContext, rec?: BaseRecord): boolean {
  const o = normalizedOwner(owner);
  switch (filter) {
    case 'all':
      return true;
    case 'needs_me':
      // Mine, shared with me, or waiting for my approval.
      return o === ctx.meId || o === 'together' || Boolean(rec && ctx.awaitingMe?.(rec));
    case 'mine':
      return o === ctx.meId;
    case 'other':
      return ctx.otherIds.includes(o);
    case 'together':
      return o === 'together';
    case 'unassigned':
      return o === 'unassigned';
    case 'waiting':
      return status === 'waiting_external';
  }
}

const PRIORITY_RANK: Record<Priority, number> = { now: 0, soon: 1, later: 2, someday: 3 };

/** The earliest phase that still has open, non-optional work. Used as "where we are in the plan". */
export function currentPhase(idx: Indexes): PhaseKey | null {
  const open = new Set<PhaseKey>();
  for (const m of idx.milestones) {
    if (!isOpenWork(m.status) || m.data?.optional_future_work || !m.data?.phase) continue;
    open.add(m.data.phase);
  }
  return PHASE_ORDER.find((p) => open.has(p)) ?? null;
}

/* ---------- Now ---------- */

export interface NowItem {
  id: string; // unique list key
  recordId: string | null;
  kind: 'milestone' | 'commitment' | 'task';
  title: string;
  owner: OwnerRef | null;
  ownerProposed: boolean;
  nextAction: string | null;
  date: string | null;
  dateKind: DeadlineKind | null;
  dateState: DeadlineState | null;
  /** The one date shown on the card (see lib/when.ts). */
  when: WhenInfo;
  status: string;
  /** Plain note such as "From your task list". */
  note: string | null;
}

interface NowOptions {
  today: string;
  filter: OwnerFilter;
  ctx: FilterContext;
  deadlinesByRecord?: Map<string, ComputedDeadline[]>;
  limit?: number;
  /** Look-ahead for commitments and tasks (days). */
  horizonDays?: number;
}

/**
 * The date used to RANK a milestone: its own real deadline first, otherwise its check-in. (Cards show the one primary
 * date from lib/when.ts, which also looks at linked tasks and commitments.)
 */
export function milestoneDate(
  m: Milestone,
  engine?: ComputedDeadline[],
): { date: string | null; kind: DeadlineKind | null; state: DeadlineState | null } {
  // Only the milestone's own dates: a linked task's or commitment's date is shown separately and never becomes its target.
  const live = (engine ?? []).filter(
    (d) =>
      (d.source === 'record' || d.source === 'rule' || d.source === 'review') &&
      d.applies !== 'no' &&
      d.state !== 'met' &&
      d.state !== 'not_applicable' &&
      d.state !== 'historical' &&
      d.deadline.date,
  );
  const real = live.filter((d) => d.kind !== 'review_date').sort((a, b) => compareDates(a.deadline.date, b.deadline.date));
  if (real[0]) return { date: real[0].deadline.date, kind: real[0].kind, state: real[0].state };
  const own = m.data?.deadline;
  if (own?.date && own.kind !== 'review_date') return { date: own.date, kind: own.kind, state: null };
  const review = live.find((d) => d.kind === 'review_date');
  if (review?.deadline.date) return { date: review.deadline.date, kind: 'review_date', state: review.state };
  if (m.data?.review_date) return { date: m.data.review_date, kind: 'review_date', state: null };
  return { date: null, kind: null, state: null };
}

export function selectNow(idx: Indexes, opts: NowOptions): NowItem[] {
  const { today, filter, ctx } = opts;
  const limit = opts.limit ?? 5;
  const horizon = opts.horizonDays ?? 21;
  const phase = currentPhase(idx);
  const phaseIdx = phase ? PHASE_ORDER.indexOf(phase) : PHASE_ORDER.length;
  const want = filter === 'waiting' ? ['waiting_external'] : ['planned', 'in_progress'];

  type Ranked = NowItem & { rank: [number, string, number, string] };
  const ranked: Ranked[] = [];

  for (const m of idx.milestones) {
    if (!want.includes(m.status) || m.data?.optional_future_work) continue;
    if (!matchesOwnerFilter(filter, m.owner, m.status, ctx, m)) continue;
    const mPhase = m.data?.phase ? PHASE_ORDER.indexOf(m.data.phase) : -1;
    if (mPhase > phaseIdx) continue; // later phases are not "now"
    if (unmetDependencyKeys(m, idx).length > 0) continue;
    const when = milestoneDate(m, opts.deadlinesByRecord?.get(m.id));
    const real = when.kind !== null && when.kind !== 'review_date';
    const soonReal = real && when.date !== null && diffDays(today, when.date) <= 30;
    const prio = m.data?.priority ? PRIORITY_RANK[m.data.priority] : 4;
    const bucket = soonReal ? 0 : prio === 0 ? 1 : real ? 2 : prio === 1 ? 3 : 4;
    ranked.push({
      id: m.id,
      recordId: m.id,
      kind: 'milestone',
      title: m.title,
      owner: m.owner,
      ownerProposed: m.owner_proposed,
      nextAction: m.data?.next_action || null,
      date: when.date,
      dateKind: when.kind,
      dateState: when.state,
      when: whenFor(m, idx, opts.deadlinesByRecord?.get(m.id), today),
      status: m.status,
      note: null,
      rank: [bucket, when.date ?? '9999-12-31', m.status === 'in_progress' ? 0 : 1, m.key],
    });
  }

  const taken = new Set(ranked.map((r) => r.recordId));

  for (const c of idx.commitments as Commitment[]) {
    if (!isOpenWork(c.status) || !c.data?.recorded_date) continue;
    if (c.data.historical || commitmentIsLinked(c, idx)) continue; // old dates prove nothing; linked ones live on their milestone
    if (!matchesOwnerFilter(filter, c.owner, c.status, ctx, c)) continue;
    const away = diffDays(today, c.data.recorded_date);
    if (away > horizon || away < -3) continue; // an old date is not 'now' and proves nothing about whether it was done
    ranked.push({
      id: c.id,
      recordId: c.id,
      kind: 'commitment',
      title: c.title,
      owner: c.owner,
      ownerProposed: c.owner_proposed,
      nextAction: c.data.meaning || null,
      date: c.data.recorded_date,
      dateKind: c.data.deadline_kind ?? 'user_committed',
      dateState: null,
      when: { primary: { date: c.data.recorded_date, kind: c.data.deadline_kind ?? 'user_committed', source: 'commitment', state: null, deadline: null, label: 'Recorded date' }, others: [] },
      status: c.status,
      note: 'Already on your calendar',
      rank: [0, c.data.recorded_date, 1, c.key],
    });
  }

  for (const t of idx.taskLinks) {
    if (t.status !== 'open' || !t.due) continue; // done and cancelled tasks never appear
    // A proposal that has not reached the task list yet is not "in the task list": it has its own Home row.
    if (t.sync_state === 'pending_capture') continue;
    if (t.record_id && taken.has(t.record_id)) continue;
    // Work already finished in the plan: the leftover task copy is for tidying, not for "now".
    const linked = t.record_id ? idx.byId.get(t.record_id) : undefined;
    if (linked && !isOpenWork(linked.status)) continue;
    // A past date in a read-only copy of the task list says nothing about whether the task was done.
    if (t.sync_state === 'snapshot' && diffDays(today, t.due) < 0) continue;
    if (!matchesOwnerFilter(filter, t.owner, null, ctx) && filter !== 'all') continue;
    if (filter === 'waiting') continue;
    if (diffDays(today, t.due) > horizon) continue;
    ranked.push({
      id: `task:${t.id}`,
      recordId: t.record_id,
      kind: 'task',
      title: t.title,
      owner: t.owner ?? linked?.owner ?? null,
      ownerProposed: false,
      nextAction: null,
      date: t.due,
      dateKind: null,
      dateState: null,
      when: { primary: { date: t.due, kind: 'task', source: 'task', state: null, deadline: null, label: 'In your task list' }, others: [] },
      status: 'planned',
      note: t.sync_state === 'snapshot' ? 'From your task list (read-only copy)' : 'From your task list',
      rank: [0, t.due, 2, t.id],
    });
  }

  ranked.sort((a, b) => {
    for (let i = 0; i < 4; i++) {
      const x = a.rank[i]!;
      const y = b.rank[i]!;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
  return ranked.slice(0, limit).map(({ rank: _rank, ...item }) => item);
}

/* ---------- Decisions ---------- */

/** A decision the plan already records as decided (never asked again). */
export interface RecordedDecision {
  on: string | null;
  source: string | null;
  summary: string | null;
  open_part: string | null;
}

export function recordedDecision(d: { data?: unknown }): RecordedDecision | null {
  const r = (d.data as { recorded_decision?: Partial<RecordedDecision> } | undefined)?.recorded_decision;
  if (!r || typeof r !== 'object') return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return { on: str(r.on), source: str(r.source), summary: str(r.summary), open_part: str(r.open_part) };
}

/** Scope the household already settled, shown above the open question as "Already decided: …". */
export function settledPart(d: { data?: unknown }): string | null {
  const v = (d.data as { settled_part?: unknown } | undefined)?.settled_part;
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Open and proposed decisions, in the order a person should see them:
 *  1. a dated needed-by within 30 days (soonest first),
 *  2. the household's chosen first-review decisions, in the order they were listed,
 *  3. everything else by needed-by date, then by when it is needed.
 */
export function selectDecisions(
  idx: Indexes,
  filter: OwnerFilter,
  ctx: FilterContext,
  opts: { today?: string; firstReviewKeys?: string[] } = {},
): Decision[] {
  const firstKeys = opts.firstReviewKeys ?? [];
  const bucket = (d: Decision): [number, string] => {
    const date = d.data?.needed_by?.date ?? null;
    if (opts.today && date && diffDays(opts.today, date) <= 30) return [0, date];
    const i = firstKeys.indexOf(d.key);
    if (i >= 0) return [1, String(i).padStart(4, '0')];
    return [2, date ?? '9999-12-31'];
  };
  return idx.decisions
    .filter((d) => (d.status === 'open' || d.status === 'proposed') && !recordedDecision(d) && matchesOwnerFilter(filter, d.owner, d.status, ctx, d))
    .sort((a, b) => {
      const [ba, ka] = bucket(a);
      const [bb, kb] = bucket(b);
      if (ba !== bb) return ba - bb;
      if (ka !== kb) return ka < kb ? -1 : 1;
      const t = (a.data?.trigger ?? '').localeCompare(b.data?.trigger ?? '');
      return t !== 0 ? t : a.key.localeCompare(b.key, undefined, { numeric: true });
    });
}

/* ---------- Blocked ---------- */

export interface BlockedItem {
  record: Milestone;
  reason: string | null;
  waitingOn: { key: string; title: string }[];
  kind: 'blocked' | 'waiting';
}

export function selectBlocked(idx: Indexes, filter: OwnerFilter, ctx: FilterContext): BlockedItem[] {
  const out: BlockedItem[] = [];
  for (const m of idx.milestones) {
    if (m.data?.optional_future_work) continue;
    if (m.status !== 'blocked' && m.status !== 'waiting_external') continue;
    if (!matchesOwnerFilter(filter, m.owner, m.status, ctx, m)) continue;
    const waitingOn = unmetDependencyKeys(m, idx).map((k) => ({ key: k, title: idx.byKey.get(k)?.title ?? k }));
    out.push({ record: m, reason: m.data?.status_reason?.trim() || null, waitingOn, kind: m.status === 'blocked' ? 'blocked' : 'waiting' });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.record.key.localeCompare(b.record.key, undefined, { numeric: true }) : a.kind === 'blocked' ? -1 : 1));
}

/* ---------- Coming up ---------- */

export interface ComingRow {
  kind: 'deadline' | 'review_summary';
  /** For a deadline row. */
  deadline?: ComputedDeadline;
  /** For a review summary: every review checkpoint that shares the date. */
  reviews?: ComputedDeadline[];
  date: string | null;
}

export interface ComingGroup {
  key: string;
  label: string;
  rows: ComingRow[];
}

export interface ComingUp {
  groups: ComingGroup[];
  awaiting: ComputedDeadline[];
  /** Past dates from a task-list copy or old records. Listed once, neutrally; never as overdue. */
  historical: ComputedDeadline[];
  /** Dated rows that were left out because of `maxRows` (a collapsed review-checkpoint row counts as one). */
  hidden: number;
}

export function deadlineOwner(d: ComputedDeadline, idx: Indexes, dir: Directory): OwnerRef {
  if (d.record_id) {
    const rec = idx.byId.get(d.record_id);
    if (rec?.owner) return rec.owner;
  }
  if (d.traveler && d.traveler !== 'household' && d.traveler !== 'each_adult') {
    const p = dir.personById(d.traveler);
    if (p?.kind === 'adult') return p.id;
  }
  return 'together';
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addCalendarDays(date, -((weekday(date) + 6) % 7));
}

export function weekLabel(start: string, todayStart: string): string {
  const d = diffDays(todayStart, start);
  if (d === 0) return 'This week';
  if (d === 7) return 'Next week';
  return `Week of ${formatCivil(start, 'compact')}`;
}

export function selectComingUp(
  deadlines: ComputedDeadline[],
  idx: Indexes,
  dir: Directory,
  opts: { today: string; filter: OwnerFilter; ctx: FilterContext; windowDays?: number; reviewCollapseMin?: number; maxRows?: number },
): ComingUp {
  const { today, filter, ctx } = opts;
  const windowDays = opts.windowDays ?? 60;
  const collapseMin = opts.reviewCollapseMin ?? 2;

  const usable = deadlines.filter((d) => {
    if (d.applies === 'no' || d.state === 'met' || d.state === 'not_applicable') return false;
    // A commitment that points at a milestone is shown on that milestone, not as a second item here.
    if (d.source === 'commitment' && (d.linked_record_keys ?? []).some((k) => idx.milestoneByKey.has(k))) return false;
    const rec = d.record_id ? idx.byId.get(d.record_id) : undefined;
    if (rec && (rec.status === 'completed' || rec.status === 'eliminated' || rec.status === 'not_applicable')) return false;
    if (rec && dataOf<{ optional_future_work?: boolean }>(rec).optional_future_work) return false;
    return matchesOwnerFilter(filter, deadlineOwner(d, idx, dir), rec?.status ?? null, ctx);
  });

  const awaiting = usable.filter((d) => !d.deadline.date).sort((a, b) => a.label.localeCompare(b.label));
  const historical = usable.filter((d) => d.state === 'historical' && d.deadline.date).sort((a, b) => compareDates(b.deadline.date, a.deadline.date));
  const dated = usable.filter((d) => d.state !== 'historical' && d.deadline.date && diffDays(today, d.deadline.date) <= windowDays);

  // Collapse review checkpoints that share a date into one calm summary row.
  const reviewsByDate = new Map<string, ComputedDeadline[]>();
  const rows: ComingRow[] = [];
  for (const d of dated) {
    if (d.kind === 'review_date') {
      const list = reviewsByDate.get(d.deadline.date!) ?? [];
      list.push(d);
      reviewsByDate.set(d.deadline.date!, list);
    } else {
      rows.push({ kind: 'deadline', deadline: d, date: d.deadline.date });
    }
  }
  for (const [date, list] of reviewsByDate) {
    if (list.length >= collapseMin) rows.push({ kind: 'review_summary', reviews: list, date });
    else for (const d of list) rows.push({ kind: 'deadline', deadline: d, date });
  }
  rows.sort((a, b) => {
    const c = compareDates(a.date, b.date);
    if (c !== 0) return c;
    // Real deadlines before a review summary on the same day.
    return (a.kind === 'review_summary' ? 1 : 0) - (b.kind === 'review_summary' ? 1 : 0);
  });

  const todayStart = weekStart(today);
  const groups: ComingGroup[] = [];
  const byKey = new Map<string, ComingGroup>();
  for (const row of rows) {
    const date = row.date!;
    let key: string;
    let label: string;
    if (diffDays(today, date) < 0) {
      key = 'past';
      label = 'Past their date';
    } else {
      key = weekStart(date);
      label = weekLabel(key, todayStart);
    }
    let g = byKey.get(key);
    if (!g) {
      g = { key, label, rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  groups.sort((a, b) => (a.key === 'past' ? -1 : b.key === 'past' ? 1 : a.key < b.key ? -1 : 1));
  const cap = opts.maxRows ?? Infinity;
  let left = cap;
  let hidden = 0;
  const capped: ComingGroup[] = [];
  for (const g of groups) {
    if (left <= 0) {
      hidden += g.rows.length;
      continue;
    }
    const keep = g.rows.slice(0, left);
    hidden += g.rows.length - keep.length;
    left -= keep.length;
    capped.push({ ...g, rows: keep });
  }
  return { groups: capped, awaiting, historical, hidden };
}

/** Which rule (if any) produced a computed deadline, so its verification can be shown. */
export function ruleFor(d: ComputedDeadline, idx: Indexes): BaseRecord | null {
  if (!d.rule_id) return null;
  return idx.byKey.get(d.rule_id) ?? idx.byId.get(`deadline_rule:${d.rule_id}`) ?? idx.byId.get(d.rule_id) ?? null;
}

/**
 * How far a deadline's rule has been verified. A rule with no recorded verification counts as not verified,
 * and a legal deadline with no verification date is flagged the same way: it must never look more certain than
 * it is. Returns null when there is nothing to caveat.
 */
export function deadlineVerification(d: ComputedDeadline, idx: Indexes): DeadlineRuleData['verification'] | null {
  const rule = ruleFor(d, idx);
  if (rule) return dataOf<DeadlineRuleData>(rule).verification ?? 'not_verified';
  if (d.kind === 'legal' && !d.deadline.verified_on) return 'not_verified';
  return null;
}
