import { useEffect, useMemo } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { PageTitle } from '../../components/Layout';
import { isMyTurn } from '../../lib/turn';
import { useSnapshot } from '../../state/snapshot';
import { DecidedTab, DecisionsTab } from './DecisionsTab';
import { QuestionsTab } from './QuestionsTab';
import { RisksTab } from './RisksTab';
import { isOpenDecision, requiredApproverIds } from './decisionText';

const TABS = [
  { to: '/decide', label: 'Decisions', end: true },
  { to: '/decide/decided', label: 'Decided', end: false },
  { to: '/decide/questions', label: 'Questions', end: false },
  { to: '/decide/risks', label: 'Risks & issues', end: false },
];

export function Decide() {
  const { pathname, hash } = useLocation();
  const { idx, dir } = useSnapshot();
  // How many decisions need me: the same rule as Home and the bottom navigation.
  const myTurn = useMemo(() => {
    if (!idx || !dir) return 0;
    const meId = dir.me?.id ?? null;
    return idx.decisions.filter((d) => isOpenDecision(d) && isMyTurn({ status: d.status, data: { ...(d.data ?? {}), required_approvers: requiredApproverIds(d, dir) } }, meId)).length;
  }, [idx, dir]);

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
              {t.to === '/decide' && myTurn > 0 && (
                <span className="dtab-count">
                  <span aria-hidden="true">{myTurn}</span>
                  <span className="visually-hidden">, {myTurn} your turn</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <Routes>
        <Route index element={<DecisionsTab />} />
        <Route path="decided" element={<DecidedTab />} />
        <Route path="questions" element={<QuestionsTab />} />
        <Route path="risks" element={<RisksTab />} />
        <Route path="*" element={<DecisionsTab />} />
      </Routes>
    </div>
  );
}
