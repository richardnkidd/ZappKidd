import { useEffect, useMemo, useState } from 'react';
import { isCivilDate } from '@shared/dates';
import type { DocumentData } from '@shared/types';
import { Chip } from '../../components/Badges';
import { Disclosure } from '../../components/Disclosure';
import { RecordLink } from '../../components/RecordLink';
import { diffDays } from '@shared/dates';
import { isOpenWork } from '../../lib/records';
import { whenFor } from '../../lib/when';
import { useData } from '../../state/data';
import { Button, Field, FilterChips, TextArea, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Dialog } from '../../components/Dialog';
import { ConflictBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LinkedKeys } from '../../components/LinkedKeys';
import { Card, EmptyState, PageTitle } from '../../components/Layout';
import { civil, dayIn, humanizeKey, safeHref } from '../../lib/format';
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
            {s.date ? civil(s.date, 'short') : 'Not yet'}
            {s.date && s.extra ? <span className="faint small"> · {s.extra}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DocumentCard({ record, idx, dir, headingLevel = 3, compact = false }: { record: AnyRecord; idx: Indexes; dir: Directory; headingLevel?: 2 | 3; compact?: boolean }) {
  const d = dataOf<DocumentData>(record);
  const [edit, setEdit] = useState(false);
  const href = safeHref(d.link);
  const scope = d.traveler_scope ?? [];
  const H = headingLevel === 2 ? 'h2' : 'h3';

  const details = (
    <>
      <Lifecycle d={d} />
      <dl className="facts facts--tight">
        <div className="fact">
          <dt>Who holds it</dt>
          <dd>{d.custodian || 'Not decided yet'}</dd>
        </div>
        <div className="fact">
          <dt>Needed by</dt>
          <dd>{d.needed_by || 'Not known yet'}</dd>
        </div>
        <div className="fact">
          <dt>Expires</dt>
          <dd>{d.expiry ? civil(d.expiry, 'short') : d.validity || 'Not known yet'}</dd>
        </div>
        <div className="fact">
          <dt>Check again when</dt>
          <dd>{d.refresh_trigger || 'Not set'}</dd>
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
            <dd className="preline">{d.completion_criteria}</dd>
          </div>
        )}
      </dl>
      {d.privacy && (
        <p className="small muted">
          <Icon name="lock" size={13} /> {d.privacy}
        </p>
      )}
      <LinkedKeys keys={d.linked_records} idx={idx} label="Needed for" />
    </>
  );

  if (compact) {
    return (
      <Card as="article" className="doc doc--row" aria-labelledby={`doc-${record.key}`}>
        <div className="doc__row">
          <div className="doc__row-main">
            <H id={`doc-${record.key}`} className="doc__title">
              <RecordLink id={record.id}>{record.title}</RecordLink>
            </H>
            <div className="item__meta">
              <Chip small tone="neutral">
                {humanizeKey(record.status)}
              </Chip>
              <Chip small>{scope.length ? scope.map((p) => dir.nameOf(p)).join(' and ') : d.for_whom || 'Household'}</Chip>
              <span className="small muted">Held by: {d.custodian || 'not decided yet'}</span>
              {d.needed_by && <span className="small muted">Needed by: {d.needed_by}</span>}
            </div>
          </div>
          <Button variant="secondary" small icon="pencil" onClick={() => setEdit(true)} aria-label={`Update status: ${record.title}`}>
            Update status
          </Button>
        </div>
        <Disclosure title="Details" level={4} className="disclosure--flat">
          <div className="stack">{details}</div>
        </Disclosure>
        {edit && <DocumentDialog record={record} onClose={() => setEdit(false)} />}
      </Card>
    );
  }

  return (
    <Card as="article" className="doc" aria-labelledby={`doc-${record.key}`}>
      <div className="item__meta">
        <Chip small tone="neutral">
          {humanizeKey(record.status)}
        </Chip>
        <Chip small>{scope.length ? scope.map((p) => dir.nameOf(p)).join(' and ') : d.for_whom || 'Household'}</Chip>
      </div>
      <H id={`doc-${record.key}`} className="doc__title">
        {record.title}
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

function DocumentDialog({ record, onClose }: { record: AnyRecord; onClose: () => void }) {
  const { actions } = useSnapshot();
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
      description={`${record.title}. Only status, dates and a link are kept here — never the document itself.`}
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
      <Field label="Restricted link" hint="A link to where the original is kept. It must start with https://." error={tried && linkBad ? 'The link must start with https://.' : null}>
        <TextInput value={f.link} onChange={set('link')} inputMode="url" placeholder="https://" />
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
      <PageTitle kicker="Status and where things are kept">Documents</PageTitle>
      <DataGate>{({ idx, dir }) => <DocumentList idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}

function DocumentList({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { today, deadlinesByRecord, deadlines } = useData();
  const docs = useMemo(() => idx.all.filter((r) => r.type === 'document').sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })), [idx]);
  const [who, setWho] = useState<string>('all');
  const [state, setState] = useState<'all' | 'now' | 'not_started'>('all');
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

  const byPerson = docs.filter((r) => who === 'all' || (who === 'household' ? scopeOf(r).length === 0 : scopeOf(r).includes(who)));
  const shown = byPerson.filter((r) => (state === 'now' ? needsActionNow(r) : state === 'not_started' ? notStarted(r) : true));
  useEffect(() => {
    if (who !== 'all' && who !== 'household' && !dir.personById(who)) setWho('all');
  }, [who, dir]);
  return (
    <div className="stack stack--loose">
      <Card tone="inset" className="doc-note">
        <p>
          <Icon name="lock" size={16} /> <strong>Originals are not stored here.</strong> Kadode keeps each document’s status, who holds it and a link to where it is kept. Passports,
          medical and financial papers stay with whoever holds them, and nothing can be uploaded.
        </p>
      </Card>
      {docs.length === 0 ? (
        <Card>
          <EmptyState icon="doc" title="No documents have been listed yet." />
        </Card>
      ) : (
        <>
          <FilterChips
            label="Show documents for"
            value={who}
            onChange={setWho}
            scroll
            options={[
              { value: 'all', label: 'Everyone', count: docs.length },
              ...dir.people.map((p) => ({ value: p.id, label: p.display_name, count: docs.filter((d) => scopeOf(d).includes(p.id)).length })),
              { value: 'household', label: 'Household', count: docs.filter((d) => scopeOf(d).length === 0).length },
            ]}
          />
          <FilterChips
            label="Which documents"
            value={state}
            onChange={setState}
            scroll
            options={[
              { value: 'all', label: 'All', count: byPerson.length },
              { value: 'now', label: 'Needs action now', count: byPerson.filter(needsActionNow).length },
              { value: 'not_started', label: 'Not started', count: byPerson.filter(notStarted).length },
            ]}
          />
          <h2 className="visually-hidden">Documents</h2>
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="doc" title={state === 'now' ? 'Nothing needs action right now.' : 'Nothing listed for this view.'} />
            </Card>
          ) : (
            <ul className="stack stack--tight">
              {shown.map((r) => (
                <li key={r.id}>
                  <DocumentCard record={r} idx={idx} dir={dir} compact />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
