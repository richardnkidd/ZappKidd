import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { formatCivil } from '@shared/dates';
import { ZONE_OPTIONS } from '@shared/labels';
import { DataGate } from '../../components/DataGate';
import { FilterChips } from '../../components/Controls';
import { PageTitle } from '../../components/Layout';
import { useIsDesktop } from '../../layout/useMedia';
import { greetingFor, hourIn } from '../../lib/format';
import type { FilterContext, OwnerFilter } from '../../lib/home';
import { solarTermFor } from '../../lib/solarTerms';
import { useMe } from '../../state/auth';
import { useData } from '../../state/data';
import { loadPref, savePref } from '../../state/prefs';
import { needsMyApproval } from '../decide/decisionText';
import { ReadyStrip } from './ReadyStrip';
import { BlockedSection, ComingUpSection, DecisionsSection, FreshnessFooter, NowSection, PendingTasksSection, ReadySection, SinceReviewSection } from './sections';

const FILTERS: OwnerFilter[] = ['all', 'needs_me', 'mine', 'other', 'together', 'unassigned', 'waiting'];

export function Home() {
  const me = useMe();
  const desktop = useIsDesktop();
  const { today, zone } = useData();
  const [filter, setFilter] = useState<OwnerFilter>(() => {
    const stored = loadPref('home-filter');
    if ((FILTERS as string[]).includes(stored ?? '')) return stored as OwnerFilter;
    // First visit: on a phone start from "Needs me" (mine, shared, or waiting for me), on a wide screen from everything.
    return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? 'all' : 'needs_me';
  });
  const changeFilter = (f: OwnerFilter) => {
    setFilter(f);
    savePref('home-filter', f);
  };

  const term = useMemo(() => solarTermFor(today), [today]);
  const place = ZONE_OPTIONS.find((z) => z.zone === zone)?.place ?? '';

  return (
    <div className="page home">
      <PageTitle
        kicker={
          <span>
            {safeLong(today)} · <span className="faint">{place} time</span>
            <span className="season" title="Decorative: an approximate seasonal note, not part of your plan">
              {' '}
              ·{' '}
              <span lang="ja" className="season__kanji">
                {term.kanji}
              </span>{' '}
              <span className="season__text">
                {term.romaji} · {term.gloss}
              </span>
            </span>
          </span>
        }
      >
        {greetingFor(hourIn(zone))}, {me.person.display_name}
      </PageTitle>

      <DataGate>
        {({ idx, dir }) => {
          const otherName = dir.others[0]?.display_name;
          const ctx: FilterContext = {
            meId: dir.me?.id ?? null,
            otherIds: dir.others.map((o) => o.id),
            awaitingMe: (rec) => rec.type === 'decision' && needsMyApproval(rec as never, dir),
          };
          const options: { value: OwnerFilter; label: string }[] = [
            { value: 'all', label: 'Everything' },
            { value: 'needs_me', label: 'Needs me' },
            { value: 'mine', label: 'Only mine' },
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
                  <PendingTasksSection idx={idx} dir={dir} filter={filter} ctx={ctx} />
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
