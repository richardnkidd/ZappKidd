import { Link, useParams } from 'react-router';
import type { GateStatus } from '@shared/engine-contracts';
import { ANCHOR_CONFIDENCE_LABEL } from '@shared/labels';
import type { AnchorData } from '@shared/types';
import { DateText, StatusBadge } from '../../components/Badges';
import { ButtonLink } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { ErrorBanner } from '../../components/Feedback';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge, usePlain } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { plural } from '../../lib/format';
import type { Directory, Indexes } from '../../lib/records';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { notOptional, ReadinessChip } from './readyBits';

function GateList({ gates, empty, showReason }: { gates: GateStatus[]; empty: string; showReason?: 'blocker' | 'condition' }) {
  const plain = usePlain();
  if (gates.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="gate-list">
      {gates.map((g) => (
        <li key={g.record_id} className="gate">
          <RecordLink id={g.record_id} className="gate__title">
            {g.title}
          </RecordLink>
          {showReason === 'blocker' && g.blocker && <p className="small muted">{plain(g.blocker)}</p>}
          {showReason === 'condition' && g.condition && <p className="small muted">{plain(g.condition)}</p>}
          <div className="item__meta">
            <OwnerChip owner={g.owner} compact />
            <StatusBadge status={g.status} small />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReadyBody({ personId, idx, dir }: { personId: string; idx: Indexes; dir: Directory }) {
  const { readiness } = useData();
  const { refresh } = useSnapshot();
  const plain = usePlain();
  if (!readiness.ok) {
    return (
      <ErrorBanner title="We couldn't work out readiness just now." onRetry={() => void refresh()}>
        {readiness.error.message}
      </ErrorBanner>
    );
  }
  const r = readiness.value.find((x) => x.person_id === personId);
  const person = dir.personById(personId);
  if (!r || !person) {
    return (
      <EmptyState icon="user" title="We couldn’t find that traveler." action={<ButtonLink to="/" variant="primary">Back to Home</ButtonLink>} />
    );
  }
  const ok = notOptional(idx);
  const blockers = r.blockers.filter(ok);
  const open = r.open.filter(ok);
  const met = r.met.filter(ok);
  const conditional = r.conditional_unknown.filter(ok);
  const after = r.after_arrival.filter(ok);
  const next = r.next_action && ok(r.next_action) ? r.next_action : null;
  const anchor = (a: AnchorData | null, label: string) =>
    a ? (
      <li className="lane__row">
        <span className="lane__what">{label}</span>
        <span className="lane__when">
          <DateText date={a.date} />
          {a.confidence !== 'awaiting' && <span className="chip chip--neutral chip--sm">{ANCHOR_CONFIDENCE_LABEL[a.confidence] ?? a.confidence}</span>}
        </span>
      </li>
    ) : null;

  return (
    <div className="stack stack--loose">
      <Card tone={r.state === 'blocked' ? 'blocked' : 'default'}>
        <div className="ready__head">
          <span className="ready__who">
            <PersonBadge person={person} size={40} />
            <span className="ready__name-lg">{person.display_name}</span>
          </span>
          <ReadinessChip state={r.state} />
        </div>
        <p className="ready__headline">{plain(r.headline)}</p>
        <p className="small muted">Optional future work is never counted here. Only the steps this traveler needs for the move are.</p>
      </Card>

      {(r.departure || r.arrival) && (
        <Section title="Travel dates" headingLevel={2}>
          <Card>
            <ul>
              {anchor(r.departure, 'Leaving')}
              {anchor(r.arrival, 'Arriving in Tokyo')}
            </ul>
          </Card>
        </Section>
      )}

      <Section title="Holding things up" count={blockers.length || undefined}>
        <GateList gates={blockers} empty="Nothing is stuck right now." showReason="blocker" />
      </Section>

      <Section title="What unlocks this">
        {next ? (
          <GateList gates={[next]} empty="" />
        ) : (
          <p className="muted">There is no single next step to name right now.</p>
        )}
      </Section>

      <Section title="Still to do" count={open.length || undefined}>
        <GateList gates={open} empty="Nothing else is waiting to be started." />
      </Section>

      {conditional.length > 0 && (
        <Section title="Not sure yet if it applies" count={conditional.length} intro="These only matter in certain situations. Nothing is wrong; they just need an answer.">
          <GateList gates={conditional} empty="" showReason="condition" />
        </Section>
      )}

      <Section title="Done" count={met.length || undefined}>
        <GateList gates={met} empty="Nothing is finished yet." />
      </Section>

      <Section title="After arrival" count={after.length || undefined} intro="These come once the traveler has landed.">
        <GateList gates={after} empty="Nothing is listed for after arrival." />
      </Section>

      <p>
        <Link to="/" className="more-link">
          Back to Home
        </Link>
      </p>
      <p className="faint small">{plural(met.length, 'step')} finished of {met.length + open.length + blockers.length} needed before departure. No percentages are shown on purpose.</p>
    </div>
  );
}

export function ReadyDetail() {
  const { personId = '' } = useParams();
  return (
    <div className="page">
      <PageTitle kicker="Readiness">{personId ? <ReadyTitle id={personId} /> : 'Who’s ready'}</PageTitle>
      <DataGate>{({ idx, dir }) => <ReadyBody personId={personId} idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}

function ReadyTitle({ id }: { id: string }) {
  const { dir } = useSnapshot();
  const name = dir?.personById(id)?.display_name;
  return <>{name ? `${name}’s readiness` : 'Readiness'}</>;
}
