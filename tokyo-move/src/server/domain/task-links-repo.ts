import type { Db } from '../db/db';
import type { TaskLink } from '../../shared/types';
import { parseJson } from '../util/json';

export interface TaskLinkRow {
  id: string;
  household_id: string;
  adapter: TaskLink['adapter'];
  canonical_id: string | null;
  record_id: string | null;
  title: string;
  status: TaskLink['status'];
  due: string | null;
  due_basis: TaskLink['due_basis'];
  owner: string | null;
  notes: string | null;
  proposal_note: string | null;
  sync_state: TaskLink['sync_state'];
  last_synced_at: string | null;
  last_error: string | null;
  remote_revision: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  pending_changes: string | null;
}

/** API shape: the shared TaskLink plus the change still waiting for the task store to confirm (optional field). */
export type ApiTaskLink = TaskLink & { pending_changes: Record<string, unknown> | null };

export function taskLinkFromRow(row: Record<string, unknown> | TaskLinkRow): ApiTaskLink {
  const r = row as TaskLinkRow;
  return {
    id: r.id,
    household_id: r.household_id,
    adapter: r.adapter,
    canonical_id: r.canonical_id,
    record_id: r.record_id,
    title: r.title,
    status: r.status,
    due: r.due,
    due_basis: r.due_basis,
    owner: r.owner,
    notes: r.notes,
    proposal_note: r.proposal_note,
    sync_state: r.sync_state,
    last_synced_at: r.last_synced_at,
    last_error: r.last_error,
    remote_revision: r.remote_revision,
    version: r.version,
    created_at: r.created_at,
    updated_at: r.updated_at,
    pending_changes: parseJson<Record<string, unknown> | null>(r.pending_changes, null),
  };
}

export function getTaskLinkRow(db: Db, householdId: string, id: string): TaskLinkRow | undefined {
  return db.prepare('SELECT * FROM task_links WHERE household_id = ? AND id = ?').get(householdId, id) as TaskLinkRow | undefined;
}

export function listTaskLinkRows(db: Db, householdId: string): TaskLinkRow[] {
  return db
    .prepare('SELECT * FROM task_links WHERE household_id = ? ORDER BY COALESCE(due, \'9999-12-31\'), created_at, id')
    .all(householdId) as TaskLinkRow[];
}
