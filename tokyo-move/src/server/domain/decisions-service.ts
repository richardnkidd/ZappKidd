/** Per-person approval of decisions. A decision is household-approved only when every required approver agrees. */
import { z } from 'zod';
import type { Deps, AuthContext } from '../context';
import type { DecisionData, Person } from '../../shared/types';
import { forbidden, notFound, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { listPeople } from '../auth/users';
import { awaitingText, evaluateDecision, requiredApprovers } from './decisions';
import { getRecordRow, rowToRecord, stateOf, writeRecordState, type ApiRecord, type RecordRow, type RecordState } from './records-repo';
import { applyDecisionEvaluation, recordConflict } from './records-service';
import { civilDate, line, requiredText, text } from './schemas';
import { clone } from '../util/json';

const approveBody = z.strictObject({
  baseVersion: z.number().int().min(1),
  option_id: line(80),
  note: text(2000).nullable().optional(),
});
const rejectBody = z.strictObject({ baseVersion: z.number().int().min(1), rationale: requiredText(2000) });
const deferBody = z.strictObject({
  baseVersion: z.number().int().min(1),
  rationale: requiredText(2000),
  revisit_on: civilDate.nullable().optional(),
});

export interface DecisionResult {
  record: ApiRecord;
  decision: {
    state: string;
    decided_option_id: string | null;
    awaiting: string[];
    awaiting_text: string | null;
    disagreement: boolean;
  };
}

function load(deps: Deps, ctx: AuthContext, id: string, baseVersion: number, yourChanges: unknown): RecordRow {
  const row = getRecordRow(deps.db, ctx, id);
  if (!row) throw notFound();
  if (row.type !== 'decision') throw validationError('This record is not a decision', [{ path: '', message: 'Not a decision' }]);
  if (row.version !== baseVersion) throw recordConflict(row, yourChanges);
  if (row.status === 'superseded') throw validationError('This decision has been superseded', [{ path: '', message: 'Superseded' }]);
  return row;
}

function result(row: RecordRow, people: Person[]): DecisionResult {
  const record = rowToRecord(row, false);
  const data = record.data as unknown as DecisionData;
  const ev = evaluateDecision(data, people);
  return {
    record,
    decision: {
      state: row.status,
      decided_option_id: data.decided_option_id ?? null,
      awaiting: ev.awaiting,
      awaiting_text: awaitingText(ev.awaiting, people),
      disagreement: ev.disagreement,
    },
  };
}

function markEdited(state: RecordState, ...fields: string[]): void {
  state.locally_edited = [...new Set([...state.locally_edited, ...fields])];
}

function nameOf(people: Person[], id: string): string {
  return people.find((p) => p.id === id)?.display_name ?? id;
}

export function approveDecision(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): DecisionResult {
  const body = parseWith(approveBody, rawBody);
  const people = listPeople(deps.db, ctx.householdId);
  return deps.db.transaction(() => {
    const row = load(deps, ctx, id, body.baseVersion, body);
    const next: RecordState = clone(stateOf(row));
    const data = next.data as unknown as DecisionData;
    if (!requiredApprovers(data, people).includes(ctx.personId)) {
      throw forbidden('You are not one of the required approvers for this decision');
    }
    if (!(data.options ?? []).some((o) => o.id === body.option_id)) {
      throw validationError('Unknown option', [{ path: 'option_id', message: 'Choose one of the listed options' }]);
    }
    const at = deps.now().toISOString();
    data.approvals = [
      ...(data.approvals ?? []).filter((a) => a.person_id !== ctx.personId),
      { person_id: ctx.personId, at, option_id: body.option_id, note: body.note?.trim() || null },
    ];
    applyDecisionEvaluation(next, people, deps.now());
    markEdited(next, 'status', 'data.approvals', 'data.decided_option_id', 'data.decided_at');
    const { row: updated } = writeRecordState(deps.db, ctx, row, next, {
      action: 'approve',
      reason: body.note?.trim() || null,
      now: deps.now(),
    });
    return result(updated, people);
  })();
}

function closeDecision(
  deps: Deps,
  ctx: AuthContext,
  id: string,
  baseVersion: number,
  yourChanges: unknown,
  status: 'rejected' | 'deferred',
  rationale: string,
  extra: Record<string, unknown>,
): DecisionResult {
  const people = listPeople(deps.db, ctx.householdId);
  return deps.db.transaction(() => {
    const row = load(deps, ctx, id, baseVersion, yourChanges);
    const next: RecordState = clone(stateOf(row));
    const data = next.data as unknown as DecisionData;
    const at = deps.now().toISOString();
    const verb = status === 'rejected' ? 'rejected' : 'deferred';
    const entry = `${nameOf(people, ctx.personId)} ${verb} on ${at.slice(0, 10)}: ${rationale.trim()}`;
    data.history_note = [data.history_note, entry].filter(Boolean).join('\n').slice(-5000);
    data.rationale = rationale.trim();
    data.decided_option_id = null;
    data.decided_at = null;
    Object.assign(next.data, extra);
    next.status = status;
    markEdited(next, 'status', 'data.rationale', 'data.history_note', 'data.decided_option_id', 'data.decided_at', ...Object.keys(extra).map((k) => `data.${k}`));
    const { row: updated } = writeRecordState(deps.db, ctx, row, next, {
      action: status === 'rejected' ? 'reject' : 'defer',
      reason: rationale.trim(),
      now: deps.now(),
    });
    return result(updated, people);
  })();
}

export function rejectDecision(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): DecisionResult {
  const body = parseWith(rejectBody, rawBody);
  return closeDecision(deps, ctx, id, body.baseVersion, body, 'rejected', body.rationale, {});
}

export function deferDecision(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): DecisionResult {
  const body = parseWith(deferBody, rawBody);
  return closeDecision(deps, ctx, id, body.baseVersion, body, 'deferred', body.rationale, body.revisit_on !== undefined ? { revisit_on: body.revisit_on } : {});
}
