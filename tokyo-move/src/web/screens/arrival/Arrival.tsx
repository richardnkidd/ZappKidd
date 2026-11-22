import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { ARRIVAL_WINDOW_LABEL, ARRIVAL_WINDOW_ORDER, ANCHOR_CONFIDENCE_LABEL, CADENCE_LABEL } from '@shared/labels';
import type { AnchorData, ArrivalData, DeadlineRuleData, HorizonData, PropertyData, WorkStatus } from '@shared/types';
import { DateText, DeadlineBadge, DeadlineWhen, StatusBadge, VerificationNote } from '../../components/Badges';
import { InfoNote } from '../../components/InfoNote';
import { More } from '../../components/More';
import { displayNext, displayTitle, keyLookup, stripCodes, type KeyLookup } from '@shared/plain';
import { ShowAllList } from './ShowAll';
import { AnchorDialog } from '../../components/AnchorDialog';
import { Button, SegmentedControl } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LinkedKeys } from '../../components/LinkedKeys';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { PersonBadge, usePlain } from '../../components/People';
import { ruleOf } from '../../components/DeadlineRow';
import { RecordLink } from '../../components/RecordLink';
import { deadlineVerification } from '../../lib/home';
import { splitTitleAction } from '../../lib/prose';
import { dataOf, isOpenWork, type AnyRecord, type Directory, type Indexes } from '../../lib/records';
import { DoneButton, useDoneWithUndo, type DoneWithUndo } from '../../components/DoneWithUndo';
import { useData } from '../../state/data';
import { loadPref, savePref } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { StatusDialog } from '../record/dialogs';
import { PlanGroup } from '../plan/PlanGroup';

/** The traveler's own arrival-side anchor codes (arrival, residence, health and pension eligibility). */
export function arrivalSideCodes(dir: Directory, personId: string): Set<string> {
  const p = dir.personById(personId);
  const codes = new Set<string>();
  if (!p) return codes;
  for (const k of ['arrival', 'residence', 'health_eligibility', 'pension_eligibility'] as const) {
    const c = p.anchors?.[k];
    if (c) codes.add(c);
  }
  return codes;
}

/** Arrival checks that apply to a traveler, with that traveler's own progress when the record has it. */
export function arrivalFor(idx: Indexes, personId: string) {
  return idx.all
    .filter((r) => r.type === 'arrival')
    .filter((r) => {
      const scope = dataOf<ArrivalData>(r).traveler_scope ?? [];
      return scope.length === 0 || scope.includes(personId);
    })
    .map((r) => {
      const d = dataOf<ArrivalData & { traveler_progress?: Record<string, { status: WorkStatus; reason: string | null }> }>(r);
      const own = d.traveler_progress?.[personId];
      return { record: r, data: d, status: (own?.status ?? r.status) as WorkStatus, reason: own?.reason ?? d.status_reason ?? null, shared: (d.traveler_scope ?? []).length > 1 };
    });
}

const norm = (t: string) => t.trim().replace(/[.\s]+$/, '').toLowerCase();

/** A step shows its title, its next step and one date line. Anything longer sits behind "Details". */
const LONG_NEXT = 140;

/** A section heading in plain words: the known label, else the raw key made readable. */
function windowTitle(key: string): string {
  const known = ARRIVAL_WINDOW_LABEL[key];
  if (known) return known;
  const words = stripCodes(key.replace(/[_/]+/g, ' ')).replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other';
}

function ArrivalItem({ item, personId, today, lookup, markShared, done }: { item: ReturnType<typeof arrivalFor>[number]; personId: string; today: string; lookup: KeyLookup | undefined; markShared: boolean; done: DoneWithUndo }) {
  const plain = usePlain();
  const [open, setOpen] = useState(false);
  const d = item.data;
  const split = splitTitleAction(displayTitle(item.record, lookup), d.action ? plain(d.action) : null);
  const next = displayNext(item.record, lookup) ?? (split.detail ? stripCodes(split.detail, lookup) : null);
  // The next step is read in two lines; when it is longer, the whole text is also behind "Details".
  const nextInDetails = next && next.length > LONG_NEXT ? next : null;
  const trigger = d.trigger && norm(d.trigger) !== norm(item.record.title) && norm(d.trigger) !== norm(d.action ?? '') ? d.trigger : null;
  const reason = item.reason && item.status !== 'planned' && norm(item.reason) !== norm(d.action ?? '') ? item.reason : null;
  const hasMore = Boolean(nextInDetails || trigger || reason || d.review_note);
  const showShared = markShared && item.shared;
  return (
    <li className="step">
      <div className="row-1">
        <span className="row-1__icon">
          <StatusBadge status={item.status} small />
        </span>
        <div className="row-1__main">
          <RecordLink id={item.record.id} className="item__title">
            {split.title}
          </RecordLink>
          {next && (
            <p className="item__action item__action--clamp step__next" style={{ '--clamp-lines': 2 } as CSSProperties}>
              {next}
            </p>
          )}
          {(d.deadline || showShared) && (
            <p className="step__meta small">
              {d.deadline && (
                <span className="item__when">
                  <DateText date={d.deadline.date} today={today} kind={d.deadline.kind} />
                  <DeadlineBadge kind={d.deadline.kind} />
                </span>
              )}
              {showShared && <span className="muted">Shared</span>}
            </p>
          )}
        </div>
        <span className="row-1__side step__actions">
          {isOpenWork(item.status) && (
            <DoneButton
              title={split.title}
              disabled={done.busyId !== null}
              busy={done.busyId === item.record.id}
              onClick={() => void done.markDone({ recordId: item.record.id, version: item.record.version, title: split.title, traveler: item.shared ? personId : null })}
            />
          )}
          <Button variant="quiet" small onClick={() => setOpen(true)} aria-label={`Update status: ${split.title}`}>
            Update
          </Button>
        </span>
      </div>
      {hasMore && (
        <More label="Details" hint={split.title}>
          <div className="stack stack--tight">
            {nextInDetails && <p className="preline">{nextInDetails}</p>}
            {trigger && <p className="small muted">When: {stripCodes(plain(trigger), lookup)}</p>}
            {reason && <p className="small muted preline">{stripCodes(plain(reason), lookup)}</p>}
            {d.review_note && <p className="small preline">{stripCodes(plain(d.review_note), lookup)}</p>}
          </div>
        </More>
      )}
      {open && <StatusDialog open onClose={() => setOpen(false)} record={item.record} traveler={item.shared ? personId : null} currentStatus={item.status} />}
    </li>
  );
}

/**
 * One dated rule as a short row: what it is, the date, and how far it can be trusted. The condition and the way it is
 * counted sit behind "Details", so a long rule never fills the page.
 */
function ArrivalDateRow({ d, idx, today, lookup }: { d: ComputedDeadline; idx: Indexes; today: string; lookup: KeyLookup | undefined }) {
  const plain = usePlain();
  const rule = ruleOf(d, idx);
  const rd = rule ? dataOf<DeadlineRuleData>(rule) : null;
  const verification = deadlineVerification(d, idx);
  const label = stripCodes(plain(d.label), lookup);
  const target = rule?.id ?? d.record_id ?? null;
  const condition = rd?.applies_when && d.applies !== 'yes' ? rd.applies_when : null;
  const counted = rd?.inclusive_note ?? null;
  const hasMore = Boolean(condition || counted || d.approximate);
  return (
    <li className="step">
      <div className="row-1">
        <div className="row-1__main">
          {target ? (
            <RecordLink id={target} className="item__title">
              {label}
            </RecordLink>
          ) : (
            <span className="item__title">{label}</span>
          )}
          <p className="step__meta small">
            <span className="item__when">
              <DeadlineWhen d={d} today={today} />
              <DeadlineBadge kind={d.kind} />
            </span>
          </p>
          <VerificationNote verification={verification} kind={d.kind} />
        </div>
      </div>
      {hasMore && (
        <More label="Details" hint={label}>
          <div className="stack stack--tight">
            {condition && <p className="small muted preline">{stripCodes(plain(condition), lookup)}</p>}
            {counted && <p className="small muted preline">{stripCodes(plain(counted), lookup)}</p>}
            {d.approximate && <p className="small muted">Approximate. Holidays are not counted.</p>}
          </div>
        </More>
      )}
    </li>
  );
}

/** The dated rules that start at this traveler's arrival, or a note that the dates could not be worked out. */
function useArrivalDates(person: string, idx: Indexes, dir: Directory): { ok: true; rows: ComputedDeadline[] } | { ok: false } {
  const { deadlines } = useData();
  const codes = useMemo(() => arrivalSideCodes(dir, person), [dir, person]);
  if (!deadlines.ok) return { ok: false };
  const rows = deadlines.value.filter((d) => {
    if (d.applies === 'no' || d.state === 'met' || d.state === 'not_applicable' || d.traveler !== person) return false;
    if (d.source === 'rule') {
      const rule = d.rule_id ? (idx.byKey.get(d.rule_id) ?? null) : null;
      const anchor = rule ? dataOf<DeadlineRuleData>(rule).anchor : null;
      return anchor ? codes.has(anchor) : false;
    }
    return d.source === 'record' && Boolean(d.record_id?.startsWith('arrival:'));
  });
  return { ok: true, rows };
}

function AfterArrivalDeadlines({ dates, idx, lookup }: { dates: ReturnType<typeof useArrivalDates>; idx: Indexes; lookup: KeyLookup | undefined }) {
  const { today } = useData();
  const { refresh } = useSnapshot();
  if (!dates.ok) {
    return (
      <ErrorBanner title="We couldn't work out these dates just now." onRetry={() => void refresh()}>
        Everything else on this page still works.
      </ErrorBanner>
    );
  }
  if (dates.rows.length === 0) return <p className="muted">Nothing dated yet.</p>;
  return <ShowAllList className="step-list" rows={dates.rows.map((d) => <ArrivalDateRow key={d.id} d={d} idx={idx} today={today} lookup={lookup} />)} label="dated rules" />;
}

/* ------------------------------------------------------------------ household sections */

export function PropertyCard({ record, idx, headingLevel = 3 }: { record: AnyRecord; idx: Indexes; headingLevel?: 2 | 3 }) {
  const d = dataOf<PropertyData>(record);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const title = displayTitle(record, lookup);
  const context = d.known_context ? stripCodes(d.known_context, lookup) : null;
  const longContext = context && context.length > LONG_NEXT ? context : null;
  const hasMore = Boolean(longContext || d.people_resources || d.evidence_status || d.evidence_caution || (d.milestone_links ?? []).length > 0);
  return (
    <Card as="article" className="property" aria-labelledby={`pr-${record.key}`}>
      <H id={`pr-${record.key}`} className="doc__title">
        {title}
      </H>
      {context && (
        <p className="item__action item__action--clamp" style={{ '--clamp-lines': 2 } as CSSProperties}>
          {context}
        </p>
      )}
      {hasMore && (
        <More label="More" hint={title}>
          <div className="stack stack--tight">
            {longContext && <p className="preline">{longContext}</p>}
            <dl className="facts facts--tight">
              {d.people_resources && (
                <div className="fact">
                  <dt>Who can help</dt>
                  <dd className="preline">{stripCodes(d.people_resources, lookup)}</dd>
                </div>
              )}
              {d.evidence_status && (
                <div className="fact">
                  <dt>What we have checked</dt>
                  <dd className="preline">{stripCodes(d.evidence_status, lookup)}</dd>
                </div>
              )}
              {d.evidence_caution && (
                <div className="fact fact--wide">
                  <dt>Take care</dt>
                  <dd className="preline">{stripCodes(d.evidence_caution, lookup)}</dd>
                </div>
              )}
            </dl>
            <LinkedKeys keys={d.milestone_links} idx={idx} label="Linked work" />
          </div>
        </More>
      )}
    </Card>
  );
}

/** Which person a no-date rule is about: a person id, 'each_adult', or 'household' (shared). */
function ruleAudience(scope: string | undefined, who: string, dir: Directory): 'mine' | 'shared' | 'other' {
  if (!scope || scope === 'household') return 'shared';
  if (scope === 'each_adult') return dir.adults.some((a) => a.id === who) ? 'mine' : 'other';
  return scope === who ? 'mine' : 'other';
}

/** One ongoing item: a plain title, one quiet line, and everything longer behind "Details". */
function ObligationItem({ id, title, meta, details }: { id: string; title: string; meta?: React.ReactNode; details?: React.ReactNode }) {
  return (
    <li className="step">
      <div className="row-1">
        <div className="row-1__main">
          <RecordLink id={id} className="item__title">
            {title}
          </RecordLink>
          {meta && <p className="step__meta small">{meta}</p>}
        </div>
      </div>
      {details && (
        <More label="Details" hint={title}>
          <div className="stack stack--tight">{details}</div>
        </More>
      )}
    </li>
  );
}

/** The rules and ongoing items for one traveler, in the same three lines as everything else. */
function ongoingFor(idx: Indexes, dir: Directory, whoId: string) {
  const rules = idx.rules.filter((r) => r.data?.anchor === 'other' && r.data.applies !== 'no' && !r.data.superseded_by);
  const horizon = idx.all.filter((r) => r.type === 'horizon' && !/^EX/i.test(r.key));
  return {
    rules,
    horizon,
    mine: rules.filter((r) => ruleAudience(r.data?.traveler_scope, whoId, dir) === 'mine'),
    shared: rules.filter((r) => ruleAudience(r.data?.traveler_scope, whoId, dir) === 'shared'),
  };
}

function ContinuingObligations({ idx, dir, who }: { idx: Indexes; dir: Directory; who: { id: string; display_name: string } }) {
  const plain = usePlain();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const { mine, shared, horizon } = ongoingFor(idx, dir, who.id);
  if (mine.length === 0 && shared.length === 0 && horizon.length === 0) {
    return <p className="muted">Nothing listed yet.</p>;
  }
  const ruleRow = (r: (typeof mine)[number]) => {
    const d = dataOf<DeadlineRuleData>(r);
    const when = d.applies_when ? stripCodes(plain(d.applies_when), lookup).replace(/^when\s+/i, '').replace(/\.$/, '') : '';
    return (
      <ObligationItem
        key={r.id}
        id={r.id}
        title={stripCodes(plain(d.label || r.title), lookup)}
        meta={
          <>
            {d.kind && <DeadlineBadge kind={d.kind} />}
            <VerificationNote verification={d.verification ?? 'not_verified'} kind={d.kind} />
          </>
        }
        details={when ? <p className="small muted preline">Applies when {when}.</p> : undefined}
      />
    );
  };
  const horizonRows = horizon.map((h) => {
    const d = dataOf<HorizonData>(h);
    const trigger = d.trigger ? stripCodes(plain(d.trigger), lookup) : '';
    return (
      <ObligationItem
        key={h.id}
        id={h.id}
        title={displayTitle(h, lookup)}
        meta={
          <>
            {d.cadence && <span className="muted">{CADENCE_LABEL[d.cadence] ?? d.cadence}</span>}
            <StatusBadge status={h.status} small />
          </>
        }
        details={
          trigger || d.scope || d.completion_criteria ? (
            <>
              {trigger && <p className="small muted preline">When: {trigger}</p>}
              {d.scope && <p className="small muted preline">{stripCodes(plain(d.scope), lookup)}</p>}
              {d.completion_criteria && <p className="small muted preline">Done when: {stripCodes(plain(d.completion_criteria), lookup)}</p>}
            </>
          ) : undefined
        }
      />
    );
  });
  return (
    <div className="stack">
      {mine.length > 0 && (
        <div>
          <h3 className="group-head">For {who.display_name}</h3>
          <ShowAllList className="step-list" rows={mine.map(ruleRow)} label={`for ${who.display_name}`} />
        </div>
      )}
      {(shared.length > 0 || horizon.length > 0) && (
        <div>
          <h3 className="group-head">Shared by the household</h3>
          <ShowAllList className="step-list" rows={[...horizonRows, ...shared.map(ruleRow)]} label="shared by the household" />
        </div>
      )}
    </div>
  );
}

const RENEWAL = /^(X|L)/i;

type RegisterEntry = { kind: 'anchor'; a: Partial<AnchorData>; rec: AnyRecord; date: string | null } | { kind: 'rule'; d: ComputedDeadline; date: string | null };

function RenewalsRegister({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { deadlines, today } = useData();
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const anchors = idx.anchors.filter((a) => RENEWAL.test(dataOf<AnchorData>(a).code ?? a.key) && !dataOf<AnchorData>(a).coordination_only);
  if (anchors.length === 0) {
    return <p className="muted">Nothing to renew yet.</p>;
  }
  const people = dir.adults.filter((p) => anchors.some((a) => dataOf<AnchorData>(a).traveler === p.id));
  const groups = people.length ? people : dir.adults;
  return (
    <div className="stack">
      {groups.map((p) => {
        const mine = anchors.filter((a) => dataOf<AnchorData>(a).traveler === p.id);
        if (mine.length === 0) return null;
        const codes = new Set(mine.map((a) => dataOf<AnchorData>(a).code ?? a.key));
        const entries: RegisterEntry[] = mine.map((a) => ({ kind: 'anchor' as const, a: dataOf<AnchorData>(a), rec: a, date: dataOf<AnchorData>(a).date ?? null }));
        if (deadlines.ok) {
          for (const d of deadlines.value) {
            if (d.source !== 'rule' || d.traveler !== p.id || d.applies === 'no' || d.state === 'not_applicable') continue;
            const rule = ruleOf(d, idx);
            const anchor = rule ? dataOf<DeadlineRuleData>(rule).anchor : null;
            if (anchor && codes.has(anchor)) entries.push({ kind: 'rule', d, date: d.deadline.date });
          }
        }
        // Oldest first, as a timeline; anything still waiting for a date goes last.
        entries.sort((x, y) => (x.date && y.date ? (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) : x.date ? -1 : y.date ? 1 : 0));
        return (
          <Card key={p.id} as="section" aria-label={`${p.display_name}'s renewals`}>
            <h3 className="lane__title">
              <PersonBadge person={p} size={26} /> {p.display_name}
            </h3>
            <ShowAllList
              className="step-list"
              label={`for ${p.display_name}`}
              rows={entries.map((e) => {
                if (e.kind === 'rule') return <ArrivalDateRow key={e.d.id} d={e.d} idx={idx} today={today} lookup={lookup} />;
                const d = e.a;
                const rec = e.rec;
                return (
                  <li key={rec.id} className="step">
                    <div className="row-1">
                      <div className="row-1__main">
                        <span className="item__title">{stripCodes(d.meaning ?? rec.title, lookup)}</span>
                        <p className="step__meta small">
                          <DateText date={d.date ?? null} today={today} />
                          {d.confidence && d.confidence !== 'awaiting' && <span className="muted">{ANCHOR_CONFIDENCE_LABEL[d.confidence] ?? d.confidence}</span>}
                        </p>
                      </div>
                      <span className="row-1__side">
                        <Button variant="quiet" small icon="pencil" onClick={() => setEditing(rec)} aria-label={`${d.date ? 'Change' : 'Enter'} date: ${d.meaning ?? rec.title}`}>
                          {d.date ? 'Change' : 'Enter date'}
                        </Button>
                      </span>
                    </div>
                  </li>
                );
              })}
            />
          </Card>
        );
      })}
      {editing && <AnchorDialog record={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReturnPlanning({ idx }: { idx: Indexes }) {
  const items = idx.all.filter((r) => r.type === 'horizon' && /^EX/i.test(r.key));
  const plain = usePlain();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  return (
    <div className="stack">
      {items.length === 0 ? (
        <p className="muted">Nothing listed yet.</p>
      ) : (
        <ShowAllList
          className="step-list"
          label="return or extension"
          rows={items.map((h) => {
            const d = dataOf<HorizonData>(h);
            const title = displayTitle(h, lookup);
            return (
              <li key={h.id} className="step">
                <div className="row-1">
                  <div className="row-1__main">
                    <RecordLink id={h.id} className="item__title">
                      {title}
                    </RecordLink>
                    <p className="step__meta small">
                      <StatusBadge status={h.status} small />
                      {d.cadence && <span className="muted">{CADENCE_LABEL[d.cadence] ?? d.cadence}</span>}
                    </p>
                  </div>
                </div>
                {(d.scope || (d.milestone_links ?? []).length > 0) && (
                  <More label="Details" hint={title}>
                    <div className="stack stack--tight">
                      {d.scope && <p className="small muted preline">{stripCodes(plain(d.scope), lookup)}</p>}
                      <LinkedKeys keys={d.milestone_links} idx={idx} label="Linked work" />
                    </div>
                  </More>
                )}
              </li>
            );
          })}
        />
      )}
      <p className="small">
        <Link to="/money" className="more-link">
          See the return reserve on Money
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function Arrival() {
  return (
    <div className="page arrival">
      <PageTitle>Arrival & living in Tokyo</PageTitle>
      <DataGate>{({ idx, dir }) => <ArrivalBody idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}

/** Rows each part of the page shows before "Show all (N)". */
const FIRST = 3;

function ArrivalBody({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { today } = useData();
  const travelers = dir.people;
  // Start on the signed-in person (or the last choice made here); never on someone else by default.
  const [person, setPersonState] = useState(() => {
    const saved = loadPref('arrival-who');
    if (saved && travelers.some((p) => p.id === saved)) return saved;
    return dir.me && travelers.some((p) => p.id === dir.me?.id) ? dir.me.id : (travelers[0]?.id ?? '');
  });
  const setPerson = (id: string) => {
    setPersonState(id);
    savePref('arrival-who', id);
  };
  const who = dir.personById(person) ?? travelers[0];
  const items = useMemo(() => (who ? arrivalFor(idx, who.id) : []), [idx, who]);
  const byWindow = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const it of items) {
      const k = it.data.window_key ?? 'ongoing';
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return map;
  }, [items]);
  const windows = [...ARRIVAL_WINDOW_ORDER, ...[...byWindow.keys()].filter((k) => !(ARRIVAL_WINDOW_ORDER as readonly string[]).includes(k))].filter((k) => (byWindow.get(k)?.length ?? 0) > 0);
  // The first part with something still to do opens; the others are one tap away.
  const firstOpen = windows.find((k) => byWindow.get(k)!.some((it) => isOpenWork(it.status))) ?? windows[0] ?? null;
  const properties = idx.all.filter((r) => r.type === 'property');
  const returnCount = idx.all.filter((r) => r.type === 'horizon' && /^EX/i.test(r.key)).length;
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const dates = useArrivalDates(who?.id ?? '', idx, dir);
  // A step shared with the other adult is marked only when some steps are not shared.
  const markShared = items.some((it) => !it.shared);
  const stepsHeading = useRef<HTMLHeadingElement>(null);
  const done = useDoneWithUndo(stepsHeading);

  if (travelers.length === 0) return <EmptyState icon="plane" title="No travelers are set up yet." />;

  return (
    <div className="stack stack--loose">
      <SegmentedControl label="Traveler" value={who?.id ?? ''} onChange={setPerson} options={travelers.map((p) => ({ value: p.id, label: p.display_name }))} />
      {who && (
        <>
          <Section
            title={`${who.display_name}’s arrival`}
            headingLevel={2}
            headingRef={stepsHeading}
            action={items.some((it) => it.shared) ? <InfoNote label="About shared steps">Updating a shared step changes only your part.</InfoNote> : undefined}
          >
            {done.note}
            {items.length === 0 ? (
              <Card>
                <EmptyState icon="plane" title={`Nothing listed for ${who.display_name} yet.`} />
              </Card>
            ) : (
              <div className="stack grid-wide grid-wide--2">
                {windows.map((k) => {
                  const list = byWindow.get(k)!;
                  const title = windowTitle(k);
                  return (
                    <PlanGroup key={`${who.id}:${k}`} id={`arrival:${who.id}:${k}`} title={title} count={list.length} defaultOpen={k === firstOpen} headingLevel={3}>
                      <ShowAllList
                        className="step-list"
                        first={FIRST}
                        label={`in ${title}`}
                        rows={list.map((it) => (
                          <ArrivalItem key={it.record.id} item={it} personId={who.id} today={today} lookup={lookup} markShared={markShared} done={done} />
                        ))}
                      />
                    </PlanGroup>
                  );
                })}
              </div>
            )}
          </Section>
          <PlanGroup id={`arrival:${who.id}:dates`} title="Dates that start at arrival" count={dates.ok ? dates.rows.length : undefined} defaultOpen={false} headingLevel={2}>
            <AfterArrivalDeadlines dates={dates} idx={idx} lookup={lookup} />
          </PlanGroup>
        </>
      )}

      <PlanGroup id={`arrival:${who?.id ?? ''}:ongoing`} title="Ongoing, with no date" defaultOpen={false} headingLevel={2}>
        {who && <ContinuingObligations idx={idx} dir={dir} who={who} />}
      </PlanGroup>

      <PlanGroup id="arrival:renewals" title="Renewals" defaultOpen={false} headingLevel={2}>
        <RenewalsRegister idx={idx} dir={dir} />
      </PlanGroup>

      <PlanGroup id="arrival:property" title="Property left behind" count={properties.length} defaultOpen={false} headingLevel={2}>
        {properties.length === 0 ? (
          <p className="muted">Nothing listed yet.</p>
        ) : (
          <ShowAllList
            className="stack grid-wide"
            first={FIRST}
            label="property left behind"
            rows={properties.map((p) => (
              <li key={p.id}>
                <PropertyCard record={p} idx={idx} />
              </li>
            ))}
          />
        )}
      </PlanGroup>

      <PlanGroup id="arrival:return" title="Return or extend" count={returnCount} defaultOpen={false} headingLevel={2}>
        <ReturnPlanning idx={idx} />
      </PlanGroup>
    </div>
  );
}
