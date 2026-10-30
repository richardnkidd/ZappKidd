import type { Deps, AuthContext } from '../context';
import type { ImportChange, ImportRun } from '../../shared/types';
import { notFound } from '../http/errors';
import { importRunFromRow } from './snapshot-service';

function parseLoose(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function listImportRuns(deps: Deps, ctx: AuthContext, limit: number): ImportRun[] {
  const rows = deps.db
    .prepare('SELECT * FROM import_runs WHERE household_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?')
    .all(ctx.householdId, limit) as Parameters<typeof importRunFromRow>[0][];
  return rows.map(importRunFromRow);
}

export function listImportChanges(deps: Deps, ctx: AuthContext, runId: string, limit: number, offset: number): { run: ImportRun; changes: ImportChange[]; total: number } {
  const runRow = deps.db
    .prepare('SELECT * FROM import_runs WHERE household_id = ? AND id = ?')
    .get(ctx.householdId, runId) as Parameters<typeof importRunFromRow>[0] | undefined;
  if (!runRow) throw notFound('Import run');
  const total = (deps.db.prepare('SELECT COUNT(*) AS n FROM import_changes WHERE household_id = ? AND import_run_id = ?').get(ctx.householdId, runId) as { n: number }).n;
  const rows = deps.db
    .prepare(
      `SELECT c.* FROM import_changes c
        WHERE c.household_id = @hh AND c.import_run_id = @run
          AND (NOT EXISTS (SELECT 1 FROM records r WHERE r.household_id = c.household_id AND r.id = c.record_id)
               OR EXISTS (SELECT 1 FROM records r WHERE r.household_id = c.household_id AND r.id = c.record_id
                           AND (r.visibility = 'household' OR r.created_by = @actor)))
        ORDER BY c.rowid LIMIT @limit OFFSET @offset`,
    )
    .all({ hh: ctx.householdId, run: runId, actor: ctx.personId, limit, offset }) as {
    id: string;
    import_run_id: string;
    record_id: string;
    change: ImportChange['change'];
    field: string | null;
    before: string | null;
    after: string | null;
    rationale: string | null;
    correction_id: string | null;
  }[];
  return {
    run: importRunFromRow(runRow),
    total,
    changes: rows.map((r) => ({
      id: r.id,
      import_run_id: r.import_run_id,
      record_id: r.record_id,
      change: r.change,
      field: r.field,
      before: parseLoose(r.before),
      after: parseLoose(r.after),
      rationale: r.rationale,
      correction_id: r.correction_id,
    })),
  };
}
