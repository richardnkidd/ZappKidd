import type { AuditEntry, WorkStatus } from '@shared/types';
import { FIELD_LABEL, WORK_STATUS_LABEL } from '@shared/labels';
import type { Directory, Indexes } from './records';
import { civil, truncate } from './format';
import { dataOf } from './records';

export interface AuditLine {
  id: string;
  at: string;
  who: string;
  /** Sentence without the person's name, e.g. 'marked "Book flights" as Done'. */
  what: string;
  recordId: string | null;
  /** What kind of change this was (the audit action). */
  action: string;
  /** Several import entries rolled up into one line. */
  rolledUp?: number;
  /** Several similar changes by the same person folded into one row. */
  count?: number;
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

/** A civil date held directly on a snapshot or inside its `data`. */
function dateIn(v: unknown): string | null {
  const o = asObj(v);
  const d = o?.date ?? asObj(o?.data)?.date;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
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
    case 'anchor_change': {
      const meaning = rec ? dataOf<{ meaning?: string }>(rec).meaning : null;
      const from = dateIn(e.before);
      const to = dateIn(e.after);
      const name = meaning || title || 'a travel date';
      what = from && to ? `moved ${name} from ${civil(from)} to ${civil(to)}` : to ? `set ${name} to ${civil(to)}` : `moved ${name}`;
      break;
    }
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
  return { id: e.id, at: e.at, who, what, recordId: e.record_id, action: e.action };
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
        importGroup = { id: `import-${e.id}`, at: e.at, who: 'The plan import', what: 'brought in 1 change', recordId: null, action: 'import', rolledUp: 1 };
        lines.push(importGroup);
      } else {
        importGroup.rolledUp = (importGroup.rolledUp ?? 1) + 1;
        importGroup.what = `brought in ${importGroup.rolledUp} changes`;
      }
      continue;
    }
    lines.push(describeAudit(e, idx, dir));
  }
  return groupSimilar(lines);
}

/** Folded-row wording, by kind of change. */
const GROUP_WORDS: Record<string, (n: number) => string> = {
  anchor_change: (n) => `moved ${n} travel dates`,
  create: (n) => `added ${n} items`,
  update: (n) => `edited ${n} items`,
  status_change: (n) => `changed the status of ${n} items`,
  approve: (n) => `approved ${n} decisions`,
  task_propose: (n) => `proposed ${n} tasks`,
  task_complete: (n) => `completed ${n} tasks`,
};
const SIX_HOURS = 6 * 3_600_000;

/** Consecutive changes of the same kind by the same person (within a few hours) read as one row: "Jun moved 5 travel dates". */
export function groupSimilar(lines: AuditLine[]): AuditLine[] {
  const out: AuditLine[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    const words = GROUP_WORDS[l.action];
    if (prev && words && prev.action === l.action && prev.who === l.who && Math.abs(Date.parse(prev.at) - Date.parse(l.at)) <= SIX_HOURS) {
      const n = (prev.count ?? 1) + 1;
      out[out.length - 1] = { ...prev, count: n, what: words(n), recordId: null };
    } else {
      out.push(l);
    }
  }
  return out;
}
