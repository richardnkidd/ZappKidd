import { formatCivil, formatInstant, isCivilDate, relativeDays } from '@shared/dates';
import type { IanaZone } from '@shared/types';
import { AWAITING_DATE } from '@shared/labels';

/** Civil date → text; never shifts timezone. Unknown → "Awaiting date". */
export function civil(date: string | null | undefined, style: 'short' | 'long' | 'compact' | 'weekday' = 'short', empty = AWAITING_DATE): string {
  if (!date) return empty;
  if (!isCivilDate(date)) return date; // show source text as-is rather than crash
  try {
    return formatCivil(date, style);
  } catch {
    return date;
  }
}

/** Instant → text in the display zone. */
export function instant(iso: string | null | undefined, zone: IanaZone, style: 'short' | 'time' | 'long' = 'short', empty = 'Not known yet'): string {
  if (!iso) return empty;
  try {
    return formatInstant(iso, zone, style);
  } catch {
    return empty;
  }
}

export function relative(date: string | null | undefined, today: string): string | null {
  if (!date || !isCivilDate(date) || !isCivilDate(today)) return null;
  try {
    return relativeDays(date, today);
  } catch {
    return null;
  }
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? one + 's'}`;
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

/** Sort comparator for nullable civil dates: dated first (ascending), unknown last. */
export function compareDates(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a < b ? -1 : a > b ? 1 : 0; // ISO strings sort lexically
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Hour of day (0-23) in a zone, for a time-of-day greeting. */
export function hourIn(zone: string, now: Date = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now);
    return Number(h) % 24;
  } catch {
    return now.getHours();
  }
}

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Only http(s) links are ever rendered as links. Anything else is shown as plain text. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Readable name for a data key when we have no label: 'next_action' -> 'Next action'. */
export function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
