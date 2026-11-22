import { buildDemoBundle } from '../../fixtures/demo/bundle';
import type { BaseRecord, ImportBundle, Person } from '../../src/shared/types';

export function toBaseRecords(bundle: ImportBundle): BaseRecord[] {
  return bundle.records.map((r) => ({
    ...structuredClone(r),
    household_id: bundle.household.id,
    version: 1,
    created_at: '2026-10-29T00:00:00Z',
    updated_at: '2026-10-29T00:00:00Z',
    updated_by: 'import',
  })) as BaseRecord[];
}

export function toPeople(bundle: ImportBundle): Person[] {
  return bundle.people.map((p) => ({ ...structuredClone(p), household_id: bundle.household.id }));
}

export function demo() {
  const bundle = buildDemoBundle();
  return { bundle, records: toBaseRecords(bundle), people: toPeople(bundle) };
}

/** Return a copy of the records with `mutate` applied to the record `id`. */
export function patch(records: BaseRecord[], id: string, mutate: (r: BaseRecord) => void): BaseRecord[] {
  const copy = structuredClone(records);
  const rec = copy.find((r) => r.id === id);
  if (!rec) throw new Error(`no record ${id}`);
  mutate(rec);
  return copy;
}

export function setAnchor(records: BaseRecord[], code: string, date: string | null, confidence?: string): BaseRecord[] {
  return patch(records, `anchor:${code}`, (r) => {
    (r.data as Record<string, unknown>).date = date;
    if (confidence) (r.data as Record<string, unknown>).confidence = confidence;
  });
}
