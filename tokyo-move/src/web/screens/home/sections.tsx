import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { READINESS_STATE_LABEL } from '@shared/labels';
import type { AuditEntry, HouseholdSettings } from '@shared/types';
import { api, describeError } from '../../net/client';
import { DateText, DeadlineBadge, VerificationNote } from '../../components/Badges';
import { Button } from '../../components/Controls';
import { Disclosure } from '../../components/Disclosure';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { ItemCard } from '../../components/ItemCard';
import { Card, EmptyState, Section, Skeleton } from '../../components/Layout';
import { OwnerChip, PersonBadge } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { describeAuditList } from '../../lib/audit';
import { civil, instant, plain, plural } from '../../lib/format';
import {
  deadlineOwner,
  deadlineVerification,
  selectBlocked,
  selectComingUp,
  selectDecisions,
  selectNow,
  type ComingRow,
  type FilterContext,
  type OwnerFilter,
} from '../../lib/home';
import type { Directory, Indexes } from '../../lib/records';
import { dataOf } from '../../lib/records';
import { useData } from '../../state/data';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { approvalSummary, YourTurnTag } from '../decide/decisionText';

interface CommonProps {
  idx: Indexes;
  filter: OwnerFilter;
  ctx: FilterContext;
}

/* ------------------------------------------------------------------ Now */

export function NowSection({ idx, filter, ctx }: CommonProps) {
  const { today, deadlinesByRecord, deadlines } = useData();
  const items = useMemo(
    () => selectNow(idx, { today, filter, ctx, deadlinesByRecord: deadlines.ok ? deadlinesByRecord : undefined, limit: 5 }),
    [idx, today, filter, ctx, deadlinesByRecord, deadlines],
  );
  return (
    <Section title="Now" className="sec-now" intro="The next few things worth doing, with nothing standing in the way.">
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="check" title={filter === 'all' ? 'Nothing is waiting on you right now.' : 'Nothing here for this view.'}>
            {filter === 'all' ? 'When something becomes ready to do, it will show up here.' : 'Try another view above, or look through the whole plan.'}
          </EmptyState>
          <div className="center">
            <Link className="btn btn--secondary" to="/plan">Open the plan</Link>
          </div>
        </Card>
      ) : (
        <ul className="item-list">
          {items.map((it) => (
            <ItemCard
              key={it.id}
              recordId={it.recordId}
              title={it.title}
              owner={it.owner}
              ownerProposed={it.ownerProposed}
              nextAction={it.nextAction}
              date={it.date}
              dateKind={it.dateKind}
              dateState={it.dateState}
              today={today}
              note={it.note}
              showStatus={it.kind === 'milestone' && it.status === 'in_progress'}
              status={it.status}
            />
          ))}
        </ul>
      )}
      <p className="small">
        <Link to="/plan">See the whole plan</Link>
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ Decisions */

export function DecisionsSection({ idx, dir, filter, ctx }: CommonProps & { dir: Directory }) {
  const { today } = useData();
  const all = useMemo(() => selectDecisions(idx, filter, ctx), [idx, filter, ctx]);
  const shown = all.slice(0, 3);
  return (
    <Section
      title="Needs a decision"
      count={all.length || undefined}
      className="sec-decide"
      intro="At most three at a time, so nothing piles up."
    >
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="No open decisions for this view." />
        </Card>
      ) : (
        <ul className="item-list">
          {shown.map((d) => {
            const needed = d.data?.needed_by;
            const summary = approvalSummary(d, dir);
            return (
              <li key={d.id} className={`item ${d.status === 'proposed' ? 'item--proposal' : ''}`}>
                <div className="item__main">
                  <Link className="item__title" to={{ pathname: '/decide', hash: `#decision-${d.key}` }}>
                    {d.title}
                  </Link>
                  <p className="item__action">
                    <span className="item__label">{d.status === 'proposed' ? 'Proposal' : 'Open'}</span> {summary.text}
                  </p>
                  <div className="item__meta">
                    <OwnerChip owner={d.owner} proposed={d.owner_proposed} compact />
                    {needed?.date ? (
                      <span className="item__when">
                        <span className="faint small">Needed by</span>
                        <DateText date={needed.date} today={today} />
                        <DeadlineBadge kind={needed.kind} />
                      </span>
                    ) : (
                      <span className="faint small">{d.data?.trigger ? `When: ${d.data.trigger}` : 'No date yet'}</span>
                    )}
                    <YourTurnTag decision={d} dir={dir} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {all.length > shown.length && (
        <p className="small">
          <Link to="/decide">{plural(all.length - shown.length, 'more decision')} waiting in Decide</Link>
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ Blocked */

export function BlockedSection({ idx, filter, ctx }: CommonProps) {
  const { today } = useData();
  const all = useMemo(() => selectBlocked(idx, filter, ctx), [idx, filter, ctx]);
  const shown = all.slice(0, 5);
  return (
    <Section title="Blocked" count={all.length || undefined} className="sec-blocked" intro="What is stuck, and what it is waiting for.">
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="Nothing is blocked for this view." />
        </Card>
      ) : (
        <ul className="item-list">
          {shown.map((b) => (
            <ItemCard
              key={b.record.id}
              recordId={b.record.id}
              title={b.record.title}
              owner={b.record.owner}
              ownerProposed={b.record.owner_proposed}
              status={b.record.status}
              showStatus
              tone={b.kind === 'blocked' ? 'blocked' : 'default'}
              today={today}
            >
              <p className="item__action preline">
                <span className="item__label">{b.kind === 'blocked' ? 'Why' : 'Waiting for'}</span>{' '}
                {(b.reason ? plain(b.reason) : null) ??
                  (b.waitingOn.length > 0
                    ? `Waiting for ${b.waitingOn.map((w) => w.title).join(' and ')}`
                    : 'No reason written down yet — open it to add one')}
              </p>
            </ItemCard>
          ))}
        </ul>
      )}
      {all.length > shown.length && (
        <p className="small">
          <Link to="/plan?view=board">{all.length - shown.length} more in the plan board</Link>
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ Coming up */

function whoseDeadline(d: ComputedDeadline, idx: Indexes, dir: Directory) {
  return deadlineOwner(d, idx, dir);
}

function ComingDeadline({ d, idx, dir, today }: { d: ComputedDeadline; idx: Indexes; dir: Directory; today: string }) {
  const verification = deadlineVerification(d, idx);
  const label = d.record_id ? (
    <RecordLink id={d.record_id} className="coming__title">
      {d.label}
    </RecordLink>
  ) : (
    <span className="coming__title">{d.label}</span>
  );
  return (
    <>
      <div className="coming__date">
        <DateText date={d.deadline.date} today={today} state={d.state} />
      </div>
      <div className="coming__body">
        {label}
        <div className="item__meta">
          <DeadlineBadge kind={d.kind} />
          <OwnerChip owner={whoseDeadline(d, idx, dir)} compact />
          {d.approximate && <span className="faint small">Approximate — holidays not counted</span>}
        </div>
        <VerificationNote verification={verification} kind={d.kind} />
      </div>
    </>
  );
}

function ComingReview({ row, today }: { row: ComingRow; today: string }) {
  const reviews = row.reviews ?? [];
  return (
    <>
      <div className="coming__date">
        <DateText date={row.date} today={today} />
      </div>
      <div className="coming__body">
        <details className="review-summary">
          <summary>
            <Icon name="chevron-right" size={16} className="review-summary__chev" />
            <span>
              <strong>Proposed review checkpoint</strong>
              <span className="faint"> · {plural(reviews.length, 'item')} · not yet scheduled</span>
            </span>
          </summary>
          <p className="small muted">A checkpoint to look at these again together. It is not a deadline.</p>
          <ul className="review-summary__list">
            {reviews.map((r) => (
              <li key={r.id}>
                {r.record_id ? <RecordLink id={r.record_id}>{r.label}</RecordLink> : r.label}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  );
}

export function ComingUpSection({ idx, dir, filter, ctx }: CommonProps & { dir: Directory }) {
  const { today, deadlines } = useData();
  const { refresh } = useSnapshot();
  const coming = useMemo(
    () => (deadlines.ok ? selectComingUp(deadlines.value, idx, dir, { today, filter, ctx, windowDays: 60 }) : null),
    [deadlines, idx, dir, today, filter, ctx],
  );

  if (!deadlines.ok || !coming) {
    return (
      <Section title="Coming up" className="sec-coming">
        <ErrorBanner title="We couldn't work out upcoming dates just now." onRetry={() => void refresh()}>
          Everything else on this page still works. {deadlines.ok ? '' : 'Technical detail: ' + deadlines.error.message}
        </ErrorBanner>
      </Section>
    );
  }
  const total = coming.groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <Section title="Coming up" className="sec-coming" intro="The next two months, week by week.">
      {total === 0 ? (
        <Card>
          <EmptyState icon="calendar" title="Nothing dated in the next two months for this view." />
        </Card>
      ) : (
        <div className="stack">
          {coming.groups.map((g) => (
            <Card key={g.key} className="coming-group">
              <h3 className="coming-group__title">{g.label}</h3>
              <ul className="coming-list">
                {g.rows.map((row, i) => (
                  <li key={row.kind === 'deadline' ? row.deadline!.id : `review-${row.date}-${i}`} className="coming">
                    {row.kind === 'deadline' ? (
                      <ComingDeadline d={row.deadline!} idx={idx} dir={dir} today={today} />
                    ) : (
                      <ComingReview row={row} today={today} />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {coming.awaiting.length > 0 && (
        <Disclosure title="Awaiting a date" meta={String(coming.awaiting.length)} className="disclosure--calm">
          <p className="muted small">These get a date once a travel date or another starting point is set. Nothing is wrong.</p>
          <ul className="awaiting-list">
            {coming.awaiting.map((d) => (
              <li key={d.id} className="awaiting">
                {d.record_id ? <RecordLink id={d.record_id}>{d.label}</RecordLink> : <span>{d.label}</span>}
                <span className="item__meta">
                  <DeadlineBadge kind={d.kind} />
                  <OwnerChip owner={whoseDeadline(d, idx, dir)} compact />
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ Who's ready */

export function ReadySection({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { readiness } = useData();
  const { refresh } = useSnapshot();
  return (
    <Section title="Who’s ready" className="sec-ready" intro="Each traveler on their own. Optional future work never holds anyone back.">
      {!readiness.ok ? (
        <ErrorBanner title="We couldn't work out who is ready just now." onRetry={() => void refresh()}>
          Everything else on this page still works.
        </ErrorBanner>
      ) : readiness.value.length === 0 ? (
        <Card>
          <EmptyState icon="user" title="Readiness will appear once travelers and their gates are set up." />
        </Card>
      ) : (
        <ul className="ready-list">
          {readiness.value.map((r) => {
            const person = dir.personById(r.person_id);
            const gates = (list: typeof r.blockers) => list.filter((g) => !dataOf<{ optional_future_work?: boolean }>(idx.byId.get(g.record_id) ?? ({} as never)).optional_future_work);
            const blockers = gates(r.blockers).slice(0, 3);
            const next = r.next_action && !dataOf<{ optional_future_work?: boolean }>(idx.byId.get(r.next_action.record_id) ?? ({} as never)).optional_future_work ? r.next_action : null;
            const tone = r.state === 'blocked' ? 'kaki' : r.state === 'preparing' ? 'ai' : r.state === 'not_started' ? 'neutral' : 'matcha';
            const stateIcon = r.state === 'blocked' ? 'stop' : r.state === 'not_started' ? 'circle' : r.state === 'preparing' ? 'half' : 'check';
            return (
              <li key={r.person_id}>
                <Card as="article" className="ready" tone={r.state === 'blocked' ? 'blocked' : 'default'}>
                  <header className="ready__head">
                    <span className="ready__who">
                      <PersonBadge person={person} size={32} />
                      <h3 className="ready__name">{dir.nameOf(r.person_id)}</h3>
                    </span>
                    <span className={`chip chip--${tone}`}>
                      <Icon name={stateIcon} size={15} />
                      <span>{READINESS_STATE_LABEL[r.state] ?? r.state}</span>
                    </span>
                  </header>
                  <p className="ready__headline">{plain(r.headline)}</p>
                  {blockers.length > 0 && (
                    <div className="ready__block">
                      <h4>Holding things up</h4>
                      <ul className="ready__list">
                        {blockers.map((g) => (
                          <li key={g.record_id}>
                            <RecordLink id={g.record_id}>{g.title}</RecordLink>
                            {g.blocker && <span className="muted"> — {plain(g.blocker)}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {next && (
                    <div className="ready__block">
                      <h4>What unlocks this</h4>
                      <p>
                        <RecordLink id={next.record_id}>{next.title}</RecordLink>
                        {next.owner && (
                          <>
                            {' '}
                            <OwnerChip owner={next.owner} compact />
                          </>
                        )}
                      </p>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ Since your last review */

export function SinceReviewSection({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { snapshot } = useSnapshot();
  const { zone } = usePrefs();
  const since = snapshot?.last_review_completed_at ?? null;
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; entries: AuditEntry[] } | { kind: 'error'; message: string }>({ kind: 'loading' });
  const [showAll, setShowAll] = useState(false);
  const [tick, setTick] = useState(0);
  const generatedAt = snapshot?.generated_at;

  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    api
      .audit({ since }, ctl.signal)
      .then((entries) => setState({ kind: 'ready', entries }))
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({ kind: 'error', message: describeError(e) });
      });
    return () => ctl.abort();
  }, [since, tick, generatedAt]);

  const lines = useMemo(() => (state.kind === 'ready' ? describeAuditList(state.entries, idx, dir) : []), [state, idx, dir]);
  const shown = showAll ? lines : lines.slice(0, 8);
  const title = since ? 'Since your last review' : 'Recent changes';

  return (
    <Section
      title={title}
      count={state.kind === 'ready' && lines.length ? lines.length : undefined}
      className="sec-since"
      intro={since ? `Everything that changed after ${instant(since, zone, 'long')}.` : 'No review has been finished yet, so here is what changed most recently.'}
    >
      {state.kind === 'loading' && (
        <Card>
          <Skeleton lines={3} />
        </Card>
      )}
      {state.kind === 'error' && (
        <ErrorBanner title="We couldn't load the change history." onRetry={() => setTick((t) => t + 1)}>
          {state.message}
        </ErrorBanner>
      )}
      {state.kind === 'ready' && lines.length === 0 && (
        <Card>
          <EmptyState icon="check" title="Nothing has changed since then." />
        </Card>
      )}
      {state.kind === 'ready' && lines.length > 0 && (
        <Card>
          <ul className="audit-list">
            {shown.map((l) => (
              <li key={l.id} className="audit-line">
                <span className="audit-line__text">
                  <strong>{l.who}</strong> {l.what}
                  {l.recordId && (
                    <>
                      {' '}
                      <RecordLink id={l.recordId} className="audit-line__link" ariaLabel={`Open: ${l.what}`}>
                        Open
                      </RecordLink>
                    </>
                  )}
                </span>
                <time className="faint small" dateTime={l.at}>
                  {instant(l.at, zone, 'short')}
                </time>
              </li>
            ))}
          </ul>
          {lines.length > 8 && (
            <div className="center">
              <Button variant="quiet" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${lines.length}`}
              </Button>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ Freshness */

export function FreshnessFooter() {
  const { snapshot, loadedAt } = useSnapshot();
  const { zone } = usePrefs();
  if (!snapshot) return null;
  const run = snapshot.last_import;
  const adapter: HouseholdSettings['task_adapter'] | undefined = snapshot.settings?.task_adapter;
  const newestSync = snapshot.task_links.map((t) => t.last_synced_at).filter((x): x is string => Boolean(x)).sort().pop() ?? null;
  return (
    <footer className="freshness" aria-label="How fresh this information is">
      <ul>
        <li>
          {run ? (
            <>
              Plan imported {instant(run.finished_at ?? run.started_at, zone, 'short')} from “{run.source_label}”.
            </>
          ) : (
            <>No plan has been imported yet.</>
          )}
        </li>
        <li>
          {adapter ? (
            adapter.can_write ? (
              <>Task list {newestSync ? `synced ${instant(newestSync, zone, 'short')}` : 'connected'}.</>
            ) : (
              <>
                Task list copy as of {adapter.as_of ? civil(adapter.as_of.slice(0, 10), 'short') : 'an unknown date'} — read-only
                {newestSync ? `, last refreshed ${instant(newestSync, zone, 'short')}` : ''}.
              </>
            )
          ) : (
            <>Task list status unknown.</>
          )}
        </li>
        {loadedAt && <li>This page loaded {instant(loadedAt.toISOString(), zone, 'time')}.</li>}
      </ul>
    </footer>
  );
}
