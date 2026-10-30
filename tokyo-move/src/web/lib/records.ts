import type {
  AnchorData,
  ArrivalData,
  BaseRecord,
  ContactData,
  CostData,
  DecisionData,
  DeadlineRuleData,
  DocumentData,
  EvidenceData,
  ExistingCommitmentData,
  FutureOptionData,
  HorizonData,
  MilestoneData,
  NoteData,
  OwnerRef,
  Person,
  QuestionData,
  RecordType,
  RiskData,
  TaskLink,
  WorkStatus,
} from '@shared/types';
import { TERMINAL_STATUSES } from '@shared/types';

/** Any record regardless of its data shape (typed records such as Milestone are assignable to this). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = BaseRecord<RecordType, any>;
export type Milestone = BaseRecord<'milestone', MilestoneData>;
export type Decision = BaseRecord<'decision', DecisionData>;
export type Question = BaseRecord<'question', QuestionData>;
export type Risk = BaseRecord<'risk', RiskData>;
export type Workstream = BaseRecord<'workstream', Record<string, unknown> & { summary?: string; related?: string[] }>;
export type Commitment = BaseRecord<'existing_commitment', ExistingCommitmentData>;
export type Note = BaseRecord<'note', NoteData>;
export type Rule = BaseRecord<'deadline_rule', DeadlineRuleData>;
export type Anchor = BaseRecord<'anchor', AnchorData>;
export type DocumentRecord = BaseRecord<'document', DocumentData>;
export type ArrivalRecord = BaseRecord<'arrival', ArrivalData>;
export type HorizonRecord = BaseRecord<'horizon', HorizonData>;
export type FutureOption = BaseRecord<'future_option', FutureOptionData>;
export type Evidence = BaseRecord<'evidence', EvidenceData>;
export type Contact = BaseRecord<'contact', ContactData>;
export type CostRecord = BaseRecord<'cost', CostData>;

/** Loosely typed access to a record's `data` — the API may omit fields the type declares. */
export function dataOf<D = Record<string, unknown>>(r: { data: unknown }): Partial<D> {
  return (r.data ?? {}) as Partial<D>;
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isOpenWork(status: string): boolean {
  return !isTerminal(status);
}

export interface Indexes {
  all: BaseRecord[];
  byId: Map<string, BaseRecord>;
  /** First record found for a source key such as 'W45' (keys are unique across the imported plan). */
  byKey: Map<string, BaseRecord>;
  milestones: Milestone[];
  milestoneByKey: Map<string, Milestone>;
  decisions: Decision[];
  questions: Question[];
  risks: Risk[];
  workstreams: Workstream[];
  commitments: Commitment[];
  /** Existing commitments that point at a milestone, by that milestone's key (shown on the milestone itself). */
  commitmentsByMilestoneKey: Map<string, Commitment[]>;
  notes: Note[];
  rules: Rule[];
  anchors: Anchor[];
  taskLinks: TaskLink[];
  taskLinksByRecord: Map<string, TaskLink[]>;
}

function ofType<T extends RecordType, D>(records: BaseRecord[], type: T): BaseRecord<T, D>[] {
  return records.filter((r) => r.type === type) as unknown as BaseRecord<T, D>[];
}

export function buildIndexes(records: BaseRecord[], taskLinks: TaskLink[]): Indexes {
  const byId = new Map<string, BaseRecord>();
  const byKey = new Map<string, BaseRecord>();
  for (const r of records) {
    byId.set(r.id, r);
    if (!byKey.has(r.key)) byKey.set(r.key, r);
  }
  const milestones = ofType<'milestone', MilestoneData>(records, 'milestone');
  const milestoneByKey = new Map(milestones.map((m) => [m.key, m]));
  const commitments = ofType<'existing_commitment', ExistingCommitmentData>(records, 'existing_commitment');
  const commitmentsByMilestoneKey = new Map<string, Commitment[]>();
  for (const c of commitments) {
    for (const key of c.data?.linked_records ?? []) {
      if (!milestoneByKey.has(key)) continue;
      const list = commitmentsByMilestoneKey.get(key) ?? [];
      list.push(c);
      commitmentsByMilestoneKey.set(key, list);
    }
  }
  const taskLinksByRecord = new Map<string, TaskLink[]>();
  for (const t of taskLinks) {
    if (!t.record_id) continue;
    const list = taskLinksByRecord.get(t.record_id) ?? [];
    list.push(t);
    taskLinksByRecord.set(t.record_id, list);
  }
  return {
    all: records,
    byId,
    byKey,
    milestones,
    milestoneByKey,
    decisions: ofType<'decision', DecisionData>(records, 'decision'),
    questions: ofType<'question', QuestionData>(records, 'question'),
    risks: ofType<'risk', RiskData>(records, 'risk'),
    workstreams: ofType<'workstream', Workstream['data']>(records, 'workstream'),
    commitments,
    commitmentsByMilestoneKey,
    notes: ofType<'note', NoteData>(records, 'note'),
    rules: ofType<'deadline_rule', DeadlineRuleData>(records, 'deadline_rule'),
    anchors: ofType<'anchor', AnchorData>(records, 'anchor'),
    taskLinks,
    taskLinksByRecord,
  };
}

/* ---------- people / owners ---------- */

export interface Directory {
  people: Person[];
  adults: Person[];
  pet: Person | null;
  me: Person | null;
  others: Person[]; // adults other than me
  nameOf(id: string | null | undefined): string;
  ownerLabel(owner: OwnerRef | null | undefined): string;
  personById(id: string | null | undefined): Person | null;
}

export function buildDirectory(people: Person[], meId: string | null): Directory {
  const byId = new Map(people.map((p) => [p.id, p]));
  const adults = people.filter((p) => p.kind === 'adult');
  const pet = people.find((p) => p.kind === 'pet') ?? null;
  const me = (meId && byId.get(meId)) || null;
  const nameOf = (id: string | null | undefined): string => {
    if (!id) return 'Someone';
    const p = byId.get(id);
    if (p) return p.display_name;
    if (id === 'import') return 'The plan import';
    if (id === 'system') return 'Kadode';
    return 'Someone';
  };
  return {
    people,
    adults,
    pet,
    me,
    others: adults.filter((a) => a.id !== meId),
    nameOf,
    personById: (id) => (id ? byId.get(id) ?? null : null),
    ownerLabel: (owner) => {
      if (!owner || owner === 'unassigned') return 'Unassigned';
      if (owner === 'together') return 'Together';
      return nameOf(owner);
    },
  };
}

export function normalizedOwner(owner: OwnerRef | null | undefined): OwnerRef {
  return owner && owner.length > 0 ? owner : 'unassigned';
}

/* ---------- dependency helpers (cheap, list-level; the full chain comes from the readiness engine) ---------- */

export function unmetDependencyKeys(m: Milestone, idx: Indexes): string[] {
  const deps = m.data?.dependencies ?? [];
  const out: string[] = [];
  for (const key of deps) {
    const dep = idx.byKey.get(key);
    if (!dep) continue; // unresolved references are reported on the Data screen, not as blockers
    if (dep.status === 'completed' || dep.status === 'not_applicable' || dep.status === 'eliminated') continue;
    out.push(key);
  }
  return out;
}

export function nextDateOf(m: Milestone): { date: string | null; kind: 'deadline' | 'review' | null } {
  const dl = m.data?.deadline?.date ?? null;
  if (dl) return { date: dl, kind: 'deadline' };
  const rv = m.data?.review_date ?? null;
  if (rv) return { date: rv, kind: 'review' };
  return { date: null, kind: null };
}

export function statusOf(r: BaseRecord): WorkStatus {
  return r.status as WorkStatus;
}

/** True when a commitment points at a milestone, so it is shown on that milestone instead of as its own item. */
export function commitmentIsLinked(c: { data: { linked_records?: string[] } }, idx: Indexes): boolean {
  return (c.data?.linked_records ?? []).some((k) => idx.milestoneByKey.has(k));
}

/** Household settings that are not in the shared type yet; read defensively. */
export function firstReviewDecisionKeys(settings: unknown): string[] {
  const fr = (settings as { first_review?: { decision_keys?: unknown } } | null | undefined)?.first_review;
  const keys = fr?.decision_keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
}
