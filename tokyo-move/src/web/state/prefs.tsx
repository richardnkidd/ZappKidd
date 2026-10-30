import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { SUPPORTED_ZONES, type IanaZone } from '@shared/types';
import { useMe } from './auth';

/** Harmless UI preferences only. Never data. Every access is guarded: storage can be blocked or empty. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function loadPref(key: string): string | null {
  return read(`kadode.${key}`);
}
export function savePref(key: string, value: string): void {
  write(`kadode.${key}`, value);
}

interface PrefsCtx {
  zone: IanaZone;
  setZone(z: IanaZone): void;
}
const Ctx = createContext<PrefsCtx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [zone, setZoneState] = useState<IanaZone>(() => {
    const stored = loadPref('display-zone');
    const ok = SUPPORTED_ZONES.find((z) => z === stored);
    return ok ?? me.household.display_timezone;
  });
  const setZone = useCallback((z: IanaZone) => {
    setZoneState(z);
    savePref('display-zone', z);
  }, []);
  const value = useMemo(() => ({ zone, setZone }), [zone, setZone]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs outside PrefsProvider');
  return v;
}
