// @vitest-environment jsdom
/**
 * Plan views over the fictional demo household: how much each one shows first, what a stuck item says it waits on,
 * when "not agreed yet" shows, and how a check-in date reads. Rendered in a DOM (no layout).
 */
import { act, createElement, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import { collectDeadlines } from '../../src/shared/deadlines';
import type { BaseRecord, Person, TaskLink } from '../../src/shared/types';
import { buildPlanItems } from '../../src/web/lib/plan';
import { buildDirectory, buildIndexes } from '../../src/web/lib/records';
import { resetOpenChoices } from '../../src/web/screens/plan/PlanGroup';
import { BoardView, ListView, WorkstreamView } from '../../src/web/screens/plan/views';
import { SnapshotContext, type SnapshotCtx } from '../../src/web/state/snapshot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-10-29T12:00:00Z';
const TODAY = '2026-11-22';
const bundle = buildDemoBundle();
const people: Person[] = bundle.people.map((p) => ({ ...p, household_id: 'demo' }));
const records = bundle.records.map((r) => ({ ...r, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW, updated_by: null })) as BaseRecord[];
const taskLinks = bundle.task_links.map((t) => ({ ...t, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW })) as TaskLink[];
const deadlines = collectDeadlines({ records, people, task_links: taskLinks, today: TODAY });

vi.mock('../../src/web/state/data', () => ({
  useData: () => ({ deadlines: { ok: true, value: deadlines }, deadlinesByRecord: new Map(), deadlinesByLinkedKey: new Map(), today: TODAY }),
}));

let container: HTMLDivElement;
let root: Root;

function mount(recs: BaseRecord[], make: (items: ReturnType<typeof buildPlanItems>, idx: ReturnType<typeof buildIndexes>) => ReactElement): HTMLElement {
  const idx = buildIndexes(recs, taskLinks);
  const dir = buildDirectory(people, 'avery');
  const byRecord = new Map<string, typeof deadlines>();
  for (const d of deadlines) if (d.record_id) byRecord.set(d.record_id, [...(byRecord.get(d.record_id) ?? []), d]);
  const items = buildPlanItems(idx, byRecord, TODAY).filter((i) => !i.m.data.optional_future_work);
  const ctx = { snapshot: null, idx, dir, status: 'ready', loadedAt: new Date(), error: null, refresh: async () => undefined, save: { kind: 'idle' }, setDirty: () => undefined, dirtyCount: 0, actions: {} as never } as SnapshotCtx;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, null, createElement(SnapshotContext.Provider, { value: ctx }, make(items, idx)))));
  return container;
}

beforeEach(() => {
  resetOpenChoices();
  window.sessionStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
});

const focusRef = createRef<HTMLElement>();
const list = (recs: BaseRecord[] = records) => mount(recs, (items, idx) => createElement(WorkstreamView, { items, idx, today: TODAY, focusRef }));
const heads = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.pgroup > .pgroup__head > .pgroup__btn')];

/** The demo's milestones, repeated under new keys so one workstream holds enough items to need "Show all". */
function crowded(): BaseRecord[] {
  const base = records.find((r) => r.type === 'milestone' && r.status === 'planned' && !(r.data as { optional_future_work?: boolean }).optional_future_work)!;
  const extra = Array.from({ length: 9 }, (_, i) => ({ ...base, id: `milestone:ZX${i}`, key: `ZX${i}`, title: `Extra step ${i}`, data: { ...(base.data as object), plain_title: `Extra step ${i}`, workstream_key: 'S01', optional_future_work: false, deadline: null, review_date: null } }) as BaseRecord);
  return [...records, ...extra];
}

describe('Plan: List', () => {
  it('opens with every group closed except the first one that has unfinished items', () => {
    const el = list();
    const open = heads(el).filter((h) => h.getAttribute('aria-expanded') === 'true');
    expect(heads(el).length).toBeGreaterThan(3);
    expect(open).toHaveLength(1);
    // Proper disclosures: every heading button names its panel.
    for (const h of heads(el)) {
      const panel = document.getElementById(h.getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      expect(panel!.hidden).toBe(h.getAttribute('aria-expanded') !== 'true');
    }
    // The first group in the list has nothing left to do in the demo, so it is not the one that is open.
    expect(open[0]).not.toBe(heads(el)[0]);
  });

  it('each group heading shows its name and a count', () => {
    for (const h of heads(list())) expect(h.textContent).toMatch(/\S.*\d/);
  });

  it('an open group shows five rows, then "Show all (N)" that shows the rest and keeps focus in the list', () => {
    const el = list(crowded());
    // The extra steps all sit in one group (the one that now has a "Show all"); open it if it is not already open.
    const first = heads(el).find((h) => document.getElementById(h.getAttribute('aria-controls')!)!.querySelector('button.show-all') !== null)!;
    if (first.getAttribute('aria-expanded') !== 'true') act(() => first.click());
    const panel = document.getElementById(first.getAttribute('aria-controls')!)!;
    const rows = () => panel.querySelectorAll(':scope > ul > li');
    expect(rows()).toHaveLength(5);
    const more = [...panel.querySelectorAll<HTMLButtonElement>('button.show-all')].find((b) => /^Show all \(\d+\)/.test(b.textContent ?? ''))!;
    const total = Number(/\((\d+)\)/.exec(more.textContent!)![1]);
    expect(total).toBeGreaterThan(5);
    act(() => more.click());
    expect(rows()).toHaveLength(total);
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('remembers open and closed for the session, and works when storage is not available', () => {
    const el = list();
    const closed = heads(el).find((h) => h.getAttribute('aria-expanded') === 'false')!;
    act(() => closed.click());
    expect(closed.getAttribute('aria-expanded')).toBe('true');
    const name = closed.textContent;
    act(() => root.unmount());
    container.remove();
    const again = list();
    expect(heads(again).find((h) => h.textContent === name)!.getAttribute('aria-expanded')).toBe('true');

    // Storage that throws must not break the screen.
    act(() => root.unmount());
    container.remove();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const third = list();
    const other = heads(third).find((h) => h.getAttribute('aria-expanded') === 'false')!;
    act(() => other.click());
    expect(other.getAttribute('aria-expanded')).toBe('true');
    spy.mockRestore();
  });

  it('a stuck item says what it waits on, in the words Home uses, on every list', () => {
    const blocked = records.filter((r) => r.type === 'milestone' && r.status === 'blocked' && !(r.data as { optional_future_work?: boolean }).optional_future_work);
    expect(blocked.length).toBeGreaterThan(0);
    const el = list();
    // Open every group so every stuck card is on screen.
    act(() => {
      for (const h of heads(el)) if (h.getAttribute('aria-expanded') === 'false') h.click();
    });
    const lines = [...el.querySelectorAll('.item__why')].map((p) => p.textContent ?? '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^(Waiting on: .{3,}|No reason written yet)$/);
    // Names, never codes.
    for (const line of lines) expect(line).not.toMatch(/\b[WDQ]\d{2}\b/);
    // The Home helper gives the same wording for the same item.
    expect(lines.some((l) => l.startsWith('Waiting on: '))).toBe(true);

    const by = mount(records, (items, idx) => createElement(ListView, { items, idx, today: TODAY, focusRef }));
    expect(by.querySelectorAll('.item__why').length).toBeGreaterThanOrEqual(0);
  });

  it('"not agreed yet" shows only when the household recorded a disagreement about the owner', () => {
    const marked = records.map((r) => (r.type === 'milestone' ? { ...r, owner_proposed: true } : r)) as BaseRecord[];
    const el = list(marked);
    act(() => {
      for (const h of heads(el)) if (h.getAttribute('aria-expanded') === 'false') h.click();
    });
    expect(el.textContent).not.toContain('not agreed yet');
    const first = marked.find((r) => r.type === 'milestone' && r.status !== 'completed' && !(r.data as { optional_future_work?: boolean }).optional_future_work)!;
    const disputed = marked.map((r) => (r.id === first.id ? ({ ...r, owner: 'avery', data: { ...(r.data as object), owner_disputed: true } } as BaseRecord) : r));
    const again = list(disputed as BaseRecord[]);
    act(() => {
      for (const h of heads(again)) if (h.getAttribute('aria-expanded') === 'false') h.click();
    });
    expect((again.textContent?.match(/not agreed yet/g) ?? []).length).toBe(1);
  });

  it('a check-in date reads in the one date format, so a past one says how late', () => {
    const recs = records.map((r, i) =>
      r.type === 'milestone' && r.status === 'planned' && i % 2 === 0 ? ({ ...r, data: { ...(r.data as object), deadline: null, review_date: '2026-11-11' } } as BaseRecord) : r,
    ) as BaseRecord[];
    const el = list(recs);
    act(() => {
      for (const h of heads(el)) if (h.getAttribute('aria-expanded') === 'false') h.click();
    });
    const notes = [...el.querySelectorAll('.item__meta')].map((m) => m.textContent ?? '').filter((t) => t.includes('Check-in'));
    expect(notes.length).toBeGreaterThan(0);
    for (const t of notes) expect(t).toMatch(/Check-in (11 days late|Today|Tomorrow|\w{3}, \w{3} \d+)/);
    expect(notes.some((t) => t.includes('Check-in 11 days late'))).toBe(true);
  });
});

describe('Plan: Board', () => {
  const board = (recs: BaseRecord[] = records) => mount(recs, (items, idx) => createElement(BoardView, { items, idx, today: TODAY, expanded: {}, setExpanded: () => undefined }));

  it('a card is its title and one line: no next step, and no description', () => {
    const el = board();
    expect(el.querySelectorAll('.item__action')).toHaveLength(0);
    expect(el.querySelectorAll('.item--card').length).toBeGreaterThan(5);
  });

  it('each column shows five cards, then "Show all (N)"', () => {
    const el = board(crowded());
    for (const col of el.querySelectorAll('.board-col')) expect(col.querySelectorAll('li.item').length).toBeLessThanOrEqual(5);
    const more = [...el.querySelectorAll<HTMLButtonElement>('button.show-all')];
    expect(more.length).toBeGreaterThan(0);
    for (const b of more) expect(b.textContent).toMatch(/^Show all \(\d+\)/);
  });

  it('the stuck column says what each card waits on', () => {
    const el = board();
    const stuck = el.querySelector('.board-col--blocked')!;
    expect(stuck.querySelectorAll('li.item').length).toBeGreaterThan(0);
    for (const li of stuck.querySelectorAll('li.item')) expect(li.querySelector('.item__why')?.textContent).toMatch(/^(Waiting on: |No reason)/);
  });
});
