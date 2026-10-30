/**
 * JSON sidecar files that accompany the workbook, plus the optional private household overrides.
 * Everything is validated defensively: the files are local, but they are data, never instructions.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { IanaZone, QuestionDisposition } from '../shared/types';
import { SUPPORTED_ZONES } from '../shared/types';
import { isObject, sha256Hex } from './util';

export interface FileEntry {
  name: string;
  sha256: string;
  bytes: number;
}

export function fileEntry(path: string, nameOverride?: string): FileEntry {
  const bytes = readFileSync(path);
  return { name: nameOverride ?? basename(path), sha256: sha256Hex(bytes), bytes: statSync(path).size };
}

export interface CrosswalkLink {
  id: string;
  title: string;
  status: string;
  due: string | null;
  proposal: string | null;
}

export interface CrosswalkRow {
  id: string;
  title: string;
  source_row: string | null;
  disposition: string;
  source_status: string | null;
  proposed_review_date: string | null;
  dependencies: string | null;
  links: CrosswalkLink[];
}

export interface CoverageRow {
  id: string;
  workstream: string | null;
  topic: string;
  disposition: string;
  known: string;
  question_or_followthrough: string;
  local_note: string;
}

export interface Overrides {
  household_id?: string;
  household_name?: string;
  data_label?: string;
  home_timezone?: IanaZone;
  people: Record<string, { display_name?: string; aliases?: string[]; descriptor?: string | null; note?: string }>;
  plan_baseline?: { baseline_on?: string | null; reviewed_on?: string | null; source_label?: string };
  task_snapshot_as_of?: string | null;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read JSON file ${basename(path)}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function readCrosswalk(path: string): CrosswalkRow[] {
  const data = readJson(path);
  if (!Array.isArray(data)) throw new Error('roadmap-queue-crosswalk.json: expected an array');
  return data.map((row, i) => {
    if (!isObject(row) || typeof row.id !== 'string') throw new Error(`roadmap-queue-crosswalk.json: row ${i} has no id`);
    const links = Array.isArray(row.existing_task_links) ? row.existing_task_links : [];
    return {
      id: row.id,
      title: str(row.title) ?? '',
      source_row: str(row.source_row),
      disposition: str(row.disposition) ?? '',
      source_status: str(row.source_status),
      proposed_review_date: str(row.proposed_review_date),
      dependencies: str(row.dependencies),
      links: links.filter(isObject).map((l) => ({
        id: str(l.id) ?? '',
        title: str(l.title) ?? '',
        status: str(l.status) ?? 'unknown',
        due: str(l.due),
        proposal: str(l.proposal),
      })),
    };
  });
}

export function readCoverage(path: string): CoverageRow[] {
  const data = readJson(path);
  if (!Array.isArray(data)) throw new Error('questionnaire-coverage.json: expected an array');
  return data.map((row, i) => {
    if (!isObject(row) || typeof row.id !== 'string') throw new Error(`questionnaire-coverage.json: row ${i} has no id`);
    return {
      id: row.id,
      workstream: str(row.workstream),
      topic: str(row.topic) ?? '',
      disposition: str(row.disposition) ?? '',
      known: str(row.known) ?? '',
      question_or_followthrough: str(row.question_or_followthrough) ?? '',
      local_note: str(row.local_note) ?? '',
    };
  });
}

/** Coverage JSON disposition text → the app's QuestionDisposition; null when unrecognized. */
export function mapDisposition(text: string | null | undefined): QuestionDisposition | null {
  const t = (text ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!t) return null;
  if (t.startsWith('already answered') || t === 'answered') return 'already_answered';
  if (t.startsWith('waiting') || t.includes('blocked')) return 'waiting_blocked';
  if (t.startsWith('carry forward') || t.startsWith('carry')) return 'carry_forward';
  if (t.startsWith('explicitly excluded') || t.startsWith('excluded')) return 'explicitly_excluded';
  if (t.startsWith('not applicable')) return 'not_applicable';
  if (t === 'question' || t.startsWith('question')) return 'question';
  return null;
}

export function readOverrides(path: string): Overrides {
  if (!existsSync(path)) return { people: {} };
  const data = readJson(path);
  if (!isObject(data)) throw new Error('household-overrides.json: expected an object');
  const people: Overrides['people'] = {};
  if (isObject(data.people)) {
    for (const [id, v] of Object.entries(data.people)) {
      if (!isObject(v)) continue;
      people[id] = {
        display_name: str(v.display_name) ?? undefined,
        aliases: Array.isArray(v.aliases) ? v.aliases.filter((a): a is string => typeof a === 'string') : undefined,
        descriptor: v.descriptor === null ? null : (str(v.descriptor) ?? undefined),
        note: str(v.note) ?? undefined,
      };
    }
  }
  const tz = str(data.home_timezone);
  const baseline = isObject(data.plan_baseline) ? data.plan_baseline : null;
  return {
    household_id: str(data.household_id) ?? undefined,
    household_name: str(data.household_name) ?? undefined,
    data_label: str(data.data_label) ?? undefined,
    home_timezone: tz && (SUPPORTED_ZONES as readonly string[]).includes(tz) ? (tz as IanaZone) : undefined,
    people,
    plan_baseline: baseline
      ? { baseline_on: str(baseline.baseline_on), reviewed_on: str(baseline.reviewed_on), source_label: str(baseline.source_label) ?? undefined }
      : undefined,
    task_snapshot_as_of: str(data.task_snapshot_as_of),
  };
}

export function sidecarPaths(dir: string) {
  return {
    workbook: join(dir, 'source', 'Tokyo_Relocation_Workbook.xlsx'),
    pdf: join(dir, 'source', 'Tokyo_Relocation_Plan.pdf'),
    handoff: join(dir, 'source', 'User-Revision-2-Handoff.txt'),
    crosswalk: join(dir, 'roadmap-queue-crosswalk.json'),
    coverage: join(dir, 'questionnaire-coverage.json'),
    verification: join(dir, 'verification.json'),
    overrides: join(dir, '..', 'household-overrides.json'),
  };
}
