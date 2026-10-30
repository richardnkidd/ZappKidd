import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ComputedDeadline, TravelerReadiness } from '@shared/engine-contracts';
import { todayIn } from '@shared/dates';
import { collectDeadlines, type DeadlineContext } from '@shared/deadlines';
import { householdReadiness } from '@shared/readiness';
import type { IanaZone } from '@shared/types';
import { setFormatToday } from '../lib/format';
import { attempt, type Attempt } from '../lib/safe';
import { usePrefs } from './prefs';
import { useSnapshot } from './snapshot';

interface DataCtx {
  today: string;
  /** Inputs for deadline previews (anchor changes, what-if). Same data the engine already used. */
  deadlineContext: DeadlineContext;
  zone: IanaZone;
  /** All deadlines from the shared engine, or the error if the engine could not run. */
  deadlines: Attempt<ComputedDeadline[]>;
  deadlinesByRecord: Map<string, ComputedDeadline[]>;
  /** Rule-derived dates by the key of each record they date (rule.linked_records), for record pages. */
  deadlinesByLinkedKey: Map<string, ComputedDeadline[]>;
  readiness: Attempt<TravelerReadiness[]>;
}

const Ctx = createContext<DataCtx | null>(null);

/** Re-render when the civil day changes in the display zone (checked once a minute). */
function useToday(zone: IanaZone): string {
  const [today, setToday] = useState(() => {
    const t = todayIn(zone);
    setFormatToday(t);
    return t;
  });
  useEffect(() => {
    const tick = () => {
      const t = todayIn(zone);
      setFormatToday(t);
      setToday(t);
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
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
            collectDeadlines({ records: snapshot.records, people: snapshot.people, task_links: snapshot.task_links, today, jp_holidays: snapshot.settings?.jp_holidays }),
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

  const deadlinesByLinkedKey = useMemo(() => {
    const map = new Map<string, ComputedDeadline[]>();
    if (deadlines.ok) {
      for (const d of deadlines.value) {
        if (d.source !== 'rule') continue;
        for (const k of d.linked_record_keys ?? []) {
          const list = map.get(k) ?? [];
          list.push(d);
          map.set(k, list);
        }
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

  const deadlineContext = useMemo<DeadlineContext>(
    () => ({ records: snapshot?.records ?? [], people: snapshot?.people ?? [], task_links: snapshot?.task_links ?? [], today, jp_holidays: snapshot?.settings?.jp_holidays }),
    [snapshot, today],
  );

  const value = useMemo(
    () => ({ today, zone, deadlineContext, deadlines, deadlinesByRecord, deadlinesByLinkedKey, readiness }),
    [today, zone, deadlineContext, deadlines, deadlinesByRecord, deadlinesByLinkedKey, readiness],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}
