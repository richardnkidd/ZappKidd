import { useEffect, useState, type ReactNode } from 'react';
import { instant } from '../lib/format';
import { useDir } from './People';
import { usePrefs } from '../state/prefs';
import { useSnapshot } from '../state/snapshot';
import { ConflictError } from '../api/client';
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
      text = 'Someone else changed this — choose which version to keep';
      tone = 'kaki';
      icon = 'alert';
      break;
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
  const { status, loadedAt, refresh } = useSnapshot();
  const { zone } = usePrefs();
  const [busy, setBusy] = useState(false);
  if (status !== 'stale' || !loadedAt) return null;
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
}

/** "<Name> changed this while you were editing": show theirs vs yours and let the person choose. */
export function ConflictBanner({ conflict, busy, onKeepTheirs, onUseMine }: ConflictBannerProps) {
  const dir = useDir();
  const who = conflict.server?.updated_by ? dir.nameOf(conflict.server.updated_by) : 'Someone';
  const diffs = conflictDiffs(conflict.yourChanges, conflict.server, dir);
  return (
    <div className="banner banner--conflict" role="alert">
      <Icon name="alert" size={20} />
      <div className="banner__text">
        <p className="banner__title">{who} changed this while you were editing.</p>
        <p className="muted">Nothing was overwritten. Choose which version to keep.</p>
        {diffs.length > 0 && (
          <div className="conflict-table-wrap">
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
                    <th scope="row">{d.label}</th>
                    <td className="preline">{d.theirs}</td>
                    <td className="preline">{d.yours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row-actions">
          <Button variant="secondary" onClick={onKeepTheirs} disabled={busy}>
            Keep {who}'s version
          </Button>
          <Button variant="primary" onClick={onUseMine} busy={busy}>
            Use mine instead
          </Button>
        </div>
      </div>
    </div>
  );
}
