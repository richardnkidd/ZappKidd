import type { ReviewProgress, ReviewSessionData } from '@shared/types';
import { dataOf, type AnyRecord, type Indexes } from './records';

/** Finished couple reviews, newest first. */
export function completedReviews(idx: Indexes): AnyRecord[] {
  return idx.all
    .filter((r) => r.type === 'review_session' && r.status !== 'in_progress')
    .filter((r) => Boolean(dataOf<ReviewSessionData>(r).completed_at))
    .sort((a, b) => ((dataOf<ReviewSessionData>(b).completed_at ?? '') > (dataOf<ReviewSessionData>(a).completed_at ?? '') ? 1 : -1));
}

export function lastCompletedReview(idx: Indexes): AnyRecord | null {
  return completedReviews(idx)[0] ?? null;
}

/* ------------------------------------------------------------------ progress of an open review */

export const REVIEW_STEP_TITLES = ['What changed', 'This week and owners', 'Decisions', 'A few questions', 'Wrap-up'] as const;

/** The lists a review session keeps while it is open (what it has covered), apart from the record itself. */
export interface ReviewLists {
  accepted: ReviewProgress['accepted'];
  decisions: ReviewProgress['decisions'];
  questions: ReviewProgress['questions'];
  changeCount: number;
}

export const EMPTY_PROGRESS: ReviewProgress = { step: 0, accepted: [], decisions: [], questions: [], change_count: 0 };

const oneLine = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, max);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The progress kept on an open review record, read defensively (anything malformed is ignored), or null. */
export function progressOf(rec: { data?: unknown } | null | undefined): ReviewProgress | null {
  const raw = isObj(rec?.data) ? (rec!.data as Record<string, unknown>).progress : null;
  if (!isObj(raw)) return null;
  const list = <T,>(v: unknown, pick: (o: Record<string, unknown>) => T | null): T[] =>
    Array.isArray(v) ? v.map((o) => (isObj(o) ? pick(o) : null)).filter((x): x is T => x !== null) : [];
  const withId = (o: Record<string, unknown>) => (typeof o.id === 'string' && o.id !== '' ? o.id : null);
  const step = typeof raw.step === 'number' && Number.isInteger(raw.step) ? Math.min(Math.max(raw.step, 0), REVIEW_STEP_TITLES.length - 1) : 0;
  return {
    step,
    accepted: list(raw.accepted, (o) => (withId(o) ? { id: withId(o)!, title: oneLine(o.title, 500), owner: oneLine(o.owner, 100) } : null)),
    decisions: list(raw.decisions, (o) => (withId(o) ? { id: withId(o)!, title: oneLine(o.title, 500), outcome: oneLine(o.outcome, 500) } : null)),
    questions: list(raw.questions, (o) => (withId(o) ? { id: withId(o)!, title: oneLine(o.title, 500), outcome: oneLine(o.outcome, 500) } : null)),
    change_count: typeof raw.change_count === 'number' && Number.isFinite(raw.change_count) ? Math.max(0, Math.floor(raw.change_count)) : 0,
  };
}

/** True when the review has recorded anything beyond its first step. */
export const hasProgress = (p: ReviewProgress | null): boolean => !!p && (p.step > 0 || p.accepted.length + p.decisions.length + p.questions.length > 0);

/** What the server accepts: single-line text within its limits, bounded lists. */
export function toProgress(lists: ReviewLists, step: number): ReviewProgress {
  return {
    step: Math.min(Math.max(Math.trunc(step), 0), REVIEW_STEP_TITLES.length - 1),
    accepted: lists.accepted.slice(0, 300).map((a) => ({ id: a.id, title: oneLine(a.title, 500), owner: oneLine(a.owner, 100) })),
    decisions: lists.decisions.slice(0, 20).map((d) => ({ id: d.id, title: oneLine(d.title, 500), outcome: oneLine(d.outcome, 500) })),
    questions: lists.questions.slice(0, 50).map((q) => ({ id: q.id, title: oneLine(q.title, 500), outcome: oneLine(q.outcome, 500) })),
    change_count: Math.max(0, Math.floor(lists.changeCount)),
  };
}

/**
 * Two people can have the same review open. When a save finds a newer copy, keep everything either of them covered:
 * each list is the union by record id, with this person's entry winning when both have one, and the step stays theirs.
 */
export function mergeProgress(theirs: ReviewProgress | null, mine: ReviewProgress): ReviewProgress {
  if (!theirs) return mine;
  const union = <T extends { id: string }>(a: T[], b: T[]): T[] => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
  return {
    step: mine.step,
    accepted: union(theirs.accepted, mine.accepted),
    decisions: union(theirs.decisions, mine.decisions),
    questions: union(theirs.questions, mine.questions),
    change_count: Math.max(theirs.change_count, mine.change_count),
  };
}

/** One calm sentence about where an open review stands. */
export function describeProgress(p: ReviewProgress | null): string {
  if (!p || !hasProgress(p)) return 'A review is open and has not gone far yet. Continuing picks it up.';
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [n(p.accepted.length, 'owner confirmed', 'owners confirmed'), n(p.decisions.length, 'decision handled', 'decisions handled'), n(p.questions.length, 'question handled', 'questions handled')];
  return `You are on step ${p.step + 1} of ${REVIEW_STEP_TITLES.length} (${REVIEW_STEP_TITLES[p.step]}). So far: ${parts.join(', ')}.`;
}
