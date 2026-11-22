import { useEffect, useMemo, useState } from 'react';
import { isCivilDate } from '@shared/dates';
import type { DocumentData, Sensitivity } from '@shared/types';
import { StatusBadge } from '../../components/Badges';
import { InfoNote } from '../../components/InfoNote';
import { More } from '../../components/More';
import { RecordLink } from '../../components/RecordLink';
import { diffDays } from '@shared/dates';
import { isOpenWork } from '../../lib/records';
import { whenFor } from '../../lib/when';
import { useData } from '../../state/data';
import { Button, Field, Select, TextArea, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Dialog } from '../../components/Dialog';
import { ConflictBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LinkedKeys } from '../../components/LinkedKeys';
import { useDir } from '../../components/People';
import { Card, EmptyState, PageTitle } from '../../components/Layout';
import { civil, dayIn, humanizeKey, safeHref } from '../../lib/format';
import { displayTitle, keyLookup, stripCodes } from '@shared/plain';
import { WORK_STATUS_LABEL } from '@shared/labels';
import { usePrefs } from '../../state/prefs';
import { dataOf, type AnyRecord, type Directory, type Indexes } from '../../lib/records';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';



/** Four separate lifecycle facts, never collapsed into one percentage. */
function Lifecycle({ d }: { d: Partial<DocumentData> }) {
  const { zone } = usePrefs();
  const DATE_PART = (v: string | null | undefined) => dayIn(v, zone);
  const steps: { label: string; date: string | null; extra?: string | null }[] = [
    { label: 'Requested', date: DATE_PART(d.requested_at) },
    { label: 'Received', date: DATE_PART(d.received_at) },
    { label: 'Reviewed', date: DATE_PART(d.reviewed_at) },
    { label: 'Accepted by the relevant authority', date: DATE_PART(d.accepted_by_authority_at), extra: d.accepted_by },
  ];
  return (
    <ol className="lifecycle" aria-label="Where this document is">
      {steps.map((s) => (
        <li key={s.label} className={`lifecycle__step${s.date ? ' is-done' : ''}`}>
          <Icon name={s.date ? 'check' : 'circle'} size={16} />
          <span className="lifecycle__label">{s.label}</span>
          <span className="lifecycle__when">
            {s.date ? civil(s.date, 'weekday') : 'Not yet'}
            {s.date && s.extra ? <span className="faint small"> · {s.extra}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A document's status as a small icon with its words (never colour alone). */
function DocStatus({ status }: { status: string }) {
  if (status in WORK_STATUS_LABEL) return <StatusBadge status={status} />;
  return (
    <span className="status-icon status-icon--neutral">
      <Icon name="circle" size={18} />
      <span className="status-icon__label">{humanizeKey(status)}</span>
    </span>
  );
}

/** Who holds a document. Imported wording can carry a plan label like "(proposed)"; it never reaches the screen. */
export function holderOf(d: Partial<DocumentData>): string {
  return stripCodes((d.custodian ?? '').replace(/\s*\((?:proposed|tbc|draft)\)/gi, '')).trim();
}

export function DocumentCard({
  record,
  idx,
  dir,
  headingLevel = 3,
  compact = false,
  commonHolder = null,
}: {
  record: AnyRecord;
  idx: Indexes;
  dir: Directory;
  headingLevel?: 2 | 3;
  compact?: boolean;
  /** The holder every other row shares. It is stated once above the list, so it is left off this row. */
  commonHolder?: string | null;
}) {
  const d = dataOf<DocumentData>(record);
  const [edit, setEdit] = useState(false);
  const href = safeHref(d.link);
  const scope = d.traveler_scope ?? [];
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const title = displayTitle(record, lookup);
  const holder = holderOf(d);
  const neededBy = stripCodes(d.needed_by ?? '', lookup).trim();
  const forWhom = scope.length ? scope.map((p) => dir.nameOf(p)).join(' and ') : d.for_whom || 'Household';

  const details = (
    <>
      <Lifecycle d={d} />
      <dl className="facts facts--tight">
        <div className="fact">
          <dt>For</dt>
          <dd>{forWhom}</dd>
        </div>
        <div className="fact">
          <dt>Who holds it</dt>
          <dd>{holder || 'Not decided yet'}</dd>
        </div>
        <div className="fact">
          <dt>Needed by</dt>
          <dd>{neededBy || 'Not known yet'}</dd>
        </div>
        <div className="fact">
          <dt>Expires</dt>
          <dd>{d.expiry ? civil(d.expiry, 'weekday') : d.validity || 'Not known yet'}</dd>
        </div>
        <div className="fact">
          <dt>Check again when</dt>
          <dd>{stripCodes(d.refresh_trigger ?? '', lookup) || 'Not set'}</dd>
        </div>
        <div className="fact fact--wide">
          <dt>Restricted link</dt>
          <dd>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                Open where the original is kept<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="muted">No link yet</span>
            )}
          </dd>
        </div>
        {d.completion_criteria && (
          <div className="fact fact--wide">
            <dt>Done when</dt>
            <dd className="preline">{stripCodes(d.completion_criteria, lookup)}</dd>
          </div>
        )}
      </dl>
      {d.privacy && !compact && (
        <p className="small muted">
          <Icon name="lock" size={14} /> {stripCodes(d.privacy, lookup)}
        </p>
      )}
      <LinkedKeys keys={d.linked_records} idx={idx} label="Needed for" />
    </>
  );

  if (compact) {
    const showHolder = holder !== '' && holder !== commonHolder;
    return (
      <div className="doc-row" role="group" aria-labelledby={`doc-${record.key}`}>
        <div className="row-1">
          <div className="row-1__main">
            <p id={`doc-${record.key}`} className="doc-row__title">
              <RecordLink id={record.id}>{title}</RecordLink>
            </p>
            <p className="doc-row__meta">
              <DocStatus status={record.status} />
              {showHolder && <span className="muted"> Held by {holder}</span>}
            </p>
          </div>
          <Button variant="quiet" small className="row-1__side" onClick={() => setEdit(true)} aria-label={`Update status: ${title}`}>
            Update
          </Button>
        </div>
        <More label="Details" hint={title}>
          <div className="stack">{details}</div>
        </More>
        {edit && <DocumentDialog record={record} onClose={() => setEdit(false)} />}
      </div>
    );
  }

  return (
    <Card as="article" className="doc" aria-labelledby={`doc-${record.key}`}>
      <DocStatus status={record.status} />
      <H id={`doc-${record.key}`} className="doc__title">
        {title}
      </H>
      {details}
      <div className="row-actions">
        <Button variant="secondary" small icon="pencil" onClick={() => setEdit(true)}>
          Update status
        </Button>
      </div>
      {edit && <DocumentDialog record={record} onClose={() => setEdit(false)} />}
    </Card>
  );
}

/** The sensitivity choices a document can carry; "not sensitive" is stored as no mark (null). */
const SENSITIVITY_CHOICES: { value: 'none' | NonNullable<Sensitivity>; label: string }[] = [
  { value: 'none', label: 'Not sensitive' },
  { value: 'medical', label: 'Medical' },
  { value: 'financial', label: 'Financial' },
  { value: 'identity', label: 'Identity papers' },
];

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

function DocumentDialog({ record, onClose }: { record: AnyRecord; onClose: () => void }) {
  const { actions } = useSnapshot();
  const dir = useDir();
  const { zone } = usePrefs();
  const DATE_PART = (v: string | null | undefined) => dayIn(v, zone);
  const w = useWrite();
  const d = dataOf<DocumentData>(record);
  const [f, setF] = useState({
    requested_at: DATE_PART(d.requested_at) ?? '',
    received_at: DATE_PART(d.received_at) ?? '',
    reviewed_at: DATE_PART(d.reviewed_at) ?? '',
    accepted_by_authority_at: DATE_PART(d.accepted_by_authority_at) ?? '',
    accepted_by: d.accepted_by ?? '',
    expiry: d.expiry ?? '',
    refresh_trigger: d.refresh_trigger ?? '',
    link: d.link ?? '',
  });
  // Who carries it on arrival (the printed arrival pack lists it for them) and how sensitive it is (sensitive papers are
  // left out of the pack unless ticked there).
  const carryNow = useMemo(() => (d.carry_on_arrival ?? []).filter((id) => dir.personById(id)), [d.carry_on_arrival, dir]);
  const [carry, setCarry] = useState<string[]>(carryNow);
  const [sensitivity, setSensitivity] = useState<'none' | NonNullable<Sensitivity>>(d.sensitivity ?? 'none');
  const [startVersion] = useState(record.version);
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const dates: (keyof typeof f)[] = ['requested_at', 'received_at', 'reviewed_at', 'accepted_by_authority_at', 'expiry'];
  const badDate = dates.find((k) => f[k] !== '' && !isCivilDate(f[k]));
  const linkBad = f.link.trim() !== '' && !/^https:\/\//i.test(f.link.trim());

  useEffect(() => {
    w.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setTried(true);
    if (badDate || linkBad) return;
    const n = (v: string) => (v.trim() === '' ? null : v.trim());
    // Only what the person actually changed is sent, so leaving these alone never marks them as edited.
    const marks: Record<string, unknown> = {};
    if (!sameSet(carry, carryNow)) marks.carry_on_arrival = carry;
    if (sensitivity !== (d.sensitivity ?? 'none')) marks.sensitivity = sensitivity === 'none' ? null : sensitivity;
    const ok = await w.run(
      (v) =>
        actions.patchRecord(record.id, v, {
          data: {
            requested_at: n(f.requested_at),
            received_at: n(f.received_at),
            reviewed_at: n(f.reviewed_at),
            accepted_by_authority_at: n(f.accepted_by_authority_at),
            accepted_by: n(f.accepted_by),
            expiry: n(f.expiry),
            refresh_trigger: n(f.refresh_trigger),
            link: n(f.link),
            ...marks,
          },
        }),
      startVersion,
    );
    if (ok) onClose();
  };

  const dateField = (k: keyof typeof f, label: string) => (
    <Field label={label} error={tried && badDate === k ? 'Please pick a real date.' : null}>
      <TextInput type="date" value={f[k]} onChange={set(k)} />
    </Field>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Update this document"
      description={`${record.title}. Status, dates and a link only. Never the document.`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      {dateField('requested_at', 'Requested on')}
      {dateField('received_at', 'Received on')}
      {dateField('reviewed_at', 'Reviewed on')}
      {dateField('accepted_by_authority_at', 'Accepted by the relevant authority on')}
      <Field label="Accepted by" hint="Which authority, if any.">
        <TextInput value={f.accepted_by} onChange={set('accepted_by')} />
      </Field>
      {dateField('expiry', 'Expires on')}
      <Field label="Check again when">
        <TextArea value={f.refresh_trigger} onChange={set('refresh_trigger')} rows={2} />
      </Field>
      <Field label="Restricted link" hint="Where the original is kept. Starts with https://." error={tried && linkBad ? 'The link must start with https://.' : null}>
        <TextInput value={f.link} onChange={set('link')} inputMode="url" placeholder="https://" />
      </Field>
      <fieldset className="stack stack--tight">
        <legend>Who carries it on arrival</legend>
        <p className="small muted">Listed in their arrival pack.</p>
        {dir.people.map((p) => (
          <label key={p.id} className="choice">
            <input
              type="checkbox"
              checked={carry.includes(p.id)}
              onChange={(e) => setCarry((c) => (e.target.checked ? [...c.filter((x) => x !== p.id), p.id] : c.filter((x) => x !== p.id)))}
            />
            <span className="choice__text">Carry on arrival: {p.display_name}</span>
          </label>
        ))}
      </fieldset>
      <Field label="How sensitive is it?" hint="Sensitive papers stay out of the pack unless ticked there.">
        <Select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as typeof sensitivity)}>
          {SENSITIVITY_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}

export function Documents() {
  return (
    <div className="page docs">
      <PageTitle kicker="Status, and who holds each one">Documents</PageTitle>
      <DataGate>{({ idx, dir }) => <DocumentList idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}

const FIRST_ROWS = 5;

function DocumentList({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { today, deadlinesByRecord, deadlines } = useData();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const docs = useMemo(() => idx.all.filter((r) => r.type === 'document').sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })), [idx]);
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const scopeOf = (r: AnyRecord) => dataOf<DocumentData>(r).traveler_scope ?? [];

  /** Started but not finished, or needed by work that is under way or due within a month. */
  const needsActionNow = (r: AnyRecord): boolean => {
    if (!isOpenWork(r.status)) return false;
    if (r.status === 'in_progress' || r.status === 'blocked' || r.status === 'waiting_external') return true;
    return (dataOf<DocumentData>(r).linked_records ?? []).some((k) => {
      const m = idx.milestoneByKey.get(k);
      if (!m || !isOpenWork(m.status) || m.data?.optional_future_work) return false;
      if (m.status === 'in_progress') return true;
      const p = whenFor(m, idx, deadlines.ok ? deadlinesByRecord.get(m.id) : undefined, today).primary;
      return Boolean(p && p.kind !== 'review_date' && diffDays(today, p.date) <= 30);
    });
  };
  const notStarted = (r: AnyRecord) => r.status === 'not_started';
  const matches = (f: string) => (r: AnyRecord) =>
    f === 'all' ? true : f === 'now' ? needsActionNow(r) : f === 'not_started' ? notStarted(r) : f === 'household' ? scopeOf(r).length === 0 : scopeOf(r).includes(f);

  useEffect(() => {
    if (filter !== 'all' && filter !== 'now' && filter !== 'not_started' && filter !== 'household' && !dir.personById(filter)) setFilter('all');
  }, [filter, dir]);

  const q = query.trim().toLowerCase();
  const shown = docs.filter(matches(filter)).filter((r) => q === '' || displayTitle(r, lookup).toLowerCase().includes(q));
  // The first few rows, then "Show all": only while nothing is being searched or filtered.
  const narrowed = q !== '' || filter !== 'all';
  const rows = narrowed || showAll ? shown : shown.slice(0, FIRST_ROWS);

  // One holder shared by most rows is said once above the list, not on every row.
  const commonHolder = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of docs) {
      const h = holderOf(dataOf<DocumentData>(r));
      if (h) count.set(h, (count.get(h) ?? 0) + 1);
    }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 3 && top[1] * 2 > docs.length ? top[0] : null;
  }, [docs]);

  return (
    <div className="stack stack--loose">
      {docs.length === 0 ? (
        <Card>
          <EmptyState icon="doc" title="No documents yet." />
        </Card>
      ) : (
        <>
          <div className="doc-tools">
            <div className="search">
              <Field label="Search documents" hideLabel>
                <input type="search" className="input" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
              </Field>
              {query !== '' && (
                <Button variant="quiet" small icon="x" className="search__clear" onClick={() => setQuery('')} aria-label="Clear search">
                  Clear
                </Button>
              )}
            </div>
            <Field label="Show" hideLabel>
              <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All documents ({docs.length})</option>
                <option value="now">Needs action now ({docs.filter(needsActionNow).length})</option>
                <option value="not_started">Not started ({docs.filter(notStarted).length})</option>
                <optgroup label="For">
                  {dir.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name} ({docs.filter(matches(p.id)).length})
                    </option>
                  ))}
                  <option value="household">Household ({docs.filter(matches('household')).length})</option>
                </optgroup>
              </Select>
            </Field>
            <InfoNote label="About these documents">
              <strong>Originals are not stored here.</strong> Kadode keeps each document’s status, who holds it and a link to where it is kept. Nothing can be uploaded.
            </InfoNote>
          </div>
          <h2 className="visually-hidden">Documents</h2>
          {commonHolder && !narrowed && <p className="quiet-line">Held by: {commonHolder}</p>}
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="doc" title={q ? 'No document has that name.' : filter === 'now' ? 'Nothing needs action right now.' : 'Nothing here.'} />
            </Card>
          ) : (
            <>
              <ul className="doc-list">
                {rows.map((r) => (
                  <li key={r.id}>
                    <DocumentCard record={r} idx={idx} dir={dir} compact commonHolder={commonHolder} />
                  </li>
                ))}
              </ul>
              {rows.length < shown.length && (
                <div>
                  <Button variant="quiet" className="show-all" onClick={() => setShowAll(true)}>
                    Show all ({shown.length})
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
