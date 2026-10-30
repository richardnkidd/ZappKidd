import { BrowserRouter, Route, Routes, useLocation, type Location } from 'react-router';
import { ButtonLink } from './components/Controls';
import { EmptyState, PageTitle } from './components/Layout';
import { AppShell } from './layout/AppShell';
import { useIsDesktop } from './layout/useMedia';
import { Decide } from './screens/decide/Decide';
import { Home } from './screens/home/Home';
import { Money } from './screens/money/Money';
import { More } from './screens/More';
import { ReadyDetail } from './screens/ready/ReadyDetail';
import { ComingSoon } from './screens/Placeholder';
import { Plan } from './screens/plan/Plan';
import { RecordPage, RecordPanel } from './screens/record/RecordDetail';
import { SignIn } from './screens/SignIn';
import { AuthProvider, useAuth } from './state/auth';
import { DataProvider } from './state/data';
import { PrefsProvider } from './state/prefs';
import { SnapshotProvider } from './state/snapshot';
import { Button } from './components/Controls';
import { Skeleton } from './components/Layout';
import { ErrorBanner } from './components/Feedback';

function NotFound() {
  return (
    <div className="page">
      <PageTitle>We couldn't find that page</PageTitle>
      <EmptyState title="That address doesn't lead anywhere." action={<ButtonLink to="/" variant="primary">Back to Home</ButtonLink>}>
        It may have moved, or the link may be incomplete.
      </EmptyState>
    </div>
  );
}

function AppRoutes() {
  const location = useLocation();
  const desktop = useIsDesktop();
  const bg = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;
  const showPanel = Boolean(bg) && desktop && location.pathname.startsWith('/r/');
  return (
    <AppShell
      panel={
        showPanel ? (
          <Routes>
            <Route path="/r/:id" element={<RecordPanel backTo={bg} />} />
          </Routes>
        ) : null
      }
    >
      <Routes location={showPanel ? bg : location}>
        <Route path="/" element={<Home />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/r/:id" element={<RecordPage />} />
        <Route path="/decide/*" element={<Decide />} />
        <Route path="/money" element={<Money />} />
        <Route path="/ready/:personId" element={<ReadyDetail />} />
        <Route path="/more" element={<More />} />
        <Route path="/documents" element={<ComingSoon title="Documents" icon="doc" />} />
        <Route path="/contacts" element={<ComingSoon title="Contacts & evidence" icon="contacts" />} />
        <Route path="/arrival" element={<ComingSoon title="Arrival & living in Tokyo" icon="plane" />} />
        <Route path="/future" element={<ComingSoon title="Future work" icon="sprout" />} />
        <Route path="/data" element={<ComingSoon title="Data & imports" icon="database" />} />
        <Route path="/settings" element={<ComingSoon title="Settings" icon="gear" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

function Boot() {
  return (
    <div className="signin">
      <div className="signin__card" role="status" aria-label="Loading Kadode">
        <p className="wordmark-lockup">
          <span className="wordmark wordmark--lg">Kadode</span>
          <span className="wordmark-jp wordmark-jp--lg" lang="ja">門出</span>
        </p>
        <Skeleton lines={2} height={20} />
      </div>
    </div>
  );
}

function Gate() {
  const { status, me, error, reload } = useAuth();
  if (status === 'loading') return <Boot />;
  if (status === 'error') {
    return (
      <div className="signin">
        <main className="signin__card" id="main">
          <h1 className="signin__title">We can't reach Kadode</h1>
          <ErrorBanner title="The connection didn't work." onRetry={() => void reload()}>
            {error?.message ?? 'Try again in a moment.'} Your plan is safe.
          </ErrorBanner>
          <Button variant="primary" onClick={() => void reload()}>Try again</Button>
        </main>
      </div>
    );
  }
  if (status === 'signed_out' || !me) return <SignIn />;
  return (
    <PrefsProvider key={me.user.user_id}>
      <SnapshotProvider>
        <DataProvider>
          <AppRoutes />
        </DataProvider>
      </SnapshotProvider>
    </PrefsProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
