// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BaseRecord } from '../../src/shared/types';
import { audienceLabel } from '../../src/shared/labels';
import { copyLine, countsLine, forAudience, numberedList, questionCounts, questionState } from '../../src/web/lib/questions';
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
    expect(forAudience('realtor', audienceLabel('realtor'))).toBe('For the realtor');
    expect(forAudience('airline', audienceLabel('airline'))).toBe('For the airline');
    expect(forAudience('loan_servicer', audienceLabel('loan_servicer'))).toBe('For the mortgage company');
    expect(forAudience('condo_association', audienceLabel('condo_association'))).toBe('For the condo association');
    expect(forAudience('embassy_hr', audienceLabel('embassy_hr'))).toBe('For embassy HR');
    expect(forAudience('narcotics_control_department', audienceLabel('narcotics_control_department'))).toBe('For the Narcotics Control Department');
    expect(forAudience('hawaii_animal_quarantine', audienceLabel('hawaii_animal_quarantine'))).toBe('For the Hawaii animal quarantine');
    expect(forAudience('some_new_office', audienceLabel('some_new_office'))).toBe('For the some new office');
    expect(copyLine('Ask the realtor: do we need a form?')).toBe('Do we need a form?');
    expect(copyLine('Ask Jun: what is it?')).toBe('What is it?');
    expect(copyLine('Do we ask: why?')).toBe('Do we ask: why?');
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
  it('starts our own list with five questions and offers Show all', () => {
    const many = Array.from({ length: 25 }, (_, i) => q(`Q${String(i + 1).padStart(3, '0')}`));
    const c = mount(many);
    expect(c.querySelectorAll('li.qrow').length).toBe(5);
    const all = button(c, 'Show all (25)')!;
    click(all);
    expect(c.querySelectorAll('li.qrow').length).toBe(25);
    expect(button(c, 'Show fewer')!.getAttribute('aria-expanded')).toBe('true');
  });
  it('groups professional questions by audience, with one copy control each', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const c = mount([q('Q1'), q('Q2', { audience: 'tax_adviser', question: 'Do we file twice?' }), q('Q3', { audience: 'tax_adviser', question: 'What is the deadline?' }), q('Q4', { audience: 'embassy_hr', question: 'Which forms?' })]);
    const heads = [...c.querySelectorAll('h3')].map((h) => h.querySelector('.qgroup__toggle > span')?.textContent ?? h.textContent);
    expect(heads).toEqual(['For us', 'For embassy HR', 'For the tax adviser']);
    const copyBtns = () => [...c.querySelectorAll('button')].filter((b) => /Copy these questions/.test(b.textContent ?? ''));
    // Folded groups show only the heading and count: no copy control yet.
    expect(copyBtns()).toHaveLength(0);
    expect(c.textContent).not.toContain('Do we file twice?');
    click(c.querySelectorAll<HTMLButtonElement>('.qgroup__toggle')[1]!);
    expect(copyBtns()).toHaveLength(1);
    await act(async () => copyBtns()[0]!.click());
    expect(writeText).toHaveBeenCalledWith('1. Do we file twice?\n2. What is the deadline?');
    expect(c.textContent).toContain('Copied');
  });
  it('folds each professional group to its heading, a count and the copy control, and opens it on tap', () => {
    // A real plan has about fifteen audiences and 83 open questions; the page must not be a wall of them.
    const audiences = Array.from({ length: 15 }, (_, i) => `adviser_${String.fromCharCode(97 + i)}`);
    const list = [
      ...Array.from({ length: 12 }, (_, i) => q(`Q${String(i + 1).padStart(3, '0')}`)),
      ...audiences.flatMap((a, ai) => Array.from({ length: 5 }, (_, i) => q(`Q${100 + ai * 10 + i}`, { audience: a, question: `Ask ${a} number ${i + 1}?` }))),
    ];
    const c = mount(list);
    // "For us" shows five and Show all (12); nothing from the folded groups is on the page yet.
    expect(c.querySelectorAll('li.qrow').length).toBe(5);
    expect(button(c, 'Show all (12)')).toBeTruthy();
    const toggles = [...c.querySelectorAll<HTMLButtonElement>('h3 .qgroup__toggle')];
    expect(toggles).toHaveLength(15);
    for (const t of toggles) {
      expect(t.getAttribute('aria-expanded')).toBe('false');
      const body = document.getElementById(t.getAttribute('aria-controls')!);
      expect(body?.hasAttribute('hidden')).toBe(true);
      expect(t.textContent).toMatch(/^For .+5 questions$/);
    }
    expect([...c.querySelectorAll('button')].filter((b) => /Copy these questions/.test(b.textContent ?? ''))).toHaveLength(0);
    // Tap one: only that group opens, with its own questions and its one copy control.
    click(toggles[2]);
    expect([...c.querySelectorAll('button')].filter((b) => /Copy these questions/.test(b.textContent ?? ''))).toHaveLength(1);
    expect(toggles[2]!.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggles[2]!.getAttribute('aria-controls')!)?.hasAttribute('hidden')).toBe(false);
    expect(c.querySelectorAll('li.qrow').length).toBe(10);
    expect(c.textContent).toContain('Ask adviser_c number 1?');
    expect(toggles[3]!.getAttribute('aria-expanded')).toBe('false');
    click(toggles[2]);
    expect(c.querySelectorAll('li.qrow').length).toBe(5);
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
