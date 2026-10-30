import type { DecisionData } from '@shared/types';
import { Chip } from '../../components/Badges';
import type { Decision, Directory } from '../../lib/records';

export interface ApprovalSummary {
  /** Plain sentence, e.g. "Approved by <name> · awaiting <name>". */
  text: string;
  state: 'none' | 'partial' | 'agreed' | 'disagree' | 'closed';
}

function requiredApprovers(d: Decision, dir: Directory): string[] {
  const req = d.data?.required_approvers ?? [];
  return req.length > 0 ? req : dir.adults.map((a) => a.id);
}

function optionLabel(data: Partial<DecisionData>, id: string | null | undefined): string | null {
  if (!id) return null;
  return data.options?.find((o) => o.id === id)?.label ?? null;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the approvals say, in words. Disagreement is called out rather than hidden:
 * two different choices never read as "approved".
 */
export function approvalSummary(d: Decision, dir: Directory): ApprovalSummary {
  const data = d.data ?? ({} as Partial<DecisionData>);
  const required = requiredApprovers(d, dir);
  // Latest approval per person wins.
  const latest = new Map<string, { option_id: string; at: string }>();
  for (const a of data.approvals ?? []) {
    const prev = latest.get(a.person_id);
    if (!prev || prev.at <= a.at) latest.set(a.person_id, { option_id: a.option_id, at: a.at });
  }
  const approvedIds = required.filter((id) => latest.has(id));
  const waitingIds = required.filter((id) => !latest.has(id));
  const names = (ids: string[]) => ids.map((id) => dir.nameOf(id));

  if (d.status === 'rejected') return { text: 'Rejected', state: 'closed' };
  if (d.status === 'deferred') return { text: 'Put off for now', state: 'closed' };
  if (d.status === 'superseded') return { text: 'Replaced by a newer decision', state: 'closed' };

  if (approvedIds.length === 0) {
    return { text: waitingIds.length ? `Awaiting ${listNames(names(waitingIds))}` : 'Not yet approved', state: 'none' };
  }
  const options = new Set(approvedIds.map((id) => latest.get(id)!.option_id));
  if (options.size > 1) {
    const parts = approvedIds.map((id) => `${dir.nameOf(id)} chose “${optionLabel(data, latest.get(id)!.option_id) ?? 'a different option'}”`);
    return { text: `${listNames(parts)} — you chose differently, so talk it through`, state: 'disagree' };
  }
  const chosen = optionLabel(data, [...options][0]);
  if (waitingIds.length === 0) {
    return { text: `Approved by ${listNames(names(approvedIds))}${chosen ? ` · “${chosen}”` : ''}`, state: 'agreed' };
  }
  return { text: `Approved by ${listNames(names(approvedIds))} · awaiting ${listNames(names(waitingIds))}`, state: 'partial' };
}

/** True when this person is expected to approve and has not yet. */
export function needsMyApproval(d: Decision, dir: Directory): boolean {
  if (d.status !== 'open' && d.status !== 'proposed') return false;
  const me = dir.me?.id;
  if (!me) return false;
  if (!requiredApprovers(d, dir).includes(me)) return false;
  return !(d.data?.approvals ?? []).some((a) => a.person_id === me);
}

export function YourTurnTag({ decision, dir }: { decision: Decision; dir: Directory }) {
  if (!needsMyApproval(decision, dir)) return null;
  return (
    <Chip tone="ai" small>
      Your approval is needed
    </Chip>
  );
}
