import { describe, expect, it } from 'vitest';
import {
  displayDelay,
  displayNext,
  displayQuestion,
  displaySummary,
  displayTitle,
  hasPlainWording,
  keyLookup,
  looksLikeKey,
  optionLabel,
  stripCodes,
  tidyProse,
} from '../../src/shared/plain';
import { buildDemoBundle } from '../../fixtures/demo/bundle';

const rec = (type: string, title: string, data: Record<string, unknown> = {}) => ({ type, title, data });
const titles = new Map([
  ['W04', { title: "Avery's employer support" }],
  ['W08', { title: 'Tax review' }],
  ['D02', { title: 'The durable plan home' }],
]);
const lookup = keyLookup(titles);

describe('stripCodes', () => {
  it('drops bracketed codes and tidies the sentence', () => {
    expect(stripCodes("set full limits once Avery's support (W04) and tax facts (W08) are known")).toBe(
      "set full limits once Avery's support and tax facts are known",
    );
    expect(stripCodes('Wait for the route (W04, W08).')).toBe('Wait for the route.');
    expect(stripCodes('Wait (W04 and W08) then go')).toBe('Wait then go');
  });

  it('drops bare codes without a lookup and names them with one', () => {
    expect(stripCodes('Blocked by W04 until it is answered')).toBe('Blocked by until it is answered');
    expect(stripCodes('Blocked by W04 until it is answered', lookup)).toBe("Blocked by Avery's employer support until it is answered");
    expect(stripCodes('Needs W04 and W08 first', lookup)).toBe("Needs Avery's employer support and Tax review first");
  });

  it('drops a code the lookup does not know, and leaves nothing odd behind', () => {
    expect(stripCodes('See W99 for more', lookup)).toBe('See for more');
    expect(stripCodes('W04 / W08')).toBe('');
    expect(stripCodes('Housing / W04 / W08')).toBe('Housing');
    expect(stripCodes('DOC12, B07 and R03 and S01')).toBe('');
    expect(stripCodes('Do we use Q017?')).toBe('Do we use?');
    expect(stripCodes('[W04] first')).toBe('first');
  });

  it('keeps text with no codes exactly as written, including slashes inside words', () => {
    expect(stripCodes('Move/rent/overlap/reserve limits')).toBe('Move/rent/overlap/reserve limits');
    expect(stripCodes('Use D-45 and DP-10 as offsets')).toBe('Use D-45 and DP-10 as offsets');
    expect(stripCodes('')).toBe('');
    expect(stripCodes(null)).toBe('');
  });

  it('tidies leftover separators and spaces', () => {
    expect(tidyProse('a  ,  b ( ) c')).toBe('a, b c');
    expect(tidyProse('x / ')).toBe('x');
    expect(tidyProse('( , a)')).toBe('(a)');
  });

  it('recognises a key', () => {
    expect(looksLikeKey('see W04')).toBe(true);
    expect(looksLikeKey('see nothing')).toBe(false);
  });
});

describe('displayTitle', () => {
  it('prefers plain_title', () => {
    expect(displayTitle(rec('decision', 'Move/rent/overlap/reserve limits', { plain_title: '  Moving money limits ' }))).toBe('Moving money limits');
  });
  it('falls back to the title with codes removed and does not rewrite slashes', () => {
    expect(displayTitle(rec('decision', 'Move/rent/overlap/reserve limits'))).toBe('Move/rent/overlap/reserve limits');
    expect(displayTitle(rec('milestone', 'Finish W04 / W08 review'))).toBe('Finish review');
    expect(displayTitle(rec('milestone', 'Finish W04 review'), lookup)).toBe("Finish Avery's employer support review");
  });
  it('ignores empty or non-text plain fields', () => {
    expect(displayTitle(rec('risk', 'Plain risk', { plain_title: '   ' }))).toBe('Plain risk');
    expect(displayTitle(rec('risk', 'Plain risk', { plain_title: 5 }))).toBe('Plain risk');
  });
  it('never returns an empty string for a code-only title', () => {
    expect(displayTitle(rec('milestone', 'W04'))).toBe('W04');
  });
});

describe('displayQuestion', () => {
  it('prefers plain_question', () => {
    expect(displayQuestion(rec('decision', 'Anything', { plain_question: 'Do we go in July?' }))).toBe('Do we go in July?');
  });
  it('uses a title that already ends in a question mark', () => {
    expect(displayQuestion(rec('decision', 'Do we go in July?'))).toBe('Do we go in July?');
  });
  it('is null otherwise', () => {
    expect(displayQuestion(rec('decision', 'Select the durable plan home'))).toBeNull();
    expect(displayQuestion(rec('decision', 'Move/rent/overlap/reserve limits'))).toBeNull();
  });
});

describe('displaySummary, displayDelay, displayNext', () => {
  it('summary is plain_summary or null', () => {
    expect(displaySummary(rec('decision', 'x', { plain_summary: 'The why.' }))).toBe('The why.');
    expect(displaySummary(rec('decision', 'x', { rationale: 'Long rationale' }))).toBeNull();
  });
  it('delay falls back to the imported consequence with codes removed', () => {
    expect(displayDelay(rec('decision', 'x', { plain_delay: 'We cannot book flights.', consequence_of_delay: 'Long' }))).toBe('We cannot book flights.');
    expect(displayDelay(rec('decision', 'x', { consequence_of_delay: 'Housing waits for the answer (W04).' }))).toBe('Housing waits for the answer.');
    expect(displayDelay(rec('decision', 'x', { consequence_of_delay: null }))).toBeNull();
    expect(displayDelay(rec('decision', 'x', { consequence_of_delay: '(W04)' }))).toBeNull();
    expect(displayDelay(rec('decision', 'x'))).toBeNull();
  });
  it('next falls back to next_action with codes removed', () => {
    expect(displayNext(rec('milestone', 'x', { plain_next: 'Call the adviser.', next_action: 'Long text' }))).toBe('Call the adviser.');
    expect(displayNext(rec('milestone', 'x', { next_action: 'Do W04 first (W08).' }), lookup)).toBe("Do Avery's employer support first.");
    expect(displayNext(rec('milestone', 'x', {}))).toBeNull();
  });
});

describe('optionLabel', () => {
  const decision = rec('decision', 'D', { plain_options: { 'opt-1': ' Short label ', 'opt-2': '' } });
  it('uses the plain label for that option id', () => {
    expect(optionLabel(decision, { id: 'opt-1', label: 'Long imported label' })).toBe('Short label');
  });
  it('falls back to the option label with codes removed', () => {
    expect(optionLabel(decision, { id: 'opt-2', label: "set full limits once Avery's support (W04) and tax facts (W08) are known" })).toBe(
      "set full limits once Avery's support and tax facts are known",
    );
    expect(optionLabel(rec('decision', 'D'), { id: 'opt-9', label: 'Plain one' })).toBe('Plain one');
    expect(optionLabel(rec('decision', 'D', { plain_options: null }), { id: 'opt-1', label: 'Plain one' })).toBe('Plain one');
  });
});

describe('hasPlainWording', () => {
  it('decisions and questions need a plain question', () => {
    expect(hasPlainWording(rec('decision', 'x', { plain_question: 'Q?' }))).toBe(true);
    expect(hasPlainWording(rec('decision', 'x', { plain_title: 'T' }))).toBe(false);
    expect(hasPlainWording(rec('question', 'x', { plain_question: ' ' }))).toBe(false);
    expect(hasPlainWording(rec('question', 'x', { plain_question: 'Q?' }))).toBe(true);
  });
  it('milestones need a plain next step; others a plain title', () => {
    expect(hasPlainWording(rec('milestone', 'x', { plain_next: 'Do it.' }))).toBe(true);
    expect(hasPlainWording(rec('milestone', 'x', { next_action: 'Do it.' }))).toBe(false);
    expect(hasPlainWording(rec('risk', 'x', { plain_title: 'T' }))).toBe(true);
    expect(hasPlainWording(rec('risk', 'x'))).toBe(false);
  });
});

describe('demo data', () => {
  const bundle = buildDemoBundle();
  const get = (id: string) => bundle.records.find((r) => r.id === id)!;
  it('has plain wording on decisions except exactly one open decision', () => {
    const decisions = bundle.records.filter((r) => r.type === 'decision');
    const without = decisions.filter((r) => !hasPlainWording(r as never));
    expect(without.map((r) => r.id)).toEqual(['decision:D02']);
    expect(without[0]?.status).toBe('open');
    for (const d of decisions.filter((r) => hasPlainWording(r as never))) {
      expect(displayQuestion(d as never)).toMatch(/\?$/);
    }
  });
  it('has decisions with two or three options, each with a plain label', () => {
    const d3 = get('decision:D03');
    const options = (d3.data as { options: { id: string; label: string }[] }).options;
    expect(options).toHaveLength(3);
    for (const o of options) expect(optionLabel(d3 as never, o).split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(((get('decision:D04').data as { options: unknown[] }).options)).toHaveLength(2);
  });
  it('keeps the plain wording within the word budgets', () => {
    const words = (s: unknown) => String(s).trim().split(/\s+/).length;
    for (const r of bundle.records) {
      const d = r.data as Record<string, unknown>;
      if (d.plain_title) expect(words(d.plain_title)).toBeLessThanOrEqual(12);
      if (d.plain_summary) expect(words(d.plain_summary)).toBeLessThanOrEqual(25);
      if (d.plain_delay) expect(words(d.plain_delay)).toBeLessThanOrEqual(15);
      if (d.plain_next) expect(words(d.plain_next)).toBeLessThanOrEqual(12);
      for (const v of Object.values((d.plain_options ?? {}) as Record<string, string>)) expect(words(v)).toBeLessThanOrEqual(20);
    }
  });
  it('gives a handful of milestones a plain next step', () => {
    expect(bundle.records.filter((r) => r.type === 'milestone' && (r.data as { plain_next?: string }).plain_next).length).toBeGreaterThanOrEqual(5);
  });
  it('no longer carries the importer boilerplate', () => {
    for (const r of bundle.records.filter((x) => x.type === 'decision')) {
      expect(String((r.data as { history_note: string | null }).history_note ?? '')).not.toContain('Only the imported recommendation');
    }
  });
});
