import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { formatCivil } from '@shared/dates';
import { ZONE_OPTIONS } from '@shared/labels';
import { DataGate } from '../../components/DataGate';
import { useIsDesktop } from '../../layout/useMedia';
import { FilterChips } from '../../components/Controls';
import { PageTitle } from '../../components/Layout';
import { greetingFor, hourIn } from '../../lib/format';
import type { FilterContext, OwnerFilter } from '../../lib/home';
import { solarTermFor } from '../../lib/solarTerms';
import { useMe } from '../../state/auth';
import { useData } from '../../state/data';
import { loadPref, savePref } from '../../state/prefs';
import { BlockedSection, ComingUpSection, DecisionsSection, FreshnessFooter, NowSection, ReadySection, SinceReviewSection } from './sections';
import { ReadyStrip } from './ReadyStrip';

const FILTERS: OwnerFilter[] = ['all', 'mine', 'other', 'together', 'unassigned', 'waiting'];

export function Home() {
  const me = useMe();
  const desktop = useIsDesktop();
  const { today, zone } = useData();
  const [filter, setFilter] = useState<OwnerFilter>(() => {
    const stored = loadPref('home-filter');
    return (FILTERS as string[]).includes(stored ?? '') ? (stored as OwnerFilter) : 'all';
  });
  const changeFilter = (f: OwnerFilter) => {
    setFilter(f);
    savePref('home-filter', f);
  };

  const term = useMemo(() => solarTermFor(today), [today]);
  const zoneName = ZONE_OPTIONS.find((z) => z.zone === zone)?.label.replace(/ \(.*\)/, '') ?? '';

  return (
    <div className="page home">
      <PageTitle kicker={<span>{safeLong(today)} · <span className="faint">{zoneName} time</span></span>}>
        {greetingFor(hourIn(zone))}, {me.person.display_name}
      </PageTitle>
      <p className="season" title="Decorative: an approximate seasonal note, not part of your plan">
        <span lang="ja" className="season__kanji">{term.kanji}</span>
        <span className="season__text"> {term.romaji} · {term.gloss}</span>
      </p>

      <DataGate>
        {({ idx, dir }) => {
          const otherName = dir.others[0]?.display_name;
          const ctx: FilterContext = { meId: dir.me?.id ?? null, otherIds: dir.others.map((o) => o.id) };
          const options: { value: OwnerFilter; label: string }[] = [
            { value: 'all', label: 'Everything' },
            { value: 'mine', label: 'Mine' },
            ...(dir.others.length > 0 ? [{ value: 'other' as const, label: dir.others.length === 1 ? `${otherName}’s` : 'Others’' }] : []),
            { value: 'together', label: 'Together' },
            { value: 'unassigned', label: 'Unassigned' },
            { value: 'waiting', label: 'Waiting on someone else' },
          ];
          return (
            <>
              {!desktop && <ReadyStrip dir={dir} />}
              <FilterChips label="Show items for" value={filter} options={options} onChange={changeFilter} scroll />
              <div className="home-grid">
                <div className="home-col home-col--main">
                  <NowSection idx={idx} filter={filter} ctx={ctx} />
                  <DecisionsSection idx={idx} dir={dir} filter={filter} ctx={ctx} />
                  <BlockedSection idx={idx} filter={filter} ctx={ctx} />
                </div>
                <div className="home-col home-col--side">
                  {desktop && <ReadySection idx={idx} dir={dir} />}
                  <ComingUpSection idx={idx} dir={dir} filter={filter} ctx={ctx} />
                </div>
              </div>
              <SinceReviewSection idx={idx} dir={dir} />
              <FreshnessFooter />
              <p className="faint small home-link">
                Optional future work is kept out of the way on its own page. <Link to="/future">See future work</Link>
              </p>
            </>
          );
        }}
      </DataGate>
    </div>
  );
}

function safeLong(date: string): string {
  try {
    return formatCivil(date, 'long');
  } catch {
    return date;
  }
}
