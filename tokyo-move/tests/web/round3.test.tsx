// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../src/shared/types';
import { LinkedText } from '../../src/web/components/LinkedText';
import { describeAudit, describeAuditList, groupSimilar } from '../../src/web/lib/audit';
import { ruleCountSentence } from '../../src/web/lib/dateWords';
import { DEFAULT_DECISION_EFFECTS, decisionEffect, effectRules } from '../../src/web/lib/decisionEffects';
import { groupPlan, buildPlanItems } from '../../src/web/lib/plan';
import { splitTitleAction } from '../../src/web/lib/prose';
import { isAdviserQuestion, isPlanQuestion } from '../../src/web/lib/questions';
import { buildIndexes } from '../../src/web/lib/records';
import { whenFor } from '../../src/web/lib/when';
import { audienceLabel, reviewerLabel } from '../../src/shared/labels';
import { DIR, PEOPLE, computed, decision, milestone, rec } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
function mount(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe('text shown once', () => {
  it('a cut-short title becomes the full text, with no second copy', () => {
    expect(splitTitleAction('Carry the papers and show them at the desk and keep c…', 'Carry the papers and show them at the desk and keep copies safe.')).toEqual({
      title: 'Carry the papers and show them at the desk and keep copies safe.',
      detail: null,
    });
  });
  it('a complete title is followed only by what the action adds', () => {
    expect(splitTitleAction('Book the movers', 'Book the movers. Ask for two quotes and a written start date.')).toEqual({ title: 'Book the movers', detail: 'Ask for two quotes and a written start date.' });
    expect(splitTitleAction('Book the movers', 'Book the movers.')).toEqual({ title: 'Book the movers', detail: null });
  });
  it('unrelated text is kept', () => {
    expect(splitTitleAction('Book the movers', 'Compare three firms')).toEqual({ title: 'Book the movers', detail: 'Compare three firms' });
    expect(splitTitleAction('Book the movers', null)).toEqual({ title: 'Book the movers', detail: null });
  });
});

describe('web addresses in prose', () => {
  it('become short links that open in a new tab; other text stays text', () => {
    const el = mount(createElement(LinkedText, { text: 'See https://www.example.org/page/1 (and later).' }));
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://www.example.org/page/1');
    expect(a.textContent).toContain('example.org');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(el.textContent).toContain('(and later).');
  });
  it('never links anything but http(s)', () => {
    const el = mount(createElement(LinkedText, { text: 'javascript:alert(1) and ftp://host/x' }));
    expect(el.querySelector('a')).toBeNull();
  });
});

const entry = (over: Partial<AuditEntry>): AuditEntry =>
  ({ id: 'a1', at: '2026-10-29T10:00:00Z', actor: 'ann', action: 'update', record_id: null, before: null, after: null, ...over }) as AuditEntry;

describe('the change feed says what changed', () => {
  const anchor = rec('anchor', 'DP', { title: 'Pip departure', data: { code: 'DP', meaning: 'Pip departure', date: '2027-07-01' } });
  const idx = buildIndexes([anchor], []);
  it('names a moved date with where it was and where it went', () => {
    const line = describeAudit(entry({ action: 'anchor_change', record_id: anchor.id, before: { data: { date: '2027-07-01' } }, after: { data: { date: '2027-10-01' } } }), idx, DIR);
    expect(line.what).toBe('moved Pip departure from Jul 1, 2027 to Oct 1, 2027');
    expect(line.recordId).toBe(anchor.id);
  });
  it('folds consecutive changes of one kind by one person into one row', () => {
    const entries = [1, 2, 3, 4, 5].map((n) =>
      entry({ id: `e${n}`, at: `2026-10-29T10:0${n}:00Z`, action: 'anchor_change', record_id: anchor.id, before: { date: '2027-07-01' }, after: { date: '2027-08-01' } }),
    );
    const lines = describeAuditList(entries, idx, DIR);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.what).toBe('moved 5 travel dates');
    expect(lines[0]!.recordId).toBeNull();
  });
  it('does not fold different people, different kinds or distant times', () => {
    const base = describeAudit(entry({ action: 'approve' }), idx, DIR);
    const lines = groupSimilar([
      { ...base, id: '1', who: 'Ann' },
      { ...base, id: '2', who: 'Bo' },
      { ...base, id: '3', who: 'Bo', action: 'create' },
      { ...base, id: '4', who: 'Bo', action: 'create', at: '2026-10-20T10:00:00Z' },
    ]);
    expect(lines.map((l) => l.id)).toEqual(['1', '2', '3', '4']);
  });
});

describe('questions are told apart', () => {
  const q = (key: string, data: Record<string, unknown>) => rec('question', key, { data }) as never;
  it('adviser questions and review-added questions are not suggested as plan questions', () => {
    expect(isAdviserQuestion(q('Q1', { audience: 'tax_adviser' }))).toBe(true);
    expect(isAdviserQuestion(q('Q2', { audience: 'household' }))).toBe(false);
    expect(isAdviserQuestion(q('Q3', {}))).toBe(false);
    expect(isPlanQuestion(q('Q4', { origin: 'review' }))).toBe(false);
    expect(isPlanQuestion(q('Q5', { audience: 'veterinarian' }))).toBe(false);
    expect(isPlanQuestion(q('Q6', { origin: 'plan' }))).toBe(true);
  });
  it('audiences and reviewers read as words', () => {
    expect(audienceLabel('immigration_adviser')).toBe('immigration adviser');
    expect(audienceLabel('pet_transport_agent')).toBe('pet transport agent');
    expect(reviewerLabel('immigration_tax')).toBe('Immigration and tax review');
    expect(reviewerLabel(null)).toBeNull();
  });
});

describe('how a rule counts', () => {
  it('says it in words', () => {
    expect(ruleCountSentence({ offset: 6, unit: 'calendar_months', direction: 'after' }, 'Ann’s arrival')).toBe('6 months after Ann’s arrival');
    expect(ruleCountSentence({ offset: 1, unit: 'business_days', direction: 'before' }, 'the filing')).toBe('1 business day before the filing');
    expect(ruleCountSentence({ offset: 0, unit: 'calendar_days', direction: 'after' }, 'landing')).toBe('On the day of landing');
    expect(ruleCountSentence({ offset: 14, unit: 'calendar_days', direction: 'after', anchor_role: 'arrival' }, null)).toBe('14 days after arrival in Japan');
    expect(ruleCountSentence({ offset: null }, 'x')).toBeNull();
  });
});

describe('a decision that settles whether a step applies to the pet', () => {
  const dec = decision('D-X1', 'approved', { options: [{ id: 'y', label: 'Yes — keep it open', consequences: '', source: 'imported' }, { id: 'n', label: 'No — drop it', consequences: '', source: 'imported' }], decided_option_id: 'y' });
  const step = milestone('W-X1', 'planned', { conditional: 'only if the pet returns' });
  const idx = buildIndexes([dec, step], []);
  it('offers the answer for the step it is wired to, and only then', () => {
    const rules = [{ decision_key: 'D-X1', record_key: 'W-X1' }];
    const eff = decisionEffect(dec as never, idx, DIR, { decision_effects: rules });
    expect(eff).toMatchObject({ personId: 'pip', answer: 'yes', applied: false });
    expect(decisionEffect(dec as never, idx, DIR, { decision_effects: [] })).toBeNull();
    expect(effectRules({ decision_effects: rules })).toEqual([{ decisionKey: 'D-X1', recordKey: 'W-X1' }]);
    expect(effectRules(undefined)).toEqual(DEFAULT_DECISION_EFFECTS);
  });
  it('shows it as applied once the step already carries that answer', () => {
    const answered = buildIndexes([dec, { ...step, data: { ...(step.data as object), applies_to: { pip: 'yes' } } } as never], []);
    expect(decisionEffect(dec as never, answered, DIR, { decision_effects: [{ decision_key: 'D-X1', record_key: 'W-X1' }] })?.applied).toBe(true);
  });
});

describe('the plan groups by area when the workstream mapping is missing', () => {
  const ms = [
    milestone('W1', 'planned', { work_area: 'Housing' }),
    milestone('W2', 'planned', { work_area: 'Housing' }),
    milestone('W3', 'planned', { work_area: 'Documents' }),
    milestone('W4', 'completed', { work_area: 'Documents' }),
  ];
  const idx = buildIndexes(ms, []);
  const items = buildPlanItems(idx, undefined, '2026-10-29');
  it('uses the area text, never one giant "Other work"', () => {
    const g = groupPlan(items, idx);
    expect(g.mode).toBe('area');
    expect(g.groups.map((x) => x.title).sort()).toEqual(['Documents', 'Housing']);
  });
  it('uses real workstreams when most items have one', () => {
    const ws = rec('workstream', 'S1', { title: 'Workstream one', data: {} });
    const mapped = [milestone('W1', 'planned', { workstream_key: 'S1' }), milestone('W2', 'planned', { workstream_key: 'S1' }), milestone('W3', 'planned')];
    const idx2 = buildIndexes([ws, ...mapped], []);
    const g = groupPlan(buildPlanItems(idx2, undefined, '2026-10-29'), idx2);
    expect(g.mode).toBe('workstream');
    expect(g.groups[0]!.title).toBe('Workstream one');
  });
});

describe('a check-in date for later-phase work is not shown on its card', () => {
  const now = milestone('W1', 'planned', { phase: 'p1_now_nov2026' });
  const later = milestone('W2', 'planned', { phase: 'p4_stage_minus_90' });
  const idx = buildIndexes([now, later], []);
  const checkin = (id: string, key: string) => computed(`review:${key}`, '2026-11-11', 'review_date', { source: 'review', record_id: id, record_key: key, traveler: null });
  it('keeps it for current work and drops it for later work', () => {
    expect(whenFor(now as never, idx, [checkin(now.id, 'W1')], '2026-10-29').primary?.kind).toBe('review_date');
    expect(whenFor(later as never, idx, [checkin(later.id, 'W2')], '2026-10-29').primary).toBeNull();
  });
});

describe('people used by these tests are the fictional ones', () => {
  it('stay Ann, Bo and Pip', () => {
    expect(PEOPLE.map((p) => p.display_name)).toEqual(['Ann', 'Bo', 'Pip']);
  });
});
