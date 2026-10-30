import type { Db } from '../db/db';
import type { AppMode } from '../../shared/types';
import type { TaskAdapter } from './adapter';
import { FixtureTaskAdapter, parseFailure } from './fixture';
import { ScriptTaskAdapter } from './script';
import { SnapshotTaskAdapter } from './snapshot';

export * from './adapter';
export { FixtureTaskAdapter, SnapshotTaskAdapter, ScriptTaskAdapter };

/**
 * Mode default: local-demo -> fixture; local -> snapshot; staging/production -> snapshot unless explicitly
 * configured with KADODE_TASK_ADAPTER (fixture | snapshot | script).
 */
export function createDefaultTaskAdapter(
  mode: AppMode,
  db: Db,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): TaskAdapter {
  const requested = env.KADODE_TASK_ADAPTER;
  const choice = requested ?? (mode === 'local-demo' ? 'fixture' : 'snapshot');
  switch (choice) {
    case 'fixture':
      return new FixtureTaskAdapter({ dataDir, failNext: parseFailure(env.KADODE_TASK_FIXTURE_FAIL) });
    case 'snapshot':
      return new SnapshotTaskAdapter(db);
    case 'script':
      return new ScriptTaskAdapter({ command: env.KADODE_TASK_SCRIPT ?? null, liveWrites: env.KADODE_TASK_LIVE_WRITES });
    default:
      throw new Error(`KADODE_TASK_ADAPTER must be fixture, snapshot or script (got "${choice}")`);
  }
}
