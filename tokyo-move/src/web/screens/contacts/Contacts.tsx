import { useMemo, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { isCivilDate } from '@shared/dates';
import {
  CONTACT_BOUNDARY_DEFAULT,
  CONTACT_RELATIONSHIP_LABEL,
  FINDING_DISPOSITION_LABEL,
  FINDING_TYPE_LABEL,
  REVIEWER_LABEL,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
} from '@shared/labels';
import type { ContactData, ContactRelationship, EvidenceData, FindingData } from '@shared/types';
import { Chip } from '../../components/Badges';
import { Button, Field, FilterChips, Select, TextArea } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Dialog } from '../../components/Dialog';
import { ConflictBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LinkedKeys } from '../../components/LinkedKeys';
import { usePlain } from '../../components/People';
import { Card, EmptyState, PageTitle } from '../../components/Layout';
import { civil, humanizeKey, safeHref } from '../../lib/format';
import { checksOf, cleanNote, evidenceVerification, lastCheckedOf } from '../../lib/evidence';
import { dataOf, type AnyRecord, type Directory, type Indexes } from '../../lib/records';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

const TABS = [
  { to: '/contacts', label: 'Contacts', end: true },
  { to: '/contacts/evidence', label: 'Evidence', end: false },
  { to: '/contacts/findings', label: 'Plan review findings', end: false },
];

/* ------------------------------------------------------------------ direct check (rules and evidence) */

export function DirectCheck({ data, showLink = true }: { data: unknown; showLink?: boolean }) {
  const checks = checksOf(data);
  const plain = usePlain();
  if (checks.length === 0) return null;
  const hrefs = showLink ? [...new Set(checks.map((c) => safeHref(c.url)).filter((h): h is string => !!h))] : [];
  return (
    <div className="direct-check">
      <ul className="check-lines">
        {checks.map((c, i) => (
          <li key={`${c.who ?? 'direct'}-${c.on ?? i}`} className="check-line">
            <p className="small">
              <Icon name={c.tone === 'matcha' ? 'check' : c.tone === 'kaki' ? 'alert' : 'info'} size={14} />{' '}
              <strong>
                {c.who ? `${c.who} checked` : 'Checked'}
                {c.on && isCivilDate(c.on) ? ` ${civil(c.on, 'short')}` : ''}:
              </strong>{' '}
              {c.statusLabel}.
            </p>
            {c.note && <p className="small muted preline">{plain(cleanNote(c.note))}</p>}
            {c.quote && (
              <details className="check-quote">
                <summary className="small">What the page said</summary>
                <blockquote className="quote preline" lang={/[\u3040-\u30ff\u4e00-\u9fff]/.test(c.quote) ? 'ja' : undefined}>
                  {c.quote}
                </blockquote>
              </details>
            )}
          </li>
        ))}
      </ul>
      {hrefs.map((href) => (
        <p key={href} className="small">
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open the official page<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ contacts */

export function ContactCard({ record, idx, headingLevel = 3 }: { record: AnyRecord; idx: Indexes; headingLevel?: 2 | 3 }) {
  const d = dataOf<ContactData>(record);
  const [edit, setEdit] = useState(false);
  const rel = (d.relationship ?? 'potential') as ContactRelationship;
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const plain = usePlain();
  // A saved sentence like "Candidate only" stops being true once someone has actually been in touch.
  const saved = d.status_boundary?.trim() ?? '';
  const stale = rel !== 'potential' && /candidate only|nobody has been contacted|saved name only/i.test(saved);
  const boundary = !saved || stale ? CONTACT_BOUNDARY_DEFAULT[rel] : saved;
  return (
    <Card as="article" className="contact" aria-labelledby={`ct-${record.key}`}>
      <div className="item__meta">
        <Chip small tone={rel === 'potential' ? 'neutral' : 'ai'}>
          {CONTACT_RELATIONSHIP_LABEL[rel] ?? rel}
        </Chip>
      </div>
      <H id={`ct-${record.key}`} className="doc__title">
        {d.name || record.title}
      </H>
      {d.role && <p className="muted">{d.role}</p>}
      <p className="boundary">
        <Icon name="info" size={15} /> {boundary}
      </p>
      {rel !== 'potential' && d.relationship_basis && <p className="small muted preline">Because: {d.relationship_basis}</p>}
      {d.relevance && <p className="preline">{plain(d.relevance)}</p>}
      <LinkedKeys keys={d.linked_records} idx={idx} label="Relevant to" />
      <div className="row-actions">
        <Button variant="secondary" small icon="pencil" onClick={() => setEdit(true)}>
          Change relationship
        </Button>
      </div>
      {edit && <RelationshipDialog record={record} onClose={() => setEdit(false)} />}
    </Card>
  );
}

function RelationshipDialog({ record, onClose }: { record: AnyRecord; onClose: () => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const d = dataOf<ContactData>(record);
  const [rel, setRel] = useState<ContactRelationship>(d.relationship ?? 'potential');
  const [basis, setBasis] = useState(d.relationship_basis ?? '');
  const [startVersion] = useState(record.version);
  const [tried, setTried] = useState(false);
  const basisMissing = rel !== 'potential' && basis.trim() === '';
  const submit = async () => {
    setTried(true);
    if (basisMissing) return;
    const ok = await w.run(
      (v) => actions.patchRecord(record.id, v, { data: { relationship: rel, relationship_basis: rel === 'potential' ? null : basis.trim() } }),
      startVersion,
    );
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Change relationship"
      description={`${d.name || record.title}. A saved name never means anyone has been contacted or booked.`}
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
      <Field label="Relationship">
        <Select value={rel} onChange={(e) => setRel(e.target.value as ContactRelationship)}>
          {(Object.keys(CONTACT_RELATIONSHIP_LABEL) as ContactRelationship[]).map((k) => (
            <option key={k} value={k}>
              {CONTACT_RELATIONSHIP_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      {rel !== 'potential' && (
        <Field
          label="What happened, or what already exists?"
          hint="Only a real recorded interaction or an existing relationship moves someone beyond a potential resource."
          error={tried && basisMissing ? 'Please say what this is based on.' : null}
        >
          <TextArea value={basis} onChange={(e) => setBasis(e.target.value)} rows={2} />
        </Field>
      )}
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}

function ContactsTab() {
  return <DataGate>{({ idx }) => <ContactList idx={idx} />}</DataGate>;
}

function ContactList({ idx }: { idx: Indexes }) {
  const contacts = useMemo(() => idx.all.filter((r) => r.type === 'contact').sort((a, b) => a.title.localeCompare(b.title)), [idx]);
  const [rel, setRel] = useState<string>('all');
  const shown = contacts.filter((c) => rel === 'all' || (dataOf<ContactData>(c).relationship ?? 'potential') === rel);
  const count = (r: string) => contacts.filter((c) => (dataOf<ContactData>(c).relationship ?? 'potential') === r).length;
  return (
    <div className="stack">
      <h2 className="visually-hidden">Contacts</h2>
      <p className="muted">People and firms who might help. A saved name is only a candidate: nothing here means anyone has been contacted, hired or booked.</p>
      {contacts.length === 0 ? (
        <Card>
          <EmptyState icon="contacts" title="No contacts have been saved yet." />
        </Card>
      ) : (
        <>
          <FilterChips
            label="Relationship"
            value={rel}
            onChange={setRel}
            scroll
            options={[
              { value: 'all', label: 'All', count: contacts.length },
              ...(Object.keys(CONTACT_RELATIONSHIP_LABEL) as ContactRelationship[]).map((k) => ({ value: k as string, label: CONTACT_RELATIONSHIP_LABEL[k], count: count(k) })),
            ]}
          />
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="contacts" title="Nobody in this group." />
            </Card>
          ) : (
            <ul className="stack">
              {shown.map((c) => (
                <li key={c.id}>
                  <ContactCard record={c} idx={idx} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ evidence */

export function EvidenceCard({ record, headingLevel = 3 }: { record: AnyRecord; headingLevel?: 2 | 3 }) {
  const d = dataOf<EvidenceData>(record);
  const href = safeHref(d.url_or_reference);
  const ver = evidenceVerification(record.data, (x) => civil(x, 'short'));
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Card as="article" className="evidence-card" aria-labelledby={`ev-${record.key}`}>
      <div className="item__meta">
        <Chip small tone={ver.tone}>
          <Icon name={ver.tone === 'matcha' ? 'check' : ver.tone === 'kaki' ? 'alert' : 'info'} size={13} />
          <span>{ver.label}</span>
        </Chip>
        {d.stale && (
          <Chip small tone="kin">
            May be out of date
          </Chip>
        )}
        {d.superseded_by && (
          <Chip small tone="neutral">
            Replaced by a newer source
          </Chip>
        )}
      </div>
      <H id={`ev-${record.key}`} className="doc__title">
        {record.title}
      </H>
      <dl className="facts facts--tight">
        <div className="fact">
          <dt>Last checked</dt>
          <dd>{(lastCheckedOf(record.data) ?? d.checked_on) ? civil((lastCheckedOf(record.data) ?? d.checked_on)!, 'short') : 'Not known yet'}</dd>
        </div>
        <div className="fact">
          <dt>Supports</dt>
          <dd>{d.supported_scope || 'Not stated'}</dd>
        </div>
        <div className="fact fact--wide">
          <dt>Where it is</dt>
          <dd>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {d.url_or_reference}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="preline">{d.url_or_reference || 'Not recorded'}</span>
            )}
          </dd>
        </div>
        {d.refresh_trigger && (
          <div className="fact fact--wide">
            <dt>Check again when</dt>
            <dd className="preline">{d.refresh_trigger}</dd>
          </div>
        )}
      </dl>
      <DirectCheck data={record.data} showLink={!href} />
    </Card>
  );
}

function EvidenceTab() {
  return <DataGate>{({ idx }) => <EvidenceList idx={idx} />}</DataGate>;
}

function EvidenceList({ idx }: { idx: Indexes }) {
  const items = useMemo(() => idx.all.filter((r) => r.type === 'evidence').sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })), [idx]);
  const [only, setOnly] = useState<'all' | 'check'>('all');
  const needsCheck = (r: AnyRecord) => dataOf<EvidenceData>(r).stale || evidenceVerification(r.data, (x) => x).tone !== 'matcha';
  const shown = only === 'all' ? items : items.filter(needsCheck);
  return (
    <div className="stack">
      <h2 className="visually-hidden">Evidence</h2>
      <p className="muted">The sources behind the plan, how recently each was checked, and how well. Rules and dates are only as certain as their source.</p>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="book" title="No sources have been listed yet." />
        </Card>
      ) : (
        <>
          <FilterChips
            label="Which sources"
            value={only}
            onChange={setOnly}
            options={[
              { value: 'all', label: 'All', count: items.length },
              { value: 'check', label: 'Worth checking again', count: items.filter(needsCheck).length },
            ]}
          />
          <ul className="stack">
            {shown.map((r) => (
              <li key={r.id}>
                <EvidenceCard record={r} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ findings */

export function FindingCard({ record, idx, headingLevel = 3 }: { record: AnyRecord; idx: Indexes; headingLevel?: 2 | 3 }) {
  const d = dataOf<FindingData>(record);
  const [edit, setEdit] = useState(false);
  const sev = d.severity;
  const disp = d.disposition ?? 'open';
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Card as="article" className="finding" aria-labelledby={`fd-${record.key}`} tone={sev === 'critical' ? 'blocked' : sev === 'high' ? 'attention' : 'default'}>
      <div className="item__meta">
        {sev && (
          <Chip small tone={sev === 'critical' || sev === 'high' ? 'kaki' : sev === 'medium' ? 'kin' : 'neutral'}>
            <Icon name={sev === 'low' ? 'info' : 'alert'} size={13} />
            <span>{SEVERITY_LABEL[sev]}</span>
          </Chip>
        )}
        <Chip small tone={disp === 'accepted' ? 'matcha' : disp === 'open' ? 'ai' : 'neutral'}>
          {FINDING_DISPOSITION_LABEL[disp] ?? disp}
        </Chip>
        {d.reviewer && (
          <Chip small tone="neutral">
            {REVIEWER_LABEL[d.reviewer] ?? humanizeKey(d.reviewer)}
          </Chip>
        )}
      </div>
      <H id={`fd-${record.key}`} className="doc__title">
        {record.title}
      </H>
      {d.impact && <p className="preline">{d.impact}</p>}
      <dl className="facts facts--tight">
        {d.recommendation && (
          <div className="fact fact--wide">
            <dt>What was suggested</dt>
            <dd className="preline">{d.recommendation}</dd>
          </div>
        )}
        {d.finding_type && (
          <div className="fact">
            <dt>Kind of finding</dt>
            <dd>{FINDING_TYPE_LABEL[d.finding_type] ?? humanizeKey(d.finding_type)}</dd>
          </div>
        )}
        {d.due_or_trigger && (
          <div className="fact">
            <dt>When to look at it</dt>
            <dd>{d.due_or_trigger}</dd>
          </div>
        )}
        {d.evidence && (
          <div className="fact fact--wide">
            <dt>What it was based on</dt>
            <dd className="preline">{d.evidence}</dd>
          </div>
        )}
        {d.disposition_rationale && (
          <div className="fact fact--wide">
            <dt>Why {String(FINDING_DISPOSITION_LABEL[disp] ?? disp).toLowerCase()}</dt>
            <dd className="preline">{d.disposition_rationale}</dd>
          </div>
        )}
      </dl>
      <LinkedKeys keys={d.affected_records} idx={idx} label="Affects" />
      <div className="row-actions">
        <Button variant="secondary" small icon="pencil" onClick={() => setEdit(true)}>
          Decide what to do
        </Button>
      </div>
      {edit && <DispositionDialog record={record} onClose={() => setEdit(false)} />}
    </Card>
  );
}

function DispositionDialog({ record, onClose }: { record: AnyRecord; onClose: () => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const d = dataOf<FindingData>(record);
  const [disp, setDisp] = useState<FindingData['disposition']>(d.disposition ?? 'open');
  const [why, setWhy] = useState(d.disposition_rationale ?? '');
  const [startVersion] = useState(record.version);
  const [tried, setTried] = useState(false);
  const needsWhy = disp === 'deferred' || disp === 'rejected';
  const missing = needsWhy && why.trim() === '';
  const submit = async () => {
    setTried(true);
    if (missing) return;
    const ok = await w.run((v) => actions.patchRecord(record.id, v, { data: { disposition: disp, disposition_rationale: why.trim() || null } }), startVersion);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="What should happen with this finding?"
      description={record.title}
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
      <fieldset>
        <legend>Decision</legend>
        <div className="stack stack--tight">
          {(['open', 'accepted', 'deferred', 'rejected'] as const).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="disp" checked={disp === k} onChange={() => setDisp(k)} />
              <span className="choice__text">
                <span>{FINDING_DISPOSITION_LABEL[k]}</span>
                <span className="choice__hint">
                  {k === 'open' ? 'Not looked at yet.' : k === 'accepted' ? 'We agree and will act on it.' : k === 'deferred' ? 'Not now. Say when to look again.' : 'We chose not to act. Say why.'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Why?" hint={needsWhy ? 'Required, so it still makes sense later.' : 'Optional.'} error={tried && missing ? 'Please add a reason.' : null}>
        <TextArea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} />
      </Field>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}

function FindingsTab() {
  return <DataGate>{({ idx }) => <FindingList idx={idx} />}</DataGate>;
}

function FindingList({ idx }: { idx: Indexes }) {
  const items = useMemo(() => {
    const rank = (r: AnyRecord) => {
      const i = SEVERITY_ORDER.indexOf(dataOf<FindingData>(r).severity ?? 'low');
      return i < 0 ? 99 : i;
    };
    return idx.all.filter((r) => r.type === 'finding').sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [idx]);
  const [disp, setDisp] = useState<string>('all');
  const count = (k: string) => items.filter((r) => (dataOf<FindingData>(r).disposition ?? 'open') === k).length;
  const shown = items.filter((r) => disp === 'all' || (dataOf<FindingData>(r).disposition ?? 'open') === disp);
  return (
    <div className="stack">
      <h2 className="visually-hidden">Plan review findings</h2>
      <p className="muted">What the plan reviews found, and what the household decided to do about each one. Nothing here changes the plan by itself.</p>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="shield" title="No review findings have been recorded yet." />
        </Card>
      ) : (
        <>
          <FilterChips
            label="Decision"
            value={disp}
            onChange={setDisp}
            scroll
            options={[
              { value: 'all', label: 'All', count: items.length },
              ...(['open', 'accepted', 'deferred', 'rejected'] as const).map((k) => ({ value: k as string, label: FINDING_DISPOSITION_LABEL[k]!, count: count(k) })),
            ]}
          />
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="check" title="Nothing in this group." />
            </Card>
          ) : (
            <ul className="stack">
              {shown.map((r) => (
                <li key={r.id}>
                  <FindingCard record={r} idx={idx} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ container */

export function Contacts() {
  const { pathname } = useLocation();
  return (
    <div className="page contacts">
      <PageTitle kicker="Who might help, and what we rely on">Contacts & evidence</PageTitle>
      <nav aria-label="Contacts and evidence sections" className="segmented segmented--nav">
        {TABS.map((t) => {
          const active = t.end ? pathname === t.to || pathname === `${t.to}/` : pathname.startsWith(t.to);
          return (
            <Link key={t.to} to={t.to} className="segmented__btn" aria-current={active ? 'page' : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Routes>
        <Route index element={<ContactsTab />} />
        <Route path="evidence" element={<EvidenceTab />} />
        <Route path="findings" element={<FindingsTab />} />
        <Route path="*" element={<ContactsTab />} />
      </Routes>
    </div>
  );
}
