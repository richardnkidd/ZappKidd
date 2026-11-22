/**
 * Whose turn is it on a decision? Pure, so Home, the Decide tab badge and the decision card all agree.
 * A decision settles only when every required approver chose the same option (that rule lives on the server);
 * this file only describes where the signed-in person stands.
 */
import type { DecisionData } from '@shared/types';

export type DecisionTurn =
  /** Nobody has chosen yet and I am one of the people who must. */
  | 'mine_first'
  /** The other adult has chosen; I have not. */
  | 'mine_after_partner'
  /** I have chosen; someone else still has to. */
  | 'waiting_partner'
  /** We both chose, and not the same option. */
  | 'disagree'
  /** Nothing for me to do: settled, put off, rejected, or I am not an approver. */
  | 'none';

interface DecisionLike {
  status: string;
  data?: unknown;
}

export interface TurnInfo<R extends DecisionLike = DecisionLike> {
  record: R;
  turn: DecisionTurn;
  /** The other adult's choice, when they have made one. */
  otherId: string | null;
  otherOptionId: string | null;
  /** My own choice, when I have made one. */
  myOptionId: string | null;
}

const OPEN = new Set(['open', 'proposed']);

export function turnInfo<R extends DecisionLike>(record: R, meId: string | null): TurnInfo<R> {
  const none: TurnInfo<R> = { record, turn: 'none', otherId: null, otherOptionId: null, myOptionId: null };
  if (!meId || !OPEN.has(record.status)) return none;
  const d = (record.data ?? {}) as Partial<DecisionData>;
  const approvers = d.required_approvers ?? [];
  if (!approvers.includes(meId)) return none;
  const approvals = (d.approvals ?? []).filter((a) => approvers.includes(a.person_id));
  const mine = approvals.find((a) => a.person_id === meId) ?? null;
  const other = approvals.find((a) => a.person_id !== meId) ?? null;
  const base = { record, otherId: other?.person_id ?? null, otherOptionId: other?.option_id ?? null, myOptionId: mine?.option_id ?? null };
  if (!mine) return { ...base, turn: other ? 'mine_after_partner' : 'mine_first' };
  const disagree = approvals.some((a) => a.person_id !== meId && a.option_id !== mine.option_id);
  if (disagree) return { ...base, turn: 'disagree' };
  return { ...base, turn: 'waiting_partner' };
}

/** True when the decision needs something from me now. */
export function isMyTurn(record: DecisionLike, meId: string | null): boolean {
  const t = turnInfo(record, meId).turn;
  return t === 'mine_first' || t === 'mine_after_partner' || t === 'disagree';
}

/** Decisions that need me, the ones my partner already answered first. */
export function myTurnDecisions<R extends DecisionLike>(decisions: readonly R[], meId: string | null): TurnInfo<R>[] {
  const rank: Record<DecisionTurn, number> = { disagree: 0, mine_after_partner: 1, mine_first: 2, waiting_partner: 3, none: 4 };
  return decisions
    .map((r) => turnInfo(r, meId))
    .filter((t) => t.turn === 'mine_first' || t.turn === 'mine_after_partner' || t.turn === 'disagree')
    .sort((a, b) => rank[a.turn] - rank[b.turn]);
}

export function countMyTurn(decisions: readonly DecisionLike[], meId: string | null): number {
  return myTurnDecisions(decisions, meId).length;
}
