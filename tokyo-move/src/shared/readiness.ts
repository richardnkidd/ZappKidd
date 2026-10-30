/**
 * Per-traveler readiness. No percentages: state + plain-language blockers + next action.
 * OWNER: import/engines agent (signatures fixed by lead).
 * Invariants: optional future-work records never count as gates; one traveler's unmet gate never blocks another
 * traveler unless it is explicitly listed in that traveler's own gate config (or is a dependency that applies to
 * that traveler). Shared rows can carry per-traveler progress and dependency scope.
 */
import { compareCivil } from './dates';
import { anchorsFrom } from './deadlines';
import type { GateStatus, ReadinessState, TravelerGateConfig, TravelerReadiness } from './engine-contracts';
import type { AnchorData, ArrivalData, BaseRecord, MilestoneData, Person, WorkStatus } from './types';

type GateRecord = BaseRecord;

interface RecordIndex {
  /** Gate keys resolve within milestone, arrival and horizon records only. */
  gate: Map<string, GateRecord>;
  /** Dependencies resolve among milestones. */
  milestone: Map<string, BaseRecord>;
}

function indexRecords(records: BaseRecord[]): RecordIndex {
  const gate = new Map<string, GateRecord>();
  const milestone = new Map<string, BaseRecord>();
  // milestone wins over arrival/horizon if a key were ever shared
  for (const type of ['horizon', 'arrival', 'milestone'] as const) {
    for (const r of records) {
      if (r.type !== type) continue;
      gate.set(r.key, r);
      if (type === 'milestone') milestone.set(r.key, r);
    }
  }
  return { gate, milestone };
}

function dataOf(r: BaseRecord): Partial<MilestoneData & ArrivalData> {
  return r.data as Partial<MilestoneData & ArrivalData>;
}

/** The status of a record as it applies to one traveler (per-traveler progress overrides the shared status). */
function statusFor(r: BaseRecord, personId: string): WorkStatus {
  const progress = dataOf(r).traveler_progress?.[personId];
  return (progress?.status ?? r.status) as WorkStatus;
}

function reasonFor(r: BaseRecord, personId: string): string | null {
  const progress = dataOf(r).traveler_progress?.[personId];
  if (progress) return progress.reason ?? null;
  return dataOf(r).status_reason ?? null;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Completed, or set aside (not needed / dropped) with a recorded reason. */
function isMet(r: BaseRecord, personId: string): boolean {
  const status = statusFor(r, personId);
  if (status === 'completed') return true;
  if (status === 'not_applicable' || status === 'eliminated') return hasText(reasonFor(r, personId));
  return false;
}

function isOptional(r: BaseRecord): boolean {
  return r.type === 'milestone' && (r.data as unknown as MilestoneData).optional_future_work === true;
}

/** Direct dependencies of `g` that still block `personId`, honoring dependency_scope and optional future work. */
function unmetDependencies(g: GateRecord, personId: string, idx: RecordIndex): BaseRecord[] {
  if (g.type !== 'milestone') return [];
  const d = g.data as unknown as MilestoneData;
  const out: BaseRecord[] = [];
  for (const depKey of d.dependencies ?? []) {
    const scope = d.dependency_scope?.[depKey];
    if (scope && !scope.includes(personId)) continue;
    const dep = idx.milestone.get(depKey);
    if (!dep) continue; // dangling reference: reported at import, not a gate
    if (isOptional(dep)) continue; // optional future work never gates anything
    if (!isMet(dep, personId)) out.push(dep);
  }
  return out;
}

/** "Waiting on: <title> — <reason>; <title>." The reason comes from the waiting record's own dependency_reason[dep]. */
function waitingOn(deps: BaseRecord[], waiting?: GateRecord): string {
  const reasons = waiting ? (dataOf(waiting).dependency_reason ?? {}) : {};
  const names = deps
    .map((d) => {
      const title = d.title.trim();
      if (!title) return '';
      const reason = reasons[d.key];
      return hasText(reason) ? `${title} — ${reason.trim()}` : title;
    })
    .filter(Boolean);
  if (names.length === 0) return 'Waiting on earlier steps.';
  return `Waiting on: ${names.join('; ')}.`;
}

function buildGate(
  g: GateRecord,
  personId: string,
  idx: RecordIndex,
  requirement: GateStatus['requirement'],
  condition: string | null,
  stage: GateStatus['stage'],
): GateStatus {
  const status = statusFor(g, personId);
  const met = isMet(g, personId);
  const unmet = met ? [] : unmetDependencies(g, personId, idx);
  const marked = status === 'blocked' || status === 'waiting_external';
  const blockedNow = !met && (marked || (status === 'planned' && unmet.length > 0));
  let blocker: string | null = null;
  if (blockedNow) {
    const reason = reasonFor(g, personId);
    if (hasText(reason)) blocker = reason!.trim();
    else if (unmet.length > 0) blocker = waitingOn(unmet, g);
    else blocker = status === 'waiting_external' ? 'Waiting on someone else.' : 'Marked as blocked; no reason is recorded yet.';
  }
  return {
    record_id: g.id,
    key: g.key,
    title: g.title,
    status,
    met,
    requirement,
    condition,
    stage,
    blocker,
    owner: g.owner,
    blocked_by: unmet.map((d) => d.key),
  };
}

function isBlocked(g: GateStatus): boolean {
  return g.blocker !== null && !g.met;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function travelerReadiness(person: Person, records: BaseRecord[], gates: TravelerGateConfig, today: string): TravelerReadiness {
  const idx = indexRecords(records);
  const anchors = anchorsFrom(records);
  const byCode = new Map<string, AnchorData>(anchors.map((a) => [a.code, a]));
  const departure = person.anchors.departure ? (byCode.get(person.anchors.departure) ?? null) : null;
  const arrival = person.anchors.arrival ? (byCode.get(person.anchors.arrival) ?? null) : null;

  const skip = new Set(gates.explicitly_not_gates.map((g) => g.key));
  // The release record is the explicit go-ahead itself, so it is never one of the steps that must be met first.
  if (gates.release_key) skip.add(gates.release_key);
  const seen = new Set<string>();
  const pre: GateStatus[] = []; // required (and conditional=yes) before departure
  const afterArrival: GateStatus[] = [];
  const conditionalUnknown: GateStatus[] = [];

  const resolve = (key: string): GateRecord | null => {
    if (skip.has(key) || seen.has(key)) return null;
    const rec = idx.gate.get(key);
    if (!rec) return null;
    if (isOptional(rec)) return null; // never a gate, even when listed
    return rec;
  };

  for (const key of gates.required_before_departure) {
    const rec = resolve(key);
    if (!rec) {
      if (!skip.has(key) && !seen.has(key) && !idx.gate.has(key)) {
        seen.add(key);
        pre.push({ record_id: `milestone:${key}`, key, title: key, status: 'planned', met: false, requirement: 'required', condition: null, stage: 'before_departure', blocker: 'This step is listed for the traveler but is missing from the plan.', owner: null, blocked_by: [] });
      }
      continue;
    }
    seen.add(key);
    pre.push(buildGate(rec, person.id, idx, 'required', null, 'before_departure'));
  }
  const notNeeded: NonNullable<TravelerReadiness['not_needed']> = [];
  for (const c of gates.conditional) {
    const rec = resolve(c.key);
    if (!rec) continue;
    // The record's own per-traveler applicability wins; the gate config's value is the default.
    const applies = dataOf(rec).applies_to?.[person.id] ?? c.applies;
    seen.add(c.key);
    if (applies === 'no') {
      notNeeded.push({
        record_id: rec.id,
        key: rec.key,
        title: rec.title,
        reason: `Not needed for ${person.display_name}.${c.condition ? ` ${c.condition}` : ''}`.trim(),
      });
      continue;
    }
    const gate = buildGate(rec, person.id, idx, 'conditional', c.condition, 'before_departure');
    if (applies === 'yes') pre.push(gate);
    else conditionalUnknown.push(gate);
  }
  const arrivalSeen = new Set<string>();
  for (const key of gates.required_at_or_after_arrival) {
    if (skip.has(key) || arrivalSeen.has(key)) continue;
    const rec = idx.gate.get(key);
    if (!rec || isOptional(rec)) continue;
    arrivalSeen.add(key);
    afterArrival.push(buildGate(rec, person.id, idx, 'required', null, 'at_or_after_arrival'));
  }

  const met = pre.filter((g) => g.met);
  const unmet = pre.filter((g) => !g.met);
  const blockers = unmet.filter(isBlocked);
  const open = unmet.filter((g) => !isBlocked(g));
  const nextAction = open[0] ?? null;

  // Explicit release: a recorded release gate for this traveler.
  const releaseRec = gates.release_key ? idx.gate.get(gates.release_key) : undefined;
  const releaseDone = releaseRec ? isMet(releaseRec, person.id) : false;

  const reached = (a: AnchorData | null): boolean => !!a && a.confidence === 'actual' && a.date !== null && compareCivil(a.date, today) <= 0;
  const arrived = reached(arrival);
  const departed = reached(departure);

  let state: ReadinessState;
  if (arrived) state = afterArrival.length > 0 && afterArrival.every((g) => g.met) ? 'settled' : 'arrived';
  else if (departed || (releaseDone && unmet.length === 0 && pre.length > 0)) state = 'released';
  else if (pre.length > 0 && unmet.length === 0 && conditionalUnknown.length === 0) state = 'ready_to_release';
  else if (pre.length > 0 && unmet.length === 0) state = 'preparing'; // every required step is done, but some yes/no answers are missing
  else if (pre.length === 0) state = 'not_started';
  else if (open.length === 0 && blockers.length > 0) state = 'blocked';
  else if (met.length > 0 || unmet.some((g) => g.status === 'in_progress')) state = 'preparing';
  else state = 'not_started';

  const name = person.display_name;
  const yesNo = conditionalUnknown.length > 0 ? `${plural(conditionalUnknown.length, 'step still needs', 'steps still need')} a yes or no` : '';
  const extra = yesNo ? ` ${yesNo}.` : '';
  let headline: string;
  switch (state) {
    case 'settled':
      headline = `${name} has arrived and finished the settling-in steps.`;
      break;
    case 'arrived':
      headline = afterArrival.length > 0 ? `${name} has arrived. ${plural(afterArrival.filter((g) => !g.met).length, 'settling-in step is', 'settling-in steps are')} still open.` : `${name} has arrived.`;
      break;
    case 'released':
      headline = `${name} has been cleared to travel.`;
      break;
    case 'ready_to_release':
      headline = `Every required step is done for ${name}. It is ready for your go-ahead.${extra}`;
      break;
    case 'blocked':
      headline = `${name}'s remaining ${plural(unmet.length, 'step is', 'steps are')} all waiting on something. ${blockers[0]?.blocker ?? ''}${extra}`.trim();
      break;
    case 'preparing':
      headline =
        unmet.length === 0
          ? `Every required step is done for ${name}, but ${yesNo} before it is ready for your go-ahead.`
          : `${name} is preparing. ${plural(unmet.length, 'step is', 'steps are')} left${nextAction ? `; next up: ${nextAction.title}` : ''}.${extra}`;
      break;
    default:
      headline = pre.length === 0 ? `No required steps are set up for ${name} yet.` : `${name} has not started yet${nextAction ? `; the first step is: ${nextAction.title}` : ''}.`;
  }

  return {
    person_id: person.id,
    state,
    headline,
    blockers,
    open,
    met,
    conditional_unknown: conditionalUnknown,
    not_needed: notNeeded,
    after_arrival: afterArrival,
    next_action: nextAction,
    departure,
    arrival,
  };
}

export function householdReadiness(people: Person[], records: BaseRecord[], gates: TravelerGateConfig[], today: string): TravelerReadiness[] {
  return people.map((p) => {
    const cfg = gates.find((g) => g.person_id === p.id) ?? {
      person_id: p.id,
      required_before_departure: [],
      required_at_or_after_arrival: [],
      conditional: [],
      explicitly_not_gates: [],
    };
    return travelerReadiness(p, records, cfg, today);
  });
}

export interface DependencyChainEntry {
  key: string;
  title: string;
  status: string;
  met: boolean;
  depth: number;
  /** Why the waiting record needs this one (its dependency_reason[dep]), when recorded. */
  reason?: string | null;
}

/** 'W64.<person>' / 'W60.<person>' style keys belong to one traveler. */
function personFromKey(key: string): string | null {
  const m = /^[A-Za-z]+\d+\.([A-Za-z0-9_-]+)$/.exec(key);
  return m ? (m[1] as string) : null;
}

/**
 * Dependency chain for a record, nearest first: every direct dependency is listed (with its met flag); the walk only
 * continues through dependencies that are not yet met. Cycle-safe. Used instead of a numeric critical path.
 *
 * With a traveler (given, or inferred from a 'W64.<person>' style key) the chain is that traveler's: dependencies scoped
 * to other travelers (dependency_scope) are skipped, and each dependency's status and met flag come from that traveler's
 * own progress. Optional future work is never part of a chain.
 */
export function dependencyChain(recordKey: string, records: BaseRecord[], personId?: string | null): DependencyChainEntry[] {
  const idx = indexRecords(records);
  const root = idx.milestone.get(recordKey);
  if (!root) return [];
  const who = personId ?? personFromKey(recordKey) ?? '';
  const out: DependencyChainEntry[] = [];
  const visited = new Set<string>([recordKey]);
  let frontier: BaseRecord[] = [root];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: BaseRecord[] = [];
    for (const rec of frontier) {
      const data = rec.data as unknown as MilestoneData;
      for (const depKey of data.dependencies ?? []) {
        if (visited.has(depKey)) continue;
        const scope = data.dependency_scope?.[depKey];
        if (who && scope && !scope.includes(who)) continue;
        const dep = idx.milestone.get(depKey);
        if (!dep || isOptional(dep)) continue;
        visited.add(depKey);
        const met = isMet(dep, who);
        const reason = data.dependency_reason?.[depKey];
        out.push({ key: dep.key, title: dep.title, status: statusFor(dep, who), met, depth, ...(hasText(reason) ? { reason: reason.trim() } : {}) });
        if (!met) next.push(dep);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Records that (transitively) depend on `recordKey` — used to show affected downstream work. Nearest first.
 * With a traveler (given, or inferred from a 'W64.<person>' style key) a dependent counts only when its dependency on the
 * record applies to that traveler (dependency_scope).
 */
export function downstreamOf(recordKey: string, records: BaseRecord[], personId?: string | null): string[] {
  const who = personId ?? personFromKey(recordKey) ?? '';
  const milestones = records.filter((r) => r.type === 'milestone');
  const dependents = new Map<string, string[]>();
  for (const m of milestones) {
    const data = m.data as unknown as MilestoneData;
    for (const dep of data.dependencies ?? []) {
      const scope = data.dependency_scope?.[dep];
      if (who && scope && !scope.includes(who)) continue;
      const list = dependents.get(dep) ?? [];
      list.push(m.key);
      dependents.set(dep, list);
    }
  }
  const out: string[] = [];
  const visited = new Set<string>([recordKey]);
  let frontier = [recordKey];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const k of frontier) {
      for (const d of dependents.get(k) ?? []) {
        if (visited.has(d)) continue;
        visited.add(d);
        out.push(d);
        next.push(d);
      }
    }
    frontier = next;
  }
  return out;
}
