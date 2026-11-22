import { Link, useLocation } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { hasOptionalFuture } from '../lib/records';
import { countMyTurn } from '../lib/turn';
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

/** How many decisions need the signed-in person now (the badge on the Decide tab). Same rule as Home and Decide. */
export function useMyTurnCount(): number {
  const loaded = useLoaded();
  if (!loaded) return 0;
  return countMyTurn(loaded.idx.decisions, loaded.dir.me?.id ?? null);
}

/** The "More" places, without Future work while the plan holds no optional future items. */
export function useMoreNav(): typeof MORE_NAV {
  const loaded = useLoaded();
  return loaded && hasOptionalFuture(loaded.idx) ? MORE_NAV : MORE_NAV.filter((item) => item.to !== '/future');
}

export function MainNav() {
  const moreNav = useMoreNav();
  const myTurn = useMyTurnCount();
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
          const badge = item.to === '/decide' ? myTurn : 0;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className="nav-link"
                aria-current={exact ? 'page' : via ? 'true' : undefined}
                aria-label={badge > 0 ? `${item.label}, ${badge} ${badge === 1 ? 'needs' : 'need'} you` : undefined}
              >
                <Icon name={item.icon} size={24} />
                <span>{item.label}</span>
                {badge > 0 && (
                  <span className="nav-badge" aria-hidden="true">
                    {badge}
                  </span>
                )}
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
