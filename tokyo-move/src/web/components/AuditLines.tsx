import type { AuditLine } from '../lib/audit';
import { instant } from '../lib/format';
import { usePrefs } from '../state/prefs';
import { RecordLink } from './RecordLink';

/** A change feed: each sentence is itself the link to the record it is about; folded rows have no single target. */
export function AuditLines({ lines }: { lines: AuditLine[] }) {
  const { zone } = usePrefs();
  return (
    <ul className="audit-list">
      {lines.map((l) => (
        <li key={l.id} className="audit-line">
          <span className="audit-line__text">
            {l.recordId ? (
              <RecordLink id={l.recordId} className="audit-line__link">
                <strong>{l.who}</strong> {l.what}
              </RecordLink>
            ) : (
              <>
                <strong>{l.who}</strong> {l.what}
              </>
            )}
          </span>
          <time className="faint small" dateTime={l.at}>
            {instant(l.at, zone, 'short')}
          </time>
        </li>
      ))}
    </ul>
  );
}
