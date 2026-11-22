import { describe, expect, it } from 'vitest';
import { dateLine, dateLineText, dayWord } from '../../src/web/lib/dateLine';

const T = '2026-11-22';

describe('dateLine: the one date format', () => {
  it('future dates read "Mon, Nov 30 (8 days)"', () => {
    expect(dateLine('2026-11-30', T)).toMatchObject({ text: 'Mon, Nov 30 (8 days)', when: 'future', days: 8 });
    expect(dateLine('2026-11-24', T).text).toBe('Tue, Nov 24 (2 days)');
  });
  it('today and tomorrow are single words', () => {
    expect(dateLine(T, T)).toMatchObject({ text: 'Today', when: 'today' });
    expect(dateLine('2026-11-23', T)).toMatchObject({ text: 'Tomorrow', when: 'tomorrow' });
  });
  it('past dates on open items read "N days late", and the calendar date is kept for the accessible text', () => {
    expect(dateLine('2026-11-11', T)).toMatchObject({ text: '11 days late', when: 'late', days: -11, dateText: 'Wed, Nov 11' });
    expect(dateLine('2026-11-21', T).text).toBe('1 day late');
  });
  it('a past date that is a fact (not open) stays a plain date', () => {
    expect(dateLine('2026-11-11', T, { open: false })).toMatchObject({ text: 'Wed, Nov 11', when: 'plain' });
  });
  it('adds a year only when it is another year or more than six months away, and never the long month form', () => {
    expect(dateLine('2027-08-21', T).text).toBe('Sat, Aug 21, 2027 (272 days)');
    expect(dateLine('2026-12-30', T).text).not.toMatch(/2026|December/);
  });
  it('words and text-only form', () => {
    expect(dayWord(1)).toBe('1 day');
    expect(dateLineText(null, T)).toBe('Awaiting date');
    expect(dateLineText('2026-11-30', T)).toBe('Mon, Nov 30 (8 days)');
  });
});
