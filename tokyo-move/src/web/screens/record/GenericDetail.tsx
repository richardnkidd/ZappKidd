import { useState } from 'react';
import { Link } from 'react-router';
import { DECISION_STATE_LABEL } from '@shared/labels';
import type { BaseRecord, DecisionState } from '@shared/types';
import { StatusBadge } from '../../components/Badges';
import { Button, ButtonLink } from '../../components/Controls';
import { Fact, Section } from '../../components/Layout';
import { OwnerChip } from '../../components/People';
import { LinkedKeys } from '../../components/LinkedKeys';
import { RecordLink } from '../../components/RecordLink';
import { DATA_FIELD_LABEL } from '@shared/labels';
import type { Money } from '@shared/types';
import { humanizeKey } from '../../lib/format';
import { fmtMoney } from '../../lib/money';
import type { Directory, Indexes } from '../../lib/records';
import { StatusDialog } from './dialogs';
import { TravelerProgress } from './MilestoneDetail';
import { SourceHistory } from './SourceHistory';
import { Notes } from './Notes';

const SKIP_KEYS = new Set([
  'linked_task_ids', 'source_ids', 'completion_evidence', 'traveler_progress', 'dependency_scope', 'review_note', 'approvals', 'options',
  'workstream_key', 'milestone_links', 'linked_records', 'milestone_keys', 'question_keys', 'related', 'outside_critical_path', 'parent_key',
]);
const LINK_KEYS: [string, string][] = [
  ['milestone_links', 'Linked work'],
  ['linked_records', 'Linked work'],
  ['milestone_keys', 'Plan items in this workstream'],
  ['question_keys', 'Questions in this workstream'],
];

const SNAKE = /^[a-z0-9]+(_[a-z0-9]+)+$/;

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() ? (SNAKE.test(v) ? v.replace(/_/g, ' ') : v) : null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v && typeof v === 'object' && !Array.isArray(v) && 'amount' in v && 'currency' in v) return fmtMoney(v as Money);
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
  return null;
}

/** Fallback for record types without a dedicated screen yet: plain labelled facts, never internal field names. */
const WORK_TYPES = new Set(['arrival', 'horizon']);

export function GenericDetail({ record, idx, dir }: { record: BaseRecord; idx: Indexes; dir: Directory }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const hasWorkStatus = WORK_TYPES.has(record.type);
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
      {hasWorkStatus && (
        <div>
          <Button variant="primary" icon="check" onClick={() => setStatusOpen(true)}>
            Change status
          </Button>
        </div>
      )}
      {hasWorkStatus && <TravelerProgress record={record} level={2} />}
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
              <Fact key={k} label={DATA_FIELD_LABEL[k] ?? humanizeKey(k)} wide={v.length > 80}>
                <span className="preline">{v}</span>
              </Fact>
            ))}
          </dl>
        )}
        {LINK_KEYS.map(([k, label]) => {
          const keys = (data as Record<string, unknown>)[k];
          return Array.isArray(keys) ? <LinkedKeys key={k} keys={keys.filter((x): x is string => typeof x === 'string')} idx={idx} label={label} /> : null;
        })}
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
      {hasWorkStatus && <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} record={record} currentStatus={record.status} />}
      <p className="small">
        <Link to="/plan" className="more-link">Back to the plan</Link>
      </p>
    </div>
  );
}
