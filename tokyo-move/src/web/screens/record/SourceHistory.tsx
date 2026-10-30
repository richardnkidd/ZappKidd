import { useEffect, useMemo, useState } from 'react';
import type { AuditEntry, ImportChange } from '@shared/types';
import { api, describeError, type RecordDetail } from '../../net/client';
import { Button } from '../../components/Controls';
import { Disclosure } from '../../components/Disclosure';
import { ErrorBanner } from '../../components/Feedback';
import { Skeleton } from '../../components/Layout';
import { describeAudit } from '../../lib/audit';
import { instant } from '../../lib/format';
import { dataOf, type AnyRecord, type Directory, type Indexes } from '../../lib/records';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';

const CHANGE_LABEL: Record<ImportChange['change'], string> = {
  created: 'Added from the plan',
  source_updated: 'Updated from a newer plan',
  local_kept: 'Kept our own edit over the plan',
  correction_applied: 'Corrected after review',
  correction_not_applicable: 'Correction checked — it did not apply here',
  unchanged: 'Unchanged',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Not set';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

type LoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; detail: RecordDetail } | { kind: 'error'; message: string };

export function SourceHistory({ record, idx, dir }: { record: AnyRecord; idx: Indexes; dir: Directory }) {
  const { actions } = useSnapshot();
  const { zone } = usePrefs();
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    const ctl = new AbortController();
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    api
      .record(record.id, ctl.signal)
      .then(async (detail) => {
        // Older servers do not include per-record import receipts; look them up from the latest import runs.
        if (detail.import_changes === undefined) {
          try {
            const runs = (await api.importRuns()).slice(0, 3);
            const found: ImportChange[] = [];
            for (const run of runs) {
              const page = await api.importChanges(run.id, 1000, 0);
              found.push(...page.changes.filter((c) => c.record_id === record.id));
            }
            detail = { ...detail, import_changes: found };
          } catch {
            detail = { ...detail, import_changes: [] };
          }
        }
        if (!ctl.signal.aborted) setState({ kind: 'ready', detail });
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({ kind: 'error', message: describeError(e) });
      });
    return () => ctl.abort();
  }, [opened, record.id, record.version, tick]);

  const detail = state.kind === 'ready' ? state.detail : null;
  const source = detail?.record.source ?? record.source;
  const raw = source?.raw ?? null;
  const reviewNote = dataOf<{ review_note?: string | null }>(record).review_note;
  const audit = useMemo(() => [...(detail?.audit ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1)), [detail]);

  const undo = async (entry: AuditEntry) => {
    setUndoing(entry.id);
    setUndoError(null);
    try {
      await actions.undoAudit(entry.id);
      setTick((t) => t + 1);
    } catch (e) {
      setUndoError(
        (e as { status?: number }).status === 409
          ? 'This has changed since, so it can’t be undone automatically. Make the change by hand instead.'
          : describeError(e),
      );
    } finally {
      setUndoing(null);
    }
  };

  const undoable = (e: AuditEntry) => !e.undone_by && ['update', 'status_change', 'approve', 'reject', 'defer', 'anchor_change'].includes(e.action);

  return (
    <Disclosure title="Source & history" meta="Where this came from" onToggle={(o) => o && setOpened(true)}>
      <div className="stack">
        {reviewNote && (
          <section>
            <h4>Review note</h4>
            <p className="preline">{reviewNote}</p>
          </section>
        )}

        <section>
          <h4>Where this came from</h4>
          {source ? (
            <dl className="facts facts--tight">
              <div className="fact">
                <dt>File</dt>
                <dd>{source.file}</dd>
              </div>
              {source.sheet && (
                <div className="fact">
                  <dt>Sheet</dt>
                  <dd>{source.sheet}</dd>
                </div>
              )}
              {(source.cell_range || source.row) && (
                <div className="fact">
                  <dt>Cells</dt>
                  <dd>{source.cell_range ?? `Row ${source.row}`}</dd>
                </div>
              )}
              <div className="fact">
                <dt>Version of the plan</dt>
                <dd>{source.source_label}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Added in Kadode. It didn’t come from the imported plan.</p>
          )}
        </section>

        <section>
          <h4>Internal reference</h4>
          <p className="muted small">
            Reference <code>{record.key}</code> · record <code>{record.id}</code> · version {record.version}
          </p>
        </section>

        {state.kind === 'loading' && <Skeleton lines={4} />}
        {state.kind === 'error' && (
          <ErrorBanner title="We couldn't load the history." onRetry={() => setTick((t) => t + 1)}>
            {state.message}
          </ErrorBanner>
        )}

        {raw && Object.keys(raw).length > 0 && (
          <section>
            <h4>Original text from the plan</h4>
            <p className="muted small">Exactly as it was read. Never edited.</p>
            <dl className="raw-list">
              {Object.entries(raw).map(([k, v]) => (
                <div key={k} className="raw-list__row">
                  <dt>{k}</dt>
                  <dd className="preline">{show(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {detail && (detail.import_changes?.length ?? 0) > 0 && (
          <section>
            <h4>Import receipts</h4>
            <ul className="receipts">
              {(detail.import_changes ?? []).map((c) => (
                <li key={c.id}>
                  <strong>{CHANGE_LABEL[c.change] ?? c.change}</strong>
                  {c.field && <span className="muted"> · {c.field}</span>}
                  {c.change !== 'unchanged' && c.change !== 'created' && (
                    <p className="small preline">
                      <span className="faint">Before:</span> {show(c.before)}
                      {'\n'}
                      <span className="faint">After:</span> {show(c.after)}
                    </p>
                  )}
                  {c.rationale && <p className="small muted preline">{c.rationale}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail && (
          <section>
            <h4>History</h4>
            {undoError && (
              <p className="field__error" role="alert">
                {undoError}
              </p>
            )}
            {audit.length === 0 ? (
              <p className="muted">No changes recorded yet.</p>
            ) : (
              <ul className="history">
                {audit.map((e) => {
                  const line = describeAudit(e, idx, dir);
                  return (
                    <li key={e.id} className="history__row">
                      <div>
                        <p>
                          <strong>{line.who}</strong> {line.what}
                          {e.undone_by && <span className="faint"> (undone)</span>}
                        </p>
                        {e.reason && <p className="small muted preline">Reason: {e.reason}</p>}
                        <time className="small faint" dateTime={e.at}>
                          {instant(e.at, zone, 'short')}
                        </time>
                      </div>
                      {undoable(e) && (
                        <Button small variant="secondary" icon="undo" busy={undoing === e.id} onClick={() => undo(e)}>
                          Undo
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </Disclosure>
  );
}
