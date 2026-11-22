import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PersonBadge } from '../../components/People';
import { Button } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { InfoNote } from '../../components/InfoNote';
import { More } from '../../components/More';
import { Card, EmptyState, PageTitle } from '../../components/Layout';
import { dateLineText } from '../../lib/dateLine';
import { dataOf } from '../../lib/records';
import type { DocumentData } from '@shared/types';
import { buildPack, SENSITIVITY_ORDER, type Pack, type PackItem, type Sensitivity } from '../../lib/pack';
import { useData } from '../../state/data';
import type { Directory, Indexes } from '../../lib/records';

const SENSITIVE_LABEL: Record<Sensitivity, string> = {
  medical: 'Health and medicine',
  financial: 'Money and accounts',
  identity: 'Identity documents',
};

function Items({ items, empty, checkbox = false }: { items: PackItem[]; empty: string; checkbox?: boolean }) {
  if (items.length === 0) return <p className="pack__empty">{empty}</p>;
  return (
    <ul className="pack__list">
      {items.map((it) => (
        <li key={it.id} className="pack__item">
          {checkbox && <span className="pack__box" aria-hidden="true" />}
          <span className="pack__text">
            <span className="pack__title">{it.title}</span>
            {it.date && <span className="pack__meta"> — {it.date}</span>}
            {it.meta && it.meta.length > 0 && <span className="pack__meta"> — {it.meta.join(' · ')}</span>}
            {it.bring && <span className="pack__detail pack__bring">Bring: {it.bring}</span>}
            {it.detail && <span className="pack__detail">{it.detail}</span>}
            {it.link && <span className="pack__link">{it.link}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PackFor({ pack, name, person, today, include }: { pack: Pack; name: string; person: ReturnType<Directory['personById']>; today: string; include: Record<Sensitivity, boolean> }) {
  const extra = SENSITIVITY_ORDER.filter((k) => include[k] && pack.sensitive[k].length > 0);
  const sections = [
    ...pack.sections.map((s) => ({ key: s.key, title: s.title, items: s.items, empty: s.empty, note: s.note ?? null, checkbox: s.key === 'arrival_day' || s.key === 'first_week' || s.key === 'first_30' })),
    ...extra.map((k) => ({ key: k, title: SENSITIVE_LABEL[k], items: pack.sensitive[k], empty: 'Nothing listed here.', note: null, checkbox: true })),
  ];
  return (
    <article className="pack" aria-label={`Arrival pack for ${name}`}>
      <header className="pack__head">
        <h2 className="pack__name">
          <PersonBadge person={person} size={28} /> Arrival pack — {name}
        </h2>
        <p className="pack__date">
          Printed {dateLineText(today)}
        </p>
      </header>
      {sections.map((s, i) => (
        <section key={s.key} className="pack__section" aria-labelledby={`pk-${pack.personId}-${s.key}`}>
          {i > 0 && (
            <p className="pack__cont" aria-hidden="true">
              {name} — arrival pack (cont.)
            </p>
          )}
          <h3 id={`pk-${pack.personId}-${s.key}`} className="pack__h">
            {s.title}
          </h3>
          {s.note && s.items.length > 0 && <p className="pack__note">{s.note}</p>}
          <Items items={s.items} empty={s.empty} checkbox={s.checkbox} />
        </section>
      ))}
    </article>
  );
}

function PackBody({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { deadlines, today } = useData();
  const travelers = dir.people;
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => Object.fromEntries(travelers.map((p) => [p.id, true])));
  const [include, setInclude] = useState<Record<Sensitivity, boolean>>({ medical: false, financial: false, identity: false });

  const packs = useMemo(
    () => travelers.filter((p) => chosen[p.id]).map((p) => ({ person: p, pack: buildPack(idx, dir, deadlines.ok ? deadlines.value : [], p.id) })),
    [travelers, chosen, idx, dir, deadlines],
  );
  const present = SENSITIVITY_ORDER.filter((k) => packs.some((x) => x.pack.sensitive[k].length > 0));
  // The pack lists what each person carries, not every document: once any document is marked to carry, only those appear.
  const anyMarked = idx.all.some((r) => r.type === 'document' && (dataOf<DocumentData>(r).carry_on_arrival ?? []).length > 0);

  if (travelers.length === 0) return <EmptyState icon="plane" title="No travelers are set up yet." />;

  return (
    <div className="stack stack--loose">
      <div className="no-print stack">
        <Card className="stack">
          <fieldset>
            <legend>Who to print for</legend>
            <div className="chip-radios">
              {travelers.map((p) => (
                <label key={p.id} className="choice choice--inline">
                  <input type="checkbox" checked={Boolean(chosen[p.id])} onChange={(e) => setChosen((c) => ({ ...c, [p.id]: e.target.checked }))} />
                  <span className="choice__text">{p.display_name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {present.length > 0 && (
            <fieldset>
              <legend>Sensitive sections (left out unless you tick them)</legend>
              <div className="stack stack--tight">
                {present.map((k) => (
                  <label key={k} className="choice">
                    <input type="checkbox" checked={include[k]} onChange={(e) => setInclude((c) => ({ ...c, [k]: e.target.checked }))} />
                    <span className="choice__text">Include {SENSITIVE_LABEL[k].toLowerCase()}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <p className="quiet-line" data-testid="pack-documents-rule">
            {anyMarked ? 'Only documents marked to carry are listed. ' : 'Each pack lists that person’s documents. '}
            <Link to="/documents" className="more-link">
              Change in Documents
            </Link>
          </p>
          <div className="row-actions pack-print">
            <Button variant="primary" icon="file" disabled={packs.length === 0} onClick={() => window.print()}>
              Print
            </Button>
            <InfoNote label="About the printout">
              About two pages for each traveler, in black on white, with links written out. Documents show status and who holds them, never numbers. Nothing here is a booking, a filing or advice.
            </InfoNote>
          </div>
        </Card>
      </div>
      {packs.length === 0 ? (
        <EmptyState icon="plane" title="Choose at least one traveler." />
      ) : (
        <div className="packs">
          {packs.map(({ person, pack }) => (
            <More key={person.id} label={`Preview ${person.display_name}’s pack`} className="pack-more">
              <PackFor pack={pack} name={person.display_name} person={person} today={today} include={include} />
            </More>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArrivalPack() {
  return (
    <div className="page arrival-pack">
      <div className="no-print">
        <PageTitle>Printable arrival pack</PageTitle>
      </div>
      <DataGate>{({ idx, dir }) => <PackBody idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}
