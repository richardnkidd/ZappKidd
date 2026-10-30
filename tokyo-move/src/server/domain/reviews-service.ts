/** Guided couple review: start, update, complete. The summary is plain text; at most three decisions. */
import { z } from 'zod';
import type { Deps, AuthContext } from '../context';
import type { ReviewSessionData } from '../../shared/types';
import { HttpError, notFound, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { listPeople } from '../auth/users';
import { getRecordRow, insertRecord, rowToRecord, stateOf, writeRecordState, type ApiRecord, type RecordRow, type RecordState } from './records-repo';
import { civilDate, line, requiredLine, text } from './schemas';
import { clone, parseJson } from '../util/json';
import { shortToken } from '../util/ids';

const decisionEntry = z.strictObject({ record_id: line(200), outcome: requiredLine(500) });
const reviewFields = {
  reviewed_record_ids: z.array(line(200)).max(300).optional(),
  decisions: z.array(decisionEntry).max(3, 'A review records at most three decisions').optional(),
  summary: text(5000).optional(),
  participants: z.array(line(100)).min(1).max(10).optional(),
  next_review_on: civilDate.nullable().optional(),
};
const startBody = z.strictObject({ title: requiredLine(300).optional(), participants: z.array(line(100)).min(1).max(10).optional() });
const patchBody = z.strictObject({ baseVersion: z.number().int().min(1), changes: z.strictObject(reviewFields) });
const completeBody = z.strictObject({ baseVersion: z.number().int().min(1), ...reviewFields });

/** Instant of the most recent completed review, or null. */
export function lastCompletedReviewAt(deps: Deps, householdId: string): string | null {
  const rows = deps.db
    .prepare("SELECT data FROM records WHERE household_id = ? AND type = 'review_session' AND status = 'completed'")
    .all(householdId) as { data: string }[];
  let best: string | null = null;
  for (const r of rows) {
    const at = parseJson<Partial<ReviewSessionData>>(r.data, {}).completed_at ?? null;
    if (at && (best === null || at > best)) best = at;
  }
  return best;
}

export function startReview(
  deps: Deps,
  ctx: AuthContext,
  input: { title?: string | undefined; participants?: string[] | undefined },
): { record: ApiRecord; resumed: boolean } {
  const people = listPeople(deps.db, ctx.householdId);
  const adults = people.filter((p) => p.kind === 'adult').map((p) => p.id);
  const participants = input.participants ?? [ctx.personId];
  for (const p of participants) {
    if (!adults.includes(p)) throw validationError('Unknown participant', [{ path: 'participants', message: 'Participants must be adults in this household' }]);
  }
  return deps.db.transaction(() => {
    const open = deps.db
      .prepare("SELECT * FROM records WHERE household_id = ? AND type = 'review_session' AND status = 'in_progress' AND visibility = 'household' ORDER BY created_at DESC LIMIT 1")
      .get(ctx.householdId) as RecordRow | undefined;
    if (open) return { record: rowToRecord(open, false), resumed: true };
    const now = deps.now();
    const data: ReviewSessionData = {
      started_at: now.toISOString(),
      completed_at: null,
      participants: [...new Set([ctx.personId, ...participants])],
      since: lastCompletedReviewAt(deps, ctx.householdId),
      reviewed_record_ids: [],
      decisions: [],
      summary: '',
      next_review_on: null,
    };
    const day = now.toISOString().slice(0, 10);
    const row = insertRecord(
      deps.db,
      ctx,
      {
        type: 'review_session',
        key: `RV-${day.replaceAll('-', '')}-${shortToken(3)}`,
        title: input.title ?? `Couple review ${day}`,
        status: 'in_progress',
        owner: 'together',
        visibility: 'household',
        data: data as unknown as Record<string, unknown>,
      },
      now,
    );
    return { record: rowToRecord(row, false), resumed: false };
  })();
}

export function startReviewFromBody(deps: Deps, ctx: AuthContext, rawBody: unknown) {
  const body = parseWith(startBody, rawBody);
  return startReview(deps, ctx, body);
}

type Fields = z.infer<z.ZodObject<typeof reviewFields>>;

function loadReview(deps: Deps, ctx: AuthContext, id: string, baseVersion: number, yourChanges: unknown): RecordRow {
  const row = getRecordRow(deps.db, ctx, id);
  if (!row || row.type !== 'review_session') throw notFound('Review');
  if (row.version !== baseVersion) {
    throw new HttpError(409, 'conflict', 'This review changed since you opened it. Nothing was saved.', {
      server: rowToRecord(row, false),
      your_changes: yourChanges,
      server_version: row.version,
    });
  }
  if (row.status === 'completed') {
    throw new HttpError(409, 'conflict', 'This review is already complete', {
      server: rowToRecord(row, false),
      your_changes: yourChanges,
      server_version: row.version,
    });
  }
  return row;
}

function applyFields(deps: Deps, ctx: AuthContext, state: RecordState, f: Fields): void {
  const data = state.data as unknown as ReviewSessionData;
  const people = listPeople(deps.db, ctx.householdId);
  const previous = new Set([...data.reviewed_record_ids, ...data.decisions.map((d) => d.record_id)]);
  if (f.participants) {
    const adults = people.filter((p) => p.kind === 'adult').map((p) => p.id);
    for (const p of f.participants) {
      if (!adults.includes(p)) throw validationError('Unknown participant', [{ path: 'participants', message: 'Participants must be adults in this household' }]);
    }
    data.participants = [...new Set(f.participants)];
  }
  if (f.reviewed_record_ids) data.reviewed_record_ids = [...new Set(f.reviewed_record_ids)];
  if (f.decisions) data.decisions = f.decisions;
  if (f.summary !== undefined) data.summary = f.summary.replaceAll('\r\n', '\n').trim();
  if (f.next_review_on !== undefined) data.next_review_on = f.next_review_on;
  // Every decision must point at a reviewed record; add it automatically so the summary's claims stay traceable.
  for (const d of data.decisions) {
    if (!data.reviewed_record_ids.includes(d.record_id)) data.reviewed_record_ids.push(d.record_id);
  }
  // A review is shared by both adults, so it may only name shared records. Only ids being ADDED are checked, so a record
  // that was shared when it was added never blocks the other person from editing the review later.
  const added = [...new Set([...data.reviewed_record_ids, ...data.decisions.map((d) => d.record_id)])].filter((id) => !previous.has(id));
  const missing: string[] = [];
  const privateOnes: string[] = [];
  for (const id of added) {
    const rec = getRecordRow(deps.db, ctx, id);
    if (!rec) missing.push(id);
    else if (rec.visibility === 'private') privateOnes.push(id);
  }
  if (missing.length) {
    throw validationError('Some records in this review do not exist', [{ path: 'reviewed_record_ids', message: `${missing.length} unknown record id(s)` }]);
  }
  if (privateOnes.length) {
    throw validationError('A shared review cannot include private records', [{ path: 'reviewed_record_ids', message: `${privateOnes.length} private record(s): make them shared or leave them out` }]);
  }
}

export function patchReview(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): ApiRecord {
  const body = parseWith(patchBody, rawBody);
  return deps.db.transaction(() => {
    const row = loadReview(deps, ctx, id, body.baseVersion, body.changes);
    const next: RecordState = clone(stateOf(row));
    applyFields(deps, ctx, next, body.changes);
    const { row: updated } = writeRecordState(deps.db, ctx, row, next, { action: 'update', now: deps.now() });
    return rowToRecord(updated, false);
  })();
}

export function completeReview(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): ApiRecord {
  const body = parseWith(completeBody, rawBody);
  const { baseVersion, ...fields } = body;
  return deps.db.transaction(() => {
    const row = loadReview(deps, ctx, id, baseVersion, fields);
    const next: RecordState = clone(stateOf(row));
    applyFields(deps, ctx, next, fields);
    const data = next.data as unknown as ReviewSessionData;
    if (!data.participants.includes(ctx.personId)) data.participants.push(ctx.personId);
    data.completed_at = deps.now().toISOString();
    next.status = 'completed';
    const { row: updated } = writeRecordState(deps.db, ctx, row, next, { action: 'review_complete', now: deps.now() });
    return rowToRecord(updated, false);
  })();
}
