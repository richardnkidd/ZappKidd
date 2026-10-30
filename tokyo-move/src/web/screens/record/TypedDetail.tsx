import { useState, type ReactNode } from 'react';
import { zoneLabel } from '@shared/dates';
import { ANCHOR_CONFIDENCE_LABEL, JURISDICTION_LABEL, VERIFICATION_LABEL } from '@shared/labels';
import type { AnchorData, DeadlineRuleData, ExistingCommitmentData, ReviewSessionData } from '@shared/types';
import { AnchorDialog } from '../../components/AnchorDialog';
import { DateText, DeadlineBadge, VerificationNote } from '../../components/Badges';
import { Button } from '../../components/Controls';
import { LinkedKeys } from '../../components/LinkedKeys';
import { Card } from '../../components/Layout';
import { civil, instant } from '../../lib/format';
import { dataOf, type AnyRecord, type Decision, type Directory, type Indexes, type Question, type Risk } from '../../lib/records';
import { useData } from '../../state/data';
import { usePrefs } from '../../state/prefs';
import { PropertyCard } from '../arrival/Arrival';
import { ContactCard, DirectCheck, EvidenceCard, FindingCard } from '../contacts/Contacts';
import { DecisionCard } from '../decide/DecisionsTab';
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
  const d = dataOf<DeadlineRuleData>(record);
  return (
    <Card className="stack">
      <p>{d.label || record.title}</p>
      <div className="item__meta">
        {d.kind && <DeadlineBadge kind={d.kind} />}
        {d.jurisdiction && <span className="chip chip--neutral chip--sm">{JURISDICTION_LABEL[d.jurisdiction] ?? d.jurisdiction}</span>}
      </div>
      <VerificationNote verification={d.verification ?? 'not_verified'} kind={d.kind} />
      {d.verification === 'verified_official' && <p className="small muted">{VERIFICATION_LABEL.verified_official}{d.verified_on ? ` on ${civil(d.verified_on)}` : ''}.</p>}
      <dl className="facts facts--tight">
        <div className="fact fact--wide">
          <dt>When it applies</dt>
          <dd className="preline">{d.applies_when || 'Not stated'}</dd>
        </div>
        <div className="fact">
          <dt>Calendar date in</dt>
          <dd>{d.timezone ? zoneLabel(d.timezone) : 'Not stated'}</dd>
        </div>
        <div className="fact">
          <dt>Applies to this household</dt>
          <dd>{d.applies === 'yes' ? 'Yes' : d.applies === 'no' ? 'No' : 'Not sure yet'}</dd>
        </div>
        {d.notes && (
          <div className="fact fact--wide">
            <dt>Notes</dt>
            <dd className="preline">{d.notes}</dd>
          </div>
        )}
      </dl>
      <DirectCheck data={record.data} />
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
      {d.next_review_on && <p>Next review: {civil(d.next_review_on)}</p>}
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
          <DecisionCard d={record as unknown as Decision} idx={idx} dir={dir} today={today} />
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
          <QuestionCard q={record as unknown as Question} defaultOpen showLink={false} />
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
  return (
    <div className="record stack stack--loose">
      {body}
      {record.type !== 'note' && <Notes record={record} idx={idx} dir={dir} level={level} />}
      <SourceHistory record={record} idx={idx} dir={dir} />
    </div>
  );
}
