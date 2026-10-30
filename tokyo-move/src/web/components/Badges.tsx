import type { ReactNode } from 'react';
import type { DeadlineState } from '@shared/engine-contracts';
import type { Deadline, DeadlineKind, DeadlineRuleData, Priority, TaskLink, WorkStatus } from '@shared/types';
import {
  DEADLINE_KIND_LABEL,
  DEADLINE_STATE_LABEL,
  PRIORITY_LABEL,
  SYNC_STATE_LABEL,
  VERIFICATION_LABEL,
  WORK_STATUS_LABEL,
} from '@shared/labels';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { dateParts, windowPairOf, type DateParts } from '../lib/dateWords';
import { dataOf } from '../lib/records';
import { useData } from '../state/data';
import { civil, relative } from '../lib/format';
import { useOptionalSnapshot } from '../state/snapshot';
import { Icon, type IconName } from './Icon';

export function Chip({ children, tone = 'neutral', small = false, className = '' }: { children: ReactNode; tone?: 'neutral' | 'ai' | 'matcha' | 'kaki' | 'kin'; small?: boolean; className?: string }) {
  return <span className={`chip chip--${tone}${small ? ' chip--sm' : ''} ${className}`.trim()}>{children}</span>;
}

const STATUS_ICON: Record<WorkStatus, IconName> = {
  planned: 'circle',
  in_progress: 'half',
  blocked: 'stop',
  waiting_external: 'hourglass',
  completed: 'check',
  eliminated: 'x',
  not_applicable: 'dash',
};
const STATUS_TONE: Record<WorkStatus, 'neutral' | 'ai' | 'matcha' | 'kaki' | 'kin'> = {
  planned: 'neutral',
  in_progress: 'ai',
  blocked: 'kaki',
  waiting_external: 'kin',
  completed: 'matcha',
  eliminated: 'neutral',
  not_applicable: 'neutral',
};

/** Plain status word with a shape icon (never colour alone). */
export function StatusBadge({ status, small = false }: { status: string; small?: boolean }) {
  const s = status as WorkStatus;
  const label = WORK_STATUS_LABEL[s] ?? status;
  const icon = STATUS_ICON[s] ?? 'circle';
  const tone = STATUS_TONE[s] ?? 'neutral';
  return (
    <span className={`chip chip--${tone} chip--status${small ? ' chip--sm' : ''}`}>
      <Icon name={icon} size={small ? 13 : 15} />
      <span>{label}</span>
    </span>
  );
}

const KIND_ICON: Record<DeadlineKind, IconName> = {
  legal: 'flag',
  contractual: 'doc',
  user_committed: 'bookmark',
  internal_target: 'target',
  estimate: 'tilde',
  review_date: 'eye',
};

/** Deadline kind badge: legal vs contract vs our target vs estimate vs review checkpoint. */
export function DeadlineBadge({ kind, small = true }: { kind: DeadlineKind; small?: boolean }) {
  return (
    <span className={`chip chip--kind chip--kind-${kind}${small ? ' chip--sm' : ''}`}>
      <Icon name={KIND_ICON[kind] ?? 'calendar'} size={small ? 13 : 15} />
      <span>{DEADLINE_KIND_LABEL[kind] ?? kind}</span>
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority | null | undefined }) {
  if (!priority) return <span className="faint">Not set</span>;
  return <span className={`prio prio--${priority}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function OptionalTag() {
  return <span className="chip chip--neutral chip--sm chip--optional">Optional</span>;
}

/**
 * Honest verification note for rule-derived dates. Anything other than "verified_official" gets a label so a
 * legal deadline never looks more certain than its verification.
 */
export function VerificationNote({ verification, kind }: { verification: DeadlineRuleData['verification'] | null | undefined; kind?: DeadlineKind }) {
  if (!verification || verification === 'verified_official') return null;
  return (
    <span className="verify-note">
      <Icon name="info" size={14} />
      <span>
        {kind === 'legal' ? 'Rule not yet confirmed for you. ' : ''}
        {VERIFICATION_LABEL[verification]}
      </span>
    </span>
  );
}

interface DateTextProps {
  date: string | null | undefined;
  today?: string;
  state?: DeadlineState;
  /** Words before and after the date ("Due by ", " (window opens)") and the far end of a window. */
  prefix?: string;
  suffix?: string;
  endDate?: string | null;
  /** Shown instead of "Awaiting date" (for example a repeating rule). */
  emptyText?: string | null;
  /** Weekend or holiday advice from the engine, shown exactly as given. */
  advice?: string | null;
  /** Accepts a deadline kind for call sites that pass it; the wording comes from `prefix`. */
  kind?: DeadlineKind | null;
}

/** The date line used in lists: "Due by Thu, Nov 20 · in 22 days", or "Awaiting date". */
export function DateText({ date, today, state, prefix = '', suffix = '', endDate = null, emptyText = null, advice = null }: DateTextProps) {
  if (!date) return <span className="date-text date-text--awaiting">{emptyText ?? 'Awaiting date'}</span>;
  const historical = state === 'historical';
  const rel = today && !historical && !endDate ? relative(date, today) : null;
  const overdue = state === 'overdue';
  if (historical) {
    // A past date from a dated copy or an old record: neutral, and it says nothing about whether the thing was done.
    return (
      <span className="date-text date-text--old">
        <time dateTime={date}>{civil(date, 'short')}</time>
        <span> — {DEADLINE_STATE_LABEL.historical}</span>
      </span>
    );
  }
  return (
    <>
      <span className={`date-text${overdue ? ' date-text--past' : ''}${state === 'due_soon' || state === 'due_today' ? ' date-text--soon' : ''}`}>
        {prefix}
        <time dateTime={date}>{civil(date, 'weekday')}</time>
        {endDate && (
          <>
            {' – '}
            <time dateTime={endDate}>{civil(endDate, 'weekday')}</time>
          </>
        )}
        {suffix}
        {rel && <span className="faint"> · {rel}</span>}
        {overdue && <span className="date-flag"> · past its date</span>}
      </span>
      {advice && <span className="date-note">{advice}</span>}
    </>
  );
}

/** A computed deadline with its meaning in words (see lib/dateWords.ts) and the engine's business-day advice. */
export function DeadlineWhen({ d, today }: { d: ComputedDeadline; today?: string }) {
  const { deadlines } = useData();
  const idx = useOptionalSnapshot()?.idx;
  const rule = d.rule_id ? (idx?.byKey.get(d.rule_id) ?? idx?.byId.get(`deadline_rule:${d.rule_id}`) ?? null) : null;
  const rd = rule ? dataOf<DeadlineRuleData>(rule) : null;
  const pair = deadlines.ok ? windowPairOf(d, rd?.window_pair, deadlines.value) : null;
  const parts: DateParts = dateParts({
    bound: d.bound,
    kind: d.kind,
    date: d.deadline.date,
    pairDate: pair?.deadline.date ?? null,
    label: d.label,
    trigger: rd?.applies_when ?? null,
  });
  return (
    <DateText
      date={parts.date}
      today={today}
      state={d.state}
      prefix={parts.prefix}
      suffix={parts.suffix}
      endDate={parts.endDate}
      emptyText={parts.emptyText ?? (d.deadline.date ? null : undefined)}
      advice={d.business_day_advice ?? null}
    />
  );
}

export function DeadlineLine({ deadline, today, state }: { deadline: Deadline | null | undefined; today?: string; state?: DeadlineState }) {
  if (!deadline) return <span className="faint">No date yet</span>;
  return (
    <span className="deadline-line">
      <DateText date={deadline.date} today={today} state={state} />
      <DeadlineBadge kind={deadline.kind} />
    </span>
  );
}

export function StateWord({ state }: { state: DeadlineState }) {
  return <span className={`state-word state-word--${state}`}>{DEADLINE_STATE_LABEL[state]}</span>;
}

/** Task-list sync state for a linked task. */
export function SyncBadge({ link }: { link: TaskLink }) {
  const tone = link.sync_state === 'synced' ? 'matcha' : link.sync_state === 'error' || link.sync_state === 'conflict' ? 'kaki' : link.sync_state === 'snapshot' ? 'neutral' : 'kin';
  const icon: IconName = link.sync_state === 'synced' ? 'check' : link.sync_state === 'error' || link.sync_state === 'conflict' ? 'alert' : link.sync_state === 'snapshot' ? 'lock' : 'clock';
  return (
    <span className={`chip chip--${tone} chip--sm`}>
      <Icon name={icon} size={13} />
      <span>{SYNC_STATE_LABEL[link.sync_state] ?? link.sync_state}</span>
    </span>
  );
}
