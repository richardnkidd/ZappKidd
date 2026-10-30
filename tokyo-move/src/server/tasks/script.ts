/**
 * Script adapter: placeholder for the sanctioned Task-Management scripts.
 *
 * NOT USED IN THIS BUILD. It refuses every operation unless BOTH `KADODE_TASK_LIVE_WRITES=approved` and a command
 * (`KADODE_TASK_SCRIPT`) are configured, and even then this build deliberately has no implementation: wiring live
 * writes to the household's real task system is a separate, explicitly approved step. It never reads or writes
 * tasks.jsonl, recurring.jsonl or the action journal.
 */
import {
  TaskAdapterError,
  type CanonicalTask,
  type TaskAdapter,
  type TaskCreateInput,
  type TaskPatch,
} from './adapter';

export interface ScriptAdapterConfig {
  command: string | null;
  liveWrites: string | undefined;
}

export class ScriptTaskAdapter implements TaskAdapter {
  readonly name = 'script' as const;
  readonly canWrite = false; // never true in this build
  readonly note = 'Script adapter is disabled in this build.';

  constructor(private readonly config: ScriptAdapterConfig) {}

  private refuse(): never {
    if (this.config.liveWrites !== 'approved' || !this.config.command) {
      throw new TaskAdapterError('not_authorized', 'Not authorized: live task writes are not approved or no command is configured');
    }
    throw new TaskAdapterError('not_authorized', 'Not authorized: the script adapter is not enabled in this build');
  }

  async list(): Promise<CanonicalTask[]> {
    return this.refuse();
  }
  async get(_id: string): Promise<CanonicalTask | null> {
    return this.refuse();
  }
  async create(_input: TaskCreateInput): Promise<CanonicalTask> {
    return this.refuse();
  }
  async update(_id: string, _patch: TaskPatch, _expectedRevision?: number): Promise<CanonicalTask> {
    return this.refuse();
  }
  async complete(_id: string, _evidence: string): Promise<CanonicalTask> {
    return this.refuse();
  }
}
