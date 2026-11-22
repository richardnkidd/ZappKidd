/**
 * The one-screen Home: "Your turn", "Stuck", "Travellers" and one "since you last looked" line.
 * What goes in each comes from the pure helpers in lib/home.ts; this file only lays it out and handles the two
 * writes Home makes (one-tap Done with Undo, and marking the plan as seen).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { KeyLookup } from '@shared/plain';
import { ConflictBanner, ErrorBanner } from '../../components/Feedback';
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
  type TurnTaskRow,
} from '../../lib/home';
import type { Directory, Indexes } from '../../lib/records';
import { api, describeError } from '../../net/client';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

const UNDO_MS = 10_000;

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
      <time dateTime={date}>{d.when === 'late' ? d.dateText : d.text}</time>
      {d.when === 'late' && <> · {d.text}</>}
    </span>
  );
}

export function YourTurnSection({ idx, dir, lookup }: Props) {
  const { today, deadlines, deadlinesByRecord } = useData();
  const { actions, refresh } = useSnapshot();
  const w = useWrite();
  const meId = dir.me?.id ?? null;
  const { rows } = useMemo(
    () => selectYourTurn({ idx, meId, nameOf: dir.nameOf, today, deadlinesByRecord: deadlines.ok ? deadlinesByRecord : undefined, lookup }),
    [idx, meId, dir, today, deadlines, deadlinesByRecord, lookup],
  );

  const [done, setDone] = useState<{ title: string; auditId: string | null } | null>(null);
  const [message, setMessage] = useState('');
  const [undoError, setUndoError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The "Marked done" note stays for about ten seconds. If focus was on Undo when it goes, focus moves to the heading.
  useEffect(() => {
    if (!done) return;
    undoRef.current?.focus();
    const t = window.setTimeout(() => {
      const hadFocus = document.activeElement === undoRef.current;
      setDone(null);
      setMessage('');
      if (hadFocus) headingRef.current?.focus();
    }, UNDO_MS);
    return () => window.clearTimeout(t);
  }, [done]);

  const markDone = useCallback(
    async (row: TurnTaskRow) => {
      setBusyId(row.id);
      setUndoError(null);
      let auditId: string | null = null;
      const ok = await w.run(async (baseVersion) => {
        const res = await api.completeRecord(row.recordId, baseVersion);
        auditId = res.undo_audit_id;
        actions.adoptRecord(res.record);
      }, row.version);
      setBusyId(null);
      if (ok) {
        setMessage(`Marked done: ${row.title}`);
        setDone({ title: row.title, auditId });
        void refresh();
      } else {
        headingRef.current?.focus();
      }
    },
    [w, actions, refresh],
  );

  const undo = useCallback(async () => {
    if (!done?.auditId) return;
    try {
      await actions.undoAudit(done.auditId);
      setMessage(`Undone: ${done.title} is open again`);
      setDone(null);
      headingRef.current?.focus();
    } catch (e) {
      setUndoError(describeError(e));
    }
  }, [done, actions]);

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
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
      {w.error && (
        <p className="field__error" role="alert">
          {w.error}
        </p>
      )}
      <div className="turn-note">
        <p role="status" className="turn-note__text">
          {message ? (done ? 'Marked done' : message) : ''}
          {done && <span className="visually-hidden">: {done.title}</span>}
        </p>
        {done?.auditId && (
          <button ref={undoRef} type="button" className="btn btn--quiet turn-note__undo" onClick={() => void undo()}>
            Undo
          </button>
        )}
        {undoError && (
          <p className="field__error" role="alert">
            {undoError}
          </p>
        )}
      </div>
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
              <li key={row.id} className="turn-row turn-row--decision">
                <Link className="turn-row__link" to={{ pathname: '/decide', hash: `#decision-${row.key}` }}>
                  <span className="turn-row__title">{row.text}</span>
                  <span className="turn-row__go" aria-hidden="true">
                    {row.partner ? 'Open' : 'Decide'}
                  </span>
                </Link>
              </li>
            ) : (
              <li key={row.id} className="turn-row turn-row--task">
                <span className="turn-row__body">
                  <RecordLink id={row.recordId} className="turn-row__title">
                    {row.title}
                  </RecordLink>
                  <WhenText date={row.date} today={today} />
                </span>
                <button
                  type="button"
                  className="btn btn--secondary turn-row__done"
                  aria-label={`Mark ${row.title} done`}
                  disabled={busyId !== null}
                  aria-busy={busyId === row.id || undefined}
                  onClick={() => void markDone(row)}
                >
                  <Icon name="check" size={18} />
                  Done
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </HomeSection>
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
        <Link to="/plan?view=list&status=blocked" className="more-link home-sec__more" aria-label={`See all ${total} stuck`}>
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
