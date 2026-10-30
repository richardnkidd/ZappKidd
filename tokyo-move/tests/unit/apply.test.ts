import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../src/server/db/db';
import { applyBundle, filesetSha256 } from '../../src/import/apply';
import type { Correction } from '../../src/import/corrections';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import type { ImportBundle, MilestoneData } from '../../src/shared/types';

const HH = 'demo-household';
const T0 = new Date('2026-10-29T12:00:00Z');
const T1 = new Date('2026-10-30T12:00:00Z');
const T2 = new Date('2026-10-31T12:00:00Z');

function scalar(db: Db, sql: string, ...args: unknown[]): number {
  return (db.prepare(sql).get(...args) as { n: number }).n;
}

function newVersion(bundle: ImportBundle, tag: string): ImportBundle {
  const b = structuredClone(bundle);
  b.files = [{ name: 'demo-plan.json', sha256: `changed-${tag}`, bytes: 1 }];
  return b;
}

function milestone(bundle: ImportBundle, key: string) {
  const rec = bundle.records.find((r) => r.id === `milestone:${key}`);
  if (!rec) throw new Error(`no ${key}`);
  return rec;
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('applyBundle: first import', () => {
  it('creates everything with receipts, snapshots, audit rows, people, settings and task links', () => {
    const bundle = buildDemoBundle();
    const res = applyBundle(db, bundle, { now: T0 });
    expect(res.status).toBe('completed');
    expect(res.created).toBe(bundle.records.length);
    expect(res.updated).toBe(0);
    expect(res.run.status).toBe('completed');
    expect(res.run.files).toEqual(bundle.files);

    expect(scalar(db, 'SELECT COUNT(*) AS n FROM records WHERE household_id = ?', HH)).toBe(bundle.records.length);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM import_changes WHERE import_run_id = ? AND change = 'created' AND record_id NOT LIKE 'setting:%'", res.run.id)).toBe(bundle.records.length);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM import_changes WHERE import_run_id = ? AND change = 'created' AND record_id LIKE 'setting:%'", res.run.id)).toBe(4);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM source_snapshots WHERE import_run_id = ?', res.run.id)).toBe(bundle.records.length);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'import_create'")).toBe(bundle.records.length);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM people WHERE household_id = ?', HH)).toBe(3);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM task_links WHERE household_id = ?', HH)).toBe(bundle.task_links.length);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM households WHERE id = ?', HH)).toBe(1);

    const gates = db.prepare("SELECT value FROM settings WHERE household_id = ? AND key = 'traveler_gates'").get(HH) as { value: string };
    expect(JSON.parse(gates.value)).toHaveLength(3);
    const row = db.prepare("SELECT * FROM records WHERE id = 'milestone:W45'").get();
    expect(row).toBeUndefined();
    const w02 = db.prepare("SELECT * FROM records WHERE household_id = ? AND id = 'milestone:W02'").get(HH) as { source: string; version: number; created_by: string };
    expect(w02.version).toBe(1);
    expect(w02.created_by).toBe('import');
    expect(JSON.parse(w02.source).import_run_id).toBe(res.run.id);
  });

  it('uses the sorted-file-hash idempotency key', () => {
    const bundle = buildDemoBundle();
    const res = applyBundle(db, bundle, { now: T0 });
    const stored = db.prepare('SELECT fileset_sha256 FROM import_runs WHERE id = ?').get(res.run.id) as { fileset_sha256: string };
    expect(stored.fileset_sha256).toBe(filesetSha256(bundle.files));
    expect(filesetSha256([{ sha256: 'b' }, { sha256: 'a' }])).toBe(filesetSha256([{ sha256: 'a' }, { sha256: 'b' }]));
  });
});

describe('applyBundle: idempotency', () => {
  it('a second identical import writes only a run row and reports no_changes', () => {
    const bundle = buildDemoBundle();
    applyBundle(db, bundle, { now: T0 });
    const before = {
      records: scalar(db, 'SELECT COUNT(*) AS n FROM records'),
      changes: scalar(db, 'SELECT COUNT(*) AS n FROM import_changes'),
      audit: scalar(db, 'SELECT COUNT(*) AS n FROM audit_log'),
      snapshots: scalar(db, 'SELECT COUNT(*) AS n FROM source_snapshots'),
      links: scalar(db, 'SELECT COUNT(*) AS n FROM task_links'),
    };
    const second = applyBundle(db, buildDemoBundle(), { now: T1 });
    expect(second.status).toBe('no_changes');
    expect(second.run.status).toBe('no_changes');
    expect(second.created).toBe(0);
    expect(second.changes).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM records')).toBe(before.records);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM import_changes')).toBe(before.changes);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM audit_log')).toBe(before.audit);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM source_snapshots')).toBe(before.snapshots);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM task_links')).toBe(before.links);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM import_runs')).toBe(2);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM import_runs WHERE status = 'no_changes'")).toBe(1);
    expect(scalar(db, 'SELECT MAX(version) AS n FROM records')).toBe(1);
  });

  it('force re-diffs without duplicating anything', () => {
    const bundle = buildDemoBundle();
    applyBundle(db, bundle, { now: T0 });
    const forced = applyBundle(db, buildDemoBundle(), { now: T1, force: true });
    expect(forced.status).toBe('completed');
    expect(forced.created).toBe(0);
    expect(forced.updated).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM records')).toBe(bundle.records.length);
  });

  it('a different fileset after a no_changes run still applies', () => {
    const bundle = buildDemoBundle();
    applyBundle(db, bundle, { now: T0 });
    applyBundle(db, bundle, { now: T1 });
    const changed = newVersion(bundle, 'x');
    milestone(changed, 'W02').data.next_action = 'A new next action from the source.';
    const res = applyBundle(db, changed, { now: T2 });
    expect(res.status).toBe('completed');
    expect(res.updated).toBe(1);
  });
});

describe('applyBundle: new source version', () => {
  it('updates fields that were not edited in-app and keeps locally edited ones', () => {
    const bundle = buildDemoBundle();
    applyBundle(db, bundle, { now: T0 });

    // Someone edits W04's next_action in the app (the server records the field path in locally_edited).
    const w04 = db.prepare("SELECT data FROM records WHERE id = 'milestone:W04'").get() as { data: string };
    const data = JSON.parse(w04.data) as MilestoneData;
    data.next_action = 'Our own wording.';
    db.prepare("UPDATE records SET data = ?, locally_edited = ?, version = version + 1 WHERE id = 'milestone:W04'").run(JSON.stringify(data), JSON.stringify(['data.next_action']));

    const next = newVersion(bundle, '2');
    milestone(next, 'W02').data.next_action = 'Updated by the source.';
    milestone(next, 'W04').data.next_action = 'Source wording changed too.';
    milestone(next, 'W04').data.target_window = 'Changed window.';
    milestone(next, 'W02').title = 'Renamed in the source';

    const res = applyBundle(db, next, { now: T1 });
    expect(res.status).toBe('completed');
    expect(res.updated).toBe(2);
    expect(res.kept_local).toBe(1);

    const w02 = db.prepare("SELECT title, data, version FROM records WHERE id = 'milestone:W02'").get() as { title: string; data: string; version: number };
    expect(w02.title).toBe('Renamed in the source');
    expect((JSON.parse(w02.data) as MilestoneData).next_action).toBe('Updated by the source.');
    expect(w02.version).toBe(2);

    const w04After = db.prepare("SELECT data FROM records WHERE id = 'milestone:W04'").get() as { data: string };
    const after = JSON.parse(w04After.data) as MilestoneData;
    expect(after.next_action).toBe('Our own wording.'); // kept
    expect(after.target_window).toBe('Changed window.'); // not edited, so it takes the source value

    const kept = db.prepare("SELECT field, before, after FROM import_changes WHERE import_run_id = ? AND change = 'local_kept'").all(res.run.id) as { field: string; before: string; after: string }[];
    expect(kept).toHaveLength(1);
    expect(kept[0]?.field).toBe('data.next_action');
    expect(JSON.parse(kept[0]?.after ?? 'null')).toBe('Source wording changed too.');
    expect(scalar(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'import_update'")).toBe(2);
    // a snapshot of the changed raw source is stored per changed record only when the raw changed
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM records')).toBe(bundle.records.length);
  });

  it('stores a new raw snapshot only for records whose raw source changed', () => {
    const bundle = buildDemoBundle();
    applyBundle(db, bundle, { now: T0 });
    const next = newVersion(bundle, '3');
    const rec = milestone(next, 'W06');
    rec.source = rec.source && { ...rec.source, raw: { ...rec.source.raw, Status: 'Changed in workbook' } };
    const res = applyBundle(db, next, { now: T1 });
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM source_snapshots WHERE import_run_id = ?', res.run.id)).toBe(1);
  });

  it('keeps an in-app setting change and counts task link fixtures as adapter-owned', () => {
    const bundle = buildDemoBundle();
    applyBundle(db, bundle, { now: T0 });
    db.prepare("UPDATE settings SET value = ? WHERE household_id = ? AND key = 'jp_holidays'").run(JSON.stringify(['2027-01-01']), HH);
    db.prepare("UPDATE task_links SET title = 'Edited by the adapter' WHERE canonical_id = 'FX-0001'").run();
    const next = newVersion(bundle, '4');
    next.settings = { ...next.settings, jp_holidays: ['2027-02-11'], plan_baseline: { baseline_on: '2026-10-02', reviewed_on: '2026-10-21', source_label: 'Fictional demo' } };
    next.task_links = next.task_links.map((l) => ({ ...l, title: 'Source title' }));
    applyBundle(db, next, { now: T1 });
    const hol = db.prepare("SELECT value FROM settings WHERE household_id = ? AND key = 'jp_holidays'").get(HH) as { value: string };
    expect(JSON.parse(hol.value)).toEqual(['2027-01-01']);
    const base = db.prepare("SELECT value FROM settings WHERE household_id = ? AND key = 'plan_baseline'").get(HH) as { value: string };
    expect(JSON.parse(base.value).baseline_on).toBe('2026-10-02');
    const link = db.prepare("SELECT title FROM task_links WHERE canonical_id = 'FX-0001'").get() as { title: string };
    expect(link.title).toBe('Edited by the adapter');
  });
});

describe('applyBundle: corrections', () => {
  const corrections: Correction[] = [
    {
      id: 'T-001',
      title: 'Test correction',
      rationale: 'Because the reviewers said so.',
      ops: [
        { op: 'set', record: 'milestone:W10', path: 'data.priority', value: 'later' },
        { op: 'remove', record: 'milestone:W03', path: 'data.dependencies', value: 'W06' },
        { op: 'replace_text', record: 'milestone:W10', path: 'data.next_action', find: 'text that is not there', replace: 'x' },
      ],
    },
  ];

  it('applies once per (correction, record) with a receipt and survives re-import without repeating', () => {
    const bundle = buildDemoBundle();
    const first = applyBundle(db, bundle, { now: T0, corrections });
    expect(first.corrections).toBe(2);
    const w10 = db.prepare("SELECT data FROM records WHERE id = 'milestone:W10'").get() as { data: string };
    expect((JSON.parse(w10.data) as MilestoneData).priority).toBe('later');
    const w03 = db.prepare("SELECT data FROM records WHERE id = 'milestone:W03'").get() as { data: string };
    expect((JSON.parse(w03.data) as MilestoneData).dependencies).toEqual(['W01', 'W02']);
    // the preserved raw source is untouched
    const src = db.prepare("SELECT source FROM records WHERE id = 'milestone:W10'").get() as { source: string };
    expect(JSON.parse(src.source).raw.Status).toBe('In progress');

    const applied = db.prepare("SELECT record_id, field, before, after, correction_id FROM import_changes WHERE change = 'correction_applied'").all() as { record_id: string; field: string; before: string; after: string; correction_id: string }[];
    expect(applied).toHaveLength(2);
    const dep = applied.find((a) => a.record_id === 'milestone:W03');
    expect(JSON.parse(dep?.before ?? 'null')).toEqual(['W01', 'W02', 'W06']);
    expect(JSON.parse(dep?.after ?? 'null')).toEqual(['W01', 'W02']);
    expect(dep?.correction_id).toBe('T-001');
    // missing text is a receipt, not a failure
    expect(scalar(db, "SELECT COUNT(*) AS n FROM import_changes WHERE change = 'correction_not_applicable'")).toBe(1);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM corrections_applied')).toBe(2);

    // identical import: nothing at all
    const again = applyBundle(db, buildDemoBundle(), { now: T1, corrections });
    expect(again.status).toBe('no_changes');

    // a NEW source version: the correction still holds in stored state, but no new receipts are written
    const next = newVersion(bundle, 'c');
    milestone(next, 'W02').data.next_action = 'Source changed.';
    const third = applyBundle(db, next, { now: T2, corrections });
    expect(third.status).toBe('completed');
    expect(third.corrections).toBe(0);
    expect(third.updated).toBe(1); // only W02; the corrected fields do not flip back and forth
    const w10b = db.prepare("SELECT data, version FROM records WHERE id = 'milestone:W10'").get() as { data: string; version: number };
    expect((JSON.parse(w10b.data) as MilestoneData).priority).toBe('later');
    expect(w10b.version).toBe(1);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM import_changes WHERE change = 'correction_applied'")).toBe(2);
  });

  it('a newly added correction applies even when the source files are identical', () => {
    const bundle = buildDemoBundle();
    applyBundle(db, bundle, { now: T0, corrections: [] });
    const res = applyBundle(db, buildDemoBundle(), { now: T1, corrections });
    expect(res.status).toBe('completed');
    expect(res.corrections).toBe(2);
    const w10 = db.prepare("SELECT data, version FROM records WHERE id = 'milestone:W10'").get() as { data: string; version: number };
    expect((JSON.parse(w10.data) as MilestoneData).priority).toBe('later');
    expect(w10.version).toBe(2);
  });

  it('supports create and setting ops', () => {
    const extra: Correction[] = [
      {
        id: 'T-002', title: 'Create and configure', rationale: 'Adds a rule and a setting.',
        ops: [
          { op: 'create', record: { type: 'deadline_rule', key: 'RULE-TEST', title: 'Test rule', status: 'active', data: { label: 'Test rule' } } },
          { op: 'setting', key: 'jp_holidays', value: ['2027-01-01'] },
        ],
      },
    ];
    const res = applyBundle(db, buildDemoBundle(), { now: T0, corrections: extra });
    expect(res.corrections).toBe(2);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM records WHERE id = 'deadline_rule:RULE-TEST'")).toBe(1);
    const hol = db.prepare("SELECT value FROM settings WHERE household_id = ? AND key = 'jp_holidays'").get(HH) as { value: string };
    expect(JSON.parse(hol.value)).toEqual(['2027-01-01']);
  });
});

describe('applyBundle: failure', () => {
  it('rolls back and records a failed run when the bundle is invalid', () => {
    const bundle = buildDemoBundle();
    bundle.records.push(structuredClone(bundle.records[0]!));
    const res = applyBundle(db, bundle, { now: T0 });
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/Duplicate record id/);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM records')).toBe(0);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM import_runs WHERE status = 'failed'")).toBe(1);
  });
});
