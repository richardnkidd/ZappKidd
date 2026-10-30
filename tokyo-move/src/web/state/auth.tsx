import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse } from '@shared/types';
import { api, isMisdirected, NetworkError, onUnauthenticated } from '../net/client';

type AuthStatus = 'loading' | 'signed_in' | 'signed_out' | 'error';

interface AuthCtx {
  status: AuthStatus;
  me: MeResponse | null;
  error: Error | null;
  reload(): Promise<void>;
  signOut(): Promise<void>;
  /** Called by the sign-in screen after a successful login. */
  completeSignIn(): Promise<void>;
  /** A calm note shown on the sign-in screen (for example after a restore ended every session). */
  notice: string | null;
  /** End the local session without calling the server (it has already ended it) and show a note on sign-in. */
  forceSignOut(notice?: string): void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const m = await api.me();
      if (!alive.current) return;
      setMe(m);
      setError(null);
      setNotice(null);
      setStatus('signed_in');
    } catch (e) {
      if (!alive.current) return;
      if (isMisdirected(e) || e instanceof NetworkError || !(e instanceof Error) || (e as { status?: number }).status !== 401) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setStatus('error');
      } else {
        setMe(null);
        setStatus('signed_out');
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const off = onUnauthenticated(() => {
      setMe(null);
      setStatus('signed_out');
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [reload]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* even if the call fails we return to sign-in; the cookie is HttpOnly and expires server-side */
    }
    setMe(null);
    setStatus('signed_out');
  }, []);

  const forceSignOut = useCallback((text?: string) => {
    setNotice(text ?? null);
    setMe(null);
    setStatus('signed_out');
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ status, me, error, reload, signOut, completeSignIn: reload, notice, forceSignOut }),
    [status, me, error, reload, signOut, notice, forceSignOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function useMe(): MeResponse {
  const { me } = useAuth();
  if (!me) throw new Error('useMe before sign-in');
  return me;
}
