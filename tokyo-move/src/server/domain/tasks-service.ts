/**
 * Task proposals and their sync with the task adapter.
 *
 * Flow for a write: the Kadode row is saved first (sync_state pending_*), then the adapter is called, then the task
 * is READ BACK and compared; only a matching readback marks the row `synced`. Failures leave the row in `error`
 * with `last_error` and the requested change kept in `pending_changes` so `retry` can finish it. With the
 * read-only snapshot adapter a proposal simply stays `pending_capture` - that is correct, not an error.
 * Existing due dates are never recalculated.
 */
import { z } from 'zod';
import type { Deps, AuthContext } from '../context';
import type { TaskLink } from '../../shared/types';
import { defaultNewTaskDue } from '../../shared/deadlines';
import { todayIn } from '../../shared/dates';
import { HttpError, forbidden, notFound, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { listPeople } from '../auth/users';
import { TaskAdapterError, type CanonicalTask, type TaskAdapter, type TaskPatch } from '../tasks/adapter';
import { appendAudit } from './audit';
import { getRecordRow } from './records-repo';
import { getSetting } from './settings-repo';
import { checkOwner } from './records-service';
import { civilDate, line, requiredLine, requiredText, text } from './schemas';
import { getTaskLinkRow, listTaskLinkRows, taskLinkFromRow, type ApiTaskLink, type TaskLinkRow } from './task-links-repo';
import { newJournalId, newTaskLinkId } from '../util/ids';
import { parseJson } from '../util/json';

export interface AdapterStatus {
  name: TaskAdapter['name'];
  can_write: boolean;
  as_of: string | null;
  note: string;
}

type Outcome = 'synced' | 'pending_capture' | 'pending_update' | 'error' | 'conflict';

const proposeBody = z.strictObject({
  title: requiredLine(300),
  record_id: line(200).nullable().optional(),
  owner: line(100).nullable().optional(),
  due: civilDate.nullable().optional(),
  due_mode: z.enum(['default', 'explicit', 'blank']),
  notes: text(2000).nullable().optional(),
});
const patchBody = z.strictObject({
  baseVersion: z.number().int().min(1),
  changes: z
    .strictObject({
      title: requiredLine(300).optional(),
      due: civilDate.nullable().optional(),
      notes: text(2000).nullable().optional(),
      owner: line(100).nullable().optional(),
    })
    .refine((c) => Object.keys(c).length > 0, 'Nothing to change'),
});
const completeBody = z.strictObject({ baseVersion: z.number().int().min(1), evidence: requiredText(2000) });
const retryBody = z.strictObject({ baseVersion: z.number().int().min(1).optional() });
const syncBody = z.strictObject({});

/* ---------- helpers ---------- */

export function adapterFor(deps: Deps, ctx: Pick<AuthContext, 'householdId'>): TaskAdapter {
  return deps.taskAdapter.scope?.(ctx.householdId) ?? deps.taskAdapter;
}

export function adapterStatus(deps: Deps, ctx: Pick<AuthContext, 'householdId'>): AdapterStatus {
  const adapter = deps.taskAdapter;
  const stored = getSetting<Partial<AdapterStatus>>(deps.db, ctx.householdId, 'task_adapter', {});
  return {
    name: adapter.name,
    can_write: adapter.canWrite,
    as_of: typeof stored.as_of === 'string' ? stored.as_of : null,
    note: adapter.note,
  };
}

function safeMessage(e: unknown): string {
  if (e instanceof TaskAdapterError) return e.message;
  return 'The task system call failed';
}

function journal(
  deps: Deps,
  ctx: AuthContext,
  linkId: string,
  operation: 'create' | 'update' | 'complete' | 'readback' | 'list',
  request: unknown,
  response: unknown,
  outcome: 'ok' | 'error' | 'mismatch',
): void {
  deps.db
    .prepare(
      `INSERT INTO task_sync_journal (id, household_id, task_link_id, at, actor, operation, request, response, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newJournalId(),
      ctx.householdId,
      linkId,
      deps.now().toISOString(),
      ctx.personId,
      operation,
      request === undefined ? null : JSON.stringify(request),
      response === undefined ? null : JSON.stringify(response),
      outcome,
    );
}

const COLUMNS = new Set([
  'canonical_id', 'record_id', 'title', 'status', 'due', 'due_basis', 'owner', 'notes', 'proposal_note', 'sync_state',
  'last_synced_at', 'last_error', 'remote_revision', 'pending_changes',
]);

/** Update allow-listed columns, bump version, return the fresh row. */
function setFields(deps: Deps, ctx: AuthContext, id: string, fields: Record<string, unknown>): TaskLinkRow {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, hh: ctx.householdId, at: deps.now().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (!COLUMNS.has(k)) throw new Error(`unexpected task column ${k}`);
    sets.push(`${k} = @${k}`);
    params[k] = k === 'pending_changes' ? (v === null ? null : JSON.stringify(v)) : v;
  }
  deps.db
    .prepare(`UPDATE task_links SET ${sets.join(', ')}, version = version + 1, updated_at = @at WHERE household_id = @hh AND id = @id`)
    .run(params);
  return getTaskLinkRow(deps.db, ctx.householdId, id) as TaskLinkRow;
}

function remoteFields(remote: CanonicalTask, at: string): Record<string, unknown> {
  return {
    title: remote.title,
    status: remote.status,
    due: remote.due,
    notes: remote.notes,
    remote_revision: String(remote.revision),
    sync_state: 'synced',
    last_synced_at: at,
    last_error: null,
    pending_changes: null,
  };
}

function audit(
  deps: Deps,
  ctx: AuthContext,
  action: 'task_propose' | 'task_sync' | 'task_complete',
  before: ApiTaskLink | null,
  after: ApiTaskLink,
  reason: string | null,
): void {
  appendAudit(deps.db, {
    householdId: ctx.householdId,
    at: deps.now().toISOString(),
    actor: ctx.personId,
    recordId: after.record_id,
    action,
    before,
    after,
    reason,
  });
}

function taskConflict(row: TaskLinkRow, yourChanges: unknown, remote: CanonicalTask | null, message: string): HttpError {
  return new HttpError(409, 'conflict', message, {
    task_link: taskLinkFromRow(row),
    your_changes: yourChanges,
    server_version: row.version,
    remote_task: remote,
  });
}

/* ---------- push to the task store, then read back ---------- */

interface PushResult {
  row: TaskLinkRow;
  outcome: Outcome;
  remote: CanonicalTask | null;
}

async function pushToStore(deps: Deps, ctx: AuthContext, adapter: TaskAdapter, linkId: string): Promise<PushResult> {
  let row = getTaskLinkRow(deps.db, ctx.householdId, linkId) as TaskLinkRow;
  const pending = parseJson<Record<string, unknown> | null>(row.pending_changes, null);
  const fail = (e: unknown, remote: CanonicalTask | null = null): PushResult => {
    if (e instanceof TaskAdapterError && e.code === 'revision_conflict') {
      row = setFields(deps, ctx, linkId, { sync_state: 'conflict', last_error: e.message });
      return { row, outcome: 'conflict', remote };
    }
    row = setFields(deps, ctx, linkId, { sync_state: 'error', last_error: safeMessage(e) });
    return { row, outcome: 'error', remote };
  };

  if (!adapter.canWrite) return { row, outcome: 'pending_capture', remote: null };

  let expected: { title: string; due: string | null; status: string };
  let operation: 'create' | 'update' | 'complete' | 'readback';

  if (!row.canonical_id) {
    operation = 'create';
    const request = { title: row.title, due: row.due, notes: row.notes };
    try {
      const created = await adapter.create(request);
      journal(deps, ctx, linkId, 'create', request, { id: created.id, revision: created.revision }, 'ok');
      row = setFields(deps, ctx, linkId, { canonical_id: created.id, remote_revision: String(created.revision) });
    } catch (e) {
      journal(deps, ctx, linkId, 'create', request, { error: safeMessage(e) }, 'error');
      return fail(e);
    }
    expected = { title: row.title, due: row.due, status: 'open' };
  } else if (pending && typeof pending.complete === 'string') {
    operation = 'complete';
    row = setFields(deps, ctx, linkId, { sync_state: 'pending_update' });
    try {
      const done = await adapter.complete(row.canonical_id as string, pending.complete);
      journal(deps, ctx, linkId, 'complete', { id: row.canonical_id, evidence: pending.complete }, { revision: done.revision }, 'ok');
    } catch (e) {
      journal(deps, ctx, linkId, 'complete', { id: row.canonical_id }, { error: safeMessage(e) }, 'error');
      return fail(e);
    }
    expected = { title: row.title, due: row.due, status: 'done' };
  } else if (pending && Object.keys(pending).length > 0) {
    operation = 'update';
    const patch: TaskPatch = {};
    if (typeof pending.title === 'string') patch.title = pending.title;
    if ('due' in pending) patch.due = (pending.due as string | null) ?? null;
    if ('notes' in pending) patch.notes = (pending.notes as string | null) ?? null;
    const rev = Number(row.remote_revision);
    row = setFields(deps, ctx, linkId, { sync_state: 'pending_update' });
    try {
      const updated = await adapter.update(row.canonical_id as string, patch, Number.isInteger(rev) ? rev : undefined);
      journal(deps, ctx, linkId, 'update', { id: row.canonical_id, patch, expectedRevision: rev }, { revision: updated.revision }, 'ok');
    } catch (e) {
      journal(deps, ctx, linkId, 'update', { id: row.canonical_id, patch }, { error: safeMessage(e) }, e instanceof TaskAdapterError && e.code === 'revision_conflict' ? 'mismatch' : 'error');
      let remote: CanonicalTask | null = null;
      if (e instanceof TaskAdapterError && e.code === 'revision_conflict') {
        try {
          remote = await adapter.get(row.canonical_id as string);
        } catch {
          remote = null;
        }
      }
      return fail(e, remote);
    }
    expected = {
      title: patch.title ?? row.title,
      due: 'due' in patch ? (patch.due ?? null) : row.due,
      status: row.status,
    };
  } else {
    operation = 'readback';
    expected = { title: row.title, due: row.due, status: row.status };
  }

  // Readback: only a matching readback marks the row synced.
  let remote: CanonicalTask | null;
  try {
    remote = await adapter.get(row.canonical_id as string);
  } catch (e) {
    journal(deps, ctx, linkId, 'readback', { id: row.canonical_id }, { error: safeMessage(e) }, 'error');
    return fail(new TaskAdapterError('failed', 'The change was sent, but reading it back failed. Retry to verify.'));
  }
  if (!remote) {
    journal(deps, ctx, linkId, 'readback', { id: row.canonical_id }, { found: false }, 'error');
    return fail(new TaskAdapterError('not_found', 'The task was not found in the task system on readback'));
  }
  const matches = remote.title === expected.title && remote.due === expected.due && (operation !== 'complete' || remote.status === 'done');
  if (!matches) {
    journal(deps, ctx, linkId, 'readback', { expected }, { title: remote.title, due: remote.due, status: remote.status }, 'mismatch');
    return fail(new TaskAdapterError('failed', 'Readback did not match what was sent'), remote);
  }
  journal(deps, ctx, linkId, 'readback', { expected }, { revision: remote.revision }, 'ok');
  const extra: Record<string, unknown> = {};
  if (pending && typeof pending.due_basis === 'string') extra.due_basis = pending.due_basis;
  row = setFields(deps, ctx, linkId, { ...remoteFields(remote, deps.now().toISOString()), ...extra });
  return { row, outcome: 'synced', remote };
}

/* ---------- API operations ---------- */

export function listTasks(deps: Deps, ctx: AuthContext): { task_links: ApiTaskLink[]; adapter: AdapterStatus } {
  return {
    task_links: listTaskLinkRows(deps.db, ctx.householdId).map(taskLinkFromRow),
    adapter: adapterStatus(deps, ctx),
  };
}

export async function proposeTask(deps: Deps, ctx: AuthContext, rawBody: unknown): Promise<{ task: ApiTaskLink; outcome: Outcome; adapter: AdapterStatus }> {
  const body = parseWith(proposeBody, rawBody);
  if (body.due_mode === 'explicit' && !body.due) {
    throw validationError('An explicit due date is required', [{ path: 'due', message: 'Provide a date or choose another due_mode' }]);
  }
  if (body.due_mode !== 'explicit' && body.due) {
    throw validationError('A due date is only accepted with due_mode "explicit"', [{ path: 'due', message: 'Remove it or use due_mode explicit' }]);
  }
  checkOwner(listPeople(deps.db, ctx.householdId), body.owner);
  if (body.record_id && !getRecordRow(deps.db, ctx, body.record_id)) {
    throw validationError('Linked record not found', [{ path: 'record_id', message: 'No such record' }]);
  }
  const adapter = adapterFor(deps, ctx);
  const due =
    body.due_mode === 'explicit'
      ? (body.due as string)
      : body.due_mode === 'default'
        ? defaultNewTaskDue(todayIn(ctx.household.home_timezone, deps.now()))
        : null;
  const dueBasis = body.due_mode === 'explicit' ? 'explicit' : body.due_mode === 'default' ? 'default_14_days' : 'left_blank';
  const id = newTaskLinkId();
  const at = deps.now().toISOString();

  const created = deps.db.transaction(() => {
    deps.db
      .prepare(
        `INSERT INTO task_links (id, household_id, adapter, canonical_id, record_id, title, status, due, due_basis, owner,
                                 notes, proposal_note, sync_state, last_synced_at, last_error, remote_revision, version,
                                 created_at, updated_at, pending_changes)
         VALUES (?, ?, ?, NULL, ?, ?, 'open', ?, ?, ?, ?, NULL, 'pending_capture', NULL, NULL, NULL, 1, ?, ?, NULL)`,
      )
      .run(id, ctx.householdId, adapter.name, body.record_id ?? null, body.title, due, dueBasis, body.owner ?? null, body.notes ?? null, at, at);
    const link = taskLinkFromRow(getTaskLinkRow(deps.db, ctx.householdId, id) as TaskLinkRow);
    audit(deps, ctx, 'task_propose', null, link, 'proposed in Kadode');
    return link;
  })();

  if (!adapter.canWrite) {
    journal(deps, ctx, id, 'create', { title: created.title, due: created.due }, { skipped: 'read_only_adapter' }, 'ok');
    return { task: created, outcome: 'pending_capture', adapter: adapterStatus(deps, ctx) };
  }
  const result = await pushToStore(deps, ctx, adapter, id);
  const after = taskLinkFromRow(result.row);
  audit(deps, ctx, 'task_sync', created, after, 'create');
  return { task: after, outcome: result.outcome, adapter: adapterStatus(deps, ctx) };
}

function loadLink(deps: Deps, ctx: AuthContext, id: string): TaskLinkRow {
  const row = getTaskLinkRow(deps.db, ctx.householdId, id);
  if (!row) throw notFound('Task');
  return row;
}

/** Links owned by another adapter, or a read-only snapshot copy of a real task, cannot be written from here. */
function assertWritableLink(adapter: TaskAdapter, row: TaskLinkRow): void {
  if (row.adapter !== adapter.name || row.sync_state === 'snapshot') {
    throw forbidden('Not authorized: this task is a read-only snapshot. Change it in the task system itself.');
  }
}

export async function patchTask(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): Promise<{ task: ApiTaskLink; outcome: Outcome }> {
  const body = parseWith(patchBody, rawBody);
  const adapter = adapterFor(deps, ctx);
  const people = listPeople(deps.db, ctx.householdId);
  if (body.changes.owner !== undefined) checkOwner(people, body.changes.owner, 'changes.owner');
  let row = loadLink(deps, ctx, id);
  assertWritableLink(adapter, row);
  if (row.version !== body.baseVersion) throw taskConflict(row, body.changes, null, 'This task changed since you opened it. Nothing was saved.');
  if (row.sync_state === 'conflict') {
    throw taskConflict(row, body.changes, null, 'The task changed in the task system. Refresh it first, then re-apply your change.');
  }
  const before = taskLinkFromRow(row);
  const { owner, ...remoteChanges } = body.changes;
  const hasRemote = Object.keys(remoteChanges).length > 0;

  // Not yet captured (or no writer): the proposal itself is edited locally.
  if (!row.canonical_id) {
    const fields: Record<string, unknown> = {};
    if (remoteChanges.title !== undefined) fields.title = remoteChanges.title;
    if (remoteChanges.notes !== undefined) fields.notes = remoteChanges.notes;
    if (remoteChanges.due !== undefined) {
      fields.due = remoteChanges.due;
      fields.due_basis = remoteChanges.due === null ? 'left_blank' : 'explicit';
    }
    if (owner !== undefined) fields.owner = owner;
    row = setFields(deps, ctx, id, fields);
    const after = taskLinkFromRow(row);
    audit(deps, ctx, 'task_propose', before, after, 'edited proposal');
    return { task: after, outcome: row.sync_state === 'error' ? 'error' : 'pending_capture' };
  }

  if (owner !== undefined) row = setFields(deps, ctx, id, { owner });
  if (!hasRemote) {
    const after = taskLinkFromRow(row);
    audit(deps, ctx, 'task_sync', before, after, 'owner changed');
    return { task: after, outcome: 'synced' };
  }
  const pendingMerged: Record<string, unknown> = { ...(parseJson<Record<string, unknown>>(row.pending_changes, {})), ...remoteChanges };
  delete pendingMerged.complete;
  if (remoteChanges.due !== undefined) pendingMerged.due_basis = remoteChanges.due === null ? 'left_blank' : 'explicit';
  row = setFields(deps, ctx, id, { pending_changes: pendingMerged, sync_state: 'pending_update', last_error: null });
  const result = await pushToStore(deps, ctx, adapter, id);
  const after = taskLinkFromRow(result.row);
  audit(deps, ctx, 'task_sync', before, after, 'update');
  if (result.outcome === 'conflict') {
    throw taskConflict(result.row, body.changes, result.remote, 'The task changed in the task system since you last synced. Nothing was overwritten.');
  }
  return { task: after, outcome: result.outcome };
}

export async function completeTask(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): Promise<{ task: ApiTaskLink; outcome: Outcome }> {
  const body = parseWith(completeBody, rawBody);
  const adapter = adapterFor(deps, ctx);
  let row = loadLink(deps, ctx, id);
  assertWritableLink(adapter, row);
  if (!adapter.canWrite) throw forbidden('Not authorized: this build cannot complete tasks in the task system');
  if (row.version !== body.baseVersion) throw taskConflict(row, { evidence: body.evidence }, null, 'This task changed since you opened it. Nothing was saved.');
  if (!row.canonical_id) {
    throw validationError('This action has not been captured in the task system yet', [{ path: '', message: 'Capture it first, then complete it' }]);
  }
  const before = taskLinkFromRow(row);
  const evidence = body.evidence.trim();
  row = setFields(deps, ctx, id, { pending_changes: { complete: evidence }, sync_state: 'pending_update', last_error: null });
  const result = await pushToStore(deps, ctx, adapter, id);
  const after = taskLinkFromRow(result.row);
  audit(deps, ctx, 'task_complete', before, after, evidence);
  return { task: after, outcome: result.outcome };
}

export async function retryTask(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): Promise<{ task: ApiTaskLink; outcome: Outcome }> {
  const body = parseWith(retryBody, rawBody);
  const adapter = adapterFor(deps, ctx);
  const row = loadLink(deps, ctx, id);
  assertWritableLink(adapter, row);
  if (body.baseVersion !== undefined && row.version !== body.baseVersion) throw taskConflict(row, {}, null, 'This task changed since you opened it.');
  if (!adapter.canWrite) throw forbidden('Not authorized: this build cannot write to the task system. The action stays pending capture.');
  if (row.sync_state === 'synced') return { task: taskLinkFromRow(row), outcome: 'synced' };
  if (row.sync_state === 'conflict') {
    throw taskConflict(row, {}, null, 'The task changed in the task system. Refresh it first, then re-apply your change.');
  }
  const before = taskLinkFromRow(row);
  const result = await pushToStore(deps, ctx, adapter, id);
  const pending = parseJson<Record<string, unknown> | null>(row.pending_changes, null);
  const after = taskLinkFromRow(result.row);
  audit(deps, ctx, pending && typeof pending.complete === 'string' ? 'task_complete' : 'task_sync', before, after, 'retry');
  if (result.outcome === 'conflict') throw taskConflict(result.row, {}, result.remote, 'The task changed in the task system since you last synced.');
  return { task: after, outcome: result.outcome };
}

/** Refresh linked tasks from the store (store wins). Rows with a pending local change are left for retry. */
export async function syncTasks(deps: Deps, ctx: AuthContext, rawBody: unknown): Promise<{
  task_links: ApiTaskLink[];
  adapter: AdapterStatus;
  refreshed: number;
  failed: number;
  skipped_reason: string | null;
}> {
  parseWith(syncBody, rawBody);
  const adapter = adapterFor(deps, ctx);
  if (!adapter.canWrite) {
    return { task_links: listTaskLinkRows(deps.db, ctx.householdId).map(taskLinkFromRow), adapter: adapterStatus(deps, ctx), refreshed: 0, failed: 0, skipped_reason: 'read_only_adapter' };
  }
  let refreshed = 0;
  let failed = 0;
  for (const row of listTaskLinkRows(deps.db, ctx.householdId)) {
    if (row.adapter !== adapter.name || !row.canonical_id) continue;
    if (row.sync_state !== 'synced' && row.sync_state !== 'conflict') continue;
    const before = taskLinkFromRow(row);
    try {
      const remote = await adapter.get(row.canonical_id);
      if (!remote) {
        journal(deps, ctx, row.id, 'readback', { id: row.canonical_id }, { found: false }, 'error');
        setFields(deps, ctx, row.id, { sync_state: 'error', last_error: 'The task was not found in the task system' });
        failed += 1;
        continue;
      }
      journal(deps, ctx, row.id, 'readback', { id: row.canonical_id }, { revision: remote.revision }, 'ok');
      const changed = remote.title !== row.title || remote.due !== row.due || remote.status !== row.status || remote.notes !== row.notes || String(remote.revision) !== row.remote_revision || row.sync_state !== 'synced';
      const updated = setFields(deps, ctx, row.id, remoteFields(remote, deps.now().toISOString()));
      if (changed) audit(deps, ctx, 'task_sync', before, taskLinkFromRow(updated), 'refresh');
      refreshed += 1;
    } catch (e) {
      journal(deps, ctx, row.id, 'readback', { id: row.canonical_id }, { error: safeMessage(e) }, 'error');
      setFields(deps, ctx, row.id, { sync_state: 'error', last_error: safeMessage(e) });
      failed += 1;
    }
  }
  return { task_links: listTaskLinkRows(deps.db, ctx.householdId).map(taskLinkFromRow), adapter: adapterStatus(deps, ctx), refreshed, failed, skipped_reason: null };
}

export type { TaskLink };
