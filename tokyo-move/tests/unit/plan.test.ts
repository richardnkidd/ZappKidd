import { describe, expect, it } from 'vitest';
import type { DeadlineKind } from '../../src/shared/types';
import {
  applyQuickFilter,
  DEFAULT_FILTERS,
  isPastDue,
  nextToDo,
  parseFilters,
  quickFilterOf,
  sortForGroup,
  splitByDate,
  type PlanItemData,
} from '../../src/web/lib/plan';

const TODAY = '2026-11-22';

function item(key: string, over: { status?: string; date?: string | null; kind?: DeadlineKind } = {}): PlanItemData {
  const date = over.date ?? null;
  const kind = over.kind ?? 'internal_target';
  return {
    m: { id: `milestone:${key}`, key, type: 'milestone', title: key, status: over.status ?? 'planned', owner: 'avery', data: {} } as unknown as PlanItemData['m'],
    date,
    dateKind: date ? kind : null,
    dateState: null,
    when: { primary: date ? { date, kind, source: kind === 'review_date' ? 'review' : 'deadline', state: null, deadline: null, label: 'x' } : null, others: [] },
    unmet: [],
  };
}

describe('Plan: the simple filter (Mine, Blocked, All)', () => {
  it('maps each choice to filters and back', () => {
    for (const q of ['mine', 'blocked', 'all'] as const) expect(quickFilterOf(applyQuickFilter(q))).toBe(q);
    expect(applyQuickFilter('all')).toEqual(DEFAULT_FILTERS);
  });

  it('is none of the three once something in "More filters" is changed', () => {
    expect(quickFilterOf({ ...DEFAULT_FILTERS, phase: 'p1_now_nov2026' })).toBeNull();
    expect(quickFilterOf({ ...DEFAULT_FILTERS, owner: 'mine', status: 'blocked' })).toBeNull();
    expect(quickFilterOf({ ...DEFAULT_FILTERS, hideOptional: false })).toBeNull();
  });

  it('?status=blocked is the Blocked choice, so a link from Home lands on it', () => {
    expect(quickFilterOf(parseFilters(new URLSearchParams('status=blocked')))).toBe('blocked');
    expect(quickFilterOf(parseFilters(new URLSearchParams('')))).toBe('all');
  });
});

describe('Plan: order inside a group', () => {
  it('puts past-due items first (oldest first), then by date, then the undated', () => {
    const items = [item('W3'), item('W2', { date: '2026-12-01' }), item('W1', { date: '2026-11-10' }), item('W4', { date: '2026-11-15' })];
    expect(sortForGroup(items, TODAY).map((i) => i.m.key)).toEqual(['W1', 'W4', 'W2', 'W3']);
  });

  it('never calls a check-in past due, and never calls finished work late', () => {
    expect(isPastDue(item('W1', { date: '2026-11-01', kind: 'review_date' }), TODAY)).toBe(false);
    expect(isPastDue(item('W2', { date: '2026-11-01', status: 'completed' }), TODAY)).toBe(false);
    expect(isPastDue(item('W3', { date: '2026-11-01' }), TODAY)).toBe(true);
  });

  it('the next thing to do is the first open item that is not stuck', () => {
    const items = [item('W1', { date: '2026-11-01', status: 'blocked' }), item('W2', { date: '2026-11-20' }), item('W3', { date: '2026-11-05', status: 'completed' })];
    expect(nextToDo(items, TODAY)?.m.key).toBe('W2');
    expect(nextToDo([item('W1', { status: 'completed' })], TODAY)).toBeNull();
  });
});

describe('Plan: the By date view', () => {
  it('splits open work into past their date, coming up and no date yet', () => {
    const items = [
      item('W1', { date: '2026-11-10' }),
      item('W2', { date: '2026-12-02' }),
      item('W3'),
      item('W4', { date: '2026-11-01', kind: 'review_date' }),
      item('W5', { status: 'completed', date: '2026-11-01' }),
    ];
    const parts = splitByDate(items, TODAY);
    expect(parts.past.map((i) => i.m.key)).toEqual(['W1']);
    expect(parts.coming.map((i) => i.m.key)).toEqual(['W4', 'W2']);
    expect(parts.undated.map((i) => i.m.key)).toEqual(['W3']);
    expect(parts.closed.map((i) => i.m.key)).toEqual(['W5']);
  });
});
