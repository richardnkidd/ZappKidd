import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addCalendarDays,
  addCalendarMonths,
  compareCivil,
  diffDays,
  formatCivil,
  formatInstant,
  fromDayNumber,
  isCivilDate,
  relativeDays,
  todayIn,
  toDayNumber,
  weekday,
  zoneLabel,
} from '../../src/shared/dates';

describe('isCivilDate', () => {
  it('accepts real days and rejects impossible ones', () => {
    expect(isCivilDate('2026-10-29')).toBe(true);
    expect(isCivilDate('2028-02-29')).toBe(true);
    expect(isCivilDate('2027-02-29')).toBe(false);
    expect(isCivilDate('1900-02-29')).toBe(false);
    expect(isCivilDate('2000-02-29')).toBe(true);
    expect(isCivilDate('2026-13-01')).toBe(false);
    expect(isCivilDate('2026-00-10')).toBe(false);
    expect(isCivilDate('2026-4-5')).toBe(false);
    expect(isCivilDate('2026-10-29T00:00:00Z')).toBe(false);
    expect(isCivilDate(20261029)).toBe(false);
    expect(isCivilDate(null)).toBe(false);
  });
});

describe('day numbers', () => {
  it('uses 1970-01-01 as day 0 and round-trips', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(toDayNumber('1970-01-02')).toBe(1);
    expect(toDayNumber('1969-12-31')).toBe(-1);
    for (const d of ['2000-02-29', '2024-12-31', '2026-10-29', '2100-03-01', '1900-03-01', '0001-01-01']) {
      expect(fromDayNumber(toDayNumber(d))).toBe(d);
    }
  });
  it('throws on invalid input rather than guessing', () => {
    expect(() => toDayNumber('2027-02-29')).toThrow();
    expect(() => toDayNumber('nope')).toThrow();
  });
});

describe('addCalendarDays', () => {
  it('handles leap years', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addCalendarDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addCalendarDays('2027-12-31', 366)).toBe('2028-12-31');
    expect(addCalendarDays('2028-12-31', 366)).toBe('2030-01-01');
  });
  it('handles negative offsets and year boundaries', () => {
    expect(addCalendarDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addCalendarDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addCalendarDays('2027-07-01', -60)).toBe('2027-05-02');
    expect(addCalendarDays('2027-07-01', -40)).toBe('2027-05-22');
    expect(addCalendarDays('2027-07-31', -60)).toBe('2027-06-01');
    expect(addCalendarDays('2027-07-31', 0)).toBe('2027-07-31');
  });
});

describe('addCalendarMonths (EDATE)', () => {
  it('clamps to the last day of the target month', () => {
    expect(addCalendarMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addCalendarMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addCalendarMonths('2027-03-31', -1)).toBe('2027-02-28');
    expect(addCalendarMonths('2027-05-31', 1)).toBe('2027-06-30');
  });
  it('rolls years in both directions', () => {
    expect(addCalendarMonths('2027-07-15', 6)).toBe('2028-01-15');
    expect(addCalendarMonths('2027-07-15', 36)).toBe('2030-07-15');
    expect(addCalendarMonths('2027-01-15', -1)).toBe('2026-12-15');
    expect(addCalendarMonths('2027-01-15', -13)).toBe('2025-12-15');
    expect(addCalendarMonths('2027-07-15', 0)).toBe('2027-07-15');
  });
});

describe('addBusinessDays', () => {
  it('skips weekends and flags approximate without a holiday calendar', () => {
    // 2026-10-30 is a Friday.
    expect(weekday('2026-10-30')).toBe(5);
    expect(addBusinessDays('2026-10-30', 1)).toEqual({ date: '2026-11-02', approximate: true });
    expect(addBusinessDays('2026-10-30', 5)).toEqual({ date: '2026-11-06', approximate: true });
    expect(addBusinessDays('2026-11-02', -1)).toEqual({ date: '2026-10-30', approximate: true });
    expect(addBusinessDays('2026-11-02', -5)).toEqual({ date: '2026-10-26', approximate: true });
  });
  it('starting on a weekend', () => {
    // Saturday 2026-10-31
    expect(addBusinessDays('2026-10-31', 1).date).toBe('2026-11-02');
    expect(addBusinessDays('2026-10-31', -1).date).toBe('2026-10-30');
    expect(addBusinessDays('2026-10-31', 0).date).toBe('2026-10-31');
  });
  it('skips supplied holidays and is not approximate', () => {
    const holidays = new Set(['2026-11-03', '2026-11-23']);
    expect(addBusinessDays('2026-10-30', 2, holidays)).toEqual({ date: '2026-11-04', approximate: false });
    expect(addBusinessDays('2026-11-05', -2, holidays)).toEqual({ date: '2026-11-02', approximate: false });
  });
  it('an empty holiday set is still approximate', () => {
    expect(addBusinessDays('2026-10-30', 1, new Set()).approximate).toBe(true);
  });
});

describe('diff / compare / weekday', () => {
  it('computes b minus a', () => {
    expect(diffDays('2026-10-29', '2026-11-11')).toBe(13);
    expect(diffDays('2026-11-11', '2026-10-29')).toBe(-13);
    expect(diffDays('2027-02-28', '2027-03-01')).toBe(1);
    expect(diffDays('2028-02-28', '2028-03-01')).toBe(2);
  });
  it('orders civil dates', () => {
    expect(compareCivil('2026-10-29', '2026-10-30')).toBe(-1);
    expect(compareCivil('2026-10-29', '2026-10-29')).toBe(0);
    expect(compareCivil('2027-01-01', '2026-12-31')).toBe(1);
  });
  it('knows the weekday', () => {
    expect(weekday('1970-01-01')).toBe(4);
    expect(weekday('2026-10-29')).toBe(4); // Thursday
    expect(weekday('2000-01-01')).toBe(6);
    expect(weekday('2027-07-01')).toBe(4);
  });
});

describe('formatCivil', () => {
  it('never shifts by timezone and supports all styles', () => {
    expect(formatCivil('2026-10-29')).toBe('Oct 29, 2026');
    expect(formatCivil('2026-10-29', 'long')).toBe('Thursday, October 29, 2026');
    expect(formatCivil('2026-10-29', 'compact')).toBe('Oct 29');
    expect(formatCivil('2026-10-29', 'weekday')).toBe('Thu, Oct 29');
    expect(formatCivil('2027-01-01')).toBe('Jan 1, 2027');
  });
  it('yields the same civil date under any process timezone', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['Asia/Tokyo', 'Pacific/Honolulu', 'America/New_York', 'UTC']) {
        process.env.TZ = tz;
        expect(formatCivil('2027-07-01')).toBe('Jul 1, 2027');
        expect(addCalendarDays('2027-07-01', 0)).toBe('2027-07-01');
        expect(fromDayNumber(toDayNumber('2027-07-01'))).toBe('2027-07-01');
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('todayIn', () => {
  it('differs across zones around midnight in Tokyo', () => {
    // 2026-10-28 15:30 UTC = Oct 29 00:30 JST = Oct 28 05:30 HST = Oct 28 11:30 EDT
    const now = new Date('2026-10-28T15:30:00Z');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-29');
    expect(todayIn('Pacific/Honolulu', now)).toBe('2026-10-28');
    expect(todayIn('America/New_York', now)).toBe('2026-10-28');
  });
  it('handles Honolulu evening vs Tokyo next day', () => {
    // 2026-10-29 03:00 UTC = Oct 29 12:00 JST = Oct 28 17:00 HST = Oct 28 23:00 EDT
    const now = new Date('2026-10-29T03:00:00Z');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-29');
    expect(todayIn('Pacific/Honolulu', now)).toBe('2026-10-28');
    expect(todayIn('America/New_York', now)).toBe('2026-10-28');
    // one hour later New York has crossed midnight (EDT until Nov 1)
    expect(todayIn('America/New_York', new Date('2026-10-29T04:00:00Z'))).toBe('2026-10-29');
  });
  it('handles midnight exactly and DST end in New York', () => {
    expect(todayIn('Pacific/Honolulu', new Date('2026-10-29T10:00:00Z'))).toBe('2026-10-29');
    expect(todayIn('Pacific/Honolulu', new Date('2026-10-29T09:59:59Z'))).toBe('2026-10-28');
    // DST ends Nov 1 2026 at 06:00 UTC in New York
    expect(todayIn('America/New_York', new Date('2026-11-01T04:59:00Z'))).toBe('2026-11-01');
    expect(todayIn('America/New_York', new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
    expect(todayIn('America/New_York', new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01');
    expect(todayIn('America/New_York', new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02');
  });
});

describe('formatInstant', () => {
  it('shows the zone short name', () => {
    const iso = '2026-10-29T23:25:00Z';
    expect(formatInstant(iso, 'Pacific/Honolulu')).toBe('Oct 29, 1:25 PM HST');
    expect(formatInstant(iso, 'Asia/Tokyo')).toBe('Oct 30, 8:25 AM JST');
    expect(formatInstant(iso, 'America/New_York')).toBe('Oct 29, 7:25 PM EDT');
    expect(formatInstant('2026-12-15T17:05:00Z', 'America/New_York')).toBe('Dec 15, 12:05 PM EST');
  });
  it('supports time-only and long styles, and midnight/noon', () => {
    expect(formatInstant('2026-10-29T23:25:00Z', 'Pacific/Honolulu', 'time')).toBe('1:25 PM HST');
    expect(formatInstant('2026-10-29T23:25:00Z', 'Pacific/Honolulu', 'long')).toBe(
      'Thursday, October 29, 2026, 1:25 PM HST',
    );
    expect(formatInstant('2026-10-29T10:00:00Z', 'Pacific/Honolulu', 'time')).toBe('12:00 AM HST');
    expect(formatInstant('2026-10-29T22:00:00Z', 'Pacific/Honolulu', 'time')).toBe('12:00 PM HST');
  });
});

describe('zoneLabel and relativeDays', () => {
  it('labels zones', () => {
    expect(zoneLabel('Asia/Tokyo')).toBe('Tokyo (JST)');
    expect(zoneLabel('Pacific/Honolulu')).toBe('Honolulu (HST)');
    expect(zoneLabel('America/New_York')).toBe('New York (EST/EDT)');
  });
  it('phrases relative days', () => {
    expect(relativeDays('2026-10-29', '2026-10-29')).toBe('today');
    expect(relativeDays('2026-10-30', '2026-10-29')).toBe('tomorrow');
    expect(relativeDays('2026-10-28', '2026-10-29')).toBe('yesterday');
    expect(relativeDays('2026-11-10', '2026-10-29')).toBe('in 12 days');
    expect(relativeDays('2026-10-26', '2026-10-29')).toBe('3 days ago');
  });
});
