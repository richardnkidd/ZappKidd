/**
 * Record persistence. EVERY query is scoped by household_id, and private records are visible only to their creator.
 * A record that is outside the caller's scope is indistinguishable from a missing one (404, never 403).
 */
import type { Db } from '../db/db';
import type { AuthContext } from '../context';
import type { AuditAction, BaseRecord, RecordType, SourceRef, Visibility } from '../../shared/types';
import { parseJson } from '../util/json';
import { appendAudit } from './audit';

export interface RecordRow {
  id: string;
  household_id: string;
  type: RecordType;
  key: string;
  title: string;
  status: string;
  owner: string | null;
  owner_proposed: number;
  visibility: Visibility;
  created_by: string | null;
  data: string;
  source: string | null;
  locally_edited: string;
  version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/** API shape: the shared BaseRecord plus the list of fields edited in-app (so the UI can mark them). */
export type ApiRecord = BaseRecord & { locally_edited: string[] };

/** The part of a record that audit before/after and undo operate on. */
export interface RecordState {
  title: string;
  status: string;
  owner: string | null;
  owner_proposed: boolean;
  visibility: Visibility;
  data: Record<string, unknown>;
  locally_edited: string[];
}

export const VISIBLE_SQL = "(visibility = 'household' OR created_by = @actor)";

export function rowToRecord(row: RecordRow, includeRaw: boolean): ApiRecord {
  const source = parseJson<SourceRef | null>(row.source, null);
  return {
    id: row.id,
    household_id: row.household_id,
    type: row.type,
    key: row.key,
    title: row.title,
    status: row.status,
    owner: row.owner,
    owner_proposed: row.owner_proposed === 1,
    visibility: row.visibility,
    created_by: row.created_by,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    source: source ? (includeRaw ? source : { ...source, raw: {} }) : null,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    locally_edited: parseJson<string[]>(row.locally_edited, []),
  };
}

export function stateOf(row: RecordRow): RecordState {
  return {
    title: row.title,
    status: row.status,
    owner: row.owner,
    owner_proposed: row.owner_proposed === 1,
    visibility: row.visibility,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    locally_edited: parseJson<string[]>(row.locally_edited, []),
  };
}

export function getRecordRow(db: Db, ctx: Pick<AuthContext, 'householdId' | 'personId'>, id: string): RecordRow | undefined {
  return db
    .prepare(`SELECT * FROM records WHERE household_id = @hh AND id = @id AND ${VISIBLE_SQL}`)
    .get({ hh: ctx.householdId, id, actor: ctx.personId }) as RecordRow | undefined;
}

export function listRecordRows(
  db: Db,
  ctx: Pick<AuthContext, 'householdId' | 'personId'>,
  type?: RecordType,
): RecordRow[] {
  return db
    .prepare(
      `SELECT * FROM records WHERE household_id = @hh AND ${VISIBLE_SQL} ${type ? 'AND type = @type' : ''}
       ORDER BY type, key`,
    )
    .all({ hh: ctx.householdId, actor: ctx.personId, ...(type ? { type } : {}) }) as RecordRow[];
}

export function recordExistsVisible(db: Db, ctx: Pick<AuthContext, 'householdId' | 'personId'>, id: string): boolean {
  return getRecordRow(db, ctx, id) !== undefined;
}

export interface WriteOptions {
  action: AuditAction;
  reason?: string | null;
  now: Date;
}

/**
 * Persist `next` over `row` inside the caller's transaction: bump version, stamp updated_at/by with the SESSION
 * person (never a client-supplied value), and append the audit entry with before/after. Returns the new row.
 */
export function writeRecordState(
  db: Db,
  ctx: Pick<AuthContext, 'householdId' | 'personId'>,
  row: RecordRow,
  next: RecordState,
  opts: WriteOptions,
): { row: RecordRow; auditId: string } {
  const before = stateOf(row);
  const at = opts.now.toISOString();
  const result = db
    .prepare(
      `UPDATE records SET title = @title, status = @status, owner = @owner, owner_proposed = @owner_proposed,
              visibility = @visibility, data = @data, locally_edited = @locally_edited,
              version = version + 1, updated_at = @at, updated_by = @actor
        WHERE household_id = @hh AND id = @id AND version = @version`,
    )
    .run({
      title: next.title,
      status: next.status,
      owner: next.owner,
      owner_proposed: next.owner_proposed ? 1 : 0,
      visibility: next.visibility,
      data: JSON.stringify(next.data),
      locally_edited: JSON.stringify(next.locally_edited),
      at,
      actor: ctx.personId,
      hh: ctx.householdId,
      id: row.id,
      version: row.version,
    });
  if (result.changes !== 1) throw new Error('record changed during write'); // cannot happen: single-threaded transaction
  const auditId = appendAudit(db, {
    householdId: ctx.householdId,
    at,
    actor: ctx.personId,
    recordId: row.id,
    action: opts.action,
    before,
    after: next,
    reason: opts.reason ?? null,
  });
  const updated = db
    .prepare('SELECT * FROM records WHERE household_id = ? AND id = ?')
    .get(ctx.householdId, row.id) as RecordRow;
  return { row: updated, auditId };
}

export interface NewRecordInput {
  type: RecordType;
  key: string;
  title: string;
  status: string;
  owner: string | null;
  owner_proposed?: boolean;
  visibility: Visibility;
  data: Record<string, unknown>;
}

export function insertRecord(
  db: Db,
  ctx: Pick<AuthContext, 'householdId' | 'personId'>,
  input: NewRecordInput,
  now: Date,
  reason: string | null = null,
): RecordRow {
  const at = now.toISOString();
  const id = `${input.type}:${input.key}`;
  db.prepare(
    `INSERT INTO records (id, household_id, type, key, title, status, owner, owner_proposed, visibility, created_by,
                          data, source, locally_edited, version, created_at, updated_at, updated_by)
     VALUES (@id, @hh, @type, @key, @title, @status, @owner, @owner_proposed, @visibility, @actor,
             @data, NULL, '[]', 1, @at, @at, @actor)`,
  ).run({
    id,
    hh: ctx.householdId,
    type: input.type,
    key: input.key,
    title: input.title,
    status: input.status,
    owner: input.owner,
    owner_proposed: input.owner_proposed ? 1 : 0,
    visibility: input.visibility,
    actor: ctx.personId,
    data: JSON.stringify(input.data),
    at,
  });
  const row = db.prepare('SELECT * FROM records WHERE household_id = ? AND id = ?').get(ctx.householdId, id) as RecordRow;
  appendAudit(db, {
    householdId: ctx.householdId,
    at,
    actor: ctx.personId,
    recordId: id,
    action: 'create',
    before: null,
    after: stateOf(row),
    reason,
  });
  return row;
}
