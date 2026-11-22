/**
 * Fixture task adapter: an isolated JSON store under the data directory. Used in local-demo and tests to
 * demonstrate create -> readback -> edit -> complete, with injectable failures. Never touches a real task store.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  TaskAdapterError,
  type CanonicalTask,
  type TaskAdapter,
  type TaskCreateInput,
  type TaskPatch,
  type TaskStatus,
} from './adapter';

export type FixtureFailure = 'create' | 'update' | 'complete' | 'readback';
const FAILURES: readonly string[] = ['create', 'update', 'complete', 'readback'];

export const FIXTURE_STORE_FILE = 'task-fixture-store.json';
const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'demo', 'task-store.json');

interface StoreFile {
  version: 1;
  counter: number;
  tasks: CanonicalTask[];
}

export function parseFailure(value: string | undefined): FixtureFailure | null {
  return value && FAILURES.includes(value) ? (value as FixtureFailure) : null;
}

export interface FixtureOptions {
  dataDir: string;
  /** Make the next call of this kind fail once (for tests and KADODE_TASK_FIXTURE_FAIL). */
  failNext?: FixtureFailure | null;
  /** Override the seed file (tests). */
  seedPath?: string;
  /** Civil 'today' stamped as created_on on new tasks (optional). */
  today?: () => string;
}

export class FixtureTaskAdapter implements TaskAdapter {
  readonly name = 'fixture' as const;
  readonly canWrite = true;
  readonly note = 'Isolated fixture task store (demo). Nothing here reaches a real task system.';
  /** Mutable on purpose: tests set this between calls. Cleared after it fires once. */
  failNext: FixtureFailure | null;
  private readonly file: string;

  constructor(private readonly opts: FixtureOptions) {
    this.failNext = opts.failNext ?? null;
    this.file = join(opts.dataDir, FIXTURE_STORE_FILE);
    this.ensureStore();
  }

  private ensureStore(): void {
    if (existsSync(this.file)) return;
    mkdirSync(dirname(this.file), { recursive: true });
    this.write(this.readSeed());
  }

  private readSeed(): StoreFile {
    const seedPath = this.opts.seedPath ?? SEED_PATH;
    if (!existsSync(seedPath)) return { version: 1, counter: 0, tasks: [] };
    try {
      const raw = JSON.parse(readFileSync(seedPath, 'utf8')) as unknown;
      const list = Array.isArray(raw) ? raw : (raw as { tasks?: unknown }).tasks;
      const tasks = (Array.isArray(list) ? list : [])
        .map((t) => normalizeTask(t))
        .filter((t): t is CanonicalTask => t !== null);
      const counter = Math.max(
        0,
        ...tasks.map((t) => Number(/(\d+)$/.exec(t.id)?.[1] ?? 0)),
        Number((raw as { counter?: unknown }).counter ?? 0) || 0,
      );
      return { version: 1, counter, tasks };
    } catch {
      return { version: 1, counter: 0, tasks: [] };
    }
  }

  private read(): StoreFile {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      return { version: 1, counter: raw.counter ?? 0, tasks: (raw.tasks ?? []).map((t) => normalizeTask(t)).filter((t): t is CanonicalTask => t !== null) };
    } catch {
      throw new TaskAdapterError('failed', 'Fixture task store could not be read');
    }
  }

  /** Atomic write: temp file in the same directory, then rename. */
  private write(store: StoreFile): void {
    const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  private maybeFail(kind: FixtureFailure): void {
    if (this.failNext === kind) {
      this.failNext = null;
      throw new TaskAdapterError('failed', `Injected ${kind} failure`);
    }
  }

  async list(): Promise<CanonicalTask[]> {
    return this.read().tasks.map(canonical);
  }

  async get(id: string): Promise<CanonicalTask | null> {
    this.maybeFail('readback');
    const task = this.read().tasks.find((t) => t.id === id);
    return task ? canonical(task) : null;
  }

  async create(input: TaskCreateInput): Promise<CanonicalTask> {
    this.maybeFail('create');
    const store = this.read();
    store.counter += 1;
    const task: CanonicalTask = {
      id: `FX-${String(store.counter).padStart(4, '0')}`,
      title: input.title,
      status: 'open',
      due: input.due,
      notes: input.notes ?? null,
      revision: 1,
    };
    store.tasks.push({ ...task, created_on: this.opts.today?.() ?? null, updated_at: new Date().toISOString() } as CanonicalTask);
    this.write(store);
    return canonical(task);
  }

  async update(id: string, patch: TaskPatch, expectedRevision?: number): Promise<CanonicalTask> {
    this.maybeFail('update');
    const store = this.read();
    const task = store.tasks.find((t) => t.id === id);
    if (!task) throw new TaskAdapterError('not_found', 'Task not found in the fixture store');
    if (expectedRevision !== undefined && task.revision !== expectedRevision) {
      throw new TaskAdapterError('revision_conflict', 'The task changed in the store since it was last read');
    }
    if (patch.title !== undefined) task.title = patch.title;
    if (patch.due !== undefined) task.due = patch.due;
    if (patch.notes !== undefined) task.notes = patch.notes;
    if (patch.status !== undefined) task.status = patch.status;
    task.revision += 1;
    (task as unknown as Record<string, unknown>).updated_at = new Date().toISOString();
    this.write(store);
    return canonical(task);
  }

  async complete(id: string, evidence: string): Promise<CanonicalTask> {
    this.maybeFail('complete');
    const store = this.read();
    const task = store.tasks.find((t) => t.id === id);
    if (!task) throw new TaskAdapterError('not_found', 'Task not found in the fixture store');
    if (task.status !== 'done') {
      task.status = 'done';
      task.notes = [task.notes, `Completed: ${evidence}`].filter(Boolean).join('\n');
      task.revision += 1;
      (task as unknown as Record<string, unknown>).updated_at = new Date().toISOString();
      this.write(store);
    }
    return canonical(task);
  }

  /** Test helper: change a task behind the app's back to provoke a revision conflict. */
  mutateExternally(id: string, patch: TaskPatch): void {
    const store = this.read();
    const task = store.tasks.find((t) => t.id === id);
    if (!task) throw new Error('no such fixture task');
    Object.assign(task, patch);
    task.revision += 1;
    this.write(store);
  }
}

/** Accepts the demo seed shape (string revisions, extra fields such as owner) and keeps the extras on disk. */
function normalizeTask(t: unknown): CanonicalTask | null {
  if (typeof t !== 'object' || t === null) return null;
  const o = t as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string') return null;
  const status: TaskStatus = o.status === 'done' || o.status === 'cancelled' || o.status === 'open' ? o.status : 'unknown';
  const rev = typeof o.revision === 'number' ? o.revision : Number(o.revision);
  return {
    ...o,
    id: o.id,
    title: o.title,
    status,
    due: typeof o.due === 'string' ? o.due : null,
    notes: typeof o.notes === 'string' ? o.notes : null,
    revision: Number.isInteger(rev) && rev >= 1 ? rev : 1,
  } as CanonicalTask;
}

/** Only the canonical fields leave the adapter. */
function canonical(t: CanonicalTask): CanonicalTask {
  return { id: t.id, title: t.title, status: t.status, due: t.due, notes: t.notes, revision: t.revision };
}
