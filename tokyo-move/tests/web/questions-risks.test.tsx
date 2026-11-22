// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BaseRecord } from '../../src/shared/types';
import { countsLine, forAudience, numberedList, questionCounts, questionState } from '../../src/web/lib/questions';
import { buildDirectory, buildIndexes, type Question, type Risk } from '../../src/web/lib/records';
import { QuestionsTab } from '../../src/web/screens/decide/QuestionsTab';
import { RisksTab, sortRisks } from '../../src/web/screens/decide/RisksTab';
import { SnapshotContext, type SnapshotCtx } from '../../src/web/state/snapshot';
import { PEOPLE, rec } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; } });
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
});

const q = (key: string, data: Record<string, unknown> = {}, over: Partial<BaseRecord> = {}) =>
  rec('question', key, { title: `Topic ${key}`, ...over, data: { disposition: 'question', question: `Question ${key}?`, answer: null, relevance: [], ...data } }) as unknown as Question;
const risk = (key: string, severity: string | undefined, title = `Risk ${key}`, data: Record<string, unknown> = {}) =>
  rec('risk', key, { title, data: { raid_kind: 'risk', severity, trigger: '', mitigation: '', fallback: '', escalation_trigger: null, linked_records: [], ...data } }) as unknown as Risk;

function mount(input: unknown[], patch: (...a: unknown[]) => Promise<unknown> = vi.fn(async () => input[0]), path = '/decide/questions'): HTMLDivElement {
  const records = input as BaseRecord[];
  const ctx = {
    snapshot: {} as never,
    idx: buildIndexes(records, []),
    dir: buildDirectory(PEOPLE, 'ann'),
    status: 'ready',
    loadedAt: new Date(),
    error: null,
    refresh: async () => undefined,
    save: { kind: 'idle' },
    setDirty: () => undefined,
    dirtyCount: 0,
    actions: { patchRecord: patch } as never,
  } as SnapshotCtx;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const tab = path.endsWith('risks') ? createElement(RisksTab) : createElement(QuestionsTab);
  act(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(SnapshotContext.Provider, { value: ctx }, tab))));
  return container;
}
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (c: HTMLElement, name: RegExp | string) =>
  [...c.querySelectorAll('button')].find((b) => (typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? ''))) as HTMLButtonElement | undefined;

describe('question helpers', () => {
  it('reads the state from the disposition, then the status', () => {
    expect(questionState(q('Q1'))).toBe('open');
    expect(questionState(q('Q2', { disposition: 'carry_forward' }))).toBe('open');
    expect(questionState(q('Q3', { disposition: 'already_answered' }))).toBe('answered');
    expect(questionState(q('Q4', { disposition: 'not_applicable' }))).toBe('excluded');
    expect(questionState(q('Q5', { disposition: 'explicitly_excluded' }))).toBe('excluded');
    expect(questionState(q('Q6', { disposition: undefined }, { status: 'answered' as never }))).toBe('answered');
    expect(questionCounts([q('Q1'), q('Q3', { disposition: 'already_answered' }), q('Q4', { disposition: 'not_applicable' })])).toEqual({ open: 1, answered: 1, excluded: 1 });
  });
  it('words the counts, the audience headings and the copied list', () => {
    expect(countsLine({ open: 83, answered: 31 })).toBe('83 open · 31 answered');
    expect(countsLine({ open: 2, answered: 0 })).toBe('2 open');
    expect(forAudience('tax_adviser', 'tax adviser')).toBe('For the tax adviser');
    expect(forAudience('embassy_hr', 'embassy hr')).toBe('For embassy HR');
    expect(numberedList(['One?', 'Two\nlines?'])).toBe('1. One?\n2. Two lines?');
  });
});

describe('Questions tab', () => {
  it('shows one line of counts, the question, and Our answer or an Answer control', () => {
    const c = mount([q('Q1'), q('Q2', { disposition: 'already_answered', answer: 'Yes.' })]);
    expect(c.querySelector('.qtab__counts')?.textContent).toBe('1 open · 1 answered');
    expect(c.textContent).toContain('Question Q1?');
    expect(c.textContent).not.toContain('Topic Q1');
    expect(button(c, /^Answer:/)).toBeTruthy();
    expect(c.textContent).not.toContain('Our answer: Yes.');
    click(button(c, 'Answered'));
    expect(c.textContent).toContain('Our answer: Yes.');
    expect(button(c, /Change answer/)).toBeTruthy();
  });
  it('uses the plain question first, then the source question, then the title', () => {
    const c = mount([q('Q1', { plain_question: 'Plain one?' }), q('Q2', { question: 'Source Q017 text?' }), q('Q3', { question: '' }, { title: 'Only a title' })]);
    expect(c.textContent).toContain('Plain one?');
    expect(c.textContent).not.toContain('Question Q1?');
    expect(c.textContent).toContain('Source text?');
    expect(c.textContent).toContain('Only a title');
  });
  it('hides set-aside questions until All, then folds them at the end', () => {
    const c = mount([q('Q1'), q('Q2', { disposition: 'not_applicable' })]);
    expect(c.textContent).not.toContain('Question Q2?');
    click(button(c, 'All'));
    const more = button(c, /Not needed \(1\)/)!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.getAttribute('aria-controls')).toBeTruthy();
  });
  it('starts each group with ten questions and offers Show all', () => {
    const many = Array.from({ length: 25 }, (_, i) => q(`Q${String(i + 1).padStart(3, '0')}`));
    const c = mount(many);
    expect(c.querySelectorAll('li.qrow').length).toBe(10);
    const all = button(c, 'Show all (25)')!;
    click(all);
    expect(c.querySelectorAll('li.qrow').length).toBe(25);
    expect(button(c, 'Show fewer')!.getAttribute('aria-expanded')).toBe('true');
  });
  it('groups professional questions by audience, with one copy control each', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const c = mount([q('Q1'), q('Q2', { audience: 'tax_adviser', question: 'Do we file twice?' }), q('Q3', { audience: 'tax_adviser', question: 'What is the deadline?' }), q('Q4', { audience: 'embassy_hr', question: 'Which forms?' })]);
    const heads = [...c.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['For us', 'For embassy HR', 'For the tax adviser']);
    const copies = [...c.querySelectorAll('button')].filter((b) => /Copy these questions/.test(b.textContent ?? ''));
    expect(copies).toHaveLength(2);
    await act(async () => copies[1]!.click());
    expect(writeText).toHaveBeenCalledWith('1. Do we file twice?\n2. What is the deadline?');
    expect(c.textContent).toContain('Copied');
  });
  it('answers in place through the version-checked write, then says Saved and keeps focus on the row', async () => {
    const patch = vi.fn(async (..._a: unknown[]) => q("Q1"));
    const c = mount([q('Q1', {}, { })], patch);
    const opener = button(c, /^Answer:/)!;
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    click(opener);
    const area = c.querySelector('textarea') as HTMLTextAreaElement;
    expect(area).toBeTruthy();
    expect(c.querySelector(`label[for="${area.id}"]`)?.textContent).toBe('Our answer');
    // empty answer is refused
    await act(async () => button(c, 'Save')!.click());
    expect(patch).not.toHaveBeenCalled();
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, '  Yes, in May.  ');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button(c, 'Save')!.click());
    expect(patch).toHaveBeenCalledWith('question:Q1', 1, { data: { disposition: 'already_answered', answer: 'Yes, in May.' } });
    expect(c.querySelector('.qrow__saved')?.textContent).toContain('Saved');
    expect(c.querySelector('.qrow__saved')?.getAttribute('role')).toBe('status');
    expect(document.activeElement?.id).toBe('q-Q1');
  });
  it('Cancel closes the field and returns focus to the Answer control', async () => {
    const c = mount([q('Q1')]);
    click(button(c, /^Answer:/));
    click(button(c, 'Cancel'));
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(c.querySelector('textarea')).toBeNull();
    expect(document.activeElement?.textContent).toMatch(/^Answer:/);
  });
  it('keeps context behind Details', () => {
    const c = mount([q('Q1', { known: 'We know X', when_trigger: 'Before May', evidence_basis: 'A source' })]);
    const more = button(c, /Details/)!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(more.getAttribute("aria-controls")!)?.hasAttribute('hidden')).toBe(true);
    expect(c.textContent).not.toMatch(/Every question is accounted for/);
  });
});

describe('Risks tab', () => {
  it('orders by seriousness, then title', () => {
    const list = sortRisks([risk('R1', 'low', 'Zed'), risk('R2', 'critical', 'Beta'), risk('R3', 'critical', 'Alpha'), risk('R4', undefined, 'None'), risk('R5', 'high', 'Mid')]);
    expect(list.map((r) => r.key)).toEqual(['R3', 'R2', 'R5', 'R1', 'R4']);
  });
  it('shows a title, a summary line, an icon with text, and short labels behind Details', () => {
    const c = mount([risk('R1', 'high', 'Funding may fall short', { plain_summary: 'We keep a cushion.', trigger: 'Rent rises', mitigation: 'Save more', fallback: 'Delay', escalation_trigger: 'Two months short' })], undefined, '/decide/risks');
    expect(c.querySelector('h3')?.textContent).toBe('Funding may fall short');
    expect(c.textContent).toContain('We keep a cushion.');
    expect(c.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('High risk');
    for (const l of ['Warning sign', 'Our plan', 'Backup', 'Escalate if']) expect(c.textContent).toContain(l);
    expect(c.textContent).not.toMatch(/RAISE IT|not agreed yet|Together\?/i);
    expect(c.querySelector('.chip')).toBeNull();
  });
  it('starts with eight risks and offers Show all', () => {
    const c = mount(Array.from({ length: 30 }, (_, i) => risk(`R${i + 1}`, 'medium')), undefined, '/decide/risks');
    expect(c.querySelectorAll('li.risk').length).toBe(8);
    click(button(c, 'Show all (30)'));
    expect(c.querySelectorAll('li.risk').length).toBe(30);
  });
});
