/**
 * Computed public-holiday calendars for business-day maths and weekend/holiday advice.
 * OWNER: import/engines agent.
 *
 * These calendars are COMPUTED from the statutory rules, not copied from an official list, so every consumer must label
 * results "computed; verify against the official calendar" (ComputedDeadline.approximate / business_day_advice).
 *
 * - Japan: national holidays under the current Act (valid for 2000–2099), including the equinox days (astronomical
 *   approximation formula, valid 1980–2099), substitute holidays (a holiday on a Sunday moves to the next day that is not
 *   a holiday) and citizens' holidays (a day between two national holidays). The 2019 accession holidays and the 2020/2021
 *   Olympic-year moves are included.
 * - United States: federal holidays with the observed-day rule (Saturday → Friday, Sunday → Monday; a Saturday New Year's
 *   Day is observed on the previous Dec 31). State holidays are NOT included.
 */
import { addCalendarDays, fromDayNumber, toDayNumber, weekday } from './dates';

export type HolidayCalendar = 'JP' | 'US';

export const MIN_HOLIDAY_YEAR = 2000;
export const MAX_HOLIDAY_YEAR = 2099;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The n-th (1-based) given weekday (0=Sunday) of a month. */
function nthWeekday(year: number, month: number, wd: number, n: number): string {
  const first = ymd(year, month, 1);
  const offset = (wd - weekday(first) + 7) % 7;
  return addCalendarDays(first, offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, wd: number): string {
  const lastDay = fromDayNumber(toDayNumber(ymd(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1)) - 1);
  const offset = (weekday(lastDay) - wd + 7) % 7;
  return addCalendarDays(lastDay, -offset);
}

/* ------------------------------------------------------------------ */
/* Japan                                                               */
/* ------------------------------------------------------------------ */

function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

const jpCache = new Map<number, ReadonlyMap<string, string>>();

/** Japanese national holidays (date → English name) for one year, 2000–2099. */
export function japaneseHolidays(year: number): ReadonlyMap<string, string> {
  if (year < MIN_HOLIDAY_YEAR || year > MAX_HOLIDAY_YEAR) return new Map();
  const cached = jpCache.get(year);
  if (cached) return cached;

  const base = new Map<string, string>();
  const add = (date: string, name: string) => void base.set(date, name);

  add(ymd(year, 1, 1), "New Year's Day");
  add(nthWeekday(year, 1, 1, 2), 'Coming of Age Day');
  add(ymd(year, 2, 11), 'National Foundation Day');
  if (year >= 2020) add(ymd(year, 2, 23), "Emperor's Birthday");
  else if (year <= 2018) add(ymd(year, 12, 23), "Emperor's Birthday");
  add(ymd(year, 3, vernalEquinoxDay(year)), 'Vernal Equinox Day');
  add(ymd(year, 4, 29), year >= 2007 ? 'Showa Day' : 'Greenery Day');
  add(ymd(year, 5, 3), 'Constitution Memorial Day');
  if (year >= 2007) add(ymd(year, 5, 4), 'Greenery Day');
  add(ymd(year, 5, 5), "Children's Day");
  add(year === 2020 ? ymd(year, 7, 23) : year === 2021 ? ymd(year, 7, 22) : nthWeekday(year, 7, 1, 3), 'Marine Day');
  if (year >= 2016) add(year === 2020 ? ymd(year, 8, 10) : year === 2021 ? ymd(year, 8, 8) : ymd(year, 8, 11), 'Mountain Day');
  add(nthWeekday(year, 9, 1, 3), 'Respect for the Aged Day');
  add(ymd(year, 9, autumnalEquinoxDay(year)), 'Autumnal Equinox Day');
  add(year === 2020 ? ymd(year, 7, 24) : year === 2021 ? ymd(year, 7, 23) : nthWeekday(year, 10, 1, 2), year >= 2020 ? 'Sports Day' : 'Health and Sports Day');
  add(ymd(year, 11, 3), 'Culture Day');
  add(ymd(year, 11, 23), 'Labor Thanksgiving Day');
  if (year === 2019) {
    add('2019-04-30', 'Accession holiday');
    add('2019-05-01', "Emperor's Accession Day");
    add('2019-10-22', 'Enthronement Day');
  }

  // Citizens' holiday: a day (not Sunday) between two national holidays.
  const all = new Map(base);
  for (const date of [...base.keys()].sort()) {
    const middle = addCalendarDays(date, 1);
    if (all.has(middle) || weekday(middle) === 0) continue;
    if (base.has(addCalendarDays(date, 2))) all.set(middle, "Citizens' holiday");
  }
  // Substitute holiday: a national holiday on a Sunday moves to the next day that is not already a holiday.
  for (const date of [...base.keys()].sort()) {
    if (weekday(date) !== 0) continue;
    let next = addCalendarDays(date, 1);
    while (all.has(next)) next = addCalendarDays(next, 1);
    all.set(next, `Substitute holiday (${base.get(date)})`);
  }

  const sorted = new Map([...all].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  jpCache.set(year, sorted);
  return sorted;
}

/* ------------------------------------------------------------------ */
/* United States (federal)                                             */
/* ------------------------------------------------------------------ */

const usCache = new Map<number, ReadonlyMap<string, string>>();

function observed(date: string): string {
  const wd = weekday(date);
  if (wd === 6) return addCalendarDays(date, -1);
  if (wd === 0) return addCalendarDays(date, 1);
  return date;
}

/** US federal holidays as observed (date → name) for one year, 2000–2099. Includes a Dec 31 observance of the next Jan 1. */
export function usHolidays(year: number): ReadonlyMap<string, string> {
  if (year < MIN_HOLIDAY_YEAR || year > MAX_HOLIDAY_YEAR) return new Map();
  const cached = usCache.get(year);
  if (cached) return cached;
  const out = new Map<string, string>();
  const fixed = (m: number, d: number, name: string) => {
    const actual = ymd(year, m, d);
    const obs = observed(actual);
    out.set(obs, obs === actual ? name : `${name} (observed)`);
  };
  // New Year's Day: observed within the same year unless it falls on a Saturday (then the previous year's Dec 31).
  const jan1 = ymd(year, 1, 1);
  if (weekday(jan1) !== 6) {
    const obs = observed(jan1);
    out.set(obs, obs === jan1 ? "New Year's Day" : "New Year's Day (observed)");
  }
  const nextJan1 = ymd(year + 1, 1, 1);
  if (weekday(nextJan1) === 6) out.set(ymd(year, 12, 31), "New Year's Day (observed)");
  out.set(nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day');
  out.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  out.set(lastWeekday(year, 5, 1), 'Memorial Day');
  if (year >= 2021) fixed(6, 19, 'Juneteenth');
  fixed(7, 4, 'Independence Day');
  out.set(nthWeekday(year, 9, 1, 1), 'Labor Day');
  out.set(nthWeekday(year, 10, 1, 2), "Columbus Day / Indigenous Peoples' Day");
  fixed(11, 11, 'Veterans Day');
  out.set(nthWeekday(year, 11, 4, 4), 'Thanksgiving Day');
  fixed(12, 25, 'Christmas Day');
  const sorted = new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  usCache.set(year, sorted);
  return sorted;
}

/* ------------------------------------------------------------------ */
/* lookups                                                             */
/* ------------------------------------------------------------------ */

const JP_KEYS: ReadonlySet<string> = new Set(['JP', 'JP-Tokyo', 'Asia/Tokyo']);
const US_KEYS: ReadonlySet<string> = new Set(['US', 'US-HI', 'US-MD', 'Pacific/Honolulu', 'America/New_York']);

/** Which calendar a jurisdiction or IANA zone uses; null for 'household', 'contract' or unknown keys. */
export function calendarFor(key: string | null | undefined): HolidayCalendar | null {
  if (!key) return null;
  if (JP_KEYS.has(key)) return 'JP';
  if (US_KEYS.has(key)) return 'US';
  return null;
}

/** A rule's calendar: its jurisdiction when that names one, otherwise the zone its dates are meaningful in. */
export function calendarForRule(jurisdiction: string | null | undefined, timezone: string | null | undefined): HolidayCalendar | null {
  return calendarFor(jurisdiction) ?? calendarFor(timezone);
}

export function holidayMap(calendar: HolidayCalendar, year: number): ReadonlyMap<string, string> {
  return calendar === 'JP' ? japaneseHolidays(year) : usHolidays(year);
}

/**
 * Holiday dates for a jurisdiction (JP, JP-Tokyo, US, US-HI, …) or IANA zone over a year range (default 2026–2030).
 * An unknown key yields an empty set, which callers treat as "no calendar" (approximate).
 */
export function holidaysFor(key: string | null | undefined, fromYear = 2026, toYear = 2030): ReadonlySet<string> {
  const calendar = calendarFor(key);
  const out = new Set<string>();
  if (!calendar) return out;
  for (let y = Math.max(fromYear, MIN_HOLIDAY_YEAR); y <= Math.min(toYear, MAX_HOLIDAY_YEAR); y++) for (const d of holidayMap(calendar, y).keys()) out.add(d);
  return out;
}

/** Holidays for the years around a date (one year before to `after` years after) — enough for business-day maths. */
export function holidaysAround(calendar: HolidayCalendar | null, date: string, after = 2): ReadonlySet<string> {
  if (!calendar) return new Set();
  const year = Number(date.slice(0, 4));
  const out = new Set<string>();
  for (let y = year - 1; y <= year + after; y++) for (const d of holidayMap(calendar, y).keys()) out.add(d);
  return out;
}

export function holidayName(calendar: HolidayCalendar | null, date: string): string | null {
  if (!calendar) return null;
  return holidayMap(calendar, Number(date.slice(0, 4))).get(date) ?? null;
}

export function isHoliday(calendar: HolidayCalendar | null, date: string): boolean {
  return holidayName(calendar, date) !== null;
}
