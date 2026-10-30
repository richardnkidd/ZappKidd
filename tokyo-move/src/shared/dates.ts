/**
 * Civil-date and timezone utilities. Pure; no Date-based storage of date-only values.
 * OWNER: import/engines agent (signatures fixed by lead).
 *
 * Civil dates are 'YYYY-MM-DD' strings. All arithmetic is integer day math (days-from-civil), so a civil date can
 * never shift when it is computed, stored or displayed from a different timezone. `Date` is only used to ask
 * "what is the wall-clock date in zone Z at instant I" (todayIn / formatInstant).
 */
import type { IanaZone } from './types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Days since 1970-01-01 for y-m-d (Howard Hinnant's days_from_civil). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

function civilFromDays(z0: number): { y: number; m: number; d: number } {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function parseCivil(date: string): { y: number; m: number; d: number } {
  const match = typeof date === 'string' ? CIVIL_RE.exec(date) : null;
  if (!match) throw new RangeError(`Not a civil date (YYYY-MM-DD): ${String(date)}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new RangeError(`Not a real calendar day: ${date}`);
  return { y, m, d };
}

/** True for a valid 'YYYY-MM-DD' string that names a real calendar day. */
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = CIVIL_RE.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Days since 1970-01-01 for a civil date (proleptic Gregorian, no timezone). Throws RangeError if invalid. */
export function toDayNumber(date: string): number {
  const { y, m, d } = parseCivil(date);
  return daysFromCivil(y, m, d);
}

export function fromDayNumber(day: number): string {
  if (!Number.isInteger(day)) throw new RangeError(`Day number must be an integer: ${day}`);
  const { y, m, d } = civilFromDays(day);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`Day offset must be an integer: ${days}`);
  return fromDayNumber(toDayNumber(date) + days);
}

/** EDATE semantics: add months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addCalendarMonths(date: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError(`Month offset must be an integer: ${months}`);
  const { y, m, d } = parseCivil(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/**
 * Add business days, skipping Saturday/Sunday and any supplied holidays. When no holiday calendar is supplied (or
 * the supplied set is empty) the result is flagged approximate so the UI can say "verify holidays".
 * `days === 0` returns the date unchanged (like Excel WORKDAY). Negative values count backwards.
 */
export function addBusinessDays(
  date: string,
  days: number,
  holidays?: ReadonlySet<string>,
): { date: string; approximate: boolean } {
  if (!Number.isInteger(days)) throw new RangeError(`Business-day offset must be an integer: ${days}`);
  const approximate = !holidays || holidays.size === 0;
  let day = toDayNumber(date);
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    day += step;
    const wd = (((day % 7) + 7 + 4) % 7); // 1970-01-01 was a Thursday (4)
    if (wd === 0 || wd === 6) continue;
    if (holidays && holidays.has(fromDayNumber(day))) continue;
    remaining -= 1;
  }
  return { date: fromDayNumber(day), approximate };
}

/** b − a in days. */
export function diffDays(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function compareCivil(a: string, b: string): number {
  const d = toDayNumber(a) - toDayNumber(b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, zone: IanaZone): ZonedParts {
  let fmt = formatterCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(zone, fmt);
  }
  const out: Record<string, number> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
  };
}

/** Civil "today" as experienced in the given zone at instant `now` (default: current time). */
export function todayIn(zone: IanaZone, now: Date = new Date()): string {
  const p = zonedParts(now, zone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Weekday 0=Sunday..6=Saturday of a civil date. */
export function weekday(date: string): number {
  return (((toDayNumber(date) % 7) + 7 + 4) % 7);
}

/**
 * Format a civil date WITHOUT any timezone conversion.
 * 'short' → 'Oct 29, 2026'; 'long' → 'Thursday, October 29, 2026'; 'compact' → 'Oct 29';
 * 'weekday' → 'Thu, Oct 29'.
 */
export function formatCivil(date: string, style: 'short' | 'long' | 'compact' | 'weekday' = 'short'): string {
  const { y, m, d } = parseCivil(date);
  const wd = weekday(date);
  switch (style) {
    case 'long':
      return `${WEEKDAYS_LONG[wd]}, ${MONTHS_LONG[m - 1]} ${d}, ${y}`;
    case 'compact':
      return `${MONTHS_SHORT[m - 1]} ${d}`;
    case 'weekday':
      return `${WEEKDAYS_SHORT[wd]}, ${MONTHS_SHORT[m - 1]} ${d}`;
    case 'short':
    default:
      return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
  }
}

const zoneAbbrevFormatters = new Map<string, Intl.DateTimeFormat>();

/** Short zone name at an instant: JST (no DST), HST (no DST), EST/EDT. */
function zoneAbbrev(zone: IanaZone, instant: Date): string {
  if (zone === 'Asia/Tokyo') return 'JST';
  if (zone === 'Pacific/Honolulu') return 'HST';
  let fmt = zoneAbbrevFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
    zoneAbbrevFormatters.set(zone, fmt);
  }
  const name = fmt.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value;
  return name ?? zone;
}

function clock12(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${suffix}`;
}

/**
 * Format an instant in a zone with the zone's short name, e.g. 'Oct 29, 1:25 PM HST'.
 * 'time' → '1:25 PM HST'; 'long' → 'Thursday, October 29, 2026, 1:25 PM HST'.
 */
export function formatInstant(iso: string, zone: IanaZone, style: 'short' | 'time' | 'long' = 'short'): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Not an instant: ${iso}`);
  const p = zonedParts(instant, zone);
  const civil = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${clock12(p.hour, p.minute)} ${zoneAbbrev(zone, instant)}`;
  if (style === 'time') return time;
  if (style === 'long') return `${formatCivil(civil, 'long')}, ${time}`;
  return `${formatCivil(civil, 'compact')}, ${time}`;
}

/** 'Tokyo (JST)', 'Honolulu (HST)', 'New York (EST/EDT)'. */
export function zoneLabel(zone: IanaZone): string {
  switch (zone) {
    case 'Asia/Tokyo':
      return 'Tokyo (JST)';
    case 'Pacific/Honolulu':
      return 'Honolulu (HST)';
    case 'America/New_York':
      return 'New York (EST/EDT)';
    default:
      return String(zone);
  }
}

/** Human relative phrase from today: 'today', 'tomorrow', 'yesterday', 'in 12 days', '3 days ago'. */
export function relativeDays(date: string, today: string): string {
  const n = diffDays(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
