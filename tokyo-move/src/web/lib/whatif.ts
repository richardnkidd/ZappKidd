import { addCalendarDays, addCalendarMonths, diffDays, isCivilDate } from '@shared/dates';
import { computeBudget } from '@shared/budget';
import { anchorsFrom, previewAnchorChange, type DeadlineContext } from '@shared/deadlines';
import type { AnchorChangeEffect, AnchorChangePreview, BudgetView } from '@shared/engine-contracts';
import type { AnchorData, BaseRecord, Person, ScenarioSettings } from '@shared/types';

export type ArrivalChoice = 'with_first' | 'plus1' | 'plus2' | 'plus3' | 'plus6' | 'date';

export const ARRIVAL_CHOICES: { value: ArrivalChoice; label: string }[] = [
  { value: 'with_first', label: 'With the first adult' },
  { value: 'plus1', label: '+1 month' },
  { value: 'plus2', label: '+2 months' },
  { value: 'plus3', label: '+3 months' },
  { value: 'plus6', label: '+6 months' },
  { value: 'date', label: 'A date I pick' },
];

const MONTHS: Partial<Record<ArrivalChoice, number>> = { plus1: 1, plus2: 2, plus3: 3, plus6: 6 };

/** The earliest known arrival among the adults, and which adult it belongs to. */
export function firstAdultArrival(records: BaseRecord[], people: Person[]): { date: string; personId: string } | null {
  const anchors = anchorsFrom(records);
  let best: { date: string; personId: string } | null = null;
  for (const p of people.filter((x) => x.kind === 'adult')) {
    const a = anchors.find((x) => x.code === p.anchors.arrival);
    if (a?.date && isCivilDate(a.date) && (!best || a.date < best.date)) best = { date: a.date, personId: p.id };
  }
  return best;
}

/** The pet's arrival date for a choice; null when it cannot be worked out yet. */
export function petArrivalFor(choice: ArrivalChoice, firstAdult: string | null, picked: string): string | null {
  if (choice === 'date') return isCivilDate(picked) ? picked : null;
  if (!firstAdult || !isCivilDate(firstAdult)) return null;
  if (choice === 'with_first') return firstAdult;
  const n = MONTHS[choice];
  return n ? addCalendarMonths(firstAdult, n) : null;
}

/** Departure is one day before arrival by default (flights across the date line usually land the next day). */
export function defaultDeparture(arrival: string): string {
  return addCalendarDays(arrival, -1);
}

export interface WhatIfPreview {
  changes: AnchorChangeEffect[];
  warnings: string[];
  unaffected: string[];
}

/** Preview moving the pet's arrival anchor and then its departure anchor. Nothing is applied. */
export function previewPetMove(ctx: DeadlineContext, arrivalCode: string, departureCode: string, arrival: string, departure: string): WhatIfPreview {
  const first: AnchorChangePreview = previewAnchorChange(ctx, arrivalCode, arrival);
  const moved: BaseRecord[] = ctx.records.map((r) =>
    r.type === 'anchor' && ((r.data as unknown as AnchorData).code ?? r.key) === arrivalCode ? ({ ...r, data: { ...r.data, date: arrival } } as BaseRecord) : r,
  );
  const second: AnchorChangePreview = previewAnchorChange({ ...ctx, records: moved }, departureCode, departure);
  const byId = new Map<string, AnchorChangeEffect>();
  for (const c of first.changes) byId.set(c.deadline_id, c);
  for (const c of second.changes) {
    const prev = byId.get(c.deadline_id);
    byId.set(c.deadline_id, prev ? { ...c, before: prev.before } : c);
  }
  const unaffected = first.unaffected_travelers.filter((p) => second.unaffected_travelers.includes(p));
  return { changes: [...byId.values()].filter((c) => c.before !== c.after), warnings: [...new Set([...first.warnings, ...second.warnings])].filter((w) => w !== 'The date is unchanged.'), unaffected };
}

export interface OverlapLine {
  key: string;
  description: string;
  before: number | null;
  after: number | null;
  beforeMonths: number | null;
  afterMonths: number | null;
}

export interface OverlapComparison {
  lines: OverlapLine[];
  /** null when nothing in the section is known yet (the engine never reports unknown as $0). */
  beforeKnown: number | null;
  afterKnown: number | null;
  unknownBefore: number;
  unknownAfter: number;
}

/** Staged-overlap costs under today's dates and under the hypothetical ones, from the shared money model. */
export function compareOverlap(args: {
  records: BaseRecord[];
  people: Person[];
  today: string;
  arrivalCode: string;
  departureCode: string;
  arrival: string;
  departure: string;
  horizonMonths?: number;
}): OverlapComparison {
  const scenario: ScenarioSettings = { key: 'planning', label: 'What if', fx_factor: 1, extra_us_months: 0, horizon_months: args.horizonMonths ?? 12 };
  const costs = args.records.filter((r) => r.type === 'cost');
  const funding = args.records.filter((r) => r.type === 'funding');
  const baseAnchors = anchorsFrom(args.records);
  const movedAnchors = baseAnchors.map((a) => (a.code === args.arrivalCode ? { ...a, date: args.arrival } : a.code === args.departureCode ? { ...a, date: args.departure } : a));
  const run = (anchors: AnchorData[]): BudgetView => computeBudget({ costs: costs as never, funding: funding as never, anchors, people: args.people, scenario, today: args.today });
  const before = run(baseAnchors);
  const after = run(movedAnchors);
  const afterBy = new Map(after.lines.map((l) => [l.key, l]));
  const lines = before.lines
    .filter((l) => l.section === 'staged_overlap')
    .map((l) => {
      const a = afterBy.get(l.key);
      return { key: l.key, description: l.description, before: l.horizon_usd, after: a?.horizon_usd ?? null, beforeMonths: l.months_in_horizon, afterMonths: a?.months_in_horizon ?? null };
    });
  return {
    lines,
    beforeKnown: before.by_section.staged_overlap.known_usd,
    afterKnown: after.by_section.staged_overlap.known_usd,
    unknownBefore: before.by_section.staged_overlap.unknown_count,
    unknownAfter: after.by_section.staged_overlap.unknown_count,
  };
}

/** Whole months between two civil dates, rounded (for "about N months later"). */
export function monthsBetween(a: string, b: string): number {
  return Math.round(diffDays(a, b) / 30.44);
}
