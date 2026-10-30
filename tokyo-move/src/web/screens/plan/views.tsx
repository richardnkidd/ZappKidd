import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router';
import { dependencyChain } from '@shared/readiness';
import { PHASE_LABEL, PHASE_ORDER, WORK_STATUS_LABEL, ANCHOR_CONFIDENCE_LABEL } from '@shared/labels';
import type { PhaseKey, WorkStatus } from '@shared/types';
import { DateText, DeadlineBadge, OptionalTag, StatusBadge } from '../../components/Badges';
import { Button, Field, SegmentedControl, Select } from '../../components/Controls';
import { Disclosure } from '../../components/Disclosure';
import { Icon } from '../../components/Icon';
import { ItemCard } from '../../components/ItemCard';
import { Card, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge, usePlain } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { civil, plural } from '../../lib/format';
import { groupByPhase, groupByStatus, groupByWorkstream, sortPlanItems, type PlanItemData, type SortKey } from '../../lib/plan';
import { attempt } from '../../lib/safe';
import { dataOf, isOpenWork, type Directory, type Indexes } from '../../lib/records';
import type { AnchorData } from '@shared/types';

/* ------------------------------------------------------------------ shared */

function PlanItemCard({ it, today, showStatus = true }: { it: PlanItemData; today: string; showStatus?: boolean }) {
  const { m } = it;
  return (
    <ItemCard
      recordId={m.id}
      title={m.title}
      owner={m.owner}
      ownerProposed={m.owner_proposed}
      nextAction={m.data?.next_action}
      status={m.status}
      showStatus={showStatus}
      date={it.date}
      dateKind={it.dateKind}
      dateState={it.dateState}
      today={today}
      optional={m.data?.optional_future_work}
      tone={m.status === 'blocked' ? 'blocked' : 'default'}
    />
  );
}

/* ------------------------------------------------------------------ by workstream */

export function WorkstreamView({ items, idx, today }: { items: PlanItemData[]; idx: Indexes; today: string }) {
  const groups = useMemo(() => groupByWorkstream(sortPlanItems(items, 'date', (o) => o ?? ''), idx), [items, idx]);
  return (
    <div className="stack" aria-label="Workstreams">
      {groups.map((g) => {
        const open = g.items.filter((i) => isOpenWork(i.m.status));
        const blocked = g.items.filter((i) => i.m.status === 'blocked').length;
        const active = g.items.some((i) => i.m.status === 'in_progress' || i.m.status === 'blocked');
        const closed = g.items.filter((i) => !isOpenWork(i.m.status));
        return (
          <Disclosure
            key={g.key || 'other'}
            title={g.title}
            meta={`${open.length} to do${blocked ? ` · ${blocked} blocked` : ''}`}
            defaultOpen={active}
          >
            {g.related.length > 0 && (
              <p className="small muted related">
                Related:{' '}
                {g.related.map((k, i) => {
                  const rec = idx.byKey.get(k);
                  return (
                    <Fragment key={k}>
                      {i > 0 && ', '}
                      {rec ? <RecordLink id={rec.id}>{rec.title}</RecordLink> : k}
                    </Fragment>
                  );
                })}{' '}
                <span className="faint">(for context; nothing here is waiting on these)</span>
              </p>
            )}
            {open.length > 0 ? (
              <ul className="item-list">
                {open.map((it) => (
                  <PlanItemCard key={it.m.id} it={it} today={today} />
                ))}
              </ul>
            ) : (
              <p className="muted">Everything here is finished or set aside.</p>
            )}
            {closed.length > 0 && (
              <Disclosure title={`Finished or set aside`} meta={String(closed.length)} level={4} className="disclosure--flat">
                <ul className="item-list">
                  {closed.map((it) => (
                    <PlanItemCard key={it.m.id} it={it} today={today} />
                  ))}
                </ul>
              </Disclosure>
            )}
          </Disclosure>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ list */

const SORT_LABEL: Record<SortKey, string> = {
  date: 'Next date',
  status: 'Status',
  owner: 'Owner',
  title: 'Title',
  priority: 'Priority',
};

export function ListView({ items, dir, today }: { items: PlanItemData[]; dir: Directory; today: string }) {
  const plain = usePlain();
  const [sort, setSort] = useState<SortKey>('date');
  const sorted = useMemo(() => sortPlanItems(items, sort, (o) => dir.ownerLabel(o)), [items, sort, dir]);
  const th = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort === key ? 'ascending' : 'none'}>
      <button type="button" className="sort-btn" aria-pressed={sort === key} onClick={() => setSort(key)}>
        {label}
        {sort === key && <Icon name="chevron-down" size={14} />}
        <span className="visually-hidden">{sort === key ? ', sorted' : ', sort by this'}</span>
      </button>
    </th>
  );
  return (
    <div className="stack">
      <div className="list-sort">
        <Field label="Sort by">
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ul className="item-list list-cards">
        {sorted.map((it) => (
          <PlanItemCard key={it.m.id} it={it} today={today} />
        ))}
      </ul>
      <div className="table-wrap list-table">
        <table className="table">
          <caption className="visually-hidden">All plan items, sortable</caption>
          <thead>
            <tr>
              <th scope="col">What</th>
              {th('owner', 'Owner')}
              {th('status', 'Status')}
              {th('date', 'Next date')}
              <th scope="col">Phase</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ m, date, dateKind, dateState }) => (
              <tr key={m.id}>
                <th scope="row">
                  <RecordLink id={m.id}>{m.title}</RecordLink>
                  {m.data?.optional_future_work && (
                    <>
                      {' '}
                      <OptionalTag />
                    </>
                  )}
                  {m.data?.next_action && <p className="small muted table-next preline">{plain(m.data.next_action)}</p>}
                </th>
                <td>
                  <OwnerChip owner={m.owner} proposed={m.owner_proposed} compact />
                </td>
                <td>
                  <StatusBadge status={m.status} small />
                </td>
                <td>
                  <DateText date={date} today={today} state={dateState ?? undefined} />
                  {dateKind && (
                    <div>
                      <DeadlineBadge kind={dateKind} />
                    </div>
                  )}
                </td>
                <td className="small">{m.data?.phase ? PHASE_LABEL[m.data.phase] : <span className="faint">Not placed yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ board */

const BOARD_MAIN: WorkStatus[] = ['planned', 'in_progress', 'blocked', 'waiting_external', 'completed'];
const COLUMN_CAP = 8;

export function BoardView({
  items,
  today,
  expanded,
  setExpanded,
}: {
  items: PlanItemData[];
  today: string;
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const byStatus = useMemo(() => groupByStatus(sortPlanItems(items, 'date', (o) => o ?? '')), [items]);
  const set = (list: PlanItemData[]) => list;
  const closedOnes = [...(byStatus.get('eliminated') ?? []), ...(byStatus.get('not_applicable') ?? [])];
  return (
    <div className="stack">
      <div className="board">
        {BOARD_MAIN.map((s) => {
          const list = set(byStatus.get(s) ?? []);
          const open = expanded[s];
          const visible = open ? list : list.slice(0, COLUMN_CAP);
          return (
            <section key={s} className={`board-col board-col--${s}`} aria-labelledby={`col-${s}`}>
              <h3 id={`col-${s}`} className="board-col__title">
                <StatusBadge status={s} />
                <span className="count">{list.length}</span>
              </h3>
              {list.length === 0 ? (
                <p className="faint small board-col__empty">Nothing here.</p>
              ) : (
                <ul className="item-list item-list--compact">
                  {visible.map((it) => (
                    <PlanItemCard key={it.m.id} it={it} today={today} showStatus={false} />
                  ))}
                </ul>
              )}
              {list.length > COLUMN_CAP && (
                <Button variant="quiet" onClick={() => setExpanded((e) => ({ ...e, [s]: !open }))}>
                  {open ? 'Show fewer' : `Show ${list.length - COLUMN_CAP} more`}
                </Button>
              )}
            </section>
          );
        })}
      </div>
      {closedOnes.length > 0 && (
        <Disclosure title="Dropped or not needed" meta={String(closedOnes.length)}>
          <ul className="item-list item-list--compact">
            {closedOnes.map((it) => (
              <PlanItemCard key={it.m.id} it={it} today={today} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

function Chain({ itemKey, idx }: { itemKey: string; idx: Indexes }) {
  const chain = useMemo(() => attempt(() => dependencyChain(itemKey, idx.all)), [itemKey, idx]);
  const links = chain.ok
    ? chain.value.filter((c) => !c.met).sort((a, b) => a.depth - b.depth)
    : (idx.milestoneByKey.get(itemKey)?.data?.dependencies ?? [])
        .map((k) => ({ key: k, title: idx.byKey.get(k)?.title ?? k, status: idx.byKey.get(k)?.status ?? '', met: false, depth: 1 }))
        .filter((c) => c.status !== 'completed');
  if (links.length === 0) return null;
  return (
    <div className="chain">
      <span className="chain__label">Waits on</span>
      <ol className="chain__list">
        {links.map((c, i) => {
          const rec = idx.byKey.get(c.key);
          return (
            <li key={c.key}>
              {i > 0 && <Icon name="arrow-right" size={14} className="chain__arrow" />}
              {rec ? <RecordLink id={rec.id}>{c.title}</RecordLink> : c.title}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TravelLanes({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const anchors = idx.anchors.map((a) => dataOf<AnchorData>(a)).filter((a) => a.code);
  const forPerson = (id: string) => idx.anchors.filter((a) => dataOf<AnchorData>(a).traveler === id);
  const helpers = idx.anchors.filter((a) => dataOf<AnchorData>(a).traveler === 'household' || dataOf<AnchorData>(a).coordination_only);
  if (anchors.length === 0) return null;
  const row = (a: (typeof idx.anchors)[number]) => {
    const d = dataOf<AnchorData>(a);
    return (
      <li key={a.id} className="lane__row">
        <span className="lane__what">{d.meaning ?? a.title}</span>
        <span className="lane__when">
          <DateText date={d.date ?? null} />
          {d.confidence && d.confidence !== 'awaiting' && <span className="chip chip--neutral chip--sm">{ANCHOR_CONFIDENCE_LABEL[d.confidence] ?? d.confidence}</span>}
        </span>
      </li>
    );
  };
  return (
    <Section title="Travel dates" headingLevel={2} intro="Each traveler has their own dates. Moving one person's date never moves another's.">
      <div className="lanes">
        {dir.people.map((p) => {
          const rows = forPerson(p.id).filter((a) => !dataOf<AnchorData>(a).coordination_only);
          return (
            <Card as="section" key={p.id} className="lane" aria-label={`${p.display_name}'s dates`}>
              <h3 className="lane__title">
                <PersonBadge person={p} size={26} /> {p.display_name}
              </h3>
              {rows.length > 0 ? <ul>{rows.map(row)}</ul> : <p className="faint">No dates recorded yet.</p>}
            </Card>
          );
        })}
      </div>
      {helpers.length > 0 && (
        <Disclosure title="Household helper dates" level={4} className="disclosure--flat">
          <p className="small muted">Used only to coordinate. They never decide any one person's legal deadlines.</p>
          <ul>{helpers.map(row)}</ul>
        </Disclosure>
      )}
    </Section>
  );
}

export function TimelineView({ items, idx, dir, today }: { items: PlanItemData[]; idx: Indexes; dir: Directory; today: string }) {
  const [mode, setMode] = useState<'windows' | 'table'>('windows');
  const byPhase = useMemo(() => groupByPhase(sortPlanItems(items, 'date', (o) => o ?? '')), [items]);
  const phases: (PhaseKey | 'none')[] = [...PHASE_ORDER, 'none'];

  const dated = useMemo(
    () => sortPlanItems(items.filter((i) => i.date && i.dateKind !== 'review_date'), 'date', (o) => o ?? ''),
    [items],
  );
  const reviewOnly = items.filter((i) => i.dateKind === 'review_date');

  return (
    <div className="stack stack--loose">
      <TravelLanes idx={idx} dir={dir} />
      <Section
        title="Phases"
        headingLevel={2}
        intro="Work in the order it needs to happen. Chains show what is waiting on what — there is no single critical path to chase."
        action={
          <SegmentedControl
            label="Timeline layout"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'windows', label: 'Windows' },
              { value: 'table', label: 'Dated table' },
            ]}
          />
        }
      >
        {mode === 'windows' ? (
          <ol className="phases">
            {phases.map((p) => {
              const list = byPhase.get(p) ?? [];
              if (list.length === 0) return null;
              const real = list.filter((i) => i.dateKind !== 'review_date' && i.date);
              const undated = list.filter((i) => !i.date);
              const reviews = list.filter((i) => i.dateKind === 'review_date');
              const reviewsByDate = new Map<string, PlanItemData[]>();
              for (const r of reviews) reviewsByDate.set(r.date!, [...(reviewsByDate.get(r.date!) ?? []), r]);
              return (
                <li key={p} className="phase">
                  <h3 className="phase__title">
                    {p === 'none' ? 'Not placed in a phase yet' : PHASE_LABEL[p]}
                    <span className="count">{list.length}</span>
                  </h3>
                  <ul className="phase__list">
                    {[...real, ...undated].map((it) => (
                      <li key={it.m.id} className="phase__item">
                        <div className="phase__row">
                          <RecordLink id={it.m.id} className="phase__name">
                            {it.m.title}
                          </RecordLink>
                          {it.m.data?.optional_future_work && <OptionalTag />}
                        </div>
                        <div className="item__meta">
                          <OwnerChip owner={it.m.owner} proposed={it.m.owner_proposed} compact />
                          <StatusBadge status={it.m.status} small />
                          {it.date ? (
                            <span className="item__when">
                              <DateText date={it.date} today={today} state={it.dateState ?? undefined} />
                              {it.dateKind && <DeadlineBadge kind={it.dateKind} />}
                            </span>
                          ) : (
                            <DateText date={null} />
                          )}
                        </div>
                        <Chain itemKey={it.m.key} idx={idx} />
                      </li>
                    ))}
                    {[...reviewsByDate.entries()].map(([date, group]) =>
                      group.length >= 2 ? (
                        <li key={`rv-${date}`} className="phase__item phase__item--review">
                          <details className="review-summary">
                            <summary>
                              <Icon name="chevron-right" size={16} className="review-summary__chev" />
                              <span>
                                <strong>Proposed review checkpoint</strong>
                                <span className="faint">
                                  {' '}
                                  · {plural(group.length, 'item')} · {civil(date, 'short')} · not yet scheduled
                                </span>
                              </span>
                            </summary>
                            <p className="small muted">A moment to look at these again together. It is not a deadline.</p>
                            <ul className="review-summary__list">
                              {group.map((g) => (
                                <li key={g.m.id}>
                                  <RecordLink id={g.m.id}>{g.m.title}</RecordLink>
                                  <span className="faint small"> · {WORK_STATUS_LABEL[g.m.status as WorkStatus] ?? g.m.status}</span>
                                  <Chain itemKey={g.m.key} idx={idx} />
                                </li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      ) : (
                        group.map((it) => (
                          <li key={it.m.id} className="phase__item">
                            <div className="phase__row">
                              <RecordLink id={it.m.id} className="phase__name">
                                {it.m.title}
                              </RecordLink>
                            </div>
                            <div className="item__meta">
                              <OwnerChip owner={it.m.owner} compact />
                              <StatusBadge status={it.m.status} small />
                              <span className="item__when">
                                <DateText date={it.date} today={today} />
                                <DeadlineBadge kind="review_date" />
                              </span>
                            </div>
                            <Chain itemKey={it.m.key} idx={idx} />
                          </li>
                        ))
                      ),
                    )}
                  </ul>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Everything with a date, in date order</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What</th>
                  <th scope="col">Who</th>
                  <th scope="col">Kind of date</th>
                </tr>
              </thead>
              <tbody>
                {dated.map((it) => (
                  <tr key={it.m.id}>
                    <td>
                      <DateText date={it.date} today={today} state={it.dateState ?? undefined} />
                    </td>
                    <th scope="row">
                      <RecordLink id={it.m.id}>{it.m.title}</RecordLink>
                    </th>
                    <td>
                      <OwnerChip owner={it.m.owner} compact />
                    </td>
                    <td>{it.dateKind && <DeadlineBadge kind={it.dateKind} />}</td>
                  </tr>
                ))}
                {dated.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Nothing in this view has a firm date yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {reviewOnly.length > 0 && (
              <p className="small muted table-foot">
                {plural(reviewOnly.length, 'more item')} only {reviewOnly.length === 1 ? 'has' : 'have'} a proposed review checkpoint, which is not a deadline.{' '}
                <Link to="/plan?view=list">See them in the list</Link>
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
