import type { Decision, Directory, Indexes, Milestone } from './records';

/**
 * Some decisions settle whether a conditional step applies to the pet: once decided "Yes" or "No", that answer can be
 * carried to the step. The pairs come from the plan's settings (`decision_effects`), with one built-in pair; the wiring
 * is inert when a key is not in the plan.
 */
export interface DecisionEffectRule {
  decisionKey: string;
  recordKey: string;
}
export const DEFAULT_DECISION_EFFECTS: DecisionEffectRule[] = [{ decisionKey: 'D-RV01', recordKey: 'W63' }];

export function effectRules(settings: unknown): DecisionEffectRule[] {
  const own = (settings as { decision_effects?: { decision_key?: unknown; record_key?: unknown }[] } | null | undefined)?.decision_effects;
  if (!Array.isArray(own)) return DEFAULT_DECISION_EFFECTS;
  return own
    .filter((r) => typeof r?.decision_key === 'string' && typeof r?.record_key === 'string')
    .map((r) => ({ decisionKey: r.decision_key as string, recordKey: r.record_key as string }));
}

export interface DecisionEffect {
  record: Milestone;
  personId: string;
  personName: string;
  answer: 'yes' | 'no';
  applied: boolean;
}

export function decisionEffect(d: Decision, idx: Indexes, dir: Directory, settings?: unknown): DecisionEffect | null {
  const rule = effectRules(settings).find((e) => e.decisionKey === d.key);
  if (!rule || d.status !== 'approved') return null;
  const chosen = d.data?.options?.find((o) => o.id === d.data?.decided_option_id);
  const answer = chosen ? (/^\s*yes\b/i.test(chosen.label) ? 'yes' : /^\s*no\b/i.test(chosen.label) ? 'no' : null) : null;
  const record = idx.milestoneByKey.get(rule.recordKey);
  const pet = dir.pet;
  if (!answer || !record || !pet) return null;
  const applied = (record.data?.applies_to ?? {})[pet.id] === answer;
  return { record, personId: pet.id, personName: pet.display_name, answer, applied };
}
