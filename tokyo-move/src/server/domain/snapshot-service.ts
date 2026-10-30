/** The single read model the UI loads: people, records (without raw source), task links, settings, scenarios. */
import type { Deps, AuthContext } from '../context';
import type { HouseholdSettings, ImportRun, MeResponse, ScenarioSettings, Snapshot } from '../../shared/types';
import { DEFAULT_SCENARIOS } from '../../shared/budget';
import { listPeople } from '../auth/users';
import { listRecordRows, rowToRecord } from './records-repo';
import { listTaskLinkRows, taskLinkFromRow } from './task-links-repo';
import { getSetting } from './settings-repo';
import { adapterStatus } from './tasks-service';
import { lastCompletedReviewAt } from './reviews-service';
import { parseJson } from '../util/json';

export function buildMe(deps: Deps, ctx: AuthContext): MeResponse {
  return {
    user: ctx.user,
    person: ctx.person,
    household: {
      id: ctx.household.id,
      name: ctx.household.name,
      home_timezone: ctx.household.home_timezone,
      display_timezone: ctx.household.display_timezone,
    },
    mode: deps.config.mode,
    data_label: ctx.household.data_label,
    dev_identities_enabled: deps.config.devIdentitiesEnabled,
  };
}

interface ImportRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  source_label: string;
  files: string;
  counts: string;
  status: ImportRun['status'];
  summary: string;
}

export function importRunFromRow(r: ImportRunRow): ImportRun {
  return {
    id: r.id,
    started_at: r.started_at,
    finished_at: r.finished_at,
    source_label: r.source_label,
    files: parseJson(r.files, [] as ImportRun['files']),
    counts: parseJson(r.counts, {} as Record<string, number>),
    status: r.status,
    summary: r.summary,
  };
}

export function lastImport(deps: Deps, householdId: string): ImportRun | null {
  const row = deps.db
    .prepare('SELECT * FROM import_runs WHERE household_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1')
    .get(householdId) as ImportRunRow | undefined;
  return row ? importRunFromRow(row) : null;
}

export function mergeScenarios(stored: unknown): ScenarioSettings[] {
  const out = DEFAULT_SCENARIOS.map((s) => ({ ...s }));
  if (!Array.isArray(stored)) return out;
  for (const item of stored) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Partial<ScenarioSettings>;
    if (typeof o.key !== 'string') continue;
    const idx = out.findIndex((s) => s.key === o.key);
    if (idx >= 0) {
      const base = out[idx] as ScenarioSettings;
      out[idx] = {
        key: base.key,
        label: typeof o.label === 'string' ? o.label : base.label,
        fx_factor: typeof o.fx_factor === 'number' && o.fx_factor > 0 ? o.fx_factor : base.fx_factor,
        extra_us_months: typeof o.extra_us_months === 'number' && o.extra_us_months >= 0 ? o.extra_us_months : base.extra_us_months,
        horizon_months: typeof o.horizon_months === 'number' && o.horizon_months > 0 ? o.horizon_months : base.horizon_months,
      };
    } else if (typeof o.label === 'string' && typeof o.fx_factor === 'number' && typeof o.extra_us_months === 'number' && typeof o.horizon_months === 'number') {
      out.push({ key: o.key, label: o.label, fx_factor: o.fx_factor, extra_us_months: o.extra_us_months, horizon_months: o.horizon_months });
    }
  }
  return out;
}

export function buildSettings(deps: Deps, ctx: AuthContext): HouseholdSettings {
  const hh = ctx.householdId;
  const baseline = getSetting<Partial<HouseholdSettings['plan_baseline']>>(deps.db, hh, 'plan_baseline', {});
  return {
    traveler_gates: getSetting<HouseholdSettings['traveler_gates']>(deps.db, hh, 'traveler_gates', []),
    task_adapter: adapterStatus(deps, ctx),
    plan_baseline: {
      baseline_on: baseline.baseline_on ?? null,
      reviewed_on: baseline.reviewed_on ?? null,
      source_label: baseline.source_label ?? ctx.household.data_label,
    },
    jp_holidays: getSetting<string[]>(deps.db, hh, 'jp_holidays', []),
  };
}

export function buildSnapshot(deps: Deps, ctx: AuthContext): Snapshot {
  return {
    generated_at: deps.now().toISOString(),
    me: buildMe(deps, ctx),
    people: listPeople(deps.db, ctx.householdId),
    records: listRecordRows(deps.db, ctx).map((r) => rowToRecord(r, false)),
    task_links: listTaskLinkRows(deps.db, ctx.householdId, ctx.personId).map(taskLinkFromRow),
    last_import: lastImport(deps, ctx.householdId),
    last_review_completed_at: lastCompletedReviewAt(deps, ctx.householdId),
    scenarios: mergeScenarios(getSetting<unknown>(deps.db, ctx.householdId, 'scenarios', [])),
    settings: buildSettings(deps, ctx),
  };
}
