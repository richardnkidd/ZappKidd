import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Link } from 'react-router';
import { ANCHOR_CONFIDENCE_LABEL, WORK_STATUS_LABEL } from '@shared/labels';
import type { AnchorData, HouseholdSettings, WorkStatus } from '@shared/types';
import { AnchorDialog } from '../../components/AnchorDialog';
import { DateText, DeadlineBadge, OptionalTag, StatusBadge } from '../../components/Badges';
import { Button, SegmentedControl } from '../../components/Controls';
import { Disclosure } from '../../components/Disclosure';
import { waitingOnText } from '../../lib/home';
import { DoneButton, useDoneWithUndo, type DoneWithUndo } from '../../components/DoneWithUndo';
import { Icon } from '../../components/Icon';
import { ItemCard } from '../../components/ItemCard';
import { Card, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { displayNext, displayTitle, keyLookup, stripCodes, type KeyLookup } from '@shared/plain';
import { checkInLineText } from '../../lib/dateLine';
import { plural } from '../../lib/format';
import { departureAnchors, travelSummary } from '../../lib/gantt';
import { groupByStatus, groupPlan, nextToDo, sortForGroup, sortPlanItems, splitByDate, type PlanItemData } from '../../lib/plan';
import { dataOf, isOpenWork, type Directory, type Indexes } from '../../lib/records';
import { ShowAllList } from '../arrival/ShowAll';
import { GanttChart } from './Gantt';
import { ownerDisputed } from './ownerNote';
import { PlanGroup } from './PlanGroup';
import { useNarrow } from './useNarrow';

/* ------------------------------------------------------------------ shared */

/** Rows a group, section or column shows before "Show all (N)". */
const FIRST = 5;

function useLookup(idx: Indexes) {
  return useMemo(() => keyLookup(idx.byKey), [idx]);
}

const capital = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/**
 * One slim row: title, next step, date and person. Status is a quiet icon, only when it says something (not for
 * "planned"). A stuck item adds one line saying what it waits on, in the same words Home uses. `slim` drops the next
 * step, for the board, where a card is a title and one line.
 */
function PlanItemCard({ it, today, lookup, idx, showStatus = true, done, slim = false }: { it: PlanItemData; today: string; lookup: KeyLookup | undefined; idx: Indexes; showStatus?: boolean; done?: DoneWithUndo; slim?: boolean }) {
  const { m } = it;
  const title = displayTitle(m, lookup);
  // A check-in is a reminder to look again, so it is told with the word "Check-in" in the one date format.
  const checkIn = it.when.primary?.kind === 'review_date' ? it.when.primary : null;
  const waitingOn = m.status === 'blocked' ? waitingOnText(m, idx, lookup) : null;
  return (
    <ItemCard
      recordId={m.id}
      title={title}
      owner={m.owner}
      ownerProposed={ownerDisputed(m)}
      nextAction={slim ? null : displayNext(m, lookup)}
      status={m.status}
      showStatus={showStatus && m.status !== 'planned'}
      when={checkIn || !it.when.primary ? undefined : it.when}
      note={checkIn ? checkInLineText(checkIn.date, today) : undefined}
      today={today}
      optional={m.data?.optional_future_work}
      tone={m.status === 'blocked' ? 'blocked' : 'default'}
      className="plan-card"
      action={
        done && isOpenWork(m.status) ? (
          <DoneButton
            title={title}
            disabled={done.busyId !== null}
            busy={done.busyId === m.id}
            onClick={() => void done.markDone({ recordId: m.id, version: m.version, title })}
          />
        ) : undefined
      }
    >
      {m.status === 'blocked' && <p className="item__why">{waitingOn ? `Waiting on: ${capital(waitingOn)}` : 'No reason written yet'}</p>}
    </ItemCard>
  );
}

/* ------------------------------------------------------------------ list (grouped; the default) */

/**
 * Groups, each a heading with a count. Every group starts closed except the first one that has unfinished items (or
 * all of them, when a filter has left only a few items). An open group shows five rows and then "Show all (N)".
 * Inside a group, past-due items come first. Open or closed is remembered for the session only.
 */
export function WorkstreamView({ items, idx, today, filtered = false, focusRef }: { items: PlanItemData[]; idx: Indexes; today: string; filtered?: boolean; focusRef: RefObject<HTMLElement | null> }) {
  const lookup = useLookup(idx);
  const done = useDoneWithUndo(focusRef);
  const groups = useMemo(() => {
    const sorted = sortPlanItems(items, 'date', (o) => o ?? '');
    return groupPlan(sorted, idx).groups.map((x) => ({ ...x, items: sortForGroup(x.items, today) }));
  }, [items, idx, today]);
  const firstWithWork = groups.find((g) => g.items.some((i) => isOpenWork(i.m.status)))?.key ?? null;
  const scope = filtered ? 'f' : 'a';
  return (
    <div className="stack grid-wide grid-wide--2">
      <div className="plan-done-note">{done.note}</div>
      {groups.map((g) => {
        const open = g.items.filter((i) => isOpenWork(i.m.status));
        const blocked = g.items.filter((i) => i.m.status === 'blocked').length;
        const closed = g.items.filter((i) => !isOpenWork(i.m.status));
        const card = (it: PlanItemData, doneHook?: DoneWithUndo) => <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} idx={idx} done={doneHook} />;
        return (
          <PlanGroup
            key={`${scope}:${g.key || 'other'}`}
            id={`list:${scope}:${g.key || 'other'}`}
            title={g.title}
            count={open.length}
            countLabel="to do"
            note={blocked ? (blocked === open.length ? 'all stuck' : `${blocked} stuck`) : undefined}
            defaultOpen={filtered || g.key === firstWithWork}
          >
            {open.length > 0 ? <ShowAllList first={FIRST} rows={open.map((it) => card(it, done))} label={`in ${g.title}`} /> : <p className="muted">All finished or set aside.</p>}
            {closed.length > 0 && (
              <PlanGroup id={`closed:${scope}:${g.key || 'other'}`} title="Finished or set aside" count={closed.length} defaultOpen={false} headingLevel={4} className="pgroup--flat">
                <ShowAllList first={FIRST} rows={closed.map((it) => card(it))} label="finished or set aside" />
              </PlanGroup>
            )}
          </PlanGroup>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ by date */

/**
 * "By date": what is past its date, then what is coming up, then what has no date yet. Each part shows five rows and
 * then "Show all (N)". This is where Home's "Coming up" and "Past their date" links land: `/plan?view=list`.
 */
export function ListView({ items, idx, today, focusRef }: { items: PlanItemData[]; idx: Indexes; today: string; focusRef: RefObject<HTMLElement | null> }) {
  const lookup = useLookup(idx);
  const done = useDoneWithUndo(focusRef);
  const parts = useMemo(() => splitByDate(items, today), [items, today]);
  const card = (it: PlanItemData, withDone: boolean) => <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} idx={idx} done={withDone ? done : undefined} />;
  const block = (id: string, title: string, list: PlanItemData[]) =>
    list.length === 0 ? null : (
      <Section title={title} count={list.length} headingLevel={3} className={`bydate bydate--${id}`}>
        <ShowAllList first={FIRST} rows={list.map((it) => card(it, true))} label={title.toLowerCase()} />
      </Section>
    );
  return (
    <div className="bydate-wrap stack stack--loose">
      <div className="plan-done-note">{done.note}</div>
      {block('past', 'Past their date', parts.past)}
      {block('coming', 'Coming up', parts.coming)}
      {parts.undated.length > 0 && (
        // Work with no date is the quietest part: it starts closed unless nothing else is listed.
        <PlanGroup id="bydate:undated" title="No date yet" count={parts.undated.length} defaultOpen={parts.past.length + parts.coming.length === 0} className="bydate bydate--undated">
          <ShowAllList first={FIRST} rows={parts.undated.map((it) => card(it, true))} label="no date yet" />
        </PlanGroup>
      )}
      {parts.closed.length > 0 && (
        <PlanGroup id="bydate:closed" title="Finished or set aside" count={parts.closed.length} defaultOpen={false}>
          <ShowAllList first={FIRST} rows={parts.closed.map((it) => card(it, false))} label="finished or set aside" />
        </PlanGroup>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ board */

const BOARD_MAIN: WorkStatus[] = ['planned', 'in_progress', 'blocked', 'waiting_external', 'completed'];

/**
 * One column for each status. A card is its title and one line (date and person); a stuck card adds what it waits on.
 * Each column shows five cards and then "Show all (N)".
 */
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
  const closedOnes = [...(byStatus.get('eliminated') ?? []), ...(byStatus.get('not_applicable') ?? [])];
  const narrow = useNarrow();
  const openColumn = (byStatus.get('in_progress')?.length ?? 0) > 0 ? 'in_progress' : (BOARD_MAIN.find((st) => (byStatus.get(st)?.length ?? 0) > 0) ?? 'planned');
  return (
    <div className="stack">
      <div className="board">
        {BOARD_MAIN.map((s) => {
          const list = byStatus.get(s) ?? [];
          const cards = (
            <ShowAllList
              className="item-list item-list--compact"
              first={FIRST}
              all={Boolean(expanded[s])}
              onAll={() => setExpanded((e) => ({ ...e, [s]: true }))}
              label={`in ${WORK_STATUS_LABEL[s]}`}
              rows={list.map((it) => (
                <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} idx={idx} showStatus={false} slim />
              ))}
            />
          );
          // On a phone the columns stack, so each heading is a button and only one column starts open: the one with
          // work being done, else the first with anything in it. Beside each other (wider screens) they all show.
          if (narrow && list.length > 0) {
            return (
              <section key={s} className={`board-col board-col--${s}`}>
                <PlanGroup id={`board:${s}`} title={<StatusBadge status={s} />} count={list.length} defaultOpen={s === openColumn} className="pgroup--flat">
                  {cards}
                </PlanGroup>
              </section>
            );
          }
          return (
            <section key={s} className={`board-col board-col--${s}`} aria-labelledby={`col-${s}`}>
              <h3 id={`col-${s}`} className="board-col__title">
                <StatusBadge status={s} />
                <span className="count">{list.length}</span>
              </h3>
              {list.length === 0 ? <p className="faint small board-col__empty">Nothing here.</p> : cards}
            </section>
          );
        })}
      </div>
      {closedOnes.length > 0 && (
        <PlanGroup id="board:closed" title="Dropped or not needed" count={closedOnes.length} defaultOpen={false}>
          <ShowAllList
            className="item-list item-list--compact"
            first={FIRST}
            label="dropped or not needed"
            rows={closedOnes.map((it) => (
              <PlanItemCard key={it.m.id} it={it} today={today} lookup={lookup} idx={idx} slim />
            ))}
          />
        </PlanGroup>
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
  const [allRows, setAllRows] = useState(false);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const revealed = useRef(false);
  useEffect(() => {
    if (!allRows || !revealed.current) return;
    revealed.current = false;
    bodyRef.current?.rows[FIRST]?.querySelector<HTMLElement>('a[href]')?.focus();
  }, [allRows]);
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
              <tbody ref={bodyRef}>
                {(allRows ? dated : dated.slice(0, FIRST)).map((it) => (
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
            {!allRows && dated.length > FIRST && (
              <div>
                <Button variant="quiet" className="show-all" onClick={() => {
                    revealed.current = true;
                    setAllRows(true);
                  }}>
                  Show all ({dated.length})
                </Button>
              </div>
            )}
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
