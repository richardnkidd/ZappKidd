import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { ARRIVAL_WINDOW_LABEL, ARRIVAL_WINDOW_ORDER, ANCHOR_CONFIDENCE_LABEL, CADENCE_LABEL } from '@shared/labels';
import type { AnchorData, ArrivalData, DeadlineRuleData, HorizonData, PropertyData, WorkStatus } from '@shared/types';
import { Chip, DateText, DeadlineBadge, StatusBadge, VerificationNote } from '../../components/Badges';
import { AnchorDialog } from '../../components/AnchorDialog';
import { Button, SegmentedControl } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LinkedKeys } from '../../components/LinkedKeys';
import { Card, EmptyState, PageTitle, Section } from '../../components/Layout';
import { PersonBadge, usePlain } from '../../components/People';
import { ClampText } from '../../components/ClampText';
import { DeadlineRow, ruleOf } from '../../components/DeadlineRow';
import { Disclosure } from '../../components/Disclosure';
import { RecordLink } from '../../components/RecordLink';
import { deadlineVerification } from '../../lib/home';
import { dataOf, type AnyRecord, type Directory, type Indexes } from '../../lib/records';
import { useData } from '../../state/data';
import { loadPref, savePref } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { StatusDialog } from '../record/dialogs';

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

function ArrivalItem({ item, personId, today }: { item: ReturnType<typeof arrivalFor>[number]; personId: string; today: string }) {
  const plain = usePlain();
  const [open, setOpen] = useState(false);
  const d = item.data;
  const action = d.action && norm(d.action) !== norm(item.record.title) ? plain(d.action) : null;
  const trigger = d.trigger && norm(d.trigger) !== norm(item.record.title) && norm(d.trigger) !== norm(d.action ?? '') ? d.trigger : null;
  const reason = item.reason && item.status !== 'planned' && norm(item.reason) !== norm(d.action ?? '') ? item.reason : null;
  return (
    <li className="item item--flat">
      <div className="item__main">
        <RecordLink id={item.record.id} className="item__title">
          {item.record.title}
        </RecordLink>
        {action && <ClampText className="item__action preline">{action}</ClampText>}
        {trigger && (
          <p className="small muted">
            <span className="item__label">When</span> {plain(trigger)}
          </p>
        )}
        {reason && <p className="small muted preline">{plain(reason)}</p>}
        {d.review_note && (
          <Disclosure title="Practical checks" level={4} className="disclosure--flat">
            <p className="small preline">{plain(d.review_note)}</p>
          </Disclosure>
        )}
        <div className="item__meta">
          <StatusBadge status={item.status} small />
          {d.deadline && (
            <span className="item__when">
              <DateText date={d.deadline.date} today={today} kind={d.deadline.kind} />
              <DeadlineBadge kind={d.deadline.kind} />
            </span>
          )}
          {item.shared && <span className="chip chip--neutral chip--sm">Shared</span>}
        </div>
        <div className="row-actions" style={{ marginTop: 0 }}>
          <Button variant="secondary" small onClick={() => setOpen(true)}>
            Update status
          </Button>
        </div>
      </div>
      {open && <StatusDialog open onClose={() => setOpen(false)} record={item.record} traveler={item.shared ? personId : null} currentStatus={item.status} />}
    </li>
  );
}

function AfterArrivalDeadlines({ person, idx, dir }: { person: string; idx: Indexes; dir: Directory }) {
  const { deadlines, today } = useData();
  const { refresh } = useSnapshot();
  const codes = useMemo(() => arrivalSideCodes(dir, person), [dir, person]);
  if (!deadlines.ok) {
    return (
      <ErrorBanner title="We couldn't work out these dates just now." onRetry={() => void refresh()}>
        Everything else on this page still works.
      </ErrorBanner>
    );
  }
  const rows = deadlines.value.filter((d) => {
    if (d.applies === 'no' || d.state === 'met' || d.state === 'not_applicable' || d.traveler !== person) return false;
    if (d.source === 'rule') {
      const rule = d.rule_id ? (idx.byKey.get(d.rule_id) ?? null) : null;
      const anchor = rule ? dataOf<DeadlineRuleData>(rule).anchor : null;
      return anchor ? codes.has(anchor) : false;
    }
    return d.source === 'record' && Boolean(d.record_id?.startsWith('arrival:'));
  });
  if (rows.length === 0) return <p className="muted">No dated rules start from this traveler’s arrival yet.</p>;
  return (
    <ul className="item-list">
      {rows.map((d) => (
        <DeadlineRow key={d.id} d={d} idx={idx} today={today} dir={dir} />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ household sections */

export function PropertyCard({ record, idx, headingLevel = 3 }: { record: AnyRecord; idx: Indexes; headingLevel?: 2 | 3 }) {
  const d = dataOf<PropertyData>(record);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Card as="article" className="property" aria-labelledby={`pr-${record.key}`}>
      <div className="item__meta">
        <Chip small tone="neutral">
          {record.status === 'open' ? 'Needs watching' : record.status.replace(/_/g, ' ')}
        </Chip>
      </div>
      <H id={`pr-${record.key}`} className="doc__title">
        {d.obligation || record.title}
      </H>
      {d.known_context && <p className="preline">{d.known_context}</p>}
      <dl className="facts facts--tight">
        {d.people_resources && (
          <div className="fact">
            <dt>Who can help</dt>
            <dd className="preline">{d.people_resources}</dd>
          </div>
        )}
        {d.evidence_status && (
          <div className="fact">
            <dt>What we have checked</dt>
            <dd className="preline">{d.evidence_status}</dd>
          </div>
        )}
        {d.evidence_caution && (
          <div className="fact fact--wide">
            <dt>Take care</dt>
            <dd className="preline">{d.evidence_caution}</dd>
          </div>
        )}
      </dl>
      <LinkedKeys keys={d.milestone_links} idx={idx} label="Linked work" />
    </Card>
  );
}

/** Which person a no-date rule is about: a person id, 'each_adult', or 'household' (shared). */
function ruleAudience(scope: string | undefined, who: string, dir: Directory): 'mine' | 'shared' | 'other' {
  if (!scope || scope === 'household') return 'shared';
  if (scope === 'each_adult') return dir.adults.some((a) => a.id === who) ? 'mine' : 'other';
  return scope === who ? 'mine' : 'other';
}

function ObligationItem({ title, meta, children }: { title: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="item item--flat">
      <div className="item__main">
        {title}
        {meta && <div className="item__meta">{meta}</div>}
        {children}
      </div>
    </li>
  );
}

function ContinuingObligations({ idx, dir, who }: { idx: Indexes; dir: Directory; who: { id: string; display_name: string } }) {
  const plain = usePlain();
  const rules = idx.rules.filter((r) => r.data?.anchor === 'other' && r.data.applies !== 'no' && !r.data.superseded_by);
  const horizon = idx.all.filter((r) => r.type === 'horizon' && !/^EX/i.test(r.key));
  const mine = rules.filter((r) => ruleAudience(r.data?.traveler_scope, who.id, dir) === 'mine');
  const shared = rules.filter((r) => ruleAudience(r.data?.traveler_scope, who.id, dir) === 'shared');
  if (mine.length === 0 && shared.length === 0 && horizon.length === 0) {
    return <p className="muted">Nothing has been listed yet for after the first months.</p>;
  }
  const ruleRow = (r: (typeof rules)[number]) => {
    const d = dataOf<DeadlineRuleData>(r);
    return (
      <ObligationItem
        key={r.id}
        title={
          <RecordLink id={r.id} className="item__title">
            When {plain(d.applies_when || 'it applies').replace(/^when\s+/i, '').replace(/\.$/, '')}: {plain(d.label || r.title)}
          </RecordLink>
        }
        meta={
          <>
            {d.kind && <DeadlineBadge kind={d.kind} />}
            <span className="faint small">No date until it happens</span>
          </>
        }
      >
        <VerificationNote verification={d.verification ?? 'not_verified'} kind={d.kind} />
      </ObligationItem>
    );
  };
  return (
    <div className="stack">
      {mine.length > 0 && (
        <div>
          <h3 className="coming-group__title">For {who.display_name}</h3>
          <ul className="item-list">{mine.map(ruleRow)}</ul>
        </div>
      )}
      {(shared.length > 0 || horizon.length > 0) && (
        <div>
          <h3 className="coming-group__title">Shared by the household</h3>
          <ul className="item-list">
            {horizon.map((h) => {
              const d = dataOf<HorizonData>(h);
              return (
                <ObligationItem
                  key={h.id}
                  title={
                    <RecordLink id={h.id} className="item__title">
                      When {plain(d.trigger || h.title).replace(/^when\s+/i, '')}: {plain(d.scope || h.title)}
                    </RecordLink>
                  }
                  meta={
                    <>
                      {d.cadence && <Chip small tone="neutral">{CADENCE_LABEL[d.cadence] ?? d.cadence}</Chip>}
                      <StatusBadge status={h.status} small />
                    </>
                  }
                >
                  {d.completion_criteria && <p className="small muted preline">Done when: {plain(d.completion_criteria)}</p>}
                </ObligationItem>
              );
            })}
            {shared.map(ruleRow)}
          </ul>
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
  const anchors = idx.anchors.filter((a) => RENEWAL.test(dataOf<AnchorData>(a).code ?? a.key) && !dataOf<AnchorData>(a).coordination_only);
  if (anchors.length === 0) {
    return <p className="muted">Each adult’s residence-status expiry and any plan to leave Japan will be listed here once they are recorded. Until then there is nothing to renew.</p>;
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
            <ul className="item-list">
              {entries.map((e) => {
                if (e.kind === 'rule') return <DeadlineRow key={e.d.id} d={e.d} idx={idx} today={today} dir={dir} />;
                const d = e.a;
                const rec = e.rec;
                return (
                  <li key={rec.id} className="item item--flat">
                    <div className="item__main">
                      <span className="item__title">{d.meaning ?? rec.title}</span>
                      <div className="item__meta">
                        <DateText date={d.date ?? null} today={today} />
                        {d.confidence && d.confidence !== 'awaiting' && <span className="chip chip--neutral chip--sm">{ANCHOR_CONFIDENCE_LABEL[d.confidence] ?? d.confidence}</span>}
                        <Button variant="quiet" small icon="pencil" onClick={() => setEditing(rec)} aria-label={`${d.date ? 'Change' : 'Enter'} date: ${d.meaning ?? rec.title}`}>
                          {d.date ? 'Change' : 'Enter date'}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
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
  return (
    <div className="stack">
      <p className="muted">Staying, extending and returning are all valid outcomes. This is a place to decide calmly, well before any date forces it.</p>
      {items.length === 0 ? (
        <p className="muted">Nothing has been listed yet.</p>
      ) : (
        <ul className="item-list">
          {items.map((h) => {
            const d = dataOf<HorizonData>(h);
            return (
              <li key={h.id} className="item item--flat">
                <div className="item__main">
                  <RecordLink id={h.id} className="item__title">
                    {h.title}
                  </RecordLink>
                  {d.scope && <p className="item__action preline">{plain(d.scope)}</p>}
                  <div className="item__meta">
                    <StatusBadge status={h.status} small />
                    {d.cadence && <Chip small tone="neutral">{CADENCE_LABEL[d.cadence] ?? d.cadence}</Chip>}
                  </div>
                  <LinkedKeys keys={d.milestone_links} idx={idx} label="Linked work" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="small">
        <Link to="/money" className="more-link">
          See the protected return reserve on the Money page
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function Arrival() {
  return (
    <div className="page arrival">
      <PageTitle kicker="After landing, and the months after">Arrival & living in Tokyo</PageTitle>
      <DataGate>{({ idx, dir }) => <ArrivalBody idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}

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
  const properties = idx.all.filter((r) => r.type === 'property');

  if (travelers.length === 0) return <EmptyState icon="plane" title="No travelers are set up yet." />;

  return (
    <div className="stack stack--loose">
      <SegmentedControl label="Traveler" value={who?.id ?? ''} onChange={setPerson} options={travelers.map((p) => ({ value: p.id, label: p.display_name }))} />
      {who && (
        <>
          <Section title={`${who.display_name}’s arrival`} headingLevel={2} intro="Each traveler has their own list. Another person’s part never holds this one up.">
            {items.length === 0 ? (
              <Card>
                <EmptyState icon="plane" title={`Nothing is listed for ${who.display_name}’s arrival yet.`} />
              </Card>
            ) : (
              <div className="stack">
                {[...ARRIVAL_WINDOW_ORDER, ...[...byWindow.keys()].filter((k) => !(ARRIVAL_WINDOW_ORDER as readonly string[]).includes(k))].map((k) => {
                  const list = byWindow.get(k);
                  if (!list || list.length === 0) return null;
                  return (
                    <Card key={k} as="section" aria-label={ARRIVAL_WINDOW_LABEL[k] ?? k}>
                      <h3 className="coming-group__title">{ARRIVAL_WINDOW_LABEL[k] ?? k}</h3>
                      {list.some((it) => it.shared) && (
                        <p className="small muted">Steps marked “Shared” are done with the other adult. Updating one here changes only {who.display_name}’s part.</p>
                      )}
                      <ul className="item-list">
                        {list.map((it) => (
                          <ArrivalItem key={it.record.id} item={it} personId={who.id} today={today} />
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            )}
          </Section>
          <Section title="Dates that start at arrival" headingLevel={2} intro="Rules measured from this traveler’s own arrival, residence and eligibility dates.">
            <AfterArrivalDeadlines person={who.id} idx={idx} dir={dir} />
          </Section>
        </>
      )}

      <Section title="Continuing obligations" headingLevel={2} intro="These have no date. They start when something happens.">
        {who && <ContinuingObligations idx={idx} dir={dir} who={who} />}
      </Section>

      <Section title="Renewals register" headingLevel={2} intro="Each adult’s status expiry and any plan to leave. A date shows as awaiting until it is entered.">
        <RenewalsRegister idx={idx} dir={dir} />
      </Section>

      <Section title="Property oversight" headingLevel={2} intro="Things that stay behind and still need watching.">
        {properties.length === 0 ? (
          <p className="muted">Nothing is listed yet.</p>
        ) : (
          <ul className="stack">
            {properties.map((p) => (
              <li key={p.id}>
                <PropertyCard record={p} idx={idx} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Return or extension planning" headingLevel={2}>
        <ReturnPlanning idx={idx} />
      </Section>
    </div>
  );
}

