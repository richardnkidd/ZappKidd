import type { QuestionDisposition } from './types';

/**
 * A question's record status follows from its disposition. The importer and the server's PATCH both use this, so an
 * answer given in the app counts the same as one that came from the workbook.
 */
export function questionStatusFor(disposition: QuestionDisposition | string | null | undefined): 'answered' | 'not_applicable' | 'excluded' | 'open' {
  if (disposition === 'already_answered') return 'answered';
  if (disposition === 'not_applicable') return 'not_applicable';
  if (disposition === 'explicitly_excluded') return 'excluded';
  return 'open';
}
