/**
 * Result types for the shared engines (dates.ts, deadlines.ts, readiness.ts, budget.ts).
 * OWNER: lead. The import/engines agent implements the functions; the web and server agents consume these types.
 * Add optional fields if needed; do not rename/remove.
 */
import type {
  AnchorCode,
  AnchorData,
  BaseRecord,
  CostData,
  CostSection,
  Deadline,
  DeadlineKind,
  DeadlineRuleData,
  FundingData,
  OwnerRef,
  Person,
  ScenarioSettings,
  WorkStatus,
} from './types';

/* ---------- deadlines ---------- */

export type DeadlineState = 'awaiting_date' | 'upcoming' | 'due_soon' | 'due_today' | 'overdue' | 'met' | 'not_applicable';

export interface ComputedDeadline {
  id: string; // stable: `${source}:${key}` e.g. 'rule:RULE-PET-NOTICE-MIN', 'record:W24', 'commitment:EC-01'
  source: 'rule' | 'record' | 'commitment' | 'review' | 'task';
  rule_id: string | null;
  record_id: string | null;
  record_key: string | null;
  label: string; // plain language
  traveler: string | 'household' | 'each_adult' | null;
  kind: DeadlineKind;
  deadline: Deadline;
  state: DeadlineState;
  days_until: number | null; // null when awaiting date
  approximate: boolean; // e.g. business days without a holiday calendar
  applies: 'yes' | 'no' | 'unknown';
  /** Record keys this deadline dates (rule.linked_records plus records whose deadline derives from the rule). */
  linked_record_keys?: string[];
}

export interface AnchorChangeEffect {
  deadline_id: string;
  label: string;
  traveler: string | 'household' | 'each_adult' | null;
  kind: DeadlineKind;
  before: string | null;
  after: string | null;
  record_keys: string[]; // downstream records dated by this deadline
}

export interface AnchorChangePreview {
  anchor: AnchorCode;
  traveler: string | 'household';
  before: string | null;
  after: string | null;
  changes: AnchorChangeEffect[]; // only deadlines whose date changes
  unchanged_count: number;
  /** travelers whose deadlines are provably untouched (should list the other travelers) */
  unaffected_travelers: string[];
  warnings: string[]; // e.g. 'New date is before today', 'Changes a legal deadline'
}

/* ---------- readiness ---------- */

export interface TravelerGateConfig {
  person_id: string;
  required_before_departure: string[]; // record keys
  required_at_or_after_arrival: string[];
  conditional: { key: string; condition: string; applies: 'yes' | 'no' | 'unknown' }[];
  explicitly_not_gates: { key: string; reason: string }[];
  /**
   * Optional: key of the record whose completion means this traveler has been explicitly released to travel
   * (e.g. a 'final departure release' milestone). It is NOT counted among the required gates; it moves the state
   * from ready_to_release to released.
   */
  release_key?: string | null;
}

export interface GateStatus {
  record_id: string;
  key: string;
  title: string;
  status: WorkStatus;
  met: boolean; // completed, or not_applicable with a reason
  requirement: 'required' | 'conditional';
  condition: string | null;
  stage: 'before_departure' | 'at_or_after_arrival';
  /** plain-language reason this gate is not met yet, e.g. 'Waiting on the first adult's route advice' */
  blocker: string | null;
  owner: OwnerRef | null;
  blocked_by: string[]; // unmet dependency keys
}

export type ReadinessState =
  | 'not_started'
  | 'preparing'
  | 'blocked'
  | 'ready_to_release' // every required pre-departure gate met — still needs explicit release
  | 'released'
  | 'arrived'
  | 'settled'; // post-arrival gates met

export interface TravelerReadiness {
  person_id: string;
  state: ReadinessState;
  headline: string; // one calm sentence, no percentages
  blockers: GateStatus[]; // blocked now, with plain reasons
  open: GateStatus[]; // required, not met, not blocked
  met: GateStatus[];
  conditional_unknown: GateStatus[]; // applicability still unknown
  after_arrival: GateStatus[];
  next_action: GateStatus | null;
  departure: AnchorData | null;
  arrival: AnchorData | null;
}

/* ---------- budget ---------- */

export interface MoneyTotal {
  known_usd: number; // sum of lines with a usable USD value
  unknown_count: number; // lines with no amount, missing FX, or still 'review'
  unknown_keys: string[];
  excluded_count: number;
  complete: boolean; // unknown_count === 0
  /** Monthly sections only: sum of the known monthly run-rates (USD per month), before multiplying by months. */
  monthly_known_usd?: number;
}

export interface CostLineView {
  key: string;
  section: CostSection;
  description: string;
  stage: 'estimate' | 'quote' | 'approved_commitment' | 'paid' | 'partially_paid' | 'unknown' | 'excluded';
  usd: number | null; // best known amount for planning (approved > quote > estimate), USD
  unpaid_usd: number | null;
  paid_usd: number | null;
  native: { amount: number; currency: 'USD' | 'JPY' } | null;
  months_in_horizon: number | null; // monthly lines only; null when phase dates unknown
  horizon_usd: number | null; // usd × months (monthly) or unpaid (one-time)
  missing: string[]; // plain-language reasons this line is incomplete
}

export interface FxView {
  base_jpy_per_usd: number | null;
  active_jpy_per_usd: number | null; // base × scenario factor
  source: string | null;
  as_of: string | null;
  usd_effect_on_jpy_costs: number | null; // e.g. 0.1111 for factor 0.9
}

export interface CashModel {
  horizon_months: number;
  one_time_unpaid: MoneyTotal;
  tokyo_monthly: MoneyTotal;
  us_monthly: MoneyTotal;
  staged_overlap: MoneyTotal;
  extra_us_months: number;
  /** Stress cost of the extra US months (us monthly run-rate × extra months); null when the US run-rate is incomplete. */
  extra_us_usd?: number | null;
  other_commitments_usd: number | null;
  return_reserve_usd: number | null;
  need_usd_known: number;
  need_complete: boolean;
  cash_usd: number | null;
  cash_as_of: string | null;
  headroom_usd: number | null; // only when need_complete and cash known
  modeled_income_usd: number | null; // null when any income is unverified
  state: 'incomplete' | 'cash_view_ready_income_unverified' | 'complete';
  missing: string[]; // plain-language list
}

export interface BudgetView {
  scenario: ScenarioSettings;
  fx: FxView;
  lines: CostLineView[];
  by_section: Record<CostSection, MoneyTotal>;
  cash_model: CashModel; // initial (e.g. 90-day) view
  sustainability: CashModel; // 36-month view — never claims affordability with unknowns
  income: { person_id: string; status: string; monthly_usd: number | null; counted: boolean; note: string }[];
  warnings: string[];
}

export interface BudgetInputs {
  costs: BaseRecord<'cost', CostData>[];
  funding: BaseRecord<'funding', FundingData>[];
  anchors: AnchorData[];
  people: Person[];
  scenario: ScenarioSettings;
  today: string;
}

export type { DeadlineRuleData };
