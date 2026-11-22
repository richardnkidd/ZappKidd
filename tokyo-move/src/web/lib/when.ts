/**
 * The ONE date a card shows (UX-004): legal > contract > our target > task-list date > check-in, then the soonest.
 * Other dates (a linked task's, a commitment's, the check-in) are listed on the record's own page, never on a card,
 * and a card never says "Awaiting date" while any real date exists.
 */
import { diffDays } from '@shared/dates';
import type { ComputedDeadline, DeadlineState } from '@shared/engine-contracts';
import type { DeadlineKind } from '@shared/types';
import { KIND_PRIORITY } from './dateWords';
import { compareDates } from './format';
import { PHASE_ORDER } from '@shared/labels';
import type { PhaseKey } from '@shared/types';
import { isOpenWork, type Indexes, type Milestone } from './records';

export type WhenKind = DeadlineKind | 'task';

export interface WhenCandidate {
  date: string;
  kind: WhenKind;
  source: 'deadline' | 'task' | 'commitment' | 'review';
  state: DeadlineState | null;
  deadline: ComputedDeadline | null;
  /** Human label of where the date comes from ("In your task list", "Recorded date", "Check-in"). */
  label: string;
}

export interface WhenInfo {
  primary: WhenCandidate | null;
  others: WhenCandidate[];
}

export const NO_WHEN: WhenInfo = { primary: null, others: [] };

/** The earliest phase that still has open, non-optional work (kept per index so cards do not recompute it). */
const phaseCache = new WeakMap<Indexes, PhaseKey | null>();
function nowPhase(idx: Indexes): PhaseKey | null {
  if (phaseCache.has(idx)) return phaseCache.get(idx) ?? null;
  const open = new Set<PhaseKey>();
  for (const m of idx.milestones) if (isOpenWork(m.status) && !m.data?.optional_future_work && m.data?.phase) open.add(m.data.phase);
  const p = PHASE_ORDER.find((x) => open.has(x)) ?? null;
  phaseCache.set(idx, p);
  return p;
}

/** A check-in date for work in a later phase says nothing useful yet; it stays on the record's own page. */
function laterPhase(m: Milestone, idx: Indexes): boolean {
  const mine = m.data?.phase ? PHASE_ORDER.indexOf(m.data.phase) : -1;
  const cur = nowPhase(idx);
  return mine >= 0 && cur !== null && mine > PHASE_ORDER.indexOf(cur);
}

const live = (d: ComputedDeadline) => d.applies !== 'no' && d.state !== 'met' && d.state !== 'not_applicable' && d.state !== 'historical' && Boolean(d.deadline.date);

export function whenCandidates(m: Milestone, idx: Indexes, engine: ComputedDeadline[] | undefined, today: string): WhenCandidate[] {
  const out: WhenCandidate[] = [];

  // The milestone's own dates only: record or rule dates, and the check-in.
  const own = (engine ?? []).filter((d) => (d.source === 'record' || d.source === 'rule' || d.source === 'review') && live(d));
  for (const d of own) {
    out.push({
      date: d.deadline.date!,
      kind: d.kind,
      source: d.kind === 'review_date' ? 'review' : 'deadline',
      state: d.state,
      deadline: d,
      label: d.kind === 'review_date' ? 'Check-in' : d.label,
    });
  }
  if (!engine) {
    const dl = m.data?.deadline;
    if (dl?.date && dl.kind !== 'review_date') out.push({ date: dl.date, kind: dl.kind, source: 'deadline', state: null, deadline: null, label: 'Deadline' });
    if (m.data?.review_date) out.push({ date: m.data.review_date, kind: 'review_date', source: 'review', state: null, deadline: null, label: 'Check-in' });
  }

  // Linked task-list dates: only real, open entries. A proposal not yet added is not "in the task list", and an old
  // date in a read-only copy says nothing either way.
  for (const t of idx.taskLinksByRecord.get(m.id) ?? []) {
    if (t.status !== 'open' || !t.due) continue;
    if (t.sync_state === 'pending_capture') continue;
    if (t.sync_state === 'snapshot' && diffDays(today, t.due) < 0) continue;
    out.push({ date: t.due, kind: 'task', source: 'task', state: null, deadline: null, label: 'In your task list' });
  }

  // Linked existing commitments that are still ahead.
  for (const c of idx.commitmentsByMilestoneKey.get(m.key) ?? []) {
    const date = c.data?.recorded_date;
    if (!date || !isOpenWork(c.status) || c.data.historical || diffDays(today, date) < 0) continue;
    out.push({ date, kind: c.data.deadline_kind ?? 'user_committed', source: 'commitment', state: null, deadline: null, label: 'Recorded date' });
  }
  return laterPhase(m, idx) ? out.filter((c) => c.source !== 'review') : out;
}

export function whenFor(m: Milestone, idx: Indexes, engine: ComputedDeadline[] | undefined, today: string): WhenInfo {
  const all = whenCandidates(m, idx, engine, today).sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || compareDates(a.date, b.date));
  return { primary: all[0] ?? null, others: all.slice(1) };
}
