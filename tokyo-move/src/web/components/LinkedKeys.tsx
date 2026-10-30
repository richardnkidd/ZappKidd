import { Fragment } from 'react';
import type { Indexes } from '../lib/records';
import { RecordLink } from './RecordLink';

/** "Related: Title, Title" from record keys. Unknown keys are skipped (they are reported on the Data screen). */
export function LinkedKeys({ keys, idx, label = 'Related' }: { keys: readonly string[] | undefined; idx: Indexes; label?: string }) {
  const found = (keys ?? []).map((k) => idx.byKey.get(k)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (found.length === 0) return null;
  return (
    <p className="small muted linked-keys">
      {label}:{' '}
      {found.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 && ', '}
          <RecordLink id={r.id}>{r.title}</RecordLink>
        </Fragment>
      ))}
    </p>
  );
}
