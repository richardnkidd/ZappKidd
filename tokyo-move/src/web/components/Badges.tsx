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
import { weekendNote } from '../lib/deadlineNotes';
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

/** The date line used in lists: "Thu, Nov 20 · in 22 days" or "Awaiting date". Legal dates add a weekend heads-up. */
export function DateText({ date, today, state, kind }: { date: string | null | undefined; today?: string; state?: DeadlineState; kind?: DeadlineKind | null }) {
  const holidays = useOptionalSnapshot()?.snapshot?.settings?.jp_holidays;
  if (!date) return <span className="date-text date-text--awaiting">Awaiting date</span>;
  const historical = state === 'historical';
  const rel = today && !historical ? relative(date, today) : null;
  const overdue = state === 'overdue';
  const note = historical ? null : weekendNote(date, kind, holidays);
  if (historical) {
    // A past date from a dated copy or an old record: neutral, and explicitly not evidence either way.
    return (
      <span className="date-text date-text--old">
        <time dateTime={date}>{civil(date, 'short')}</time>
        <span> · {DEADLINE_STATE_LABEL.historical}</span>
      </span>
    );
  }
  return (
    <>
      <span className={`date-text${overdue ? ' date-text--past' : ''}${state === 'due_soon' || state === 'due_today' ? ' date-text--soon' : ''}`}>
        <time dateTime={date}>{civil(date, 'weekday')}</time>
        {rel && <span className="faint"> · {rel}</span>}
        {overdue && <span className="date-flag"> · past its date</span>}
      </span>
      {note && <span className="date-note">{note}</span>}
    </>
  );
}

export function DeadlineLine({ deadline, today, state }: { deadline: Deadline | null | undefined; today?: string; state?: DeadlineState }) {
  if (!deadline) return <span className="faint">No date yet</span>;
  return (
    <span className="deadline-line">
      <DateText date={deadline.date} today={today} state={state} kind={deadline.kind} />
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
