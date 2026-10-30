/** Anchor dates: preview the effect on deadlines (no writes), then apply with a version check and audit. */
import { z } from 'zod';
import type { Deps, AuthContext } from '../context';
import type { AnchorChangePreview } from '../../shared/engine-contracts';
import type { AnchorData, BaseRecord, TaskLink } from '../../shared/types';
import { previewAnchorChange, type DeadlineContext } from '../../shared/deadlines';
import { todayIn } from '../../shared/dates';
import { notFound, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { listPeople } from '../auth/users';
import { listRecordRows, getRecordRow, rowToRecord, stateOf, writeRecordState, type ApiRecord, type RecordState } from './records-repo';
import { recordConflict } from './records-service';
import { civilDate, text } from './schemas';
import { clone } from '../util/json';
import { listTaskLinkRows, taskLinkFromRow } from './task-links-repo';

const previewBody = z.strictObject({ date: civilDate.nullable() });
const putBody = z.strictObject({
  baseVersion: z.number().int().min(1),
  date: civilDate.nullable(),
  confidence: z.enum(['awaiting', 'tentative', 'planned', 'booked', 'actual']),
  evidence: text(2000).nullable().optional(),
});

function anchorRow(deps: Deps, ctx: AuthContext, code: string) {
  if (!/^[A-Za-z0-9_.-]{1,20}$/.test(code)) throw notFound('Anchor');
  const row = getRecordRow(deps.db, ctx, `anchor:${code}`);
  if (!row || row.type !== 'anchor') throw notFound('Anchor');
  return row;
}

function deadlineContext(deps: Deps, ctx: AuthContext): DeadlineContext {
  const records = listRecordRows(deps.db, ctx).map((r) => rowToRecord(r, false) as BaseRecord);
  const people = listPeople(deps.db, ctx.householdId);
  const links = listTaskLinkRows(deps.db, ctx.householdId, ctx.personId).map((r) => taskLinkFromRow(r) as TaskLink);
  return {
    records,
    people,
    task_links: links,
    today: todayIn(ctx.household.display_timezone, deps.now()),
  };
}

export function previewAnchor(deps: Deps, ctx: AuthContext, code: string, rawBody: unknown): AnchorChangePreview {
  const body = parseWith(previewBody, rawBody);
  anchorRow(deps, ctx, code);
  return previewAnchorChange(deadlineContext(deps, ctx), code, body.date);
}

export function applyAnchor(
  deps: Deps,
  ctx: AuthContext,
  code: string,
  rawBody: unknown,
  warn: (msg: string) => void,
): { record: ApiRecord; preview: AnchorChangePreview | null } {
  const body = parseWith(putBody, rawBody);
  const row0 = anchorRow(deps, ctx, code);
  if (row0.version !== body.baseVersion) throw recordConflict(row0, body);
  if (body.date === null && body.confidence !== 'awaiting') {
    throw validationError('An unknown date must have confidence "awaiting"', [{ path: 'confidence', message: 'Use awaiting when the date is not known' }]);
  }
  if (body.date !== null && body.confidence === 'awaiting') {
    throw validationError('A known date cannot have confidence "awaiting"', [{ path: 'confidence', message: 'Pick tentative, planned, booked or actual' }]);
  }
  let preview: AnchorChangePreview | null = null;
  try {
    preview = previewAnchorChange(deadlineContext(deps, ctx), code, body.date);
  } catch {
    warn('anchor preview could not be computed; applying change without it');
  }
  return deps.db.transaction(() => {
    const row = anchorRow(deps, ctx, code);
    if (row.version !== body.baseVersion) throw recordConflict(row, body);
    const cur = stateOf(row);
    const next: RecordState = clone(cur);
    const data = next.data as unknown as AnchorData;
    const edited = new Set(cur.locally_edited);
    if (data.date !== body.date) edited.add('data.date');
    if (data.confidence !== body.confidence) edited.add('data.confidence');
    data.date = body.date;
    data.confidence = body.confidence;
    if (body.evidence !== undefined) {
      if ((data.evidence ?? null) !== body.evidence) edited.add('data.evidence');
      data.evidence = body.evidence;
    }
    next.locally_edited = [...edited];
    const { row: updated } = writeRecordState(deps.db, ctx, row, next, {
      action: 'anchor_change',
      reason: body.evidence ?? null,
      now: deps.now(),
    });
    return { record: rowToRecord(updated, false), preview };
  })();
}
