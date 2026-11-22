import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router';
import { PHASE_LABEL, ANCHOR_CONFIDENCE_LABEL } from '@shared/labels';
import type { AnchorData, HouseholdSettings, WorkStatus } from '@shared/types';
import { AnchorDialog } from '../../components/AnchorDialog';
import { DateText, DeadlineBadge, OptionalTag, StatusBadge } from '../../components/Badges';
import { Button, Field, SegmentedControl, Select } from '../../components/Controls';
import { Disclosure } from '../../components/Disclosure';
import { Icon } from '../../components/Icon';
import { ItemCard } from '../../components/ItemCard';
import { Card, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge, usePlain } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { civil, plural } from '../../lib/format';
import { departureAnchors, travelSummary } from '../../lib/gantt';
import { groupByStatus, groupPlan, sortPlanItems, type PlanItemData, type SortKey } from '../../lib/plan';
import { dataOf, isOpenWork, type Directory, type Indexes } from '../../lib/records';
import { GanttChart } from './Gantt';

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
      when={it.when}
      today={today}
      optional={m.data?.optional_future_work}
      tone={m.status === 'blocked' ? 'blocked' : 'default'}
    />
  );
}

/* ------------------------------------------------------------------ by workstream */

export function WorkstreamView({ items, idx, today }: { items: PlanItemData[]; idx: Indexes; today: string }) {
  const { mode, groups } = useMemo(() => {
    const sorted = sortPlanItems(items, 'date', (o) => o ?? '');
    return groupPlan(sorted, idx);
  }, [items, idx]);
  return (
    <div className="stack grid-wide grid-wide--2" aria-label={mode === 'area' ? 'Areas of work' : 'Workstreams'}>
      {mode === 'area' && <p className="small muted">Grouped by the kind of work. Every group starts closed; the counts say what is still to do.</p>}
      {groups.map((g) => {
        const open = g.items.filter((i) => isOpenWork(i.m.status));
        const blocked = g.items.filter((i) => i.m.status === 'blocked').length;
        const closed = g.items.filter((i) => !isOpenWork(i.m.status));
        return (
          <Disclosure key={g.key || 'other'} title={g.title} meta={`${open.length} to do${blocked ? ` · ${blocked} blocked` : ''}`}>
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
                  <DateText date={date} today={today} state={dateState ?? undefined} kind={dateKind} />
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

type AnchorRecord = Indexes['anchors'][number];

/** Each traveler's own dates, with the editor. Moving one person's date never moves another's. */
function TravelLanes({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const [editing, setEditing] = useState<AnchorRecord | null>(null);
  const forPerson = (id: string) => idx.anchors.filter((a) => dataOf<AnchorData>(a).traveler === id);
  const helpers = idx.anchors.filter((a) => dataOf<AnchorData>(a).traveler === 'household' || dataOf<AnchorData>(a).coordination_only);
  const row = (a: AnchorRecord) => {
    const d = dataOf<AnchorData>(a);
    return (
      <li key={a.id} className="lane__row">
        <span className="lane__what">{d.meaning ?? a.title}</span>
        <span className="lane__when">
          <DateText date={d.date ?? null} />
          {d.confidence && d.confidence !== 'awaiting' && <span className="chip chip--neutral chip--sm">{ANCHOR_CONFIDENCE_LABEL[d.confidence] ?? d.confidence}</span>}
          <Button variant="quiet" small icon="pencil" onClick={() => setEditing(a)} aria-label={`${d.date ? 'Change' : 'Set'} date: ${d.meaning ?? a.title}`}>
            {d.date ? 'Change' : 'Set date'}
          </Button>
        </span>
      </li>
    );
  };
  return (
    <>
      <p className="small muted">Each traveler has their own dates. Moving one person's date never moves another's.</p>
      <div className="lanes">
        {dir.people.map((p) => {
          const rows = forPerson(p.id).filter((a) => !dataOf<AnchorData>(a).coordination_only);
          return (
            <Card as="section" key={p.id} className="lane" aria-label={`${p.display_name}'s dates`}>
              <h4 className="lane__title">
                <PersonBadge person={p} size={26} /> {p.display_name}
              </h4>
              {rows.length > 0 ? <ul>{rows.map(row)}</ul> : <p className="faint">No dates recorded yet.</p>}
            </Card>
          );
        })}
      </div>
      {editing && <AnchorDialog record={editing} onClose={() => setEditing(null)} />}
      {helpers.length > 0 && (
        <Disclosure title="Household helper dates" level={4} className="disclosure--flat">
          <p className="small muted">Used only to coordinate. They never decide any one person's legal deadlines.</p>
          <ul>{helpers.map(row)}</ul>
        </Disclosure>
      )}
    </>
  );
}

/** "Travel dates", closed by default, with a one-line summary of what is and is not set. */
function TravelDates({ idx, dir, settings }: { idx: Indexes; dir: Directory; settings: TimelineSettings }) {
  const target = settings?.planning_target ?? null;
  const summary = useMemo(
    () => travelSummary(departureAnchors(idx.anchors.map((a) => dataOf<AnchorData>(a)), dir.people), dir.people, target),
    [idx, dir, target],
  );
  if (idx.anchors.every((a) => !dataOf<AnchorData>(a).code)) return null;
  return (
    <Disclosure title="Travel dates" meta={summary} className="travel-dates">
      <TravelLanes idx={idx} dir={dir} />
    </Disclosure>
  );
}

type TimelineSettings = Pick<HouseholdSettings, 'plan_baseline' | 'planning_target'> | null | undefined;

export function TimelineView({ items, idx, dir, today, settings }: { items: PlanItemData[]; idx: Indexes; dir: Directory; today: string; settings?: TimelineSettings }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const dated = useMemo(
    () => sortPlanItems(items.filter((i) => i.date && i.dateKind !== 'review_date'), 'date', (o) => o ?? ''),
    [items],
  );
  const reviewOnly = items.filter((i) => i.dateKind === 'review_date');
  const undated = items.filter((i) => !i.date);

  return (
    <div className="stack stack--loose">
      <TravelDates idx={idx} dir={dir} settings={settings} />
      <Section
        title="When things happen"
        headingLevel={2}
        intro={view === 'chart' ? 'Bars show when work happens. Only a solid bar ends at a real date.' : 'Everything that has a date, in date order. The chart shows the rest by their phase.'}
        action={
          <SegmentedControl
            label="Timeline layout"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        }
      >
        {view === 'chart' ? (
          <GanttChart items={items} idx={idx} dir={dir} today={today} baselineOn={settings?.plan_baseline?.baseline_on ?? null} target={settings?.planning_target ?? null} />
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
            {(reviewOnly.length > 0 || undated.length > 0) && (
              <p className="small muted table-foot">
                {undated.length > 0 && <>{plural(undated.length, 'more item')} {undated.length === 1 ? 'has' : 'have'} no date yet; the chart shows where their phase puts them. </>}
                {reviewOnly.length > 0 && (
                  <>
                    {plural(reviewOnly.length, 'item')} only {reviewOnly.length === 1 ? 'has' : 'have'} a proposed review checkpoint, which is not a deadline.{' '}
                  </>
                )}
                <Link to="/plan?view=list">See them in the list</Link>
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
