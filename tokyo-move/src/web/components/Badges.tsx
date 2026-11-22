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
import { civil } from '../lib/format';
import { dateLine } from '../lib/dateLine';
import { useOptionalSnapshot } from '../state/snapshot';
import { Icon, type IconName } from './Icon';
import { InfoNote } from './InfoNote';

export function Chip({ children, tone = 'neutral', small = false, className = '' }: { children: ReactNode; tone?: 'neutral' | 'ai' | 'matcha' | 'kaki' | 'kin' | 'turn'; small?: boolean; className?: string }) {
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

/** The one chip a card may carry: whose turn it is. Solid indigo with on-indigo text. */
export function YourTurnChip({ children = 'Your turn', small = false }: { children?: ReactNode; small?: boolean }) {
  return (
    <span className={`chip chip--turn${small ? ' chip--sm' : ''}`}>
      <Icon name="arrow-right" size={small ? 14 : 16} />
      <span>{children}</span>
    </span>
  );
}

/**
 * Status as a small shape icon with its words for screen readers (and as a hover title). Never colour alone.
 * `variant="chip"` brings back the old pill with the visible word, for a screen that really needs it.
 */
export function StatusBadge({ status, small = false, variant = 'quiet', showLabel = !small }: { status: string; small?: boolean; variant?: 'quiet' | 'chip'; showLabel?: boolean }) {
  const s = status as WorkStatus;
  const label = WORK_STATUS_LABEL[s] ?? status;
  const icon = STATUS_ICON[s] ?? 'circle';
  const tone = STATUS_TONE[s] ?? 'neutral';
  if (variant === 'chip') {
    return (
      <span className={`chip chip--${tone} chip--status${small ? ' chip--sm' : ''}`}>
        <Icon name={icon} size={small ? 14 : 16} />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className={`status-icon status-icon--${tone}`} title={label}>
      <Icon name={icon} size={18} />
      <span className={showLabel ? 'status-icon__label' : 'visually-hidden'}>{label}</span>
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

/** Only dates that carry a rule outside the household get a mark: a legal deadline or a contract date. */
export const FLAGGED_KINDS: readonly DeadlineKind[] = ['legal', 'contractual'];

/**
 * Deadline kind. Quiet (default): a small flag icon with the kind in words for screen readers, and only for legal and
 * contract dates; the household's own dates show nothing (a check-in keeps the plain word "Check-in", so it never reads
 * as a deadline). In a flex row the flag sits before the date (`order: -1`).
 * `variant="chip"` is the full labelled chip for every kind.
 */
export function DeadlineBadge({ kind, small = true, variant = 'quiet' }: { kind: DeadlineKind; small?: boolean; variant?: 'quiet' | 'chip' }) {
  if (variant === 'chip') {
    return (
      <span className={`chip chip--kind chip--kind-${kind}${small ? ' chip--sm' : ''}`}>
        <Icon name={KIND_ICON[kind] ?? 'calendar'} size={small ? 14 : 16} />
        <span>{DEADLINE_KIND_LABEL[kind] ?? kind}</span>
      </span>
    );
  }
  // A check-in is never a deadline, so it keeps its word (plain text, no pill); the household's own dates show nothing.
  if (kind === 'review_date') return <span className="kind-word">{DEADLINE_KIND_LABEL[kind]}</span>;
  if (!FLAGGED_KINDS.includes(kind)) return null;
  const label = DEADLINE_KIND_LABEL[kind] ?? kind;
  return (
    <span className={`kind-flag kind-flag--${kind}`} title={label}>
      <Icon name="flag" size={16} />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority | null | undefined }) {
  if (!priority) return <span className="faint">Not set</span>;
  return <span className={`prio prio--${priority}`}>{PRIORITY_LABEL[priority]}</span>;
}

/** "Optional" as quiet text (not a pill). Pass `variant="chip"` for the old chip. */
export function OptionalTag({ variant = 'quiet' }: { variant?: 'quiet' | 'chip' }) {
  if (variant === 'chip') return <span className="chip chip--neutral chip--sm chip--optional">Optional</span>;
  return <span className="optional-text">Optional</span>;
}

/** The full wording of a verification note (used in the info control and by `variant="full"`). */
export function verificationText(verification: NonNullable<DeadlineRuleData['verification']>, kind?: DeadlineKind): string {
  return `${kind === 'legal' ? 'Rule not yet confirmed for you. ' : ''}${VERIFICATION_LABEL[verification]}`;
}

/**
 * Honest verification note for rule-derived dates. Anything other than "verified_official" is marked so a legal
 * deadline never looks more certain than its verification. Short form (default): "Not checked yet" and an info button
 * that reveals the full wording. `variant="full"` prints the full sentence (the record page can use it).
 */
export function VerificationNote({ verification, kind, variant = 'short' }: { verification: DeadlineRuleData['verification'] | null | undefined; kind?: DeadlineKind; variant?: 'short' | 'full' }) {
  if (!verification || verification === 'verified_official') return null;
  const full = verificationText(verification, kind);
  if (variant === 'full') {
    return (
      <span className="verify-note">
        <Icon name="info" size={16} />
        <span>{full}</span>
      </span>
    );
  }
  return (
    <span className="verify-note verify-note--short">
      <span className="verify-note__text">Not checked yet</span>
      <InfoNote label="About this date check">{full}</InfoNote>
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
  /** Weekend or holiday advice from the engine, shown exactly as given, behind a small info button. */
  advice?: string | null;
  /** Accepts a deadline kind for call sites that pass it; the wording comes from `prefix`. */
  kind?: DeadlineKind | null;
  /** Print the advice as a sentence under the date (the old behaviour) instead of behind the info button. */
  adviceInline?: boolean;
}

// Words that may stay in front of "Today" / "Tomorrow" ("Due by today"); any other prefix is dropped there.
const KEEPS_PREFIX = /\b(by|before|since)\s$/i;

/**
 * The date line used in lists, in the one shared format (lib/dateLine.ts):
 * "Mon, Nov 30 (8 days)", "Today", "Tomorrow", "11 days late". A past date on an open item reads "N days late".
 * Holiday and weekend advice sits behind a small info button after the date.
 */
export function DateText({ date, today, state, prefix = '', suffix = '', endDate = null, emptyText = null, advice = null, adviceInline = false }: DateTextProps) {
  if (!date) return <span className="date-text date-text--awaiting">{emptyText ?? 'Awaiting date'}</span>;
  if (state === 'historical') {
    // A past date from a dated copy or an old record: neutral, and it says nothing about whether the thing was done.
    return (
      <span className="date-text date-text--old">
        <time dateTime={date}>{civil(date, 'short')}</time>
        <span> — {DEADLINE_STATE_LABEL.historical}</span>
      </span>
    );
  }
  // "N days late" only where the date is a due date still open: the engine says overdue, or there is no state and no
  // "not before / on / since" wording that would make a past date mean something else.
  const open = state === 'overdue' || (state === undefined && (prefix === '' || /^due by\s*$/i.test(prefix)));
  let line = !endDate && today ? dateLine(date, today, { open }) : null;
  // A date that already carries a bracketed note ("(window opens)") keeps one bracket only: no distance.
  if (line?.when === 'future' && suffix) line = { ...line, text: line.dateText, when: 'plain' };
  const late = line?.when === 'late';
  const near = line?.when === 'today' || line?.when === 'tomorrow';
  const soon = state === 'due_soon' || state === 'due_today';
  const shownPrefix = near && !KEEPS_PREFIX.test(prefix) ? '' : late ? '' : prefix;
  const lower = shownPrefix !== '' && near;
  const adviceNode = advice ? adviceInline ? <span className="date-note">{advice}</span> : <InfoNote label="About this date">{advice}</InfoNote> : null;
  return (
    <>
      <span className={`date-text${late || state === 'overdue' ? ' date-text--past' : ''}${soon ? ' date-text--soon' : ''}`}>
        {shownPrefix}
        {line ? (
          <time dateTime={date}>
            {lower ? line.text.toLowerCase() : line.text}
            {late && <span className="visually-hidden"> (was {line.dateText})</span>}
          </time>
        ) : (
          <>
            <time dateTime={date}>{civil(date, 'weekday')}</time>
            {endDate && (
              <>
                {' – '}
                <time dateTime={endDate}>{civil(endDate, 'weekday')}</time>
              </>
            )}
          </>
        )}
        {suffix}
      </span>
      {adviceNode}
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

const SYNC_SHORT: Record<string, string> = {
  synced: 'Up to date',
  snapshot: 'Read-only copy',
  pending_capture: 'Waiting to be added',
  pending_update: 'Change waiting to reach your task list',
  error: "Couldn't reach your task list",
  conflict: 'Changed in two places',
};

/** Task-list sync state for a linked task. A proposal that has not been added is amber "Waiting to be added". */
export function SyncBadge({ link }: { link: TaskLink }) {
  const tone = link.sync_state === 'synced' ? 'matcha' : link.sync_state === 'error' || link.sync_state === 'conflict' ? 'kaki' : link.sync_state === 'snapshot' ? 'neutral' : 'kin';
  const icon: IconName = link.sync_state === 'synced' ? 'check' : link.sync_state === 'error' || link.sync_state === 'conflict' ? 'alert' : link.sync_state === 'snapshot' ? 'lock' : 'clock';
  return (
    <span className={`chip chip--${tone} chip--sm`}>
      <Icon name={icon} size={13} />
      <span>{SYNC_SHORT[link.sync_state] ?? SYNC_STATE_LABEL[link.sync_state] ?? link.sync_state}</span>
    </span>
  );
}
