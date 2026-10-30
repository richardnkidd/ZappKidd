import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DataGate } from '../../components/DataGate';
import { SegmentedControl } from '../../components/Controls';
import { EmptyState, PageTitle, Card } from '../../components/Layout';
import { Skeleton } from '../../components/Layout';
import {
  activeFilterCount,
  buildPlanItems,
  DEFAULT_FILTERS,
  filterPlanItems,
  parseFilters,
  PLAN_VIEWS,
  serializeFilters,
  type PlanFilters,
  type PlanView,
} from '../../lib/plan';
import type { FilterContext } from '../../lib/home';
import { useData } from '../../state/data';
import { loadPref, savePref } from '../../state/prefs';
import { PlanFilterBar } from './PlanFilterBar';
import { BoardView, ListView, TimelineView, WorkstreamView } from './views';

const VIEW_OPTIONS = [
  { value: 'workstream' as const, label: 'By workstream', icon: 'rows' as const },
  { value: 'list' as const, label: 'List', icon: 'list' as const },
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

  return (
    <div className="page plan">
      <PageTitle kicker="Everything that has to happen">Plan</PageTitle>
      <SegmentedControl label="Plan view" value={view} options={VIEW_OPTIONS} onChange={setView} className="plan-views" />
      <DataGate skeleton={<Card><Skeleton lines={5} /></Card>}>
        {({ idx, dir }) => {
          const ctx: FilterContext = { meId: dir.me?.id ?? null, otherIds: dir.others.map((o) => o.id) };
          const all = buildPlanItems(idx, deadlines.ok ? deadlinesByRecord : undefined);
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
              />
              {filters.hideOptional && hiddenOptional > 0 && (
                <p className="faint small plan-note">
                  {hiddenOptional} optional future {hiddenOptional === 1 ? 'item is' : 'items are'} hidden because they are not part of the move.{' '}
                  <Link to="/future">See Future work</Link>
                </p>
              )}
              <h2 className="visually-hidden">{VIEW_OPTIONS.find((o) => o.value === view)?.label}</h2>
              {shown.length === 0 ? (
                <Card>
                  <EmptyState icon="plan" title="Nothing matches these filters.">
                    Try clearing a filter to see more of the plan.
                  </EmptyState>
                </Card>
              ) : view === 'workstream' ? (
                <WorkstreamView items={shown} idx={idx} today={today} />
              ) : view === 'list' ? (
                <ListView items={shown} dir={dir} today={today} />
              ) : view === 'board' ? (
                <BoardView items={shown} today={today} expanded={expandedBoard} setExpanded={setExpandedBoard} />
              ) : (
                <TimelineView items={shown} idx={idx} dir={dir} today={today} />
              )}
            </>
          );
        }}
      </DataGate>
    </div>
  );
}
