import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { keyLookup } from '@shared/plain';
import { DataGate } from '../../components/DataGate';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, Section } from '../../components/Layout';
import { compareDates } from '../../lib/format';
import { recordedDecision, selectDecisions } from '../../lib/home';
import { firstReviewDecisionKeys, type Decision, type Directory, type Indexes } from '../../lib/records';
import { decideOrder } from '../../lib/turn';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { DecisionCard, SettledNotice, type SettledOutcome } from './DecisionCard';
import { decisionTurn } from './decisionText';

/** How long "Decided: … Undo" stays where the card was before the decision settles into the Decided list. */
export const LINGER_MS = 8000;

/** How many decisions show in full under "Up next". The rest wait, slim, under "Later (N)". */
export const UP_NEXT = 3;

const keyFromHash = (hash: string): string | null => {
  const m = /^#decision-(.+)$/.exec(decodeURIComponent(hash));
  return m ? (m[1] ?? null) : null;
};

/**
 * Open decisions split by whose move it is. `mine` are the ones that need me, in the Decide order: a real needed-by
 * date first (soonest first), then the ones my partner already answered, then the rest. `waiting` are the ones that
 * wait for my partner (then any I do not choose on). The plan's own order breaks ties.
 */
export function groupDecisions(ordered: Decision[], meId: string | null, dir: Directory): { mine: Decision[]; waiting: Decision[] } {
  const turns = ordered.map((d) => decisionTurn(d, meId, dir));
  const isMine = (t: (typeof turns)[number]) => t.turn === 'mine_first' || t.turn === 'mine_after_partner' || t.turn === 'disagree';
  const mine = decideOrder(turns.filter(isMine)).map((t) => t.record);
  const rest = turns.filter((t) => !isMine(t));
  const waiting = [...rest.filter((t) => t.turn === 'waiting_partner'), ...rest.filter((t) => t.turn !== 'waiting_partner')].map((t) => t.record);
  return { mine, waiting };
}

export type Place = 'next' | 'later' | 'waiting';

/** Where a card was when I acted on it. It stays there until I leave the page. */
export interface Pin {
  place: Place;
  index: number;
}

/**
 * Lay the decisions out: at most `UP_NEXT` under "Up next", the rest of mine under "Later", and the ones waiting for
 * my partner. A pinned item (one I acted on) keeps its place and position whatever its turn is now, and still takes
 * one of the "Up next" slots, so nothing else moves either. `resolve` returns what to show for a pinned id (the card,
 * or the "Decided … Undo" notice), or null when there is nothing left to show; then its slot is free again.
 */
export function placeDecisions<T>(
  natural: { mine: T[]; waiting: T[] },
  idOf: (t: T) => string,
  pins: ReadonlyMap<string, Pin>,
  resolve: (id: string) => T | null,
): Record<Place, T[]> {
  const live = [...pins]
    .map(([id, p]) => ({ item: resolve(id), p }))
    .filter((x): x is { item: T; p: Pin } => x.item !== null)
    .sort((a, b) => a.p.index - b.p.index);
  const pinsIn = (place: Place) => live.filter((x) => x.p.place === place);
  const free = (list: T[]) => list.filter((t) => !pins.has(idOf(t)));
  const insert = (base: T[], add: { item: T; p: Pin }[]) => {
    const out = [...base];
    for (const x of add) out.splice(Math.min(x.p.index, out.length), 0, x.item);
    return out;
  };
  const freeMine = free(natural.mine);
  const nextPins = pinsIn('next');
  const slots = Math.max(0, UP_NEXT - nextPins.length);
  return {
    next: insert(freeMine.slice(0, slots), nextPins),
    later: insert(freeMine.slice(slots), pinsIn('later')),
    waiting: insert(free(natural.waiting), pinsIn('waiting')),
  };
}

export function DecisionsTab() {
  const { today } = useData();
  return <DataGate>{({ idx, dir }) => <DecisionsList idx={idx} dir={dir} today={today} />}</DataGate>;
}

interface Lingering {
  d: Decision;
  outcome: SettledOutcome;
}

type Slot = { kind: 'card'; d: Decision } | { kind: 'notice'; l: Lingering };
const slotId = (s: Slot) => (s.kind === 'card' ? s.d.id : s.l.d.id);

/** A heading that opens and closes the list under it ("Later (17)"). */
function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <section className="dfold" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="dfold__h">
        <button type="button" className="dfold__btn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span>{title}</span>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} />
        </button>
      </h2>
      <div id={id} className="dfold__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function DecisionsList({ idx, dir, today }: { idx: Indexes; dir: Directory; today: string }) {
  const { snapshot } = useSnapshot();
  const { hash } = useLocation();
  const meId = dir.me?.id ?? null;
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const firstKeys = useMemo(() => firstReviewDecisionKeys(snapshot?.settings), [snapshot]);
  const [lingering, setLingering] = useState<Lingering[]>([]);
  // A card I opened or answered keeps its place until I leave the page, so it never jumps away under my finger.
  const [pins, setPins] = useState<ReadonlyMap<string, Pin>>(new Map());
  const [laterOpen, setLaterOpen] = useState(false);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const ordered = useMemo(() => selectDecisions(idx, 'all', { meId: null, otherIds: [] }, { today, firstReviewKeys: firstKeys }), [idx, today, firstKeys]);
  const layout = useMemo(() => {
    const g = groupDecisions(ordered, meId, dir);
    const card = (d: Decision): Slot => ({ kind: 'card', d });
    const byId = new Map(ordered.map((d) => [d.id, d]));
    return placeDecisions<Slot>({ mine: g.mine.map(card), waiting: g.waiting.map(card) }, slotId, pins, (id) => {
      const d = byId.get(id);
      if (d) return card(d);
      const l = lingering.find((x) => x.d.id === id);
      return l ? { kind: 'notice', l } : null;
    });
  }, [ordered, meId, dir, pins, lingering]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const pin = useCallback((d: Decision) => {
    setPins((cur) => {
      if (cur.has(d.id)) return cur;
      for (const place of ['next', 'later', 'waiting'] as const) {
        const index = layoutRef.current[place].findIndex((s) => slotId(s) === d.id);
        if (index >= 0) return new Map(cur).set(d.id, { place, index });
      }
      return cur;
    });
  }, []);

  const onSettled = useCallback(
    (d: Decision, outcome: SettledOutcome) => {
      pin(d);
      setLingering((cur) => [...cur.filter((x) => x.d.id !== d.id), { d, outcome }]);
      timers.current.push(window.setTimeout(() => setLingering((cur) => cur.filter((x) => x.d.id !== d.id)), LINGER_MS));
    },
    [pin],
  );

  const target = keyFromHash(hash);
  const targetRecord = target ? idx.decisions.find((d) => d.key === target) : undefined;
  // A link to a decision under "Later" or "Waiting" opens that list, so the card is there to land on.
  const targetPlace = targetRecord ? (['next', 'later', 'waiting'] as const).find((p) => layout[p].some((s) => slotId(s) === targetRecord.id)) : undefined;
  useEffect(() => {
    if (targetPlace === 'later') setLaterOpen(true);
    if (targetPlace === 'waiting') setWaitingOpen(true);
  }, [targetPlace, hash]);

  // A link to a decision that is already decided goes to the Decided list.
  if (targetRecord && !ordered.some((d) => d.id === targetRecord.id) && !lingering.some((x) => x.d.id === targetRecord.id)) {
    return <Navigate to={{ pathname: '/decide/decided', hash }} replace />;
  }

  const others = dir.others.map((p) => p.display_name);
  const waitingTitle = others.length === 1 ? `Waiting for ${others[0]}` : 'Waiting';

  const render = (slots: Slot[], opts: { slim: boolean; groupSays: string | null }) => (
    <ul className="dlist">
      {slots.map((s) =>
        s.kind === 'card' ? (
          <DecisionCard
            key={s.d.id}
            d={s.d}
            idx={idx}
            dir={dir}
            today={today}
            lookup={lookup}
            slim={opts.slim}
            groupSays={opts.groupSays}
            startOpen={targetRecord?.id === s.d.id}
            onExpand={pin}
            onSettled={onSettled}
            onChose={pin}
          />
        ) : (
          <SettledNotice key={`n-${s.l.d.id}`} d={s.l.d} outcome={s.l.outcome} onUndone={() => setLingering((cur) => cur.filter((x) => x.d.id !== s.l.d.id))} />
        ),
      )}
    </ul>
  );

  return (
    <div className="stack stack--loose dlists">
      <Section title="Up next">
        {layout.next.length === 0 ? (
          <Card>
            <EmptyState icon="check" title="Nothing needs you right now." />
          </Card>
        ) : (
          render(layout.next, { slim: false, groupSays: 'Your turn' })
        )}
      </Section>
      {layout.later.length > 0 && (
        <Fold title={`Later (${layout.later.length})`} open={laterOpen} onToggle={() => setLaterOpen((o) => !o)}>
          {render(layout.later, { slim: true, groupSays: 'Your turn' })}
        </Fold>
      )}
      {layout.waiting.length > 0 && (
        <Fold title={`${waitingTitle} (${layout.waiting.length})`} open={waitingOpen} onToggle={() => setWaitingOpen((o) => !o)}>
          {render(layout.waiting, { slim: true, groupSays: others.length === 1 ? waitingTitle : null })}
        </Fold>
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
