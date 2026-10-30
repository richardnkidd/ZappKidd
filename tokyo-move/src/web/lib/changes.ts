import type { BaseRecord } from '@shared/types';
import { FIELD_LABEL, WORK_STATUS_LABEL } from '@shared/labels';
import type { WorkStatus } from '@shared/types';
import type { Directory } from './records';
import { civil } from './format';

/** Flatten a nested change object ({ owner, data: { next_action } }) to dotted paths. */
export function flattenChanges(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0 && !isLeafObject(k)) {
      Object.assign(out, flattenChanges(v as Record<string, unknown>, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}

/** Objects that are values in their own right (shown whole, not field by field). */
function isLeafObject(key: string): boolean {
  return key === 'deadline' || key === 'traveler_progress';
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

export function fieldLabel(path: string): string {
  const last = path.split('.').pop() ?? path;
  return FIELD_LABEL[last] ?? last.replace(/_/g, ' ');
}

/** Human text for any field value. Unknown stays "Not set". */
export function describeValue(path: string, value: unknown, dir?: Directory): string {
  const last = path.split('.').pop() ?? path;
  if (value === null || value === undefined || value === '') return 'Not set';
  if (last === 'owner') return dir ? dir.ownerLabel(String(value)) : String(value);
  if (last === 'status') return WORK_STATUS_LABEL[value as WorkStatus] ?? String(value);
  if (last === 'review_date') return civil(String(value), 'short');
  if (last === 'deadline' && typeof value === 'object') {
    const d = (value as { date?: string | null }).date;
    return d ? civil(d, 'short') : 'Awaiting date';
  }
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ') : 'None';
  if (typeof value === 'object') return 'Updated';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export interface FieldDiff {
  path: string;
  label: string;
  theirs: string;
  yours: string;
}

/** For the conflict screen: the fields I changed, with the server's current value beside mine. */
export function conflictDiffs(yourChanges: Record<string, unknown>, server: BaseRecord | null, dir?: Directory): FieldDiff[] {
  const flat = flattenChanges(yourChanges);
  return Object.entries(flat).map(([path, mine]) => ({
    path,
    label: fieldLabel(path),
    theirs: describeValue(path, server ? getPath(server, path) : undefined, dir),
    yours: describeValue(path, mine, dir),
  }));
}
