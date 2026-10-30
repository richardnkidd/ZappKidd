/** Synthetic fictional records for web unit tests. No real household data. */
import type { ComputedDeadline } from '../../src/shared/engine-contracts';
import type { BaseRecord, Deadline, DecisionData, MilestoneData, Person } from '../../src/shared/types';
import { buildDirectory } from '../../src/web/lib/records';

export const PEOPLE: Person[] = [
  { id: 'ann', household_id: 'h', display_name: 'Ann', kind: 'adult', aliases: [], anchors: { arrival: 'TN', departure: 'DN' } },
  { id: 'bo', household_id: 'h', display_name: 'Bo', kind: 'adult', aliases: [], anchors: { arrival: 'TR', departure: 'DR' } },
  { id: 'pip', household_id: 'h', display_name: 'Pip', kind: 'pet', aliases: [], anchors: { arrival: 'TP', departure: 'DP' } },
];

export const DIR = buildDirectory(PEOPLE, 'ann');

const NOW = '2026-10-29T12:00:00Z';

export function rec<T extends BaseRecord['type']>(type: T, key: string, over: Partial<BaseRecord> & { data?: Record<string, unknown> } = {}): BaseRecord {
  return {
    id: `${type}:${key}`,
    household_id: 'h',
    type,
    key,
    title: over.title ?? `Title of ${key}`,
    status: over.status ?? 'planned',
    owner: over.owner === undefined ? 'ann' : over.owner,
    owner_proposed: over.owner_proposed ?? false,
    visibility: 'household',
    created_by: 'import',
    data: over.data ?? {},
    source: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    updated_by: 'import',
  };
}

export function milestone(key: string, status: string, data: Partial<MilestoneData> = {}, over: Partial<BaseRecord> = {}): BaseRecord {
  const base: MilestoneData = {
    work_area: 'Area',
    workstream_key: null,
    next_action: `Do ${key}`,
    source_status: '',
    status_reason: null,
    completion_criteria: '',
    completion_evidence: [],
    contingency: '',
    collaborators: [],
    priority: null,
    effort_estimate: null,
    dependencies: [],
    dependency_note: null,
    review_date: null,
    target_window: '',
    deadline: null,
    traveler_scope: [],
    phase: 'p1_now_nov2026',
    optional_future_work: false,
    conditional: null,
    parent_key: null,
    queue_disposition: null,
    linked_task_ids: [],
    source_ids: [],
    ...data,
  };
  return rec('milestone', key, { ...over, status, data: base as unknown as Record<string, unknown> });
}

export function deadline(date: string | null, kind: Deadline['kind'], over: Partial<Deadline> = {}): Deadline {
  return { date, kind, basis: 'basis', source_ids: [], jurisdiction: null, timezone: 'Asia/Tokyo', verified_on: null, traveler: null, ...over };
}

export function computed(id: string, date: string | null, kind: Deadline['kind'], over: Partial<ComputedDeadline> = {}): ComputedDeadline {
  return {
    id,
    source: 'record',
    rule_id: null,
    record_id: null,
    record_key: null,
    label: `Label ${id}`,
    traveler: 'household',
    kind,
    deadline: deadline(date, kind),
    state: date ? 'upcoming' : 'awaiting_date',
    days_until: null,
    approximate: false,
    applies: 'yes',
    ...over,
  };
}

export function decision(key: string, status: string, data: Partial<DecisionData> = {}): BaseRecord {
  const base: DecisionData = {
    question: 'Question?',
    options: [
      { id: 'a', label: 'Option A', consequences: null, source: 'imported' },
      { id: 'b', label: 'Option B', consequences: null, source: 'imported' },
    ],
    recommended_option_id: 'a',
    recommendation_text: '',
    rationale: null,
    needed_by: null,
    trigger: '',
    consequence_of_delay: null,
    dependencies: [],
    acceptance_evidence: '',
    source_status: '',
    required_approvers: ['ann', 'bo'],
    approvals: [],
    decided_option_id: null,
    decided_at: null,
    history_note: null,
    ...data,
  };
  return rec('decision', key, { status, data: base as unknown as Record<string, unknown> });
}
