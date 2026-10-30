import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MODE_BANNER } from '@shared/labels';
import { SaveIndicator, StaleBanner } from '../components/Feedback';
import { useMe } from '../state/auth';
import { AccountMenu } from './AccountMenu';
import { MainNav } from './nav';

/** Keep the focus scroll padding equal to the real header and tab bar heights (text size changes them). */
function useBarHeights(header: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement;
    const nav = document.querySelector<HTMLElement>('.app-nav');
    const apply = () => {
      const h = header.current;
      const phone = window.matchMedia?.('(max-width: 1023.98px)').matches ?? true;
      if (h && phone) root.style.setProperty('--header-h', `${Math.ceil(h.getBoundingClientRect().height)}px`);
      else root.style.removeProperty('--header-h');
      if (nav && phone) root.style.setProperty('--nav-h', `${Math.ceil(nav.getBoundingClientRect().height)}px`);
      else root.style.removeProperty('--nav-h');
    };
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (header.current) ro?.observe(header.current);
    if (nav) ro?.observe(nav);
    window.addEventListener('resize', apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [header]);
}

export function AppShell({ children, panel, guard }: { children: ReactNode; panel?: ReactNode; guard?: ReactNode }) {
  const me = useMe();
  const headerRef = useRef<HTMLElement>(null);
  useBarHeights(headerRef);
  const banner = MODE_BANNER[me.mode] ?? null;
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      {banner && (
        <div className="mode-banner" role="note">
          <strong>{banner}</strong>
        </div>
      )}
      <header className="app-header" ref={headerRef}>
        <Link to="/" className="brand-mobile" aria-label="Kadode home">
          <span className="wordmark">Kadode</span>
          <span className="wordmark-jp" lang="ja">門出</span>
        </Link>
        <AccountMenu />
      </header>
      <MainNav />
      <main id="main" className="app-main" tabIndex={-1}>
        <StaleBanner />
        {children}
      </main>
      {panel}
      {guard}
      <SaveIndicator />
    </div>
  );
}
