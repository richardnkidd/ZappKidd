import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { DataGate } from '../../components/DataGate';
import { Disclosure } from '../../components/Disclosure';
import { Card, EmptyState, Section } from '../../components/Layout';
import { compareDates, plural } from '../../lib/format';
import { recordedDecision, selectDecisions } from '../../lib/home';
import { firstReviewDecisionKeys, type Decision, type Directory, type Indexes } from '../../lib/records';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { DecidedTogether, DecisionCard } from './DecisionCard';

/** How many open decisions are shown up front; the rest wait under "Later". */
const UP_NEXT = 3;
/** How long the "Decided together" confirmation stays before the card settles into the Decided list. */
const LINGER_MS = 5000;

const keyFromHash = (hash: string): string | null => {
  const m = /^#decision-(.+)$/.exec(decodeURIComponent(hash));
  return m ? (m[1] ?? null) : null;
};

export function DecisionsTab() {
  const { today } = useData();
  return <DataGate>{({ idx, dir }) => <DecisionsList idx={idx} dir={dir} today={today} />}</DataGate>;
}

function DecisionsList({ idx, dir, today }: { idx: Indexes; dir: Directory; today: string }) {
  const { snapshot } = useSnapshot();
  const { hash } = useLocation();
  const firstKeys = useMemo(() => firstReviewDecisionKeys(snapshot?.settings), [snapshot]);
  const [lingering, setLingering] = useState<Decision[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const decidedTogether = useCallback((d: Decision) => {
    setLingering((cur) => [...cur.filter((x) => x.id !== d.id), d]);
    timers.current.push(window.setTimeout(() => setLingering((cur) => cur.filter((x) => x.id !== d.id)), LINGER_MS));
  }, []);

  // Same order as Home. A card never jumps away just because you approved it (approval does not change the order).
  const ordered = useMemo(() => selectDecisions(idx, 'all', { meId: null, otherIds: [] }, { today, firstReviewKeys: firstKeys }), [idx, today, firstKeys]);

  const target = keyFromHash(hash);
  const targetRecord = target ? idx.decisions.find((d) => d.key === target) : undefined;
  // A link to a decision that is already decided goes to the Decided list.
  if (targetRecord && !ordered.some((d) => d.id === targetRecord.id) && !lingering.some((d) => d.id === targetRecord.id)) {
    return <Navigate to={{ pathname: '/decide/decided', hash }} replace />;
  }

  const upNext = ordered.slice(0, UP_NEXT);
  const later = ordered.slice(UP_NEXT);
  const targetInLater = !!targetRecord && later.some((d) => d.id === targetRecord.id);

  return (
    <div className="stack stack--loose">
      <Section title="Up next" count={upNext.length || undefined} intro="Proposals have a dashed outline until everyone who needs to agree has approved.">
        <div role="status" className="decided-live stack">
          {lingering.map((d) => (
            <DecidedTogether key={d.id} d={d} focusMe />
          ))}
        </div>
        {upNext.length === 0 ? (
          lingering.length === 0 && (
            <Card>
              <EmptyState icon="check" title="No decisions are waiting.">
                When a new choice comes up, it will show here with what’s needed and by when.
              </EmptyState>
            </Card>
          )
        ) : (
          <ul className="stack">
            {upNext.map((d) => (
              <DecisionCard key={d.id} d={d} idx={idx} dir={dir} today={today} startOpen={targetRecord?.id === d.id} onDecidedTogether={decidedTogether} />
            ))}
          </ul>
        )}
      </Section>

      {later.length > 0 && (
        <Disclosure className="decide-later" title="Later" meta={`${later.length}`} defaultOpen={targetInLater}>
          <ul className="stack">
            {later.map((d) => (
              <DecisionCard key={d.id} d={d} idx={idx} dir={dir} today={today} startOpen={targetRecord?.id === d.id} onDecidedTogether={decidedTogether} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

/** Decisions that are decided, rejected, put off or recorded as decided in the plan, newest first. */
export function DecidedTab() {
  const { today } = useData();
  return <DataGate>{({ idx, dir }) => <DecidedList idx={idx} dir={dir} today={today} />}</DataGate>;
}

function DecidedList({ idx, dir, today }: { idx: Indexes; dir: Directory; today: string }) {
  const { hash } = useLocation();
  const closed = useMemo(() => {
    const when = (d: Decision) => recordedDecision(d)?.on ?? d.data?.decided_at ?? d.updated_at;
    return idx.decisions
      .filter((d) => (d.status !== 'open' && d.status !== 'proposed') || recordedDecision(d))
      .sort((a, b) => {
        const c = compareDates(when(b)?.slice(0, 10), when(a)?.slice(0, 10));
        return c !== 0 ? c : a.key.localeCompare(b.key, undefined, { numeric: true });
      });
  }, [idx]);
  const target = keyFromHash(hash);
  const targetRecord = target ? idx.decisions.find((d) => d.key === target) : undefined;
  // A link to a decision that is still open goes back to the open list.
  if (targetRecord && !closed.some((d) => d.id === targetRecord.id)) {
    return <Navigate to={{ pathname: '/decide', hash }} replace />;
  }
  return (
    <Section title="Decided" count={closed.length || undefined} intro="Choices the household has made, set aside or put off. Nothing here needs you.">
      {closed.length === 0 ? (
        <Card>
          <EmptyState icon="decide" title="Nothing has been decided yet.">
            Decisions you make together will collect here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <ul className="stack">
            {closed.map((d) => (
              <DecisionCard key={d.id} d={d} idx={idx} dir={dir} today={today} startOpen={targetRecord?.id === d.id} />
            ))}
          </ul>
          <p className="small faint">{plural(closed.length, 'decision')} in the household’s record.</p>
        </>
      )}
    </Section>
  );
}
