/**
 * Snapshot adapter: a read-only, dated copy of linked tasks that already exist as `task_links` rows with adapter
 * 'snapshot' (from the roadmap-queue crosswalk). Every write is refused.
 */
import type { Db } from '../db/db';
import {
  TaskAdapterError,
  type CanonicalTask,
  type TaskAdapter,
  type TaskCreateInput,
  type TaskPatch,
  type TaskStatus,
} from './adapter';

const NOT_AUTHORIZED = 'Not authorized: this build only holds a read-only snapshot of the task system';

export class SnapshotTaskAdapter implements TaskAdapter {
  readonly name = 'snapshot' as const;
  readonly canWrite = false;
  readonly note = 'Read-only dated snapshot of linked tasks. New actions stay "Pending task capture".';

  constructor(
    private readonly db: Db,
    private readonly householdId: string | null = null,
  ) {}

  scope(householdId: string): TaskAdapter {
    return new SnapshotTaskAdapter(this.db, householdId);
  }

  private rows(id?: string): { canonical_id: string; title: string; status: string; due: string | null; notes: string | null; remote_revision: string | null }[] {
    const where = ["adapter = 'snapshot'", 'canonical_id IS NOT NULL'];
    const params: unknown[] = [];
    if (this.householdId) {
      where.push('household_id = ?');
      params.push(this.householdId);
    }
    if (id) {
      where.push('canonical_id = ?');
      params.push(id);
    }
    return this.db
      .prepare(`SELECT canonical_id, title, status, due, notes, remote_revision FROM task_links WHERE ${where.join(' AND ')}`)
      .all(...params) as never;
  }

  private toTask(r: ReturnType<SnapshotTaskAdapter['rows']>[number]): CanonicalTask {
    const status: TaskStatus = r.status === 'open' || r.status === 'done' || r.status === 'cancelled' ? r.status : 'unknown';
    const rev = Number(r.remote_revision);
    return { id: r.canonical_id, title: r.title, status, due: r.due, notes: r.notes, revision: Number.isInteger(rev) ? rev : 1 };
  }

  async list(): Promise<CanonicalTask[]> {
    return this.rows().map((r) => this.toTask(r));
  }

  async get(id: string): Promise<CanonicalTask | null> {
    const r = this.rows(id)[0];
    return r ? this.toTask(r) : null;
  }

  async create(_input: TaskCreateInput): Promise<CanonicalTask> {
    throw new TaskAdapterError('not_authorized', NOT_AUTHORIZED);
  }
  async update(_id: string, _patch: TaskPatch, _expectedRevision?: number): Promise<CanonicalTask> {
    throw new TaskAdapterError('not_authorized', NOT_AUTHORIZED);
  }
  async complete(_id: string, _evidence: string): Promise<CanonicalTask> {
    throw new TaskAdapterError('not_authorized', NOT_AUTHORIZED);
  }
}
