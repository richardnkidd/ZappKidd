/**
 * The one date format the interface uses (approved change 17).
 *
 *   future   "Mon, Nov 30 (8 days)"      weekday, short month, day, then the distance in brackets
 *   tomorrow "Tomorrow"
 *   today    "Today"
 *   past     "11 days late"              only for open items; the calendar date is kept for screen readers
 *   no today "Mon, Nov 30"               when the caller has no "today" there is no distance to show
 *
 * A year is added only when the date is in another year or more than six months away (see `civil` in format.ts).
 * The long month form ("November 30") is never produced here, and the date never appears twice in one line.
 */
import { diffDays, formatCivil, isCivilDate } from '@shared/dates';
import { civil, needsYear } from './format';

export interface DateLine {
  /** What to print. */
  text: string;
  /** How the date relates to today. `plain` means no today was given. */
  when: 'future' | 'tomorrow' | 'today' | 'late' | 'plain';
  /** Whole days from today (negative when late); null when there was no today. */
  days: number | null;
  /** The calendar date in the same short form, e.g. "Fri, Nov 6": used as the accessible text of a "late" line. */
  dateText: string;
}

export interface DateLineOptions {
  /** The item is open. A past date reads "N days late". Default true. Pass false for facts ("Arrived Nov 6"). */
  open?: boolean;
}

export function dayWord(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** Format one calendar date against today. */
export function dateLine(date: string, today?: string | null, opts: DateLineOptions = {}): DateLine {
  if (!today || !isCivilDate(today) || !isCivilDate(date)) {
    const t = civil(date, 'weekday');
    return { text: t, when: 'plain', days: null, dateText: t };
  }
  // The year question is answered against the `today` that was passed, so the result does not depend on global state.
  const dateText = formatCivil(date, 'weekday') + (needsYear(date, today) ? `, ${date.slice(0, 4)}` : '');
  const n = diffDays(today, date);
  if (n === 0) return { text: 'Today', when: 'today', days: 0, dateText };
  if (n === 1) return { text: 'Tomorrow', when: 'tomorrow', days: 1, dateText };
  if (n > 1) return { text: `${dateText} (${dayWord(n)})`, when: 'future', days: n, dateText };
  if (opts.open === false) return { text: dateText, when: 'plain', days: n, dateText };
  return { text: `${dayWord(-n)} late`, when: 'late', days: n, dateText };
}

/**
 * A check-in date for plain-text places (a card's meta line): "Check-in Mon, Nov 30 (8 days)", or "Check-in 11 days
 * late". It uses the same wording as every other date, so a past check-in reads the same on Plan, Home and the record
 * page. The word "Check-in" tells it apart from a deadline.
 */
export function checkInLineText(date: string, today?: string | null): string {
  return `Check-in ${dateLineText(date, today)}`;
}

/** Text-only form for places with no markup (saved notes, printed packs). */
export function dateLineText(date: string | null | undefined, today?: string | null, opts: DateLineOptions = {}): string {
  if (!date) return 'Awaiting date';
  return dateLine(date, today, opts).text;
}
