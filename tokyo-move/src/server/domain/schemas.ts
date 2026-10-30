/**
 * zod building blocks and the per-record-type rules for creating and editing records.
 * Anything not named here cannot be created or edited through the API (imports own the rest).
 */
import { z, type ZodType } from 'zod';
import { isCivilDate } from '../../shared/dates';
import type { RecordType } from '../../shared/types';

export const RECORD_TYPES: readonly RecordType[] = [
  'milestone', 'workstream', 'question', 'decision', 'risk', 'document', 'cost', 'funding', 'arrival', 'horizon',
  'future_option', 'evidence', 'contact', 'inventory', 'property', 'anchor', 'deadline_rule', 'existing_commitment',
  'finding', 'note', 'review_session',
];

/* ---------- primitives ---------- */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CONTROL_SINGLE_LINE = /[\u0000-\u001F\u007F]/;

/** Multi-line plain text. Stored and rendered as text only. */
export const text = (max = 5000) =>
  z.string().max(max).refine((s) => !CONTROL.test(s), 'Control characters are not allowed');
export const line = (max = 300) =>
  z.string().max(max).refine((s) => !CONTROL_SINGLE_LINE.test(s), 'Must be a single line without control characters');
export const requiredLine = (max = 300) => line(max).refine((s) => s.trim().length > 0, 'Must not be empty');
export const requiredText = (max = 5000) => text(max).refine((s) => s.trim().length > 0, 'Must not be empty');

export const civilDate = z.string().refine((s) => isCivilDate(s), 'Expected a real calendar date as YYYY-MM-DD');
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const civilOrInstant = z
  .string()
  .refine((s) => INSTANT.test(s) || isCivilDate(s), 'Expected YYYY-MM-DD or an ISO instant ending in Z');
export const slug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/, 'Expected letters, digits and - _ . :');

/** A link to a restricted external location. Only http(s) is accepted; uploads are not implemented. */
export const externalLink = z
  .string()
  .max(2000)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Expected an http(s) link');

export const moneySchema = z.strictObject({
  amount: z.number().finite().min(0).max(1e12),
  currency: z.enum(['USD', 'JPY']),
});

export const ianaZone = z.enum(['Asia/Tokyo', 'Pacific/Honolulu', 'America/New_York']);

export const deadlineSchema = z.strictObject({
  date: civilDate.nullable(),
  kind: z.enum(['legal', 'contractual', 'user_committed', 'internal_target', 'estimate', 'review_date']),
  basis: text(1000),
  source_ids: z.array(line(100)).max(50),
  jurisdiction: z.enum(['JP', 'JP-Tokyo', 'US', 'US-HI', 'US-MD', 'household', 'contract']).nullable(),
  timezone: ianaZone,
  verified_on: civilDate.nullable(),
  traveler: line(100).nullable(),
  rule_id: line(100).nullable().optional(),
  anchor: line(40).nullable().optional(),
  offset: z.number().int().min(-3650).max(3650).nullable().optional(),
  unit: z.enum(['calendar_days', 'business_days', 'calendar_months']).nullable().optional(),
});

const costPhaseSchema = z.strictObject({
  traveler: line(100).nullable(),
  start_anchor: line(40).nullable(),
  start_date: civilDate.nullable(),
  end_anchor: line(40).nullable(),
  end_date: civilDate.nullable(),
  months: z.number().min(0).max(600).nullable(),
  note: text(1000).nullable(),
});

const linkedList = z.array(line(200)).max(100);

/* ---------- status vocabulary ---------- */

export const WORK_STATUSES = [
  'planned', 'in_progress', 'blocked', 'waiting_external', 'completed', 'eliminated', 'not_applicable',
] as const;
/** Record types whose status must be a WorkStatus. */
export const WORK_STATUS_TYPES: ReadonlySet<RecordType> = new Set(['milestone', 'arrival', 'horizon', 'workstream']);
/** Record types that carry `data.traveler_progress` (independent per-traveler status on a shared item). */
export const TRAVELER_PROGRESS_TYPES: ReadonlySet<RecordType> = new Set(['milestone', 'arrival']);
export const STATUS_NEEDS_REASON: ReadonlySet<string> = new Set(['eliminated', 'not_applicable', 'blocked']);
export const STATUS_NEEDS_EVIDENCE: ReadonlySet<string> = new Set(['completed']);
export const statusSlug = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Expected a lowercase status such as in_progress');

/* ---------- editable data fields per record type (PATCH allowlist) ---------- */

type FieldMap = Record<string, ZodType>;

const decisionOption = z.strictObject({
  id: slug,
  label: requiredLine(300),
  consequences: text(2000).nullable(),
  source: z.enum(['imported', 'household', 'reviewer']),
});

/**
 * Fields intentionally NOT editable through PATCH, even for types listed below: `source`, `id`, `key`, `type`,
 * `household_id`, `version` (record envelope); `traveler_progress` (status endpoint only); `dependency_scope`,
 * `traveler_scope`, `dependencies`, `phase` (import/corrections only); `status_reason` and `completion_evidence`
 * (status endpoint only); decision `approvals`/`decided_*` (approve/reject/defer endpoints only).
 */
export const PATCHABLE_DATA: Partial<Record<RecordType, FieldMap>> = {
  milestone: {
    next_action: requiredText(2000),
    completion_criteria: text(2000),
    contingency: text(2000),
    collaborators: z.array(line(200)).max(30),
    priority: z.enum(['now', 'soon', 'later', 'someday']).nullable(),
    effort_estimate: line(200).nullable(),
    review_date: civilDate.nullable(),
    target_window: line(300),
    deadline: deadlineSchema.nullable(),
    conditional: text(1000).nullable(),
    dependency_note: text(1000).nullable(),
  },
  workstream: {
    next_action: text(2000),
    done_evidence: text(2000),
    collaborators: z.array(line(200)).max(30),
  },
  inventory: {
    location: line(300).nullable(),
    quantity: line(100).nullable(),
    dimensions_weight: line(200).nullable(),
    disposition: line(200),
    value_text: line(200).nullable(),
    restriction_check: text(1000).nullable(),
    quote_source: text(500).nullable(),
    decision_evidence: text(1000).nullable(),
    notes: text(2000).nullable(),
  },
  property: {
    known_context: text(2000),
    people_resources: text(1000),
    evidence_caution: text(1000),
    evidence_status: text(500).nullable(),
  },
  question: {
    answer: text(5000).nullable(),
    local_note: text(5000).nullable(),
    disposition: z.enum(['question', 'carry_forward', 'waiting_blocked', 'already_answered', 'not_applicable', 'explicitly_excluded']),
  },
  decision: {
    question: requiredText(2000),
    options: z.array(decisionOption).max(20),
    recommended_option_id: slug.nullable(),
    rationale: text(5000).nullable(),
    needed_by: deadlineSchema.nullable(),
    trigger: text(1000),
    consequence_of_delay: text(2000).nullable(),
    acceptance_evidence: text(2000),
    required_approvers: z.array(line(100)).min(1).max(10),
    history_note: text(5000).nullable(),
  },
  risk: {
    raid_kind: z.enum(['risk', 'assumption', 'issue', 'dependency']),
    trigger: text(2000),
    mitigation: text(2000),
    fallback: text(2000),
    review_basis: text(1000),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    escalation_trigger: text(1000).nullable(),
    linked_records: linkedList,
  },
  document: {
    custodian: line(300),
    validity: text(1000),
    requested_at: civilOrInstant.nullable(),
    received_at: civilOrInstant.nullable(),
    reviewed_at: civilOrInstant.nullable(),
    accepted_by_authority_at: civilOrInstant.nullable(),
    accepted_by: line(300).nullable(),
    expiry: civilDate.nullable(),
    refresh_trigger: text(1000).nullable(),
    link: externalLink.nullable(),
    linked_records: linkedList,
  },
  cost: {
    category: line(200),
    description: requiredText(1000),
    applicability: z.enum(['review', 'include', 'exclude']),
    exclusion_reason: text(1000).nullable(),
    estimate: moneySchema.nullable(),
    quote: moneySchema.nullable(),
    committed: moneySchema.nullable(),
    paid: moneySchema.nullable(),
    unpaid_balance: moneySchema.nullable(),
    payer: line(200).nullable(),
    quote_source: text(500).nullable(),
    quote_date: civilDate.nullable(),
    deposit_due: civilDate.nullable(),
    refundable: z.enum(['yes', 'no', 'partial', 'unknown']),
    uncertainty: text(1000),
    commitment_state: z.enum(['not_committed', 'estimate', 'quote', 'approved_commitment', 'paid', 'partially_paid']),
    phase: costPhaseSchema.nullable(),
    duplication_check: text(1000).nullable(),
  },
  funding: {
    amount: moneySchema.nullable(),
    as_of: civilDate.nullable(),
    source: text(500).nullable(),
    evidence: text(1000).nullable(),
    income_status: z.enum(['planning_zero', 'unverified', 'verified_lawful', 'confirmed_none']),
    monthly: z.boolean(),
    jpy_per_usd: z.number().finite().positive().max(10000).nullable(),
    excluded_reason: text(1000).nullable(),
  },
  arrival: {
    completion_criteria: text(2000),
    dependencies: text(1000),
    deadline: deadlineSchema.nullable(),
  },
  horizon: {
    trigger: text(1000),
    scope: text(2000),
    completion_criteria: text(2000),
    cadence: z.enum(['event', 'quarterly', 'annual', 'once']).nullable(),
    deadline: deadlineSchema.nullable(),
  },
  future_option: {
    interest: z.enum(['not_now', 'curious', 'exploring', 'paused']).nullable(),
    rank: z.number().int().min(1).max(100).nullable(),
    why_fit: text(2000),
    offer_hypothesis: text(2000),
    first_test: text(2000),
    success_evidence: text(2000),
    limits: text(2000),
    unknowns: text(2000),
  },
  evidence: {
    url_or_reference: text(2000),
    checked_on: civilDate.nullable(),
    access: text(500),
    supported_scope: text(1000),
    refresh_trigger: text(1000),
    superseded_by: line(200).nullable(),
  },
  contact: {
    name: requiredLine(200),
    role: line(300),
    relevance: text(1000),
    status_boundary: text(1000),
    relationship: z.enum(['potential', 'contacted', 'engaged', 'former']),
    linked_records: linkedList,
  },
  existing_commitment: {
    recorded_date: civilDate.nullable(),
    meaning: text(1000),
    evidence_caution: text(1000),
  },
  deadline_rule: {
    applies: z.enum(['yes', 'no', 'unknown']),
    applies_when: text(1000),
    notes: text(2000).nullable(),
  },
  finding: {
    disposition: z.enum(['accepted', 'deferred', 'rejected', 'open']),
    disposition_rationale: text(2000).nullable(),
    finding_owner: line(200),
    due_or_trigger: text(500),
  },
  note: {
    body: requiredText(20000),
    linked_record_id: line(200).nullable(),
  },
};

/** Types that cannot be edited through the generic PATCH, with where to go instead. */
export const PATCH_REDIRECT: Partial<Record<RecordType, string>> = {
  anchor: 'PUT /api/anchors/:code',
  review_session: 'PATCH /api/reviews/:id',
};

/* ---------- creating records ---------- */

export const CREATABLE_TYPES = ['note', 'risk', 'decision', 'finding', 'review_session', 'cost', 'contact'] as const;
export type CreatableType = (typeof CREATABLE_TYPES)[number];

export const CREATE_KEY_PREFIX: Record<Exclude<CreatableType, 'review_session'>, string> = {
  note: 'N',
  risk: 'RU',
  decision: 'DU',
  finding: 'FU',
  cost: 'BU',
  contact: 'CT-U',
};

export const CREATE_STATUS: Record<CreatableType, string> = {
  note: 'active',
  risk: 'open',
  decision: 'open',
  finding: 'open',
  review_session: 'in_progress',
  cost: 'active',
  contact: 'active',
};

const sev = z.enum(['critical', 'high', 'medium', 'low']);

export const createDataSchemas = {
  note: z.strictObject({
    body: requiredText(20000),
    linked_record_id: line(200).nullable().optional(),
  }),
  risk: z.strictObject({
    raid_kind: z.enum(['risk', 'assumption', 'issue', 'dependency']).optional(),
    trigger: text(2000).optional(),
    mitigation: text(2000).optional(),
    fallback: text(2000).optional(),
    review_basis: text(1000).optional(),
    severity: sev.optional(),
    escalation_trigger: text(1000).nullable().optional(),
    linked_records: linkedList.optional(),
  }),
  decision: z.strictObject({
    question: requiredText(2000).optional(),
    options: z
      .array(
        z.strictObject({
          id: slug.optional(),
          label: requiredLine(300),
          consequences: text(2000).nullable().optional(),
        }),
      )
      .max(20)
      .optional(),
    recommended_option_id: slug.nullable().optional(),
    rationale: text(5000).nullable().optional(),
    needed_by: deadlineSchema.nullable().optional(),
    trigger: text(1000).optional(),
    consequence_of_delay: text(2000).nullable().optional(),
    dependencies: linkedList.optional(),
    acceptance_evidence: text(2000).optional(),
    required_approvers: z.array(line(100)).min(1).max(10).optional(),
  }),
  finding: z.strictObject({
    reviewer: line(100).optional(),
    severity: sev.optional(),
    evidence: text(3000).optional(),
    affected_records: linkedList.optional(),
    affected_screens: linkedList.optional(),
    impact: text(2000).optional(),
    recommendation: text(2000).optional(),
    finding_owner: line(200).optional(),
    due_or_trigger: text(500).optional(),
    finding_type: z.enum(['safe_local_fix', 'household_decision', 'research_needed', 'professional_determination']).optional(),
  }),
  review_session: z.strictObject({
    participants: z.array(line(100)).max(10).optional(),
  }),
  cost: z.strictObject({
    section: z.enum(['one_time', 'tokyo_monthly', 'us_monthly', 'staged_overlap', 'reserve']),
    category: line(200).optional(),
    description: requiredText(1000),
    applicability: z.enum(['review', 'include', 'exclude']).optional(),
    exclusion_reason: text(1000).nullable().optional(),
    estimate: moneySchema.nullable().optional(),
    quote: moneySchema.nullable().optional(),
    committed: moneySchema.nullable().optional(),
    paid: moneySchema.nullable().optional(),
    unpaid_balance: moneySchema.nullable().optional(),
    payer: line(200).nullable().optional(),
    quote_source: text(500).nullable().optional(),
    quote_date: civilDate.nullable().optional(),
    deposit_due: civilDate.nullable().optional(),
    refundable: z.enum(['yes', 'no', 'partial', 'unknown']).optional(),
    uncertainty: text(1000).optional(),
    commitment_state: z.enum(['not_committed', 'estimate', 'quote', 'approved_commitment', 'paid', 'partially_paid']).optional(),
    phase: costPhaseSchema.nullable().optional(),
    duplication_check: text(1000).nullable().optional(),
  }),
  contact: z.strictObject({
    name: requiredLine(200),
    role: line(300).optional(),
    relevance: text(1000).optional(),
    status_boundary: text(1000).optional(),
    relationship: z.enum(['potential', 'contacted', 'engaged', 'former']).optional(),
    source_ids: z.array(line(100)).max(50).optional(),
    linked_records: linkedList.optional(),
  }),
} as const;

/* ---------- request bodies ---------- */

const owner = z.union([line(100), z.null()]);

export const createRecordBody = z.strictObject({
  type: z.enum(CREATABLE_TYPES),
  title: requiredLine(300),
  data: z.record(z.string(), z.unknown()).optional(),
  owner: owner.optional(),
  visibility: z.enum(['household', 'private']).optional(),
});

export const patchRecordBody = z.strictObject({
  baseVersion: z.number().int().min(1),
  changes: z.strictObject({
    title: requiredLine(300).optional(),
    owner: owner.optional(),
    owner_proposed: z.boolean().optional(),
    visibility: z.enum(['household', 'private']).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  reason: text(1000).optional(),
});

export const statusBody = z.strictObject({
  baseVersion: z.number().int().min(1),
  status: statusSlug,
  reason: text(2000).optional(),
  evidence: z
    .union([
      text(5000),
      z.strictObject({ summary: text(5000), link: externalLink.nullable().optional() }),
    ])
    .optional(),
  traveler: line(100).optional(),
});

export const listRecordsQuery = z.strictObject({
  type: z.enum(RECORD_TYPES as [RecordType, ...RecordType[]]).optional(),
});
