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
  | { op: 'setting'; key: string; value: unknown };

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

/** Apply corrections, in order, to a deep copy of the bundle. Never throws for a missing target. */
export function applyCorrections(bundle: ImportBundle, corrections: readonly Correction[]): CorrectionResult {
  const out = clone(bundle);
  const receipts: CorrectionReceipt[] = [];
  for (const correction of corrections) {
    const ops = [...(correction.ops ?? []), ...(correction.expand ? correction.expand(out) : [])];
    for (const op of ops) receipts.push(applyOp(out, correction, op));
  }
  return { bundle: out, receipts };
}

/* ------------------------------------------------------------------ */
/* Loading corrections from JSON files                                 */
/* ------------------------------------------------------------------ */

const PATH_OPS = new Set(['set', 'add', 'remove', 'replace_text', 'strip_clause']);
const ALL_OPS = new Set([...PATH_OPS, 'create', 'setting']);

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
