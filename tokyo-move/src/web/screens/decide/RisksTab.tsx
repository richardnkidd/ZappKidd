import { useId, useMemo, useState } from 'react';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '@shared/labels';
import { displaySummary, displayTitle, keyLookup, stripCodes, type KeyLookup } from '@shared/plain';
import type { RiskData } from '@shared/types';
import { Button } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Icon, type IconName } from '../../components/Icon';
import { EmptyState } from '../../components/Layout';
import { More } from '../../components/More';
import { useDir } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import type { Indexes, Risk } from '../../lib/records';

/** Per list, it starts short. */
export const RISKS_SHOWN_FIRST = 8;

type Level = RiskData['severity'];

/** A different shape for each level, so seriousness never depends on colour. */
const LEVEL: Record<Level, { icon: IconName; text: string }> = {
  critical: { icon: 'stop', text: 'Critical' },
  high: { icon: 'alert', text: 'High' },
  medium: { icon: 'flag', text: 'Medium' },
  low: { icon: 'info', text: 'Low' },
};

/** Most serious first, then by the name shown. Anything without a level goes last. */
export function sortRisks(risks: readonly Risk[], lookup?: KeyLookup): Risk[] {
  const rank = (r: Risk) => {
    const i = SEVERITY_ORDER.indexOf(r.data?.severity ?? ('' as Level));
    return i < 0 ? SEVERITY_ORDER.length : i;
  };
  return [...risks].sort((a, b) => rank(a) - rank(b) || displayTitle(a, lookup).localeCompare(displayTitle(b, lookup), undefined, { numeric: true }));
}

function Seriousness({ level }: { level: Level | undefined }) {
  const l = level ? LEVEL[level] : null;
  return (
    <span className={`risk__level${level ? ` risk__level--${level}` : ''}`} role="img" aria-label={l ? `${SEVERITY_LABEL[level!]} risk` : 'Seriousness not set'} title={l ? `${l.text} risk` : 'Seriousness not set'}>
      <Icon name={l?.icon ?? 'dash'} size={18} />
    </span>
  );
}

function Detail({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="qrow__detail">
      <p className="qrow__label">{label}</p>
      <p className="preline">{text}</p>
    </div>
  );
}

export function RiskCard({ r, idx }: { r: Risk; idx: Indexes }) {
  const dir = useDir();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const d = r.data;
  const summary = displaySummary(r);
  const owner = !r.owner || r.owner === 'unassigned' ? null : dir.ownerLabel(r.owner);
  const linked = (d?.linked_records ?? []).map((k) => idx.byKey.get(k)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const hasDetails = Boolean(d?.trigger || d?.mitigation || d?.fallback || d?.escalation_trigger || owner || linked.length);
  return (
    <li className="risk">
      <div className="risk__line">
        <Seriousness level={d?.severity} />
        <h3 className="risk__title">{displayTitle(r, lookup)}</h3>
      </div>
      {summary && <p className="risk__summary muted">{summary}</p>}
      {hasDetails && (
        <More label="Details" className="risk__more">
          <Detail label="Warning sign" text={stripCodes(d?.trigger, lookup)} />
          <Detail label="Our plan" text={stripCodes(d?.mitigation, lookup)} />
          <Detail label="Backup" text={stripCodes(d?.fallback, lookup)} />
          <Detail label="Escalate if" text={stripCodes(d?.escalation_trigger, lookup)} />
          {owner && (
            <p>
              <span className="qrow__label">Owner: </span>
              {owner}
            </p>
          )}
          {linked.length > 0 && (
            <p>
              <span className="qrow__label">Related: </span>
              {linked.map((rec, i) => (
                <span key={rec.id}>
                  {i > 0 && ', '}
                  <RecordLink id={rec.id}>{displayTitle(rec, lookup)}</RecordLink>
                </span>
              ))}
            </p>
          )}
        </More>
      )}
    </li>
  );
}

export function RisksTab() {
  return <DataGate>{({ idx }) => <Risks idx={idx} />}</DataGate>;
}

function Risks({ idx }: { idx: Indexes }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const list = useMemo(() => sortRisks(idx.risks, lookup), [idx.risks, lookup]);
  const visible = expanded ? list : list.slice(0, RISKS_SHOWN_FIRST);

  return (
    <div className="qtab">
      <h2 className="visually-hidden">Risks</h2>
      {list.length === 0 ? (
        <EmptyState icon="shield" title="No risks listed." />
      ) : (
        <>
          <ul id={listId} className="qlist">
            {visible.map((r) => (
              <RiskCard key={r.id} r={r} idx={idx} />
            ))}
          </ul>
          {list.length > RISKS_SHOWN_FIRST && (
            <div>
              <Button variant="quiet" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Show fewer' : `Show all (${list.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
