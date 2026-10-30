/** Pure decision logic: who still has to approve, and whether the decision is household-approved. */
import type { DecisionData, Person } from '../../shared/types';

export interface DecisionEvaluation {
  status: 'open' | 'proposed' | 'approved';
  decided_option_id: string | null;
  /** Person ids whose approval of the leading option is still missing. */
  awaiting: string[];
  /** True when approvers have chosen different options. */
  disagreement: boolean;
}

/** Required approvers: the stored list, or every adult of the household when none is stored. */
export function requiredApprovers(data: Pick<DecisionData, 'required_approvers'>, people: Person[]): string[] {
  const stored = Array.isArray(data.required_approvers) ? data.required_approvers : [];
  if (stored.length > 0) return stored;
  return people.filter((p) => p.kind === 'adult').map((p) => p.id);
}

/**
 * A decision is household-approved only when EVERY required approver approved the SAME option. Until then it is
 * `proposed` (at least one approval) or `open` (none), with the list of people it is still awaiting.
 */
export function evaluateDecision(data: Pick<DecisionData, 'required_approvers' | 'approvals'>, people: Person[]): DecisionEvaluation {
  const required = requiredApprovers(data, people);
  const approvals = Array.isArray(data.approvals) ? data.approvals : [];
  const byPerson = new Map(approvals.map((a) => [a.person_id, a.option_id] as const));
  const chosen = required.map((id) => byPerson.get(id) ?? null);
  const given = chosen.filter((o): o is string => o !== null);
  if (given.length === 0) return { status: 'open', decided_option_id: null, awaiting: required, disagreement: false };
  const first = given[0] as string;
  const allSame = given.every((o) => o === first);
  if (given.length === required.length && allSame) {
    return { status: 'approved', decided_option_id: first, awaiting: [], disagreement: false };
  }
  const awaiting = required.filter((id) => !byPerson.has(id));
  return { status: 'proposed', decided_option_id: null, awaiting, disagreement: !allSame };
}

export function awaitingText(awaiting: string[], people: Person[]): string | null {
  if (awaiting.length === 0) return null;
  const names = awaiting.map((id) => people.find((p) => p.id === id)?.display_name ?? id);
  return `awaiting ${names.join(' and ')}`;
}
