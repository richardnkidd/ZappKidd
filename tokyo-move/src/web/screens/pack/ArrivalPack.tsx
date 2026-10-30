import { useMemo, useState } from 'react';
import { PersonBadge } from '../../components/People';
import { Button } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, PageTitle } from '../../components/Layout';
import { civil } from '../../lib/format';
import { buildPack, type Pack, type PackItem, type Sensitivity } from '../../lib/pack';
import { useData } from '../../state/data';
import type { Directory, Indexes } from '../../lib/records';

const SENSITIVE_LABEL: Record<Sensitivity, { title: string; hint: string }> = {
  health: { title: 'Health and medicine', hint: 'Anything about medicines, insurance or health care.' },
  money: { title: 'Money and accounts', hint: 'Anything about banking, taxes, pensions or payments.' },
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
            {it.meta && it.meta.length > 0 && <span className="pack__meta"> — {it.meta.join(' · ')}</span>}
            {it.detail && <span className="pack__detail">{it.detail}</span>}
            {it.link && <span className="pack__link">{it.link}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PackFor({ pack, name, person, today, include }: { pack: Pack; name: string; person: ReturnType<Directory['personById']>; today: string; include: Record<Sensitivity, boolean> }) {
  return (
    <article className="pack" aria-label={`Arrival pack for ${name}`}>
      <header className="pack__head">
        <h2 className="pack__name">
          <PersonBadge person={person} size={28} /> Arrival pack — {name}
        </h2>
        <p className="pack__date">Printed {civil(today, 'long')}</p>
      </header>
      {pack.sections.map((s) => (
        <section key={s.key} className="pack__section" aria-labelledby={`pk-${pack.personId}-${s.key}`}>
          <h3 id={`pk-${pack.personId}-${s.key}`} className="pack__h">
            {s.title}
          </h3>
          <Items items={s.items} empty={s.empty} checkbox={s.key === 'arrival_day' || s.key === 'first_week'} />
        </section>
      ))}
      {(Object.keys(include) as Sensitivity[])
        .filter((k) => include[k])
        .map((k) => (
          <section key={k} className="pack__section" aria-labelledby={`pk-${pack.personId}-${k}`}>
            <h3 id={`pk-${pack.personId}-${k}`} className="pack__h">
              {SENSITIVE_LABEL[k].title}
            </h3>
            <Items items={pack.sensitive[k]} empty="Nothing listed here." checkbox />
          </section>
        ))}
    </article>
  );
}

function PackBody({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { deadlines, today } = useData();
  const travelers = dir.people;
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => Object.fromEntries(travelers.map((p) => [p.id, true])));
  const [include, setInclude] = useState<Record<Sensitivity, boolean>>({ health: false, money: false });

  const packs = useMemo(
    () => travelers.filter((p) => chosen[p.id]).map((p) => ({ person: p, pack: buildPack(idx, dir, deadlines.ok ? deadlines.value : [], p.id) })),
    [travelers, chosen, idx, dir, deadlines],
  );
  const anySensitive = packs.some((x) => x.pack.sensitive.health.length + x.pack.sensitive.money.length > 0);

  if (travelers.length === 0) return <EmptyState icon="plane" title="No travelers are set up yet." />;

  return (
    <div className="stack stack--loose">
      <div className="no-print stack">
        <Card className="stack">
          <p className="muted">
            One page per traveler to take with you. It prints on A4 or Letter in black on white, with links written out as text. Documents show status and who holds them, never numbers or identifiers.
          </p>
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
          <fieldset>
            <legend>Sensitive sections (left out unless you tick them)</legend>
            <div className="stack stack--tight">
              {(Object.keys(SENSITIVE_LABEL) as Sensitivity[]).map((k) => (
                <label key={k} className="choice">
                  <input type="checkbox" checked={include[k]} onChange={(e) => setInclude((c) => ({ ...c, [k]: e.target.checked }))} />
                  <span className="choice__text">
                    <span>Include {SENSITIVE_LABEL[k].title.toLowerCase()}</span>
                    <span className="choice__hint">{SENSITIVE_LABEL[k].hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {!anySensitive && <p className="faint small">Nothing in the plan needs these sections right now.</p>}
          </fieldset>
          <div className="row-actions">
            <Button variant="primary" icon="file" disabled={packs.length === 0} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </Card>
        <p className="faint small">
          <Icon name="info" size={14} /> This is a preview of what will print. Nothing here is a booking, a filing or advice.
        </p>
      </div>
      {packs.length === 0 ? (
        <EmptyState icon="plane" title="Choose at least one traveler." />
      ) : (
        <div className="packs">
          {packs.map(({ person, pack }) => (
            <PackFor key={person.id} pack={pack} name={person.display_name} person={person} today={today} include={include} />
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
        <PageTitle kicker="To take with you">Printable arrival pack</PageTitle>
      </div>
      <DataGate>{({ idx, dir }) => <PackBody idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}
