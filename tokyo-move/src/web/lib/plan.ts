/** Plan filtering, sorting and grouping. Pure, so it can be tested without React. */
import type { ComputedDeadline } from '@shared/engine-contracts';
import { PHASE_ORDER, PRIORITY_ORDER, WORK_STATUS_ORDER } from '@shared/labels';
import type { DeadlineKind, PhaseKey, WorkStatus } from '@shared/types';
import { compareDates } from './format';
import { matchesOwnerFilter, milestoneDate, type FilterContext, type OwnerFilter } from './home';
import { whenFor, type WhenInfo } from './when';
import { isOpenWork, unmetDependencyKeys, type Indexes, type Milestone } from './records';
import type { DeadlineState } from '@shared/engine-contracts';

export type PlanView = 'workstream' | 'list' | 'board' | 'timeline';
export const PLAN_VIEWS: PlanView[] = ['workstream', 'list', 'board', 'timeline'];

export type PlanOwnerFilter = Exclude<OwnerFilter, 'waiting' | 'needs_me'>;

export interface PlanFilters {
  owner: PlanOwnerFilter;
  /** 'all' | person id | 'household' (records that gate no one in particular) */
  traveler: string;
  phase: 'all' | PhaseKey;
  status: 'all' | 'open' | WorkStatus;
  hideOptional: boolean;
}

export const DEFAULT_FILTERS: PlanFilters = { owner: 'all', traveler: 'all', phase: 'all', status: 'all', hideOptional: true };

export function parseFilters(params: URLSearchParams): PlanFilters {
  const owner = params.get('owner') ?? 'all';
  const phase = params.get('phase') ?? 'all';
  const status = params.get('status') ?? 'all';
  return {
    owner: (['all', 'mine', 'other', 'together', 'unassigned'] as const).find((o) => o === owner) ?? 'all',
    traveler: params.get('traveler') ?? 'all',
    phase: (PHASE_ORDER as readonly string[]).includes(phase) ? (phase as PhaseKey) : 'all',
    status: status === 'all' || status === 'open' || (WORK_STATUS_ORDER as readonly string[]).includes(status) ? (status as PlanFilters['status']) : 'all',
    hideOptional: params.get('optional') !== 'show',
  };
}

export function serializeFilters(f: PlanFilters, view: PlanView, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const set = (k: string, v: string, dflt: string) => (v === dflt ? p.delete(k) : p.set(k, v));
  set('view', view, 'workstream');
  set('owner', f.owner, 'all');
  set('traveler', f.traveler, 'all');
  set('phase', f.phase, 'all');
  set('status', f.status, 'all');
  if (f.hideOptional) p.delete('optional');
  else p.set('optional', 'show');
  return p;
}

export function activeFilterCount(f: PlanFilters): number {
  return (
    (f.owner !== 'all' ? 1 : 0) +
    (f.traveler !== 'all' ? 1 : 0) +
    (f.phase !== 'all' ? 1 : 0) +
    (f.status !== 'all' ? 1 : 0) +
    (!f.hideOptional ? 1 : 0)
  );
}

export interface PlanItemData {
  m: Milestone;
  date: string | null;
  dateKind: DeadlineKind | null;
  dateState: DeadlineState | null;
  /** The one date a card shows (legal > contract > our target > task-list date > check-in). */
  when: WhenInfo;
  unmet: string[];
}

export function buildPlanItems(idx: Indexes, byRecord?: Map<string, ComputedDeadline[]>, today: string = new Date().toISOString().slice(0, 10)): PlanItemData[] {
  return idx.milestones.map((m) => {
    const rank = milestoneDate(m, byRecord?.get(m.id));
    return { m, date: rank.date, dateKind: rank.kind, dateState: rank.state, when: whenFor(m, idx, byRecord?.get(m.id), today), unmet: unmetDependencyKeys(m, idx) };
  });
}

export function filterPlanItems(items: PlanItemData[], f: PlanFilters, ctx: FilterContext): PlanItemData[] {
  return items.filter(({ m }) => {
    if (f.hideOptional && m.data?.optional_future_work) return false;
    if (!matchesOwnerFilter(f.owner, m.owner, m.status, ctx)) return false;
    if (f.traveler !== 'all') {
      const scope = m.data?.traveler_scope ?? [];
      if (f.traveler === 'household' ? scope.length > 0 : !scope.includes(f.traveler)) return false;
    }
    if (f.phase !== 'all' && m.data?.phase !== f.phase) return false;
    if (f.status === 'open' ? !isOpenWork(m.status) : f.status !== 'all' && m.status !== f.status) return false;
    return true;
  });
}

export type SortKey = 'date' | 'status' | 'owner' | 'title' | 'priority';

const statusRank = (s: string) => {
  const i = (WORK_STATUS_ORDER as readonly string[]).indexOf(s);
  return i < 0 ? 99 : i;
};
const prioRank = (p: string | null | undefined) => {
  const i = p ? (PRIORITY_ORDER as readonly string[]).indexOf(p) : -1;
  return i < 0 ? 99 : i;
};
const keyNum = (a: Milestone, b: Milestone) => a.key.localeCompare(b.key, undefined, { numeric: true });

export function sortPlanItems(items: PlanItemData[], key: SortKey, ownerLabel: (o: string | null) => string): PlanItemData[] {
  const out = [...items];
  out.sort((a, b) => {
    let c = 0;
    switch (key) {
      case 'date':
        c = compareDates(a.date, b.date);
        break;
      case 'status':
        c = statusRank(a.m.status) - statusRank(b.m.status);
        break;
      case 'owner':
        c = ownerLabel(a.m.owner).localeCompare(ownerLabel(b.m.owner));
        break;
      case 'title':
        c = a.m.title.localeCompare(b.m.title);
        break;
      case 'priority':
        c = prioRank(a.m.data?.priority) - prioRank(b.m.data?.priority);
        break;
    }
    return c !== 0 ? c : keyNum(a.m, b.m);
  });
  return out;
}

/** Group by workstream key, ordered by the workstream's own key; items without one go last. */
export function groupByWorkstream(items: PlanItemData[], idx: Indexes): { key: string; title: string; related: string[]; items: PlanItemData[] }[] {
  const groups = new Map<string, PlanItemData[]>();
  for (const it of items) {
    const k = it.m.data?.workstream_key ?? '';
    const list = groups.get(k) ?? [];
    list.push(it);
    groups.set(k, list);
  }
  const out = [...groups.entries()].map(([key, list]) => {
    const ws = key ? idx.byKey.get(key) : undefined;
    const related = (ws?.data as { related?: unknown } | undefined)?.related;
    return {
      key,
      title: ws?.title ?? (key ? key : 'Other work'),
      related: Array.isArray(related) ? related.filter((r): r is string => typeof r === 'string') : [],
      items: list,
    };
  });
  out.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key.localeCompare(b.key, undefined, { numeric: true })));
  return out;
}

/** Group by the record's own `work_area` text (used when the workstream mapping is missing for most items). */
export function groupByArea(items: PlanItemData[]): { key: string; title: string; related: string[]; items: PlanItemData[] }[] {
  const groups = new Map<string, PlanItemData[]>();
  for (const it of items) {
    const k = (it.m.data?.work_area ?? '').trim();
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const soonest = (list: PlanItemData[]) =>
    list
      .filter((i) => isOpenWork(i.m.status) && i.when.primary)
      .map((i) => i.when.primary!.date)
      .sort()[0] ?? '9999-12-31';
  return [...groups.entries()]
    .map(([key, list]) => ({ key: key || '', title: key || 'Other work', related: [], items: list }))
    .sort((a, b) => {
      if (a.key === '') return 1;
      if (b.key === '') return -1;
      const oa = a.items.some((i) => isOpenWork(i.m.status));
      const ob = b.items.some((i) => isOpenWork(i.m.status));
      if (oa !== ob) return oa ? -1 : 1;
      const da = soonest(a.items);
      const db = soonest(b.items);
      return da !== db ? (da < db ? -1 : 1) : a.title.localeCompare(b.title);
    });
}

/**
 * The Plan's first grouping. The importer's workstream mapping is used when it covers most items; otherwise grouping by
 * the work area keeps one "Other work" group from swallowing the plan.
 */
export function groupPlan(items: PlanItemData[], idx: Indexes): { mode: 'workstream' | 'area'; groups: ReturnType<typeof groupByWorkstream> } {
  const mapped = items.filter((i) => i.m.data?.workstream_key && idx.byKey.has(i.m.data.workstream_key)).length;
  if (items.length > 0 && mapped / items.length >= 0.5) return { mode: 'workstream', groups: groupByWorkstream(items, idx) };
  return { mode: 'area', groups: groupByArea(items) };
}

export function groupByStatus(items: PlanItemData[]): Map<WorkStatus, PlanItemData[]> {
  const map = new Map<WorkStatus, PlanItemData[]>();
  for (const s of WORK_STATUS_ORDER) map.set(s, []);
  for (const it of items) (map.get(it.m.status as WorkStatus) ?? map.set(it.m.status as WorkStatus, []).get(it.m.status as WorkStatus)!).push(it);
  return map;
}

export function groupByPhase(items: PlanItemData[]): Map<PhaseKey | 'none', PlanItemData[]> {
  const map = new Map<PhaseKey | 'none', PlanItemData[]>();
  for (const p of PHASE_ORDER) map.set(p, []);
  map.set('none', []);
  for (const it of items) {
    const k = it.m.data?.phase ?? 'none';
    (map.get(k) ?? map.set(k, []).get(k)!).push(it);
  }
  return map;
}
