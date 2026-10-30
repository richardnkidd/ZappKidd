/**
 * Plain-language labels. Keeps internal IDs and jargon out of normal screens.
 * OWNER: web agent (lead may edit wording).
 */
import type {
  AuditAction,
  CommitmentState,
  ContactRelationship,
  DecisionState,
  DeadlineKind,
  DeadlineRuleData,
  PhaseKey,
  Priority,
  QuestionDisposition,
  RiskData,
  TaskSyncState,
  WorkStatus,
} from './types';
import type { DeadlineState, ReadinessState } from './engine-contracts';

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  blocked: 'Blocked',
  waiting_external: 'Waiting on someone else',
  completed: 'Done',
  eliminated: 'Dropped',
  not_applicable: 'Not needed',
};

/** Order used by the board and status pickers. */
export const WORK_STATUS_ORDER: readonly WorkStatus[] = [
  'planned',
  'in_progress',
  'blocked',
  'waiting_external',
  'completed',
  'eliminated',
  'not_applicable',
];

export const DEADLINE_KIND_LABEL: Record<DeadlineKind, string> = {
  legal: 'Legal deadline',
  contractual: 'Contract date',
  user_committed: 'We committed',
  internal_target: 'Our target',
  estimate: 'Estimate',
  review_date: 'Review checkpoint',
};

/** One-sentence plain explanation shown in detail views and as a tooltip-free help line. */
export const DEADLINE_KIND_HELP: Record<DeadlineKind, string> = {
  legal: 'Set by a rule or authority. Missing it can have consequences.',
  contractual: 'Set by a contract or agreement with someone else.',
  user_committed: 'A date one of us has committed to.',
  internal_target: 'A date we chose to aim for. It can move.',
  estimate: 'A best guess. It will firm up as we learn more.',
  review_date: 'A moment to look at this again. It is not a deadline.',
};

export const QUESTION_DISPOSITION_LABEL: Record<QuestionDisposition, string> = {
  question: 'Open question',
  carry_forward: 'Carried forward — no change',
  waiting_blocked: 'Waiting / blocked',
  already_answered: 'Already answered',
  not_applicable: 'Not applicable',
  explicitly_excluded: 'Excluded on purpose',
};

export const DECISION_STATE_LABEL: Record<DecisionState, string> = {
  open: 'Needs a decision',
  proposed: 'Proposal',
  approved: 'Household-approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
  superseded: 'Replaced',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  now: 'Now',
  soon: 'Soon',
  later: 'Later',
  someday: 'Someday',
};
export const PRIORITY_ORDER: readonly Priority[] = ['now', 'soon', 'later', 'someday'];

export const PHASE_ORDER: readonly PhaseKey[] = [
  'p1_now_nov2026',
  'p2_nov_dec2026',
  'p3_jan_mar2027',
  'p4_stage_minus_90',
  'p5_final_60_30_14',
  'p6_departure_to_day90',
  'p7_three_year',
];

export const PHASE_LABEL: Record<PhaseKey, string> = {
  p1_now_nov2026: 'Now to November 2026',
  p2_nov_dec2026: 'November to December 2026',
  p3_jan_mar2027: 'January to March 2027',
  p4_stage_minus_90: 'About 90 days before each departure',
  p5_final_60_30_14: 'The final 60, 30 and 14 days',
  p6_departure_to_day90: 'Departure to day 90 in Tokyo',
  p7_three_year: 'The three-year horizon',
};

export const PHASE_SHORT_LABEL: Record<PhaseKey, string> = {
  p1_now_nov2026: 'Now',
  p2_nov_dec2026: 'Nov–Dec 2026',
  p3_jan_mar2027: 'Jan–Mar 2027',
  p4_stage_minus_90: '90 days out',
  p5_final_60_30_14: 'Final weeks',
  p6_departure_to_day90: 'First 90 days',
  p7_three_year: 'Three years',
};

export const READINESS_STATE_LABEL: Record<ReadinessState, string> = {
  not_started: 'Not started',
  preparing: 'Preparing',
  blocked: 'Blocked',
  ready_to_release: 'Ready for your go-ahead',
  released: 'Cleared to travel',
  arrived: 'Arrived',
  settled: 'Settled in',
};

export const DEADLINE_STATE_LABEL: Record<DeadlineState, string> = {
  awaiting_date: 'Awaiting date',
  upcoming: 'Upcoming',
  due_soon: 'Due soon',
  due_today: 'Due today',
  overdue: 'Past its date',
  met: 'Met',
  not_applicable: 'Not needed',
};

export const SYNC_STATE_LABEL: Record<TaskSyncState, string> = {
  synced: 'Up to date',
  snapshot: 'Read-only copy',
  pending_capture: 'Waiting to be added to your task list',
  pending_update: 'Change waiting to reach your task list',
  error: "Couldn't reach your task list",
  conflict: 'Changed in two places',
};

export const SEVERITY_LABEL: Record<RiskData['severity'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
export const SEVERITY_ORDER: readonly RiskData['severity'][] = ['critical', 'high', 'medium', 'low'];

export const RAID_KIND_LABEL: Record<RiskData['raid_kind'], string> = {
  risk: 'Risk',
  assumption: 'Assumption',
  issue: 'Issue',
  dependency: 'Dependency',
};

/**
 * How far to trust a rule. Anything other than "verified_official" must be shown with its label so a legal
 * deadline never looks more certain than its verification.
 */
export const VERIFICATION_LABEL: Record<DeadlineRuleData['verification'], string> = {
  verified_official: 'Checked against official text',
  indexed_only: 'Found in an official index only — read the source before relying on it',
  secondary_only: 'From a secondary source, not official text — check before relying on it',
  not_verified: 'Not verified — check before relying on it',
};

/** Short form for tight spaces (chips). */
export const VERIFICATION_SHORT: Record<DeadlineRuleData['verification'], string> = {
  verified_official: 'Official text',
  indexed_only: 'Index only',
  secondary_only: 'Secondary source',
  not_verified: 'Not verified',
};

export const COMMITMENT_STATE_LABEL: Record<CommitmentState, string> = {
  not_committed: 'Not committed',
  estimate: 'Estimate',
  quote: 'Quote',
  approved_commitment: 'Approved',
  paid: 'Paid',
  partially_paid: 'Partly paid',
};

export const CONTACT_RELATIONSHIP_LABEL: Record<ContactRelationship, string> = {
  potential: 'Saved name only — not contacted',
  contacted: 'Contacted',
  engaged: 'Engaged',
  former: 'Former',
};

export const ANCHOR_CONFIDENCE_LABEL: Record<string, string> = {
  awaiting: 'Awaiting date',
  tentative: 'Tentative',
  planned: 'Planned',
  booked: 'Booked',
  actual: 'Happened',
};

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  create: 'Added',
  update: 'Edited',
  status_change: 'Changed status',
  approve: 'Approved',
  reject: 'Rejected',
  defer: 'Deferred',
  undo: 'Undid a change',
  import_create: 'Imported',
  import_update: 'Updated from the plan',
  correction: 'Corrected after review',
  restore: 'Restored from backup',
  task_propose: 'Proposed a task',
  task_sync: 'Refreshed the task list copy',
  task_complete: 'Completed a task',
  anchor_change: 'Moved a travel date',
  review_complete: 'Finished a review',
};

/** Friendly names for edited fields, used when describing history. Keys are record field names. */
export const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  owner: 'owner',
  owner_proposed: 'owner (proposed)',
  status: 'status',
  next_action: 'next action',
  priority: 'priority',
  review_date: 'review date',
  deadline: 'deadline',
  collaborators: 'collaborators',
  completion_criteria: 'completion criteria',
  status_reason: 'reason',
  effort_estimate: 'effort',
  target_window: 'target window',
  contingency: 'fallback',
  dependencies: 'dependencies',
  traveler_progress: "each person's progress",
  rationale: 'rationale',
  approvals: 'approvals',
  decided_option_id: 'chosen option',
  mitigation: 'mitigation',
  severity: 'severity',
  body: 'note',
};

export const MODE_BANNER: Record<string, string | null> = {
  'local-demo': 'Demo — fictional data',
  local: 'Local preview — this computer only',
  staging: 'Staging — test copy',
  production: null,
};

export const ZONE_OPTIONS: { zone: 'Asia/Tokyo' | 'Pacific/Honolulu' | 'America/New_York'; label: string; short: string }[] = [
  { zone: 'Pacific/Honolulu', label: 'Honolulu (HST)', short: 'HST' },
  { zone: 'Asia/Tokyo', label: 'Tokyo (JST)', short: 'JST' },
  { zone: 'America/New_York', label: 'New York (EST/EDT)', short: 'EST/EDT' },
];

export const NOT_KNOWN = 'Not known yet';
export const AWAITING_DATE = 'Awaiting date';

export const JURISDICTION_LABEL: Record<string, string> = {
  JP: 'Japan',
  'JP-Tokyo': 'Tokyo',
  US: 'United States',
  'US-HI': 'Hawaiʻi',
  'US-MD': 'Maryland',
  household: 'Our household',
  contract: 'Set by a contract',
};
