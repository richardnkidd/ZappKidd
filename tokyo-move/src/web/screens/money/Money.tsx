import { useMemo, useState } from 'react';
import { usdEffectOfFxFactor, computeBudget } from '@shared/budget';
import { anchorsFrom } from '@shared/deadlines';
import type { BudgetView, CostLineView } from '@shared/engine-contracts';
import type { BaseRecord, CostData, CostSection, FundingData, ScenarioSettings } from '@shared/types';
import { Chip } from '../../components/Badges';
import { ClampText } from '../../components/ClampText';
import { usePlain } from '../../components/People';
import { Button, SegmentedControl } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Disclosure } from '../../components/Disclosure';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { PersonName } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { civil, plural } from '../../lib/format';
import {
  cashStatement,
  fmtMoney,
  fmtUsd,
  knownSoFar,
  scenarioExplanation,
  scenarioLabel,
  SECTION_INTRO,
  SECTION_ORDER,
  SECTION_TITLE,
  STAGE_LABEL,
  weakerYenPercent,
} from '../../lib/money';
import { attempt } from '../../lib/safe';
import { dataOf, type Directory, type Indexes } from '../../lib/records';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { CostLineDialog, FxDialog } from './moneyDialogs';

const STAGE_TONE: Record<string, 'neutral' | 'ai' | 'matcha' | 'kin'> = {
  estimate: 'neutral',
  quote: 'ai',
  approved_commitment: 'ai',
  paid: 'matcha',
  partially_paid: 'matcha',
  unknown: 'neutral',
  excluded: 'neutral',
};

function CostLine({ line, record, onEdit }: { line: CostLineView; record: BaseRecord | undefined; onEdit: () => void }) {
  const plain = usePlain();
  const monthly = line.section !== 'one_time';
  const note = (record?.data as { review_note?: string | null } | undefined)?.review_note;
  // A line with no amount reads as one short row with a single way forward, not an empty amount column.
  const unknown = line.stage === 'unknown' || (line.native === null && line.stage !== 'excluded');
  return (
    <li className={`cost-line${unknown ? ' cost-line--unknown' : ''}`}>
      <div className="cost-line__main">
        <p className="cost-line__title">{record ? <RecordLink id={record.id}>{line.description}</RecordLink> : line.description}</p>
        <div className="item__meta">
          <Chip tone={STAGE_TONE[line.stage] ?? 'neutral'} small>
            {STAGE_LABEL[line.stage] ?? line.stage}
          </Chip>
          {line.paid_usd !== null && line.paid_usd > 0 && <span className="small muted">Paid {fmtUsd(line.paid_usd)}</span>}
          {line.unpaid_usd !== null && line.stage !== 'excluded' && !monthly && <span className="small muted">{fmtUsd(line.unpaid_usd)} still to pay</span>}
        </div>
        {line.missing.length > 0 && (
          <ul className="cost-line__missing small">
            {(unknown ? line.missing.slice(0, 1) : line.missing).map((m) => (
              <li key={m}>
                <Icon name="info" size={13} /> {m}
              </li>
            ))}
          </ul>
        )}
        {note && <ClampText lines={2} className="small muted preline">{plain(note)}</ClampText>}
      </div>
      <div className="cost-line__amount">
        {unknown ? (
          <Button variant="secondary" small icon="plus" onClick={onEdit} aria-label={`Add amount: ${line.description}`}>
            Add amount
          </Button>
        ) : (
          <>
            <p className="cost-line__native">
              {fmtMoney(line.native)}
              {monthly && line.native ? <span className="faint small"> a month</span> : null}
            </p>
            {line.native?.currency === 'JPY' && line.usd !== null && <p className="small muted">about {fmtUsd(line.usd)}</p>}
            {monthly && line.horizon_usd !== null && line.months_in_horizon !== null && (
              <p className="small muted">
                {fmtUsd(line.horizon_usd)} over {plural(line.months_in_horizon, 'month')}
              </p>
            )}
            <Button variant="quiet" small icon="pencil" onClick={onEdit} aria-label={`Edit ${line.description}`}>
              Edit
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function SectionCard({ section, budget, idx, onEdit }: { section: CostSection; budget: BudgetView; idx: Indexes; onEdit: (r: BaseRecord) => void }) {
  const lines = budget.lines.filter((l) => l.section === section);
  const total = budget.by_section[section];
  const summary = knownSoFar(total, lines.length);
  const isReserve = section === 'reserve';
  const reserve = budget.cash_model.return_reserve_usd;
  return (
    <Disclosure
      title={SECTION_TITLE[section]}
      meta={isReserve ? (reserve === null ? 'Not known yet' : fmtUsd(reserve)) : lines.length === 0 ? 'Nothing listed' : `${plural(lines.length, 'line')} · ${summary.primary}${summary.secondary ? ` · ${summary.secondary}` : ''}`}
      className="money-section"
    >
      <p className="muted small">{SECTION_INTRO[section]}</p>
      {isReserve && (
        <p className="money-reserve">
          Set aside for a possible return: <strong>{fmtUsd(reserve)}</strong>
        </p>
      )}
      {lines.length > 0 ? (
        <ul className="cost-lines">
          {lines.map((l) => {
            const rec = idx.byKey.get(l.key);
            return <CostLine key={l.key} line={l} record={rec} onEdit={() => rec && onEdit(rec)} />;
          })}
        </ul>
      ) : (
        !isReserve && <p className="muted">No lines in this section yet.</p>
      )}
      {total.excluded_count > 0 && <p className="small faint">{plural(total.excluded_count, 'line')} left out on purpose.</p>}
    </Disclosure>
  );
}

function FxPanel({ budget, scenario, fxRecord, onEdit }: { budget: BudgetView; scenario: ScenarioSettings; fxRecord: BaseRecord | null; onEdit: () => void }) {
  const fx = budget.fx;
  const effect = scenario.fx_factor !== 1 ? attempt(() => usdEffectOfFxFactor(scenario.fx_factor)) : null;
  const rate = (n: number) => `¥${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} per $1`;
  return (
    <Card as="section" aria-labelledby="fx-title" className="fx fx--compact">
      <div className="row row--between">
        <h3 id="fx-title" className="money-h3">
          Exchange rate
        </h3>
        {fxRecord && (
          <Button variant="quiet" small icon="pencil" onClick={onEdit}>
            {fx.base_jpy_per_usd ? 'Edit' : 'Add rate'}
          </Button>
        )}
      </div>
      {fx.base_jpy_per_usd ? (
        <p>
          <strong>{rate(fx.active_jpy_per_usd ?? fx.base_jpy_per_usd)}</strong>
          {scenario.fx_factor !== 1 && fx.active_jpy_per_usd ? <span className="muted"> in this situation (base {rate(fx.base_jpy_per_usd)})</span> : null}
          <span className="muted small">
            {' '}
            · {fx.source ?? 'source not recorded'}
            {fx.as_of ? `, ${civil(fx.as_of)}` : ''}
          </span>
        </p>
      ) : (
        <p className="muted">No exchange rate yet. Add one so yen costs can be counted.</p>
      )}
      {effect && effect.ok && (
        <p className="fx__effect">
          <Icon name="info" size={16} /> A {weakerYenPercent(scenario.fx_factor)}% {scenario.fx_factor < 1 ? 'weaker' : 'stronger'} yen makes fixed-yen costs {Math.abs(effect.value * 100).toFixed(2)}% {effect.value >= 0 ? 'more' : 'less'} in dollars.
        </p>
      )}
    </Card>
  );
}

function IncomeCards({ budget }: { budget: BudgetView }) {
  if (budget.income.length === 0) return null;
  return (
    <Section title="Income" headingLevel={3} intro="Only income that has been checked is counted. Everything else is left out of the totals.">
      <ul className="income-list">
        {budget.income.map((i) => {
          const planningZero = i.status === 'planning_zero';
          return (
            <li key={i.person_id} className="income">
              <p className="income__who">
                <PersonName id={i.person_id} />
              </p>
              <p>
                {planningZero
                  ? 'Planning at $0 a month — a deliberate choice for planning, not a forecast.'
                  : i.status === 'unverified'
                    ? 'Not counted — it has not been verified yet.'
                    : i.status === 'confirmed_none'
                      ? 'No income expected.'
                      : i.counted && i.monthly_usd !== null
                        ? `${fmtUsd(i.monthly_usd)} a month, counted.`
                        : 'Not counted.'}
              </p>
              {i.note && <p className="small muted preline">{i.note}</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function Money() {
  return (
    <div className="page money">
      <PageTitle kicker="What it costs, and what we know">Money</PageTitle>
      <DataGate>{({ snapshot, idx, dir }) => <MoneyBody scenarios={snapshot.scenarios} idx={idx} dir={dir} people={snapshot.people} />}</DataGate>
    </div>
  );
}

function MoneyBody({ scenarios, idx, dir, people }: { scenarios: ScenarioSettings[]; idx: Indexes; dir: Directory; people: Parameters<typeof computeBudget>[0]['people'] }) {
  const { today } = useData();
  const { refresh } = useSnapshot();
  const [scenarioKey, setScenarioKey] = useState(scenarios[0]?.key ?? 'planning');
  const [view, setView] = useState<'first' | 'three'>('first');
  const [editing, setEditing] = useState<BaseRecord | null>(null);
  const [fxOpen, setFxOpen] = useState(false);
  const scenario = scenarios.find((s) => s.key === scenarioKey) ?? scenarios[0];

  const costs = useMemo(() => idx.all.filter((r) => r.type === 'cost'), [idx]);
  const funding = useMemo(() => idx.all.filter((r) => r.type === 'funding'), [idx]);
  const fxRecord = funding.find((f) => dataOf<FundingData>(f).kind === 'fx_rate') ?? null;

  const budget = useMemo(
    () =>
      scenario
        ? attempt(() =>
            computeBudget({
              costs: costs as never,
              funding: funding as never,
              anchors: anchorsFrom(idx.all),
              people,
              scenario,
              today,
            }),
          )
        : null,
    [scenario, costs, funding, idx, people, today],
  );

  if (!scenario || scenarios.length === 0) {
    return <EmptyState icon="money" title="No scenarios are set up yet." />;
  }
  if (!budget || !budget.ok) {
    return (
      <ErrorBanner title="We couldn't work out the money picture just now." onRetry={() => void refresh()}>
        {budget && !budget.ok ? budget.error.message : 'Try again in a moment.'} Nothing has changed.
      </ErrorBanner>
    );
  }
  const b = budget.value;
  if (costs.length === 0 && funding.length === 0) {
    return <EmptyState icon="money" title="No costs or savings have been added yet." />;
  }

  const model = view === 'first' ? b.cash_model : b.sustainability;
  const incomeNotCounted = b.income.filter((i) => !i.counted && i.status === 'unverified').length;
  const statement = cashStatement(model, incomeNotCounted);

  return (
    <div className="stack stack--loose">
      <Section title="Which situation?" headingLevel={2}>
        <SegmentedControl
          label="Scenario"
          value={scenarioKey}
          onChange={setScenarioKey}
          options={scenarios.map((s) => ({ value: s.key, label: scenarioLabel(s) }))}
        />
        <p className="muted" role="status">
          {scenarioExplanation(scenario)}
        </p>
      </Section>

      <FxPanel budget={b} scenario={scenario} fxRecord={fxRecord} onEdit={() => setFxOpen(true)} />

      <Section title="The cash picture" headingLevel={2}>
        <SegmentedControl
          label="Time span"
          value={view}
          onChange={setView}
          options={[
            { value: 'first', label: 'First 90 days' },
            { value: 'three', label: 'Three-year view' },
          ]}
        />
        <Card tone={statement.tone === 'kin' ? 'attention' : 'default'} className="cash">
          <p className="cash__headline">
            <Icon name={statement.tone === 'matcha' ? 'check' : 'info'} size={18} /> {statement.headline}
          </p>
          {statement.detail && <p className="muted">{statement.detail}</p>}
          <dl className="facts facts--tight">
            <div className="fact">
              <dt>Known need so far</dt>
              <dd>
                {!model.need_complete && !(model.need_usd_known && model.need_usd_known > 0) ? 'No amounts yet' : fmtUsd(model.need_usd_known)}
                {!model.need_complete && model.need_usd_known !== null && model.need_usd_known > 0 && <span className="faint small"> (not the full need)</span>}
              </dd>
            </div>
            <div className="fact">
              <dt>Cash on hand</dt>
              <dd>
                {fmtUsd(model.cash_usd)}
                {model.cash_as_of && <span className="faint small"> as of {civil(model.cash_as_of)}</span>}
              </dd>
            </div>
            <div className="fact">
              <dt>Protected reserve</dt>
              <dd>{fmtUsd(model.return_reserve_usd)}</dd>
            </div>
            <div className="fact">
              <dt>Other commitments</dt>
              <dd>{fmtUsd(model.other_commitments_usd)}</dd>
            </div>
            <div className="fact">
              <dt>Headroom</dt>
              <dd>{model.headroom_usd === null ? 'Not shown until everything is known' : fmtUsd(model.headroom_usd)}</dd>
            </div>
            {model.modeled_income_usd !== null && (
              <div className="fact">
                <dt>Income counted</dt>
                <dd>{fmtUsd(model.modeled_income_usd)}</dd>
              </div>
            )}
          </dl>
          {model.missing.length > 0 && (
            <Disclosure title="What is still missing" meta={String(model.missing.length)} level={3} className="disclosure--flat">
              <ul className="plain-list">
                {model.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Card>
        <IncomeCards budget={b} />
      </Section>

      <Section title="Where the money goes" headingLevel={2} intro="Each part shows what is known so far and how much is still unknown. A total is never shown on its own.">
        <div className="stack stack--tight">
          {SECTION_ORDER.map((s) => (
            <SectionCard key={s} section={s} budget={b} idx={idx} onEdit={setEditing} />
          ))}
        </div>
      </Section>

      <Card tone="inset" className="not-counted">
        <h3 className="money-h3">Not counted on purpose</h3>
        <ul className="plain-list">
          <li>Speculative future work, because nothing in the plan depends on it.</li>
          <li>Assets that have not been sold.</li>
          <li>Insurance or other claims that are still pending.</li>
        </ul>
        {b.warnings.length > 0 && (
          <ul className="plain-list small muted">
            {b.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <CostLineDialog open onClose={() => setEditing(null)} record={editing} />}
      <FxDialog open={fxOpen} onClose={() => setFxOpen(false)} record={fxRecord} />
    </div>
  );
}


/** One cost line on its own (record detail): what it is, where each amount stands and what is missing. */
export function CostDetail({ record }: { record: BaseRecord }) {
  const d = dataOf<CostData>(record);
  const [edit, setEdit] = useState(false);
  const rows: [string, string | null][] = [
    ['Kind of cost', d.section ? SECTION_TITLE[d.section] : null],
    ['Category', d.category ?? null],
    ['Stage', d.commitment_state ? (STAGE_LABEL[d.commitment_state] ?? d.commitment_state.replace(/_/g, ' ')) : null],
    ['Estimate', d.estimate ? fmtMoney(d.estimate) : 'Not known yet'],
    ['Quote', d.quote ? fmtMoney(d.quote) : 'None yet'],
    ['Approved amount', d.committed ? fmtMoney(d.committed) : 'None yet'],
    ['Paid so far', d.paid ? fmtMoney(d.paid) : 'Nothing recorded'],
    ['Still to pay', d.unpaid_balance ? fmtMoney(d.unpaid_balance) : null],
    ['Who pays', d.payer ?? null],
    ['Where the amount came from', d.quote_source ?? null],
    ['Date of the quote', d.quote_date ? civil(d.quote_date) : null],
    ['Deposit due', d.deposit_due ? civil(d.deposit_due) : null],
    ['Refundable', d.refundable && d.refundable !== 'unknown' ? d.refundable : 'Not known yet'],
    ['How sure we are', d.uncertainty ?? null],
    ['Counts toward the plan', d.applicability === 'exclude' ? `No — ${d.exclusion_reason ?? 'left out'}` : d.applicability === 'review' ? 'Not decided yet' : d.applicability ? 'Yes' : null],
    ['Timing notes', d.phase?.note ?? null],
  ];
  return (
    <Card className="stack">
      <p className="muted preline">{d.description}</p>
      <dl className="facts facts--tight">
        {rows
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <div key={label} className="fact">
              <dt>{label}</dt>
              <dd className="preline">{v}</dd>
            </div>
          ))}
      </dl>
      <div className="row-actions">
        <Button variant="secondary" small icon="pencil" onClick={() => setEdit(true)}>
          Edit this amount
        </Button>
      </div>
      {edit && <CostLineDialog open onClose={() => setEdit(false)} record={record} />}
    </Card>
  );
}
