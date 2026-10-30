import { useState, type ReactNode } from 'react';
import { zoneLabel } from '@shared/dates';
import { ANCHOR_CONFIDENCE_LABEL, JURISDICTION_LABEL, PLAN_RULE_STATUS_LABEL, RULE_BOUND_LABEL, reviewerLabel, VERIFICATION_LABEL } from '@shared/labels';
import type { AnchorData, DeadlineRuleData, ExistingCommitmentData, ReviewSessionData } from '@shared/types';
import { AnchorDialog } from '../../components/AnchorDialog';
import { DateText, DeadlineBadge, VerificationNote } from '../../components/Badges';
import { Button } from '../../components/Controls';
import { LinkedKeys } from '../../components/LinkedKeys';
import { Card } from '../../components/Layout';
import { usePlain } from '../../components/People';
import { Prose } from '../../components/Prose';
import { RecordLink } from '../../components/RecordLink';
import { ruleCountSentence } from '../../lib/dateWords';
import { civil, instant, safeHref } from '../../lib/format';
import { dataOf, type AnyRecord, type Decision, type Directory, type Indexes, type Question, type Risk } from '../../lib/records';
import { useData } from '../../state/data';
import { usePrefs } from '../../state/prefs';
import { PropertyCard } from '../arrival/Arrival';
import { ContactCard, DirectCheck, EvidenceCard, FindingCard } from '../contacts/Contacts';
import { DecisionCard } from '../decide/DecisionCard';
import { QuestionCard } from '../decide/QuestionsTab';
import { RiskCard } from '../decide/RisksTab';
import { DocumentCard } from '../documents/Documents';
import { FutureOptionCard, futureKind } from '../future/Future';
import { CostDetail } from '../money/Money';
import { Notes } from './Notes';
import { SourceHistory } from './SourceHistory';

function AnchorDetail({ record, dir }: { record: AnyRecord; dir: Directory }) {
  const d = dataOf<AnchorData>(record);
  const [edit, setEdit] = useState(false);
  return (
    <Card className="stack">
      <p>{d.meaning || record.title}</p>
      <p>
        <DateText date={d.date ?? null} />
        {d.confidence && d.confidence !== 'awaiting' && <span className="chip chip--neutral chip--sm"> {ANCHOR_CONFIDENCE_LABEL[d.confidence] ?? d.confidence}</span>}
      </p>
      <p className="small muted">{d.traveler && d.traveler !== 'household' ? `${dir.nameOf(d.traveler)}’s own date.` : 'A household helper date: used only to coordinate.'}</p>
      {d.evidence && <p className="small muted preline">{d.evidence}</p>}
      <div className="row-actions">
        <Button variant="secondary" small icon="pencil" onClick={() => setEdit(true)}>
          {d.date ? 'Change date' : 'Enter date'}
        </Button>
      </div>
      {edit && <AnchorDialog record={record} onClose={() => setEdit(false)} />}
    </Card>
  );
}

function RuleDetail({ record, idx }: { record: AnyRecord; idx: Indexes }) {
  const d = dataOf<DeadlineRuleData & { reviewer?: string | null; plan_rule_status?: string | null; source_title?: string | null }>(record);
  const plain = usePlain();
  const anchor = idx.anchors.find((a) => (a.data?.code ?? a.key) === d.anchor);
  const counted = ruleCountSentence(d, anchor?.data?.meaning);
  const pair = d.window_pair ? (idx.byKey.get(d.window_pair) ?? idx.byId.get(`deadline_rule:${d.window_pair}`)) : null;
  const replacedBy = d.superseded_by ? (idx.byKey.get(d.superseded_by) ?? idx.byId.get(`deadline_rule:${d.superseded_by}`)) : null;
  const status = d.plan_rule_status ? (PLAN_RULE_STATUS_LABEL[d.plan_rule_status] ?? null) : null;
  const by = reviewerLabel(d.reviewer);
  const source = safeHref(d.source_url);
  return (
    <Card className="stack">
      <p>{d.label || record.title}</p>
      <div className="item__meta">
        {d.kind && <DeadlineBadge kind={d.kind} />}
        {d.jurisdiction && <span className="chip chip--neutral chip--sm">{JURISDICTION_LABEL[d.jurisdiction] ?? d.jurisdiction}</span>}
        {d.superseded_by && <span className="chip chip--neutral chip--sm">Replaced by a newer rule</span>}
      </div>
      <VerificationNote verification={d.verification ?? 'not_verified'} kind={d.kind} />
      {d.verification === 'verified_official' && <p className="small muted">{VERIFICATION_LABEL.verified_official}{d.verified_on ? ` on ${civil(d.verified_on)}` : ''}.</p>}
      <dl className="facts facts--tight">
        {counted && (
          <div className="fact fact--wide">
            <dt>How it’s counted</dt>
            <dd>
              {counted}
              {d.inclusive_note && (
                <span className="preline muted">
                  {' '}
                  <Prose text={d.inclusive_note} />
                </span>
              )}
            </dd>
          </div>
        )}
        {d.bound && RULE_BOUND_LABEL[d.bound] && (
          <div className="fact fact--wide">
            <dt>What the date means</dt>
            <dd>{RULE_BOUND_LABEL[d.bound]}</dd>
          </div>
        )}
        {pair && (
          <div className="fact fact--wide">
            <dt>Other end of the window</dt>
            <dd>
              <RecordLink id={pair.id}>{pair.title}</RecordLink>
            </dd>
          </div>
        )}
        {replacedBy && (
          <div className="fact fact--wide">
            <dt>Replaced by</dt>
            <dd>
              <RecordLink id={replacedBy.id}>{replacedBy.title}</RecordLink>
            </dd>
          </div>
        )}
        <div className="fact fact--wide">
          <dt>When it applies</dt>
          <dd className="preline">{d.applies_when ? plain(d.applies_when) : 'Not stated'}</dd>
        </div>
        <div className="fact">
          <dt>Calendar date in</dt>
          <dd>{d.timezone ? zoneLabel(d.timezone) : 'Not stated'}</dd>
        </div>
        <div className="fact">
          <dt>Applies to this household</dt>
          <dd>{d.applies === 'yes' ? 'Yes' : d.applies === 'no' ? 'No' : 'Not sure yet'}</dd>
        </div>
        {(status || by) && (
          <div className="fact">
            <dt>How it got here</dt>
            <dd>{[status, by].filter(Boolean).join(' · ')}</dd>
          </div>
        )}
        {d.notes && (
          <div className="fact fact--wide">
            <dt>Notes</dt>
            <dd className="preline">
              <Prose text={d.notes} />
            </dd>
          </div>
        )}
        {source && (
          <div className="fact fact--wide">
            <dt>Source</dt>
            <dd>
              <a href={source} target="_blank" rel="noopener noreferrer">
                {d.source_title || 'Open the source'}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </dd>
          </div>
        )}
      </dl>
      <DirectCheck data={record.data} showLink={!source} />
      <LinkedKeys keys={d.linked_records} idx={idx} label="Dates this for" />
    </Card>
  );
}

function CommitmentDetail({ record, idx }: { record: AnyRecord; idx: Indexes }) {
  const d = dataOf<ExistingCommitmentData>(record);
  return (
    <Card className="stack">
      <p className="preline">{d.meaning}</p>
      <p>
        <span className="item__label">Recorded date</span> <DateText date={d.recorded_date ?? null} state={d.historical ? 'historical' : undefined} />{' '}
        {d.deadline_kind && !d.historical && <DeadlineBadge kind={d.deadline_kind} />}
      </p>
      {d.evidence_caution && <p className="boundary preline">{d.evidence_caution}</p>}
      <LinkedKeys keys={d.linked_records} idx={idx} label="Linked work" />
    </Card>
  );
}

function ReviewDetail({ record, dir }: { record: AnyRecord; dir: Directory }) {
  const d = dataOf<ReviewSessionData>(record);
  const { zone } = usePrefs();
  return (
    <Card className="stack">
      <p className="muted">
        {d.completed_at ? `Finished ${instant(d.completed_at, zone, 'long')}` : d.started_at ? `Started ${instant(d.started_at, zone, 'long')}` : ''}
        {d.participants?.length ? ` · with ${d.participants.map((p) => dir.nameOf(p)).join(' and ')}` : ''}
      </p>
      {d.summary && <p className="preline">{d.summary}</p>}
      {d.next_review_on && !/next review/i.test(d.summary ?? '') && <p>Next review: {civil(d.next_review_on)}</p>}
    </Card>
  );
}

function NoteDetail({ record }: { record: AnyRecord }) {
  const d = dataOf<{ body?: string }>(record);
  return (
    <Card>
      <p className="preline">{d.body}</p>
    </Card>
  );
}

const TYPED = new Set(['decision', 'risk', 'question', 'document', 'cost', 'contact', 'evidence', 'finding', 'property', 'future_option', 'anchor', 'deadline_rule', 'existing_commitment', 'review_session', 'note']);

export function hasTypedDetail(record: AnyRecord): boolean {
  if (!TYPED.has(record.type)) return false;
  return record.type !== 'future_option' || futureKind(record) === 'option';
}

/**
 * Dedicated, plain-language views for every record type, so a link to any record lands on something readable.
 * Returns null for types that use the generic labelled-facts view.
 */
export function TypedDetail({ record, idx, dir, level }: { record: AnyRecord; idx: Indexes; dir: Directory; level: 2 | 3 }) {
  const { today } = useData();
  let body: ReactNode = null;
  switch (record.type) {
    case 'decision':
      body = (
        <ul>
          <DecisionCard d={record as unknown as Decision} idx={idx} dir={dir} today={today} startOpen hideTitle level={(level - 1) as 1 | 2} />
        </ul>
      );
      break;
    case 'risk':
      body = (
        <ul>
          <RiskCard r={record as unknown as Risk} idx={idx} />
        </ul>
      );
      break;
    case 'question':
      body = (
        <ul>
          <QuestionCard q={record as unknown as Question} idx={idx} defaultOpen showLink={false} />
        </ul>
      );
      break;
    case 'document':
      body = <DocumentCard record={record} idx={idx} dir={dir} headingLevel={level} />;
      break;
    case 'cost':
      body = <CostDetail record={record} />;
      break;
    case 'contact':
      body = <ContactCard record={record} idx={idx} headingLevel={level} />;
      break;
    case 'evidence':
      body = <EvidenceCard record={record} headingLevel={level} />;
      break;
    case 'finding':
      body = <FindingCard record={record} idx={idx} headingLevel={level} />;
      break;
    case 'property':
      body = <PropertyCard record={record} idx={idx} headingLevel={level} />;
      break;
    case 'future_option':
      body = <FutureOptionCard record={record} headingLevel={level} />;
      break;
    case 'anchor':
      body = <AnchorDetail record={record} dir={dir} />;
      break;
    case 'deadline_rule':
      body = <RuleDetail record={record} idx={idx} />;
      break;
    case 'existing_commitment':
      body = <CommitmentDetail record={record} idx={idx} />;
      break;
    case 'review_session':
      body = <ReviewDetail record={record} dir={dir} />;
      break;
    case 'note':
      body = <NoteDetail record={record} />;
      break;
    default:
      body = null;
  }
  // A page's headings never skip a level: types whose body carries no heading of its own get a hidden one, so the
  // "Source & history" heading below is never an h3 straight after the page's h1.
  const needsHeading = level === 2 && (record.type === 'decision' || record.type === 'risk' || record.type === 'question' || record.type === 'note');
  return (
    <div className="record stack stack--loose">
      {needsHeading && <h2 className="visually-hidden">{record.type === 'note' ? 'Note' : 'Details'}</h2>}
      {body}
      {record.type !== 'note' && <Notes record={record} idx={idx} dir={dir} level={level} />}
      <SourceHistory record={record} idx={idx} dir={dir} />
    </div>
  );
}
