import { useMemo } from 'react';
import { dependencyChain } from '@shared/readiness';
import { Icon } from '../../components/Icon';
import { RecordLink } from '../../components/RecordLink';
import { attempt } from '../../lib/safe';
import type { Indexes } from '../../lib/records';

/** "Waits on": what still has to happen before this item can (the unmet part of its dependency chain). */
export function Chain({ itemKey, idx }: { itemKey: string; idx: Indexes }) {
  const chain = useMemo(() => attempt(() => dependencyChain(itemKey, idx.all)), [itemKey, idx]);
  const links = chain.ok
    ? chain.value.filter((c) => !c.met).sort((a, b) => a.depth - b.depth)
    : (idx.milestoneByKey.get(itemKey)?.data?.dependencies ?? [])
        .map((k) => ({ key: k, title: idx.byKey.get(k)?.title ?? k, status: idx.byKey.get(k)?.status ?? '', met: false, depth: 1 }))
        .filter((c) => c.status !== 'completed');
  if (links.length === 0) return null;
  return (
    <div className="chain">
      <span className="chain__label">Waits on</span>
      <ol className="chain__list">
        {links.map((c, i) => {
          const rec = idx.byKey.get(c.key);
          return (
            <li key={c.key}>
              {i > 0 && <Icon name="arrow-right" size={14} className="chain__arrow" />}
              {rec ? <RecordLink id={rec.id}>{c.title}</RecordLink> : c.title}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
