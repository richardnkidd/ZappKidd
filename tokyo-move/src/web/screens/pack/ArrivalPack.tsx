import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PersonBadge } from '../../components/People';
import { Button } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, PageTitle } from '../../components/Layout';
import { civil } from '../../lib/format';
import { dataOf } from '../../lib/records';
import type { DocumentData } from '@shared/types';
import { buildPack, SENSITIVITY_ORDER, type Pack, type PackItem, type Sensitivity } from '../../lib/pack';
import { useData } from '../../state/data';
import type { Directory, Indexes } from '../../lib/records';

const SENSITIVE_LABEL: Record<Sensitivity, { title: string; hint: string }> = {
  medical: { title: 'Health and medicine', hint: 'Marked as medical in the plan.' },
  financial: { title: 'Money and accounts', hint: 'Marked as financial in the plan.' },
  identity: { title: 'Identity documents', hint: 'Marked as identity papers in the plan.' },
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
            {it.check && (
              <span className="pack__detail pack__check">
                <strong>Check:</strong> {it.check}
              </span>
            )}
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
    ...pack.sections.map((s) => ({ key: s.key, title: s.title, items: s.items, empty: s.empty, checkbox: s.key === 'arrival_day' || s.key === 'first_week' || s.key === 'first_30' })),
    ...extra.map((k) => ({ key: k, title: SENSITIVE_LABEL[k].title, items: pack.sensitive[k], empty: 'Nothing listed here.', checkbox: true })),
  ];
  return (
    <article className="pack" aria-label={`Arrival pack for ${name}`}>
      <header className="pack__head">
        <h2 className="pack__name">
          <PersonBadge person={person} size={28} /> Arrival pack — {name}
        </h2>
        <p className="pack__date">Printed {civil(today, 'long')}</p>
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
          <p className="muted">
            A short pack per traveler, about two pages. It prints on A4 or Letter in black on white, with links written out as text. Documents show status and who holds them, never numbers or identifiers.
          </p>
          <p className="small muted" data-testid="pack-documents-rule">
            {anyMarked ? (
              <>Only documents marked to carry are listed. </>
            ) : (
              <>No document is marked to carry yet, so each pack lists the documents that are that person’s. </>
            )}
            Mark more in{' '}
            <Link to="/documents" className="more-link">
              Documents
            </Link>
            .
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
            {present.length === 0 ? (
              <p className="faint small">Nothing the pack would list is marked sensitive.</p>
            ) : (
              <div className="stack stack--tight">
                {present.map((k) => (
                  <label key={k} className="choice">
                    <input type="checkbox" checked={include[k]} onChange={(e) => setInclude((c) => ({ ...c, [k]: e.target.checked }))} />
                    <span className="choice__text">
                      <span>Include {SENSITIVE_LABEL[k].title.toLowerCase()}</span>
                      <span className="choice__hint">{SENSITIVE_LABEL[k].hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
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
