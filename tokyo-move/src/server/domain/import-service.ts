import type { Deps, AuthContext } from '../context';
import type { ImportChange, ImportRun } from '../../shared/types';
import { notFound } from '../http/errors';
import { importRunFromRow } from './snapshot-service';
import { parseLoose } from '../util/json';

export function listImportRuns(deps: Deps, ctx: AuthContext, limit: number): ImportRun[] {
  const rows = deps.db
    .prepare('SELECT * FROM import_runs WHERE household_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?')
    .all(ctx.householdId, limit) as Parameters<typeof importRunFromRow>[0][];
  return rows.map(importRunFromRow);
}

const VISIBLE_CHANGE = `(NOT EXISTS (SELECT 1 FROM records r WHERE r.household_id = c.household_id AND r.id = c.record_id)
               OR EXISTS (SELECT 1 FROM records r WHERE r.household_id = c.household_id AND r.id = c.record_id
                           AND (r.visibility = 'household' OR r.created_by = @actor)))`;

export interface ChangesPage {
  run: ImportRun;
  changes: ImportChange[];
  /** Number of receipts matching the filter (not just this page). */
  total: number;
  limit: number;
  offset: number;
}

export function listImportChanges(
  deps: Deps,
  ctx: AuthContext,
  runId: string,
  opts: { limit: number; offset: number; correctionId?: string | undefined },
): ChangesPage {
  const { limit, offset } = opts;
  const runRow = deps.db
    .prepare('SELECT * FROM import_runs WHERE household_id = ? AND id = ?')
    .get(ctx.householdId, runId) as Parameters<typeof importRunFromRow>[0] | undefined;
  if (!runRow) throw notFound('Import run');
  const params = { hh: ctx.householdId, run: runId, actor: ctx.personId, ...(opts.correctionId ? { correction: opts.correctionId } : {}) };
  const filter = `c.household_id = @hh AND c.import_run_id = @run ${opts.correctionId ? 'AND c.correction_id = @correction' : ''} AND ${VISIBLE_CHANGE}`;
  const total = (deps.db.prepare(`SELECT COUNT(*) AS n FROM import_changes c WHERE ${filter}`).get(params) as { n: number }).n;
  const rows = deps.db
    .prepare(`SELECT c.* FROM import_changes c WHERE ${filter} ORDER BY c.rowid LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as ChangeRow[];
  return { run: importRunFromRow(runRow), total, limit, offset, changes: rows.map(changeFromRow) };
}

interface ChangeRow {
  id: string;
  import_run_id: string;
  record_id: string;
  change: ImportChange['change'];
  field: string | null;
  before: string | null;
  after: string | null;
  rationale: string | null;
  correction_id: string | null;
}

export function changeFromRow(r: ChangeRow): ImportChange {
  return {
    id: r.id,
    import_run_id: r.import_run_id,
    record_id: r.record_id,
    change: r.change,
    field: r.field,
    before: parseLoose(r.before),
    after: parseLoose(r.after),
    rationale: r.rationale,
    correction_id: r.correction_id,
  };
}

/** Import receipts for ONE record (caller has already checked the record is visible). */
export function importChangesForRecord(deps: Deps, householdId: string, recordId: string, limit = 200): ImportChange[] {
  const rows = deps.db
    .prepare('SELECT * FROM import_changes WHERE household_id = ? AND record_id = ? ORDER BY rowid DESC LIMIT ?')
    .all(householdId, recordId, limit) as ChangeRow[];
  return rows.map(changeFromRow);
}
