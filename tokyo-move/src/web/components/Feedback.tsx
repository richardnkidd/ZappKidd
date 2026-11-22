import { useEffect, useState, type ReactNode } from 'react';
import { instant } from '../lib/format';
import { useDir } from './People';
import { usePrefs } from '../state/prefs';
import { useSnapshot } from '../state/snapshot';
import { ConflictError, isMisdirected } from '../net/client';
import { conflictDiffs } from '../lib/changes';
import { Button } from './Controls';
import { Icon } from './Icon';

/** Persistent polite live region: Saving… / Saved · 2:14 PM HST / Unsaved changes / Conflict / Error. */
export function SaveIndicator() {
  const { save } = useSnapshot();
  const { zone } = usePrefs();
  const [hideSaved, setHideSaved] = useState(false);

  useEffect(() => {
    setHideSaved(false);
    if (save.kind !== 'saved') return;
    const t = window.setTimeout(() => setHideSaved(true), 6000);
    return () => window.clearTimeout(t);
  }, [save]);

  let text: string | null = null;
  let tone = 'neutral';
  let icon: 'check' | 'clock' | 'alert' | 'pencil' = 'check';
  switch (save.kind) {
    case 'saving':
      text = 'Saving…';
      icon = 'clock';
      break;
    case 'saved':
      text = hideSaved ? null : `Saved · ${instant(save.at.toISOString(), zone, 'time')}`;
      tone = 'matcha';
      break;
    case 'unsaved':
      text = 'Unsaved changes';
      tone = 'kin';
      icon = 'pencil';
      break;
    case 'conflict':
      // The conflict banner on the page is the visible message; this keeps screen readers informed.
      return (
        <div className="save-indicator-wrap" role="status" aria-live="polite" aria-atomic="true">
          <span className="visually-hidden">Someone else changed this. Choose which version to keep.</span>
        </div>
      );
    case 'error':
      text = `Not saved — ${save.message}`;
      tone = 'kaki';
      icon = 'alert';
      break;
    default:
      text = null;
  }
  return (
    <div className="save-indicator-wrap" role="status" aria-live="polite" aria-atomic="true">
      {text && (
        <span className={`save-indicator save-indicator--${tone}`}>
          <Icon name={icon} size={16} />
          {text}
        </span>
      )}
    </div>
  );
}

export function ErrorBanner({ title, children, onRetry, retryLabel = 'Try again' }: { title: ReactNode; children?: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="banner banner--error" role="alert">
      <Icon name="alert" size={20} />
      <div className="banner__text">
        <p className="banner__title">{title}</p>
        {children && <p className="muted">{children}</p>}
      </div>
      {onRetry && (
        <Button small variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/** Shown when a refresh failed but older data is still on screen. */
export function StaleBanner() {
  const { status, loadedAt, refresh, error } = useSnapshot();
  const { zone } = usePrefs();
  const [busy, setBusy] = useState(false);
  if (status !== 'stale' || !loadedAt) return null;
  if (isMisdirected(error)) {
    return (
      <div className="banner banner--stale" role="status">
        <Icon name="info" size={20} />
        <div className="banner__text">
          <p className="banner__title">This address isn't allowed for Kadode.</p>
          <p className="muted">You are looking at data loaded {instant(loadedAt.toISOString(), zone, 'time')}. Open Kadode from the address it was set up with.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="banner banner--stale" role="status">
      <Icon name="clock" size={20} />
      <div className="banner__text">
        <p className="banner__title">
          Showing data loaded {instant(loadedAt.toISOString(), zone, 'time')} — can't reach Kadode right now.
        </p>
        <p className="muted">You can keep reading. Changes will not save until the connection is back.</p>
      </div>
      <Button
        small
        busy={busy}
        onClick={async () => {
          setBusy(true);
          await refresh();
          setBusy(false);
        }}
      >
        Try again
      </Button>
    </div>
  );
}

interface ConflictBannerProps {
  conflict: ConflictError;
  busy?: boolean;
  onKeepTheirs: () => void;
  onUseMine: () => void;
  /** For a single text field: open the editor with both versions together, to be tidied by hand. */
  onCombine?: (theirs: string, yours: string) => void;
}

const NOT_TEXT = /(^|\.)(owner|status|review_date|deadline|priority|visibility)$/;

/** "<Name> changed this while you were editing": show theirs vs yours and let the person choose. */
export function ConflictBanner({ conflict, busy, onKeepTheirs, onUseMine, onCombine }: ConflictBannerProps) {
  const dir = useDir();
  const who = conflict.server?.updated_by ? dir.nameOf(conflict.server.updated_by) : 'Someone';
  const diffs = conflictDiffs(conflict.yourChanges, conflict.server, dir);
  const only = diffs.length === 1 ? diffs[0] : null;
  const canCombine = Boolean(onCombine && only && !NOT_TEXT.test(only.path) && only.theirs !== 'Not set' && only.yours !== 'Not set');
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return (
    <div className="banner banner--conflict" role="alert">
      <Icon name="alert" size={20} />
      <div className="banner__text">
        <p className="banner__title">{who} changed this while you were editing.</p>
        <p className="muted">Nothing was overwritten. Choose which version to keep.</p>
        {diffs.length > 0 && (
          <>
            <div className="conflict-table-wrap conflict-wide">
              <table className="conflict-table">
                <caption className="visually-hidden">Their version beside yours</caption>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">{who}'s version</th>
                    <th scope="col">Your version</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.path}>
                      <th scope="row">{cap(d.label)}</th>
                      <td className="preline">{d.theirs}</td>
                      <td className="preline">{d.yours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="conflict-cards">
              {diffs.map((d) => (
                <li key={d.path}>
                  <p className="conflict-cards__field">{cap(d.label)}</p>
                  <div className="conflict-card">
                    <p className="conflict-card__who">{who}'s version</p>
                    <p className="preline">{d.theirs}</p>
                  </div>
                  <div className="conflict-card">
                    <p className="conflict-card__who">Your version</p>
                    <p className="preline">{d.yours}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row-actions conflict-actions">
          <Button variant="secondary" onClick={onKeepTheirs} disabled={busy}>
            Keep {who}'s version
          </Button>
          <Button variant="secondary" onClick={onUseMine} busy={busy}>
            Use mine instead
          </Button>
          {canCombine && only && (
            <Button variant="secondary" onClick={() => onCombine?.(only.theirs, only.yours)} disabled={busy}>
              Combine them
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
