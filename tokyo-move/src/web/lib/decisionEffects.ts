import type { Decision, Directory, Indexes, Milestone } from './records';

/**
 * Some decisions settle whether a conditional step applies to a traveler. This is plan-specific wiring and is inert when
 * the keys are absent: after "<decision>" is decided, the matching step's "applies to <pet>" answer can be set from it.
 */
export const DECISION_EFFECTS: { decisionKey: string; recordKey: string }[] = [{ decisionKey: 'D-RV01', recordKey: 'W63' }];

export interface DecisionEffect {
  record: Milestone;
  personId: string;
  personName: string;
  answer: 'yes' | 'no';
  applied: boolean;
}

export function decisionEffect(d: Decision, idx: Indexes, dir: Directory): DecisionEffect | null {
  const rule = DECISION_EFFECTS.find((e) => e.decisionKey === d.key);
  if (!rule || d.status !== 'approved') return null;
  const chosen = d.data?.options?.find((o) => o.id === d.data?.decided_option_id);
  const answer = chosen ? (/^\s*yes\b/i.test(chosen.label) ? 'yes' : /^\s*no\b/i.test(chosen.label) ? 'no' : null) : null;
  const record = idx.milestoneByKey.get(rule.recordKey);
  const pet = dir.pet;
  if (!answer || !record || !pet) return null;
  const applied = (record.data?.applies_to ?? {})[pet.id] === answer;
  return { record, personId: pet.id, personName: pet.display_name, answer, applied };
}
