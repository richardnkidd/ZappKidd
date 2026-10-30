import { Link } from 'react-router';
import { READINESS_SHORT_LABEL, READINESS_STATE_LABEL } from '@shared/labels';
import { ErrorBanner } from '../../components/Feedback';
import { PersonBadge } from '../../components/People';
import type { Directory } from '../../lib/records';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { readinessTone } from '../ready/readyBits';

/** One row of readiness chips under the greeting on phones; each opens that traveler's full page. */
export function ReadyStrip({ dir }: { dir: Directory }) {
  const { readiness } = useData();
  const { refresh } = useSnapshot();
  if (!readiness.ok) {
    return (
      <ErrorBanner title="We couldn't work out who is ready just now." onRetry={() => void refresh()}>
        Everything else on this page still works.
      </ErrorBanner>
    );
  }
  if (readiness.value.length === 0) return null;
  return (
    <nav aria-label="Who’s ready" className="ready-strip">
      <ul className="ready-chips">
        {readiness.value.map((r) => {
          const { tone } = readinessTone(r.state);
          const name = dir.nameOf(r.person_id);
          return (
            <li key={r.person_id}>
              <Link
                to={`/ready/${encodeURIComponent(r.person_id)}`}
                className={`ready-chip ready-chip--${tone}`}
                aria-label={`${name}: ${READINESS_STATE_LABEL[r.state]}. Open readiness`}
              >
                <PersonBadge person={dir.personById(r.person_id)} size={26} />
                <span className="ready-chip__text">
                  <span className="ready-chip__name">{name}</span>
                  <span className="ready-chip__state">{READINESS_SHORT_LABEL[r.state] ?? r.state}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
