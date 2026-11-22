/**
 * Task adapter contract. The existing personal Task-Management system is the authority for actionable tasks;
 * Kadode only keeps linked records. An adapter never edits the real store's files directly.
 */
export type TaskStatus = 'open' | 'done' | 'cancelled' | 'unknown';

export interface CanonicalTask {
  id: string;
  title: string;
  status: TaskStatus;
  /** civil date held by the task store, or null */
  due: string | null;
  notes: string | null;
  /** monotonically increasing per task; used for optimistic concurrency */
  revision: number;
}

export interface TaskCreateInput {
  title: string;
  due: string | null;
  notes?: string | null;
}

export interface TaskPatch {
  title?: string;
  due?: string | null;
  notes?: string | null;
  status?: 'open' | 'cancelled';
}

export type TaskAdapterErrorCode = 'not_authorized' | 'revision_conflict' | 'not_found' | 'failed';

export class TaskAdapterError extends Error {
  readonly code: TaskAdapterErrorCode;
  constructor(code: TaskAdapterErrorCode, message: string) {
    super(message);
    this.name = 'TaskAdapterError';
    this.code = code;
  }
}

export interface TaskAdapter {
  readonly name: 'fixture' | 'snapshot' | 'script';
  readonly canWrite: boolean;
  /** Human note shown with the adapter status. */
  readonly note: string;
  list(): Promise<CanonicalTask[]>;
  get(id: string): Promise<CanonicalTask | null>;
  create(input: TaskCreateInput): Promise<CanonicalTask>;
  update(id: string, patch: TaskPatch, expectedRevision?: number): Promise<CanonicalTask>;
  complete(id: string, evidence: string): Promise<CanonicalTask>;
  /** Adapters whose data is per household (snapshot) return a view scoped to that household. */
  scope?(householdId: string): TaskAdapter;
}
