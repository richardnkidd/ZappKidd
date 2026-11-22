/**
 * The one-screen Home: "Your turn", "Stuck", "Travellers" and one "since you last looked" line.
 * What goes in each comes from the pure helpers in lib/home.ts; this file only lays it out and handles the two
 * writes Home makes (one-tap Done with Undo, and marking the plan as seen).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { displayQuestion, displayTitle, optionLabel, type KeyLookup } from '@shared/plain';
import { DoneButton, useDoneWithUndo } from '../../components/DoneWithUndo';
import { ErrorBanner } from '../../components/Feedback';
import { LineTime } from '../../components/Badges';
import { Icon } from '../../components/Icon';
import { PersonBadge } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { dateLine } from '../../lib/dateLine';
import {
  countSince,
  describeSince,
  selectStuck,
  selectYourTurn,
  travellerChip,
  type SinceLine,
  type TurnDecisionRow,
} from '../../lib/home';
import type { Decision, Directory, Indexes } from '../../lib/records';
import { decisionTurn, sentence, shortLabel } from '../decide/decisionText';
import { api, describeError } from '../../net/client';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';

interface Props {
  idx: Indexes;
  dir: Directory;
  lookup?: KeyLookup;
}

/** A section with a plain h2, so landmarks and the heading order stay simple. */
function HomeSection({
  title,
  count,
  className,
  children,
  headingRef,
  action,
}: {
  title: string;
  count?: number;
  className: string;
  children: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
  action?: React.ReactNode;
}) {
  const id = useId();
  return (
    <section className={`home-sec ${className}`} aria-labelledby={id}>
      <div className="home-sec__head">
        <h2 id={id} className="home-sec__title" ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {title}
          {count !== undefined && <span className="home-sec__count"> ({count})</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ Your turn */

function WhenText({ date, today }: { date: string | null; today: string }) {
  if (!date) return null;
  const d = dateLine(date, today);
  return (
    <span className={`turn-row__when${d.when === 'late' ? ' is-late' : ''}`}>
      <LineTime date={date} line={d} />
    </span>
  );
}

export function YourTurnSection({ idx, dir, lookup }: Props) {
  const { today, deadlines, deadlinesByRecord } = useData();
  const meId = dir.me?.id ?? null;
  const { rows } = useMemo(
    () => selectYourTurn({ idx, meId, nameOf: dir.nameOf, today, deadlinesByRecord: deadlines.ok ? deadlinesByRecord : undefined, lookup }),
    [idx, meId, dir, today, deadlines, deadlinesByRecord, lookup],
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const done = useDoneWithUndo(headingRef);

  return (
    <HomeSection
      title="Your turn"
      count={rows.length || undefined}
      className="sec-turn"
      headingRef={headingRef}
      action={
        rows.length > 0 ? (
          <Link to="/plan?view=list" className="more-link home-sec__more">
            See everything
          </Link>
        ) : undefined
      }
    >
      {done.note}
      {rows.length === 0 ? (
        <div className="turn-empty">
          <p>Nothing needs you right now.</p>
          <Link to="/plan?view=list" className="more-link">
            Open the plan
          </Link>
        </div>
      ) : (
        <ul className="turn-list">
          {rows.map((row) =>
            row.kind === 'decision' ? (
              <DecisionTurnRow key={row.id} row={row} idx={idx} dir={dir} lookup={lookup} />
            ) : (
              <li key={row.id} className="turn-row turn-row--task">
                <span className="turn-row__body">
                  <RecordLink id={row.recordId} className="turn-row__title">
                    {row.title}
                  </RecordLink>
                  <WhenText date={row.date} today={today} />
                </span>
                <DoneButton
                  title={row.title}
                  disabled={done.busyId !== null}
                  busy={done.busyId === row.recordId}
                  onClick={() => void done.markDone({ recordId: row.recordId, version: row.version, title: row.title })}
                />
              </li>
            ),
          )}
        </ul>
      )}
    </HomeSection>
  );
}

export interface HomeDecisionWords {
  /** First line: the decision's plain question (or its title). */
  question: string;
  /** The lines under it when someone already picked: ["Jun picked: Set firm limits"], or ["You: …", "Jun: …"]. */
  lines: string[];
  /** The word on the row's button. */
  verb: string;
  /** The link's accessible name: the question, then each line. */
  label: string;
}

/** What a decision row on Home says. Leads with the question, then who picked what. */
export function homeDecisionWords(d: Decision, meId: string | null, dir: Directory, lookup?: KeyLookup): HomeDecisionWords {
  const question = displayQuestion(d, lookup) ?? displayTitle(d, lookup);
  const t = decisionTurn(d, meId, dir);
  const label = (id: string | null) => {
    const o = (d.data?.options ?? []).find((x) => x.id === id);
    return o ? shortLabel(optionLabel(d, o, lookup), 10) : null;
  };
  const other = t.otherId ? dir.nameOf(t.otherId) : 'They';
  let lines: string[] = [];
  let verb = 'Decide';
  if (t.turn === 'mine_after_partner') {
    const theirs = label(t.otherOptionId);
    lines = [theirs ? `${other} picked: ${theirs}` : `${other} picked`];
    verb = 'Agree';
  } else if (t.turn === 'disagree') {
    // Both picks, the same way the card says them.
    lines = [`You: ${label(t.myOptionId) ?? 'one choice'}`, `${other}: ${label(t.otherOptionId) ?? 'another'}`];
    verb = 'Open';
  }
  return { question, lines, verb, label: [question, ...lines.map(sentence)].join(' ') };
}

/** A decision on Home: tapping anywhere opens the decision, expanded, on the Decide screen. */
function DecisionTurnRow({ row, idx, dir, lookup }: { row: TurnDecisionRow; idx: Indexes; dir: Directory; lookup?: KeyLookup }) {
  const d = idx.decisions.find((x) => x.id === row.id);
  const words = d ? homeDecisionWords(d, dir.me?.id ?? null, dir, lookup) : { question: row.text, lines: [], verb: 'Decide', label: row.text };
  return (
    <li className="turn-row turn-row--decision">
      <Link className="turn-row__link" to={{ pathname: '/decide', hash: `#decision-${row.key}` }} aria-label={words.label}>
        <span className="turn-row__body">
          <span className="turn-row__title">{words.question}</span>
          {words.lines.map((l) => (
            <span key={l} className="turn-row__sub">
              {l}
            </span>
          ))}
        </span>
        <span className="turn-row__go" aria-hidden="true">
          {words.verb}
        </span>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ Stuck */

export function StuckSection({ idx, lookup }: Omit<Props, 'dir'>) {
  const { rows, total } = useMemo(() => selectStuck(idx, lookup), [idx, lookup]);
  if (total === 0) return null;
  return (
    <HomeSection
      title="Stuck"
      count={total}
      className="sec-stuck"
      action={
        <Link to="/plan?view=workstream&status=blocked" className="more-link home-sec__more" aria-label={`See all ${total} stuck`}>
          See all
        </Link>
      }
    >
      <ul className="stuck-list">
        {rows.slice(0, 2).map((r) => (
          <li key={r.id} className="stuck-row">
            <RecordLink id={r.id} className="stuck-row__title">
              {r.title}
            </RecordLink>
            <span className="stuck-row__why"> — {r.waitingOn ? `waiting on ${r.waitingOn}` : 'no reason written yet'}</span>
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

/* ------------------------------------------------------------------ Travellers */

export function TravellersSection({ idx, dir, lookup }: Props) {
  const { readiness } = useData();
  const { refresh } = useSnapshot();
  if (!readiness.ok) {
    return (
      <HomeSection title="Travellers" className="sec-travellers">
        <ErrorBanner title="We couldn't work this out just now." onRetry={() => void refresh()}>
          The rest of Home still works.
        </ErrorBanner>
      </HomeSection>
    );
  }
  if (readiness.value.length === 0) return null;
  return (
    <HomeSection title="Travellers" className="sec-travellers">
      <ul className="traveller-list">
        {readiness.value.map((r) => {
          const chip = travellerChip(r, idx, lookup);
          const name = dir.nameOf(r.person_id);
          return (
            <li key={r.person_id}>
              <Link to={`/ready/${encodeURIComponent(r.person_id)}`} className="traveller" aria-label={`${name}: ${chip.text}`}>
                <PersonBadge person={dir.personById(r.person_id)} size={24} />
                <span className="traveller__text">
                  <span className="traveller__name">{name}</span>
                  <span className={`traveller__state${chip.stuckOn ? ' is-stuck' : ''}`}>{chip.text}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </HomeSection>
  );
}

/* ------------------------------------------------------------------ Since you last looked */

export function SinceLine({ idx, dir, lookup }: Props) {
  const { snapshot } = useSnapshot();
  const other = dir.others[0] ?? null;
  const meId = dir.me?.id ?? null;
  // Frozen at first render: marking seen must not make the list vanish while it is being read.
  const [since] = useState<string | null>(() => snapshot?.last_seen_at ?? null);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<SinceLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const marked = useRef(false);

  // First visit: nothing to compare with, so mark the plan as seen now and show nothing.
  useEffect(() => {
    if (since === null && !marked.current) {
      marked.current = true;
      void api.markSeen().catch(() => undefined);
    }
  }, [since]);

  const count = useMemo(() => countSince(snapshot?.records ?? [], other?.id ?? null, since), [snapshot, other, since]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || lines) return;
    try {
      const entries = await api.audit({ since });
      setLines(describeSince(entries, idx, other?.id ?? null, meId, lookup));
      if (!marked.current) {
        marked.current = true;
        void api.markSeen().catch(() => undefined);
      }
    } catch (e) {
      setError(describeError(e));
    }
  };

  if (!other || since === null || count === 0) return null;
  const name = other.display_name;
  return (
    <section className="home-sec sec-since" aria-label="Since you last looked">
      <button type="button" className="since-btn" aria-expanded={open} aria-controls={listId} onClick={() => void toggle()}>
        <span>
          {name} did {count} {count === 1 ? 'thing' : 'things'} since you last looked
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} />
      </button>
      <div id={listId} hidden={!open}>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        {open && !lines && !error && <p className="muted">Loading…</p>}
        {lines && lines.length === 0 && <p className="muted">Nothing to show.</p>}
        {lines && lines.length > 0 && (
          <ul className="since-list">
            {lines.slice(0, 8).map((l) => (
              <li key={l.id}>
                {l.recordId && idx.byId.has(l.recordId) ? (
                  <RecordLink id={l.recordId}>
                    {name} {l.text}
                  </RecordLink>
                ) : (
                  <>
                    {name} {l.text}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Waiting to be added */

export function PendingTasksLine({ idx }: { idx: Indexes }) {
  const pending = idx.taskLinks.filter((t) => t.sync_state === 'pending_capture' && t.status === 'open');
  if (pending.length === 0) return null;
  const only = pending.length === 1 ? pending[0] : null;
  const label = `${pending.length} ${pending.length === 1 ? 'task' : 'tasks'} waiting to be added`;
  return (
    <p className="home-pending">
      {only?.record_id && idx.byId.has(only.record_id) ? (
        <RecordLink id={only.record_id} className="more-link">
          {label}
        </RecordLink>
      ) : (
        <Link to="/data" className="more-link">
          {label}
        </Link>
      )}
    </p>
  );
}
