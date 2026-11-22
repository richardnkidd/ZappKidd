import type { Question } from './records';

/** A question meant for a professional (immigration or tax adviser, veterinarian, ...) rather than for the household. */
export function isAdviserQuestion(q: Question): boolean {
  const a = q.data?.audience;
  return !!a && a !== 'household';
}

/** One of the questions from the plan's own questionnaire (not added later by a review, not for an adviser). */
export function isPlanQuestion(q: Question): boolean {
  return q.data?.origin !== 'review' && !isAdviserQuestion(q);
}

/** The "a few to think about" pickers only suggest plan questions; review and adviser questions have their own place. */
export const isSuggestable = isPlanQuestion;

/** Where a question stands, for the list: still to answer, answered, or set aside on purpose. */
export type QuestionState = 'open' | 'answered' | 'excluded';

/**
 * The disposition the household chose wins; the imported status is the fallback. Carried-forward and waiting
 * questions are still to be answered, so they count as open.
 */
export function questionState(q: Question): QuestionState {
  const d = q.data?.disposition;
  if (d === 'already_answered') return 'answered';
  if (d === 'not_applicable' || d === 'explicitly_excluded') return 'excluded';
  if (d && d !== 'question') return 'open';
  const s = String(q.status);
  if (s === 'answered') return 'answered';
  if (s === 'not_applicable' || s === 'excluded') return 'excluded';
  return 'open';
}

export function questionCounts(list: readonly Question[]): Record<QuestionState, number> {
  const c: Record<QuestionState, number> = { open: 0, answered: 0, excluded: 0 };
  for (const q of list) c[questionState(q)] += 1;
  return c;
}

/** The one line above the list: "83 open · 31 answered". Nothing is said about zero answered. */
export function countsLine(c: Pick<Record<QuestionState, number>, 'open' | 'answered'>): string {
  return c.answered > 0 ? `${c.open} open · ${c.answered} answered` : `${c.open} open`;
}

const KNOWN_AUDIENCES = new Set(['immigration_adviser', 'tax_adviser', 'veterinarian', 'vet', 'employer', 'accountant', 'lawyer']);
const SHOUT = new Set(['hr', 'it', 'id']);

/** Group heading for a question audience: "For the tax adviser", "For embassy HR". `label` is `audienceLabel(audience)`. */
export function forAudience(audience: string, label: string): string {
  if (KNOWN_AUDIENCES.has(audience)) return `For the ${label}`;
  const words = label.split(/\s+/).map((w) => (SHOUT.has(w) ? w.toUpperCase() : w));
  return `For ${words.join(' ')}`;
}

/** Copy text with the clipboard API, or a hidden text area when that is not available. Resolves false when both fail. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the text area */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    const active = document.activeElement as HTMLElement | null;
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    active?.focus?.();
    return ok;
  } catch {
    return false;
  }
}

/** The questions as a numbered list, ready to paste into an email. */
export function numberedList(lines: readonly string[]): string {
  return lines.map((t, i) => `${i + 1}. ${t.replace(/\s*\n\s*/g, ' ').trim()}`).join('\n');
}
