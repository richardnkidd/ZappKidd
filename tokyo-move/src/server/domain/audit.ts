import type { Db } from '../db/db';
import type { AuditAction, AuditEntry } from '../../shared/types';
import { newAuditId } from '../util/ids';
import { parseJson } from '../util/json';

export interface AuditInput {
  householdId: string;
  at: string;
  actor: string;
  recordId: string | null;
  action: AuditAction;
  before: unknown;
  after: unknown;
  reason?: string | null;
}

export function appendAudit(db: Db, input: AuditInput): string {
  const id = newAuditId();
  db.prepare(
    `INSERT INTO audit_log (id, household_id, at, actor, record_id, action, before, after, reason, undone_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    input.householdId,
    input.at,
    input.actor,
    input.recordId,
    input.action,
    input.before === undefined || input.before === null ? null : JSON.stringify(input.before),
    input.after === undefined || input.after === null ? null : JSON.stringify(input.after),
    input.reason ?? null,
  );
  return id;
}

export interface AuditRow {
  id: string;
  household_id: string;
  at: string;
  actor: string;
  record_id: string | null;
  action: AuditAction;
  before: string | null;
  after: string | null;
  reason: string | null;
  undone_by: string | null;
}

export function auditRowToEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    household_id: row.household_id,
    at: row.at,
    actor: row.actor,
    record_id: row.record_id,
    action: row.action,
    before: parseJson<unknown>(row.before, null),
    after: parseJson<unknown>(row.after, null),
    reason: row.reason,
    undone_by: row.undone_by,
  };
}

/**
 * Audit entries the caller may see: those not tied to a record, plus those for records the caller can see
 * (private records' history is private too).
 */
export function listAudit(
  db: Db,
  ctx: { householdId: string; personId: string },
  opts: { recordId?: string; since?: string; limit: number },
): AuditEntry[] {
  const rows = db
    .prepare(
      `SELECT a.* FROM audit_log a
        WHERE a.household_id = @hh
          AND (a.record_id IS NULL OR EXISTS (
                 SELECT 1 FROM records r
                  WHERE r.household_id = a.household_id AND r.id = a.record_id
                    AND (r.visibility = 'household' OR r.created_by = @actor)))
          ${opts.recordId ? 'AND a.record_id = @recordId' : ''}
          ${opts.since ? 'AND a.at > @since' : ''}
        ORDER BY a.at DESC, a.rowid DESC
        LIMIT @limit`,
    )
    .all({
      hh: ctx.householdId,
      actor: ctx.personId,
      limit: opts.limit,
      ...(opts.recordId ? { recordId: opts.recordId } : {}),
      ...(opts.since ? { since: opts.since } : {}),
    }) as AuditRow[];
  return rows.map(auditRowToEntry);
}
