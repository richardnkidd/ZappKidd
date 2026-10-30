import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ComputedDeadline, TravelerReadiness } from '@shared/engine-contracts';
import { todayIn } from '@shared/dates';
import { collectDeadlines } from '@shared/deadlines';
import { householdReadiness } from '@shared/readiness';
import type { IanaZone } from '@shared/types';
import { attempt, type Attempt } from '../lib/safe';
import { usePrefs } from './prefs';
import { useSnapshot } from './snapshot';

interface DataCtx {
  today: string;
  zone: IanaZone;
  /** All deadlines from the shared engine, or the error if the engine could not run. */
  deadlines: Attempt<ComputedDeadline[]>;
  deadlinesByRecord: Map<string, ComputedDeadline[]>;
  readiness: Attempt<TravelerReadiness[]>;
}

const Ctx = createContext<DataCtx | null>(null);

/** Re-render when the civil day changes in the display zone (checked once a minute). */
function useToday(zone: IanaZone): string {
  const [today, setToday] = useState(() => todayIn(zone));
  useEffect(() => {
    setToday(todayIn(zone));
    const t = window.setInterval(() => setToday(todayIn(zone)), 60_000);
    return () => window.clearInterval(t);
  }, [zone]);
  return today;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { zone } = usePrefs();
  const today = useToday(zone);
  const { snapshot } = useSnapshot();

  const deadlines = useMemo<Attempt<ComputedDeadline[]>>(
    () =>
      snapshot
        ? attempt(() =>
            collectDeadlines({ records: snapshot.records, people: snapshot.people, task_links: snapshot.task_links, today }),
          )
        : { ok: true, value: [] },
    [snapshot, today],
  );

  const deadlinesByRecord = useMemo(() => {
    const map = new Map<string, ComputedDeadline[]>();
    if (deadlines.ok) {
      for (const d of deadlines.value) {
        if (!d.record_id) continue;
        const list = map.get(d.record_id) ?? [];
        list.push(d);
        map.set(d.record_id, list);
      }
    }
    return map;
  }, [deadlines]);

  const readiness = useMemo<Attempt<TravelerReadiness[]>>(
    () =>
      snapshot
        ? attempt(() => householdReadiness(snapshot.people, snapshot.records, snapshot.settings?.traveler_gates ?? [], today))
        : { ok: true, value: [] },
    [snapshot, today],
  );

  const value = useMemo(() => ({ today, zone, deadlines, deadlinesByRecord, readiness }), [today, zone, deadlines, deadlinesByRecord, readiness]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}
