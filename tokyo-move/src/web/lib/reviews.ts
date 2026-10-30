import type { ReviewSessionData } from '@shared/types';
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
