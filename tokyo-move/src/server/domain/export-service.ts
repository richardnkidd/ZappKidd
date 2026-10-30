/** JSON and CSV export of everything the caller may see. The reversible path off the app. */
import type { Deps, AuthContext } from '../context';
import type { RecordType } from '../../shared/types';
import { schemaVersion } from '../db/db';
import { listPeople } from '../auth/users';
import { listAudit } from './audit';
import { listRecordRows, rowToRecord, type ApiRecord } from './records-repo';
import { listTaskLinkRows, taskLinkFromRow } from './task-links-repo';
import { importRunFromRow } from './snapshot-service';
import { isPlainObject } from '../util/json';

export const EXPORT_FORMAT_VERSION = 1;

export function exportJson(deps: Deps, ctx: AuthContext): Record<string, unknown> {
  const records = listRecordRows(deps.db, ctx).map((r) => rowToRecord(r, true));
  const people = listPeople(deps.db, ctx.householdId);
  const taskLinks = listTaskLinkRows(deps.db, ctx.householdId).map(taskLinkFromRow);
  const runs = (deps.db
    .prepare('SELECT * FROM import_runs WHERE household_id = ? ORDER BY started_at, rowid')
    .all(ctx.householdId) as Parameters<typeof importRunFromRow>[0][]).map(importRunFromRow);
  const audit = listAudit(deps.db, ctx, { limit: 1_000_000 });
  return {
    export: {
      app: 'kadode',
      format_version: EXPORT_FORMAT_VERSION,
      mode: deps.config.mode,
      generated_at: deps.now().toISOString(),
      schema_version: schemaVersion(deps.db),
      household: { id: ctx.household.id, name: ctx.household.name, data_label: ctx.household.data_label },
      exported_by: ctx.personId,
      note: 'Contains every record visible to the exporting person, including their private records.',
      counts: {
        people: people.length,
        records: records.length,
        task_links: taskLinks.length,
        import_runs: runs.length,
        audit: audit.length,
      },
    },
    people,
    records,
    task_links: taskLinks,
    import_runs: runs,
    audit,
  };
}

/* ---------- CSV ---------- */

const BASE_COLUMNS = [
  'id', 'type', 'key', 'title', 'status', 'owner', 'owner_proposed', 'visibility', 'created_by', 'version',
  'created_at', 'updated_at', 'updated_by',
] as const;

/**
 * Spreadsheet formula injection guard: a text cell starting with = + - @ (or a tab/CR) is prefixed with a single
 * quote so spreadsheet software shows it as text rather than evaluating it.
 */
export function csvCell(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) s = '';
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

function flatten(prefix: string, value: unknown, out: Record<string, unknown>, depth = 0): void {
  if (value === null || value === undefined) {
    out[prefix] = null;
  } else if (Array.isArray(value)) {
    out[prefix] = value.every((v) => v === null || typeof v !== 'object') ? value.map((v) => (v === null ? '' : String(v))).join(' | ') : JSON.stringify(value);
  } else if (isPlainObject(value)) {
    if (depth >= 3) out[prefix] = JSON.stringify(value);
    else for (const [k, v] of Object.entries(value)) flatten(`${prefix}.${k}`, v, out, depth + 1);
  } else {
    out[prefix] = value;
  }
}

export function recordsToCsv(records: ApiRecord[]): string {
  const dataColumns = new Set<string>();
  const flat = records.map((r) => {
    const f: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.data)) flatten(`data.${k}`, v, f);
    for (const k of Object.keys(f)) dataColumns.add(k);
    return f;
  });
  const cols = [...BASE_COLUMNS, 'locally_edited', ...[...dataColumns].sort()];
  const lines = [cols.map(csvCell).join(',')];
  records.forEach((r, i) => {
    const base: Record<string, unknown> = {
      ...r,
      locally_edited: r.locally_edited.join(' | '),
      owner_proposed: r.owner_proposed,
    };
    const f = flat[i] as Record<string, unknown>;
    lines.push(cols.map((c) => csvCell(c.startsWith('data.') ? f[c] : base[c])).join(','));
  });
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function exportCsv(deps: Deps, ctx: AuthContext, type: RecordType): string {
  return recordsToCsv(listRecordRows(deps.db, ctx, type).map((r) => rowToRecord(r, false)));
}
