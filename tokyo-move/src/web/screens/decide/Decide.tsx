import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { PageTitle } from '../../components/Layout';
import { DecisionsTab } from './DecisionsTab';
import { QuestionsTab } from './QuestionsTab';
import { RisksTab } from './RisksTab';

const TABS = [
  { to: '/decide', label: 'Decisions', end: true },
  { to: '/decide/questions', label: 'Questions', end: false },
  { to: '/decide/risks', label: 'Risks & issues', end: false },
];

export function Decide() {
  const { pathname, hash } = useLocation();

  // Jump to a specific decision when linked from Home.
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.focus({ preventScroll: true });
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [hash, pathname]);

  return (
    <div className="page decide">
      <PageTitle kicker="Choose together">Decide</PageTitle>
      <nav aria-label="Decide sections" className="segmented segmented--nav">
        {TABS.map((t) => {
          const active = t.end ? pathname === t.to || pathname === `${t.to}/` : pathname.startsWith(t.to);
          return (
            <Link key={t.to} to={t.to} className="segmented__btn" aria-current={active ? 'page' : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Routes>
        <Route index element={<DecisionsTab />} />
        <Route path="questions" element={<QuestionsTab />} />
        <Route path="risks" element={<RisksTab />} />
        <Route path="*" element={<DecisionsTab />} />
      </Routes>
    </div>
  );
}
