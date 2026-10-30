/** Undo one audited change: restore `before`, but only if the record still equals that entry's `after`. */
import { z } from 'zod';
import type { Deps, AuthContext } from '../context';
import type { AuditAction } from '../../shared/types';
import { HttpError, notFound, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { getRecordRow, rowToRecord, stateOf, writeRecordState, type ApiRecord, type RecordState } from './records-repo';
import { type AuditRow } from './audit';
import { text } from './schemas';
import { parseJson, stableStringify } from '../util/json';

const UNDOABLE: ReadonlySet<AuditAction> = new Set(['update', 'status_change', 'approve', 'reject', 'defer', 'anchor_change', 'undo']);
const undoBody = z.strictObject({ reason: text(1000).optional() });

function looksLikeState(v: unknown): v is RecordState {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.title === 'string' && typeof o.status === 'string' && typeof o.data === 'object' && o.data !== null && typeof o.visibility === 'string';
}

export function undoAudit(deps: Deps, ctx: AuthContext, auditId: string, rawBody: unknown): { record: ApiRecord; undo_entry_id: string } {
  const body = parseWith(undoBody, rawBody);
  return deps.db.transaction(() => {
    const entry = deps.db
      .prepare('SELECT * FROM audit_log WHERE household_id = ? AND id = ?')
      .get(ctx.householdId, auditId) as AuditRow | undefined;
    if (!entry || !entry.record_id) throw notFound('Audit entry');
    const row = getRecordRow(deps.db, ctx, entry.record_id);
    if (!row) throw notFound('Audit entry'); // private records' history is private too
    if (!UNDOABLE.has(entry.action)) {
      throw validationError('This kind of change cannot be undone', [{ path: '', message: `"${entry.action}" entries are not undoable` }]);
    }
    if (entry.undone_by) {
      throw new HttpError(409, 'conflict', 'This change was already undone', { reason: 'already_undone', undone_by: entry.undone_by });
    }
    const before = parseJson<unknown>(entry.before, null);
    const after = parseJson<unknown>(entry.after, null);
    if (!looksLikeState(before) || !looksLikeState(after)) {
      throw validationError('This entry cannot be undone', [{ path: '', message: 'No restorable state was recorded' }]);
    }
    if (stableStringify(stateOf(row)) !== stableStringify(after)) {
      throw new HttpError(409, 'conflict', 'The record changed after this entry, so it cannot be undone safely.', {
        reason: 'record_changed_since',
        server: rowToRecord(row, false),
        server_version: row.version,
      });
    }
    const { row: restored, auditId: undoId } = writeRecordState(deps.db, ctx, row, before, {
      action: 'undo',
      reason: body.reason ?? `Undo of ${entry.action}`,
      now: deps.now(),
    });
    deps.db.prepare('UPDATE audit_log SET undone_by = ? WHERE id = ?').run(undoId, entry.id);
    return { record: rowToRecord(restored, false), undo_entry_id: undoId };
  })();
}
