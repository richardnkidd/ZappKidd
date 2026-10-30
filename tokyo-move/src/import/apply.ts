/**
 * The ONLY writer of imported records. Idempotent, transactional, with receipts.
 *
 * - Idempotency key: sha256 over the sorted file sha256s (`import_runs.fileset_sha256`). Same fileset as the latest
 *   effective run (and nothing pending) ⇒ status `no_changes`; only the run row is written.
 * - Upsert by deterministic id `${type}:${key}`. For a NEW source version, fields listed in `records.locally_edited`
 *   are kept (receipt `local_kept`), others take the new source value (receipt `source_updated`).
 * - Reviewed-model corrections are applied to the normalized bundle first; their receipts are written once per
 *   (correction, record) via `corrections_applied`.
 * - Settings: written on first import; later imports update a setting only if it was not changed in-app since the
 *   previous import (tracked by a `_import.<key>` baseline row in `settings`).
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../server/db/db';
import type { HouseholdSettings, ImportBundle, ImportRun, SourceRef, TaskLink } from '../shared/types';
import { applyCorrections, BUILTIN_CORRECTIONS, excludedIds, type Correction, type CorrectionReceipt } from './corrections';
import { clone, deepEqual, sha256Hex, stableStringify } from './util';

export interface ApplyOptions {
  actor?: string;
  now?: Date;
  /** Defaults to the generic built-in corrections. Pass `[]` to apply none. */
  corrections?: readonly Correction[];
  /** Ignore the fileset idempotency check and re-diff every record (use after a parser change). */
  force?: boolean;
}

export interface ApplyResult {
  run: ImportRun;
  status: 'completed' | 'no_changes' | 'failed';
  created: number;
  updated: number;
  kept_local: number;
  corrections: number;
  /** created + updated + kept_local + corrections (receipt rows other than 'unchanged'). */
  changes: number;
  unchanged: number;
  /** Records and task links an earlier import stored that the scope corrections now leave out (removed, with audit). */
  removed?: number;
  error?: string;
}

type BundleRecord = ImportBundle['records'][number];

interface StoredRow {
  id: string;
  title: string;
  status: string;
  owner: string | null;
  owner_proposed: number;
  visibility: string;
  data: string;
  source: string | null;
  locally_edited: string;
  version: number;
}

export function filesetSha256(files: readonly { sha256: string }[]): string {
  return sha256Hex([...files.map((f) => f.sha256)].sort().join('\n'));
}

function parse<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function isEdited(edited: readonly string[], path: string): boolean {
  return edited.some((e) => e === path || path.startsWith(`${e}.`) || e.startsWith(`${path}.`));
}

function rawHash(raw: unknown): string {
  return sha256Hex(stableStringify(raw ?? {}));
}

const SETTING_KEYS = ['traveler_gates', 'task_adapter', 'plan_baseline', 'planning_target', 'jp_holidays'] as const;
const SNAPSHOT_LINK_FIELDS = ['title', 'status', 'due', 'due_basis', 'owner', 'notes', 'proposal_note', 'record_id'] as const;

export function applyBundle(db: Db, bundle: ImportBundle, opts: ApplyOptions = {}): ApplyResult {
  const actor = opts.actor ?? 'import';
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const corrections = opts.corrections ?? BUILTIN_CORRECTIONS;
  const hh = bundle.household.id;
  const fileset = filesetSha256(bundle.files);
  const runId = `run-${at.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;

  const counts = { created: 0, updated: 0, kept_local: 0, corrections: 0, unchanged: 0, not_applicable: 0, missing_from_source: 0, task_links_created: 0, task_links_updated: 0, removed: 0 };

  const insertRun = (status: ImportRun['status'], summary: string, extraCounts: Record<string, number>, finishedAt: string | null): ImportRun => {
    const typeCounts: Record<string, number> = {};
    for (const r of bundle.records) typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
    const runCounts = { ...typeCounts, ...extraCounts };
    db.prepare(
      `INSERT INTO import_runs (id, household_id, started_at, finished_at, source_label, files, fileset_sha256, counts, status, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, hh, at, finishedAt, bundle.source_label, JSON.stringify(bundle.files), fileset, JSON.stringify(runCounts), status, summary);
    return { id: runId, started_at: at, finished_at: finishedAt, source_label: bundle.source_label, files: bundle.files, counts: runCounts, status, summary };
  };

  const ensureHousehold = (): void => {
    db.prepare(
      `INSERT INTO households (id, name, home_timezone, display_timezone, data_label, created_at)
       VALUES (@id, @name, @tz, @tz, @label, @at)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, data_label = excluded.data_label`,
    ).run({ id: hh, name: bundle.household.name, tz: bundle.household.home_timezone, label: bundle.household.data_label, at });
  };

  try {
    // Duplicate ids would make the upsert order-dependent — refuse early.
    const seen = new Set<string>();
    for (const r of bundle.records) {
      if (seen.has(r.id)) throw new Error(`Duplicate record id in bundle: ${r.id}`);
      seen.add(r.id);
      if (r.id !== `${r.type}:${r.key}`) throw new Error(`Record id does not match type:key: ${r.id}`);
    }

    const corrected = applyCorrections(bundle, corrections);
    const ledger = new Set(
      (db.prepare('SELECT correction_id, record_id FROM corrections_applied WHERE household_id = ?').all(hh) as { correction_id: string; record_id: string }[]).map(
        (r) => `${r.correction_id}\u0000${r.record_id}`,
      ),
    );
    const pendingReceipts = corrected.receipts.filter((r) => !ledger.has(`${r.correction_id}\u0000${r.record_id}`));

    const prev = db
      .prepare(`SELECT fileset_sha256 FROM import_runs WHERE household_id = ? AND status != 'failed' ORDER BY started_at DESC, rowid DESC LIMIT 1`)
      .get(hh) as { fileset_sha256: string } | undefined;
    const recordCount = (db.prepare('SELECT COUNT(*) AS n FROM records WHERE household_id = ?').get(hh) as { n: number }).n;

    if (!opts.force && prev && prev.fileset_sha256 === fileset && recordCount > 0 && pendingReceipts.length === 0) {
      let run!: ImportRun;
      db.transaction(() => {
        ensureHousehold();
        run = insertRun('no_changes', 'Identical source files; nothing changed.', { created: 0, updated: 0, kept_local: 0, corrections: 0 }, at);
      })();
      return { run, status: 'no_changes', created: 0, updated: 0, kept_local: 0, corrections: 0, changes: 0, unchanged: recordCount };
    }

    let run!: ImportRun;
    db.transaction(() => {
      ensureHousehold();
      const stmts = prepareStatements(db);
      const change = (record_id: string, kind: string, field: string | null, before: unknown, after: unknown, rationale: string | null, correction_id: string | null = null): void => {
        stmts.insertChange.run(randomUUID(), hh, runId, record_id, kind, field, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), rationale, correction_id);
      };
      const audit = (record_id: string | null, action: string, before: unknown, after: unknown, reason: string | null): void => {
        stmts.insertAudit.run(randomUUID(), hh, at, actor, record_id, action, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), reason);
      };

      // People
      for (const p of corrected.bundle.people) {
        stmts.upsertPerson.run(p.id, hh, p.display_name, p.kind, JSON.stringify(p.aliases ?? []), p.descriptor ?? null, JSON.stringify(p.anchors ?? {}));
      }

      // Records
      const incomingIds = new Set<string>();
      for (const rec of corrected.bundle.records) {
        incomingIds.add(rec.id);
        const source: SourceRef | null = rec.source ? { ...clone(rec.source), import_run_id: runId } : null;
        const existing = stmts.getRecord.get(hh, rec.id) as StoredRow | undefined;
        if (!existing) {
          stmts.insertRecord.run({
            id: rec.id, hh, type: rec.type, key: rec.key, title: rec.title, status: rec.status, owner: rec.owner, owner_proposed: rec.owner_proposed ? 1 : 0,
            visibility: rec.visibility, created_by: rec.created_by ?? 'import', data: JSON.stringify(rec.data), source: source ? JSON.stringify(source) : null, at, actor,
          });
          if (source) stmts.insertSnapshot.run(hh, rec.id, runId, rawHash(source.raw), JSON.stringify(source.raw));
          change(rec.id, 'created', null, null, { title: rec.title, status: rec.status, owner: rec.owner }, 'First import of this record.');
          audit(rec.id, 'import_create', null, { title: rec.title, status: rec.status, owner: rec.owner, owner_proposed: rec.owner_proposed, visibility: rec.visibility, data: rec.data, locally_edited: [] }, 'Created by import');
          counts.created++;
          continue;
        }

        const edited = parse<string[]>(existing.locally_edited, []);
        const storedData = parse<Record<string, unknown>>(existing.data, {});
        const nextData: Record<string, unknown> = { ...storedData };
        const next = { title: existing.title, status: existing.status, owner: existing.owner, owner_proposed: existing.owner_proposed === 1 };
        const beforeState = { title: existing.title, status: existing.status, owner: existing.owner, owner_proposed: existing.owner_proposed === 1, visibility: existing.visibility, data: storedData, locally_edited: edited };
        let touched = false;
        let kept = 0;

        const consider = (path: string, stored: unknown, incoming: unknown, assign: () => void): void => {
          if (deepEqual(stored, incoming)) return;
          if (isEdited(edited, path)) {
            change(rec.id, 'local_kept', path, stored, incoming, 'Kept the in-app edit; the new source value was not applied.');
            counts.kept_local++;
            kept++;
            return;
          }
          assign();
          touched = true;
          change(rec.id, 'source_updated', path, stored, incoming, 'The source value changed.');
        };

        consider('title', existing.title, rec.title, () => { next.title = rec.title; });
        consider('status', existing.status, rec.status, () => { next.status = rec.status; });
        consider('owner', existing.owner, rec.owner, () => { next.owner = rec.owner; });
        consider('owner_proposed', existing.owner_proposed === 1, rec.owner_proposed, () => { next.owner_proposed = rec.owner_proposed; });
        for (const k of new Set([...Object.keys(storedData), ...Object.keys(rec.data)])) {
          const inc = rec.data[k];
          consider(`data.${k}`, storedData[k], inc, () => {
            if (inc === undefined) delete nextData[k];
            else nextData[k] = inc;
          });
        }

        const storedSource = parse<SourceRef | null>(existing.source, null);
        const rawChanged = !!source && rawHash(storedSource?.raw) !== rawHash(source.raw);
        if (touched) {
          stmts.updateRecord.run({
            hh, id: rec.id, title: next.title, status: next.status, owner: next.owner, owner_proposed: next.owner_proposed ? 1 : 0, data: JSON.stringify(nextData),
            source: source ? JSON.stringify(source) : existing.source, at, actor, version: existing.version,
          });
          audit(rec.id, 'import_update', beforeState, { title: next.title, status: next.status, owner: next.owner, owner_proposed: next.owner_proposed, visibility: existing.visibility, data: nextData, locally_edited: edited }, 'Updated by import');
          counts.updated++;
        } else if (rawChanged) {
          stmts.updateSource.run(JSON.stringify(source), hh, rec.id);
        } else if (kept === 0) {
          counts.unchanged++;
        }
        if (rawChanged && source) stmts.insertSnapshot.run(hh, rec.id, runId, rawHash(source.raw), JSON.stringify(source.raw));
      }
      // Items the scope corrections leave out of the plan: an earlier import may have stored them. Remove them (and task
      // links attached to them), keeping the full prior state in the audit log; the source package still holds them.
      const why = new Map(corrected.receipts.filter((r) => r.op === 'exclude' && r.field === null).map((r) => [r.record_id, r.rationale]));
      for (const id of excludedIds(corrected.receipts)) {
        const reason = why.get(id) ?? 'Outside the move.';
        if (id.startsWith('task_link:')) {
          const gone = stmts.getTaskLink.get(hh, id.slice('task_link:'.length)) as { id: string; title: string; status: string } | undefined;
          if (!gone) continue;
          stmts.deleteTaskLink.run(hh, gone.id);
          change(id, 'removed_out_of_scope', null, { title: gone.title, status: gone.status }, null, reason);
          counts.removed++;
          continue;
        }
        const existing = stmts.getRecord.get(hh, id) as StoredRow | undefined;
        if (!existing) continue;
        audit(id, 'import_exclude', { title: existing.title, status: existing.status, owner: existing.owner, data: parse(existing.data, {}) }, null, `Removed: ${reason}`);
        change(id, 'removed_out_of_scope', null, { title: existing.title, status: existing.status }, null, reason);
        stmts.deleteRecord.run(hh, id);
        counts.removed++;
        for (const link of stmts.listTaskLinksFor.all(hh, id) as { id: string; canonical_id: string | null; title: string; status: string }[]) {
          stmts.deleteTaskLink.run(hh, link.id);
          change(`task_link:${link.canonical_id ?? link.id}`, 'removed_out_of_scope', null, { title: link.title, status: link.status }, null, reason);
          counts.removed++;
        }
      }
      counts.missing_from_source = (stmts.listImportedIds.all(hh) as { id: string }[]).filter((r) => !incomingIds.has(r.id)).length;

      // Settings
      applySettings(db, hh, corrected.bundle.settings, (key, kind, before, after, why) => change(`setting:${key}`, kind, key, before, after, why));

      // Task links
      for (const link of corrected.bundle.task_links) applyTaskLink(db, hh, link as unknown as TaskLink, at, counts);

      // Correction receipts, once per (correction, record)
      const grouped = new Map<string, CorrectionReceipt[]>();
      for (const r of pendingReceipts) {
        const key = `${r.correction_id}\u0000${r.record_id}`;
        const list = grouped.get(key) ?? [];
        list.push(r);
        grouped.set(key, list);
      }
      for (const [, list] of grouped) {
        const first = list[0] as CorrectionReceipt;
        for (const r of list) {
          const kind = r.outcome === 'applied' ? 'correction_applied' : 'correction_not_applicable';
          change(r.record_id, kind, r.field, r.before, r.after, r.rationale, r.correction_id);
          if (r.outcome === 'applied') {
            counts.corrections++;
            audit(r.record_id.startsWith('setting:') ? null : r.record_id, 'correction', r.before ?? null, r.after ?? null, `${r.correction_id}: ${r.rationale}`);
          } else {
            counts.not_applicable++;
          }
        }
        stmts.insertLedger.run(hh, first.correction_id, first.record_id, at, runId);
      }

      const changes = counts.created + counts.updated + counts.kept_local + counts.corrections;
      const summary =
        `Created ${counts.created}, updated ${counts.updated}, kept ${counts.kept_local} local edit(s), applied ${counts.corrections} correction(s)` +
        `${counts.removed ? `, removed ${counts.removed} item(s) outside the move` : ''}; ${counts.unchanged} unchanged.`;
      run = insertRun('completed', summary, { created: counts.created, updated: counts.updated, kept_local: counts.kept_local, corrections: counts.corrections, unchanged: counts.unchanged, not_applicable: counts.not_applicable, task_links_created: counts.task_links_created, task_links_updated: counts.task_links_updated, missing_from_source: counts.missing_from_source, removed: counts.removed }, new Date().toISOString());
      void changes;
    })();

    return {
      run, status: 'completed', created: counts.created, updated: counts.updated, kept_local: counts.kept_local, corrections: counts.corrections,
      changes: counts.created + counts.updated + counts.kept_local + counts.corrections + counts.removed, unchanged: counts.unchanged, removed: counts.removed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let run: ImportRun;
    try {
      db.transaction(() => {
        ensureHousehold();
      })();
      run = insertRun('failed', `Import failed: ${message}`, {}, new Date().toISOString());
    } catch {
      run = { id: runId, started_at: at, finished_at: new Date().toISOString(), source_label: bundle.source_label, files: bundle.files, counts: {}, status: 'failed', summary: `Import failed: ${message}` };
    }
    return { run, status: 'failed', created: 0, updated: 0, kept_local: 0, corrections: 0, changes: 0, unchanged: 0, error: message };
  }
}

function prepareStatements(db: Db) {
  return {
    getRecord: db.prepare('SELECT * FROM records WHERE household_id = ? AND id = ?'),
    deleteRecord: db.prepare('DELETE FROM records WHERE household_id = ? AND id = ?'),
    getTaskLink: db.prepare('SELECT id, title, status FROM task_links WHERE household_id = ? AND canonical_id = ?'),
    listTaskLinksFor: db.prepare('SELECT id, canonical_id, title, status FROM task_links WHERE household_id = ? AND record_id = ?'),
    deleteTaskLink: db.prepare('DELETE FROM task_links WHERE household_id = ? AND id = ?'),
    listImportedIds: db.prepare(`SELECT id FROM records WHERE household_id = ? AND created_by = 'import'`),
    insertRecord: db.prepare(
      `INSERT INTO records (id, household_id, type, key, title, status, owner, owner_proposed, visibility, created_by, data, source, locally_edited, version, created_at, updated_at, updated_by)
       VALUES (@id, @hh, @type, @key, @title, @status, @owner, @owner_proposed, @visibility, @created_by, @data, @source, '[]', 1, @at, @at, @actor)`,
    ),
    updateRecord: db.prepare(
      `UPDATE records SET title = @title, status = @status, owner = @owner, owner_proposed = @owner_proposed, data = @data, source = @source,
              version = version + 1, updated_at = @at, updated_by = @actor
        WHERE household_id = @hh AND id = @id AND version = @version`,
    ),
    updateSource: db.prepare('UPDATE records SET source = ? WHERE household_id = ? AND id = ?'),
    insertSnapshot: db.prepare('INSERT OR REPLACE INTO source_snapshots (household_id, record_id, import_run_id, raw_sha256, raw) VALUES (?, ?, ?, ?, ?)'),
    insertChange: db.prepare(
      `INSERT INTO import_changes (id, household_id, import_run_id, record_id, change, field, before, after, rationale, correction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertAudit: db.prepare(
      `INSERT INTO audit_log (id, household_id, at, actor, record_id, action, before, after, reason, undone_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ),
    insertLedger: db.prepare('INSERT OR IGNORE INTO corrections_applied (household_id, correction_id, record_id, applied_at, import_run_id) VALUES (?, ?, ?, ?, ?)'),
    upsertPerson: db.prepare(
      `INSERT INTO people (id, household_id, display_name, kind, aliases, descriptor, anchors) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, id) DO UPDATE SET display_name = excluded.display_name, kind = excluded.kind, aliases = excluded.aliases, descriptor = excluded.descriptor, anchors = excluded.anchors`,
    ),
  };
}

function applySettings(
  db: Db,
  hh: string,
  incoming: Partial<HouseholdSettings>,
  log: (key: string, kind: string, before: unknown, after: unknown, why: string) => void,
): void {
  const get = db.prepare('SELECT value FROM settings WHERE household_id = ? AND key = ?');
  const put = db.prepare(
    `INSERT INTO settings (household_id, key, value) VALUES (?, ?, ?) ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value`,
  );
  const extraKeys = Object.keys(incoming).filter((k) => !(SETTING_KEYS as readonly string[]).includes(k));
  for (const key of [...SETTING_KEYS, ...extraKeys]) {
    const value = (incoming as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const stored = get.get(hh, key) as { value: string } | undefined;
    const baseline = get.get(hh, `_import.${key}`) as { value: string } | undefined;
    const json = JSON.stringify(value);
    if (!stored) {
      put.run(hh, key, json);
      put.run(hh, `_import.${key}`, json);
      log(key, 'created', null, value, 'First import of this setting.');
      continue;
    }
    if (deepEqual(parse(stored.value, null), value)) {
      put.run(hh, `_import.${key}`, json);
      continue;
    }
    const editedInApp = baseline ? !deepEqual(parse(stored.value, null), parse(baseline.value, null)) : false;
    if (editedInApp) {
      log(key, 'local_kept', parse(stored.value, null), value, 'Kept the in-app setting; the new source value was not applied.');
      continue;
    }
    put.run(hh, key, json);
    put.run(hh, `_import.${key}`, json);
    log(key, 'source_updated', parse(stored.value, null), value, 'The source value changed.');
  }
}

function applyTaskLink(
  db: Db,
  hh: string,
  link: TaskLink,
  at: string,
  counts: { task_links_created: number; task_links_updated: number },
): void {
  const existing = (link.canonical_id
    ? db.prepare('SELECT * FROM task_links WHERE household_id = ? AND adapter = ? AND canonical_id = ?').get(hh, link.adapter, link.canonical_id)
    : db.prepare('SELECT * FROM task_links WHERE household_id = ? AND id = ?').get(hh, link.id)) as Record<string, unknown> | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO task_links (id, household_id, adapter, canonical_id, record_id, title, status, due, due_basis, owner, notes, proposal_note, sync_state, last_synced_at, last_error, remote_revision, version, created_at, updated_at)
       VALUES (@id, @hh, @adapter, @canonical_id, @record_id, @title, @status, @due, @due_basis, @owner, @notes, @proposal_note, @sync_state, @last_synced_at, @last_error, @remote_revision, 1, @at, @at)`,
    ).run({ ...link, hh, at, canonical_id: link.canonical_id ?? null, record_id: link.record_id ?? null, due: link.due ?? null, owner: link.owner ?? null, notes: link.notes ?? null, proposal_note: link.proposal_note ?? null, last_synced_at: link.last_synced_at ?? null, last_error: link.last_error ?? null, remote_revision: link.remote_revision ?? null });
    counts.task_links_created++;
    return;
  }
  // Only a read-only snapshot is owned by the source; fixture/script links belong to their adapter.
  if (link.adapter !== 'snapshot' || existing.sync_state !== 'snapshot') return;
  const diffs = SNAPSHOT_LINK_FIELDS.filter((f) => !deepEqual(existing[f] ?? null, (link as unknown as Record<string, unknown>)[f] ?? null));
  if (diffs.length === 0) return;
  db.prepare(
    `UPDATE task_links SET title = @title, status = @status, due = @due, due_basis = @due_basis, owner = @owner, notes = @notes, proposal_note = @proposal_note,
            record_id = @record_id, version = version + 1, updated_at = @at WHERE household_id = @hh AND id = @id`,
  ).run({ hh, id: existing.id, at, title: link.title, status: link.status, due: link.due ?? null, due_basis: link.due_basis, owner: link.owner ?? null, notes: link.notes ?? null, proposal_note: link.proposal_note ?? null, record_id: link.record_id ?? null });
  counts.task_links_updated++;
}

