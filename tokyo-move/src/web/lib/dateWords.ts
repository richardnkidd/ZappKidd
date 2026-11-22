/**
 * What a computed date MEANS, in words. A date is never just "the deadline":
 *  by → "Due by …" (legal and contract dates) · not_before → "Not before … (window opens)" or a window "A – B" ·
 *  on → "On …" · continuous_since → "Must already be true since …" · recurring → "Repeats — <trigger>".
 * Weekend and holiday advice comes from the engine (`business_day_advice`) exactly as given; the web never invents it.
 */
import type { ComputedDeadline } from '@shared/engine-contracts';
import type { DeadlineKind, RuleBound } from '@shared/types';

export interface DateParts {
  prefix: string;
  suffix: string;
  date: string | null;
  endDate: string | null;
  /** Shown instead of "Awaiting date" when there is no single date to show. */
  emptyText: string | null;
}

export interface DatePartsInput {
  bound?: RuleBound | null;
  kind?: DeadlineKind | null;
  date: string | null;
  /** The other end of a window (the paired rule's date). */
  pairDate?: string | null;
  /** Plain label of the thing being dated, to choose the noun for a window ("Exam window"). */
  label?: string | null;
  /** When it applies, for a repeating rule ("Repeats — when the address changes"). */
  trigger?: string | null;
}

export function dateParts(input: DatePartsInput): DateParts {
  const bound = input.bound ?? 'by';
  const { date } = input;
  switch (bound) {
    case 'recurring': {
      const t = (input.trigger ?? '').trim().replace(/^when\s+/i, 'when ').replace(/\.$/, '');
      return { prefix: '', suffix: '', date: null, endDate: null, emptyText: `Repeats — ${t || 'each time it applies'}` };
    }
    case 'not_before': {
      if (date && input.pairDate && input.pairDate !== date) {
        const [open, close] = date <= input.pairDate ? [date, input.pairDate] : [input.pairDate, date];
        const noun = /\b(exam|inspection)\b/i.test(input.label ?? '') ? 'Exam window' : 'Window';
        return { prefix: `${noun}: `, suffix: '', date: open, endDate: close, emptyText: null };
      }
      return { prefix: 'Not before ', suffix: ' (window opens)', date, endDate: null, emptyText: null };
    }
    case 'on':
      return { prefix: 'On ', suffix: '', date, endDate: null, emptyText: null };
    case 'continuous_since':
      return { prefix: 'Must already be true since ', suffix: '', date, endDate: null, emptyText: null };
    default:
      return { prefix: input.kind === 'legal' || input.kind === 'contractual' ? 'Due by ' : '', suffix: '', date, endDate: null, emptyText: null };
  }
}

/** One plain sentence for text-only places (notes saved from the what-if, printed packs). */
export function dateSentence(p: DateParts, fmt: (d: string) => string): string {
  if (p.emptyText) return p.emptyText;
  if (!p.date) return 'Awaiting date';
  return `${p.prefix}${fmt(p.date)}${p.endDate ? ` – ${fmt(p.endDate)}` : ''}${p.suffix}`;
}

/** The deadline that is the other end of this one's window, for the same traveler. */
export function windowPairOf(d: ComputedDeadline, pairRuleKey: string | null | undefined, all: ComputedDeadline[]): ComputedDeadline | null {
  if (!pairRuleKey) return null;
  return all.find((x) => x.rule_id === pairRuleKey && x.traveler === d.traveler) ?? null;
}

/** Kind priority for choosing the one date a card shows: legal > contract > our target > task-list date > check-in. */
export const KIND_PRIORITY: Record<DeadlineKind | 'task', number> = {
  legal: 0,
  contractual: 1,
  user_committed: 2,
  internal_target: 2,
  estimate: 2,
  task: 3,
  review_date: 4,
};

const UNIT_WORDS: Record<string, [string, string]> = {
  calendar_days: ['day', 'days'],
  business_days: ['business day', 'business days'],
  calendar_months: ['month', 'months'],
};
const ROLE_WORDS: Record<string, string> = { arrival: 'arrival in Japan', departure: 'departure from Japan' };

/** "6 months after Avery’s arrival" - how a rule counts, in words. `anchorMeaning` is the anchor's own plain description. */
export function ruleCountSentence(rule: { offset?: number | null; unit?: string | null; direction?: string | null; anchor?: string | null; anchor_role?: string | null }, anchorMeaning?: string | null): string | null {
  const n = rule.offset;
  if (n === null || n === undefined) return null;
  const what = anchorMeaning?.trim() || (rule.anchor_role ? (ROLE_WORDS[rule.anchor_role] ?? rule.anchor_role.replace(/_/g, ' ')) : 'the starting event');
  if (n === 0) return `On the day of ${what}`;
  const [one, many] = UNIT_WORDS[rule.unit ?? 'calendar_days'] ?? ['day', 'days'];
  return `${n} ${n === 1 ? one : many} ${rule.direction === 'before' ? 'before' : 'after'} ${what}`;
}
