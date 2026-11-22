// @vitest-environment jsdom
/** The timeline chart over the fictional demo household, rendered in a DOM (no layout): structure, words and focus. */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import { collectDeadlines } from '../../src/shared/deadlines';
import type { BaseRecord, PlanningTarget, Person, TaskLink } from '../../src/shared/types';
import { buildPlanItems } from '../../src/web/lib/plan';
import { buildDirectory, buildIndexes } from '../../src/web/lib/records';
import { GanttChart } from '../../src/web/screens/plan/Gantt';
import { SnapshotContext, type SnapshotCtx } from '../../src/web/state/snapshot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-10-29T12:00:00Z';
const TODAY = '2026-10-30';
const bundle = buildDemoBundle();
const people: Person[] = bundle.people.map((p) => ({ ...p, household_id: 'demo' }));
const records = bundle.records.map((r) => ({ ...r, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW, updated_by: null })) as BaseRecord[];
const taskLinks = bundle.task_links.map((t) => ({ ...t, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW })) as TaskLink[];
const idx = buildIndexes(records, taskLinks);
const dir = buildDirectory(people, 'avery');
const deadlines = collectDeadlines({ records, people, task_links: taskLinks, today: TODAY });
const byRecord = new Map<string, typeof deadlines>();
for (const d of deadlines) if (d.record_id) byRecord.set(d.record_id, [...(byRecord.get(d.record_id) ?? []), d]);
const items = buildPlanItems(idx, byRecord, TODAY).filter((i) => !i.m.data.optional_future_work);
const TARGET = bundle.settings.planning_target as PlanningTarget;

const snapshotCtx = {
  snapshot: null,
  idx,
  dir,
  status: 'ready',
  loadedAt: new Date(),
  error: null,
  refresh: async () => undefined,
  save: { kind: 'idle' },
  setDirty: () => undefined,
  dirtyCount: 0,
  actions: {} as never,
} as SnapshotCtx;

let container: HTMLDivElement;
let root: Root;
function chart(target: PlanningTarget | null, shown: typeof items = items): HTMLElement {
  const node: ReactElement = createElement(
    MemoryRouter,
    null,
    createElement(SnapshotContext.Provider, { value: snapshotCtx }, createElement(GanttChart, { items: shown, idx, dir, today: TODAY, baselineOn: '2026-10-01', target })),
  );
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
}
/** jsdom has no media queries: say which of the chart's two (phone, wide) match. Neither = a tablet-sized window. */
function screen(kind: 'tablet' | 'phone' | 'wide') {
  window.matchMedia = ((q: string) => ({
    matches: (kind === 'phone' && q.includes('max-width: 600px')) || (kind === 'wide' && q.includes('min-width: 900px')),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as never;
}
beforeAll(() => {
  // No layout and no scrolling here: make scrolling a no-op.
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollBy = () => undefined;
});
beforeEach(() => {
  screen('tablet');
  window.localStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  window.localStorage.clear();
});

const bars = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[data-gantt-bar]')];
const barFor = (el: HTMLElement, title: string) => bars(el).find((b) => b.getAttribute('aria-label')?.startsWith(`${title}, owner`))!;

describe('timeline chart', () => {
  it('draws one labelled bar per placed item, and every name says how the timing is known', () => {
    const el = chart(TARGET);
    expect(bars(el)).toHaveLength(items.length);
    for (const b of bars(el)) expect(b.getAttribute('aria-label')).toMatch(/, owner .+, .+, (ends .+\(.+\)|timing from its phase \(.+\), no firm date|placed using the July 2027 target; set travel dates to make it exact)/);
    expect(barFor(el, 'Verify both passports and renewal outcomes').getAttribute('data-basis')).toBe('firm');
    expect(barFor(el, 'Choose a housing shortlist').getAttribute('data-basis')).toBe('phase');
    expect(barFor(el, 'Release Jun to travel').getAttribute('data-basis')).toBe('target');
    expect(el.querySelector('[role=region]')?.getAttribute('aria-label')).toMatch(/^Timeline chart, \d+ items/);
    expect(el.querySelector('[role=region]')?.getAttribute('tabindex')).toBe('0');
  });

  it('without a planning target, work that hangs on an unset departure goes to "Not placed yet" with words and no bar', () => {
    const el = chart(null);
    expect(barFor(el, 'Release Jun to travel')).toBeUndefined();
    const group = [...el.querySelectorAll('section')].find((s) => s.textContent?.includes('Not placed yet'))!;
    expect(group).toBeTruthy();
    const row = [...group.querySelectorAll('li')].find((li) => li.textContent?.includes('Release Jun to travel'))!;
    expect(row.textContent).toContain('Waiting for a departure date or a planning target.');
    expect(row.querySelector('button')).toBeNull(); // text only: no bar
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/r/milestone%3AW25');
    // Avery's and Mochi's departure dates are set, so their work is still drawn.
    expect(barFor(el, 'Release Avery to travel')).toBeTruthy();
    expect(barFor(el, 'Release Mochi to travel')).toBeTruthy();
    // And Jun's missing date is not drawn as a marker.
    expect(el.textContent).not.toContain('Jun: not set');
  });

  it('names the departure markers, the dashed one saying it is only the target', () => {
    const text = chart(TARGET).textContent ?? '';
    expect(text).toContain('Avery departs');
    expect(text).toContain('Mochi departs');
    expect(text).toContain('Jun: not set — July 2027 target');
    expect(text).toContain('Today');
  });

  it('opens details on a click, outlines what it waits on, and Escape closes them and returns focus to the bar', () => {
    const el = chart(TARGET);
    const b = barFor(el, 'Confirm airline and crate feasibility');
    b.focus();
    act(() => b.click());
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.textContent).toContain('Confirm airline and crate feasibility');
    expect(dialog.textContent).toContain('Waits on');
    expect(dialog.textContent).toContain('No firm date');
    expect(dialog.querySelector('a[href="/r/milestone%3AW14"]')?.textContent).toBe('Open item');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('[data-prereq]')).toHaveLength(2);
    expect(document.activeElement).toBe(dialog);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(el.querySelectorAll('[data-prereq]')).toHaveLength(0);
  });

  it('a check-in shared by several items is one quiet marker in Key dates, not a circle on every row', () => {
    const el = chart(TARGET);
    const marker = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Check-in · Nov 11, 2026 · 4 items · not scheduled')!;
    expect(marker).toBeTruthy();
    expect(el.querySelectorAll('[data-check]')).toHaveLength(0);
    expect(el.querySelectorAll('[data-leader]')).toHaveLength(0);
    expect(el.querySelectorAll('.gline--checkin')).toHaveLength(1);
    // Nothing is lost for a screen reader: each row's name still mentions it.
    for (const title of ['Confirm target month and three-year scope', "Establish Avery's residence route", 'Clarify Avery\'s employer support', 'Collect mover quotes']) {
      expect(barFor(el, title).getAttribute('aria-label'), title).toContain('household check-in on Nov 11, 2026, not a deadline');
    }
    // Focus or click lists the items, each linking to its own page.
    marker.focus();
    act(() => marker.click());
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    expect(marker.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.textContent).toContain('Check-in · Nov 11, 2026');
    expect(dialog.textContent).toContain('Not a deadline');
    expect([...dialog.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/r/milestone%3AW04', '/r/milestone%3AW22', '/r/milestone%3AW01', '/r/milestone%3AW02']);
    expect(document.activeElement).toBe(dialog);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(marker);
  });

  it('a one-off check-in keeps its circle on the row, with a dotted leader only when it falls outside the bar', () => {
    const subset = items.filter((i) => ['W01', 'W22'].includes(i.m.key)); // only two items share the date now
    const el = chart(TARGET, subset);
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Check-in ·'))).toBe(false);
    expect(el.querySelectorAll('[data-check]')).toHaveLength(2);
    // W01's check-in sits inside its Oct–Nov bar (no leader); W22's is months before its Jan–Mar bar (leader).
    expect(el.querySelectorAll('[data-leader]')).toHaveLength(1);
    expect(barFor(el, 'Collect mover quotes').querySelector('[data-leader]')).not.toBeNull();
    expect(barFor(el, 'Confirm target month and three-year scope').querySelector('[data-leader]')).toBeNull();
    expect(barFor(el, 'Collect mover quotes').getAttribute('aria-label')).toContain('; check-in on Nov 11, 2026, not a deadline');
  });

  it('a check-in is explained as not a deadline', () => {
    const el = chart(TARGET);
    const b = barFor(el, 'Collect mover quotes');
    expect(b.getAttribute('aria-label')).toContain('check-in on Nov 11, 2026, not a deadline');
    act(() => b.click());
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain('Not a deadline.');
    expect(dialog.textContent).toContain('Check-in');
  });

  it('groups by traveler by default: each person in directory order, then Shared', () => {
    const el = chart(TARGET);
    const heads = [...el.querySelectorAll('h3')].map((h) => h.textContent ?? '');
    expect(heads.map((h) => h.split(/\d+ items?/)[0])).toEqual(['Avery', 'Jun', 'Mochi', 'Shared']);
    const pressed = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Group rows by"] button')].find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed?.textContent).toBe('By traveler');
    expect(bars(el)).toHaveLength(items.length);
  });

  it('folds a group away, and groups by area on request', () => {
    const el = chart(TARGET);
    const toggle = [...el.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((b) => b.textContent?.startsWith('Mochi'))!;
    expect(toggle.textContent).toContain('6 items · 6 to do · 1 blocked');
    const before = bars(el).length;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(bars(el)).toHaveLength(before - 6);

    const byArea = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'By area')!;
    act(() => byArea.click());
    const headings = [...el.querySelectorAll('h3')].map((h) => h.textContent ?? '');
    expect(headings.some((h) => h.startsWith('Mochi: import, transport and care'))).toBe(true);
    expect(bars(el)).toHaveLength(items.length);
  });

  it('remembers the grouping and the range between visits', () => {
    const el = chart(TARGET);
    const press = (label: string) => act(() => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!.click());
    press('By area');
    press('Three years');
    expect(window.localStorage.getItem('kadode.timeline-group')).toBe('area');
    expect(window.localStorage.getItem('kadode.timeline-range')).toBe('three_years');
    act(() => root.unmount());
    container.remove();

    const again = chart(TARGET);
    const on = (group: string) => [...again.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;
    expect(on('Group rows by')).toBe('By area');
    expect(on('Time range')).toBe('Three years');
    expect([...again.querySelectorAll('.gcol')].map((c) => c.textContent).slice(0, 2)).toEqual(['Q4', 'Q1']);
    act(() => root.unmount());
    container.remove();

    // Anything else that was stored, or nothing at all, means the defaults.
    window.localStorage.setItem('kadode.timeline-group', 'rainbow');
    window.localStorage.setItem('kadode.timeline-range', '{}');
    const fresh = chart(TARGET);
    const now = (group: string) => [...fresh.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;
    expect(now('Group rows by')).toBe('By traveler');
    expect(now('Time range')).toBe('To day 90');
  });

  it('group headers carry a thin summary bar and no month labels of their own where the main axis stays in view', () => {
    screen('wide');
    const el = chart(TARGET);
    const heads = [...el.querySelectorAll('.ggroup__head')];
    expect(heads).toHaveLength(4);
    expect(el.querySelectorAll('.ggroup__tick')).toHaveLength(0);
    expect(el.querySelectorAll('.ggroup__span')).toHaveLength(4);
    // The meta line stays in the label column.
    expect(heads[0]!.querySelector('.ggroup__meta')?.textContent).toMatch(/^\d+ items? · \d+ to do/);
  });

  it('where the main axis cannot stay in view, each traveler group repeats a small month axis', () => {
    for (const kind of ['phone', 'tablet'] as const) {
      screen(kind);
      const el = chart(TARGET);
      const sections = [...el.querySelectorAll('section.ggroup')];
      expect(sections, kind).toHaveLength(4);
      for (const section of sections) expect(section.querySelectorAll('.ggroup__tick').length, kind).toBeGreaterThan(10);
      expect(el.querySelectorAll('.ggroup__span')).toHaveLength(4);
      act(() => root.unmount());
      container.remove();
    }
    // By area has many small groups, so the small axis comes back only every few rows.
    screen('phone');
    const el = chart(TARGET);
    act(() => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'By area')!.click());
    const groups = el.querySelectorAll('section.ggroup').length;
    const withAxis = [...el.querySelectorAll('section.ggroup')].filter((s) => s.querySelector('.ggroup__tick')).length;
    expect(withAxis).toBeGreaterThan(0);
    expect(withAxis).toBeLessThan(groups);
  });

  it('three years is drawn in quarters', () => {
    const el = chart(TARGET);
    const btn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Three years')!;
    act(() => btn.click());
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    const cols = [...el.querySelectorAll('.gcol')].map((c) => c.textContent);
    expect(cols.slice(0, 3)).toEqual(['Q4', 'Q1', 'Q2']);
  });
});
