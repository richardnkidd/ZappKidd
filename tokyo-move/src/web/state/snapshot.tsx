import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BaseRecord, Snapshot, TaskLink } from '@shared/types';
import { api, ConflictError, describeError, isMisdirected, type DueMode, type StatusChangeBody } from '../net/client';
import { buildDirectory, buildIndexes, type Directory, type Indexes } from '../lib/records';
import { useMe } from './auth';

export type DataStatus = 'loading' | 'ready' | 'stale' | 'error';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'unsaved' }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

export interface Actions {
  patchRecord(id: string, baseVersion: number, changes: Record<string, unknown>, reason?: string | null): Promise<BaseRecord>;
  setStatus(id: string, body: StatusChangeBody): Promise<BaseRecord>;
  createRecord(body: Parameters<typeof api.createRecord>[0]): Promise<BaseRecord>;
  approveDecision(id: string, baseVersion: number, optionId: string, note?: string | null): Promise<BaseRecord>;
  rejectDecision(id: string, baseVersion: number, rationale: string): Promise<BaseRecord>;
  deferDecision(id: string, baseVersion: number, rationale: string, revisitOn?: string | null): Promise<BaseRecord>;
  proposeTask(body: { title: string; record_id?: string | null; owner?: string | null; due?: string | null; due_mode: DueMode }): Promise<void>;
  retryTask(id: string): Promise<void>;
  /** Set or clear a travel/anchor date (applies it; preview first with the shared engine). */
  setAnchor(code: string, baseVersion: number, body: { date: string | null; confidence: string; evidence?: string | null }): Promise<BaseRecord>;
  undoAudit(auditId: string): Promise<void>;
  /** Replace a record in the local copy (after a successful write, or when someone chooses "keep theirs"). */
  adoptRecord(rec: BaseRecord): void;
}

interface SnapshotCtx {
  snapshot: Snapshot | null;
  idx: Indexes | null;
  dir: Directory | null;
  status: DataStatus;
  loadedAt: Date | null;
  error: Error | null;
  refresh(): Promise<void>;
  save: SaveState;
  /** Register a form as having unsaved changes (drives the global "Unsaved changes" indicator). */
  setDirty(key: string, dirty: boolean): void;
  /** How many forms currently hold changes that have not been saved. */
  dirtyCount: number;
  actions: Actions;
}

const Ctx = createContext<SnapshotCtx | null>(null);

/** Exposed so tests can supply a fake snapshot without network access. */
export const SnapshotContext = Ctx;
export type { SnapshotCtx };

const AUTO_REFRESH_MS = 90_000;

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<DataStatus>('loading');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [dirty, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());
  const inflight = useRef<Promise<void> | null>(null);
  const hasData = useRef(false);
  // After a 421 ("this address isn't allowed") nothing is retried automatically: it would only fail again.
  const blocked = useRef(false);

  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    if (blocked.current) return Promise.resolve();
    const p = (async () => {
      try {
        const s = await api.snapshot();
        hasData.current = true;
        setSnapshot(s);
        setLoadedAt(new Date());
        setError(null);
        setStatus('ready');
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (isMisdirected(e)) blocked.current = true;
        setError(err);
        setStatus(hasData.current ? 'stale' : 'error');
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, AUTO_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const idx = useMemo(
    () => (snapshot ? buildIndexes(snapshot.records, snapshot.task_links) : null),
    [snapshot],
  );
  const dir = useMemo(
    () => (snapshot ? buildDirectory(snapshot.people, me.person.id) : null),
    [snapshot, me.person.id],
  );

  const setDirty = useCallback((key: string, isDirty: boolean) => {
    setDirtyKeys((prev) => {
      if (prev.has(key) === isDirty) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const adoptRecord = useCallback((rec: BaseRecord) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      const found = prev.records.some((r) => r.id === rec.id);
      const records = found ? prev.records.map((r) => (r.id === rec.id ? { ...rec, source: rec.source ?? r.source } : r)) : [...prev.records, rec];
      return { ...prev, records };
    });
  }, []);

  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    setSave({ kind: 'saving' });
    try {
      const out = await p;
      setSave({ kind: 'saved', at: new Date() });
      return out;
    } catch (e) {
      if (e instanceof ConflictError) setSave({ kind: 'conflict' });
      else setSave({ kind: 'error', message: describeError(e) });
      throw e;
    }
  }, []);

  const actions = useMemo<Actions>(() => {
    const written = async (rec: BaseRecord): Promise<BaseRecord> => {
      adoptRecord(rec);
      void refresh(); // audit trail, task links and derived state
      return rec;
    };
    return {
      patchRecord: (id, baseVersion, changes, reason) =>
        track(api.patchRecord(id, { baseVersion, changes, reason: reason ?? undefined })).then(written),
      setStatus: (id, body) => track(api.setStatus(id, body)).then(written),
      createRecord: (body) => track(api.createRecord(body)).then(written),
      approveDecision: (id, baseVersion, option_id, note) =>
        track(api.approveDecision(id, { baseVersion, option_id, note: note ?? null })).then(written),
      rejectDecision: (id, baseVersion, rationale) => track(api.rejectDecision(id, { baseVersion, rationale })).then(written),
      deferDecision: (id, baseVersion, rationale, revisitOn) =>
        track(api.deferDecision(id, { baseVersion, rationale, revisit_on: revisitOn ?? null })).then(written),
      proposeTask: async (body) => {
        await track(api.proposeTask(body));
        await refresh();
      },
      retryTask: async (id) => {
        await track(api.retryTask(id));
        await refresh();
      },
      setAnchor: (code, baseVersion, body) => track(api.putAnchor(code, { baseVersion, ...body })).then((r) => written(r.record)),
      undoAudit: async (auditId) => {
        await track(api.undoAudit(auditId));
        await refresh();
      },
      adoptRecord,
    };
  }, [adoptRecord, refresh, track]);

  // Surface unsaved forms in the global indicator unless a save is in flight.
  const effectiveSave: SaveState = useMemo(() => {
    if (save.kind === 'saving' || save.kind === 'conflict' || save.kind === 'error') return save;
    if (dirty.size > 0) return { kind: 'unsaved' };
    return save;
  }, [save, dirty]);

  const value = useMemo<SnapshotCtx>(
    () => ({ snapshot, idx, dir, status, loadedAt, error, refresh, save: effectiveSave, setDirty, dirtyCount: dirty.size, actions }),
    [snapshot, idx, dir, status, loadedAt, error, refresh, effectiveSave, setDirty, dirty.size, actions],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Like useSnapshot, but returns null outside a provider (used by tiny presentational pieces). */
export function useOptionalSnapshot(): SnapshotCtx | null {
  return useContext(Ctx);
}

export function useSnapshot(): SnapshotCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSnapshot outside SnapshotProvider');
  return v;
}

/** For screens that render only once data exists. Returns null while loading/errored with no data. */
export function useLoaded(): { snapshot: Snapshot; idx: Indexes; dir: Directory } | null {
  const { snapshot, idx, dir } = useSnapshot();
  if (!snapshot || !idx || !dir) return null;
  return { snapshot, idx, dir };
}

export type { TaskLink };
