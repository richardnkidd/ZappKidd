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
