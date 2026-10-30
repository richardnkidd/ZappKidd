/**
 * Kadode shared domain contract.
 *
 * OWNER: product/architecture lead. Implementation agents may ADD optional fields after coordinating,
 * but must not rename or remove fields. Server, importer and web all import from here.
 *
 * Conventions
 * - Civil (date-only) values are ISO strings 'YYYY-MM-DD' and are NEVER converted to Date objects
 *   for storage or display — they must not shift when viewed from another timezone.
 * - Instants (audit, sync, import times) are ISO-8601 UTC strings with 'Z'.
 * - `null` means unknown / not yet provided. Unknown is never coerced to 0 or to a guessed date.
 * - No real household data lives in committed code. Names, titles and text come from imported data.
 */

/* ------------------------------------------------------------------ */
/* Modes, people, identity                                             */
/* ------------------------------------------------------------------ */

/** Deployment state shown in the UI so nobody mistakes a preview for shared production. */
export type AppMode = 'local-demo' | 'local' | 'staging' | 'production';

export type IanaZone = 'Asia/Tokyo' | 'Pacific/Honolulu' | 'America/New_York';
export const SUPPORTED_ZONES: readonly IanaZone[] = ['Asia/Tokyo', 'Pacific/Honolulu', 'America/New_York'];

export type PersonKind = 'adult' | 'pet';

export interface Person {
  id: string; // stable slug from data, e.g. derived from the Dates sheet traveler label
  household_id: string;
  display_name: string;
  kind: PersonKind;
  /** Other spellings used in source records (e.g. an older misspelling). Source text is preserved. */
  aliases: string[];
  /** Short pronoun-free descriptor for UI, e.g. 'Dog'. Optional. */
  descriptor?: string | null;
  /** Anchor codes that belong to this traveler, e.g. { arrival: 'TN', departure: 'DN', residence: 'RN', ... } */
  anchors: TravelerAnchorCodes;
}

export interface TravelerAnchorCodes {
  arrival: AnchorCode;
  departure: AnchorCode;
  residence?: AnchorCode | null; // adults only
  health_eligibility?: AnchorCode | null; // adults only (NHI E)
  pension_eligibility?: AnchorCode | null; // adults only (pension E)
}

export interface SessionUser {
  user_id: string;
  username: string;
  person_id: string; // the adult this login acts as
  household_id: string;
}

export interface MeResponse {
  user: SessionUser;
  person: Person;
  household: { id: string; name: string; home_timezone: IanaZone; display_timezone: IanaZone };
  mode: AppMode;
  /** e.g. 'Fictional demo household' or 'Imported plan — Revision 2 (local copy)' */
  data_label: string;
  dev_identities_enabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export type RecordType =
  | 'milestone' // roadmap item W01..; app-owned roadmap (NOT the action/reminder queue)
  | 'workstream' // S01..
  | 'question' // Q001..
  | 'decision' // D01..
  | 'risk' // R01.. (risk | assumption | issue | dependency via data.raid_kind)
  | 'document' // DOC01..
  | 'cost' // B01..
  | 'funding' // cash snapshot, reserve, other commitments, FX, income lines
  | 'arrival' // A01..
  | 'horizon' // Y01.., EX01..
  | 'future_option' // FW-A, FW-B, FW-C plus FW01.. phases and FN01.. notes
  | 'evidence' // BRIEF, I01, P01, M01, C01, TA01, RH01, USER02, PC01 ...
  | 'contact' // CT-<slug>
  | 'inventory' // INV01..
  | 'property' // PROP01..
  | 'anchor' // TN, DN, TR, DR, TP, DP, RN, RR, EHN, EHR, EPN, EPR, T, D
  | 'deadline_rule' // RULE-...
  | 'existing_commitment' // dated obligations from the Dates sheet G column (existing obligations recorded in the source plan)
  | 'finding' // reviewer findings with disposition
  | 'note' // household notes (plain text; never rendered as HTML)
  | 'review_session'; // guided couple review records

/** Normalized work status used across milestones, arrival checks and horizon items. */
export type WorkStatus =
  | 'planned'
  | 'in_progress'
  | 'blocked'
  | 'waiting_external'
  | 'completed'
  | 'eliminated'
  | 'not_applicable';

export const TERMINAL_STATUSES: readonly WorkStatus[] = ['completed', 'eliminated', 'not_applicable'];

/** Who is accountable. 'together' = jointly owned by both adults. */
export type OwnerRef = string | 'together' | 'unassigned'; // string = person id of an adult

export type Priority = 'now' | 'soon' | 'later' | 'someday';

export type Visibility = 'household' | 'private';

export interface SourceRef {
  import_run_id: string;
  file: string; // basename only, e.g. 'Tokyo_Relocation_Workbook.xlsx'
  sheet?: string | null;
  row?: number | null;
  cell_range?: string | null; // e.g. 'A7:Q7'
  file_sha256: string;
  source_label: string; // e.g. 'Revision 2'
  /** Original column-name → original value, exactly as read. Never edited after import. */
  raw: Record<string, string | number | boolean | null>;
}

export interface BaseRecord<T extends RecordType = RecordType, D = Record<string, unknown>> {
  id: string; // `${type}:${key}` — deterministic, so re-import is idempotent
  household_id: string;
  type: T;
  key: string; // stable source ID, e.g. 'W45', 'DOC12', 'B07'
  title: string;
  status: string; // normalized per type (WorkStatus for work records)
  owner: OwnerRef | null;
  owner_proposed: boolean; // true while the owner came from a '(proposed)' source value
  visibility: Visibility;
  created_by: string | null; // person id or 'import'
  data: D;
  source: SourceRef | null;
  version: number; // optimistic concurrency token; increments on every write
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  /** Field paths edited in-app since the last import (re-import keeps these). Present on server responses. */
  locally_edited?: string[];
}

/* ---------- Deadlines ---------- */

export type DeadlineKind =
  | 'legal'
  | 'contractual'
  | 'user_committed'
  | 'internal_target'
  | 'estimate'
  | 'review_date'; // a planning review checkpoint — NEVER an expiry or filing deadline

export type DayUnit = 'calendar_days' | 'business_days' | 'calendar_months';

export type AnchorCode =
  | 'T' | 'D' // household coordination helpers only
  | 'TN' | 'DN' | 'TR' | 'DR' | 'TP' | 'DP'
  | 'RN' | 'RR' | 'EHN' | 'EHR' | 'EPN' | 'EPR'
  | (string & {}); // other anchors such as status-expiry anchors 'XN1', 'XR1'

export type Jurisdiction = 'JP' | 'JP-Tokyo' | 'US' | 'US-HI' | 'US-MD' | 'household' | 'contract';

export interface Deadline {
  date: string | null; // null => "Awaiting date"
  kind: DeadlineKind;
  basis: string; // plain-language basis
  source_ids: string[]; // evidence keys
  jurisdiction: Jurisdiction | null;
  timezone: IanaZone; // timezone in which the civil date is meaningful
  verified_on: string | null; // civil date the rule/date was last verified
  traveler: string | 'household' | 'each_adult' | null; // person id or group
  rule_id?: string | null; // when computed from a DeadlineRule
  anchor?: AnchorCode | null;
  offset?: number | null;
  unit?: DayUnit | null;
}

export interface AnchorData {
  code: AnchorCode;
  traveler: string | 'household';
  meaning: string; // e.g. '<pet name> arrival'
  date: string | null; // civil date; null = awaiting
  timezone: IanaZone; // arrival anchors in Asia/Tokyo; departures where they happen
  confidence: 'awaiting' | 'tentative' | 'planned' | 'booked' | 'actual';
  evidence: string | null;
  /** household T/D are coordination helpers and must never drive a traveler's legal deadline */
  coordination_only: boolean;
}

export interface DeadlineRuleData {
  label: string;
  traveler_scope: string | 'each_adult' | 'household'; // person id or group
  anchor: AnchorCode;
  /** If traveler_scope is 'each_adult', the per-adult anchor role to use. */
  anchor_role?: keyof TravelerAnchorCodes | null;
  offset: number;
  unit: DayUnit;
  direction: 'before' | 'after';
  kind: DeadlineKind;
  jurisdiction: Jurisdiction | null;
  timezone: IanaZone;
  source_ids: string[];
  source_url?: string | null;
  verified_on: string | null;
  verification: 'verified_official' | 'indexed_only' | 'secondary_only' | 'not_verified';
  applies: 'yes' | 'no' | 'unknown';
  applies_when: string;
  linked_records: string[]; // record keys this rule dates, e.g. ['W15']
  notes?: string | null;
  /** Key of the rule that replaces this one (a rule with this set is treated as superseded). */
  superseded_by?: string | null;
}

/* ---------- Milestones (roadmap) ---------- */

export interface MilestoneData {
  work_area: string;
  workstream_key: string | null;
  next_action: string;
  source_status: string; // original free-text status, preserved
  status_reason: string | null; // required for blocked/eliminated/not_applicable
  completion_criteria: string; // workbook 'Completion evidence'
  completion_evidence: CompletionEvidence[]; // actual evidence captured when completed
  contingency: string;
  collaborators: string[]; // e.g. 'Immigration adviser', 'Veterinarian', 'Assistant'
  priority: Priority | null;
  effort_estimate: string | null; // only if known; never invented
  dependencies: string[]; // record keys (W..), after review corrections
  dependency_note: string | null; // non-ID text from the source dependencies cell
  review_date: string | null; // planning checkpoint only
  target_window: string; // e.g. 'Nov-Dec route; filing on adviser schedule'
  deadline: Deadline | null; // explicit or rule-derived deadline basis
  traveler_scope: string[]; // person ids this milestone gates; [] = household coordination
  phase: PhaseKey | null;
  optional_future_work: boolean; // W05/W58/W65/W67/W68/W69 class — never a move gate
  conditional: string | null; // e.g. 'only if a current medicine needs permission'
  parent_key: string | null; // for traveler-specific children such as W60.<person>
  queue_disposition: string | null; // from the roadmap-queue crosswalk
  linked_task_ids: string[]; // task_links.id values
  source_ids: string[]; // evidence keys
  /**
   * Per-traveler progress for a gate shared by several travelers (e.g. 'entry permissions' for each adult).
   * When present for a traveler, readiness uses it instead of the record-level status, so one traveler's
   * unfinished part never blocks another traveler. Record-level `status` then summarizes the household view.
   */
  traveler_progress?: Record<string, TravelerProgress>;
  /**
   * Dependency key → the travelers for whom that dependency blocks this record. Absent key = blocks everyone
   * the record applies to. Example: { W03: ['adult_b'] } on a shared permissions row means the second adult's
   * route only gates the second adult's part.
   */
  dependency_scope?: Record<string, string[]>;
  /** Plain-language note when a review set this record's scope/phase/gates (shown in Source & history). */
  review_note?: string | null;
  /** Source 'Due-date basis' text (why the date/window is what it is), preserved for display. */
  due_basis?: string | null;
}

export interface TravelerProgress {
  status: WorkStatus;
  reason: string | null;
  evidence: CompletionEvidence[];
  updated_at: string | null;
  updated_by: string | null;
}

export interface CompletionEvidence {
  at: string; // instant
  by: string; // person id
  summary: string; // plain text
  link: string | null; // restricted external link, never an uploaded original
}

export type PhaseKey =
  | 'p1_now_nov2026'
  | 'p2_nov_dec2026'
  | 'p3_jan_mar2027'
  | 'p4_stage_minus_90'
  | 'p5_final_60_30_14'
  | 'p6_departure_to_day90'
  | 'p7_three_year';

/* ---------- Decisions ---------- */

export type DecisionState = 'open' | 'proposed' | 'approved' | 'rejected' | 'deferred' | 'superseded';

export interface DecisionOption {
  id: string;
  label: string;
  consequences: string | null;
  source: 'imported' | 'household' | 'reviewer';
}

export interface DecisionData {
  question: string;
  options: DecisionOption[];
  recommended_option_id: string | null;
  recommendation_text: string; // workbook 'Recommended choice' text, preserved
  rationale: string | null;
  needed_by: Deadline | null;
  trigger: string; // workbook 'Deadline basis'
  consequence_of_delay: string | null;
  dependencies: string[];
  acceptance_evidence: string;
  source_status: string;
  /** People whose approval makes this a household-approved decision. */
  required_approvers: string[];
  approvals: { person_id: string; at: string; option_id: string; note: string | null }[];
  decided_option_id: string | null;
  decided_at: string | null;
  history_note: string | null;
  /** For deferred decisions: civil date to revisit. */
  revisit_on?: string | null;
  /** Non-blocking related workstream/decision keys imported from the source 'Dependencies' column. */
  related?: string[];
}

/* ---------- Questions (78 questionnaire items) ---------- */

export type QuestionDisposition =
  | 'question'
  | 'carry_forward'
  | 'waiting_blocked'
  | 'already_answered'
  | 'not_applicable'
  | 'explicitly_excluded';

export interface QuestionData {
  workstream_key: string | null;
  topic: string;
  disposition: QuestionDisposition;
  source_disposition: string; // workbook coverage status, preserved
  local_disposition: string | null; // Revision-2 local coverage disposition, preserved
  known: string;
  question: string;
  when_trigger: string;
  evidence_basis: string;
  answer: string | null;
  local_note: string | null;
  relevance: string[]; // record keys or traveler ids used to surface "a few relevant questions"
}

/* ---------- Risks / RAID ---------- */

export interface RiskData {
  raid_kind: 'risk' | 'assumption' | 'issue' | 'dependency';
  trigger: string;
  mitigation: string;
  fallback: string;
  review_basis: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  escalation_trigger: string | null;
  linked_records: string[];
}

/* ---------- Documents ---------- */

export interface DocumentData {
  for_whom: string; // source text
  traveler_scope: string[]; // person ids, [] = household
  custodian: string;
  needed_by: string; // source text
  validity: string;
  completion_criteria: string;
  source_status: string;
  privacy: string;
  /** Lifecycle — separate facts, never collapsed into one percentage. */
  requested_at: string | null;
  received_at: string | null;
  reviewed_at: string | null;
  accepted_by_authority_at: string | null;
  accepted_by: string | null; // e.g. 'Immigration Services Agency'
  expiry: string | null;
  refresh_trigger: string | null;
  link: string | null; // restricted external link; uploads are not implemented
  linked_records: string[];
}

/* ---------- Money ---------- */

export type Currency = 'USD' | 'JPY';
export type CostSection = 'one_time' | 'tokyo_monthly' | 'us_monthly' | 'staged_overlap' | 'reserve';
export type CommitmentState = 'not_committed' | 'estimate' | 'quote' | 'approved_commitment' | 'paid' | 'partially_paid';

export interface Money {
  amount: number;
  currency: Currency;
}

export interface CostPhase {
  /** traveler whose stage this cost follows, or null for household */
  traveler: string | null;
  start_anchor: AnchorCode | null;
  start_date: string | null;
  end_anchor: AnchorCode | null;
  end_date: string | null;
  /** explicit months if dates are unknown but a duration is agreed */
  months: number | null;
  note: string | null;
}

export interface CostData {
  section: CostSection;
  source_section: string;
  category: string;
  description: string;
  applicability: 'review' | 'include' | 'exclude';
  exclusion_reason: string | null;
  estimate: Money | null;
  quote: Money | null;
  committed: Money | null;
  paid: Money | null;
  unpaid_balance: Money | null;
  payer: string | null;
  quote_source: string | null;
  quote_date: string | null;
  deposit_due: string | null;
  refundable: 'yes' | 'no' | 'partial' | 'unknown';
  uncertainty: string;
  commitment_state: CommitmentState;
  phase: CostPhase | null;
  duplication_check: string | null;
}

export type FundingKind = 'cash_snapshot' | 'return_reserve' | 'other_commitments' | 'income' | 'fx_rate';

export interface FundingData {
  kind: FundingKind;
  person_id: string | null; // for income
  amount: Money | null; // null = unknown
  /** income only */
  income_status?: 'planning_zero' | 'unverified' | 'verified_lawful' | 'confirmed_none';
  monthly?: boolean;
  /** fx only: JPY per 1 USD */
  jpy_per_usd?: number | null;
  as_of: string | null;
  source: string | null;
  evidence: string | null;
  excluded_reason?: string | null; // speculative work, unsold assets, pending claims
}

export type ScenarioKey = 'planning' | 'condo_delay' | 'combined_stress';

export interface ScenarioSettings {
  key: ScenarioKey;
  label: string;
  /** multiplier applied to JPY-per-USD; 0.9 = JPY per USD falls 10% => JPY costs +11.11% in USD */
  fx_factor: number;
  extra_us_months: number;
  horizon_months: number; // 3 for the initial cash model; 36 for sustainability view
}

/* ---------- Arrival / horizon / future work ---------- */

export interface ArrivalData {
  window: string; // source text
  window_key: 'arrival_day' | 'first_week' | 'day_30' | 'day_60' | 'day_90' | 'ongoing';
  trigger: string;
  action: string;
  traveler_scope: string[]; // person ids; independent per traveler
  dependencies: string;
  completion_criteria: string;
  source_ids: string[];
  completion_evidence: CompletionEvidence[];
  status_reason: string | null;
  deadline: Deadline | null;
  /** Same semantics as MilestoneData.traveler_progress — each traveler's arrival checklist is independent. */
  traveler_progress?: Record<string, TravelerProgress>;
}

export interface HorizonData {
  trigger: string;
  scope: string;
  completion_criteria: string;
  source_ids: string[];
  milestone_links: string[];
  cadence: 'event' | 'quarterly' | 'annual' | 'once' | null;
  deadline: Deadline | null;
}

export interface FutureOptionData {
  rank: number | null;
  path: string;
  why_fit: string;
  offer_hypothesis: string;
  first_test: string;
  success_evidence: string;
  limits: string;
  unknowns: string;
  source_ids: string[];
  /** Always true — future work is outside the move's critical path. */
  outside_critical_path: true;
  interest: 'not_now' | 'curious' | 'exploring' | 'paused' | null;
  /** 'option' (FW-A..C, default), 'phase' (FW01..) or 'note' (FN01..). Phases/notes reuse the fields above loosely. */
  kind?: 'option' | 'phase' | 'note';
  /** Phase/note extras. */
  window?: string | null;
  completion_evidence?: string | null;
  milestone_links?: string[];
  review_date?: string | null;
  origin?: string | null;
  body?: string | null;
}

/* ---------- Evidence / contacts ---------- */

export interface EvidenceData {
  url_or_reference: string;
  checked_on: string | null;
  access: string;
  supported_scope: string;
  refresh_trigger: string;
  stale: boolean; // computed at import from checked_on + refresh rules, recomputed on read
  superseded_by: string | null;
}

export type ContactRelationship = 'potential' | 'contacted' | 'engaged' | 'former';

export interface ContactData {
  name: string;
  role: string;
  relevance: string;
  status_boundary: string;
  relationship: ContactRelationship; // a saved name never implies a booking
  /** Why this relationship value was chosen (only an explicit recorded interaction or existing relationship upgrades it). */
  relationship_basis?: string | null;
  source_ids: string[];
  linked_records: string[];
}

/* ---------- Existing commitments, findings, notes, reviews ---------- */

export interface ExistingCommitmentData {
  recorded_date: string | null;
  meaning: string;
  deadline_kind: DeadlineKind;
  evidence_caution: string;
  /** Old task date kept for history; never shown as overdue (it proves nothing about completion). */
  historical?: boolean;
  linked_records: string[];
}

export type FindingDisposition = 'accepted' | 'deferred' | 'rejected' | 'open';

export interface FindingData {
  reviewer: string; // 'pm' | 'relocation' | 'immigration-tax' | 'ux' | 'security' | 'functional'
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: string;
  affected_records: string[];
  affected_screens: string[];
  impact: string;
  recommendation: string;
  finding_owner: string;
  due_or_trigger: string;
  finding_type: 'safe_local_fix' | 'household_decision' | 'research_needed' | 'professional_determination';
  disposition: FindingDisposition;
  disposition_rationale: string | null;
}

export interface NoteData {
  body: string; // plain text only — rendered as text, never as HTML
  linked_record_id: string | null;
}

export interface ReviewSessionData {
  started_at: string;
  completed_at: string | null;
  participants: string[];
  since: string | null; // instant of the previous completed review
  reviewed_record_ids: string[];
  decisions: { record_id: string; outcome: string }[]; // at most three
  summary: string; // plain text; every claim links to record ids in `reviewed_record_ids`
  next_review_on: string | null;
}

/* ------------------------------------------------------------------ */
/* Task adapter (existing Task-Management queue = action authority)    */
/* ------------------------------------------------------------------ */

export type TaskSyncState =
  | 'synced' // readback matched after last write/read
  | 'snapshot' // read-only historical snapshot (dated), no live connection
  | 'pending_capture' // proposed in the app; no authorized writer has created it yet
  | 'pending_update'
  | 'error'
  | 'conflict';

export interface TaskLink {
  id: string; // app-side link id
  household_id: string;
  adapter: 'fixture' | 'snapshot' | 'script';
  canonical_id: string | null; // id in the authoritative task store (null while pending capture)
  record_id: string | null; // linked roadmap record id
  title: string;
  status: 'open' | 'done' | 'cancelled' | 'unknown';
  due: string | null; // civil date as held by the task store
  due_basis: 'explicit' | 'default_14_days' | 'left_blank' | 'source';
  owner: OwnerRef | null;
  notes: string | null;
  proposal_note: string | null; // e.g. crosswalk proposal text
  sync_state: TaskSyncState;
  last_synced_at: string | null;
  last_error: string | null;
  remote_revision: string | null;
  /** Changes awaiting an authorized writer (pending_update), as sent by the person. */
  pending_changes?: Record<string, unknown> | null;
  version: number;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Audit, import receipts                                              */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | 'create' | 'update' | 'status_change' | 'approve' | 'reject' | 'defer'
  | 'undo' | 'import_create' | 'import_update' | 'correction' | 'restore'
  | 'task_propose' | 'task_sync' | 'task_complete' | 'anchor_change' | 'review_complete';

export interface AuditEntry {
  id: string;
  household_id: string;
  at: string;
  actor: string; // person id, 'import', or 'system'
  record_id: string | null;
  action: AuditAction;
  before: unknown;
  after: unknown;
  reason: string | null;
  undone_by: string | null; // audit id of the undo entry, if any
}

export interface ImportRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  source_label: string;
  files: { name: string; sha256: string; bytes: number }[];
  counts: Record<string, number>;
  status: 'completed' | 'no_changes' | 'failed';
  summary: string;
}

export interface ImportChange {
  id: string;
  import_run_id: string;
  record_id: string;
  change: 'created' | 'source_updated' | 'local_kept' | 'correction_applied' | 'correction_not_applicable' | 'unchanged';
  field: string | null;
  before: unknown;
  after: unknown;
  rationale: string | null;
  correction_id: string | null;
}

/* ------------------------------------------------------------------ */
/* API envelopes                                                       */
/* ------------------------------------------------------------------ */

export interface ApiError {
  error: 'unauthenticated' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'rate_limited' | 'server_error' | 'not_authorized_in_mode';
  message: string;
  details?: unknown;
}

export interface ConflictError extends ApiError {
  error: 'conflict';
  details: { server: BaseRecord; your_changes: Record<string, unknown>; server_version: number };
}

export interface Snapshot {
  generated_at: string;
  me: MeResponse;
  people: Person[];
  records: BaseRecord[]; // source.raw omitted; fetch /api/records/:id for full source
  task_links: TaskLink[];
  last_import: ImportRun | null;
  last_review_completed_at: string | null;
  scenarios: ScenarioSettings[];
  settings: HouseholdSettings;
}

/**
 * Normalized output of a source parser (real workbook package OR fictional demo fixture), consumed by
 * src/import/apply.ts. Deterministic for identical inputs.
 */
export interface ImportBundle {
  source_label: string; // e.g. 'Revision 2' or 'Fictional demo'
  files: { name: string; sha256: string; bytes: number }[];
  household: { id: string; name: string; data_label: string; home_timezone: IanaZone };
  people: Omit<Person, 'household_id'>[];
  records: Omit<BaseRecord, 'household_id' | 'version' | 'created_at' | 'updated_at' | 'updated_by'>[];
  task_links: Omit<TaskLink, 'household_id' | 'version' | 'created_at' | 'updated_at'>[];
  settings: Partial<HouseholdSettings>;
  validation: {
    counts: Record<string, number>; // per record type, plus sub-counts like 'contact'
    expected: Record<string, number>; // declared counts, e.g. { milestone: 71, ... }
    dangling_refs: { record: string; field: string; ref: string }[];
    notes: string[];
  };
}

/** Household-level configuration stored in the `settings` table (one JSON value per key). */
export interface HouseholdSettings {
  /** Per-traveler gate lists (see engine-contracts TravelerGateConfig). */
  traveler_gates: import('./engine-contracts').TravelerGateConfig[];
  /** Task adapter in use and whether it can write. */
  task_adapter: { name: 'fixture' | 'snapshot' | 'script'; can_write: boolean; as_of: string | null; note: string };
  /** Civil date the plan considers its baseline, and the local review date. Historical dates are never rolled forward. */
  plan_baseline: { baseline_on: string | null; reviewed_on: string | null; source_label: string };
  /** Optional Japanese public-holiday calendar for business-day math (civil dates). Empty = approximate. */
  jp_holidays: string[];
}

/* ------------------------------------------------------------------ */
/* Record shapes for types that had no explicit data interface         */
/* (added by the import agent; additive)                               */
/* ------------------------------------------------------------------ */

export interface WorkstreamData {
  next_action: string;
  done_evidence: string;
  source_status: string; // original free-text status, preserved
  status_reason: string | null;
  /** Source 'Dependencies' column as NON-blocking related workstream keys (the workstream graph is cyclic). */
  related: string[];
  related_note: string | null;
  milestone_keys: string[]; // W.. rows assigned to this workstream (derived)
  question_keys: string[]; // Q.. rows assigned to this workstream (derived)
  collaborators: string[];
}

export interface InventoryData {
  category: string;
  location: string | null;
  quantity: string | null;
  dimensions_weight: string | null;
  disposition: string;
  value_text: string | null;
  restriction_check: string | null;
  quote_source: string | null;
  decision_evidence: string | null;
  notes: string | null;
}

export interface PropertyData {
  obligation: string;
  known_context: string;
  people_resources: string;
  evidence_caution: string;
  milestone_links: string[];
  evidence_status: string | null;
}
