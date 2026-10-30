import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readOverrides } from '../../src/import/sidecars';

const dir = mkdtempSync(join(tmpdir(), 'kadode-overrides-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function overrides(json: unknown): ReturnType<typeof readOverrides> {
  const path = join(dir, `o-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(json));
  return readOverrides(path);
}

describe('household overrides: planning_target', () => {
  it('reads a civil date, a label and an optional note', () => {
    expect(overrides({ planning_target: { date: '2027-07-01', label: ' July 2027 ', note: ' Aiming for early July. ' } }).planning_target).toEqual({
      date: '2027-07-01',
      label: 'July 2027',
      note: 'Aiming for early July.',
    });
    expect(overrides({ planning_target: { date: '2027-07-01', label: 'July 2027' } }).planning_target).toEqual({ date: '2027-07-01', label: 'July 2027' });
  });

  it('ignores anything that is not a real date with a label (a month word or a bad day is not a date)', () => {
    for (const planning_target of [null, 'July 2027', [], {}, { label: 'July 2027' }, { date: '2027-07-01' }, { date: '2027-07', label: 'July 2027' }, { date: '2027-02-30', label: 'February' }, { date: '2027-07-01', label: '   ' }]) {
      expect(overrides({ planning_target }).planning_target, JSON.stringify(planning_target)).toBeUndefined();
    }
    expect(overrides({}).planning_target).toBeUndefined();
  });
});
