import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DataGate } from '../../components/DataGate';
import { SegmentedControl } from '../../components/Controls';
import { Button } from '../../components/Controls';
import { EmptyState, PageTitle, Card } from '../../components/Layout';
import { Skeleton } from '../../components/Layout';
import {
  activeFilterCount,
  buildPlanItems,
  DEFAULT_FILTERS,
  filterPlanItems,
  parseFilters,
  PLAN_VIEWS,
  quickFilterOf,
  serializeFilters,
  type PlanFilters,
  type PlanView,
} from '../../lib/plan';
import type { FilterContext } from '../../lib/home';
import { useData } from '../../state/data';
import { loadPref, savePref } from '../../state/prefs';
import { PlanFilterBar } from './PlanFilterBar';
import { WorkloadLine } from './WorkloadLine';
import { BoardView, ListView, TimelineView, WorkstreamView } from './views';

const VIEW_OPTIONS = [
  { value: 'workstream' as const, label: 'List', icon: 'rows' as const },
  { value: 'list' as const, label: 'By date', icon: 'list' as const },
  { value: 'board' as const, label: 'Board', icon: 'board' as const },
  { value: 'timeline' as const, label: 'Timeline', icon: 'timeline' as const },
];

export function Plan() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: PlanView = (PLAN_VIEWS as string[]).includes(requested ?? '')
    ? (requested as PlanView)
    : (() => {
        const stored = loadPref('plan-view');
        return (PLAN_VIEWS as string[]).includes(stored ?? '') ? (stored as PlanView) : 'workstream';
      })();
  const filters = useMemo(() => parseFilters(params), [params]);

  const update = useCallback(
    (nextFilters: PlanFilters, nextView: PlanView) => {
      setParams(serializeFilters(nextFilters, nextView, new URLSearchParams()), { replace: true });
    },
    [setParams],
  );

  const setView = (v: PlanView) => {
    savePref('plan-view', v);
    // Always write the view explicitly so the URL reflects what is shown.
    const p = serializeFilters(filters, v, params);
    p.set('view', v);
    setParams(p, { replace: true });
  };

  const { deadlinesByRecord, deadlines, today } = useData();
  const [expandedBoard, setExpandedBoard] = useState<Record<string, boolean>>({});
  // Where focus goes after a one-tap Done note ends or a save fails: the heading of the view being shown.
  const viewHeading = useRef<HTMLHeadingElement>(null);

  return (
    <div className="page plan">
      <PageTitle>Plan</PageTitle>
      <SegmentedControl label="Plan view" value={view} options={VIEW_OPTIONS} onChange={setView} className="plan-views" />
      <DataGate skeleton={<Card><Skeleton lines={5} /></Card>}>
        {({ snapshot, idx, dir }) => {
          const ctx: FilterContext = { meId: dir.me?.id ?? null, otherIds: dir.others.map((o) => o.id) };
          const all = buildPlanItems(idx, deadlines.ok ? deadlinesByRecord : undefined, today);
          const shown = filterPlanItems(all, filters, ctx);
          const hiddenOptional = filters.hideOptional ? all.filter((i) => i.m.data?.optional_future_work).length : 0;
          return (
            <>
              <PlanFilterBar
                filters={filters}
                dir={dir}
                onChange={(f) => update(f, view)}
                onReset={() => update({ ...DEFAULT_FILTERS }, view)}
                activeCount={activeFilterCount(filters)}
                shown={shown.length}
                total={all.length}
                hiddenOptional={hiddenOptional}
              >
                <WorkloadLine idx={idx} dir={dir} />
              </PlanFilterBar>
              <h2 className="visually-hidden" ref={viewHeading} tabIndex={-1}>{VIEW_OPTIONS.find((o) => o.value === view)?.label}</h2>
              {shown.length === 0 ? (
                <Card>
                  <EmptyState icon="plan" title="Nothing matches." action={<Button variant="secondary" onClick={() => update({ ...DEFAULT_FILTERS }, view)}>Show everything</Button>} />
                </Card>
              ) : view === 'workstream' ? (
                <WorkstreamView items={shown} idx={idx} today={today} filtered={quickFilterOf(filters) !== 'all'} focusRef={viewHeading} />
              ) : view === 'list' ? (
                <ListView items={shown} idx={idx} today={today} focusRef={viewHeading} />
              ) : view === 'board' ? (
                <BoardView items={shown} idx={idx} today={today} expanded={expandedBoard} setExpanded={setExpandedBoard} />
              ) : (
                <TimelineView items={shown} idx={idx} dir={dir} today={today} settings={snapshot.settings} />
              )}
            </>
          );
        }}
      </DataGate>
    </div>
  );
}
