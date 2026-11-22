/**
 * "A newer private update is waiting" (local modes only).
 *
 * A household unzips a new private bundle into the Kadode folder while Kadode is running, but the import only runs when
 * the launcher starts, so the app would keep showing the old data without saying so. This compares the private overlay
 * files now on disk (`<private folder>/corrections/*.json` and `<private folder>/household-overrides.json`, where the
 * private folder is the parent of the data folder) with the files recorded on the household's latest import run, by name
 * and sha256. Only a COUNT is ever returned: no file names and no file contents leave this module.
 *
 * Hashing is cached by path, size and modification times, so a normal request only lists the folder and stats the files.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ImportRun } from '../../shared/types';
import type { Deps } from '../context';

interface Cached {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  sha256: string;
}
const hashes = new Map<string, Cached>();

function sha256Of(path: string): string | null {
  try {
    const st = statSync(path);
    const hit = hashes.get(path);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && hit.ctimeMs === st.ctimeMs) return hit.sha256;
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    hashes.set(path, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, sha256 });
    return sha256;
  } catch {
    return null; // vanished or unreadable between the listing and the read: treat as absent
  }
}

/** The overlay files on disk now, keyed the way an import run records them (`corrections/<name>.json`, `household-overrides.json`). */
export function currentOverlayFiles(privateDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const corrections = join(privateDir, 'corrections');
  try {
    if (existsSync(corrections) && statSync(corrections).isDirectory()) {
      for (const name of readdirSync(corrections).filter((f) => f.endsWith('.json')).sort()) {
        const sha = sha256Of(join(corrections, name));
        if (sha) out.set(`corrections/${name}`, sha);
      }
    }
  } catch {
    /* an unreadable folder is the same as no folder */
  }
  const overrides = join(privateDir, 'household-overrides.json');
  const sha = existsSync(overrides) ? sha256Of(overrides) : null;
  if (sha) out.set('household-overrides.json', sha);
  return out;
}

const isOverlayName = (name: string) => name === 'household-overrides.json' || /^corrections\/[^/]+\.json$/.test(name);

/** How many overlay files on disk are new, or differ from what the given import run read. */
export function changedOverlayCount(run: Pick<ImportRun, 'files'>, current: Map<string, string>): number {
  const recorded = new Map(run.files.filter((f) => isOverlayName(f.name)).map((f) => [f.name, f.sha256]));
  let changed = 0;
  for (const [name, sha] of current) if (recorded.get(name) !== sha) changed += 1;
  return changed;
}

/**
 * `{ changed }` when the folder holds something the running data has not read; null in staging/production, when there is
 * no finished import to compare with, or when nothing is waiting. `run` is the household's latest import run.
 */
export function pendingUpdate(deps: Deps, run: ImportRun | null): { changed: number } | null {
  if (deps.config.mode !== 'local' && deps.config.mode !== 'local-demo') return null;
  if (!run || run.status === 'failed') return null;
  const changed = changedOverlayCount(run, currentOverlayFiles(resolve(deps.config.dataDir, '..')));
  return changed > 0 ? { changed } : null;
}
