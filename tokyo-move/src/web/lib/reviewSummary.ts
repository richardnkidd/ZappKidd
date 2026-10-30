import { formatCivil, isCivilDate } from '@shared/dates';

/**
 * The plain-text summary saved with a couple review. It only says what was looked at and decided, names every
 * record it mentions (so each can be linked), and never marks work complete or offers advice.
 */
export interface ReviewFacts {
  date: string; // civil date of the review
  names: string[]; // who took part
  hasPreviousReview: boolean; // false = this is the first review
  changeCount: number;
  accepted: { id: string; title: string; owner: string }[];
  decisions: { id: string; title: string; outcome: string }[];
  questions: { id: string; title: string; outcome: string }[];
  nextReviewOn: string | null;
  closingNote: string;
}

const q = (t: string) => `“${t.replace(/\s+/g, ' ').trim()}”`;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function buildReviewSummary(f: ReviewFacts): { text: string; recordIds: string[] } {
  const lines: string[] = [];
  const day = isCivilDate(f.date) ? formatCivil(f.date, 'long') : f.date;
  lines.push(`Couple review on ${day}${f.names.length ? `, with ${list(f.names)}` : ''}.`);
  lines.push(!f.hasPreviousReview ? `This was the first review. We looked at ${f.changeCount} recent ${f.changeCount === 1 ? 'change' : 'changes'}.` : `We looked at ${f.changeCount} ${f.changeCount === 1 ? 'change' : 'changes'} since the last review.`);
  lines.push(f.accepted.length ? `Owners accepted: ${list(f.accepted.map((a) => `${q(a.title)} (${a.owner})`))}.` : 'No owners were accepted.');
  lines.push(f.decisions.length ? `Decisions: ${list(f.decisions.map((d) => `${q(d.title)} — ${d.outcome}`))}.` : 'No decisions were made.');
  lines.push(f.questions.length ? `Questions: ${list(f.questions.map((x) => `${q(x.title)} — ${x.outcome}`))}.` : 'No questions were worked on.');
  lines.push(f.nextReviewOn && isCivilDate(f.nextReviewOn) ? `Next review: ${formatCivil(f.nextReviewOn, 'long')}.` : 'No next review date was set.');
  if (f.closingNote.trim()) lines.push(f.closingNote.trim());
  const recordIds = [...new Set([...f.accepted.map((a) => a.id), ...f.decisions.map((d) => d.id), ...f.questions.map((x) => x.id)])];
  return { text: lines.join('\n'), recordIds };
}
