import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { keyLookup } from '@shared/plain';
import { DataGate } from '../../components/DataGate';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, Section } from '../../components/Layout';
import { compareDates } from '../../lib/format';
import { recordedDecision, selectDecisions } from '../../lib/home';
import { firstReviewDecisionKeys, type Decision, type Directory, type Indexes } from '../../lib/records';
import { myTurnDecisions } from '../../lib/turn';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { DecisionCard, SettledNotice, type SettledOutcome } from './DecisionCard';
import { decisionTurn, requiredApproverIds } from './decisionText';

/** How long "Decided: … Undo" stays where the card was before the decision settles into the Decided list. */
export const LINGER_MS = 8000;

const keyFromHash = (hash: string): string | null => {
  const m = /^#decision-(.+)$/.exec(decodeURIComponent(hash));
  return m ? (m[1] ?? null) : null;
};

type Group = 'mine' | 'waiting';

/**
 * Open decisions in the order a person should meet them: the ones that need me (disagreements, then the ones my
 * partner already answered, then untouched), then the ones waiting for my partner. Within a group the plan's own order
 * (soonest needed first) is kept.
 */
export function groupDecisions(ordered: Decision[], meId: string | null, dir: Directory): { mine: Decision[]; waiting: Decision[] } {
  const shaped = ordered.map((d) => ({ status: d.status, data: { ...(d.data ?? {}), required_approvers: requiredApproverIds(d, dir) }, d }));
  const mine = myTurnDecisions(shaped, meId).map((t) => t.record.d);
  const mineIds = new Set(mine.map((d) => d.id));
  const rest = ordered.filter((d) => !mineIds.has(d.id));
  const waitingPartner = rest.filter((d) => decisionTurn(d, meId, dir).turn === 'waiting_partner');
  const others = rest.filter((d) => decisionTurn(d, meId, dir).turn !== 'waiting_partner');
  return { mine, waiting: [...waitingPartner, ...others] };
}

export function DecisionsTab() {
  const { today } = useData();
  return <DataGate>{({ idx, dir }) => <DecisionsList idx={idx} dir={dir} today={today} />}</DataGate>;
}

interface Lingering {
  d: Decision;
  outcome: SettledOutcome;
  group: Group;
  index: number;
}

function DecisionsList({ idx, dir, today }: { idx: Indexes; dir: Directory; today: string }) {
  const { snapshot } = useSnapshot();
  const { hash } = useLocation();
  const meId = dir.me?.id ?? null;
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const firstKeys = useMemo(() => firstReviewDecisionKeys(snapshot?.settings), [snapshot]);
  const [lingering, setLingering] = useState<Lingering[]>([]);
  // A card I just answered stays in its group until I leave the page, so it never jumps away under my finger.
  const [held, setHeld] = useState<ReadonlyMap<string, Group>>(new Map());
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const ordered = useMemo(() => selectDecisions(idx, 'all', { meId: null, otherIds: [] }, { today, firstReviewKeys: firstKeys }), [idx, today, firstKeys]);
  const groups = useMemo(() => {
    const g = groupDecisions(ordered, meId, dir);
    const mine: Decision[] = [];
    const waiting: Decision[] = [];
    for (const d of ordered) {
      const natural: Group = g.mine.some((x) => x.id === d.id) ? 'mine' : 'waiting';
      const group = held.get(d.id) ?? natural;
      (group === 'mine' ? mine : waiting).push(d);
    }
    // Keep the turn order inside each group.
    const order = new Map([...g.mine, ...g.waiting].map((d, i) => [d.id, i]));
    const byTurn = (a: Decision, b: Decision) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    mine.sort(byTurn);
    waiting.sort(byTurn);
    return { mine, waiting };
  }, [ordered, meId, dir, held]);

  const groupOf = useCallback((id: string): Group => (groups.mine.some((d) => d.id === id) ? 'mine' : 'waiting'), [groups]);

  const onSettled = useCallback(
    (d: Decision, outcome: SettledOutcome) => {
      const group = groupOf(d.id);
      const list = group === 'mine' ? groups.mine : groups.waiting;
      const index = Math.max(0, list.findIndex((x) => x.id === d.id));
      setLingering((cur) => [...cur.filter((x) => x.d.id !== d.id), { d, outcome, group, index }]);
      timers.current.push(window.setTimeout(() => setLingering((cur) => cur.filter((x) => x.d.id !== d.id)), LINGER_MS));
    },
    [groupOf, groups],
  );
  const onChose = useCallback((d: Decision) => setHeld((cur) => new Map(cur).set(d.id, groupOf(d.id))), [groupOf]);

  const target = keyFromHash(hash);
  const targetRecord = target ? idx.decisions.find((d) => d.key === target) : undefined;
  // A link to a decision that is already decided goes to the Decided list.
  if (targetRecord && !ordered.some((d) => d.id === targetRecord.id) && !lingering.some((x) => x.d.id === targetRecord.id)) {
    return <Navigate to={{ pathname: '/decide/decided', hash }} replace />;
  }

  const withNotices = (group: Group, list: Decision[]) => {
    const items: ({ kind: 'card'; d: Decision } | { kind: 'notice'; l: Lingering })[] = list.map((d) => ({ kind: 'card', d }));
    for (const l of lingering.filter((x) => x.group === group).sort((a, b) => a.index - b.index)) {
      if (list.some((d) => d.id === l.d.id)) continue; // reopened again: the card is back
      items.splice(Math.min(l.index, items.length), 0, { kind: 'notice', l });
    }
    return items;
  };

  const render = (group: Group, list: Decision[]) => (
    <ul className="dlist">
      {withNotices(group, list).map((it) =>
        it.kind === 'card' ? (
          <DecisionCard
            key={it.d.id}
            d={it.d}
            idx={idx}
            dir={dir}
            today={today}
            lookup={lookup}
            startOpen={targetRecord?.id === it.d.id}
            onSettled={onSettled}
            onChose={onChose}
          />
        ) : (
          <SettledNotice key={`n-${it.l.d.id}`} d={it.l.d} outcome={it.l.outcome} onUndone={() => setLingering((cur) => cur.filter((x) => x.d.id !== it.l.d.id))} />
        ),
      )}
    </ul>
  );

  const mineItems = withNotices('mine', groups.mine);
  const waitingItems = withNotices('waiting', groups.waiting);
  const others = dir.others.map((p) => p.display_name);

  return (
    <div className="stack stack--loose dlists">
      <Section title="Your turn" count={groups.mine.length || undefined}>
        {mineItems.length === 0 ? (
          <Card>
            <EmptyState icon="check" title="Nothing needs you right now." />
          </Card>
        ) : (
          render('mine', groups.mine)
        )}
      </Section>
      {waitingItems.length > 0 && (
        <Section title={others.length === 1 ? `Waiting for ${others[0]}` : 'Waiting'} count={groups.waiting.length || undefined}>
          {render('waiting', groups.waiting)}
        </Section>
      )}
    </div>
  );
}

/** Decisions that are decided, put off or closed, newest first. */
export function DecidedTab() {
  const { today } = useData();
  return <DataGate>{({ idx, dir }) => <DecidedList idx={idx} dir={dir} today={today} />}</DataGate>;
}

function DecidedList({ idx, dir, today }: { idx: Indexes; dir: Directory; today: string }) {
  const { hash } = useLocation();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const [reopened, setReopened] = useState<{ d: Decision; index: number }[]>([]);
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
  if (targetRecord && !closed.some((d) => d.id === targetRecord.id) && !reopened.some((r) => r.d.id === targetRecord.id)) {
    return <Navigate to={{ pathname: '/decide', hash }} replace />;
  }
  const items: ({ kind: 'card'; d: Decision } | { kind: 'reopened'; d: Decision })[] = closed.map((d) => ({ kind: 'card', d }));
  for (const r of [...reopened].sort((a, b) => a.index - b.index)) {
    if (closed.some((d) => d.id === r.d.id)) continue;
    items.splice(Math.min(r.index, items.length), 0, { kind: 'reopened', d: r.d });
  }
  return (
    <Section title="Decided" count={closed.length || undefined}>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="decide" title="Nothing is decided yet." />
        </Card>
      ) : (
        <ul className="dlist">
          {items.map((it) =>
            it.kind === 'card' ? (
              <DecisionCard
                key={it.d.id}
                d={it.d}
                idx={idx}
                dir={dir}
                today={today}
                lookup={lookup}
                startOpen={targetRecord?.id === it.d.id}
                onReopened={(d) => setReopened((cur) => [...cur.filter((x) => x.d.id !== d.id), { d, index: closed.findIndex((x) => x.id === d.id) }])}
              />
            ) : (
              <ReopenedNotice key={`r-${it.d.id}`} d={it.d} />
            ),
          )}
        </ul>
      )}
    </Section>
  );
}

/** Where a card was on the Decided list, after "Reopen": says where it went. Takes focus (the card is gone). */
function ReopenedNotice({ d }: { d: Decision }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <li className="dcard-item">
      <div ref={ref} id={`decision-${d.key}`} tabIndex={-1} className="dsettled" role="group" aria-label="Reopened">
        <Icon name="undo" size={16} />
        <p>
          <strong>Reopened.</strong> <Link to={{ pathname: '/decide', hash: `#decision-${d.key}` }}>Decide it now</Link>
        </p>
      </div>
    </li>
  );
}
