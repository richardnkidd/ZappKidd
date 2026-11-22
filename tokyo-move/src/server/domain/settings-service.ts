/**
 * Household settings the app may change itself: `display_timezone` and `scenarios` only. Everything else in the
 * settings table (traveler gates, plan baseline, holiday calendar, task adapter note, internal `_import.*` baselines)
 * belongs to the importer and is never editable or listed here. Changes are household-scoped and audited.
 */
import { z } from 'zod';
import type { Deps, AuthContext } from '../context';
import type { IanaZone, ScenarioSettings } from '../../shared/types';
import { DEFAULT_SCENARIOS } from '../../shared/budget';
import { HttpError, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { appendAudit } from './audit';
import { getSetting, setSetting } from './settings-repo';
import { mergeScenarios } from './snapshot-service';
import { ianaZone, line, slug, text } from './schemas';
import { deepEqual, parseJson } from '../util/json';

export const EDITABLE_SETTINGS = ['display_timezone', 'scenarios'] as const;
type EditableKey = (typeof EDITABLE_SETTINGS)[number];

const defaultKeys = new Set<string>(DEFAULT_SCENARIOS.map((s) => s.key));

const scenarioEntry = z
  .strictObject({
    key: slug,
    label: line(80).optional(),
    fx_factor: z.number().finite().gt(0).max(5).optional(),
    extra_us_months: z.number().int().min(0).max(60).optional(),
    horizon_months: z.number().int().min(1).max(120).optional(),
  })
  .refine(
    (e) => defaultKeys.has(e.key) || (e.label !== undefined && e.fx_factor !== undefined && e.extra_us_months !== undefined && e.horizon_months !== undefined),
    'A new scenario needs label, fx_factor, extra_us_months and horizon_months',
  );
const scenariosValue = z
  .array(scenarioEntry)
  .max(10)
  .refine((list) => new Set(list.map((e) => e.key)).size === list.length, 'Scenario keys must be unique');

const putBody = z.strictObject({
  value: z.unknown(),
  /** Optional: the value the caller last saw. A mismatch is a 409 instead of a silent overwrite. */
  base: z.unknown().optional(),
  reason: text(1000).optional(),
});

function readDisplayTimezone(deps: Deps, householdId: string): IanaZone {
  const row = deps.db.prepare('SELECT display_timezone FROM households WHERE id = ?').get(householdId) as { display_timezone: IanaZone };
  return row.display_timezone;
}

/** All non-internal settings plus the display timezone. Keys starting with "_" are never listed. */
export function listSettings(deps: Deps, ctx: AuthContext): { settings: Record<string, unknown>; editable: readonly string[] } {
  const rows = deps.db.prepare('SELECT key, value FROM settings WHERE household_id = ? ORDER BY key').all(ctx.householdId) as { key: string; value: string }[];
  const settings: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.key.startsWith('_')) continue;
    settings[r.key] = parseJson<unknown>(r.value, null);
  }
  settings.display_timezone = readDisplayTimezone(deps, ctx.householdId);
  settings.scenarios = getSetting<unknown>(deps.db, ctx.householdId, 'scenarios', []);
  return { settings, editable: EDITABLE_SETTINGS };
}

export function putSetting(
  deps: Deps,
  ctx: AuthContext,
  key: string,
  rawBody: unknown,
): { key: EditableKey; value: unknown; effective: IanaZone | ScenarioSettings[] } {
  if (!(EDITABLE_SETTINGS as readonly string[]).includes(key)) {
    throw validationError('This setting cannot be changed here', [{ path: 'key', message: `Only ${EDITABLE_SETTINGS.join(' and ')} can be edited` }]);
  }
  const k = key as EditableKey;
  const body = parseWith(putBody, rawBody);
  if (!('value' in (rawBody as object))) throw validationError('Request did not pass validation', [{ path: 'value', message: 'Required' }]);

  return deps.db.transaction(() => {
    const at = deps.now().toISOString();
    if (k === 'display_timezone') {
      const value = parseWith(z.object({ value: ianaZone }), { value: body.value }).value;
      const current = readDisplayTimezone(deps, ctx.householdId);
      if (body.base !== undefined && body.base !== current) {
        throw new HttpError(409, 'conflict', 'This setting changed since you opened it', { server_value: current, your_changes: { value }, key: k });
      }
      if (value !== current) {
        deps.db.prepare('UPDATE households SET display_timezone = ? WHERE id = ?').run(value, ctx.householdId);
        appendAudit(deps.db, {
          householdId: ctx.householdId, at, actor: ctx.personId, recordId: null, action: 'update',
          before: { setting: k, value: current }, after: { setting: k, value }, reason: body.reason ?? null,
        });
      }
      return { key: k, value, effective: value };
    }
    const value = parseWith(z.object({ value: scenariosValue }), { value: body.value }, 'Scenarios').value;
    const current = getSetting<unknown>(deps.db, ctx.householdId, 'scenarios', []);
    if (body.base !== undefined && !deepEqual(body.base, current)) {
      throw new HttpError(409, 'conflict', 'This setting changed since you opened it', { server_value: current, your_changes: { value }, key: k });
    }
    if (!deepEqual(value, current)) {
      setSetting(deps.db, ctx.householdId, 'scenarios', value);
      appendAudit(deps.db, {
        householdId: ctx.householdId, at, actor: ctx.personId, recordId: null, action: 'update',
        before: { setting: k, value: current }, after: { setting: k, value }, reason: body.reason ?? null,
      });
    }
    return { key: k, value, effective: mergeScenarios(value) };
  })();
}
