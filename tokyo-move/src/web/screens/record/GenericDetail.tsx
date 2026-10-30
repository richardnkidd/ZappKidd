import { Link } from 'react-router';
import { DECISION_STATE_LABEL } from '@shared/labels';
import type { BaseRecord, DecisionState } from '@shared/types';
import { StatusBadge } from '../../components/Badges';
import { ButtonLink } from '../../components/Controls';
import { Fact, Section } from '../../components/Layout';
import { OwnerChip } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { humanizeKey } from '../../lib/format';
import type { Directory, Indexes } from '../../lib/records';
import { SourceHistory } from './SourceHistory';
import { Notes } from './Notes';

const SKIP_KEYS = new Set(['linked_task_ids', 'source_ids', 'completion_evidence', 'traveler_progress', 'dependency_scope', 'review_note', 'approvals', 'options']);

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() ? v : null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
  return null;
}

/** Fallback for record types without a dedicated screen yet: plain labelled facts, never internal field names. */
export function GenericDetail({ record, idx, dir }: { record: BaseRecord; idx: Indexes; dir: Directory }) {
  const data = (record.data ?? {}) as Record<string, unknown>;
  const rows = Object.entries(data)
    .filter(([k]) => !SKIP_KEYS.has(k))
    .map(([k, v]) => [k, scalar(v)] as const)
    .filter((r): r is readonly [string, string] => r[1] !== null);
  const linkTo =
    record.type === 'decision'
      ? { to: `/decide#decision-${record.key}`, label: 'Open in Decide' }
      : record.type === 'risk'
        ? { to: '/decide/risks', label: 'Open risks and issues' }
        : record.type === 'question'
          ? { to: '/decide/questions', label: 'Open questions' }
          : null;
  const statusLabel = record.type === 'decision' ? (DECISION_STATE_LABEL[record.status as DecisionState] ?? record.status) : null;
  const related = Array.isArray((data as { related?: unknown }).related) ? ((data as { related: unknown[] }).related.filter((x) => typeof x === 'string') as string[]) : [];
  return (
    <div className="record stack stack--loose">
      <div className="item__meta">
        {statusLabel ? <span className="chip chip--ai">{statusLabel}</span> : <StatusBadge status={record.status} />}
        <OwnerChip owner={record.owner} proposed={record.owner_proposed} />
      </div>
      {linkTo && (
        <div>
          <ButtonLink to={linkTo.to} variant="secondary" icon="arrow-right">
            {linkTo.label}
          </ButtonLink>
        </div>
      )}
      <Section title="Details" headingLevel={2}>
        {rows.length === 0 ? (
          <p className="muted">There are no more details to show.</p>
        ) : (
          <dl className="facts">
            {rows.map(([k, v]) => (
              <Fact key={k} label={humanizeKey(k)} wide={v.length > 80}>
                <span className="preline">{v}</span>
              </Fact>
            ))}
          </dl>
        )}
        {related.length > 0 && (
          <p className="small muted">
            Related (nothing waits on these):{' '}
            {related.map((k, i) => {
              const r = idx.byKey.get(k);
              return (
                <span key={k}>
                  {i > 0 && ', '}
                  {r ? <RecordLink id={r.id}>{r.title}</RecordLink> : k}
                </span>
              );
            })}
          </p>
        )}
      </Section>
      <Notes record={record} idx={idx} dir={dir} />
      <SourceHistory record={record} idx={idx} dir={dir} />
      <p className="small">
        <Link to="/plan">Back to the plan</Link>
      </p>
    </div>
  );
}
