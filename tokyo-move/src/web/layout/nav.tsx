import { Link, useLocation } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { hasOptionalFuture } from '../lib/records';
import { useMemo } from 'react';
import { countMyTurn, type TurnBadge } from '../lib/turn';
import { decideBadge } from '../screens/decide/decisionText';
import { useData } from '../state/data';
import { useLoaded } from '../state/snapshot';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  match: (path: string) => boolean;
}

export const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', match: (p) => p === '/' || p.startsWith('/ready') },
  { to: '/plan', label: 'Plan', icon: 'plan', match: (p) => p.startsWith('/plan') },
  { to: '/decide', label: 'Decide', icon: 'decide', match: (p) => p.startsWith('/decide') },
  { to: '/money', label: 'Money', icon: 'money', match: (p) => p.startsWith('/money') },
  {
    to: '/more',
    label: 'More',
    icon: 'more',
    match: (p) => ['/more', '/documents', '/contacts', '/arrival', '/future', '/data', '/settings', '/review', '/what-if'].some((x) => p.startsWith(x)),
  },
];

export const MORE_NAV: { to: string; label: string; icon: IconName; blurb: string }[] = [
  { to: '/documents', label: 'Documents', icon: 'doc', blurb: 'Papers we need' },
  { to: '/contacts', label: 'Contacts & evidence', icon: 'contacts', blurb: 'People and sources' },
  { to: '/arrival', label: 'Arrival & living in Tokyo', icon: 'plane', blurb: 'After landing' },
  { to: '/review', label: 'Couple review', icon: 'compass', blurb: 'Look at it together' },
  { to: '/what-if', label: 'What if the pet arrives later?', icon: 'plane', blurb: 'Try other dates' },
  { to: '/arrival-pack', label: 'Printable arrival pack', icon: 'file', blurb: 'One page each' },
  { to: '/future', label: 'Future work', icon: 'sprout', blurb: 'Ideas for later' },
  { to: '/data', label: 'Data & imports', icon: 'database', blurb: 'Where the plan came from' },
  { to: '/settings', label: 'Settings', icon: 'gear', blurb: 'Dates and display' },
];

/** How many decisions are my turn in all (Home's "Your turn" uses the same rule). */
export function useMyTurnCount(): number {
  const loaded = useLoaded();
  if (!loaded) return 0;
  return countMyTurn(loaded.idx.decisions, loaded.dir.me?.id ?? null);
}

/**
 * The Decide badge: decisions that are my turn AND are needed within 14 days or my partner already chose. When that is
 * 0 but other decisions are my turn, `mine` is above 0 and the tab shows a dot. The bottom navigation and the
 * Decisions tab on the Decide screen both use this, so they always agree.
 */
export function useDecideBadge(): TurnBadge {
  const loaded = useLoaded();
  const { today } = useData();
  return useMemo(() => (loaded ? decideBadge(loaded.idx.decisions, loaded.dir.me?.id ?? null, loaded.dir, today) : { count: 0, mine: 0 }), [loaded?.idx, loaded?.dir, today]);
}

/** The accessible words for the badge, after the tab's name: ", 2 need you" or ", some need you later". */
export function badgeWords(b: TurnBadge): string {
  if (b.count > 0) return `, ${b.count} ${b.count === 1 ? 'needs' : 'need'} you`;
  if (b.mine > 0) return ', some need you later';
  return '';
}

/** The "More" places, without Future work while the plan holds no optional future items. */
export function useMoreNav(): typeof MORE_NAV {
  const loaded = useLoaded();
  return loaded && hasOptionalFuture(loaded.idx) ? MORE_NAV : MORE_NAV.filter((item) => item.to !== '/future');
}

export function MainNav() {
  const moreNav = useMoreNav();
  const badge = useDecideBadge();
  const { pathname, state } = useLocation();
  // A record opened from somewhere keeps that place highlighted; one opened directly highlights nothing.
  const from = (state as { backgroundLocation?: { pathname?: string } } | null)?.backgroundLocation?.pathname ?? null;
  return (
    <nav className="app-nav" aria-label="Main">
      <Link to="/" className="nav-brand" aria-label="Kadode home">
        <span className="wordmark">Kadode</span>
        <span className="wordmark-jp" lang="ja">門出</span>
      </Link>
      <ul className="app-nav__list">
        {MAIN_NAV.map((item) => {
          const exact = item.match(pathname);
          const via = !exact && pathname.startsWith('/r/') && from !== null && item.match(from);
          const isDecide = item.to === '/decide';
          const words = isDecide ? badgeWords(badge) : '';
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className="nav-link"
                aria-current={exact ? 'page' : via ? 'true' : undefined}
                aria-label={words ? `${item.label}${words}` : undefined}
              >
                <Icon name={item.icon} size={24} />
                <span>{item.label}</span>
                {isDecide && badge.count > 0 && (
                  <span className="nav-badge" aria-hidden="true">
                    {badge.count}
                  </span>
                )}
                {isDecide && badge.count === 0 && badge.mine > 0 && <span className="nav-badge nav-badge--dot" aria-hidden="true" />}
              </Link>
            </li>
          );
        })}
      </ul>
      <ul className="app-nav__more" aria-label="More places">
        {moreNav.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="nav-sublink" aria-current={pathname === item.to || pathname.startsWith(`${item.to}/`) ? 'page' : undefined}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
