import { plural } from './format';
import type { CashModel, MoneyTotal } from '@shared/engine-contracts';
import type { CostSection, Currency, Money, ScenarioSettings } from '@shared/types';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const jpy = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

export function fmtUsd(n: number | null | undefined, empty = 'Not known yet'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return empty;
  return Math.abs(n - Math.round(n)) < 0.005 ? usd0.format(Math.round(n)) : usd2.format(n);
}

export function fmtMoney(m: Money | null | undefined, empty = 'Amount not known yet'): string {
  if (!m || !Number.isFinite(m.amount)) return empty;
  return m.currency === 'JPY' ? jpy.format(m.amount) : fmtUsd(m.amount);
}

export const CURRENCY_LABEL: Record<Currency, string> = { USD: 'US dollars', JPY: 'Japanese yen' };

export const SECTION_TITLE: Record<CostSection, string> = {
  one_time: 'One-time move',
  tokyo_monthly: 'Tokyo monthly',
  us_monthly: 'Continuing US monthly',
  staged_overlap: 'Staged overlap',
  reserve: 'Protected reserve',
};

export const SECTION_INTRO: Record<CostSection, string> = {
  one_time: 'Costs that happen once. Only the part not yet paid counts toward what is still needed.',
  tokyo_monthly: 'Monthly costs in Tokyo, counted for the months in the view you are looking at.',
  us_monthly: 'US costs that keep running after the move starts.',
  staged_overlap: 'Extra costs while people and the dog move at different times.',
  reserve: 'Money kept aside in case of a return. It is never treated as spendable.',
};

export const SECTION_ORDER: CostSection[] = ['one_time', 'tokyo_monthly', 'us_monthly', 'staged_overlap', 'reserve'];

export const STAGE_LABEL: Record<string, string> = {
  estimate: 'Estimate',
  quote: 'Quote',
  approved_commitment: 'Approved',
  paid: 'Paid',
  partially_paid: 'Partly paid',
  unknown: 'Not known yet',
  excluded: 'Left out on purpose',
};

/**
 * How a scenario moves the exchange rate, in terms of the dollar (which is unambiguous, unlike "weaker" or "stronger"
 * yen). The factor multiplies the yen-per-dollar rate: 0.9 means the dollar buys 10% fewer yen, so yen costs are more
 * in dollars; 1.1 means it buys 10% more yen, so they are less.
 */
export function fxChangePercent(factor: number): string {
  const pct = Math.round(Math.abs(1 - factor) * 1000) / 10; // one decimal, no floating-point noise
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/** The settings form's number for a factor: percent fewer yen per dollar, negative when the dollar buys more. */
export function fxChangeInput(factor: number): string {
  if (factor === 1) return '0';
  return factor > 1 ? `-${fxChangePercent(factor)}` : fxChangePercent(factor);
}

/** "the dollar buying 10% fewer yen" (factor below 1) or "the dollar buying 10% more yen" (above 1). */
export function fxChangePhrase(factor: number): string {
  return `the dollar buying ${fxChangePercent(factor)}% ${factor < 1 ? 'fewer' : 'more'} yen`;
}

/** The effect of that change on fixed-yen costs, as one sentence. `effect` is the proportional change in dollar cost. */
export function fxEffectSentence(factor: number, effect: number): string {
  return `If the dollar buys ${fxChangePercent(factor)}% ${factor < 1 ? 'fewer' : 'more'} yen, fixed-yen costs are ${(Math.abs(effect) * 100).toFixed(2)}% ${effect >= 0 ? 'more' : 'less'} in dollars.`;
}

/** One calm line per scenario; built from the scenario's own numbers so edits to a scenario stay truthful. */
export function scenarioExplanation(s: ScenarioSettings): string {
  const parts: string[] = [];
  if (s.extra_us_months > 0) parts.push(`${s.extra_us_months} more ${s.extra_us_months === 1 ? 'month' : 'months'} of continuing US costs`);
  if (s.fx_factor !== 1) parts.push(fxChangePhrase(s.fx_factor));
  if (parts.length === 0) return 'Costs as they are known today, with nothing extra assumed.';
  return `Same plan, but with ${parts.join(' and ')}.`;
}

/** True when a section has lines but not one of them has a usable amount (unknown is never shown as $0). */
export function noAmountsYet(total: MoneyTotal, lineCount: number): boolean {
  if (lineCount === 0) return false;
  if (total.known_usd === null) return true;
  const known = total.known_count ?? (total.known_usd > 0 ? 1 : 0);
  return known === 0 && total.unknown_count > 0;
}

/** "$1,200 known so far · 3 not known yet", or "No amounts yet" while nothing is known; never a lone total. */
export function knownSoFar(total: MoneyTotal, lineCount: number): { primary: string; secondary: string } {
  if (lineCount === 0) return { primary: 'Nothing listed yet', secondary: '' };
  const unknown = total.unknown_count;
  const primary = noAmountsYet(total, lineCount) ? 'No amounts yet' : `Known so far ${fmtUsd(total.known_usd)}`;
  const secondary = unknown > 0 ? (primary === 'No amounts yet' ? `${plural(unknown, 'line')} to price` : `${unknown} not known yet`) : 'every amount known';
  return { primary, secondary };
}

export interface CashStatement {
  tone: 'kin' | 'ai' | 'matcha';
  headline: string;
  detail: string | null;
}

/** The engine's state in plain words. It never says "affordable" while anything is unknown. */
export function cashStatement(model: CashModel, incomeNotCounted: number): CashStatement {
  const amounts = model.one_time_unpaid.unknown_count + model.tokyo_monthly.unknown_count + model.us_monthly.unknown_count + model.staged_overlap.unknown_count;
  switch (model.state) {
    case 'incomplete': {
      const bits: string[] = [];
      if (amounts > 0) bits.push(`${amounts} ${amounts === 1 ? 'amount' : 'amounts'}`);
      if (incomeNotCounted > 0) bits.push(`${incomeNotCounted === 1 ? 'one income' : `${incomeNotCounted} incomes`}`);
      const what = bits.length ? bits.join(' and ') : 'some details';
      return {
        tone: 'kin',
        headline: `Can't conclude yet — ${what} ${amounts + incomeNotCounted === 1 ? 'is' : 'are'} unknown`,
        detail: 'Totals below are what is known so far, not what is needed.',
      };
    }
    case 'cash_view_ready_income_unverified':
      return {
        tone: 'ai',
        headline: 'Cash for this period is accounted for — income is still unverified',
        detail: 'Without verified income there is no longer-term conclusion.',
      };
    default:
      return {
        tone: 'matcha',
        headline: model.headroom_usd !== null ? `Everything is known for this view. Headroom: ${fmtUsd(model.headroom_usd)}` : 'Everything is known for this view.',
        detail: null,
      };
  }
}

/**
 * The shipped scenario names, in plain words. A scenario the household has renamed keeps its own name. The currency
 * half of the shipped stress case follows its factor, so editing the factor never leaves a wrong label behind.
 */
export function scenarioLabel(s: ScenarioSettings): string {
  if (s.key !== 'combined_stress' || s.label !== 'Combined stress') return s.label;
  if (s.fx_factor === 1) return s.label;
  return s.fx_factor < 1 ? 'Delay + stronger yen' : 'Delay + weaker yen';
}
