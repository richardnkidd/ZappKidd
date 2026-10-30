import { addBusinessDays, formatCivil, isCivilDate, weekday } from '@shared/dates';
import type { DeadlineKind } from '@shared/types';

/**
 * A calm heads-up when a legal date lands on a weekend or a known public holiday. Dates are never moved; the note
 * only suggests aiming for the business day before. Business-day maths comes from the shared dates module.
 */
export function weekendNote(
  date: string | null | undefined,
  kind: DeadlineKind | null | undefined,
  holidays: readonly string[] | undefined,
): string | null {
  if (kind !== 'legal' || !date || !isCivilDate(date)) return null;
  const set = new Set(holidays ?? []);
  const wd = weekday(date);
  const weekend = wd === 0 || wd === 6;
  const holiday = set.has(date);
  if (!weekend && !holiday) return null;
  const prior = addBusinessDays(date, -1, set.size ? set : undefined).date;
  return `Falls on ${weekend ? 'a weekend' : 'a public holiday'} — aim for ${formatCivil(prior, 'weekday')}.`;
}
