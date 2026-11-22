import type { CSSProperties, ReactNode } from 'react';
import type { DeadlineState } from '@shared/engine-contracts';
import type { DeadlineKind, OwnerRef } from '@shared/types';
import type { WhenCandidate, WhenInfo } from '../lib/when';
import { DateText, DeadlineBadge, DeadlineWhen, StatusBadge, YourTurnChip } from './Badges';
import { OwnerChip, usePlain } from './People';
import { RecordLink } from './RecordLink';

export interface ItemCardProps {
  recordId: string | null;
  title: string;
  owner: OwnerRef | null;
  ownerProposed?: boolean;
  nextAction?: string | null;
  /** Cut the next step to this many lines (default 2). The full text is on the record page. */
  clampAction?: number;
  status?: string | null;
  /** Show the status as a small icon with hidden words in the meta line. Off by default. */
  showStatus?: boolean;
  /** The one date this card shows. Other dates live on the record's own page. */
  when?: WhenInfo;
  /** Legacy single date (used by callers that have no WhenInfo). */
  date?: string | null;
  dateKind?: DeadlineKind | null;
  dateState?: DeadlineState | null;
  today?: string;
  optional?: boolean;
  note?: string | null;
  children?: ReactNode;
  tone?: 'default' | 'blocked' | 'attention';
  className?: string;
  /**
   * It is this person's turn: the one chip a card may carry (solid indigo). Pass a string to change the words
   * (default "Your turn").
   */
  turn?: boolean | string;
  /**
   * `quiet` (default): slim card, no chips. `full`: the old look, with status, deadline kind and owner as chips.
   * Deprecated: kept so a screen that needs the full chips can say so.
   */
  variant?: 'quiet' | 'full';
}

function WhenLine({ c, today, full }: { c: WhenCandidate; today?: string; full: boolean }) {
  return (
    <span className="item__when">
      {c.deadline ? <DeadlineWhen d={c.deadline} today={today} /> : <DateText date={c.date} today={today} state={c.state ?? undefined} />}
      {c.kind === 'task' ? (
        full ? (
          <span className="chip chip--neutral chip--sm">Task-list date</span>
        ) : (
          <span className="faint item__src">Task list</span>
        )
      ) : (
        <DeadlineBadge kind={c.kind} variant={full ? 'chip' : 'quiet'} />
      )}
    </span>
  );
}

/**
 * One slim card in a list, three lines at most:
 *   1. the title (the biggest thing on the card, a link; the whole card is clickable)
 *   2. the next step, cut to two lines
 *   3. one meta line: the date on the left (coloured only when late or soon), the person on the right
 * No inner borders and no labels. Status, deadline kind and owner are quiet by default (icon or plain text).
 */
export function ItemCard(p: ItemCardProps) {
  const plain = usePlain();
  const full = p.variant === 'full';
  const primary = p.when?.primary ?? null;
  const lines = p.clampAction ?? 2;
  const date = primary ? (
    <WhenLine c={primary} today={p.today} full={full} />
  ) : p.when ? (
    <span className="faint item__nodate">No date of our own yet</span>
  ) : p.date !== undefined || p.dateKind ? (
    <span className="item__when">
      <DateText date={p.date} today={p.today} state={p.dateState ?? undefined} />
      {p.dateKind && <DeadlineBadge kind={p.dateKind} variant={full ? 'chip' : 'quiet'} />}
    </span>
  ) : null;
  return (
    <li className={`item item--card item--${p.tone ?? 'default'} ${p.className ?? ''}`.trim()}>
      <div className="item__main">
        <div className="item__head">
          {p.recordId ? (
            <RecordLink id={p.recordId} className="item__title">
              {p.title}
            </RecordLink>
          ) : (
            <span className="item__title">{p.title}</span>
          )}
          {p.turn && <YourTurnChip small>{typeof p.turn === 'string' ? p.turn : 'Your turn'}</YourTurnChip>}
        </div>
        {p.nextAction && (
          <p className="item__action item__action--clamp preline" style={{ '--clamp-lines': lines } as CSSProperties}>
            {plain(p.nextAction)}
          </p>
        )}
        {p.children}
        <div className="item__meta">
          <span className="item__meta-start">
            {p.showStatus && p.status && <StatusBadge status={p.status} small variant={full ? 'chip' : 'quiet'} />}
            {date}
            {p.optional && <span className="faint item__src">Optional</span>}
            {p.note && <span className="faint">{p.note}</span>}
          </span>
          <OwnerChip owner={p.owner} proposed={p.ownerProposed} compact variant={full ? 'chip' : 'quiet'} />
        </div>
      </div>
    </li>
  );
}
