import { useMemo, useState } from 'react';
import { RAID_KIND_LABEL, SEVERITY_LABEL, SEVERITY_ORDER } from '@shared/labels';
import type { RiskData } from '@shared/types';
import { FilterChips } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Icon } from '../../components/Icon';
import { Card, EmptyState } from '../../components/Layout';
import { OwnerChip } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import type { Indexes, Risk } from '../../lib/records';

type KindFilter = 'all' | RiskData['raid_kind'];

function sevTone(s: RiskData['severity'] | undefined): 'kaki' | 'kin' | 'neutral' {
  return s === 'critical' || s === 'high' ? 'kaki' : s === 'medium' ? 'kin' : 'neutral';
}

function RiskCard({ r, idx }: { r: Risk; idx: Indexes }) {
  const d = r.data;
  const sev = d?.severity;
  const closed = r.status === 'completed' || r.status === 'eliminated' || r.status === 'closed';
  return (
    <li>
      <Card as="article" aria-labelledby={`risk-${r.key}`} tone={sev === 'critical' ? 'blocked' : sev === 'high' ? 'attention' : 'default'}>
        <div className="item__meta">
          <span className={`chip chip--${sevTone(sev)} chip--sm`}>
            <Icon name={sev === 'low' ? 'info' : 'alert'} size={13} />
            <span>{sev ? `${SEVERITY_LABEL[sev]} severity` : 'Severity not set'}</span>
          </span>
          <span className="chip chip--neutral chip--sm">{d?.raid_kind ? RAID_KIND_LABEL[d.raid_kind] : 'Risk'}</span>
          <OwnerChip owner={r.owner} proposed={r.owner_proposed} compact />
          {closed && <span className="chip chip--matcha chip--sm">Closed</span>}
        </div>
        <h3 id={`risk-${r.key}`} className="risk__title">
          {r.title}
        </h3>
        <dl className="facts facts--tight">
          {d?.trigger && (
            <div className="fact fact--wide">
              <dt>What would set it off</dt>
              <dd className="preline">{d.trigger}</dd>
            </div>
          )}
          {d?.mitigation && (
            <div className="fact fact--wide">
              <dt>What we’d do</dt>
              <dd className="preline">{d.mitigation}</dd>
            </div>
          )}
          {d?.fallback && (
            <div className="fact fact--wide">
              <dt>If that doesn’t work</dt>
              <dd className="preline">{d.fallback}</dd>
            </div>
          )}
          {d?.escalation_trigger && (
            <div className="fact fact--wide">
              <dt>Raise it with a professional or each other when</dt>
              <dd className="preline">{d.escalation_trigger}</dd>
            </div>
          )}
        </dl>
        {(d?.linked_records ?? []).length > 0 && (
          <p className="small muted">
            Related work:{' '}
            {d!.linked_records.map((k, i) => {
              const rec = idx.byKey.get(k);
              return (
                <span key={k}>
                  {i > 0 && ', '}
                  {rec ? <RecordLink id={rec.id}>{rec.title}</RecordLink> : k}
                </span>
              );
            })}
          </p>
        )}
      </Card>
    </li>
  );
}

export function RisksTab() {
  return <DataGate>{({ idx }) => <Risks idx={idx} />}</DataGate>;
}

function Risks({ idx }: { idx: Indexes }) {
  const [kind, setKind] = useState<KindFilter>('all');
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of idx.risks) c[r.data?.raid_kind ?? 'risk'] = (c[r.data?.raid_kind ?? 'risk'] ?? 0) + 1;
    return c;
  }, [idx]);
  const list = useMemo(() => {
    const rank = (r: Risk) => {
      const i = SEVERITY_ORDER.indexOf(r.data?.severity ?? 'low');
      return i < 0 ? 99 : i;
    };
    return idx.risks
      .filter((r) => kind === 'all' || (r.data?.raid_kind ?? 'risk') === kind)
      .sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [idx, kind]);

  return (
    <div className="stack">
      <h2 className="visually-hidden">Risks and issues</h2>
      <p className="muted">
        A short list of what could go wrong or is being assumed, who is watching it, and what we’d do. Most severe first.
      </p>
      <FilterChips
        label="Kind of item"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'all', label: 'All', count: idx.risks.length },
          ...(['risk', 'assumption', 'issue', 'dependency'] as const).map((k) => ({ value: k as KindFilter, label: RAID_KIND_LABEL[k], count: counts[k] ?? 0 })),
        ]}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon="shield" title="Nothing here." />
        </Card>
      ) : (
        <ul className="stack">
          {list.map((r) => (
            <RiskCard key={r.id} r={r} idx={idx} />
          ))}
        </ul>
      )}
    </div>
  );
}
