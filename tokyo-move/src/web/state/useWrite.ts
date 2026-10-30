import { useCallback, useState } from 'react';
import { ConflictError, describeError } from '../net/client';
import { useSnapshot } from './snapshot';

/**
 * Runs one write with busy / error / conflict handling.
 *
 *   const w = useWrite();
 *   await w.run((baseVersion) => actions.patchRecord(id, baseVersion, changes), record.version);
 *
 * On a 409 the person sees the other version beside theirs and chooses: keepTheirs() adopts the server copy,
 * useMine() re-sends the same change on top of the server's version. Nothing is overwritten silently.
 */
export function useWrite() {
  const { actions } = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ err: ConflictError; retry: (baseVersion: number) => Promise<unknown> } | null>(null);

  const run = useCallback(
    async (fn: (baseVersion: number) => Promise<unknown>, baseVersion: number): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await fn(baseVersion);
        setConflict(null);
        return true;
      } catch (e) {
        if (e instanceof ConflictError) setConflict({ err: e, retry: fn });
        else setError(describeError(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const keepTheirs = useCallback(() => {
    if (conflict?.err.server) actions.adoptRecord(conflict.err.server);
    setConflict(null);
  }, [conflict, actions]);

  const useMine = useCallback(async (): Promise<boolean> => {
    if (!conflict) return false;
    const v = conflict.err.serverVersion ?? conflict.err.server?.version;
    if (v === null || v === undefined) {
      setError('We could not find the newer version. Reload the page and try again.');
      return false;
    }
    return run(conflict.retry, v);
  }, [conflict, run]);

  const clear = useCallback(() => {
    setError(null);
    setConflict(null);
  }, []);

  return { run, busy, error, conflict: conflict?.err ?? null, keepTheirs, useMine, clear };
}
