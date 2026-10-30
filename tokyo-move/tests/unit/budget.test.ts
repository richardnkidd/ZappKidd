import { describe, expect, it } from 'vitest';
import { activeFx, computeBudget, DEFAULT_SCENARIOS, toUsd, usdEffectOfFxFactor } from '../../src/shared/budget';
import type { BaseRecord, CostData, FundingData, Money, ScenarioSettings } from '../../src/shared/types';
import { anchorsFrom } from '../../src/shared/deadlines';
import { demo } from './helpers';

const usd = (amount: number): Money => ({ amount, currency: 'USD' });
const jpy = (amount: number): Money => ({ amount, currency: 'JPY' });
const PLANNING: ScenarioSettings = { key: 'planning', label: 'Planning', fx_factor: 1, extra_us_months: 0, horizon_months: 3 };

function cost(key: string, d: Partial<CostData>): BaseRecord<'cost', CostData> {
  const data: CostData = {
    section: 'one_time', source_section: 'One-time', category: key, description: `Line ${key}`, applicability: 'include', exclusion_reason: null,
    estimate: null, quote: null, committed: null, paid: null, unpaid_balance: null, payer: null, quote_source: null, quote_date: null, deposit_due: null,
    refundable: 'unknown', uncertainty: '', commitment_state: 'not_committed', phase: null, duplication_check: null, ...d,
  };
  return { id: `cost:${key}`, household_id: 'h', type: 'cost', key, title: key, status: data.commitment_state, owner: null, owner_proposed: false, visibility: 'household', created_by: 'import', data, source: null, version: 1, created_at: '', updated_at: '', updated_by: null };
}

function fund(key: string, d: Partial<FundingData> & Pick<FundingData, 'kind'>): BaseRecord<'funding', FundingData> {
  const data: FundingData = { person_id: null, amount: null, as_of: null, source: null, evidence: null, ...d };
  return { id: `funding:${key}`, household_id: 'h', type: 'funding', key, title: key, status: 'recorded', owner: null, owner_proposed: false, visibility: 'household', created_by: 'import', data, source: null, version: 1, created_at: '', updated_at: '', updated_by: null };
}

const people = demo().people;
const anchors = anchorsFrom(demo().records);

function budget(costs: BaseRecord<'cost', CostData>[], funding: BaseRecord<'funding', FundingData>[], scenario = PLANNING, extraAnchors = anchors) {
  return computeBudget({ costs, funding, anchors: extraAnchors, people, scenario, today: '2026-10-29' });
}

const FX150 = fund('FX', { kind: 'fx_rate', jpy_per_usd: 150, as_of: '2026-10-28', source: 'test' });
const CASH = (n: number) => fund('CASH', { kind: 'cash_snapshot', amount: usd(n), as_of: '2026-10-28' });
const RESERVE = (n: number) => fund('RESERVE', { kind: 'return_reserve', amount: usd(n) });
const OTHER = (n: number) => fund('OTHER', { kind: 'other_commitments', amount: usd(n) });

describe('conversions', () => {
  it('toUsd converts JPY only with a usable rate and passes USD through', () => {
    expect(toUsd(usd(25), null)).toBe(25);
    expect(toUsd(jpy(15000), 150)).toBe(100);
    expect(toUsd(jpy(15000), null)).toBeNull();
    expect(toUsd(jpy(15000), 0)).toBeNull();
    expect(toUsd(null, 150)).toBeNull();
    expect(toUsd(usd(0), null)).toBe(0);
  });
  it('active FX is base × factor and null without a valid base', () => {
    expect(activeFx(150, 0.9)).toBeCloseTo(135, 10);
    expect(activeFx(null, 0.9)).toBeNull();
    expect(activeFx(150, 0)).toBeNull();
  });
  it('a 10% lower JPY-per-USD rate raises the USD cost of unchanged yen by 11.11%', () => {
    expect(usdEffectOfFxFactor(0.9)).toBeCloseTo(0.1111111, 6);
    expect(usdEffectOfFxFactor(1)).toBe(0);
    expect(usdEffectOfFxFactor(0.5)).toBe(1);
  });
  it('applies that stress to a yen line in a scenario and leaves dollar lines alone', () => {
    const costs = [cost('B1', { section: 'one_time', estimate: jpy(150000), unpaid_balance: jpy(150000), commitment_state: 'estimate' }), cost('B2', { section: 'one_time', estimate: usd(500), unpaid_balance: usd(500), commitment_state: 'estimate' })];
    const base = budget(costs, [FX150], PLANNING);
    const stress = budget(costs, [FX150], DEFAULT_SCENARIOS[2]!);
    expect(base.fx.active_jpy_per_usd).toBe(150);
    expect(base.lines[0]?.unpaid_usd).toBeCloseTo(1000, 6);
    expect(stress.fx.active_jpy_per_usd).toBeCloseTo(135, 10);
    expect(stress.fx.usd_effect_on_jpy_costs).toBeCloseTo(0.1111111, 6);
    expect(stress.lines[0]?.unpaid_usd).toBeCloseTo(1111.111111, 5);
    expect(stress.lines[0]!.unpaid_usd! / base.lines[0]!.unpaid_usd!).toBeCloseTo(1.1111111, 6);
    expect(stress.lines[1]?.unpaid_usd).toBe(500);
    expect(stress.warnings.some((w) => w.includes('11.11%'))).toBe(true);
  });
});

describe('unknown is never zero', () => {
  it('review lines, missing amounts and missing FX are unknown and block completeness', () => {
    const costs = [
      cost('R', { applicability: 'review' }),
      cost('M', { applicability: 'include' }),
      cost('J', { applicability: 'include', estimate: jpy(90000), commitment_state: 'estimate' }),
      cost('K', { applicability: 'include', estimate: usd(100), commitment_state: 'estimate' }),
    ];
    const v = budget(costs, [CASH(10000), RESERVE(1000), OTHER(0)]);
    expect(v.by_section.one_time.known_usd).toBe(100);
    expect(v.by_section.one_time.unknown_keys.sort()).toEqual(['J', 'M', 'R']);
    expect(v.by_section.one_time.complete).toBe(false);
    expect(v.lines.find((l) => l.key === 'R')?.usd).toBeNull();
    expect(v.lines.find((l) => l.key === 'J')?.missing.join(' ')).toMatch(/exchange rate/);
    expect(v.cash_model.need_complete).toBe(false);
    expect(v.cash_model.headroom_usd).toBeNull();
    expect(v.cash_model.state).toBe('incomplete');
    expect(v.cash_model.missing.join(' ')).toMatch(/one-time cost lines still need/);
    expect(v.warnings.some((w) => /yen/.test(w))).toBe(true);
  });

  it('an exclusion needs a reason; without one the line is unknown, not excluded', () => {
    const v = budget([cost('E1', { applicability: 'exclude', exclusion_reason: 'Furnished apartment.' }), cost('E2', { applicability: 'exclude', exclusion_reason: '  ' })], []);
    expect(v.lines[0]?.stage).toBe('excluded');
    expect(v.lines[1]?.stage).toBe('unknown');
    expect(v.by_section.one_time.excluded_count).toBe(1);
    expect(v.by_section.one_time.unknown_keys).toEqual(['E2']);
  });
});

describe('one-time lines count the unpaid balance', () => {
  it('uses unpaid_balance, paid-in-full is 0, and best amount is committed > quote > estimate', () => {
    const costs = [
      cost('A', { quote: usd(1200), paid: usd(300), unpaid_balance: usd(900), commitment_state: 'partially_paid' }),
      cost('B', { committed: usd(260), paid: usd(260), commitment_state: 'paid' }),
      cost('C', { estimate: usd(1000), quote: usd(1400), commitment_state: 'quote' }),
      cost('D', { estimate: usd(800), quote: usd(1000), committed: usd(950), commitment_state: 'approved_commitment', unpaid_balance: usd(950) }),
    ];
    const v = budget(costs, []);
    expect(v.lines.map((l) => [l.key, l.stage, l.usd, l.unpaid_usd, l.paid_usd])).toEqual([
      ['A', 'partially_paid', 1200, 900, 300],
      ['B', 'paid', 260, 0, 260],
      ['C', 'quote', 1400, 1400, null],
      ['D', 'approved_commitment', 950, 950, null],
    ]);
    expect(v.by_section.one_time.known_usd).toBe(900 + 0 + 1400 + 950);
    expect(v.by_section.one_time.complete).toBe(true);
  });

  it('an approved commitment with no recorded balance is unknown rather than guessed', () => {
    const v = budget([cost('X', { committed: usd(500), commitment_state: 'approved_commitment' })], []);
    expect(v.lines[0]?.unpaid_usd).toBeNull();
    expect(v.lines[0]?.missing.join(' ')).toMatch(/unpaid balance/);
  });
});

describe('monthly lines', () => {
  const T_ARRIVE = (d: string | null) => anchors.map((a) => (a.code === 'TN' ? { ...a, date: d } : a));

  it('multiply the monthly amount by the months in the horizon', () => {
    const costs = [
      cost('T1', { section: 'tokyo_monthly', estimate: jpy(150000), commitment_state: 'estimate' }),
      cost('U1', { section: 'us_monthly', estimate: usd(1000), commitment_state: 'estimate' }),
    ];
    const v = budget(costs, [FX150]);
    expect(v.lines[0]).toMatchObject({ usd: 1000, months_in_horizon: 3, horizon_usd: 3000 });
    expect(v.by_section.tokyo_monthly.known_usd).toBe(3000);
    expect(v.by_section.tokyo_monthly.monthly_known_usd).toBe(1000);
    expect(v.by_section.us_monthly.known_usd).toBe(3000);
    // the 36-month sustainability view multiplies by 36 and says so
    expect(v.sustainability.horizon_months).toBe(36);
    expect(v.sustainability.tokyo_monthly.known_usd).toBe(36000);
  });

  it('a line with a phase counts only the months its phase overlaps', () => {
    // Avery arrives 2027-07-06 (the demo anchor), Jun arrives 2027-08-06: overlap lasts one month inside the 3-month view.
    const withJun = T_ARRIVE('2027-07-06').map((a) => (a.code === 'TR' ? { ...a, date: '2027-08-05' } : a));
    const overlap = cost('O1', { section: 'staged_overlap', estimate: usd(900), commitment_state: 'estimate', phase: { traveler: 'jun', start_anchor: 'TN', start_date: null, end_anchor: 'TR', end_date: null, months: null, note: null } });
    const v = budget([overlap], [], PLANNING, withJun);
    expect(v.lines[0]?.months_in_horizon).toBeCloseTo(1, 6);
    expect(v.lines[0]?.horizon_usd).toBeCloseTo(900, 4);
    // a phase longer than the horizon is capped by the horizon
    const long = cost('O2', { section: 'staged_overlap', estimate: usd(100), commitment_state: 'estimate', phase: { traveler: null, start_anchor: null, start_date: '2027-07-06', end_anchor: null, end_date: '2028-07-05', months: null, note: null } });
    expect(budget([long], [], PLANNING, withJun).lines[0]?.months_in_horizon).toBeCloseTo(3, 6);
    expect(budget([long], [], PLANNING, withJun).sustainability.staged_overlap.known_usd).toBeCloseTo(1200, 4);
  });

  it('unknown phase dates without explicit months are unknown, not the full stay', () => {
    const unknownEnd = cost('P1', { section: 'staged_overlap', estimate: usd(900), commitment_state: 'estimate', phase: { traveler: 'jun', start_anchor: 'TN', start_date: null, end_anchor: 'TR', end_date: null, months: null, note: null } });
    const v = budget([unknownEnd], [], PLANNING, T_ARRIVE('2027-07-06')); // TR is blank
    expect(v.lines[0]?.months_in_horizon).toBeNull();
    expect(v.lines[0]?.horizon_usd).toBeNull();
    expect(v.by_section.staged_overlap.unknown_keys).toEqual(['P1']);
    expect(v.by_section.staged_overlap.known_usd).toBe(0);
    const monthlyPhase = cost('P2', { section: 'tokyo_monthly', estimate: usd(200), commitment_state: 'estimate', phase: { traveler: 'jun', start_anchor: 'EHR', start_date: null, end_anchor: null, end_date: null, months: null, note: null } });
    expect(budget([monthlyPhase], []).lines[0]?.months_in_horizon).toBeNull();
    // an overlap with no phase at all is unknown too
    const noPhase = cost('P3', { section: 'staged_overlap', estimate: usd(300), commitment_state: 'estimate' });
    expect(budget([noPhase], []).lines[0]?.horizon_usd).toBeNull();
  });

  it('explicit months stand in for unknown dates, capped by the horizon', () => {
    const c = cost('P4', { section: 'staged_overlap', estimate: usd(500), commitment_state: 'estimate', phase: { traveler: null, start_anchor: null, start_date: null, end_anchor: null, end_date: null, months: 2, note: null } });
    const v = budget([c], []);
    expect(v.lines[0]).toMatchObject({ months_in_horizon: 2, horizon_usd: 1000 });
    expect(v.sustainability.staged_overlap.known_usd).toBe(1000);
  });
});

describe('need, reserve and headroom', () => {
  const lines = [
    cost('O', { section: 'one_time', estimate: usd(2000), unpaid_balance: usd(2000), commitment_state: 'estimate' }),
    cost('T', { section: 'tokyo_monthly', estimate: usd(1500), commitment_state: 'estimate' }),
    cost('U', { section: 'us_monthly', estimate: usd(1000), commitment_state: 'estimate' }),
  ];

  it('adds reserve, other commitments and the extra US months stress, and computes headroom only when complete', () => {
    const scenario: ScenarioSettings = { key: 'condo_delay', label: 'Condo delay', fx_factor: 1, extra_us_months: 3, horizon_months: 3 };
    const v = budget(lines, [CASH(30000), RESERVE(5000), OTHER(1000)], scenario);
    const cm = v.cash_model;
    expect(cm.one_time_unpaid.known_usd).toBe(2000);
    expect(cm.tokyo_monthly.known_usd).toBe(4500);
    expect(cm.us_monthly.known_usd).toBe(3000);
    expect(cm.extra_us_months).toBe(3);
    expect(cm.extra_us_usd).toBe(3000); // us run-rate 1000 × 3 extra months
    expect(cm.need_usd_known).toBe(2000 + 4500 + 3000 + 3000 + 1000 + 5000);
    expect(cm.need_complete).toBe(true);
    expect(cm.headroom_usd).toBe(30000 - 18500);
    expect(cm.cash_as_of).toBe('2026-10-28');
    expect(cm.state).toBe('cash_view_ready_income_unverified'); // no income lines => unverified at best
  });

  it('no headroom when cash is unknown, or the reserve / other commitments are unset, even if lines are complete', () => {
    expect(budget(lines, [RESERVE(5000), OTHER(0)]).cash_model.headroom_usd).toBeNull();
    const noReserve = budget(lines, [CASH(30000), OTHER(0)]);
    expect(noReserve.cash_model.need_complete).toBe(false);
    expect(noReserve.cash_model.headroom_usd).toBeNull();
    expect(noReserve.cash_model.missing.join(' ')).toMatch(/return reserve is not set/);
    const noOther = budget(lines, [CASH(30000), RESERVE(5000)]);
    expect(noOther.cash_model.headroom_usd).toBeNull();
    expect(noOther.cash_model.missing.join(' ')).toMatch(/Other unpaid commitments/);
    // an explicit zero is a real answer
    expect(budget(lines, [CASH(30000), RESERVE(5000), OTHER(0)]).cash_model.need_complete).toBe(true);
  });

  it('an unknown US monthly line makes the extra-months stress unknown, so the need is incomplete', () => {
    const scenario: ScenarioSettings = { key: 'condo_delay', label: 'x', fx_factor: 1, extra_us_months: 3, horizon_months: 3 };
    const withUnknown = [...lines, cost('U2', { section: 'us_monthly' })];
    const v = budget(withUnknown, [CASH(30000), RESERVE(5000), OTHER(0)], scenario);
    expect(v.cash_model.extra_us_usd).toBeNull();
    expect(v.cash_model.need_complete).toBe(false);
    expect(v.cash_model.headroom_usd).toBeNull();
    // with zero extra months the unknown line still blocks via its own section
    expect(budget(withUnknown, [CASH(30000), RESERVE(5000), OTHER(0)]).cash_model.need_complete).toBe(false);
  });
});

describe('income', () => {
  const lines = [cost('O', { section: 'one_time', estimate: usd(1000), unpaid_balance: usd(1000), commitment_state: 'estimate' })];
  const base = [CASH(10000), RESERVE(1000), OTHER(0)];
  const zero = fund('INC-JUN', { kind: 'income', person_id: 'jun', amount: usd(0), monthly: true, income_status: 'planning_zero' });
  const unverified = fund('INC-AVERY', { kind: 'income', person_id: 'avery', amount: usd(4000), monthly: true, income_status: 'unverified' });

  it('planning-zero income counts as 0; unverified income is never counted', () => {
    const v = budget(lines, [...base, zero, unverified]);
    expect(v.income).toEqual([
      { person_id: 'jun', status: 'planning_zero', monthly_usd: 0, counted: true, note: expect.any(String) },
      { person_id: 'avery', status: 'unverified', monthly_usd: 4000, counted: false, note: expect.stringContaining('verified') },
    ]);
    expect(v.cash_model.modeled_income_usd).toBeNull();
    expect(v.cash_model.state).toBe('cash_view_ready_income_unverified');
    expect(v.cash_model.headroom_usd).toBe(10000 - 1000 - 1000);
    expect(v.cash_model.missing.join(' ')).toMatch(/Income is not verified for Avery/);
  });

  it('reaches "complete" only when every income line is counted', () => {
    const verified = fund('INC-AVERY', { kind: 'income', person_id: 'avery', amount: usd(4000), monthly: true, income_status: 'verified_lawful' });
    const v = budget(lines, [...base, zero, verified]);
    expect(v.cash_model.modeled_income_usd).toBe(4000 * 3);
    expect(v.cash_model.state).toBe('complete');
    expect(v.sustainability.modeled_income_usd).toBe(4000 * 36);
    // yen income needs FX to be counted
    const yen = fund('INC-AVERY', { kind: 'income', person_id: 'avery', amount: jpy(600000), monthly: true, income_status: 'verified_lawful' });
    expect(budget(lines, [...base, zero, yen]).cash_model.state).toBe('cash_view_ready_income_unverified');
    expect(budget(lines, [...base, zero, yen, FX150]).cash_model.modeled_income_usd).toBe(4000 * 3);
  });

  it('with no income lines at all the state is never "complete"', () => {
    expect(budget(lines, base).cash_model.state).toBe('cash_view_ready_income_unverified');
  });
});

describe('the demo household', () => {
  it('has no FX by default, so yen lines are unknown and nothing claims affordability', () => {
    const d = demo();
    const costs = d.records.filter((r) => r.type === 'cost') as unknown as BaseRecord<'cost', CostData>[];
    const funding = d.records.filter((r) => r.type === 'funding') as unknown as BaseRecord<'funding', FundingData>[];
    const v = computeBudget({ costs, funding, anchors: anchorsFrom(d.records), people: d.people, scenario: PLANNING, today: '2026-10-29' });
    expect(v.fx.base_jpy_per_usd).toBeNull();
    expect(v.lines.find((l) => l.key === 'B04')?.usd).toBeNull(); // yen deposit
    expect(v.by_section.one_time.unknown_keys).toEqual(expect.arrayContaining(['B01', 'B04']));
    expect(v.lines.find((l) => l.key === 'B05')?.unpaid_usd).toBe(0); // paid in full
    expect(v.lines.find((l) => l.key === 'B06')?.unpaid_usd).toBe(900);
    expect(v.lines.find((l) => l.key === 'B07')?.stage).toBe('excluded');
    expect(v.lines.find((l) => l.key === 'B15')?.months_in_horizon).toBeCloseTo(2.3, 0); // TN → TP, inside the 3-month view
    expect(v.lines.find((l) => l.key === 'B14')?.horizon_usd).toBeNull(); // Jun's arrival not set
    expect(v.lines.find((l) => l.key === 'B16')?.horizon_usd).toBe(1000);
    expect(v.cash_model.state).toBe('incomplete');
    expect(v.cash_model.headroom_usd).toBeNull();
    expect(v.cash_model.cash_usd).toBe(62000);
    expect(v.income.find((i) => i.person_id === 'jun')?.counted).toBe(true);
    expect(v.income.find((i) => i.person_id === 'avery')?.counted).toBe(false);

    // entering the rate makes the yen lines known (but other unknowns keep the view incomplete)
    const fxRec = funding.find((f) => f.data.kind === 'fx_rate')!;
    fxRec.data.jpy_per_usd = 150;
    const v2 = computeBudget({ costs, funding, anchors: anchorsFrom(d.records), people: d.people, scenario: PLANNING, today: '2026-10-29' });
    expect(v2.lines.find((l) => l.key === 'B04')?.unpaid_usd).toBeCloseTo(6400, 6);
    expect(v2.cash_model.state).toBe('incomplete');
  });
});
