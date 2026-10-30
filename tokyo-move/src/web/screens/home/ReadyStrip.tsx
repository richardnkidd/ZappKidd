import { Link } from 'react-router';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { PersonBadge, usePlain } from '../../components/People';
import type { Directory } from '../../lib/records';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { ReadinessChip } from '../ready/readyBits';

/** Compact readiness: one tappable row per traveler, shown right under the greeting on phones. */
export function ReadyStrip({ dir }: { dir: Directory }) {
  const { readiness } = useData();
  const { refresh } = useSnapshot();
  const plain = usePlain();
  if (!readiness.ok) {
    return (
      <ErrorBanner title="We couldn't work out who is ready just now." onRetry={() => void refresh()}>
        Everything else on this page still works.
      </ErrorBanner>
    );
  }
  if (readiness.value.length === 0) return null;
  return (
    <section aria-labelledby="ready-strip-title" className="ready-strip">
      <h2 id="ready-strip-title" className="ready-strip__title">
        Who’s ready
      </h2>
      <ul className="ready-strip__list">
        {readiness.value.map((r) => (
          <li key={r.person_id}>
            <Link to={`/ready/${encodeURIComponent(r.person_id)}`} className="ready-row">
              <PersonBadge person={dir.personById(r.person_id)} size={32} />
              <span className="ready-row__text">
                <span className="ready-row__top">
                  <span className="ready-row__name">{dir.nameOf(r.person_id)}</span>
                  <ReadinessChip state={r.state} />
                </span>
                <span className="ready-row__headline">{plain(r.headline)}</span>
              </span>
              <Icon name="chevron-right" size={18} className="ready-row__go" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
