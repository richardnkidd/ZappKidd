import type { AuditEntry, WorkStatus } from '@shared/types';
import { FIELD_LABEL, WORK_STATUS_LABEL } from '@shared/labels';
import type { Directory, Indexes } from './records';
import { truncate } from './format';

export interface AuditLine {
  id: string;
  at: string;
  who: string;
  /** Sentence without the person's name, e.g. 'marked "Book flights" as Done'. */
  what: string;
  recordId: string | null;
  /** Several import entries rolled up into one line. */
  rolledUp?: number;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Which user-visible fields differ between two snapshots of a record (top level and one level into data). */
export function changedFields(before: unknown, after: unknown): string[] {
  const b = asObj(before);
  const a = asObj(after);
  if (!a) return [];
  const out = new Set<string>();
  const cmp = (x: unknown, y: unknown) => JSON.stringify(x) !== JSON.stringify(y);
  for (const key of Object.keys(a)) {
    if (key === 'data') {
      const ad = asObj(a.data) ?? {};
      const bd = asObj(b?.data) ?? {};
      for (const k of Object.keys(ad)) if (cmp(bd[k], ad[k]) && FIELD_LABEL[k]) out.add(FIELD_LABEL[k]!);
    } else if (FIELD_LABEL[key] && cmp(b?.[key], a[key])) {
      out.add(FIELD_LABEL[key]!);
    }
  }
  return [...out];
}

function statusFrom(v: unknown): string | null {
  const o = asObj(v);
  const s = o?.status ?? asObj(o?.record)?.status;
  return typeof s === 'string' ? (WORK_STATUS_LABEL[s as WorkStatus] ?? s) : null;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function describeAudit(e: AuditEntry, idx: Indexes, dir: Directory): AuditLine {
  const rec = e.record_id ? idx.byId.get(e.record_id) : undefined;
  const afterTitle = asObj(e.after)?.title;
  const title = rec?.title ?? (typeof afterTitle === 'string' ? afterTitle : null);
  const quoted = title ? `“${truncate(title, 70)}”` : 'an item';
  const who = dir.nameOf(e.actor);
  let what: string;
  switch (e.action) {
    case 'create':
      what = `added ${quoted}`;
      break;
    case 'update': {
      const fields = changedFields(e.before, e.after);
      what = fields.length ? `changed the ${joinList(fields)} on ${quoted}` : `edited ${quoted}`;
      break;
    }
    case 'status_change': {
      const to = statusFrom(e.after);
      what = to ? `marked ${quoted} as ${to}` : `changed the status of ${quoted}`;
      break;
    }
    case 'approve':
      what = `approved ${quoted}`;
      break;
    case 'reject':
      what = `rejected ${quoted}`;
      break;
    case 'defer':
      what = `deferred ${quoted}`;
      break;
    case 'undo':
      what = `undid a change to ${quoted}`;
      break;
    case 'task_propose': {
      const t = asObj(e.after)?.title;
      what = `proposed a task${typeof t === 'string' ? `: “${truncate(t, 70)}”` : ''}`;
      break;
    }
    case 'task_complete':
      what = `completed a task${title ? ` for ${quoted}` : ''}`;
      break;
    case 'task_sync':
      what = 'refreshed the task list copy';
      break;
    case 'anchor_change':
      what = 'moved a travel date';
      break;
    case 'review_complete':
      what = 'finished a review together';
      break;
    case 'import_create':
    case 'import_update':
    case 'correction':
      what = `updated ${quoted} from the plan`;
      break;
    case 'restore':
      what = 'restored data from a backup';
      break;
    default:
      what = `made a change to ${quoted}`;
  }
  return { id: e.id, at: e.at, who, what, recordId: e.record_id, };
}

const IMPORT_ACTIONS = new Set(['import_create', 'import_update', 'correction']);

/** Newest first; all import entries roll up into one line so a big import does not bury real edits. */
export function describeAuditList(entries: AuditEntry[], idx: Indexes, dir: Directory): AuditLine[] {
  const sorted = [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const lines: AuditLine[] = [];
  let importGroup: AuditLine | null = null;
  for (const e of sorted) {
    if (IMPORT_ACTIONS.has(e.action)) {
      if (!importGroup) {
        importGroup = { id: `import-${e.id}`, at: e.at, who: 'The plan import', what: 'brought in 1 change', recordId: null, rolledUp: 1 };
        lines.push(importGroup);
      } else {
        importGroup.rolledUp = (importGroup.rolledUp ?? 1) + 1;
        importGroup.what = `brought in ${importGroup.rolledUp} changes`;
      }
      continue;
    }
    lines.push(describeAudit(e, idx, dir));
  }
  return lines;
}
