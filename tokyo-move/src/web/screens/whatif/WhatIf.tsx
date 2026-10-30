import { useMemo, useState, type ReactNode } from 'react';
import { isCivilDate } from '@shared/dates';
import { VERIFICATION_LABEL } from '@shared/labels';
import { DateText, DeadlineBadge } from '../../components/Badges';
import { Button, Field, Select, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Disclosure } from '../../components/Disclosure';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { LinkedText } from '../../components/LinkedText';
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

/** `b_avery_first_then_jun` -> "Avery first then Jun": a leading letter prefix goes, names get their capitals back. */
function labelFromKey(key: string, dir: Directory): string {
  const names = new Map(dir.people.map((p) => [p.display_name.toLowerCase(), p.display_name]));
  const words = key.replace(/^[a-z]_/, '').split('_').filter(Boolean);
  const out = words.map((w, i) => names.get(w) ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w));
  return out.join(' ') || humanizeKey(key);
}

/** The household's plain labels for the staging notes' own groups. Anything else is derived from its key. */
const GROUP_TITLE: Record<string, string> = {
  pathway_checklist_verified: 'Checked against official pages',
  only_vet_or_authority_can_determine: 'Only a vet or the authority can decide',
  summer_heat_breed_crate: 'Summer heat, breed and crate rules',
  hawaii_return_implications: 'If the pet goes back through Hawaii',
  cross_cutting: 'True in every case',
  deadlines: 'Deadlines',
  physical_presence: 'Who has to be where',
  overlap_costs_drivers: 'What drives the overlap cost',
  blockers: 'What could hold everything up',
  summary: 'In short',
};

function StepItem({ o }: { o: Record<string, unknown> }) {
  const status = typeof o.status === 'string' ? o.status : null;
  const label = status ? (VERIFICATION_LABEL[status as keyof typeof VERIFICATION_LABEL] ?? humanizeKey(status)) : null;
  return (
    <li className="stack stack--tight">
      <span>
        <strong>{String(o.step ?? itemText(o))}</strong>
        {label && <span className="chip chip--neutral chip--sm" style={{ marginLeft: 8 }}>{label}</span>}
      </span>
      {typeof o.note === 'string' && o.note && (
        <span className="small muted">
          <LinkedText text={o.note} />
        </span>
      )}
      {typeof o.source === 'string' && o.source && (
        <span className="small">
          <LinkedText text={o.source} />
        </span>
      )}
    </li>
  );
}

/** Lists of text, of {step, status, note, source} checks, or of {if, then} branches. Text only; addresses become links. */
function Listing({ items }: { items: unknown[] }) {
  return (
    <ul className="plain-list">
      {items.map((v, i) => {
        const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
        if (o && typeof o.step === 'string') return <StepItem key={i} o={o} />;
        if (o && typeof o.if === 'string') {
          return (
            <li key={i} className="stack stack--tight">
              <span>
                <strong>If</strong> <LinkedText text={o.if} />
              </span>
              {typeof o.then === 'string' && (
                <span className="muted">
                  <LinkedText text={o.then} />
                </span>
              )}
            </li>
          );
        }
        return (
          <li key={i} className="preline">
            <LinkedText text={itemText(v)} />
          </li>
        );
      })}
    </ul>
  );
}

/** Renders whatever shape a staging note has: text, lists, or labelled groups. Never as HTML. */
function Conditions({ value, dir, depth = 0 }: { value: unknown; dir: Directory; depth?: number }): ReactNode {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return (
      <p className="preline">
        <LinkedText text={String(value)} />
      </p>
    );
  }
  if (Array.isArray(value)) return value.length ? <Listing items={value} /> : null;
  if (typeof value === 'object' && depth < 3) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    return (
      <div className="stack stack--tight">
        {entries.map(([k, v]) => (
          <div key={k}>
            <h4 className="subhead">{GROUP_TITLE[k] ?? labelFromKey(k, dir)}</h4>
            <Conditions value={v} dir={dir} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return null;
}

/** The pet's own conditions, open; the wider staging notes for the adults, folded away. */
function StagingNotes({ staging, petName, dir }: { staging: Record<string, unknown>; petName: string; dir: Directory }) {
  const { pet_specific: petSpecific, ...rest } = staging as { pet_specific?: unknown } & Record<string, unknown>;
  const petGroups = petSpecific && typeof petSpecific === 'object' && !Array.isArray(petSpecific) ? Object.entries(petSpecific as Record<string, unknown>).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) : [];
  const restEntries = Object.entries(rest).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  return (
    <div className="stack">
      {petGroups.length > 0 && (
        <Card className="stack">
          <h3 className="money-h3">Specific to {petName}</h3>
          {petGroups.map(([k, v]) => (
            <Disclosure key={k} title={GROUP_TITLE[k] ?? labelFromKey(k, dir)} meta={Array.isArray(v) ? `${v.length}` : undefined} level={4} defaultOpen className="disclosure--flat">
              <Conditions value={v} dir={dir} depth={1} />
            </Disclosure>
          ))}
        </Card>
      )}
      {restEntries.length > 0 && (
        <Disclosure title="More about staging the adults’ moves" level={3}>
          <div className="stack">
            {restEntries.map(([k, v]) => (
              <div key={k}>
                <h4 className="subhead">{GROUP_TITLE[k] ?? labelFromKey(k, dir)}</h4>
                <Conditions value={v} dir={dir} depth={1} />
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

function ChangeList({ changes }: { changes: { deadline_id: string; label: string; kind: Parameters<typeof DeadlineBadge>[0]['kind']; before: string | null; after: string | null }[] }) {
  return (
    <ul className="item-list">
      {changes.map((c) => (
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
  );
}

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
  const anchors = useMemo(() => idx.anchors, [idx]);
  const arrivalCode = pet?.anchors.arrival ?? 'TP';
  const departureCode = pet?.anchors.departure ?? 'DP';
  const currentArrival = (anchors.find((a) => ((a.data as { code?: string }).code ?? a.key) === arrivalCode)?.data as { date?: string | null } | undefined)?.date ?? null;
  const currentDeparture = (anchors.find((a) => ((a.data as { code?: string }).code ?? a.key) === departureCode)?.data as { date?: string | null } | undefined)?.date ?? null;

  // "+N months" counts from the pet's own arrival date when it has one; otherwise from the first adult's (optional, for the
  // comparison only). A date the person types is never saved.
  const petNow = currentArrival && isCivilDate(currentArrival) ? currentArrival : null;
  const firstAdult = known?.date ?? (isCivilDate(hypo) ? hypo : null);
  const firstAdultName = known ? dir.nameOf(known.personId) : 'the first adult';
  const base = petNow ?? firstAdult;
  const needsHypo = !petNow && !known && choice !== 'date';
  const choices = ARRIVAL_CHOICES.filter((c) => c.value !== 'with_first' || known);

  const arrival = petArrivalFor(choice, firstAdult, pickedDate, base);
  const departure = arrival ? (isCivilDate(depOverride) ? depOverride : defaultDeparture(arrival)) : null;

  const preview = useMemo(() => (arrival && departure && pet ? attempt(() => previewPetMove(deadlineContext, arrivalCode, departureCode, arrival, departure)) : null), [arrival, departure, pet, deadlineContext, arrivalCode, departureCode]);
  const overlap = useMemo(
    () => (arrival && departure && pet ? attempt(() => compareOverlap({ records: deadlineContext.records, people: deadlineContext.people, today, arrivalCode, departureCode, arrival, departure })) : null),
    [arrival, departure, pet, deadlineContext, today, arrivalCode, departureCode],
  );

  const staging = (snapshot?.settings as unknown as { staging_analysis?: Record<string, unknown> } | undefined)?.staging_analysis;

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
  const noneKnown = overlap?.ok ? overlap.value.lines.length > 0 && (overlap.value.beforeKnown === null || overlap.value.beforeKnown === 0) && (overlap.value.afterKnown === null || overlap.value.afterKnown === 0) && overlap.value.unknownBefore > 0 : false;
  const allChanges = preview?.ok ? preview.value.changes : [];
  const isFirm = (k: string) => k === 'legal' || k === 'contractual' || k === 'user_committed';
  const legalChanges = allChanges.filter((c) => isFirm(c.kind));
  const targetChanges = allChanges.filter((c) => !isFirm(c.kind));

  const noteText = () => {
    const lines: string[] = [`What if ${pet.display_name} arrives later? (a comparison only — nothing was changed)`];
    if (arrival) lines.push(`Arrival: ${currentArrival ? civil(currentArrival) : 'not set'} → ${civil(arrival)}${departure ? `; departure ${currentDeparture ? civil(currentDeparture) : 'not set'} → ${civil(departure)}` : ''}.`);
    if (preview?.ok) {
      lines.push(preview.value.changes.length ? `${plural(preview.value.changes.length, 'date')} would move: ${preview.value.changes.map((c) => `${c.label} (${c.before ? civil(c.before) : 'awaiting'} → ${c.after ? civil(c.after) : 'awaiting'})`).join('; ')}.` : 'No other dates would move.');
      if (unaffectedAdults.length) lines.push(`Unchanged: ${unaffectedAdults.map((p) => dir.nameOf(p)).join(' and ')}’s deadlines (${unchangedCount}).`);
    }
    if (overlap?.ok) lines.push(noneKnown ? 'Staged overlap: no amounts known yet.' : `Staged overlap known so far: ${fmtUsd(overlap.value.beforeKnown)} → ${fmtUsd(overlap.value.afterKnown)}${overlap.value.unknownAfter ? `; ${overlap.value.unknownAfter} amounts not known yet` : ''}.`);
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
            <legend>{petNow ? `Compared with ${pet.display_name}’s arrival now (${civil(petNow)})` : `Compared with ${firstAdultName}’s arrival`}</legend>
            <div className="chip-radios">
              {choices.map((c) => (
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
            <Field label="If the first adult arrived on… (optional)" hint={`Neither ${pet.display_name}’s nor the adults’ arrival dates are set yet. A date here is only for the comparison and is never saved.`}>
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
                  <>
                    {legalChanges.length > 0 ? (
                      <div>
                        <h3 className="coming-group__title">Legal and contract dates</h3>
                        <ChangeList changes={legalChanges} />
                      </div>
                    ) : (
                      <p className="muted">No legal or contract date would change.</p>
                    )}
                    {targetChanges.length > 0 && (
                      <Disclosure title="Our own targets and estimates" meta={`${targetChanges.length}`} level={3}>
                        <ChangeList changes={targetChanges} />
                      </Disclosure>
                    )}
                  </>
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
                {noneKnown ? (
                  <p>
                    <strong>No amounts known yet.</strong>
                    <span className="muted"> {plural(overlap.value.lines.length, 'line')} listed, none with an amount. Adding amounts on the Money page makes this comparison real.</span>
                  </p>
                ) : (
                  <p>
                    Known so far: <strong>{fmtUsd(overlap.value.beforeKnown)}</strong> → <strong>{fmtUsd(overlap.value.afterKnown)}</strong>
                    {overlap.value.unknownAfter > 0 ? <span className="muted"> · {overlap.value.unknownAfter} not known yet</span> : null}
                  </p>
                )}
              </Card>
            )}
          </Section>

          <Section title="Conditions to check" headingLevel={2} intro="From the household’s own staging notes. They are things to confirm, not answers.">
            {!staging || typeof staging !== 'object' || Object.keys(staging).length === 0 ? (
              <p className="muted">No staging notes have been added yet.</p>
            ) : (
              <StagingNotes staging={staging} petName={pet.display_name} dir={dir} />
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
