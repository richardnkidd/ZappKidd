/**
 * Fictional demo household for Kadode ("local-demo" mode, tests, screenshots). SAFE TO COMMIT: every name, date,
 * amount and sentence in this file is invented. It deliberately uses the same ID schemes as the real plan
 * (W01.., S01.., Q001.., D01.., R01.., DOC01.., B01.., A01.., Y01.., evidence keys, CT-<slug> contacts, anchors
 * TN/DN/TR/DR/TP/DP/RN/RR/EHN/EHR/EPN/EPR/T/D and RULE-… deadline rules) so every screen and engine invariant can be
 * exercised without any real household data.
 *
 * The household: adults Avery (moves first, income unverified) and Jun (initial nonworking residence, planning-zero
 * income) and their dog Mochi (own pet gates and dates).
 */
import { createHash } from 'node:crypto';
import type {
  AnchorData,
  ArrivalData,
  ContactData,
  CostData,
  DeadlineRuleData,
  DecisionData,
  Deadline,
  DocumentData,
  EvidenceData,
  ExistingCommitmentData,
  FundingData,
  FutureOptionData,
  HorizonData,
  ImportBundle,
  InventoryData,
  MilestoneData,
  Money,
  Person,
  PropertyData,
  QuestionData,
  RecordType,
  RiskData,
  TaskLink,
  WorkStatus,
  WorkstreamData,
} from '../../src/shared/types';
import type { TravelerGateConfig } from '../../src/shared/engine-contracts';
import taskStore from './task-store.json';

export const DEMO_HOUSEHOLD_ID = 'demo-household';
export const DEMO_SOURCE_LABEL = 'Fictional demo';
const FILE = 'demo-plan.json';

type BundleRecord = ImportBundle['records'][number];
type Raw = Record<string, string | number | boolean | null>;

interface RecOpts {
  owner?: string | null;
  owner_proposed?: boolean;
  sheet?: string;
  raw?: Raw;
}

const rowCounters = new Map<string, number>();

function rec(type: RecordType, key: string, title: string, status: string, data: object, o: RecOpts = {}): BundleRecord {
  const row = (rowCounters.get(type) ?? 6) + 1;
  rowCounters.set(type, row);
  return {
    id: `${type}:${key}`,
    type,
    key,
    title,
    status,
    owner: o.owner ?? null,
    owner_proposed: o.owner_proposed ?? false,
    visibility: 'household',
    created_by: 'import',
    data: data as Record<string, unknown>,
    source: {
      import_run_id: '',
      file: FILE,
      sheet: o.sheet ?? type,
      row,
      cell_range: null,
      file_sha256: '',
      source_label: DEMO_SOURCE_LABEL,
      raw: o.raw ?? { ID: key, Title: title, Status: status },
    },
  };
}

const usd = (amount: number): Money => ({ amount, currency: 'USD' });
const jpy = (amount: number): Money => ({ amount, currency: 'JPY' });

/* ------------------------------------------------------------------ */
/* People and anchors                                                  */
/* ------------------------------------------------------------------ */

const PEOPLE: ImportBundle['people'] = [
  {
    id: 'avery',
    display_name: 'Avery',
    kind: 'adult',
    aliases: [],
    descriptor: null,
    anchors: { arrival: 'TN', departure: 'DN', residence: 'RN', health_eligibility: 'EHN', pension_eligibility: 'EPN' },
  },
  {
    id: 'jun',
    display_name: 'Jun',
    kind: 'adult',
    aliases: ['Joon'],
    descriptor: null,
    anchors: { arrival: 'TR', departure: 'DR', residence: 'RR', health_eligibility: 'EHR', pension_eligibility: 'EPR' },
  },
  { id: 'mochi', display_name: 'Mochi', kind: 'pet', aliases: [], descriptor: 'Dog', anchors: { arrival: 'TP', departure: 'DP' } },
];

function anchor(
  code: string,
  traveler: string,
  meaning: string,
  date: string | null,
  timezone: AnchorData['timezone'],
  confidence: AnchorData['confidence'],
  coordination = false,
): BundleRecord {
  const data: AnchorData = {
    code,
    traveler,
    meaning,
    date,
    timezone,
    confidence,
    evidence: date ? 'Tentative itinerary discussed by the household (fictional).' : null,
    coordination_only: coordination,
  };
  return rec('anchor', code, meaning, confidence, data, { sheet: 'Dates', raw: { Anchor: code, Meaning: meaning, 'Actual date': date } });
}

function buildAnchors(): BundleRecord[] {
  return [
    anchor('T', 'household', 'Household coordination arrival', '2027-07-06', 'Asia/Tokyo', 'tentative', true),
    anchor('D', 'household', 'Household coordination departure', '2027-07-05', 'Pacific/Honolulu', 'tentative', true),
    anchor('TN', 'avery', 'Avery arrival', '2027-07-06', 'Asia/Tokyo', 'tentative'),
    anchor('DN', 'avery', 'Avery departure', '2027-07-05', 'Pacific/Honolulu', 'tentative'),
    anchor('TR', 'jun', 'Jun arrival', null, 'Asia/Tokyo', 'awaiting'),
    anchor('DR', 'jun', 'Jun departure', null, 'Pacific/Honolulu', 'awaiting'),
    anchor('TP', 'mochi', 'Mochi arrival', '2027-09-14', 'Asia/Tokyo', 'tentative'),
    anchor('DP', 'mochi', 'Mochi departure / boarding', '2027-09-13', 'Pacific/Honolulu', 'tentative'),
    anchor('RN', 'avery', 'Avery residence established', null, 'Asia/Tokyo', 'awaiting'),
    anchor('RR', 'jun', 'Jun residence established', null, 'Asia/Tokyo', 'awaiting'),
    anchor('EHN', 'avery', 'Avery NHI eligibility begins', null, 'Asia/Tokyo', 'awaiting'),
    anchor('EHR', 'jun', 'Jun NHI eligibility begins', null, 'Asia/Tokyo', 'awaiting'),
    anchor('EPN', 'avery', 'Avery Category I pension eligibility', null, 'Asia/Tokyo', 'awaiting'),
    anchor('EPR', 'jun', 'Jun Category I pension eligibility', null, 'Asia/Tokyo', 'awaiting'),
  ];
}

/* ------------------------------------------------------------------ */
/* Deadline rules and existing commitments                             */
/* ------------------------------------------------------------------ */

function rule(key: string, title: string, d: Partial<DeadlineRuleData> & Pick<DeadlineRuleData, 'traveler_scope' | 'anchor' | 'offset' | 'unit' | 'direction' | 'kind'>): BundleRecord {
  const data: DeadlineRuleData = {
    label: title,
    anchor_role: null,
    jurisdiction: null,
    timezone: 'Asia/Tokyo',
    source_ids: [],
    source_url: null,
    verified_on: null,
    verification: 'not_verified',
    applies: 'unknown',
    applies_when: 'Applies once the household confirms it applies to this traveler.',
    linked_records: [],
    notes: null,
    ...d,
  };
  return rec('deadline_rule', key, title, 'active', data, { sheet: 'Dates', raw: { Deadline: title, Anchor: d.anchor, Basis: `${d.direction} ${d.offset} ${d.unit}` } });
}

function buildRules(): BundleRecord[] {
  return [
    rule('RULE-PET-NOTICE-PREP', 'Mochi notice preparation', {
      traveler_scope: 'mochi', anchor: 'TP', offset: 60, unit: 'calendar_days', direction: 'before', kind: 'internal_target',
      jurisdiction: 'JP', source_ids: ['P01'], linked_records: ['W15'], applies: 'yes',
    }),
    rule('RULE-PET-NOTICE-MIN', 'Mochi notification minimum', {
      traveler_scope: 'mochi', anchor: 'TP', offset: 40, unit: 'calendar_days', direction: 'before', kind: 'legal',
      jurisdiction: 'JP', source_ids: ['P01'], linked_records: ['W15'], applies: 'yes', verification: 'indexed_only', verified_on: '2026-10-20',
    }),
    rule('RULE-PET-EXAM-WINDOW', 'Mochi examination window opens', {
      traveler_scope: 'mochi', anchor: 'DP', offset: 10, unit: 'calendar_days', direction: 'before', kind: 'legal',
      jurisdiction: 'US-HI', timezone: 'Pacific/Honolulu', source_ids: ['P01'], linked_records: ['W16'], applies: 'yes',
    }),
    rule('RULE-PET-LOCAL-REGISTRATION', 'Mochi local registration', {
      traveler_scope: 'mochi', anchor: 'TP', offset: 30, unit: 'calendar_days', direction: 'after', kind: 'legal',
      jurisdiction: 'JP-Tokyo', source_ids: ['P01'], applies: 'unknown',
    }),
    rule('RULE-RESIDENCE-NOTICE', 'Residence notification (each adult)', {
      traveler_scope: 'each_adult', anchor: 'RN', anchor_role: 'residence', offset: 14, unit: 'calendar_days', direction: 'after',
      kind: 'legal', jurisdiction: 'JP-Tokyo', source_ids: ['TA01'], applies: 'yes', verification: 'indexed_only', verified_on: '2026-10-20',
    }),
    rule('RULE-HEALTH-NOTICE', 'Health insurance notice (each adult)', {
      traveler_scope: 'each_adult', anchor: 'EHN', anchor_role: 'health_eligibility', offset: 14, unit: 'calendar_days', direction: 'after',
      kind: 'legal', jurisdiction: 'JP-Tokyo', source_ids: ['TA04'], applies: 'unknown',
    }),
    rule('RULE-BAGGAGE-OUTER', 'Unaccompanied baggage outer window (each adult)', {
      traveler_scope: 'each_adult', anchor: 'TN', anchor_role: 'arrival', offset: 6, unit: 'calendar_months', direction: 'after',
      kind: 'legal', jurisdiction: 'JP', source_ids: ['C01'], applies: 'yes',
    }),
    rule('RULE-AVERY-RELEASE', 'Avery final departure release', {
      traveler_scope: 'avery', anchor: 'DN', offset: 0, unit: 'calendar_days', direction: 'after', kind: 'internal_target',
      jurisdiction: 'household', timezone: 'Pacific/Honolulu', linked_records: ['W24'], applies: 'yes', notes: 'Internal proposal.',
    }),
    rule('RULE-JUN-RELEASE', 'Jun final departure release', {
      traveler_scope: 'jun', anchor: 'DR', offset: 0, unit: 'calendar_days', direction: 'after', kind: 'internal_target',
      jurisdiction: 'household', timezone: 'Pacific/Honolulu', linked_records: ['W25'], applies: 'yes', notes: 'Internal proposal.',
    }),
    rule('RULE-READINESS-REVIEW', 'Household readiness review', {
      traveler_scope: 'household', anchor: 'T', offset: 14, unit: 'calendar_days', direction: 'before', kind: 'internal_target',
      jurisdiction: 'household', notes: 'Coordination only — each traveler\'s own dates govern.',
    }),
    rule('RULE-FIRST-MONTH-REVIEW', 'First-month review', {
      traveler_scope: 'household', anchor: 'T', offset: 30, unit: 'calendar_days', direction: 'after', kind: 'internal_target', jurisdiction: 'household',
    }),
    rule('RULE-DAY90-REVIEW', 'Transition closure review (day 90)', {
      traveler_scope: 'household', anchor: 'T', offset: 90, unit: 'calendar_days', direction: 'after', kind: 'internal_target', jurisdiction: 'household',
    }),
  ];
}

function commitment(key: string, title: string, date: string | null, kind: ExistingCommitmentData['deadline_kind'], meaning: string, caution: string, linked: string[] = []): BundleRecord {
  const data: ExistingCommitmentData = { recorded_date: date, meaning, deadline_kind: kind, evidence_caution: caution, linked_records: linked };
  return rec('existing_commitment', key, title, 'open', data, { sheet: 'Dates', raw: { 'Existing obligation': title, 'Recorded date': date, Meaning: meaning } });
}

function buildCommitments(): BundleRecord[] {
  return [
    commitment('EC-GYM', 'Gym membership transfer', '2026-11-30', 'user_committed', 'Existing deadline; outcome unverified', 'Confirm the transfer was accepted before relying on it.', ['W20']),
    commitment('EC-STORAGE', 'Storage review', '2026-12-18', 'user_committed', 'Verify current contract', 'The contract has not been read yet.', ['W23']),
    commitment('EC-STORAGE-PAY', 'Storage next recorded payment', '2027-01-20', 'estimate', 'Recorded date; verify contract', 'A recorded date is not a contract term.', ['W23']),
    commitment('EC-OLD-PASSPORT', 'Passport task old due date', '2026-08-15', 'review_date', 'Historical task date, not passport expiry', 'An old task date does not show the work was left undone.', ['W06']),
  ];
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MS: MilestoneData = {
  work_area: '', workstream_key: null, next_action: '', source_status: '', status_reason: null, completion_criteria: '',
  completion_evidence: [], contingency: '', collaborators: [], priority: null, effort_estimate: null, dependencies: [],
  dependency_note: null, review_date: null, target_window: '', deadline: null, traveler_scope: [], phase: null,
  optional_future_work: false, conditional: null, parent_key: null, queue_disposition: null, linked_task_ids: [],
  source_ids: [],
};

function ms(key: string, title: string, status: WorkStatus, owner: string, d: Partial<MilestoneData> & { owner_proposed?: boolean } = {}): BundleRecord {
  const { owner_proposed, ...rest } = d;
  const data: MilestoneData = { ...DEFAULT_MS, source_status: STATUS_TEXT[status], ...rest };
  return rec('milestone', key, title, status, data, {
    owner,
    owner_proposed: owner_proposed ?? false,
    sheet: 'Milestones',
    raw: { ID: key, Milestone: title, Status: data.source_status, 'Proposed owner': owner },
  });
}

const STATUS_TEXT: Record<WorkStatus, string> = {
  planned: 'Planned', in_progress: 'In progress', blocked: 'Waiting', waiting_external: 'Waiting on others',
  completed: 'Answered', eliminated: 'Dropped', not_applicable: 'Not applicable',
};

function ruleDeadline(ruleId: string, traveler: string, anchorCode: string, offset: number, kind: Deadline['kind'], basis: string, extra: Partial<Deadline> = {}): Deadline {
  return {
    date: null, kind, basis, source_ids: [], jurisdiction: null, timezone: 'Asia/Tokyo', verified_on: null, traveler,
    rule_id: ruleId, anchor: anchorCode, offset, unit: 'calendar_days', ...extra,
  };
}

const DONE = (summary: string) => [{ at: '2026-10-20T18:00:00Z', by: 'avery', summary, link: null }];

function buildMilestones(): BundleRecord[] {
  const out: BundleRecord[] = [];
  out.push(
    ms('W01', 'Confirm target month and three-year scope', 'completed', 'together', {
      work_area: 'Scope', workstream_key: 'S01', next_action: 'Keep the confirmed scope; choose exact dates in W27.',
      completion_criteria: 'Both adults confirmed the target month and the intended stay.', completion_evidence: DONE('Both adults confirmed the scope on a call (fictional).'),
      source_status: 'Answered', phase: 'p1_now_nov2026', priority: 'now', source_ids: ['USER02'], review_date: '2026-11-11',
    }),
    ms('W02', "Establish Avery's residence route", 'in_progress', 'avery', {
      work_area: 'Immigration', workstream_key: 'S02', next_action: 'Ask the adviser which route fits the planned activities.',
      completion_criteria: 'Written route, document list and timing from the adviser.', collaborators: ['Immigration adviser'],
      dependencies: ['W01', 'W04'], traveler_scope: ['avery'], phase: 'p2_nov_dec2026', priority: 'now', source_ids: ['I01'],
      target_window: 'Nov-Dec route; filing on adviser schedule', review_date: '2026-11-11',
    }),
    ms('W03', "Establish Jun's nonworking residence route", 'blocked', 'jun', {
      owner_proposed: true, work_area: 'Immigration', workstream_key: 'S03',
      next_action: 'Assess a lawful nonworking route once the first route is known.', completion_criteria: 'Written lawful nonworking route and support evidence.',
      status_reason: "Waiting on Avery's residence route (W02) and the passport check (W06).", source_status: 'Waiting',
      collaborators: ['Immigration adviser'], dependencies: ['W01', 'W02', 'W06'], traveler_scope: ['jun'], phase: 'p2_nov_dec2026', priority: 'now',
      source_ids: ['I01', 'USER02'], dependency_scope: { W02: ['jun'] },
    }),
    ms('W04', "Clarify Avery's employer support", 'waiting_external', 'avery', {
      work_area: 'Employer support', workstream_key: 'S02', next_action: 'Wait for the employer to answer the written request.',
      status_reason: 'Waiting for the employer to reply.', completion_criteria: 'Dated employer response saying what is and is not offered.',
      traveler_scope: ['avery'], phase: 'p1_now_nov2026', priority: 'now', source_status: 'No arrangements yet', review_date: '2026-11-11',
    }),
    ms('W05', 'Explore optional freelance work only if Jun later chooses work', 'planned', 'jun', {
      work_area: 'Future work', workstream_key: 'S05', next_action: 'Nothing to do now. Revisit only if Jun decides to explore work.',
      optional_future_work: true, conditional: 'Only if Jun later chooses to work.', source_status: 'Deferred — conditional',
      dependencies: ['W03'], phase: 'p7_three_year', priority: 'someday', target_window: 'No initial move deadline',
    }),
    ms('W06', 'Verify both passports and renewal outcomes', 'in_progress', 'together', {
      work_area: 'Passports', workstream_key: 'S04', next_action: 'Check expiry dates and any renewal receipts.', source_status: 'Existing; verify',
      completion_criteria: 'Verified passport details and an accepted validity plan.', traveler_scope: ['avery', 'jun'], phase: 'p1_now_nov2026', priority: 'now',
      linked_task_ids: ['tl-fixture-FX-0001'], queue_disposition: 'existing queue / preserve status and receipts', review_date: '2026-11-11',
      deadline: { date: '2026-11-11', kind: 'user_committed', basis: 'The household agreed to check this by the first review.', source_ids: [], jurisdiction: 'household', timezone: 'Pacific/Honolulu', verified_on: null, traveler: 'household' },
    }),
    ms('W07', 'Build the route-specific immigration document set', 'in_progress', 'together', {
      work_area: 'Documents', workstream_key: 'S04', next_action: 'List documents per adult once each route is known.',
      completion_criteria: 'Adviser-accepted checklist per adult.', dependencies: ['W02', 'W03', 'W06'], dependency_scope: { W02: ['avery'], W03: ['jun'] },
      traveler_scope: ['avery', 'jun'], phase: 'p3_jan_mar2027', priority: 'soon',
      traveler_progress: {
        avery: { status: 'completed', reason: null, evidence: DONE("Avery's document checklist accepted by the adviser (fictional)."), updated_at: '2026-10-22T10:00:00Z', updated_by: 'avery' },
        jun: { status: 'planned', reason: null, evidence: [], updated_at: null, updated_by: null },
      },
      review_note: "Shared row: Avery's part does not wait on Jun's route.",
    }),
    ms('W08', 'Get a coordinated US-Japan tax review', 'planned', 'together', {
      owner_proposed: true, work_area: 'Tax', workstream_key: 'S06', next_action: 'Share residency and income facts with a qualified adviser.',
      collaborators: ['Tax adviser'], dependencies: ['W01', 'W04'], traveler_scope: ['avery', 'jun'], phase: 'p2_nov_dec2026', priority: 'soon',
      target_window: 'Nov-Dec before major transfers',
    }),
    ms('W09', 'Approve move, rent and reserve limits', 'planned', 'together', {
      work_area: 'Funding', workstream_key: 'S07', next_action: 'Agree limits after the cash and cost inputs are filled in.',
      dependencies: ['W04', 'W08'], phase: 'p2_nov_dec2026', priority: 'soon', completion_criteria: 'Dated, approved limits (see decision D04).',
    }),
    ms('W10', 'Populate and approve budget scenarios', 'in_progress', 'together', {
      work_area: 'Budget', workstream_key: 'S07', next_action: 'Fill in quotes and the exchange rate on the Money screen.', dependencies: ['W09'],
      phase: 'p2_nov_dec2026', priority: 'soon', completion_criteria: 'Complete sourced inputs and a recorded funding decision.',
    }),
    ms('W11', 'Verify foreign-residence account policies', 'planned', 'jun', {
      work_area: 'Banking', workstream_key: 'S08', next_action: 'List accounts and check each institution\'s policy for Japan residents.',
      dependencies: ['W01', 'W08'], traveler_scope: ['jun'], phase: 'p3_jan_mar2027', priority: 'later',
    }),
    ms('W12', "Reconcile Mochi's identity, health and history", 'in_progress', 'jun', {
      work_area: 'Pet', workstream_key: 'S09', next_action: 'Collect current vet records and microchip details.', collaborators: ['Veterinarian'],
      traveler_scope: ['mochi'], phase: 'p2_nov_dec2026', priority: 'now', completion_criteria: 'Vet records with identity matched and gaps resolved.', source_ids: ['P01'],
    }),
    ms('W13', 'Confirm the pet import route', 'blocked', 'jun', {
      work_area: 'Pet', workstream_key: 'S09', next_action: 'Ask the authority which route applies once records are complete.',
      status_reason: 'Waiting on the vet records (W12).', source_status: 'Waiting', dependencies: ['W12'], traveler_scope: ['mochi'],
      phase: 'p2_nov_dec2026', priority: 'soon', collaborators: ['Veterinarian'], source_ids: ['P01'],
    }),
    ms('W14', 'Confirm airline and crate feasibility', 'planned', 'avery', {
      work_area: 'Pet travel', workstream_key: 'S09', next_action: 'Compare carrier rules for the planned season.', dependencies: ['W12', 'W13'],
      traveler_scope: ['mochi'], phase: 'p3_jan_mar2027', priority: 'later', source_ids: ['P01'],
    }),
    ms('W15', 'Prepare the pet import notification and get a response', 'planned', 'jun', {
      work_area: 'Pet', workstream_key: 'S09', next_action: 'Prepare using the actual arrival airport and date.', dependencies: ['W13', 'W14'],
      traveler_scope: ['mochi'], phase: 'p4_stage_minus_90', priority: 'later', source_ids: ['P01'],
      target_window: 'Internal 60 days before arrival; official minimum 40 days before.',
      deadline: ruleDeadline('RULE-PET-NOTICE-PREP', 'mochi', 'TP', -60, 'internal_target', 'Internal target: 60 days before Mochi\'s Japan arrival.', { source_ids: ['P01'], jurisdiction: 'JP' }),
    }),
    ms('W16', 'Complete the export exam and certification', 'planned', 'jun', {
      work_area: 'Pet', workstream_key: 'S09', next_action: 'Book the accredited vet and endorsement well ahead.', dependencies: ['W13', 'W15'],
      traveler_scope: ['mochi'], phase: 'p5_final_60_30_14', priority: 'later', collaborators: ['Veterinarian'], source_ids: ['P01'],
      deadline: ruleDeadline('RULE-PET-EXAM-WINDOW', 'mochi', 'DP', -10, 'legal', 'The exam window opens 10 days before boarding.', { source_ids: ['P01'], jurisdiction: 'US-HI', timezone: 'Pacific/Honolulu' }),
    }),
    ms('W17', "Reconcile both adults' current treatment needs", 'planned', 'together', {
      work_area: 'Care', workstream_key: 'S10', next_action: 'Each adult confirms current medicines with their own clinician.', collaborators: ['Clinicians'],
      traveler_scope: ['avery', 'jun'], phase: 'p2_nov_dec2026', priority: 'soon', completion_criteria: 'Clinician-approved list for each adult.',
    }),
    ms('W18', 'Verify Tokyo clinician and pharmacy continuity', 'planned', 'together', {
      work_area: 'Care', workstream_key: 'S10', next_action: 'Only start if a current medicine needs permission.', conditional: 'Only if a current medicine needs permission.',
      dependencies: ['W17'], traveler_scope: ['avery', 'jun'], phase: 'p3_jan_mar2027', priority: 'later',
    }),
    ms('W19', 'Choose a housing shortlist', 'planned', 'avery', {
      work_area: 'Housing', workstream_key: 'S11', next_action: 'Draft criteria: pets allowed, commute, lease eligibility.', dependencies: ['W10'],
      phase: 'p3_jan_mar2027', priority: 'later',
    }),
    ms('W20', 'Cancel the gym membership', 'eliminated', 'jun', {
      work_area: 'US accounts', workstream_key: 'S12', next_action: 'None.', status_reason: 'Superseded: the membership is being transferred instead.',
      phase: 'p4_stage_minus_90', source_status: 'Dropped',
    }),
    ms('W21', 'Change the mailing address', 'not_applicable', 'avery', {
      work_area: 'US accounts', workstream_key: 'S12', next_action: 'None.', status_reason: 'The household keeps its US mailing address.',
      phase: 'p4_stage_minus_90', source_status: 'Not applicable',
    }),
    ms('W22', 'Collect mover quotes', 'planned', 'together', {
      work_area: 'Shipping', workstream_key: 'S13', next_action: 'Request written quotes once the inventory is reviewed.', dependencies: ['W19'],
      phase: 'p3_jan_mar2027', priority: 'later', review_date: '2026-11-11', target_window: 'Quote only — nothing is booked.',
    }),
    ms('W23', 'Review the storage contract', 'in_progress', 'avery', {
      work_area: 'Property', workstream_key: 'S13', next_action: 'Read the contract and note the real payment dates.', source_status: 'Existing; verify',
      phase: 'p1_now_nov2026', priority: 'now', linked_task_ids: ['tl-fixture-FX-0002'], completion_criteria: 'Contract terms recorded.',
    }),
    ms('W24', 'Release Avery to travel', 'planned', 'avery', {
      work_area: 'Departure', workstream_key: 'S14', next_action: 'Final check of Avery\'s gates, then an explicit go-ahead.', traveler_scope: ['avery'],
      dependencies: ['W02', 'W07'], phase: 'p5_final_60_30_14', priority: 'later',
      deadline: ruleDeadline('RULE-AVERY-RELEASE', 'avery', 'DN', 0, 'internal_target', 'Internal proposal: release on the actual departure date.', { jurisdiction: 'household', timezone: 'Pacific/Honolulu' }),
    }),
    ms('W25', 'Release Jun to travel', 'planned', 'jun', {
      work_area: 'Departure', workstream_key: 'S14', next_action: 'Final check of Jun\'s gates, then an explicit go-ahead.', traveler_scope: ['jun'],
      dependencies: ['W03', 'W07'], dependency_scope: { W07: ['jun'] }, phase: 'p5_final_60_30_14', priority: 'later',
      deadline: ruleDeadline('RULE-JUN-RELEASE', 'jun', 'DR', 0, 'internal_target', 'Internal proposal: release on the actual departure date.', { jurisdiction: 'household', timezone: 'Pacific/Honolulu' }),
    }),
    ms('W26', 'Release Mochi to travel', 'planned', 'jun', {
      work_area: 'Departure', workstream_key: 'S14', next_action: "Final check of Mochi's gates.", traveler_scope: ['mochi'], dependencies: ['W16'],
      phase: 'p5_final_60_30_14', priority: 'later',
    }),
    ms('W27', 'Day-90 transition review', 'planned', 'together', {
      work_area: 'Settling in', workstream_key: 'S15', next_action: 'Review residence, coverage, pet and costs.', phase: 'p6_departure_to_day90', priority: 'later',
      deadline: ruleDeadline('RULE-DAY90-REVIEW', 'household', 'T', 90, 'internal_target', "Household coordination helper — each traveler's own dates govern.", { jurisdiction: 'household' }),
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* The other record families                                           */
/* ------------------------------------------------------------------ */

function buildWorkstreams(): BundleRecord[] {
  const defs: [string, string, WorkStatus, string, string[]][] = [
    ['S01', 'Scope, decisions and durable plan', 'in_progress', 'together', ['S02']],
    ['S02', "Avery's immigration and employer support", 'in_progress', 'avery', ['S01', 'S04']],
    ['S03', "Jun's initial nonworking residence", 'blocked', 'jun', ['S02']],
    ['S04', 'Passports and civil documents', 'in_progress', 'together', ['S02', 'S03']],
    ['S05', 'Optional future work', 'planned', 'jun', ['S03']],
    ['S06', 'Tax, pensions and social insurance', 'planned', 'together', ['S02']],
    ['S07', 'Budget, funding and return reserve', 'planned', 'together', ['S06']],
    ['S08', 'Banking and remittances', 'planned', 'jun', ['S06', 'S07']],
    ['S09', 'Mochi: import, transport and care', 'in_progress', 'jun', ['S01']],
    ['S10', 'Medicines and care', 'planned', 'together', []],
    ['S11', 'Tokyo housing', 'planned', 'avery', ['S07']],
    ['S12', 'US accounts and subscriptions', 'planned', 'jun', []],
    ['S13', 'Property, storage and shipping', 'planned', 'together', ['S07']],
    ['S14', 'Departure releases', 'planned', 'together', ['S02', 'S03', 'S09']],
    ['S15', 'Settling in and the first 90 days', 'planned', 'together', ['S14']],
  ];
  return defs.map(([key, title, status, owner, related]) => {
    const data: WorkstreamData = {
      next_action: `Next step for ${title.toLowerCase()} (fictional).`, done_evidence: 'Evidence recorded in the linked milestones.',
      source_status: STATUS_TEXT[status], status_reason: status === 'blocked' ? 'Waiting on Avery\'s route.' : null,
      related, related_note: null, milestone_keys: [], question_keys: [], collaborators: [],
    };
    return rec('workstream', key, title, status, data, { owner, owner_proposed: true, sheet: 'Workstreams', raw: { ID: key, Workstream: title } });
  });
}

function question(key: string, ws: string, topic: string, disposition: QuestionData['disposition'], d: Partial<QuestionData> = {}): BundleRecord {
  const sourceDisposition = { question: 'Question', carry_forward: 'Carry forward', waiting_blocked: 'Waiting', already_answered: 'Answered', not_applicable: 'Not applicable', explicitly_excluded: 'Excluded' }[disposition];
  const data: QuestionData = {
    workstream_key: ws, topic, disposition, source_disposition: sourceDisposition, local_disposition: null, known: '', question: `What do we still need to know about: ${topic.toLowerCase()}?`,
    when_trigger: 'First review: November 11, 2026', evidence_basis: 'Household conversation (fictional).', answer: null, local_note: null, relevance: [], ...d,
  };
  const status = disposition === 'already_answered' ? 'answered' : disposition === 'not_applicable' ? 'not_applicable' : disposition === 'explicitly_excluded' ? 'excluded' : 'open';
  return rec('question', key, topic, status, data, { owner: 'together', owner_proposed: true, sheet: 'Questionnaire', raw: { ID: key, Topic: topic, 'Coverage status': sourceDisposition } });
}

function buildQuestions(): BundleRecord[] {
  return [
    question('Q001', 'S01', 'Destination and month', 'already_answered', { known: 'The destination and target month are confirmed.', answer: 'Confirmed by both adults.', relevance: ['W01'] }),
    question('Q002', 'S01', 'Duration and staging', 'already_answered', { known: 'Intended three-year stay; Jun and Mochi may arrive later.', answer: 'Yes.', relevance: ['W01', 'jun', 'mochi'] }),
    question('Q003', 'S01', 'Durable home and decision rhythm', 'question', { question: 'Do we accept one shared planning home and a short weekly review?', relevance: ['D02'] }),
    question('Q004', 'S02', "Avery's employer arrangement", 'carry_forward', { known: 'The employer has not replied yet.', question: 'Nothing new to ask until the reply arrives.', local_disposition: 'carry forward', relevance: ['W04', 'avery'] }),
    question('Q005', 'S02', "Avery's current Japanese status", 'already_answered', { known: 'No current status.', answer: 'None.', relevance: ['W02', 'avery'] }),
    question('Q006', 'S03', "Jun's residence route", 'waiting_blocked', { known: 'Jun does not plan to work initially.', question: 'Which lawful nonworking route applies once Avery\'s route is known?', relevance: ['W03', 'jun'] }),
    question('Q007', 'S04', 'Both passports', 'question', { question: 'When does each passport expire and was any renewal started?', relevance: ['W06'] }),
    question('Q008', 'S09', "Mochi's records", 'question', { question: 'Do the vet records show a readable microchip and full history?', relevance: ['W12', 'mochi'] }),
    question('Q009', 'S09', 'Mochi return route', 'not_applicable', { known: 'No return trip is planned for the pet.', local_note: 'Marked not applicable after the household decision.', relevance: ['mochi'] }),
    question('Q010', 'S05', 'Commercial rights for personal projects', 'explicitly_excluded', { known: 'Outside the move.', local_note: 'Excluded on purpose: optional future work.', relevance: ['W05'] }),
    question('Q011', 'S10', 'Medicine continuity', 'carry_forward', { known: 'Historical notes are not current prescriptions.', local_disposition: 'carry forward', relevance: ['W17', 'W18'] }),
    question('Q012', 'S11', 'Housing budget', 'question', { question: 'What monthly rent is comfortable for the first year?', relevance: ['W19', 'D04'] }),
  ];
}

function decision(key: string, title: string, rec_text: string, state: string, d: Partial<DecisionData> = {}): BundleRecord {
  const data: DecisionData = {
    question: title,
    options: [{ id: 'opt-1', label: rec_text, consequences: null, source: 'imported' }],
    recommended_option_id: 'opt-1',
    recommendation_text: rec_text,
    rationale: null,
    needed_by: null,
    trigger: 'First review: November 11, 2026',
    consequence_of_delay: null,
    dependencies: [],
    acceptance_evidence: 'Both adults approve in the app.',
    source_status: state === 'approved' ? 'Scope confirmed' : 'Open — proposed',
    required_approvers: ['avery', 'jun'],
    approvals: [],
    decided_option_id: null,
    decided_at: null,
    history_note: 'Only the imported recommendation is recorded. Add alternatives here when you have considered them.',
    related: [],
    ...d,
  };
  return rec('decision', key, title, state, data, { owner: 'together', owner_proposed: true, sheet: 'Decisions', raw: { ID: key, Decision: title, 'Recommended choice': rec_text } });
}

function buildDecisions(): BundleRecord[] {
  return [
    decision('D01', 'Confirmed move scope', 'Target month confirmed; three-year intent; Jun and Mochi can follow later.', 'approved', {
      approvals: [
        { person_id: 'avery', at: '2026-10-20T18:00:00Z', option_id: 'opt-1', note: null },
        { person_id: 'jun', at: '2026-10-20T18:05:00Z', option_id: 'opt-1', note: 'Agreed.' },
      ],
      decided_option_id: 'opt-1', decided_at: '2026-10-20T18:05:00Z', related: ['S01'],
    }),
    decision('D02', 'Select the durable plan home', 'Use this app for the plan and keep the existing task list as the only action queue.', 'open', { related: ['S01'] }),
    decision('D03', "Avery's employer-support route", "Establish Avery's real activity and whether the employer will support a qualifying route.", 'open', {
      needed_by: { date: '2026-11-30', kind: 'user_committed', basis: 'Before any housing commitment.', source_ids: [], jurisdiction: 'household', timezone: 'Pacific/Honolulu', verified_on: null, traveler: 'avery' },
      consequence_of_delay: 'Housing and flights cannot be committed.', related: ['S02'],
    }),
    decision('D04', 'Move, rent and reserve limits', 'Set cash-based limits with a protected return reserve.', 'proposed', {
      approvals: [{ person_id: 'avery', at: '2026-10-21T09:00:00Z', option_id: 'opt-1', note: 'Fine with these limits.' }],
      related: ['S07'],
    }),
    decision('D05', "Mochi's travel stage", "Mochi follows Jun; choose the actual stage after the import and carrier checks.", 'deferred', {
      options: [
        { id: 'opt-1', label: 'Mochi follows Jun on a later flight.', consequences: null, source: 'imported' },
        { id: 'opt-2', label: 'Mochi travels with Avery in July.', consequences: 'Needs the import notice about two months earlier.', source: 'household' },
      ],
      history_note: 'Deferred until the vet records are complete.', related: ['S09'],
    }),
  ];
}

function risk(key: string, title: string, kind: RiskData['raid_kind'], severity: RiskData['severity'], linked: string[]): BundleRecord {
  const data: RiskData = {
    raid_kind: kind, trigger: `What would show that "${title.toLowerCase()}" is happening (fictional).`, mitigation: 'Check early and keep alternatives open.',
    fallback: 'Delay the affected stage and use funded temporary arrangements.', review_basis: 'Each commitment gate', severity, escalation_trigger: severity === 'critical' ? 'Any sign of delay beyond one month.' : null,
    linked_records: linked,
  };
  return rec('risk', key, title, 'open', data, { owner: 'together', owner_proposed: true, sheet: 'Risks', raw: { ID: key, Risk: title, Severity: severity } });
}

function buildRisks(): BundleRecord[] {
  return [
    risk('R01', "Avery's route is not established in time", 'risk', 'critical', ['W02', 'W04']),
    risk('R02', 'Initial funding assumes only verified income', 'assumption', 'high', ['W09', 'W10']),
    risk('R03', "Mochi's records are incomplete", 'issue', 'high', ['W12', 'W13']),
    risk('R04', "Jun's route depends on Avery's route", 'dependency', 'medium', ['W03', 'W02']),
    risk('R05', 'Storage contract differs from the recorded dates', 'risk', 'low', ['W23']),
  ];
}

function doc(key: string, title: string, d: Partial<DocumentData>): BundleRecord {
  const data: DocumentData = {
    for_whom: 'Each adult', traveler_scope: [], custodian: 'Each document holder (proposed)', needed_by: 'Before route filing', validity: 'Verify actual validity',
    completion_criteria: 'Original inspected; status recorded', source_status: 'Not yet verified', privacy: 'Restricted originals; the plan holds status and a link only',
    requested_at: null, received_at: null, reviewed_at: null, accepted_by_authority_at: null, accepted_by: null, expiry: null, refresh_trigger: null, link: null,
    linked_records: [], ...d,
  };
  const status = data.accepted_by_authority_at ? 'accepted' : data.reviewed_at ? 'reviewed' : data.received_at ? 'received' : data.requested_at ? 'requested' : 'not_started';
  return rec('document', key, title, status, data, { owner: data.custodian.includes('Avery') ? 'avery' : 'together', owner_proposed: true, sheet: 'Documents', raw: { ID: key, Document: title } });
}

function buildDocuments(): BundleRecord[] {
  return [
    doc('DOC01', 'Move scope and decision receipt', { for_whom: 'Household', source_status: 'Scope confirmed', received_at: '2026-10-20', reviewed_at: '2026-10-20', linked_records: ['W01'] }),
    doc('DOC02', 'Passports and renewal receipts', { traveler_scope: ['avery', 'jun'], requested_at: '2026-10-22', linked_records: ['W06'], expiry: null }),
    doc('DOC03', 'Marriage and civil records with translations', { for_whom: 'Both adults', traveler_scope: ['avery', 'jun'], linked_records: ['W07'] }),
    doc('DOC04', "Avery's employer support letter", { for_whom: 'Avery', traveler_scope: ['avery'], requested_at: '2026-10-24', linked_records: ['W04'], refresh_trigger: 'Refresh near filing' }),
    doc('DOC05', "Jun's nonworking route determination", { for_whom: 'Jun', traveler_scope: ['jun'], linked_records: ['W03'] }),
    doc('DOC06', "Mochi's vet records and microchip details", { for_whom: 'Mochi', traveler_scope: ['mochi'], requested_at: '2026-10-18', received_at: '2026-10-25', source_status: 'Received; not yet reviewed', linked_records: ['W12'], expiry: '2027-03-31' }),
    doc('DOC07', "Mochi's export certificate", { for_whom: 'Mochi', traveler_scope: ['mochi'], needed_by: 'Within the boarding window', linked_records: ['W16'], refresh_trigger: 'Reissue if travel dates change' }),
    doc('DOC08', 'Storage contract', { for_whom: 'Household', received_at: '2026-10-15', reviewed_at: '2026-10-26', accepted_by: null, linked_records: ['W23'] }),
  ];
}

interface CostSpec { section: CostData['section']; category: string; description: string; d: Partial<CostData> }

function cost(key: string, s: CostSpec): BundleRecord {
  const data: CostData = {
    section: s.section, source_section: { one_time: 'One-time', tokyo_monthly: 'Tokyo monthly', us_monthly: 'US monthly', staged_overlap: 'Staged overlap', reserve: 'Reserve' }[s.section],
    category: s.category, description: s.description, applicability: 'include', exclusion_reason: null, estimate: null, quote: null, committed: null, paid: null,
    unpaid_balance: null, payer: null, quote_source: null, quote_date: null, deposit_due: null, refundable: 'unknown', uncertainty: 'Unquoted',
    commitment_state: 'not_committed', phase: null, duplication_check: null, ...s.d,
  };
  return rec('cost', key, s.category, data.commitment_state, data, { sheet: 'Cost Inputs', raw: { ID: key, Category: s.category, Applicability: data.applicability } });
}

function buildCosts(): BundleRecord[] {
  return [
    cost('B01', { section: 'one_time', category: 'Immigration and advice', description: 'Routes, applications, adviser time and translations for both adults', d: { applicability: 'review' } }),
    cost('B02', { section: 'one_time', category: 'Packing and sea freight', description: 'Packing and sea freight for household goods', d: { estimate: usd(6200), quote: usd(6800), unpaid_balance: usd(6800), commitment_state: 'quote', quote_source: 'Written quote, Northgate Movers (fictional)', quote_date: '2026-10-12', refundable: 'partial', uncertainty: 'Quoted; volume may change' } }),
    cost('B03', { section: 'one_time', category: 'Mochi preparation', description: 'Vet exams, certificate endorsement and import route', d: { estimate: usd(1900), unpaid_balance: usd(1900), commitment_state: 'estimate', uncertainty: 'Estimate from a clinic price list' } }),
    cost('B04', { section: 'one_time', category: 'Tokyo apartment deposit', description: 'Deposit and key money for the first apartment', d: { quote: jpy(960000), unpaid_balance: jpy(960000), commitment_state: 'quote', quote_source: 'Listing agent estimate (fictional)', quote_date: '2026-10-18', refundable: 'partial', uncertainty: 'Not yet applied for' } }),
    cost('B05', { section: 'one_time', category: 'Passport renewals', description: 'Renewal fees paid in full', d: { committed: usd(260), paid: usd(260), unpaid_balance: usd(0), commitment_state: 'paid', refundable: 'no', uncertainty: 'Paid' } }),
    cost('B06', { section: 'one_time', category: 'Language lessons deposit', description: 'Deposit paid; balance due before the first class', d: { quote: usd(1200), paid: usd(300), unpaid_balance: usd(900), commitment_state: 'partially_paid', deposit_due: '2026-12-01', refundable: 'partial' } }),
    cost('B07', { section: 'one_time', category: 'Furniture purchase', description: 'Not needed: the apartment is furnished', d: { applicability: 'exclude', exclusion_reason: 'Furnished apartment chosen; revisit if that changes.' } }),
    cost('B08', { section: 'tokyo_monthly', category: 'Tokyo rent', description: 'Monthly rent for the first apartment', d: { estimate: jpy(185000), uncertainty: 'Market range, no listing chosen' } }),
    cost('B09', { section: 'tokyo_monthly', category: 'Utilities and internet', description: 'Monthly utilities and internet', d: {} }),
    cost('B10', {
      section: 'tokyo_monthly', category: "Jun's health insurance", description: "Monthly premium that starts when Jun's eligibility begins",
      d: { estimate: jpy(18000), phase: { traveler: 'jun', start_anchor: 'EHR', start_date: null, end_anchor: null, end_date: null, months: null, note: "Starts at Jun's eligibility date, which is not set yet." } },
    }),
    cost('B11', { section: 'us_monthly', category: 'Storage unit', description: 'Monthly storage rent', d: { estimate: usd(145), commitment_state: 'estimate', uncertainty: 'From the recorded payment; contract not read' } }),
    cost('B12', { section: 'us_monthly', category: 'US mortgage', description: 'Monthly payment on the US home', d: { committed: usd(1750), commitment_state: 'approved_commitment', uncertainty: 'Fixed payment' } }),
    cost('B13', { section: 'us_monthly', category: 'Car insurance', description: 'Policy cancelled when the car is sold', d: { applicability: 'exclude', exclusion_reason: 'Car sold; policy cancelled.' } }),
    cost('B14', {
      section: 'staged_overlap', category: "Jun's extra US living", description: "US living costs for Jun while Avery is already in Tokyo; not counted in other lines",
      d: { estimate: usd(900), phase: { traveler: 'jun', start_anchor: 'TN', start_date: null, end_anchor: 'TR', end_date: null, months: null, note: "Ends when Jun's arrival date is set." }, duplication_check: 'Checked against B11 and B12' },
    }),
    cost('B15', {
      section: 'staged_overlap', category: "Mochi's Hawaii boarding", description: "Boarding while Mochi waits to follow", d: {
        estimate: usd(350), phase: { traveler: 'mochi', start_anchor: 'TN', start_date: null, end_anchor: 'TP', end_date: null, months: null, note: null },
      },
    }),
    cost('B16', { section: 'staged_overlap', category: 'Extra rent while both homes run', description: 'A short overlap with an agreed length', d: { estimate: usd(500), phase: { traveler: null, start_anchor: null, start_date: null, end_anchor: null, end_date: null, months: 2, note: 'Agreed two-month overlap.' } } }),
  ];
}

function fund(key: string, title: string, d: Partial<FundingData> & Pick<FundingData, 'kind'>): BundleRecord {
  const data: FundingData = { person_id: null, amount: null, as_of: null, source: null, evidence: null, ...d };
  return rec('funding', key, title, data.amount || (data.kind === 'fx_rate' && data.jpy_per_usd) ? 'recorded' : 'unknown', data, { sheet: 'Budget', raw: { Item: title } });
}

function buildFunding(): BundleRecord[] {
  return [
    fund('CASH', 'Current unrestricted cash', { kind: 'cash_snapshot', amount: usd(62000), as_of: '2026-10-20', source: 'Demo account snapshot (fictional)' }),
    fund('RESERVE', 'Return reserve', { kind: 'return_reserve', amount: usd(12000), as_of: '2026-10-20', source: 'Household decision (fictional)' }),
    fund('OTHER', 'Other unpaid commitments', { kind: 'other_commitments', amount: usd(3500), as_of: '2026-10-20', source: 'Household list (fictional)' }),
    fund('FX', 'JPY per USD', { kind: 'fx_rate', jpy_per_usd: null, as_of: null, source: null }),
    fund('INC-JUN', 'Jun earned income', { kind: 'income', person_id: 'jun', amount: usd(0), monthly: true, income_status: 'planning_zero', as_of: '2026-10-20', source: 'Household choice: no initial work', evidence: 'Planning assumption, not a prediction.' }),
    fund('INC-AVERY', 'Avery earned income', { kind: 'income', person_id: 'avery', amount: null, monthly: true, income_status: 'unverified', as_of: null, source: null }),
  ];
}

function arrival(key: string, windowText: string, wk: ArrivalData['window_key'], action: string, scope: string[], d: Partial<ArrivalData> = {}): BundleRecord {
  const data: ArrivalData = {
    window: windowText, window_key: wk, trigger: 'Actual landing', action, traveler_scope: scope, dependencies: 'Approved route; valid travel documents',
    completion_criteria: 'Evidence kept in the restricted folder', source_ids: [], completion_evidence: [], status_reason: null, deadline: null, ...d,
  };
  return rec('arrival', key, action.split('.')[0] ?? action, 'planned', data, { owner: 'together', owner_proposed: true, sheet: 'Arrival', raw: { ID: key, Window: windowText } });
}

function buildArrival(): BundleRecord[] {
  return [
    arrival('A01', 'T: arrival day for each adult', 'arrival_day', 'Inspect and keep each adult\'s landing and residence documents.', ['avery', 'jun'], { source_ids: ['I01'] }),
    arrival('A02', 'TP: Mochi arrival day', 'arrival_day', 'Complete the quarantine inspection with Mochi and the endorsed certificate.', ['mochi'], { source_ids: ['P01'] }),
    arrival('A03', 'T to T+3: settling target', 'first_week', 'Check home access, food, water, phone and emergency contacts.', ['avery', 'jun']),
    arrival('A04', 'Within 14 days of residence', 'first_week', 'File the residence notification at the ward office.', ['avery', 'jun'], { source_ids: ['TA01'], status_reason: null }),
    arrival('A05', 'Day 30', 'day_30', 'Review costs against the plan and fix gaps.', ['avery', 'jun']),
    arrival('A06', 'Day 90', 'day_90', 'Decide whether the settling period is closed.', ['avery', 'jun']),
  ];
}

function horizon(key: string, title: string, cadence: HorizonData['cadence'], links: string[]): BundleRecord {
  const data: HorizonData = {
    trigger: title, scope: `Review scope for: ${title.toLowerCase()} (fictional).`, completion_criteria: 'Updated record with dated evidence', source_ids: ['USER02'],
    milestone_links: links, cadence, deadline: null,
  };
  return rec('horizon', key, title, 'planned', data, { owner: 'together', owner_proposed: true, sheet: 'Three-Year Horizon', raw: { Ref: key, Review: title } });
}

function buildHorizon(): BundleRecord[] {
  return [
    horizon('Y01', 'When each adult receives or changes a residence status', 'event', ['W27']),
    horizon('Y02', 'Quarterly cost and cash review after arrival', 'quarterly', ['W27']),
    horizon('Y03', 'Annual tax cycle', 'annual', []),
    horizon('Y04', 'End of the first year', 'once', []),
    horizon('EX01', 'Exit or extension choice near the end of the stay', 'once', []),
  ];
}

function future(key: string, title: string, rank: number | null, interest: FutureOptionData['interest']): BundleRecord {
  const data: FutureOptionData = {
    rank, path: title, why_fit: 'A fit hypothesis for later (fictional).', offer_hypothesis: 'One bounded piece of work.', first_test: 'A small private test.', success_evidence: 'A useful result for one user.',
    limits: 'Asynchronous only.', unknowns: 'Demand and permission.', source_ids: [], outside_critical_path: true, interest,
    kind: key.startsWith('FW-') ? 'option' : key.startsWith('FN') ? 'note' : 'phase',
    ...(key.startsWith('FN') ? { body: 'Nothing in the future-work options funds the move or sets a deadline (fictional).' } : {}),
  };
  return rec('future_option', key, title, 'planned', data, { sheet: 'Future Work', raw: { Option: key, Path: title } });
}

function buildFuture(): BundleRecord[] {
  return [
    future('FW-A', 'Small advisory engagements', 1, 'curious'),
    future('FW-B', 'Independent reviews', 2, 'not_now'),
    future('FW-C', 'A personal side project', 3, 'paused'),
    future('FW01', 'Phase 1: reflect after settling in', null, null),
    future('FW02', 'Phase 2: one small test, if wanted', null, null),
    future('FN01', 'Note: nothing here funds the move', null, null),
  ];
}

function evidence(key: string, title: string, checkedOn: string | null, refresh: string, scope: string, stale = false): BundleRecord {
  const data: EvidenceData = {
    url_or_reference: key.startsWith('USER') || key === 'BRIEF' ? 'Household conversation (fictional)' : `https://example.org/demo/${key.toLowerCase()}`,
    checked_on: checkedOn, access: 'Direct page retrieved (fictional)', supported_scope: scope, refresh_trigger: refresh, stale, superseded_by: null,
  };
  return rec('evidence', key, title, stale ? 'stale' : 'current', data, { sheet: 'Evidence', raw: { 'Source ID': key, Title: title } });
}

function buildEvidence(): BundleRecord[] {
  return [
    evidence('BRIEF', 'Household planning brief', '2026-10-20', 'Reconcile before any later execution', 'Household context'),
    evidence('USER02', 'Household follow-up: confirmed scope', '2026-10-20', 'Preserve the current decision', 'Scope and staging'),
    evidence('I01', 'Visa and travel guidance (demo)', '2026-10-20', 'Recheck before filing', 'Ordinary visa process and timing'),
    evidence('I02', 'Route research table (demo)', '2026-05-01', 'Recheck before filing', 'Non-notified route notes', true),
    evidence('P01', 'Pet import checklist (demo)', '2026-10-20', 'Recheck before filing', 'Import notice and exam windows'),
    evidence('M01', 'Medicine import guidance (demo)', '2026-10-20', 'Recheck before travel', 'Permits and quantities'),
    evidence('C01', 'Customs guidance (demo)', '2026-10-20', 'Recheck before shipping', 'Unaccompanied baggage window'),
    evidence('TA01', 'Residence notification guidance (demo)', '2026-10-20', 'Recheck before filing', 'Fourteen-day notice'),
    evidence('TA04', 'Health insurance enrollment guidance (demo)', '2026-10-20', 'Recheck before filing', 'Enrollment notice'),
    evidence('RH01', 'Return-route guidance (demo)', '2026-10-20', 'Recheck before any return', 'Rabies-free route checks'),
    evidence('PC01', 'Personal context notes (demo)', null, 'Verify before relying on it', 'Background only'),
  ];
}

function contact(slug: string, name: string, role: string, relationship: ContactData['relationship'], boundary: string, linked: string[]): BundleRecord {
  const data: ContactData = {
    name, role, relevance: `Relevant to ${linked.join(', ') || 'general planning'} (fictional).`, status_boundary: boundary, relationship, source_ids: ['BRIEF'], linked_records: linked,
  };
  return rec('contact', `CT-${slug}`, name, relationship, data, { sheet: 'Evidence', raw: { 'Name / resource': name, 'Known role': role } });
}

function buildContacts(): BundleRecord[] {
  return [
    contact('harborview-advisers', 'Harborview Immigration Advisers', 'Possible immigration adviser', 'potential', 'Candidate only; nobody has been contacted.', ['W02', 'W03']),
    contact('lantern-vet', 'Lantern Veterinary Clinic', "Mochi's current vet", 'engaged', "Existing vet for Mochi's routine care; no export work booked.", ['W12', 'W16']),
    contact('northgate-movers', 'Northgate Movers', 'Mover who gave a written quote', 'contacted', 'A written quote exists; nothing is booked.', ['W22']),
  ];
}

function buildInventoryAndProperty(): BundleRecord[] {
  const inv = (key: string, category: string): BundleRecord => {
    const data: InventoryData = { category, location: null, quantity: null, dimensions_weight: null, disposition: 'Review', value_text: null, restriction_check: null, quote_source: null, decision_evidence: null, notes: null };
    return rec('inventory', key, category, 'review', data, { sheet: 'Property Shipping', raw: { 'Item ID': key, Item: category } });
  };
  const prop = (key: string, obligation: string, ctx: string, links: string[]): BundleRecord => {
    const data: PropertyData = { obligation, known_context: ctx, people_resources: 'Household', evidence_caution: 'Verify the actual contract before changing.', milestone_links: links, evidence_status: null };
    return rec('property', key, obligation, 'open', data, { sheet: 'Property Shipping', raw: { Ref: key, Obligation: obligation } });
  };
  return [
    inv('INV01', 'Computers and photo gear'),
    inv('INV02', 'Furniture to inventory'),
    inv('INV03', 'Storage-unit contents to inventory'),
    prop('PROP01', 'Storage unit', 'Review in December; next payment recorded for January.', ['W23']),
    prop('PROP02', 'US home', 'Keep, rent or sell is still open.', ['W19']),
  ];
}

/* ------------------------------------------------------------------ */
/* Gates, tasks, settings                                              */
/* ------------------------------------------------------------------ */

export function demoTravelerGates(): TravelerGateConfig[] {
  return [
    {
      person_id: 'avery',
      required_before_departure: ['W02', 'W04', 'W06', 'W07', 'W17'],
      release_key: 'W24',
      required_at_or_after_arrival: ['A01', 'A03', 'A04'],
      conditional: [{ key: 'W18', condition: 'Only if a current medicine needs permission.', applies: 'unknown' }],
      explicitly_not_gates: [
        { key: 'W05', reason: 'Optional future work; never a move gate.' },
        { key: 'W13', reason: "Mochi's own gate." },
        { key: 'W16', reason: "Mochi's own gate." },
      ],
    },
    {
      person_id: 'jun',
      required_before_departure: ['W03', 'W06', 'W07', 'W11', 'W17'],
      release_key: 'W25',
      required_at_or_after_arrival: ['A01', 'A03', 'A04'],
      conditional: [{ key: 'W18', condition: 'Only if a current medicine needs permission.', applies: 'unknown' }],
      explicitly_not_gates: [{ key: 'W05', reason: 'Optional future work; Jun does not plan to work initially.' }],
    },
    {
      person_id: 'mochi',
      required_before_departure: ['W12', 'W13', 'W14', 'W15', 'W16'],
      release_key: 'W26',
      required_at_or_after_arrival: ['A02'],
      conditional: [],
      explicitly_not_gates: [],
    },
  ];
}

/** Which roadmap record each fixture task belongs to (task ids come from task-store.json). */
const TASK_RECORDS: Record<string, string | null> = { 'FX-0001': 'milestone:W06', 'FX-0002': 'milestone:W23', 'FX-0003': null };

function buildTaskLinks(): ImportBundle['task_links'] {
  return (taskStore.tasks as { id: string; title: string; status: TaskLink['status']; due: string | null; owner: string | null; notes: string | null; revision: string }[]).map((t) => ({
    id: `tl-fixture-${t.id}`,
    adapter: 'fixture' as const,
    canonical_id: t.id,
    record_id: TASK_RECORDS[t.id] ?? null,
    title: t.title,
    status: t.status,
    due: t.due,
    due_basis: t.id === 'FX-0002' ? ('default_14_days' as const) : ('explicit' as const),
    owner: t.owner,
    notes: t.notes,
    proposal_note: null,
    sync_state: 'synced' as const,
    last_synced_at: null,
    last_error: null,
    remote_revision: t.revision,
  }));
}

/** The fixture task-store seed (fictional); the same data lives in fixtures/demo/task-store.json. */
export function demoTaskStoreSeed(): typeof taskStore {
  return structuredClone(taskStore);
}

/* ------------------------------------------------------------------ */
/* Bundle                                                              */
/* ------------------------------------------------------------------ */

function stable(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function buildDemoBundle(): ImportBundle {
  rowCounters.clear();
  const records: BundleRecord[] = [
    ...buildAnchors(),
    ...buildRules(),
    ...buildCommitments(),
    ...buildMilestones(),
    ...buildWorkstreams(),
    ...buildQuestions(),
    ...buildDecisions(),
    ...buildRisks(),
    ...buildDocuments(),
    ...buildCosts(),
    ...buildFunding(),
    ...buildArrival(),
    ...buildHorizon(),
    ...buildFuture(),
    ...buildEvidence(),
    ...buildContacts(),
    ...buildInventoryAndProperty(),
  ];

  // Derived links: workstream → milestones/questions
  for (const ws of records.filter((r) => r.type === 'workstream')) {
    const d = ws.data as unknown as WorkstreamData;
    d.milestone_keys = records.filter((r) => r.type === 'milestone' && (r.data as unknown as MilestoneData).workstream_key === ws.key).map((r) => r.key);
    d.question_keys = records.filter((r) => r.type === 'question' && (r.data as unknown as QuestionData).workstream_key === ws.key).map((r) => r.key);
  }

  const people: ImportBundle['people'] = PEOPLE.map((p: Omit<Person, 'household_id'>) => structuredClone(p));
  const settings: ImportBundle['settings'] = {
    traveler_gates: demoTravelerGates(),
    task_adapter: { name: 'fixture', can_write: true, as_of: null, note: 'Isolated fixture task store for the fictional demo household.' },
    plan_baseline: { baseline_on: '2026-10-01', reviewed_on: '2026-10-20', source_label: DEMO_SOURCE_LABEL },
    jp_holidays: [],
  };

  const counts: Record<string, number> = {};
  for (const r of records) counts[r.type] = (counts[r.type] ?? 0) + 1;

  const bundle: ImportBundle = {
    source_label: DEMO_SOURCE_LABEL,
    files: [],
    household: { id: DEMO_HOUSEHOLD_ID, name: 'Avery, Jun & Mochi', data_label: 'Fictional demo household', home_timezone: 'Pacific/Honolulu' },
    people,
    records,
    task_links: buildTaskLinks(),
    settings,
    validation: { counts, expected: { ...counts }, dangling_refs: [], notes: ['Fictional demo household — safe to commit.'] },
  };

  // Content hash: the idempotency key changes whenever the demo content changes.
  const content = stable({ people, records, task_links: bundle.task_links, settings, household: bundle.household });
  const sha256 = createHash('sha256').update(content).digest('hex');
  for (const r of records) if (r.source) r.source.file_sha256 = sha256;
  bundle.files = [{ name: FILE, sha256, bytes: Buffer.byteLength(content) }];
  return bundle;
}
