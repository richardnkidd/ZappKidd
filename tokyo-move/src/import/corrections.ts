/**
 * Reviewed-model corrections: small, ID-based, generic edits applied to the NORMALIZED bundle before it is upserted,
 * each with a rationale and a receipt. Source values (source.raw) are never edited.
 *
 * Application is idempotent in two ways:
 *  - the transform is deterministic and always re-run on the freshly parsed bundle, so stored state converges;
 *  - receipts (import_changes) are written once per (correction, record), tracked in `corrections_applied`.
 *
 * Real-data-specific corrections are NOT in this file: they are loaded from `private/corrections/*.json`
 * (file-name order, after the generic ones). Shape:
 *   { "corrections": [ { "id", "title", "rationale", "source"?, "ops": [ {op, record, path, value|find/replace|…} ] } ] }
 * A loaded correction with the same id as a built-in one replaces it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BaseRecord, ImportBundle } from '../shared/types';
import { clone, deepEqual, FORBIDDEN_KEYS, getPath, isObject, setPath } from './util';

export type BundleRecord = ImportBundle['records'][number];

export type NewRecordSpec = Pick<BundleRecord, 'type' | 'key' | 'title' | 'status'> &
  Partial<Pick<BundleRecord, 'owner' | 'owner_proposed' | 'visibility' | 'created_by' | 'data' | 'source'>>;

export type CorrectionOp =
  | { op: 'set'; record: string; path: string; value: unknown }
  | { op: 'add'; record: string; path: string; value: unknown }
  | { op: 'remove'; record: string; path: string; value: unknown }
  | { op: 'replace_text'; record: string; path: string; find: string; replace: string }
  /** Drop every clause (split on ; , . and the word 'and' boundaries kept simple) that matches `pattern`. */
  | { op: 'strip_clause'; record: string; path: string; pattern: string }
  | { op: 'create'; record: NewRecordSpec }
  | { op: 'setting'; key: string; value: unknown }
  /**
   * Leave a record (or a task link, `task_link:<canonical id>`) out of the import entirely: it is outside the plan's
   * scope. Links to it from other records, settings and task links are removed after all corrections have run.
   */
  | { op: 'exclude'; record: string; reason: string };

export interface Correction {
  id: string;
  title: string;
  rationale: string;
  /** Where the correction came from, e.g. 'pm-findings.json#PM-001'. */
  source?: string | null;
  ops?: CorrectionOp[];
  /** Programmatic corrections derive their ops from the bundle (e.g. one child per traveler). */
  expand?: (bundle: ImportBundle) => CorrectionOp[];
}

export interface CorrectionReceipt {
  correction_id: string;
  /** Record id the op touched, or `setting:<key>` for settings. */
  record_id: string;
  op: CorrectionOp['op'];
  field: string | null;
  before: unknown;
  after: unknown;
  outcome: 'applied' | 'not_applicable';
  rationale: string;
}

export interface CorrectionResult {
  bundle: ImportBundle;
  receipts: CorrectionReceipt[];
}

/* ------------------------------------------------------------------ */
/* Interpreter                                                         */
/* ------------------------------------------------------------------ */

function stripClauses(text: string, pattern: RegExp): string {
  // Split into sentences first, then into ';'-separated clauses, so only the offending clause is removed.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (!pattern.test(sentence)) {
      kept.push(sentence);
      continue;
    }
    const clauses = sentence.split(/(?<=;)\s+/);
    if (clauses.length === 1) continue; // the whole sentence is the clause
    const remaining = clauses.filter((c) => !pattern.test(c));
    if (remaining.length === 0) continue;
    let joined = remaining.join(' ').trim();
    // A sentence whose last clause was removed should still end cleanly.
    if (/[;,]$/.test(joined)) joined = joined.replace(/[;,]$/, '.');
    kept.push(joined);
  }
  return kept.join(' ').trim();
}

function describeSpec(spec: NewRecordSpec): unknown {
  return { id: `${spec.type}:${spec.key}`, title: spec.title, status: spec.status };
}

function toBundleRecord(spec: NewRecordSpec): BundleRecord {
  return {
    id: `${spec.type}:${spec.key}`,
    type: spec.type,
    key: spec.key,
    title: spec.title,
    status: spec.status,
    owner: spec.owner ?? null,
    owner_proposed: spec.owner_proposed ?? false,
    visibility: spec.visibility ?? 'household',
    created_by: spec.created_by ?? 'import',
    data: (spec.data ?? {}) as Record<string, unknown>,
    source: spec.source ?? null,
  };
}

function applyOp(bundle: ImportBundle, correction: Correction, op: CorrectionOp): CorrectionReceipt {
  const base = { correction_id: correction.id, op: op.op };
  const na = (record_id: string, field: string | null, why: string): CorrectionReceipt => ({
    ...base, record_id, field, before: null, after: null, outcome: 'not_applicable', rationale: `${correction.rationale} (not applied: ${why})`,
  });

  if (op.op === 'setting') {
    const settings = bundle.settings as Record<string, unknown>;
    const before = settings[op.key];
    const record_id = `setting:${op.key}`;
    if (FORBIDDEN_KEYS.has(op.key)) return na(record_id, op.key, 'forbidden key');
    if (deepEqual(before, op.value)) return na(record_id, op.key, 'already in the corrected state');
    settings[op.key] = clone(op.value);
    return { ...base, record_id, field: op.key, before: before ?? null, after: op.value, outcome: 'applied', rationale: correction.rationale };
  }

  if (op.op === 'create') {
    const record = toBundleRecord(op.record);
    if (bundle.records.some((r) => r.id === record.id)) return na(record.id, null, 'record already exists');
    bundle.records.push(record);
    return { ...base, record_id: record.id, field: null, before: null, after: describeSpec(op.record), outcome: 'applied', rationale: correction.rationale };
  }

  // Exclusions need the shared bookkeeping in applyCorrections.
  if (op.op === 'exclude') return na(op.record, null, 'exclusions are applied by applyCorrections');

  const record = bundle.records.find((r) => r.id === op.record);
  if (!record) return na(op.record, op.path, 'record not found');
  if (op.path.split('.').some((seg) => FORBIDDEN_KEYS.has(seg))) return na(op.record, op.path, 'forbidden path');
  const root = record as unknown as Record<string, unknown>;
  const current = getPath(root, op.path);
  const applied = (after: unknown): CorrectionReceipt => ({
    ...base, record_id: op.record, field: op.path, before: current === undefined ? null : clone(current), after: clone(after), outcome: 'applied', rationale: correction.rationale,
  });

  switch (op.op) {
    case 'set': {
      if (deepEqual(current, op.value)) return na(op.record, op.path, 'already in the corrected state');
      setPath(root, op.path, clone(op.value));
      return applied(op.value);
    }
    case 'add': {
      const list = current === undefined || current === null ? [] : current;
      if (!Array.isArray(list)) return na(op.record, op.path, 'target is not a list');
      if (list.some((x) => deepEqual(x, op.value))) return na(op.record, op.path, 'value already present');
      const next = [...list, clone(op.value)];
      setPath(root, op.path, next);
      return applied(next);
    }
    case 'remove': {
      if (!Array.isArray(current)) return na(op.record, op.path, 'target is not a list');
      const next = current.filter((x) => !deepEqual(x, op.value));
      if (next.length === current.length) return na(op.record, op.path, 'value not present');
      setPath(root, op.path, next);
      return applied(next);
    }
    case 'replace_text': {
      if (typeof current !== 'string' || !op.find || !current.includes(op.find)) return na(op.record, op.path, 'text to replace not found');
      const next = current.split(op.find).join(op.replace);
      setPath(root, op.path, next);
      return applied(next);
    }
    case 'strip_clause': {
      if (typeof current !== 'string') return na(op.record, op.path, 'target is not text');
      const next = stripClauses(current, new RegExp(op.pattern));
      if (next === current) return na(op.record, op.path, 'no matching clause');
      setPath(root, op.path, next);
      return applied(next);
    }
    default:
      return na((op as { record?: string }).record ?? 'unknown', null, 'unknown operation');
  }
}

/* ------------------------------------------------------------------ */
/* Scope exclusion                                                     */
/* ------------------------------------------------------------------ */

const TASK_LINK_PREFIX = 'task_link:';
/** Fields that name the record a list entry is about. */
const REF_FIELDS = ['key', 'record', 'record_id', 'record_key'] as const;

interface Excluded {
  /** Record ids and `task_link:<canonical id>` refs that were left out. */
  ids: Set<string>;
  /** Keys of excluded records that no remaining record also uses (safe to strip from link lists). */
  keys: Set<string>;
  rationale: Map<string, string>;
}

function excludeOne(bundle: ImportBundle, correction: Correction, op: Extract<CorrectionOp, { op: 'exclude' }>, ex: Excluded): CorrectionReceipt {
  const base = { correction_id: correction.id, op: op.op, field: null, after: null, rationale: op.reason || correction.rationale };
  if (op.record.startsWith(TASK_LINK_PREFIX)) {
    const canonical = op.record.slice(TASK_LINK_PREFIX.length);
    const i = bundle.task_links.findIndex((l) => l.canonical_id === canonical);
    if (i < 0) return { ...base, record_id: op.record, before: null, outcome: 'not_applicable', rationale: 'task link not found' };
    const [gone] = bundle.task_links.splice(i, 1);
    ex.ids.add(op.record);
    return { ...base, record_id: op.record, before: { title: gone!.title, status: gone!.status }, outcome: 'applied' };
  }
  const i = bundle.records.findIndex((r) => r.id === op.record);
  if (i < 0) return { ...base, record_id: op.record, before: null, outcome: 'not_applicable', rationale: 'record not found' };
  const [gone] = bundle.records.splice(i, 1);
  ex.ids.add(gone!.id);
  ex.keys.add(gone!.key);
  ex.rationale.set(gone!.id, base.rationale);
  return { ...base, record_id: gone!.id, before: { title: gone!.title, status: gone!.status }, outcome: 'applied' };
}

/** Remove excluded keys/ids from string lists and map keys, recursively. Returns the new value, or `undefined` if unchanged. */
function stripRefs(value: unknown, drop: (s: string) => boolean): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      // A bare reference, or an entry that identifies an excluded record (e.g. a gate `{ key, reason }`), goes entirely.
      if ((typeof item === 'string' && drop(item)) || (isObject(item) && REF_FIELDS.some((f) => typeof item[f] === 'string' && drop(item[f] as string)))) {
        changed = true;
        continue;
      }
      const inner = stripRefs(item, drop);
      if (inner !== undefined) changed = true;
      next.push(inner === undefined ? item : inner);
    }
    return changed ? next : undefined;
  }
  if (isObject(value)) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      if (drop(k)) {
        changed = true;
        continue;
      }
      if (typeof v === 'string' && drop(v)) {
        // A single reference field (e.g. a workstream key) that pointed at an excluded record.
        changed = true;
        next[k] = null;
        continue;
      }
      const inner = stripRefs(v, drop);
      if (inner !== undefined) changed = true;
      next[k] = inner === undefined ? v : inner;
    }
    return changed ? next : undefined;
  }
  return undefined;
}

/**
 * After every correction has run: drop records an `exclude` left out (even if a later op re-created them), task links
 * attached to them, and every link to them in other records' data and in settings. Source values are never touched.
 */
function sweepExcluded(bundle: ImportBundle, correction: Correction, ex: Excluded, receipts: CorrectionReceipt[]): void {
  if (ex.ids.size === 0) return;
  bundle.records = bundle.records.filter((r) => !ex.ids.has(r.id));
  // A key is only stripped from link lists when no remaining record uses the same key.
  for (const r of bundle.records) ex.keys.delete(r.key);
  const drop = (s: string) => ex.keys.has(s) || ex.ids.has(s);
  const why = 'Removed a link to an item outside the move.';

  bundle.task_links = bundle.task_links.filter((l) => {
    if (!l.record_id || !ex.ids.has(l.record_id)) return true;
    receipts.push({
      correction_id: correction.id, record_id: `${TASK_LINK_PREFIX}${l.canonical_id ?? l.id}`, op: 'exclude', field: null,
      before: { title: l.title, status: l.status }, after: null, outcome: 'applied', rationale: ex.rationale.get(l.record_id) ?? why,
    });
    return false;
  });

  for (const r of bundle.records) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(data)) {
      if (drop(k)) {
        delete data[k];
      } else {
        const next = typeof v === 'string' && drop(v) ? null : stripRefs(v, drop);
        if (next === undefined) continue;
        data[k] = next;
      }
      receipts.push({ correction_id: correction.id, record_id: r.id, op: 'exclude', field: k, before: v, after: data[k] ?? null, outcome: 'applied', rationale: why });
    }
  }
  const settings = bundle.settings as Record<string, unknown>;
  for (const [k, v] of Object.entries(settings)) {
    const next = stripRefs(v, drop);
    if (next === undefined) continue;
    settings[k] = next;
    receipts.push({ correction_id: correction.id, record_id: `setting:${k}`, op: 'exclude', field: k, before: v, after: next, outcome: 'applied', rationale: why });
  }
}

/** Apply corrections, in order, to a deep copy of the bundle. Never throws for a missing target. */
export function applyCorrections(bundle: ImportBundle, corrections: readonly Correction[]): CorrectionResult {
  const out = clone(bundle);
  const receipts: CorrectionReceipt[] = [];
  const ex: Excluded = { ids: new Set(), keys: new Set(), rationale: new Map() };
  let lastExcluding: Correction | null = null;
  for (const correction of corrections) {
    const ops = [...(correction.ops ?? []), ...(correction.expand ? correction.expand(out) : [])];
    for (const op of ops) {
      if (op.op === 'exclude') {
        receipts.push(excludeOne(out, correction, op, ex));
        lastExcluding = correction;
      } else {
        receipts.push(applyOp(out, correction, op));
      }
    }
  }
  if (lastExcluding) sweepExcluded(out, lastExcluding, ex, receipts);
  return { bundle: out, receipts };
}

/** Record ids (and `task_link:` refs) that applied `exclude` receipts left out of the import. */
export function excludedIds(receipts: readonly CorrectionReceipt[]): string[] {
  return receipts.filter((r) => r.op === 'exclude' && r.outcome === 'applied' && r.field === null).map((r) => r.record_id);
}

/* ------------------------------------------------------------------ */
/* Loading corrections from JSON files                                 */
/* ------------------------------------------------------------------ */

const PATH_OPS = new Set(['set', 'add', 'remove', 'replace_text', 'strip_clause']);
const ALL_OPS = new Set([...PATH_OPS, 'create', 'setting', 'exclude']);

function validateOp(raw: unknown, where: string): CorrectionOp {
  if (!isObject(raw) || typeof raw.op !== 'string' || !ALL_OPS.has(raw.op)) throw new Error(`${where}: unknown or missing "op"`);
  if (PATH_OPS.has(raw.op)) {
    if (typeof raw.record !== 'string' || typeof raw.path !== 'string') throw new Error(`${where}: "${raw.op}" needs string "record" and "path"`);
    if (raw.op === 'replace_text' && (typeof raw.find !== 'string' || typeof raw.replace !== 'string')) throw new Error(`${where}: "replace_text" needs "find" and "replace"`);
    if (raw.op === 'strip_clause' && typeof raw.pattern !== 'string') throw new Error(`${where}: "strip_clause" needs "pattern"`);
    if (['set', 'add', 'remove'].includes(raw.op) && !('value' in raw)) throw new Error(`${where}: "${raw.op}" needs "value"`);
  }
  if (raw.op === 'create') {
    const r = raw.record;
    if (!isObject(r) || typeof r.type !== 'string' || typeof r.key !== 'string' || typeof r.title !== 'string' || typeof r.status !== 'string') {
      throw new Error(`${where}: "create" needs record {type, key, title, status}`);
    }
  }
  if (raw.op === 'setting' && (typeof raw.key !== 'string' || !('value' in raw))) throw new Error(`${where}: "setting" needs "key" and "value"`);
  if (raw.op === 'exclude' && (typeof raw.record !== 'string' || typeof raw.reason !== 'string' || !raw.reason.trim())) {
    throw new Error(`${where}: "exclude" needs string "record" and a non-empty "reason"`);
  }
  return raw as unknown as CorrectionOp;
}

export function parseCorrectionFile(text: string, fileName: string): Correction[] {
  const parsed: unknown = JSON.parse(text);
  const list = isObject(parsed) && Array.isArray(parsed.corrections) ? parsed.corrections : Array.isArray(parsed) ? parsed : isObject(parsed) && parsed.id ? [parsed] : null;
  if (!list) throw new Error(`${fileName}: expected {"corrections": [...]}`);
  return list.map((item, i): Correction => {
    const where = `${fileName}#${i}`;
    if (!isObject(item) || typeof item.id !== 'string' || !Array.isArray(item.ops ?? [])) throw new Error(`${where}: each correction needs "id" and "ops"`);
    return {
      id: item.id,
      title: typeof item.title === 'string' ? item.title : item.id,
      rationale: typeof item.rationale === 'string' ? item.rationale : '',
      source: typeof item.source === 'string' ? item.source : null,
      ops: ((item.ops ?? []) as unknown[]).map((op, j) => validateOp(op, `${where}.ops[${j}]`)),
    };
  });
}

/** Load `*.json` corrections from a directory in file-name order. A missing directory yields none. */
export function loadCorrectionFiles(dir: string): { corrections: Correction[]; files: { name: string; text: string }[] } {
  if (!existsSync(dir)) return { corrections: [], files: [] };
  const names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const corrections: Correction[] = [];
  const files: { name: string; text: string }[] = [];
  for (const name of names) {
    const text = readFileSync(join(dir, name), 'utf8');
    files.push({ name, text });
    corrections.push(...parseCorrectionFile(text, name));
  }
  return { corrections, files };
}

/** Built-ins first, then file corrections; a file correction with a built-in's id replaces it in place. */
export function mergeCorrections(builtin: readonly Correction[], extra: readonly Correction[]): Correction[] {
  const merged = [...builtin];
  for (const c of extra) {
    const i = merged.findIndex((m) => m.id === c.id);
    if (i >= 0) merged[i] = c;
    else merged.push(c);
  }
  return merged;
}

/** Type guard used by tests. */
export function isMilestone(r: BundleRecord | BaseRecord): boolean {
  return r.type === 'milestone';
}

export { BUILTIN_CORRECTIONS } from './builtin-corrections';
