import { useMemo, useState, type ReactNode } from 'react';
import { isCivilDate } from '@shared/dates';
import { DateText, DeadlineBadge } from '../../components/Badges';
import { Button, Field, Select, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { civil, humanizeKey, plural } from '../../lib/format';
import { fmtUsd } from '../../lib/money';
import { attempt } from '../../lib/safe';
import { type Directory, type Indexes } from '../../lib/records';
import {
  ARRIVAL_CHOICES,
  compareOverlap,
  defaultDeparture,
  firstAdultArrival,
  monthsBetween,
  petArrivalFor,
  previewPetMove,
  type ArrivalChoice,
} from '../../lib/whatif';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

/* ------------------------------------------------------------------ conditions (settings.staging_analysis) */

const TITLE_KEYS = ['title', 'label', 'condition', 'name', 'rule', 'text', 'description', 'note'];

function itemText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const first = TITLE_KEYS.map((k) => o[k]).find((x) => typeof x === 'string' && x.trim());
    const rest = TITLE_KEYS.map((k) => o[k]).filter((x) => typeof x === 'string' && x.trim() && x !== first);
    return [first, ...rest].filter(Boolean).join(' — ');
  }
  return v === null || v === undefined ? '' : String(v);
}

/** Renders whatever shape the household's staging analysis has: text, lists, or labelled groups. Never as HTML. */
function Conditions({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number') return <p className="preline">{String(value)}</p>;
  if (Array.isArray(value)) {
    return (
      <ul className="plain-list">
        {value.map((v, i) => (
          <li key={i} className="preline">
            {itemText(v)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object' && depth < 3) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([k, v]) => k !== 'pet_specific' && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    return (
      <div className="stack stack--tight">
        {entries.map(([k, v]) => (
          <div key={k}>
            <h4 className="subhead">{humanizeKey(k)}</h4>
            <Conditions value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ page */

function WhatIfTitle() {
  const { dir } = useSnapshot();
  return <>What if {dir?.pet?.display_name ?? 'your pet'} arrives later?</>;
}

export function WhatIf() {
  return (
    <div className="page whatif">
      <PageTitle kicker="A comparison — nothing changes">
        <WhatIfTitle />
      </PageTitle>
      <DataGate>{({ idx, dir }) => <WhatIfBody idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}

function WhatIfBody({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { snapshot, actions } = useSnapshot();
  const { today, deadlineContext, deadlines } = useData();
  const pets = dir.people.filter((p) => p.kind === 'pet');
  const [petId, setPetId] = useState(pets[0]?.id ?? '');
  const pet = dir.personById(petId) ?? pets[0] ?? null;
  const [choice, setChoice] = useState<ArrivalChoice>('plus3');
  const [pickedDate, setPickedDate] = useState('');
  const [hypo, setHypo] = useState('');
  const [depOverride, setDepOverride] = useState('');
  const w = useWrite();
  const [saved, setSaved] = useState(false);

  const known = useMemo(() => firstAdultArrival(deadlineContext.records, deadlineContext.people), [deadlineContext]);
  const firstAdult = known?.date ?? (isCivilDate(hypo) ? hypo : null);
  const firstAdultName = known ? dir.nameOf(known.personId) : 'the first adult';
  const needsHypo = !known && choice !== 'date';

  const arrival = petArrivalFor(choice, firstAdult, pickedDate);
  const departure = arrival ? (isCivilDate(depOverride) ? depOverride : defaultDeparture(arrival)) : null;

  const anchors = useMemo(() => idx.anchors, [idx]);
  const arrivalCode = pet?.anchors.arrival ?? 'TP';
  const departureCode = pet?.anchors.departure ?? 'DP';
  const currentArrival = (anchors.find((a) => ((a.data as { code?: string }).code ?? a.key) === arrivalCode)?.data as { date?: string | null } | undefined)?.date ?? null;
  const currentDeparture = (anchors.find((a) => ((a.data as { code?: string }).code ?? a.key) === departureCode)?.data as { date?: string | null } | undefined)?.date ?? null;

  const preview = useMemo(() => (arrival && departure && pet ? attempt(() => previewPetMove(deadlineContext, arrivalCode, departureCode, arrival, departure)) : null), [arrival, departure, pet, deadlineContext, arrivalCode, departureCode]);
  const overlap = useMemo(
    () => (arrival && departure && pet ? attempt(() => compareOverlap({ records: deadlineContext.records, people: deadlineContext.people, today, arrivalCode, departureCode, arrival, departure })) : null),
    [arrival, departure, pet, deadlineContext, today, arrivalCode, departureCode],
  );

  const staging = (snapshot?.settings as unknown as { staging_analysis?: Record<string, unknown> } | undefined)?.staging_analysis;
  const petSpecific = staging && typeof staging === 'object' ? (staging as { pet_specific?: unknown }).pet_specific : undefined;

  if (!pet) {
    return (
      <Card>
        <EmptyState icon="user" title="No pet is set up in this household." />
      </Card>
    );
  }

  const unaffectedAdults = (preview?.ok ? preview.value.unaffected : []).filter((p) => dir.personById(p)?.kind === 'adult');
  const unchangedCount = deadlines.ok ? deadlines.value.filter((d) => unaffectedAdults.includes(d.traveler ?? '') && d.applies !== 'no').length : 0;
  const movedMonths = arrival && currentArrival ? monthsBetween(currentArrival, arrival) : null;

  const noteText = () => {
    const lines: string[] = [`What if ${pet.display_name} arrives later? (a comparison only — nothing was changed)`];
    if (arrival) lines.push(`Arrival: ${currentArrival ? civil(currentArrival) : 'not set'} → ${civil(arrival)}${departure ? `; departure ${currentDeparture ? civil(currentDeparture) : 'not set'} → ${civil(departure)}` : ''}.`);
    if (preview?.ok) {
      lines.push(preview.value.changes.length ? `${plural(preview.value.changes.length, 'date')} would move: ${preview.value.changes.map((c) => `${c.label} (${c.before ? civil(c.before) : 'awaiting'} → ${c.after ? civil(c.after) : 'awaiting'})`).join('; ')}.` : 'No other dates would move.');
      if (unaffectedAdults.length) lines.push(`Unchanged: ${unaffectedAdults.map((p) => dir.nameOf(p)).join(' and ')}’s deadlines (${unchangedCount}).`);
    }
    if (overlap?.ok) lines.push(`Staged overlap known so far: ${fmtUsd(overlap.value.beforeKnown)} → ${fmtUsd(overlap.value.afterKnown)}${overlap.value.unknownAfter ? `; ${overlap.value.unknownAfter} amounts not known yet` : ''}.`);
    return lines.join('\n');
  };

  const saveNote = async () => {
    const ok = await w.run(
      () => actions.createRecord({ type: 'note', title: `What if ${pet.display_name} arrives later?`, data: { body: noteText(), linked_record_id: null }, visibility: 'household' }),
      0,
    );
    if (ok) setSaved(true);
  };

  return (
    <div className="stack stack--loose">
      <Card tone="inset" className="whatif-promise">
        <p>
          <Icon name="info" size={16} /> <strong>Nothing here changes your plan.</strong> You are only looking at what would move. Each traveler’s dates stay separate: {pet.display_name}’s move never moves an adult’s.
        </p>
      </Card>

      <Section title={`When might ${pet.display_name} arrive?`} headingLevel={2}>
        <div className="stack">
          {pets.length > 1 && (
            <Field label="Which pet">
              <Select value={pet.id} onChange={(e) => setPetId(e.target.value)}>
                {pets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <fieldset>
            <legend>Compared with {firstAdultName}’s arrival</legend>
            <div className="chip-radios">
              {ARRIVAL_CHOICES.map((c) => (
                <label key={c.value} className="choice choice--inline">
                  <input type="radio" name="when" checked={choice === c.value} onChange={() => setChoice(c.value)} />
                  <span className="choice__text">{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {choice === 'date' && (
            <Field label={`${pet.display_name}’s arrival date`}>
              <TextInput type="date" value={pickedDate} onChange={(e) => setPickedDate(e.target.value)} />
            </Field>
          )}
          {needsHypo && (
            <Field label="If the first adult arrived on…" hint="Their arrival date isn’t set yet. This is only for the comparison and is never saved.">
              <TextInput type="date" value={hypo} onChange={(e) => setHypo(e.target.value)} />
            </Field>
          )}
          <dl className="facts facts--tight">
            <div className="fact">
              <dt>{pet.display_name} now</dt>
              <dd>
                arrives <DateText date={currentArrival} />
              </dd>
            </div>
            <div className="fact">
              <dt>If so</dt>
              <dd>{arrival ? `arrives ${civil(arrival, 'weekday')}` : 'Choose how, above'}</dd>
            </div>
          </dl>
          {arrival && (
            <Field
              label={`${pet.display_name}’s departure`}
              hint="Honolulu–Tokyo flights usually land the next day, so this starts one day before arrival. Adjust it if yours differs."
            >
              <TextInput type="date" value={depOverride || departure || ''} onChange={(e) => setDepOverride(e.target.value)} />
            </Field>
          )}
        </div>
      </Section>

      {!arrival ? (
        <Card>
          <EmptyState icon="calendar" title="Pick when, and the comparison appears here.">
            {needsHypo ? 'First add a date for the first adult’s arrival, just for this comparison.' : ''}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Section title={`What would move for ${pet.display_name}`} headingLevel={2}>
            {!preview ? null : !preview.ok ? (
              <ErrorBanner title="We couldn't work out the dates just now.">{preview.error.message}</ErrorBanner>
            ) : (
              <div className="stack">
                {preview.value.warnings.map((m) => (
                  <p key={m} className="small">
                    <Icon name="alert" size={14} /> {m}
                  </p>
                ))}
                {preview.value.changes.length === 0 ? (
                  <p className="muted">No dated rule would change.</p>
                ) : (
                  <ul className="item-list">
                    {preview.value.changes.map((c) => (
                      <li key={c.deadline_id} className="item item--flat">
                        <div className="item__main">
                          <span className="item__title">{c.label}</span>
                          <div className="item__meta">
                            <DeadlineBadge kind={c.kind} />
                            <span>
                              <DateText date={c.before} /> → <DateText date={c.after} kind={c.kind} />
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="unchanged">
                  <Icon name="check" size={16} /> <strong>Unchanged:</strong> {unaffectedAdults.length ? unaffectedAdults.map((p) => dir.nameOf(p)).join(' and ') + '’s deadlines' : 'no other traveler’s deadlines'} ({unchangedCount}).
                </p>
              </div>
            )}
          </Section>

          <Section title="What it could add in cost" headingLevel={2} intro="Extra time in Hawaii means extra staged-overlap costs. Amounts that aren’t known yet stay unknown; they are never treated as zero.">
            {!overlap ? null : !overlap.ok ? (
              <ErrorBanner title="We couldn't work out the costs just now.">{overlap.error.message}</ErrorBanner>
            ) : (
              <Card className="stack">
                {movedMonths !== null && <p>{movedMonths === 0 ? 'About the same time as now.' : `About ${plural(Math.abs(movedMonths), 'month')} ${movedMonths > 0 ? 'later' : 'earlier'} than the current plan.`}</p>}
                {overlap.value.lines.length === 0 ? (
                  <p className="muted">No staged-overlap costs are listed yet.</p>
                ) : (
                  <ul className="overlap-lines">
                    {overlap.value.lines.map((l) => (
                      <li key={l.key}>
                        <span>{l.description}</span>
                        <span className="muted small">
                          {l.before === null ? 'not known yet' : fmtUsd(l.before)} → {l.after === null ? 'not known yet' : fmtUsd(l.after)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p>
                  Known so far: <strong>{fmtUsd(overlap.value.beforeKnown)}</strong> → <strong>{fmtUsd(overlap.value.afterKnown)}</strong>
                  {overlap.value.unknownAfter > 0 ? <span className="muted"> · {overlap.value.unknownAfter} not known yet</span> : null}
                </p>
              </Card>
            )}
          </Section>

          <Section title="Conditions to check" headingLevel={2} intro="From the household’s own staging notes. They are things to confirm, not answers.">
            {!staging || (typeof staging === 'object' && Object.keys(staging).length === 0) ? (
              <p className="muted">No staging notes have been added yet.</p>
            ) : (
              <div className="stack">
                <Card>
                  <Conditions value={staging} />
                </Card>
                {petSpecific !== undefined && petSpecific !== null && (
                  <Card>
                    <h3 className="money-h3">Specific to {pet.display_name}</h3>
                    <Conditions value={petSpecific} />
                  </Card>
                )}
              </div>
            )}
          </Section>

          <Card tone="inset" className="stack">
            <p className="muted">Want to keep this? It is saved as a household note. It does not change any date.</p>
            <div className="row-actions" style={{ marginTop: 0 }}>
              <Button variant="secondary" icon="plus" busy={w.busy} onClick={saveNote} disabled={saved}>
                {saved ? 'Saved as a note' : 'Save this comparison as a note'}
              </Button>
            </div>
            {w.error && <p className="field__error" role="alert">{w.error}</p>}
            {saved && <p role="status" className="small">Saved. You can find it with the household’s notes.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
