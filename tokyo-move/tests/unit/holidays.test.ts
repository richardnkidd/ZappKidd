import { describe, expect, it } from 'vitest';
import { weekday } from '../../src/shared/dates';
import { calendarFor, calendarForRule, holidayName, holidaysAround, holidaysFor, isHoliday, japaneseHolidays, usHolidays } from '../../src/shared/holidays';

const dates = (m: ReadonlyMap<string, string>) => [...m.keys()];

describe('Japanese national holidays', () => {
  it('2027 matches the statutory calendar, including the Sunday equinox and its substitute holiday', () => {
    const h = japaneseHolidays(2027);
    expect(dates(h)).toEqual([
      '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04',
      '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23',
    ]);
    expect(h.get('2027-02-11')).toBe('National Foundation Day');
    expect(h.get('2027-03-21')).toBe('Vernal Equinox Day'); // a Sunday
    expect(weekday('2027-03-21')).toBe(0);
    expect(h.get('2027-03-22')).toBe('Substitute holiday (Vernal Equinox Day)');
    expect(h.get('2027-09-23')).toBe('Autumnal Equinox Day');
  });

  it('2026 has the Golden Week substitute holiday and the September citizens\' holiday', () => {
    const h = japaneseHolidays(2026);
    expect(weekday('2026-05-03')).toBe(0);
    expect(h.get('2026-05-06')).toBe('Substitute holiday (Constitution Memorial Day)'); // May 4 and 5 are already holidays
    expect(h.get('2026-09-21')).toBe('Respect for the Aged Day');
    expect(h.get('2026-09-22')).toBe("Citizens' holiday");
    expect(h.get('2026-09-23')).toBe('Autumnal Equinox Day');
    expect(h.get('2026-03-20')).toBe('Vernal Equinox Day');
    expect(h.get('2026-11-23')).toBe('Labor Thanksgiving Day');
    expect(h.has('2026-01-12')).toBe(true); // second Monday of January
    expect(h.has('2026-07-20')).toBe(true); // third Monday of July
    expect(h.has('2026-10-12')).toBe(true); // second Monday of October
  });

  it('handles the one-off years (2019 accession, 2020 and 2021 Olympic moves) and the Emperor\'s birthday change', () => {
    const y2019 = japaneseHolidays(2019);
    for (const d of ['2019-04-29', '2019-04-30', '2019-05-01', '2019-05-02', '2019-05-03', '2019-10-22']) expect(y2019.has(d), d).toBe(true);
    expect(y2019.get('2019-05-02')).toBe("Citizens' holiday");
    expect([...y2019.values()]).not.toContain("Emperor's Birthday");
    expect(japaneseHolidays(2018).get('2018-12-23')).toBe("Emperor's Birthday");
    expect(japaneseHolidays(2020).get('2020-02-23')).toBe("Emperor's Birthday");
    const y2021 = japaneseHolidays(2021);
    expect(y2021.get('2021-07-22')).toBe('Marine Day');
    expect(y2021.get('2021-07-23')).toBe('Sports Day');
    expect(y2021.get('2021-08-08')).toBe('Mountain Day');
    expect(y2021.get('2021-08-09')).toBe('Substitute holiday (Mountain Day)');
  });

  it('is well-formed for every year 2000–2099', () => {
    for (let y = 2000; y <= 2099; y++) {
      const h = japaneseHolidays(y);
      expect(h.size, String(y)).toBeGreaterThanOrEqual(14);
      expect(h.size, String(y)).toBeLessThanOrEqual(22);
      for (const [d, name] of h) {
        expect(d.startsWith(String(y))).toBe(true);
        if (name.startsWith('Substitute')) expect(weekday(d), `${d} ${name}`).not.toBe(0);
      }
    }
    expect(japaneseHolidays(1999).size).toBe(0);
    expect(japaneseHolidays(2100).size).toBe(0);
  });
});

describe('US federal holidays', () => {
  it('2027 uses the observed-day rules (Sunday → Monday, Saturday → Friday, Saturday Jan 1 → Dec 31)', () => {
    const h = usHolidays(2027);
    expect(dates(h)).toEqual([
      '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24', '2027-12-31',
    ]);
    expect(weekday('2027-07-04')).toBe(0);
    expect(h.get('2027-07-05')).toBe('Independence Day (observed)');
    expect(h.get('2027-11-25')).toBe('Thanksgiving Day');
    expect(h.get('2027-06-18')).toBe('Juneteenth (observed)'); // June 19 is a Saturday
    expect(h.get('2027-12-24')).toBe('Christmas Day (observed)');
    expect(h.get('2027-12-31')).toBe("New Year's Day (observed)"); // Jan 1, 2028 is a Saturday
    expect(h.has('2027-07-04')).toBe(false);
  });

  it('2026 dates', () => {
    const h = usHolidays(2026);
    expect(h.get('2026-07-03')).toBe('Independence Day (observed)');
    expect(h.get('2026-11-26')).toBe('Thanksgiving Day');
    expect(h.get('2026-05-25')).toBe('Memorial Day');
    expect(h.get('2026-09-07')).toBe('Labor Day');
    expect(h.get('2026-01-19')).toBe('Martin Luther King Jr. Day');
    expect(h.get('2026-11-11')).toBe('Veterans Day');
  });

  it('only ever lists weekdays', () => {
    for (let y = 2000; y <= 2099; y++) for (const d of usHolidays(y).keys()) expect([0, 6], `${d}`).not.toContain(weekday(d));
    expect(usHolidays(1999).size).toBe(0);
  });
});

describe('lookups', () => {
  it('maps jurisdictions and zones to a calendar', () => {
    for (const k of ['JP', 'JP-Tokyo', 'Asia/Tokyo']) expect(calendarFor(k)).toBe('JP');
    for (const k of ['US', 'US-HI', 'US-MD', 'Pacific/Honolulu', 'America/New_York']) expect(calendarFor(k)).toBe('US');
    for (const k of ['household', 'contract', null, undefined, '']) expect(calendarFor(k as string | null | undefined)).toBeNull();
    // a rule's jurisdiction wins; the zone is the fallback
    expect(calendarForRule('JP', 'Pacific/Honolulu')).toBe('JP');
    expect(calendarForRule('household', 'Asia/Tokyo')).toBe('JP');
    expect(calendarForRule(null, 'Pacific/Honolulu')).toBe('US');
    expect(calendarForRule('household', null)).toBeNull();
  });

  it('holidaysFor covers 2026–2030 by default and accepts a range', () => {
    const jp = holidaysFor('JP');
    expect(jp.has('2027-02-11')).toBe(true);
    expect(jp.has('2027-03-22')).toBe(true);
    expect(jp.has('2030-11-23')).toBe(true);
    expect(jp.has('2025-11-23')).toBe(false);
    expect(holidaysFor('Asia/Tokyo')).toEqual(jp);
    const us = holidaysFor('US-HI');
    expect(us.has('2027-07-05')).toBe(true);
    expect(us.has('2027-11-25')).toBe(true);
    expect(us.has('2027-02-11')).toBe(false);
    expect(holidaysFor('Pacific/Honolulu')).toEqual(us);
    expect(holidaysFor('household').size).toBe(0);
    expect(holidaysFor('JP', 2025, 2025).has('2025-11-23')).toBe(true);
  });

  it('names holidays and answers isHoliday for any year in range', () => {
    expect(holidayName('JP', '2027-03-22')).toBe('Substitute holiday (Vernal Equinox Day)');
    expect(isHoliday('JP', '2027-03-23')).toBe(false);
    expect(isHoliday('US', '2027-07-05')).toBe(true);
    expect(isHoliday(null, '2027-07-05')).toBe(false);
    const around = holidaysAround('JP', '2027-06-15');
    expect(around.has('2026-11-23')).toBe(true);
    expect(around.has('2029-01-01')).toBe(true);
  });
});
