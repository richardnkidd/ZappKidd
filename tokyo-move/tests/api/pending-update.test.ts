/** "A newer private update is waiting": local modes only, a count and nothing else. Folders here are temporary and invented. */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedOverlayCount, currentOverlayFiles, pendingUpdate } from '../../src/server/domain/pending-update';
import type { Deps } from '../../src/server/context';
import type { ImportRun } from '../../src/shared/types';
import { loginAs, makeHarness, type Harness } from './helpers';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const roots: string[] = [];
const open: Harness[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** <root>/private/data is the data folder, so <root>/private is the private folder the overlay files live in. */
function privateFolder() {
  const root = mkdtempSync(join(tmpdir(), 'kadode-pending-'));
  roots.push(root);
  const priv = join(root, 'private');
  const data = join(priv, 'data');
  mkdirSync(data, { recursive: true });
  return { priv, data };
}
const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

/** Record an import run that read these overlay files (name -> text), newer than the seeded one. */
function recordRun(h: Harness, files: Record<string, string>, status: ImportRun['status'] = 'completed') {
  h.db
    .prepare(
      `INSERT INTO import_runs (id, household_id, started_at, finished_at, source_label, files, fileset_sha256, counts, status, summary)
       VALUES (?, 'demo-household', '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:01.000Z', 'test', ?, ?, '{}', ?, '')`,
    )
    .run(`run-test-${Math.random().toString(36).slice(2)}`, JSON.stringify(Object.entries(files).map(([name, text]) => ({ name, sha256: sha(text), bytes: text.length }))), sha(JSON.stringify(files)), status);
}

async function snapshotOf(h: Harness) {
  const c = await loginAs(h, 'avery');
  return (await c.get('/api/snapshot')).body;
}

describe('pending update notice', () => {
  it('counts the overlay files that are new or different from what the last import read', async () => {
    const { priv, data } = privateFolder();
    const h = await makeHarness({ dir: data });
    open.push(h);
    recordRun(h, { 'corrections/a.json': '{"a":1}', 'corrections/same.json': '{"s":1}', 'household-overrides.json': '{"people":{}}' });
    put(join(priv, 'corrections', 'a.json'), '{"a":2}'); // changed
    put(join(priv, 'corrections', 'same.json'), '{"s":1}'); // unchanged
    put(join(priv, 'corrections', 'b.json'), '{"b":1}'); // new
    put(join(priv, 'corrections', 'notes.txt'), 'not a correction file'); // ignored
    put(join(priv, 'household-overrides.json'), '{"people":{}}'); // unchanged
    const snap = await snapshotOf(h);
    expect(snap.pending_update).toEqual({ changed: 2 });
    // Only a count: no file name or content is part of the notice.
    expect(JSON.stringify(snap.pending_update)).not.toMatch(/a\.json|b\.json|same|people/);
  });

  it('says nothing when every file is what the last import read', async () => {
    const { priv, data } = privateFolder();
    const h = await makeHarness({ dir: data });
    open.push(h);
    recordRun(h, { 'corrections/a.json': '{"a":1}', 'household-overrides.json': '{"people":{}}' });
    put(join(priv, 'corrections', 'a.json'), '{"a":1}');
    put(join(priv, 'household-overrides.json'), '{"people":{}}');
    const snap = await snapshotOf(h);
    expect('pending_update' in snap).toBe(false);
  });

  it('says nothing, and does not fail, when the private folder or its parts are missing', async () => {
    const { data } = privateFolder(); // <root>/private exists only because data is inside it; no corrections, no overrides
    const h = await makeHarness({ dir: data });
    open.push(h);
    recordRun(h, { 'corrections/a.json': '{"a":1}', 'household-overrides.json': '{}' });
    expect('pending_update' in (await snapshotOf(h))).toBe(false);

    // A data folder whose parent has nothing at all (and a path that does not exist).
    const lone = mkdtempSync(join(tmpdir(), 'kadode-lone-'));
    roots.push(lone);
    expect(currentOverlayFiles(join(lone, 'does-not-exist')).size).toBe(0);
    expect(currentOverlayFiles(lone).size).toBe(0);
  });

  it('ignores a failed import, and an install that has never imported', () => {
    const files = new Map([['corrections/a.json', sha('x')]]);
    const run = (status: ImportRun['status']): ImportRun => ({ id: 'r', started_at: '', finished_at: '', source_label: '', files: [], counts: {}, status, summary: '' });
    const { priv, data } = privateFolder();
    put(join(priv, 'corrections', 'a.json'), 'x');
    const deps = (mode: string) => ({ config: { mode, dataDir: data } }) as unknown as Deps;
    expect(pendingUpdate(deps('local'), null)).toBeNull();
    expect(pendingUpdate(deps('local'), run('failed'))).toBeNull();
    expect(pendingUpdate(deps('local'), run('completed'))).toEqual({ changed: 1 });
    expect(pendingUpdate(deps('local-demo'), run('no_changes'))).toEqual({ changed: 1 });
    expect(changedOverlayCount(run('completed'), files)).toBe(1);
  });

  it('is never shown in staging or production, even when files differ', () => {
    const { priv, data } = privateFolder();
    put(join(priv, 'corrections', 'a.json'), 'x');
    const run: ImportRun = { id: 'r', started_at: '', finished_at: '', source_label: '', files: [], counts: {}, status: 'completed', summary: '' };
    for (const mode of ['staging', 'production']) expect(pendingUpdate({ config: { mode, dataDir: data } } as unknown as Deps, run), mode).toBeNull();
  });

  it('notices an edit that keeps the same size, because it is keyed on the file’s modification time', () => {
    const { priv, data } = privateFolder();
    const file = join(priv, 'household-overrides.json');
    put(file, 'aaaa');
    const run: ImportRun = { id: 'r', started_at: '', finished_at: '', source_label: '', files: [{ name: 'household-overrides.json', sha256: sha('aaaa'), bytes: 4 }], counts: {}, status: 'completed', summary: '' };
    const deps = { config: { mode: 'local', dataDir: data } } as unknown as Deps;
    expect(pendingUpdate(deps, run)).toBeNull();
    put(file, 'bbbb');
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    expect(pendingUpdate(deps, run)).toEqual({ changed: 1 });
    put(file, 'aaaa'); // put back: matches again
    const evenLater = new Date(Date.now() + 10000);
    utimesSync(file, evenLater, evenLater);
    expect(pendingUpdate(deps, run)).toBeNull();
  });
});
