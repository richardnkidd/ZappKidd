import { describe, expect, it } from 'vitest';
import { applyCorrections, excludedIds, parseCorrectionFile, type Correction } from '../../src/import/corrections';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import type { ImportBundle } from '../../src/shared/types';

// Scope exclusion: an item outside the move is left out of the import entirely, and nothing is left pointing at it.

const find = (b: ImportBundle, id: string) => b.records.find((r) => r.id === id);
const data = (b: ImportBundle, id: string) => find(b, id)?.data as Record<string, unknown> | undefined;

function scope(ops: Correction['ops'], id = 'T-SCOPE'): Correction {
  return { id, title: 'move-only scope', rationale: 'Outside the move.', ops };
}

describe('exclude op', () => {
  it('leaves the record out with a receipt that names what it was', () => {
    const { bundle, receipts } = applyCorrections(buildDemoBundle(), [scope([{ op: 'exclude', record: 'milestone:W23', reason: 'Not part of the move.' }])]);
    expect(find(bundle, 'milestone:W23')).toBeUndefined();
    const r = receipts.find((x) => x.record_id === 'milestone:W23' && x.field === null);
    expect(r).toMatchObject({ op: 'exclude', outcome: 'applied', after: null, rationale: 'Not part of the move.' });
    expect((r?.before as { title: string }).title).toBeTruthy();
    expect(excludedIds(receipts)).toContain('milestone:W23');
  });

  it('is not applicable (and harmless) for a record that does not exist', () => {
    const { receipts } = applyCorrections(buildDemoBundle(), [scope([{ op: 'exclude', record: 'milestone:W99', reason: 'x' }])]);
    expect(receipts[0]).toMatchObject({ outcome: 'not_applicable', record_id: 'milestone:W99' });
  });

  it('drops task links attached to an excluded record, and can exclude a task link on its own', () => {
    const { bundle, receipts } = applyCorrections(buildDemoBundle(), [
      scope([
        { op: 'exclude', record: 'milestone:W23', reason: 'x' },
        { op: 'exclude', record: 'task_link:FX-0003', reason: 'Not part of the move.' },
      ]),
    ]);
    expect(bundle.task_links.map((l) => l.canonical_id)).toEqual(['FX-0001']);
    expect(excludedIds(receipts)).toEqual(expect.arrayContaining(['task_link:FX-0002', 'task_link:FX-0003']));
  });

  it('removes links to it from lists, maps, single reference fields and settings', () => {
    const base = buildDemoBundle();
    const w03 = data(base, 'milestone:W03')!;
    w03.dependency_scope = { W02: ['avery'], W06: ['jun'] };
    const { bundle } = applyCorrections(base, [scope([{ op: 'exclude', record: 'milestone:W02', reason: 'x' }, { op: 'exclude', record: 'workstream:S05', reason: 'x' }])]);
    const after = data(bundle, 'milestone:W03')!;
    expect(after.dependencies).toEqual(['W01', 'W06']);
    expect(after.dependency_scope).toEqual({ W06: ['jun'] });
    expect(data(bundle, 'milestone:W05')!.workstream_key).toBeNull();
    const gates = bundle.settings.traveler_gates ?? [];
    for (const g of gates) expect(g.required_before_departure).not.toContain('W02');
  });

  it('drops list entries that identify an excluded record instead of leaving a blank', () => {
    const base = buildDemoBundle();
    const { bundle } = applyCorrections(base, [scope([{ op: 'exclude', record: 'milestone:W18', reason: 'x' }])]);
    for (const g of bundle.settings.traveler_gates ?? []) {
      for (const c of g.conditional ?? []) expect(c.key).not.toBeNull();
      expect((g.conditional ?? []).map((c) => c.key)).not.toContain('W18');
    }
  });

  it('removes an excluded record even if a later correction re-creates it', () => {
    const { bundle } = applyCorrections(buildDemoBundle(), [
      scope([{ op: 'exclude', record: 'decision:D99', reason: 'x' }]),
      { id: 'T-LATER', title: 'later', rationale: 'r', ops: [{ op: 'create', record: { type: 'decision', key: 'D99', title: 'Recreated', status: 'open' } }] },
      scope([{ op: 'exclude', record: 'decision:D99', reason: 'x' }], 'T-SCOPE-2'),
    ]);
    expect(find(bundle, 'decision:D99')).toBeUndefined();
  });

  it('keeps a key in link lists when another remaining record uses the same key', () => {
    const base = buildDemoBundle();
    const w01 = find(base, 'milestone:W01')!;
    base.records.push({ ...structuredClone(w01), id: 'note:W01', type: 'note' as never, data: {} });
    const { bundle } = applyCorrections(base, [scope([{ op: 'exclude', record: 'note:W01', reason: 'x' }])]);
    expect(data(bundle, 'milestone:W02')!.dependencies).toContain('W01');
  });

  it('never edits source values', () => {
    const base = buildDemoBundle();
    const before = JSON.stringify(base.records.map((r) => r.source));
    const { bundle } = applyCorrections(base, [scope([{ op: 'exclude', record: 'milestone:W02', reason: 'x' }])]);
    const kept = base.records.filter((r) => r.id !== 'milestone:W02').map((r) => r.source);
    expect(JSON.stringify(bundle.records.map((r) => r.source))).toBe(JSON.stringify(kept));
    expect(JSON.stringify(base.records.map((r) => r.source))).toBe(before);
  });
});

describe('exclude in correction files', () => {
  it('needs a record and a reason', () => {
    expect(() => parseCorrectionFile(JSON.stringify({ corrections: [{ id: 'X', ops: [{ op: 'exclude', record: 'milestone:W01' }] }] }), 'f.json')).toThrow(/reason/);
    const ok = parseCorrectionFile(JSON.stringify({ corrections: [{ id: 'X', ops: [{ op: 'exclude', record: 'milestone:W01', reason: 'Outside the move.' }] }] }), 'f.json');
    expect(ok[0]!.ops![0]).toMatchObject({ op: 'exclude', record: 'milestone:W01' });
  });
});
