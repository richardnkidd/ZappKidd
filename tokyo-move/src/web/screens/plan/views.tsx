import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router';
import { PHASE_LABEL, ANCHOR_CONFIDENCE_LABEL } from '@shared/labels';
import type { AnchorData, HouseholdSettings, WorkStatus } from '@shared/types';
import { AnchorDialog } from '../../components/AnchorDialog';
import { DateText, DeadlineBadge, OptionalTag, StatusBadge } from '../../components/Badges';
import { Button, SegmentedControl } from '../../components/Controls';
import { Disclosure } from '../../components/Disclosure';
import { Icon } from '../../components/Icon';
import { ItemCard } from '../../components/ItemCard';
import { Card, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { displayNext, displayTitle, keyLookup, stripCodes, type KeyLookup } from '@shared/plain';
import { dateLineText } from '../../lib/dateLine';
import { plural } from '../../lib/format';
import { departureAnchors, travelSummary } from '../../lib/gantt';
import { groupByStatus, groupPlan, nextToDo, sortForGroup, sortPlanItems, splitByDate, type PlanItemData } from '../../lib/plan';
import { dataOf, isOpenWork, type Directory, type Indexes } from '../../lib/records';
import { GanttChart } from './Gantt';

/* ------------------------------------------------------------------ shared */

function useLookup(idx: Indexes) {
  return useMemo(() => keyLookup(idx.byKey), [idx]);
}

/** One slim row: title, next step, date and person. Status is a quiet icon, only when it says something (not for "planned"). */
function PlanItemCard({ it, today, lookup, showStatus = true }: { it: PlanItemData; today: string; lookup: KeyLookup | undefined; showStatus?: boolean }) {
  const { m } = it;
  // A check-in is a reminder to look again. It never reads as a deadline, so it is told in words, never "N days late".
  const checkIn = it.when.primary?.kind === 'review_date' ? it.when.primary : null;
  return (
    <ItemCard
      recordId={m.id}
      title={displayTitle(m, lookup)}
      owner={m.owner}
      ownerProposed={m.owner_proposed}
      nextAction={displayNext(m, lookup)}
      status={m.status}
      showStatus={showStatus && m.status !== 'planned'}
      when={checkIn ? undefined : it.when}
      note={checkIn ? `Check-in ${dateLineText(checkIn.date, today, { open: false })}` : undefined}
      today={today}
      optional={m.data?.optional_future_work}
      tone={m.status === 'blocked' ? 'blocked' : 'default'}
    />
  );
}

/* ------------------------------------------------------------------ list (grouped; the default) */

/**
 * Groups, each a heading with a count. Every group starts closed except the one that holds the next thing to do
 * (or all of them, when a filter has left only a few items). Inside a group, past-due items come first.
 */
export function WorkstreamView({ items, idx, today, filtered = false }: { items: PlanItemData[]; idx: Indexes; today: string; filtered?: boolean }) {
  const lookup = useLookup(idx);
  const { groups, nextId } = useMemo(() => {
    const sorted = sortPlanItems(items, 'date', (o) => o ?? '');
    const g = groupPlan(sorted, idx).groups.map((x) => ({ ...x, items: sortForGroup(x.items, today) }));
    return { groups: g, nextId: nextToDo(items, today)?.m.id ?? null };
  }, [items, idx, today]);
  return (
    <div className="stack grid-wide grid-wide--2">
      {groups.map((g) => {
        const open = g.items.filter((i) => isOpenWork(i.m.status));
        const blocked = g.items.filter((i) => i.m.status === 'blocked').length;
        const closed = g.items.filter((i) => !isOpenWork(i.m.status));
        const hasNext = nextId !== null && g.items.some((i) => i.m.id === nextId);
        return (
          <Disclosure
            key={`${g.key || 'other'}-${filtered ? 'f' : 'a'}`}
            title={g.title}
            meta={`${open.length} to do${blocked ? ` · ${blocked} blocked` : ''}`}
            defaultOpen={hasNext || filtered}
          >
            {open.length > 0 ? (
              <ul className="item-list">
                {open.map((it) => (
                  <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} />
                ))}
              </ul>
            ) : (
              <p className="muted">All finished or set aside.</p>
            )}
            {closed.length > 0 && (
              <Disclosure title="Finished or set aside" meta={String(closed.length)} level={4} className="disclosure--flat">
                <ul className="item-list">
                  {closed.map((it) => (
                    <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} />
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

/* ------------------------------------------------------------------ by date */

/**
 * "By date": what is past its date, then what is coming up, then what has no date yet.
 * This is where Home's "Coming up" and "Past their date" links land: `/plan?view=list`.
 */
export function ListView({ items, idx, today }: { items: PlanItemData[]; idx: Indexes; today: string }) {
  const lookup = useLookup(idx);
  const parts = useMemo(() => splitByDate(items, today), [items, today]);
  const block = (id: string, title: string, list: PlanItemData[]) =>
    list.length === 0 ? null : (
      <Section title={title} count={list.length} headingLevel={3} className={`bydate bydate--${id}`}>
        <ul className="item-list">
          {list.map((it) => (
            <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} />
          ))}
        </ul>
      </Section>
    );
  return (
    <div className="bydate-wrap stack stack--loose">
      {block('past', 'Past their date', parts.past)}
      {block('coming', 'Coming up', parts.coming)}
      {block('undated', 'No date yet', parts.undated)}
      {parts.closed.length > 0 && (
        <Disclosure title="Finished or set aside" meta={String(parts.closed.length)}>
          <ul className="item-list">
            {parts.closed.map((it) => (
              <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ board */

const BOARD_MAIN: WorkStatus[] = ['planned', 'in_progress', 'blocked', 'waiting_external', 'completed'];
const COLUMN_CAP = 8;

export function BoardView({
  items,
  idx,
  today,
  expanded,
  setExpanded,
}: {
  items: PlanItemData[];
  idx: Indexes;
  today: string;
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const lookup = useLookup(idx);
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
                    <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} showStatus={false} />
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
              <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} />
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
        <span className="lane__what">{stripCodes(d.meaning ?? a.title)}</span>
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
  const lookup = useLookup(idx);

  return (
    <div className="stack stack--loose">
      <TravelDates idx={idx} dir={dir} settings={settings} />
      <Section
        title="When things happen"
        headingLevel={2}
        intro={view === 'chart' ? 'Bars show when work happens. Only a solid bar ends at a real date.' : undefined}
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
                      <RecordLink id={it.m.id}>{displayTitle(it.m, lookup)}</RecordLink>
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
                {undated.length > 0 && <>{plural(undated.length, 'item')} {undated.length === 1 ? 'has' : 'have'} no date yet. </>}
                {reviewOnly.length > 0 && (
                  <>
                    {plural(reviewOnly.length, 'item')} only {reviewOnly.length === 1 ? 'has' : 'have'} a check-in, which is not a deadline.{' '}
                  </>
                )}
                <Link to="/plan?view=list">See them by date</Link>
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
