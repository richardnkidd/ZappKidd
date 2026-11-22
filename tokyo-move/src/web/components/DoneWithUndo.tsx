/**
 * One-tap "Done" with ten seconds of "Marked done · Undo" (approved changes 13 and 15). Home, the Plan lists and the
 * Arrival steps all use this, so the behaviour is the same everywhere:
 *
 *   const done = useDoneWithUndo(headingRef);   // where focus goes when the note goes or a write fails
 *   {done.note}                                 // render once, above the list: a live region plus Undo
 *   <DoneButton title={title} onClick={() => done.markDone({ recordId, version, title })} busy={done.busyId === recordId} disabled={done.busyId !== null} />
 *
 * The write carries the record's version (the conflict banner shows on a stale one). Evidence is optional, so one
 * tap is enough. Undo uses the history entry the server returns.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, describeError } from '../net/client';
import { useSnapshot } from '../state/snapshot';
import { useWrite } from '../state/useWrite';
import { ConflictBanner } from './Feedback';
import { Icon } from './Icon';

export const UNDO_MS = 10_000;

export interface DoneTarget {
  recordId: string;
  version: number;
  title: string;
  /** For a step shared by several travellers: mark only this person's part done. */
  traveler?: string | null;
}

export interface DoneWithUndo {
  markDone: (t: DoneTarget) => Promise<boolean>;
  /** The record being saved right now, or null. */
  busyId: string | null;
  /** The live region, Undo, and any error or conflict. Render it once, near the list. */
  note: ReactNode;
}

export function useDoneWithUndo(fallbackFocus: RefObject<HTMLElement | null>): DoneWithUndo {
  const { actions, refresh } = useSnapshot();
  const w = useWrite();
  const [done, setDone] = useState<{ title: string; auditId: string | null } | null>(null);
  const [message, setMessage] = useState('');
  const [undoError, setUndoError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  // The note stays for ten seconds. If focus was on Undo when it goes, focus moves to the fallback (never lost).
  useEffect(() => {
    if (!done) return;
    undoRef.current?.focus();
    const t = window.setTimeout(() => {
      const hadFocus = document.activeElement === undoRef.current;
      setDone(null);
      setMessage('');
      if (hadFocus) fallbackFocus.current?.focus();
    }, UNDO_MS);
    return () => window.clearTimeout(t);
  }, [done, fallbackFocus]);

  const markDone = useCallback(
    async (t: DoneTarget) => {
      setBusyId(t.recordId);
      setUndoError(null);
      let auditId: string | null = null;
      const ok = await w.run(async (baseVersion) => {
        const res = await api.completeRecord(t.recordId, baseVersion, t.traveler ?? null);
        auditId = res.undo_audit_id;
        actions.adoptRecord(res.record);
      }, t.version);
      setBusyId(null);
      if (ok) {
        setMessage(`Marked done: ${t.title}`);
        setDone({ title: t.title, auditId });
        void refresh();
      } else {
        fallbackFocus.current?.focus();
      }
      return ok;
    },
    [w, actions, refresh, fallbackFocus],
  );

  const undo = useCallback(async () => {
    if (!done?.auditId) return;
    try {
      await actions.undoAudit(done.auditId);
      setMessage(`Undone: ${done.title} is open again`);
      setDone(null);
      fallbackFocus.current?.focus();
    } catch (e) {
      setUndoError(describeError(e));
    }
  }, [done, actions, fallbackFocus]);

  const note = (
    <>
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
      {w.error && (
        <p className="field__error" role="alert">
          {w.error}
        </p>
      )}
      <div className="done-note">
        <p role="status" className="done-note__text">
          {message ? (done ? 'Marked done' : message) : ''}
          {done && <span className="visually-hidden">: {done.title}</span>}
        </p>
        {done?.auditId && (
          <button ref={undoRef} type="button" className="btn btn--quiet done-note__undo" onClick={() => void undo()}>
            Undo
          </button>
        )}
        {undoError && (
          <p className="field__error" role="alert">
            {undoError}
          </p>
        )}
      </div>
    </>
  );

  return { markDone, busyId, note };
}

/** The one-tap button: a quiet secondary button with a check, named for the item, at least 44px square. */
export function DoneButton({ title, onClick, busy = false, disabled = false, className = '' }: { title: string; onClick: () => void; busy?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      className={`btn btn--secondary done-btn ${className}`.trim()}
      aria-label={`Mark ${title} done`}
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      <Icon name="check" size={18} />
      Done
    </button>
  );
}
