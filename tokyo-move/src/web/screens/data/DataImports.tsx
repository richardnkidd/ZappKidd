import { useCallback, useEffect, useMemo, useState } from 'react';
import { PendingUpdateNotice } from '../../components/PendingUpdateNotice';
import type { ImportChange, ImportRun } from '@shared/types';
import { RECORD_TYPES, RECORD_TYPE_LABEL } from '../../lib/recordTypes';
import { api, ConflictError, describeError, isMisdirected, type BackupInfo } from '../../net/client';
import { Chip } from '../../components/Badges';
import { Button, Field, Select, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Dialog } from '../../components/Dialog';
import { Disclosure } from '../../components/Disclosure';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, PageTitle, Section, Skeleton } from '../../components/Layout';
import { RecordLink } from '../../components/RecordLink';
import { instant, plural } from '../../lib/format';
import type { Indexes } from '../../lib/records';
import { useAuth } from '../../state/auth';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';

const COUNT_LABEL: Record<string, string> = {
  created: 'Added from the plan',
  updated: 'Updated from the plan',
  kept_local: 'Kept our own edit',
  corrections: 'Corrected after review',
  unchanged: 'Unchanged',
  not_applicable: 'Corrections not needed',
  missing_from_source: 'No longer in the source',
  task_links_created: 'Task-list entries added',
  task_links_updated: 'Task-list entries updated',
};

const STATUS: Record<ImportRun['status'], { label: string; tone: 'matcha' | 'neutral' | 'kaki' }> = {
  completed: { label: 'Completed', tone: 'matcha' },
  no_changes: { label: 'Nothing new in the files', tone: 'neutral' },
  failed: { label: 'Did not finish', tone: 'kaki' },
};

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ------------------------------------------------------------------ receipts */

async function loadAllChanges(runId: string, signal: { cancelled: boolean }): Promise<{ changes: ImportChange[]; total: number }> {
  const all: ImportChange[] = [];
  let total = 0;
  for (let page = 0; page < 8; page += 1) {
    const r = await api.importChanges(runId, { limit: 500, offset: page * 500 });
    if (signal.cancelled) break;
    total = r.total;
    all.push(...r.changes);
    if (all.length >= r.total || r.changes.length === 0) break;
  }
  return { changes: all, total };
}

function Receipts({ run, idx }: { run: ImportRun; idx: Indexes }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; changes: ImportChange[]; total: number }>({ kind: 'loading' });
  const [only, setOnly] = useState('all');
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState<Record<string, number>>({});

  useEffect(() => {
    const flag = { cancelled: false };
    setState({ kind: 'loading' });
    loadAllChanges(run.id, flag)
      .then((r) => !flag.cancelled && setState({ kind: 'ready', ...r }))
      .catch((e) => !flag.cancelled && setState({ kind: 'error', message: describeError(e) }));
    return () => {
      flag.cancelled = true;
    };
  }, [run.id, tick]);

  const groups = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const byCorrection = new Map<string, { id: string; rationale: string | null; applied: ImportChange[]; skipped: ImportChange[] }>();
    const other = new Map<string, number>();
    const kept: ImportChange[] = [];
    for (const c of state.changes) {
      if (c.correction_id) {
        const g = byCorrection.get(c.correction_id) ?? { id: c.correction_id, rationale: null, applied: [], skipped: [] };
        if (c.rationale && !g.rationale) g.rationale = c.rationale;
        (c.change === 'correction_not_applicable' ? g.skipped : g.applied).push(c);
        byCorrection.set(c.correction_id, g);
      } else {
        other.set(c.change, (other.get(c.change) ?? 0) + 1);
        if (c.change === 'local_kept') kept.push(c);
      }
    }
    return { corrections: [...byCorrection.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), other, kept };
  }, [state]);

  if (state.kind === 'loading') return <Skeleton lines={4} />;
  if (state.kind === 'error')
    return (
      <ErrorBanner title="We couldn't load the receipts." onRetry={() => setTick((t) => t + 1)}>
        {state.message}
      </ErrorBanner>
    );
  if (!groups) return null;
  const visible = only === 'all' ? groups.corrections : groups.corrections.filter((g) => g.id === only);
  const titleFor = (c: ImportChange) => idx.byId.get(c.record_id)?.title ?? null;
  const OTHER_LABEL: Record<string, string> = { created: 'Records added', source_updated: 'Records updated from a newer plan', local_kept: 'Our own edits kept over the plan', unchanged: 'Records unchanged' };

  return (
    <div className="stack">
      <p className="muted small">
        {plural(state.total, 'receipt')} in total. Each one records what the import did to a record and why.
      </p>
      <ul className="receipt-summary">
        {[...groups.other.entries()].map(([k, n]) => (
          <li key={k}>
            <strong>{n}</strong> {OTHER_LABEL[k] ?? k.replace(/_/g, ' ')}
          </li>
        ))}
      </ul>
      {groups.kept.length > 0 && (
        <Disclosure title="Our own edits that were kept" meta={String(groups.kept.length)} level={4} className="disclosure--flat">
          <ul className="plain-list">
            {groups.kept.slice(0, shown.kept ?? 20).map((c) => (
              <li key={c.id}>
                <RecordLink id={c.record_id}>{titleFor(c) ?? 'A record'}</RecordLink>
                {c.field && <span className="muted"> — {c.field.replace(/^data\./, '').replace(/_/g, ' ')}</span>}
              </li>
            ))}
          </ul>
          {groups.kept.length > (shown.kept ?? 20) && (
            <Button variant="quiet" onClick={() => setShown((s) => ({ ...s, kept: (s.kept ?? 20) + 40 }))}>
              Show more
            </Button>
          )}
        </Disclosure>
      )}
      {groups.corrections.length > 0 && (
        <>
          <Field label="Show corrections">
            <Select value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="all">All {groups.corrections.length}</option>
              {groups.corrections.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id} ({g.applied.length + g.skipped.length})
                </option>
              ))}
            </Select>
          </Field>
          <ul className="stack stack--tight">
            {visible.map((g) => {
              const limit = shown[g.id] ?? 8;
              return (
                <li key={g.id}>
                  <Card tone="inset" className="correction">
                    <p className="correction__id">
                      <Icon name="check" size={14} /> {g.id}
                    </p>
                    {g.rationale && <p className="preline">{g.rationale}</p>}
                    <p className="small muted">
                      Applied to {plural(g.applied.length, 'record')}
                      {g.skipped.length > 0 ? `; checked and did not apply to ${g.skipped.length}` : ''}.
                    </p>
                    {g.applied.length > 0 && (
                      <ul className="plain-list small">
                        {g.applied.slice(0, limit).map((c) => (
                          <li key={c.id}>
                            <RecordLink id={c.record_id}>{titleFor(c) ?? 'A record'}</RecordLink>
                            {c.field && <span className="muted"> — {c.field.replace(/^data\./, '').replace(/_/g, ' ')}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {g.applied.length > limit && (
                      <Button variant="quiet" small onClick={() => setShown((s) => ({ ...s, [g.id]: limit + 20 }))}>
                        Show more
                      </Button>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ runs */

function RunCard({ run, idx, latest }: { run: ImportRun; idx: Indexes; latest: boolean }) {
  const { zone } = usePrefs();
  const st = STATUS[run.status] ?? { label: run.status, tone: 'neutral' as const };
  const counts = Object.entries(run.counts ?? {}).filter(([, n]) => typeof n === 'number');
  const outcomes = counts.filter(([k, n]) => COUNT_LABEL[k] && (n > 0 || ['created', 'updated', 'unchanged'].includes(k)));
  const perType = counts.filter(([k, n]) => RECORD_TYPE_LABEL[k] && n > 0);
  return (
    <Card as="article" className="run" aria-label={`Import of ${run.source_label}`}>
      <div className="item__meta">
        <Chip small tone={st.tone}>
          {st.label}
        </Chip>
        {latest && (
          <Chip small tone="ai">
            Latest
          </Chip>
        )}
      </div>
      <h3 className="doc__title">{run.source_label}</h3>
      <p>
        {run.status === 'failed'
          ? `This import did not finish (${instant(run.finished_at ?? run.started_at, zone, 'long')}). The receipts below show what happened.`
          : run.status === 'no_changes'
            ? `Checked on ${instant(run.finished_at ?? run.started_at, zone, 'long')}: nothing new in the files. Everything is in place.`
            : `Your plan was imported on ${instant(run.finished_at ?? run.started_at, zone, 'long')} from “${run.source_label}”. Everything is in place.`}
      </p>
      {run.summary && <p className="preline muted">{run.summary}</p>}
      {outcomes.length > 0 && (
        <ul className="coverage" aria-label="What the import did">
          {outcomes.map(([k, n]) => (
            <li key={k} className="coverage__row">
              <span>{COUNT_LABEL[k]}</span>
              <strong>{n}</strong>
            </li>
          ))}
        </ul>
      )}
      {(run.counts?.not_applicable ?? 0) > 0 && (
        <p className="small muted">
          “Corrections not needed” usually means the record was already right, so nothing was lost. The receipts below list which ones.
        </p>
      )}
      {run.files.length > 0 && (
        <Disclosure title="Technical details" level={4} className="disclosure--flat">
          <ul className="files">
            {run.files.map((f) => (
              <li key={f.sha256 + f.name}>
                <Icon name="file" size={14} /> {f.name} <span className="faint small">· {kb(f.bytes)} · fingerprint <code>{f.sha256.slice(0, 8)}</code></span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {perType.length > 0 && (
        <Disclosure title="Records read, by kind" meta={String(perType.reduce((a, [, n]) => a + n, 0))} level={4} className="disclosure--flat">
          <ul className="coverage">
            {perType.map(([k, n]) => (
              <li key={k} className="coverage__row">
                <span>{RECORD_TYPE_LABEL[k]}</span>
                <strong>{n}</strong>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <Disclosure title="Receipts" level={4} className="disclosure--flat">
        <Receipts run={run} idx={idx} />
      </Disclosure>
    </Card>
  );
}

function ImportRuns({ idx }: { idx: Indexes }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; runs: ImportRun[] }>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    api
      .importRuns()
      .then((runs) => alive && setState({ kind: 'ready', runs }))
      .catch((e) => alive && setState({ kind: 'error', message: describeError(e) }));
    return () => {
      alive = false;
    };
  }, [tick]);
  if (state.kind === 'loading') return <Card><Skeleton lines={4} /></Card>;
  if (state.kind === 'error')
    return (
      <ErrorBanner title="We couldn't load the import history." onRetry={() => setTick((t) => t + 1)}>
        {state.message}
      </ErrorBanner>
    );
  if (state.runs.length === 0)
    return (
      <Card>
        <EmptyState icon="database" title="No plan has been imported yet." />
      </Card>
    );
  return (
    <ul className="stack">
      {state.runs.map((r, i) => (
        <li key={r.id}>
          <RunCard run={r} idx={idx} latest={i === 0} />
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ what is stored */

function StoredCounts({ idx }: { idx: Indexes }) {
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of idx.all) c.set(r.type, (c.get(r.type) ?? 0) + 1);
    return RECORD_TYPES.filter((t) => c.has(t.type)).map((t) => ({ ...t, n: c.get(t.type)! }));
  }, [idx]);
  return (
    <ul className="coverage">
      {counts.map((c) => (
        <li key={c.type} className="coverage__row">
          <span>{c.label}</span>
          <strong>{c.n}</strong>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ task list */

function TaskListStatus({ idx }: { idx: Indexes }) {
  const { snapshot, refresh } = useSnapshot();
  const { zone } = usePrefs();
  const adapter = snapshot?.settings?.task_adapter;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const states = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of idx.taskLinks) c.set(t.sync_state, (c.get(t.sync_state) ?? 0) + 1);
    return c;
  }, [idx]);
  if (!adapter) return <p className="muted">The task-list connection is not known.</p>;
  const asOf = adapter.as_of ? instant(adapter.as_of.length === 10 ? `${adapter.as_of}T12:00:00Z` : adapter.as_of, zone, 'short') : 'an unknown date';
  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.syncTasks();
      await refresh();
      setMsg('Refreshed.');
    } catch (e) {
      setMsg(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {adapter.can_write ? (
        <p>{adapter.note || 'Connected to a task store you can write to.'}</p>
      ) : (
        <p>
          Your real task list is shown as a dated copy (as of {asOf}). Nothing is written to it. New actions wait as “Waiting to be added”.
        </p>
      )}
      {states.size > 0 && (
        <ul className="plain-list small muted">
          {[...states.entries()].map(([k, n]) => (
            <li key={k}>
              {n} {k === 'snapshot' ? 'read-only copies' : k === 'pending_capture' ? 'waiting to be added' : k === 'synced' ? 'up to date' : k.replace(/_/g, ' ')}
            </li>
          ))}
        </ul>
      )}
      <div className="row-actions">
        <Button variant="secondary" busy={busy} icon="sync" onClick={sync}>
          Refresh the copy
        </Button>
      </div>
      {msg && <p className="small muted" role="status">{msg}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ export */

function Export({ idx }: { idx: Indexes }) {
  const types = useMemo(() => RECORD_TYPES.filter((t) => idx.all.some((r) => r.type === t.type)), [idx]);
  return (
    <Card>
      <p className="muted">Take a copy of everything. Nothing leaves your computer until you open the file.</p>
      <div className="row-actions">
        <a className="btn btn--secondary" href="/api/export?format=json" download>
          <Icon name="file" size={18} /> Everything (JSON)
        </a>
      </div>
      <Disclosure title="One list at a time (CSV, opens in a spreadsheet)" level={3} className="disclosure--flat">
        <ul className="csv-list">
          {types.map((t) => (
            <li key={t.type}>
              <a href={`/api/export?format=csv&type=${encodeURIComponent(t.type)}`} download>
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </Disclosure>
    </Card>
  );
}

/* ------------------------------------------------------------------ backups */

function Backups() {
  const { zone } = usePrefs();
  const { refresh } = useSnapshot();
  const { forceSignOut } = useAuth();
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string; retry: boolean } | { kind: 'ready'; backups: BackupInfo[] }>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  /** Step 1 keeps today's logins; step 2 appears only when the backup has different logins. */
  const [step, setStep] = useState<'plain' | 'users'>('plain');
  const [typed, setTyped] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listBackups()
      .then((r) => setState({ kind: 'ready', backups: [...r.backups].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) }))
      .catch((e) => setState({ kind: 'error', message: describeError(e), retry: !isMisdirected(e) }));
  }, []);
  useEffect(load, [load]);

  const backup = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.createBackup();
      setMsg(`Backup saved: ${r.backup.name}`);
      load();
    } catch (e) {
      setMsg(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const open = (b: BackupInfo) => {
    setRestoring(b);
    setStep('plain');
    setTyped('');
    setRestoreError(null);
  };
  const close = () => {
    setRestoring(null);
    setStep('plain');
    setTyped('');
  };

  const restore = async () => {
    if (!restoring) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      const r = await api.restoreBackup(restoring.name, step === 'users' ? 'RESTORE-INCLUDING-USERS' : 'RESTORE');
      close();
      if (r.restore.session_invalidated) {
        // The server has ended every session, this one included. Go to sign-in with a plain note.
        forceSignOut('Restored. Everyone has been signed out; sign in again.');
        return;
      }
      setMsg(`Restored from ${r.restore.restored_from}. The state just before was saved as ${r.restore.pre_restore_backup}.`);
      await refresh();
      load();
    } catch (e) {
      if (e instanceof ConflictError && (e.details as { reason?: string } | undefined)?.reason === 'users_differ') {
        // Different logins: nothing changed yet. Ask again, explicitly, before bringing the backup's logins back.
        setStep('users');
        setTyped('');
      } else {
        setRestoreError(describeError(e));
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  const needed = step === 'users' ? 'RESTORE-INCLUDING-USERS' : 'RESTORE';

  return (
    <div className="stack">
      <Card>
        <p className="muted">A backup is a safe copy of the whole plan. Restoring replaces everything with the copy you pick, after saving the current state first. Everyone is signed out afterwards.</p>
        <div className="row-actions">
          <Button variant="primary" busy={busy} icon="database" onClick={backup}>
            Back up now
          </Button>
        </div>
        {msg && <p role="status" className="small">{msg}</p>}
      </Card>
      {state.kind === 'loading' && <Skeleton lines={3} />}
      {state.kind === 'error' && (
        <ErrorBanner title="We couldn't load the backups." onRetry={state.retry ? load : undefined}>
          {state.message}
        </ErrorBanner>
      )}
      {state.kind === 'ready' &&
        (state.backups.length === 0 ? (
          <p className="muted">No backups yet.</p>
        ) : (
          <ul className="stack stack--tight">
            {state.backups.map((b) => (
              <li key={b.name} className="backup">
                <div>
                  <p className="backup__name">{instant(b.created_at, zone, 'long')}</p>
                  <p className="small faint">
                    {kb(b.bytes)} · {b.name}
                    {b.name.includes('pre-restore') ? ' · saved automatically before a restore' : ''}
                  </p>
                </div>
                <Button variant="secondary" small onClick={() => open(b)}>
                  Restore…
                </Button>
              </li>
            ))}
          </ul>
        ))}
      {restoring && (
        <Dialog
          open
          onClose={close}
          title={step === 'users' ? 'This backup has different logins' : 'Restore this backup?'}
          description={
            step === 'users'
              ? 'The backup was made when different people could sign in than can now. Nothing has been changed yet.'
              : `This replaces everything with the copy from ${instant(restoring.created_at, zone, 'long')}. Anything changed since then will be gone from the app, though the current state is saved first. Everyone will be signed out.`
          }
          footer={
            <>
              <Button variant="quiet" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" busy={restoreBusy} disabled={typed !== needed} onClick={restore}>
                {step === 'users' ? 'Restore and bring back its logins' : 'Restore'}
              </Button>
            </>
          }
        >
          {step === 'users' && (
            <p className="preline">
              To go ahead, the backup’s own list of logins would replace today’s, as well as the plan. That changes who can sign in, and everyone is signed out afterwards. If you don’t want that, cancel: nothing has been changed.
            </p>
          )}
          <Field label={`Type ${needed} to confirm`} error={restoreError}>
            <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function DataImports() {
  return (
    <div className="page data">
      <PageTitle kicker="Where the plan came from">Data & imports</PageTitle>
      <PendingUpdateNotice />
      <DataGate>
        {({ idx }) => (
          <div className="stack stack--loose">
            <Section title="Imports" headingLevel={2} intro="Each time a plan file was read. Reading the same files again changes nothing.">
              <ImportRuns idx={idx} />
            </Section>
            <Section title="What is stored now" headingLevel={2}>
              <Card>
                <StoredCounts idx={idx} />
              </Card>
            </Section>
            <Section title="Your task list" headingLevel={2}>
              <TaskListStatus idx={idx} />
            </Section>
            <Section title="Export" headingLevel={2}>
              <Export idx={idx} />
            </Section>
            <Section title="Backups" headingLevel={2}>
              <Backups />
            </Section>
          </div>
        )}
      </DataGate>
    </div>
  );
}
