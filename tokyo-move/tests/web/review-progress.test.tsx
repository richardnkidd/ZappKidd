/** What an open couple review remembers about its own progress (pure helpers; the page and server are covered elsewhere). */
import { describe, expect, it } from 'vitest';
import { describeProgress, EMPTY_PROGRESS, hasProgress, mergeProgress, progressOf, toProgress } from '../../src/web/lib/reviews';

const progress = {
  step: 2,
  accepted: [{ id: 'milestone:W06', title: 'A shared step', owner: 'Bo' }],
  decisions: [{ id: 'decision:D02', title: 'A decision', outcome: 'Ann approved “the first option”' }],
  questions: [],
  change_count: 4,
};

describe('review progress', () => {
  it('reads what the record holds, defensively', () => {
    expect(progressOf({ data: { progress } })).toEqual(progress);
    expect(progressOf({ data: {} })).toBeNull();
    expect(progressOf({ data: { progress: 'nope' } })).toBeNull();
    expect(progressOf(undefined)).toBeNull();
    // Malformed entries and out-of-range numbers are dropped or clamped, never thrown on.
    const odd = progressOf({ data: { progress: { step: 99, accepted: [{ id: 'a', title: 5 }, { nope: 1 }, null], decisions: 'x', questions: [{ id: 'q', title: 'T\nU', outcome: 'ok' }], change_count: -3 } } })!;
    expect(odd.step).toBe(4);
    expect(odd.accepted).toEqual([{ id: 'a', title: '5', owner: '' }]);
    expect(odd.decisions).toEqual([]);
    expect(odd.questions).toEqual([{ id: 'q', title: 'T U', outcome: 'ok' }]);
    expect(odd.change_count).toBe(0);
  });

  it('builds what the server accepts: single-line text, bounded lists, a step inside the five', () => {
    const p = toProgress({ accepted: [{ id: 'm', title: 'Line one\nline two', owner: 'Bo' }], decisions: [], questions: [{ id: 'q', title: 'x'.repeat(900), outcome: 'carried forward' }], changeCount: 2.7 }, 12);
    expect(p.step).toBe(4);
    expect(p.accepted[0]!.title).toBe('Line one line two');
    expect(p.questions[0]!.title).toHaveLength(500);
    expect(p.change_count).toBe(2);
    expect(toProgress({ accepted: [], decisions: [], questions: [], changeCount: 0 }, -1)).toEqual(EMPTY_PROGRESS);
  });

  it('keeps both people’s entries when two have the review open (this person wins on the same record)', () => {
    const theirs = { step: 1, accepted: [{ id: 'm1', title: 'Theirs', owner: 'Bo' }], decisions: [{ id: 'd1', title: 'D', outcome: 'put off for now' }], questions: [], change_count: 9 };
    const mine = { step: 3, accepted: [{ id: 'm2', title: 'Mine', owner: 'Ann' }], decisions: [{ id: 'd1', title: 'D', outcome: 'Ann approved an option' }], questions: [{ id: 'q1', title: 'Q', outcome: 'answered' }], change_count: 4 };
    const merged = mergeProgress(theirs, mine);
    expect(merged.step).toBe(3);
    expect(merged.accepted.map((a) => a.id)).toEqual(['m1', 'm2']);
    expect(merged.decisions).toEqual([{ id: 'd1', title: 'D', outcome: 'Ann approved an option' }]);
    expect(merged.questions.map((q) => q.id)).toEqual(['q1']);
    expect(merged.change_count).toBe(9);
    expect(mergeProgress(null, mine)).toBe(mine);
  });

  it('says in one calm sentence where an open review stands', () => {
    expect(hasProgress(EMPTY_PROGRESS)).toBe(false);
    expect(hasProgress(progress)).toBe(true);
    expect(hasProgress({ ...EMPTY_PROGRESS, change_count: 12 })).toBe(false);
    expect(describeProgress(progress)).toBe('You are on step 3 of 5 (Decisions). So far: 1 owner confirmed, 1 decision handled, 0 questions handled.');
    expect(describeProgress(null)).toMatch(/has not gone far yet/);
  });
});
