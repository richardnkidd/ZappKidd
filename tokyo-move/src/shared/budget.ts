/**
 * Money model. Unknown is never zero; incomplete totals are labeled, never presented as affordability.
 * OWNER: import/engines agent (signatures fixed by lead).
 *
 * Rules (see tests/unit/budget.test.ts):
 *  - A line is unknown (not 0) when it is still 'review', has no amount, needs a JPY rate that is missing, or (monthly
 *    lines) has unknown phase dates without explicit months. An exclusion needs a written reason, otherwise it is unknown.
 *  - Each amount is entered once, in exactly one currency. Best amount: committed > quote > estimate.
 *  - One-time lines count their UNPAID balance (paid in full ⇒ 0). Monthly lines count usd × months in the horizon; a
 *    line with a phase counts only the months its phase overlaps. A staged-overlap line without a phase is unknown.
 *  - need = one-time unpaid + monthly sections + extra US months (us run-rate × extra) + other commitments + return reserve.
 *  - Headroom exists only when the need is complete AND cash is known. Unverified income is never counted.
 *  - FX: active = base × scenario factor (applies to JPY amounts only).
 */
import { addCalendarDays, addCalendarMonths, compareCivil, diffDays } from './dates';
import type { BudgetInputs, BudgetView, CashModel, CostLineView, FxView, MoneyTotal } from './engine-contracts';
import type { AnchorData, BaseRecord, CostData, CostPhase, CostSection, FundingData, Money, Person, ScenarioSettings } from './types';

export const DEFAULT_SCENARIOS: ScenarioSettings[] = [
  { key: 'planning', label: 'Planning', fx_factor: 1, extra_us_months: 0, horizon_months: 3 },
  { key: 'condo_delay', label: 'Condo delay', fx_factor: 1, extra_us_months: 3, horizon_months: 3 },
  { key: 'combined_stress', label: 'Combined stress', fx_factor: 0.9, extra_us_months: 3, horizon_months: 3 },
];

/** Length of the sustainability view (the intended stay). */
export const SUSTAINABILITY_MONTHS = 36;

const SECTIONS: readonly CostSection[] = ['one_time', 'tokyo_monthly', 'us_monthly', 'staged_overlap', 'reserve'];
const MONTHLY_SECTIONS: ReadonlySet<CostSection> = new Set(['tokyo_monthly', 'us_monthly', 'staged_overlap']);

function validAmount(m: Money | null | undefined): m is Money {
  return !!m && typeof m.amount === 'number' && Number.isFinite(m.amount) && (m.currency === 'USD' || m.currency === 'JPY');
}

function validRate(rate: number | null | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/** USD value of an amount; JPY converts at jpyPerUsd; returns null when FX is missing for JPY. */
export function toUsd(money: Money | null, jpyPerUsd: number | null): number | null {
  if (!validAmount(money)) return null;
  if (money.currency === 'USD') return money.amount;
  if (!validRate(jpyPerUsd)) return null;
  return money.amount / jpyPerUsd;
}

/** Active FX = base × factor (null if base missing or invalid). */
export function activeFx(baseJpyPerUsd: number | null, factor: number): number | null {
  if (!validRate(baseJpyPerUsd) || !validRate(factor)) return null;
  return baseJpyPerUsd * factor;
}

/** Proportional change in USD cost of fixed-JPY spending for an FX factor: 1/factor − 1 (0.9 → 0.1111…). */
export function usdEffectOfFxFactor(factor: number): number {
  if (!validRate(factor)) return Number.NaN;
  return 1 / factor - 1;
}

/* ------------------------------------------------------------------ */
/* months                                                              */
/* ------------------------------------------------------------------ */

/** Months in [start, end] (both inclusive, civil dates): whole calendar months plus a day-proportional remainder. */
function monthsInclusive(start: string, end: string): number {
  const endExclusive = addCalendarDays(end, 1);
  if (compareCivil(endExclusive, start) <= 0) return 0;
  let whole = 0;
  while (compareCivil(addCalendarMonths(start, whole + 1), endExclusive) <= 0) whole += 1;
  const anchor = addCalendarMonths(start, whole);
  const next = addCalendarMonths(start, whole + 1);
  const remainder = diffDays(anchor, endExclusive);
  const span = diffDays(anchor, next);
  return whole + (span > 0 ? remainder / span : 0);
}

interface HorizonContext {
  /** First day of the cash view (earliest known adult arrival), or null. */
  start: string | null;
  months: number;
}

function anchorDate(anchors: Map<string, AnchorData>, code: string | null | undefined): string | null {
  if (!code) return null;
  return anchors.get(code)?.date ?? null;
}

/** Months of a monthly line that fall inside the horizon; null when it cannot be known. */
function monthsInHorizon(section: CostSection, phase: CostPhase | null, horizon: HorizonContext, anchors: Map<string, AnchorData>): number | null {
  if (!phase) return section === 'staged_overlap' ? null : horizon.months;
  if (phase.months !== null && phase.months !== undefined) {
    return Number.isFinite(phase.months) && phase.months >= 0 ? Math.min(phase.months, horizon.months) : null;
  }
  const start = phase.start_date ?? anchorDate(anchors, phase.start_anchor);
  const end = phase.end_date ?? anchorDate(anchors, phase.end_anchor);
  if (!start || !end) return null;
  if (compareCivil(end, start) < 0) return null;
  if (!horizon.start) return Math.min(monthsInclusive(start, end), horizon.months);
  const windowEnd = addCalendarDays(addCalendarMonths(horizon.start, horizon.months), -1);
  const from = compareCivil(start, horizon.start) > 0 ? start : horizon.start;
  const to = compareCivil(end, windowEnd) < 0 ? end : windowEnd;
  if (compareCivil(to, from) < 0) return 0;
  return monthsInclusive(from, to);
}

/* ------------------------------------------------------------------ */
/* lines                                                               */
/* ------------------------------------------------------------------ */

function hasText(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function evaluateLine(rec: BaseRecord<'cost', CostData>, fx: number | null, horizon: HorizonContext, anchors: Map<string, AnchorData>): CostLineView {
  const d = rec.data;
  const view: CostLineView = {
    key: rec.key,
    section: d.section,
    description: d.description || rec.title,
    stage: 'unknown',
    usd: null,
    unpaid_usd: null,
    paid_usd: null,
    native: null,
    months_in_horizon: null,
    horizon_usd: null,
    missing: [],
  };

  if (d.applicability === 'exclude') {
    if (hasText(d.exclusion_reason)) {
      view.stage = 'excluded';
      return view;
    }
    view.missing.push('An exclusion needs a written reason.');
    return view;
  }
  if (d.applicability === 'review') {
    view.missing.push('Still under review: decide whether this cost applies.');
    return view;
  }

  const best = [d.committed, d.quote, d.estimate].find(validAmount) ?? null;
  const source = validAmount(d.committed) ? 'committed' : validAmount(d.quote) ? 'quote' : validAmount(d.estimate) ? 'estimate' : null;
  if (!best) {
    view.missing.push('No amount has been entered yet.');
    return view;
  }
  view.native = { amount: best.amount, currency: best.currency };
  const usd = toUsd(best, fx);
  if (usd === null) view.missing.push('Needs the JPY-per-USD exchange rate.');
  view.usd = usd;
  view.paid_usd = validAmount(d.paid) ? toUsd(d.paid, fx) : null;

  const state = d.commitment_state;
  view.stage =
    state === 'paid' || state === 'partially_paid' || state === 'approved_commitment'
      ? state
      : source === 'quote'
        ? 'quote'
        : source === 'estimate'
          ? 'estimate'
          : 'approved_commitment';

  if (MONTHLY_SECTIONS.has(d.section)) {
    const months = monthsInHorizon(d.section, d.phase, horizon, anchors);
    view.months_in_horizon = months;
    if (months === null) {
      view.missing.push(d.phase ? 'The phase dates are not set yet, so the number of months is unknown.' : 'No phase is set for this overlap, so the number of months is unknown.');
    }
    view.horizon_usd = usd !== null && months !== null ? usd * months : null;
    return view;
  }

  // One-time (and reserve-section) lines count the unpaid balance.
  let unpaid: number | null = null;
  if (validAmount(d.unpaid_balance)) {
    unpaid = toUsd(d.unpaid_balance, fx);
    if (unpaid === null && !view.missing.includes('Needs the JPY-per-USD exchange rate.')) view.missing.push('Needs the JPY-per-USD exchange rate.');
  } else if (state === 'paid') {
    unpaid = 0;
  } else if (state === 'not_committed' || state === 'estimate' || state === 'quote') {
    unpaid = usd;
  } else if (validAmount(d.paid) && usd !== null) {
    const paid = toUsd(d.paid, fx);
    unpaid = paid === null ? null : Math.max(0, usd - paid);
  } else {
    view.missing.push('The unpaid balance has not been recorded.');
  }
  view.unpaid_usd = unpaid;
  view.horizon_usd = unpaid;
  return view;
}

function totalFor(lines: CostLineView[], monthly: boolean): MoneyTotal {
  const live = lines.filter((l) => l.stage !== 'excluded');
  const unknown = live.filter((l) => l.horizon_usd === null);
  const knownCount = live.length - unknown.length;
  const total: MoneyTotal = {
    // Unknown is not zero: a section with lines but nothing known reports null, not $0.
    known_usd: live.length > 0 && knownCount === 0 ? null : live.reduce((sum, l) => sum + (l.horizon_usd ?? 0), 0),
    known_count: knownCount,
    unknown_count: unknown.length,
    unknown_keys: unknown.map((l) => l.key),
    excluded_count: lines.length - live.length,
    complete: unknown.length === 0,
  };
  if (monthly && live.some((l) => l.usd !== null)) total.monthly_known_usd = live.reduce((sum, l) => sum + (l.usd ?? 0), 0);
  return total;
}

/* ------------------------------------------------------------------ */
/* funding, income, cash model                                         */
/* ------------------------------------------------------------------ */

function fundingOf(funding: BaseRecord<'funding', FundingData>[], kind: FundingData['kind']): BaseRecord<'funding', FundingData>[] {
  return funding.filter((f) => f.data.kind === kind);
}

function personName(people: Person[], id: string | null): string {
  return people.find((p) => p.id === id)?.display_name ?? id ?? 'someone';
}

function incomeView(funding: BaseRecord<'funding', FundingData>[], fx: number | null, people: Person[]): BudgetView['income'] {
  return fundingOf(funding, 'income').map((f) => {
    const d = f.data;
    const person = d.person_id ?? '';
    const status = d.income_status ?? 'unverified';
    const converted = validAmount(d.amount) ? toUsd(d.amount, fx) : null;
    const monthly = d.monthly !== false;
    if (status === 'planning_zero') {
      return { person_id: person, status, monthly_usd: 0, counted: true, note: 'A planning assumption of zero earned income. It is not a prediction.' };
    }
    if (status === 'confirmed_none') {
      return { person_id: person, status, monthly_usd: 0, counted: true, note: 'Confirmed: no earned income.' };
    }
    if (status === 'verified_lawful') {
      if (!monthly) return { person_id: person, status, monthly_usd: null, counted: false, note: 'This is not a monthly amount, so it is not modeled.' };
      if (converted === null) return { person_id: person, status, monthly_usd: null, counted: false, note: validAmount(d.amount) ? 'Needs the JPY-per-USD exchange rate.' : 'No amount has been entered.' };
      return { person_id: person, status, monthly_usd: converted, counted: true, note: 'Verified. Counted.' };
    }
    return {
      person_id: person,
      status,
      monthly_usd: monthly ? converted : null,
      counted: false,
      note: `Not counted until ${personName(people, d.person_id)}'s income is verified.`,
    };
  });
}

function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function buildCashModel(args: {
  lines: CostLineView[];
  horizonMonths: number;
  scenario: ScenarioSettings;
  funding: BaseRecord<'funding', FundingData>[];
  fx: number | null;
  income: BudgetView['income'];
  people: Person[];
  longView: boolean;
}): { model: CashModel; bySection: Record<CostSection, MoneyTotal> } {
  const { lines, horizonMonths, scenario, funding, fx, income, people } = args;
  const bySection = {} as Record<CostSection, MoneyTotal>;
  for (const s of SECTIONS) bySection[s] = totalFor(lines.filter((l) => l.section === s), MONTHLY_SECTIONS.has(s));

  // Extra US months stress: the full US monthly run-rate for each extra month.
  const usLines = lines.filter((l) => l.section === 'us_monthly' && l.stage !== 'excluded');
  const usRunRateKnown = usLines.every((l) => l.usd !== null);
  const usRate = usLines.reduce((sum, l) => sum + (l.usd ?? 0), 0);
  const extraMonths = Math.max(0, scenario.extra_us_months);
  const extra: number | null = extraMonths === 0 ? 0 : usRunRateKnown ? usRate * extraMonths : null;

  const cashRec = fundingOf(funding, 'cash_snapshot')[0];
  const reserveRec = fundingOf(funding, 'return_reserve')[0];
  const otherRec = fundingOf(funding, 'other_commitments')[0];
  const cash = cashRec ? toUsd(cashRec.data.amount, fx) : null;
  const reserve = reserveRec ? toUsd(reserveRec.data.amount, fx) : null;
  const other = otherRec ? toUsd(otherRec.data.amount, fx) : null;

  const sectionTotals = [bySection.one_time, bySection.reserve, bySection.tokyo_monthly, bySection.us_monthly, bySection.staged_overlap];
  const anyKnown = sectionTotals.some((t) => (t.known_count ?? 0) > 0) || other !== null || reserve !== null;
  // Nothing known at all ⇒ null (the UI says "No amounts known yet"), never 0.
  const needKnown: number | null = anyKnown ? sectionTotals.reduce((s, t) => s + (t.known_usd ?? 0), 0) + (extra ?? 0) + (other ?? 0) + (reserve ?? 0) : null;
  const linesComplete = sectionTotals.every((t) => t.complete);
  const needComplete = linesComplete && extra !== null && other !== null && reserve !== null;

  const allCounted = income.length > 0 && income.every((i) => i.counted && i.monthly_usd !== null);
  const modeledIncome = allCounted ? income.reduce((s, i) => s + (i.monthly_usd ?? 0), 0) * horizonMonths : null;

  const headroom = needComplete && cash !== null && needKnown !== null ? cash - needKnown : null;
  const state: CashModel['state'] = headroom === null ? 'incomplete' : modeledIncome === null ? 'cash_view_ready_income_unverified' : 'complete';

  const missing: string[] = [];
  const sectionLabel: Record<string, string> = {
    one_time: 'one-time cost',
    reserve: 'reserve cost',
    tokyo_monthly: 'Tokyo monthly cost',
    us_monthly: 'US monthly cost',
    staged_overlap: 'staged-overlap cost',
  };
  for (const s of ['one_time', 'reserve', 'tokyo_monthly', 'us_monthly', 'staged_overlap'] as const) {
    const t = bySection[s];
    if (t.unknown_count > 0) missing.push(`${pluralize(t.unknown_count, `${sectionLabel[s]} line still needs`, `${sectionLabel[s]} lines still need`)} an amount, a decision or dates.`);
  }
  if (extra === null) missing.push('The US monthly costs are incomplete, so the extra US months cannot be priced.');
  if (!cashRec || cash === null) missing.push('Current cash is not entered.');
  else if (!cashRec.data.as_of) missing.push('The date of the cash snapshot is missing.');
  if (!reserveRec || reserve === null) missing.push('The return reserve is not set.');
  if (!otherRec || other === null) missing.push('Other unpaid commitments are not entered (enter 0 only after checking there are none).');
  const jpyNeedsFx = lines.some((l) => l.native?.currency === 'JPY' && l.usd === null);
  if (jpyNeedsFx || (cash === null && cashRec?.data.amount?.currency === 'JPY' && fx === null)) missing.push('The JPY-per-USD exchange rate is not entered.');
  if (income.length === 0) missing.push('No income lines are recorded.');
  for (const i of income) if (!i.counted) missing.push(`Income is not verified for ${personName(people, i.person_id)}, so it is not counted.`);

  const model: CashModel = {
    horizon_months: horizonMonths,
    one_time_unpaid: bySection.one_time,
    tokyo_monthly: bySection.tokyo_monthly,
    us_monthly: bySection.us_monthly,
    staged_overlap: bySection.staged_overlap,
    extra_us_months: extraMonths,
    extra_us_usd: extra,
    other_commitments_usd: other,
    return_reserve_usd: reserve,
    need_usd_known: needKnown,
    need_complete: needComplete,
    cash_usd: cash,
    cash_as_of: cashRec?.data.as_of ?? null,
    headroom_usd: headroom,
    modeled_income_usd: modeledIncome,
    state,
    missing,
  };
  return { model, bySection };
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

export function computeBudget(inputs: BudgetInputs): BudgetView {
  const { costs, funding, anchors, people, scenario } = inputs;
  const anchorMap = new Map(anchors.map((a) => [a.code, a]));

  const fxRec = fundingOf(funding, 'fx_rate')[0];
  const base = fxRec && validRate(fxRec.data.jpy_per_usd) ? fxRec.data.jpy_per_usd : null;
  const active = activeFx(base, scenario.fx_factor);
  const fxView: FxView = {
    base_jpy_per_usd: base,
    active_jpy_per_usd: active,
    source: fxRec?.data.source ?? null,
    as_of: fxRec?.data.as_of ?? null,
    usd_effect_on_jpy_costs: validRate(scenario.fx_factor) ? usdEffectOfFxFactor(scenario.fx_factor) : null,
  };

  // The cash view starts at the earliest known adult arrival (household coordination date only as a fallback).
  const adultArrivals = people
    .filter((p) => p.kind === 'adult')
    .map((p) => anchorDate(anchorMap, p.anchors.arrival))
    .filter((d): d is string => !!d)
    .sort(compareCivil);
  const viewStart = adultArrivals[0] ?? anchorDate(anchorMap, 'T');

  const evaluate = (months: number): CostLineView[] => costs.map((c) => evaluateLine(c, active, { start: viewStart, months }, anchorMap));
  const income = incomeView(funding, active, people);

  const shortLines = evaluate(scenario.horizon_months);
  const short = buildCashModel({ lines: shortLines, horizonMonths: scenario.horizon_months, scenario, funding, fx: active, income, people, longView: false });
  const longLines = evaluate(SUSTAINABILITY_MONTHS);
  const long = buildCashModel({ lines: longLines, horizonMonths: SUSTAINABILITY_MONTHS, scenario, funding, fx: active, income, people, longView: true });

  const warnings: string[] = [];
  const jpyLines = costs.some((c) => c.data.applicability === 'include' && [c.data.committed, c.data.quote, c.data.estimate, c.data.unpaid_balance].some((m) => m?.currency === 'JPY'));
  if (jpyLines && active === null) warnings.push('Some amounts are in yen. They stay unknown until the JPY-per-USD rate is entered.');
  if (scenario.fx_factor !== 1 && validRate(scenario.fx_factor)) {
    const effect = usdEffectOfFxFactor(scenario.fx_factor);
    warnings.push(`Stress case: unchanged yen spending costs ${(Math.abs(effect) * 100).toFixed(2)}% ${effect >= 0 ? 'more' : 'less'} in US dollars.`);
  }
  if (fundingOf(funding, 'return_reserve').length > 0 && costs.some((c) => c.data.section === 'reserve' && c.data.applicability === 'include')) {
    warnings.push('A return reserve is entered both as funding and as a cost line. Enter each amount once.');
  }
  warnings.push(`The ${scenario.horizon_months}-month view is a settling-period cash view, not a funding forecast for the whole stay.`);

  return {
    scenario,
    fx: fxView,
    lines: shortLines,
    by_section: short.bySection,
    cash_model: short.model,
    sustainability: long.model,
    income,
    warnings,
  };
}
