import type { FutureOptionData } from '@shared/types';
import { Chip } from '../../components/Badges';
import { DataGate } from '../../components/DataGate';
import { Disclosure } from '../../components/Disclosure';
import { ConflictBanner } from '../../components/Feedback';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { dataOf, type AnyRecord, type Indexes } from '../../lib/records';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

type Interest = NonNullable<FutureOptionData['interest']>;

const INTEREST: { value: Interest | ''; label: string; hint: string }[] = [
  { value: '', label: 'No view yet', hint: 'Nothing chosen.' },
  { value: 'not_now', label: 'Not now', hint: 'Set aside for the moment.' },
  { value: 'curious', label: 'Curious', hint: 'Interesting, no commitment.' },
  { value: 'exploring', label: 'Exploring', hint: 'Looking into it gently.' },
  { value: 'paused', label: 'Paused', hint: 'Looked at, resting for now.' },
];

export type FutureKind = 'option' | 'phase' | 'note';

export function futureKind(r: AnyRecord): FutureKind {
  const k = (r.data as { kind?: string } | undefined)?.kind;
  if (k === 'option' || k === 'phase' || k === 'note') return k;
  if (/^FN/i.test(r.key)) return 'note';
  if (/^FW-[A-Z]$/i.test(r.key)) return 'option';
  return /^FW\d/i.test(r.key) ? 'phase' : 'option';
}

function InterestPicker({ record }: { record: AnyRecord }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const current = (dataOf<FutureOptionData>(record).interest ?? '') as Interest | '';
  const choose = (value: Interest | '') => {
    if (value === current) return;
    void w.run((v) => actions.patchRecord(record.id, v, { data: { interest: value === '' ? null : value } }), record.version);
  };
  return (
    <fieldset className="interest" disabled={w.busy}>
      <legend>How does this feel right now?</legend>
      <div className="interest__row">
        {INTEREST.map((o) => (
          <label key={o.value || 'none'} className="choice choice--inline">
            <input type="radio" name={`interest-${record.key}`} checked={current === o.value} onChange={() => choose(o.value)} />
            <span className="choice__text">{o.label}</span>
          </label>
        ))}
      </div>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
    </fieldset>
  );
}

export function FutureOptionCard({ record, headingLevel = 3 }: { record: AnyRecord; headingLevel?: 2 | 3 }) {
  const d = dataOf<FutureOptionData>(record);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const rows: [string, string | undefined][] = [
    ['Why it might fit', d.why_fit],
    ['What it could look like', d.offer_hypothesis],
    ['A first small test', d.first_test],
    ['What would show it works', d.success_evidence],
    ['Limits', d.limits],
    ['Not known yet', d.unknowns],
  ];
  return (
    <Card as="article" className="future-card" aria-labelledby={`fo-${record.key}`}>
      <div className="item__meta">
        <Chip small tone="neutral">
          Optional
        </Chip>
      </div>
      <H id={`fo-${record.key}`} className="doc__title">
        {d.path || record.title}
      </H>
      <InterestPicker record={record} />
      <Disclosure title="More about this option" level={4} className="disclosure--flat">
        <dl className="facts facts--tight">
          {rows
            .filter(([, v]) => v && v.trim())
            .map(([label, v]) => (
              <div key={label} className="fact fact--wide">
                <dt>{label}</dt>
                <dd className="preline">{v}</dd>
              </div>
            ))}
        </dl>
      </Disclosure>
    </Card>
  );
}

function SimpleItem({ r }: { r: AnyRecord }) {
  const d = dataOf<FutureOptionData & { body?: string }>(r);
  const text = d.body || [d.why_fit, d.first_test].filter(Boolean).join(' ');
  return (
    <li className="future-item">
      <p className="future-item__title">{d.path || r.title}</p>
      {text && <p className="muted preline">{text}</p>}
    </li>
  );
}

export function Future() {
  return (
    <div className="page future">
      <PageTitle kicker="Away from the critical path">Future work</PageTitle>
      <DataGate>{({ idx }) => <FutureBody idx={idx} />}</DataGate>
    </div>
  );
}

function FutureBody({ idx }: { idx: Indexes }) {
  const all = idx.all.filter((r) => r.type === 'future_option');
  const options = all.filter((r) => futureKind(r) === 'option').sort((a, b) => (dataOf<FutureOptionData>(a).rank ?? 99) - (dataOf<FutureOptionData>(b).rank ?? 99) || a.key.localeCompare(b.key));
  const phases = all.filter((r) => futureKind(r) === 'phase').sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const notes = all.filter((r) => futureKind(r) === 'note').sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return (
    <div className="stack stack--loose">
      <Card tone="inset" className="future-intro">
        <p className="future-intro__line">Optional. Not part of the move. Continuing the break is a valid choice.</p>
        <p className="muted">Nothing here has a date, a target or a deadline, and nothing on this page holds up anyone’s move.</p>
      </Card>
      {all.length === 0 ? (
        <Card>
          <EmptyState icon="sprout" title="Nothing has been added here yet." />
        </Card>
      ) : (
        <>
          <Section title="Ideas" headingLevel={2} intro="Three directions, in no particular order of urgency.">
            <ul className="stack">
              {options.map((o) => (
                <li key={o.id}>
                  <FutureOptionCard record={o} />
                </li>
              ))}
            </ul>
          </Section>
          {phases.length > 0 && (
            <Section title="If you ever wanted to try one" headingLevel={2} intro="A gentle shape, only if it appeals.">
              <ol className="future-list">
                {phases.map((p) => (
                  <SimpleItem key={p.id} r={p} />
                ))}
              </ol>
            </Section>
          )}
          {notes.length > 0 && (
            <Section title="Notes" headingLevel={2}>
              <ul className="future-list">
                {notes.map((n) => (
                  <SimpleItem key={n.id} r={n} />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
