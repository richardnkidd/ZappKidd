import type { ReactNode } from 'react';
import type { DeadlineState } from '@shared/engine-contracts';
import type { DeadlineKind, OwnerRef } from '@shared/types';
import type { WhenCandidate, WhenInfo } from '../lib/when';
import { DateText, DeadlineBadge, DeadlineWhen, OptionalTag, StatusBadge } from './Badges';
import { OwnerChip, usePlain } from './People';
import { RecordLink } from './RecordLink';

export interface ItemCardProps {
  recordId: string | null;
  title: string;
  owner: OwnerRef | null;
  ownerProposed?: boolean;
  nextAction?: string | null;
  status?: string | null;
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
  /** Clamp long next-action text to three lines with a More toggle (arrival screens). */
  className?: string;
}

function WhenLine({ c, today }: { c: WhenCandidate; today?: string }) {
  return (
    <span className="item__when">
      {c.deadline ? (
        <DeadlineWhen d={c.deadline} today={today} />
      ) : (
        <DateText date={c.date} today={today} state={c.state ?? undefined} />
      )}
      {c.kind === 'task' ? <span className="chip chip--neutral chip--sm">Task-list date</span> : <DeadlineBadge kind={c.kind} />}
    </span>
  );
}

/** One row/card in a list: title (the link), next action, owner, and ONE date. The whole card is clickable. */
export function ItemCard(p: ItemCardProps) {
  const plain = usePlain();
  const primary = p.when?.primary ?? null;
  return (
    <li className={`item item--${p.tone ?? 'default'} ${p.className ?? ''}`.trim()}>
      <div className="item__main">
        {p.recordId ? (
          <RecordLink id={p.recordId} className="item__title">
            {p.title}
          </RecordLink>
        ) : (
          <span className="item__title">{p.title}</span>
        )}
        {p.nextAction && (
          <p className="item__action preline">
            <span className="item__label">Next</span> {plain(p.nextAction)}
          </p>
        )}
        {p.children}
        <div className="item__meta">
          <OwnerChip owner={p.owner} proposed={p.ownerProposed} compact />
          {p.showStatus && p.status && <StatusBadge status={p.status} small />}
          {primary ? (
            <WhenLine c={primary} today={p.today} />
          ) : p.when ? (
            <span className="faint small">No date of our own yet</span>
          ) : p.date !== undefined || p.dateKind ? (
            <span className="item__when">
              <DateText date={p.date} today={p.today} state={p.dateState ?? undefined} />
              {p.dateKind && <DeadlineBadge kind={p.dateKind} />}
            </span>
          ) : null}
          {p.optional && <OptionalTag />}
          {p.note && <span className="faint small">{p.note}</span>}
        </div>
      </div>
    </li>
  );
}
