import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { MODE_BANNER } from '@shared/labels';
import { SaveIndicator, StaleBanner } from '../components/Feedback';
import { useMe } from '../state/auth';
import { AccountMenu } from './AccountMenu';
import { MainNav } from './nav';

export function AppShell({ children, panel }: { children: ReactNode; panel?: ReactNode }) {
  const me = useMe();
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
      <header className="app-header">
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
      <SaveIndicator />
    </div>
  );
}
