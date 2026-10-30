import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ComputedDeadline, GateStatus, TravelerReadiness } from '@shared/engine-contracts';
import { travelerDeadlines } from '@shared/deadlines';
import { diffDays } from '@shared/dates';
import { ANCHOR_CONFIDENCE_LABEL } from '@shared/labels';
import type { AnchorData } from '@shared/types';
import { DateText, StatusBadge } from '../../components/Badges';
import { Button, ButtonLink } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { DeadlineRow } from '../../components/DeadlineRow';
import { Disclosure } from '../../components/Disclosure';
import { ErrorBanner } from '../../components/Feedback';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge, usePlain } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import type { Directory, Indexes } from '../../lib/records';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { AppliesToControl } from '../record/AppliesTo';
import { notOptional, ReadinessChip } from './readyBits';

function GateList({
  gates,
  empty,
  showReason,
  idx,
  first,
}: {
  gates: GateStatus[];
  empty: string;
  showReason?: 'blocker' | 'condition';
  idx: Indexes;
  /** Show this many at first, then "Show all N". */
  first?: number;
}) {
  const plain = usePlain();
  const [all, setAll] = useState(false);
  if (gates.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  const shown = first && !all ? gates.slice(0, first) : gates;
  return (
    <>
      <ul className="gate-list">
        {shown.map((g) => {
          const waiting = (g.blocked_by ?? []).map((k) => idx.byKey.get(k)).filter((r): r is NonNullable<typeof r> => !!r);
          return (
            <li key={g.record_id} className="gate">
              <RecordLink id={g.record_id} className="gate__title">
                {g.title}
              </RecordLink>
              {showReason === 'blocker' && g.blocker && !(waiting.length > 0 && /^waiting on/i.test(g.blocker.trim())) && <p className="small muted gate__why">{plain(g.blocker)}</p>}
              {showReason === 'blocker' && waiting.length > 0 && (
                <p className="small muted gate__why">
                  Waiting on:{' '}
                  {waiting.map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && ', '}
                      <RecordLink id={r.id}>{r.title}</RecordLink>
                    </span>
                  ))}
                </p>
              )}
              {showReason === 'condition' && g.condition && <p className="small muted gate__why">{plain(g.condition)}</p>}
              <div className="item__meta">
                <OwnerChip owner={g.owner} compact />
                <StatusBadge status={g.status} small />
              </div>
            </li>
          );
        })}
      </ul>
      {first && gates.length > first && (
        <div>
          <Button variant="quiet" small aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${gates.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

const MORE_STEP = 5;

/** The "does this apply?" questions as compact rows: the step on one line, Yes / No / Not sure beside it, five at a time. */
function ConditionalRows({ gates, idx, personId, name, onAnswered }: { gates: GateStatus[]; idx: Indexes; personId: string; name: string; onAnswered: (g: GateStatus) => void }) {
  const plain = usePlain();
  const [count, setCount] = useState(MORE_STEP);
  const shown = gates.slice(0, count);
  const left = gates.length - shown.length;
  return (
    <>
      <ul className="cond-rows">
        {shown.map((g) => {
          const rec = idx.byId.get(g.record_id);
          return (
            <li key={g.record_id} className="cond-row">
              <div className="cond-row__what">
                <RecordLink id={g.record_id} className="cond-row__title">
                  {g.title}
                </RecordLink>
                {g.condition && <p className="small muted cond-row__why">{plain(g.condition)}</p>}
              </div>
              {rec && <AppliesToControl compact record={rec} personId={personId} name={name} onSaved={() => onAnswered(g)} />}
            </li>
          );
        })}
      </ul>
      {left > 0 && (
        <div>
          <Button variant="quiet" small onClick={() => setCount((c) => c + MORE_STEP)}>
            Show {Math.min(MORE_STEP, left)} more{left > MORE_STEP ? ` (${left} left)` : ''}
          </Button>
        </div>
      )}
    </>
  );
}

/** What the state means, in one calm sentence, with plain counts (never a percentage). */
function stateExplanation(r: TravelerReadiness, counts: { done: number; total: number }): string | null {
  switch (r.state) {
    case 'blocked':
      return 'Something below is stuck, so this can’t be released yet. Clearing it comes first.';
    // The headline already counts what is left for these two.
    case 'not_started':
    case 'preparing':
      return null;
    case 'ready_to_release':
      return 'Every required step before leaving is done. Someone still has to release it on purpose.';
    case 'released':
      return 'Released for travel.';
    case 'arrived':
      return 'Arrived. The steps after landing are what is left.';
    case 'settled':
      return 'Everything needed after arrival is done too.';
    default:
      return null;
  }
}

const SHOWN_DATES = 6;

function DateList({ items, idx, today, empty }: { items: ComputedDeadline[]; idx: Indexes; today: string; empty: string }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return <p className="muted">{empty}</p>;
  const shown = all ? items : items.slice(0, SHOWN_DATES);
  return (
    <>
      <ul className="stack stack--tight">
        {shown.map((d) => (
          <DeadlineRow key={d.rule_id ? `${d.rule_id}-${d.traveler}` : `${d.record_id}-${d.label}`} d={d} idx={idx} today={today} headingLevel={3} />
        ))}
      </ul>
      {items.length > SHOWN_DATES && (
        <div>
          <Button variant="quiet" small aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${items.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

const dataOfOptional = (r: { data?: unknown } | undefined) => !!(r?.data as { optional_future_work?: boolean } | undefined)?.optional_future_work;

function ReadyBody({ personId, idx, dir }: { personId: string; idx: Indexes; dir: Directory }) {
  const { readiness, deadlineContext, today } = useData();
  const { refresh } = useSnapshot();
  const plain = usePlain();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
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
  const next = r.next_action && ok(r.next_action) ? r.next_action : null;
  // The next step has its own section; it is not listed a second time under Still to do.
  const open = r.open.filter(ok).filter((g) => g.record_id !== next?.record_id);
  const met = r.met.filter(ok);
  const conditional = r.conditional_unknown.filter(ok);
  const after = r.after_arrival.filter(ok);
  const notNeeded = (r.not_needed ?? []).filter((n) => !(idx.byId.get(n.record_id) && dataOfOptional(idx.byId.get(n.record_id))));
  const dates = travelerDeadlines(personId, deadlineContext);
  // Open on arrival only when a date before leaving is near (within 90 days) or already past.
  const soonDates = dates.before_departure.some((d) => d.deadline.date && d.state !== 'met' && diffDays(today, d.deadline.date) <= 90);
  const requiredTotal = blockers.length + open.length + met.length;
  const explanation = stateExplanation(r, { done: met.length, total: requiredTotal });
  // The answered step moves to another list; tell the person where it went and keep their place.
  const answered = (g: GateStatus) => {
    setNotice(`Saved. “${g.title}” has moved out of this list.`);
    window.setTimeout(() => noticeRef.current?.focus(), 120);
  };
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
    <div className="stack stack--loose ready-page">
      <Card tone={r.state === 'blocked' ? 'blocked' : 'default'}>
        <div className="ready__head">
          <span className="ready__who">
            <PersonBadge person={person} size={40} />
            <span className="ready__name-lg">{person.display_name}</span>
          </span>
          <ReadinessChip state={r.state} />
        </div>
        <p className="ready__headline">{plain(r.headline)}</p>
        {explanation && <p className="muted">{explanation}</p>}
      </Card>

      <p ref={noticeRef} tabIndex={-1} role="status" className={notice ? 'notice' : 'visually-hidden'}>
        {notice ?? ''}
      </p>

      {(r.departure || r.arrival) && (
        <Section title="Travel dates" headingLevel={2}>
          <Card className="ready-dates">
            <ul>
              {anchor(r.departure, 'Leaving')}
              {anchor(r.arrival, 'Arriving in Tokyo')}
            </ul>
          </Card>
        </Section>
      )}

      <Section title="Holding things up" count={blockers.length || undefined}>
        <GateList gates={blockers} empty="Nothing is stuck right now." showReason="blocker" idx={idx} first={3} />
      </Section>

      <Section title="What unlocks this">
        {next ? (
          <GateList gates={[next]} empty="" idx={idx} />
        ) : (
          <p className="muted">There is no single next step to name right now.</p>
        )}
      </Section>

      {conditional.length > 0 && (
        <Section title="Not sure yet if it applies" count={conditional.length}>
          <ConditionalRows gates={conditional} idx={idx} personId={personId} name={person.display_name} onAnswered={answered} />
        </Section>
      )}

      <Section title="Still to do" count={open.length || undefined}>
        <GateList gates={open} empty="Nothing else is waiting to be started." idx={idx} first={3} />
      </Section>

      {notNeeded.length > 0 && (
        <Disclosure title={`Not needed for ${person.display_name}`} meta={`${notNeeded.length}`}>
          <ul className="gate-list">
            {notNeeded.map((n) => {
              const rec = idx.byId.get(n.record_id);
              return (
                <li key={n.record_id} className="gate">
                  <RecordLink id={n.record_id} className="gate__title">
                    {n.title}
                  </RecordLink>
                  <p className="small muted">{plain(n.reason)}</p>
                  {rec && <AppliesToControl record={rec} personId={personId} name={person.display_name} onSaved={() => setNotice(`Saved. “${n.title}” has moved out of this list.`)} />}
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}

      {/* The long lists start closed, with their counts; dates open on their own only when one is close. */}
      <div className="stack stack--tight">
        <Disclosure title="Dates before leaving" meta={`${dates.before_departure.length}`} defaultOpen={soonDates}>
          <p className="small muted">Dates that come from rules, with what each one means. Nothing here is guessed.</p>
          <DateList items={dates.before_departure} idx={idx} today={today} empty="No rule-based dates before leaving." />
        </Disclosure>
        <Disclosure title="Steps after arrival" meta={`${after.length}`}>
          <p className="small muted">These come once the traveler has landed.</p>
          <GateList gates={after} empty="Nothing is listed for after arrival." idx={idx} />
        </Disclosure>
        <Disclosure title="Dates after arriving" meta={`${dates.after_arrival.length}`}>
          <DateList items={dates.after_arrival} idx={idx} today={today} empty="No rule-based dates after arriving." />
        </Disclosure>
        <Disclosure title="Done" meta={`${met.length}`}>
          <GateList gates={met} empty="Nothing is finished yet." idx={idx} />
        </Disclosure>
      </div>

      <p className="small muted">Optional future work is never counted here. Only the steps this traveler needs for the move are.</p>

      <p>
        <Link to="/" className="more-link">
          Back to Home
        </Link>
      </p>
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
