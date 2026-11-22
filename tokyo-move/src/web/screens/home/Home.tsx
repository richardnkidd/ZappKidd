import { useMemo } from 'react';
import { formatCivil } from '@shared/dates';
import { keyLookup } from '@shared/plain';
import { DataGate } from '../../components/DataGate';
import { PageTitle } from '../../components/Layout';
import { PendingUpdateNotice } from '../../components/PendingUpdateNotice';
import { solarTermFor } from '../../lib/solarTerms';
import { useMe } from '../../state/auth';
import { useData } from '../../state/data';
import { PendingTasksLine, SinceLine, StuckSection, TravellersSection, YourTurnSection } from './sections';

/**
 * Home fits about one phone screen: "Your turn" (3 at most), "Stuck" (2 at most), "Travellers", and one
 * "since you last looked" line. Wide screens show the same content in two columns.
 */
export function Home() {
  const me = useMe();
  const { today } = useData();
  const term = useMemo(() => solarTermFor(today), [today]);

  return (
    <div className="page home">
      <PageTitle>
        <span className="visually-hidden">{me.person.display_name}’s home, </span>
        {safeDay(today)} ·{' '}
        <span lang="ja" className="home-season">
          {term.kanji}
        </span>
        <span className="visually-hidden"> ({term.gloss})</span>
      </PageTitle>

      <PendingUpdateNotice />

      <DataGate>
        {({ idx, dir }) => {
          const lookup = keyLookup(idx.byKey);
          return (
            <div className="home-layout">
              <div className="home-layout__main">
                <YourTurnSection idx={idx} dir={dir} lookup={lookup} />
                <StuckSection idx={idx} lookup={lookup} />
                <PendingTasksLine idx={idx} />
              </div>
              <div className="home-layout__side">
                <TravellersSection idx={idx} dir={dir} lookup={lookup} />
                <SinceLine idx={idx} dir={dir} lookup={lookup} />
              </div>
            </div>
          );
        }}
      </DataGate>
    </div>
  );
}

function safeDay(date: string): string {
  try {
    return formatCivil(date, 'weekday');
  } catch {
    return date;
  }
}
