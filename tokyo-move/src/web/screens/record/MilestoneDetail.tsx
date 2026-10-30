import { useMemo, useState } from 'react';
import { zoneLabel } from '@shared/dates';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { dependencyChain, downstreamOf } from '@shared/readiness';
import {
  JURISDICTION_LABEL,
  NOT_KNOWN,
  PHASE_LABEL,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  SYNC_STATE_LABEL,
  WORK_STATUS_LABEL,
} from '@shared/labels';
import type { Deadline, DeadlineRuleData, OwnerRef, TaskLink, TravelerProgress as TravelerProgressData } from '@shared/types';
import { DateText, DeadlineBadge, OptionalTag, PriorityTag, StatusBadge, SyncBadge, VerificationNote } from '../../components/Badges';
import { Button } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import { Fact, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge, useDir, usePlain } from '../../components/People';
import { LinkedDates } from '../../components/LinkedDates';
import { RecordLink } from '../../components/RecordLink';
import { civil, dayIn, instant, safeHref } from '../../lib/format';
import { deadlineVerification } from '../../lib/home';
import { dataOf, type AnyRecord, type Directory, type Indexes, type Milestone } from '../../lib/records';
import { attempt } from '../../lib/safe';
import { useData } from '../../state/data';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';
import { ProposeActionDialog, StatusDialog } from './dialogs';
import { InlineEdit } from './InlineEdit';
import { Notes } from './Notes';
import { SourceHistory } from './SourceHistory';
import { ConflictBanner } from '../../components/Feedback';

type Level = 2 | 3;

/** A sub-heading one level below the section headings (h3 on the page, h4 in the side panel). */
function SubHead({ level, children }: { level: Level; children: React.ReactNode }) {
  const H = level === 2 ? 'h3' : 'h4';
  return <H className="subhead">{children}</H>;
}

/* ------------------------------------------------------------------ deadline facts */

function DeadlineFacts({ deadline, state, idx, dir, today, computed }: { deadline: Deadline; state?: ComputedDeadline['state']; idx: Indexes; dir: Directory; today: string; computed?: ComputedDeadline }) {
  const verification = computed ? deadlineVerification(computed, idx) : deadline.kind === 'legal' && !deadline.verified_on ? ('not_verified' as DeadlineRuleData['verification']) : null;
  const traveler =
    deadline.traveler === 'household' || deadline.traveler === 'each_adult' || !deadline.traveler
      ? deadline.traveler === 'each_adult'
        ? 'Each adult separately'
        : 'Whole household'
      : dir.nameOf(deadline.traveler);
  return (
    <div className="deadline-block">
      <p className="deadline-block__head">
        <DateText date={deadline.date} today={today} state={state} kind={deadline.kind} /> <DeadlineBadge kind={deadline.kind} />
      </p>
      <VerificationNote verification={verification} kind={deadline.kind} />
      <dl className="facts facts--tight">
        <Fact label="Why this date" wide>
          <span className="preline">{deadline.basis || NOT_KNOWN}</span>
        </Fact>
        <Fact label="Applies in">{deadline.jurisdiction ? (JURISDICTION_LABEL[deadline.jurisdiction] ?? deadline.jurisdiction) : NOT_KNOWN}</Fact>
        <Fact label="Calendar date in">{zoneLabel(deadline.timezone)}</Fact>
        <Fact label="Last checked">{deadline.verified_on ? civil(deadline.verified_on, 'short') : 'Not checked yet'}</Fact>
        <Fact label="For">{traveler}</Fact>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ per-traveler progress */

export function TravelerProgress({ record, level }: { record: AnyRecord; level: Level }) {
  const dir = useDir();
  const progress = dataOf<{ traveler_progress?: Record<string, TravelerProgressData> }>(record).traveler_progress;
  const [target, setTarget] = useState<string | null>(null);
  if (!progress || Object.keys(progress).length === 0) return null;
  return (
    <Section title="Each person’s part" headingLevel={level} intro="This is shared work, but each person’s part moves on its own.">
      <ul className="progress-list">
        {Object.entries(progress).map(([personId, p]) => (
          <li key={personId} className="progress">
            <div className="progress__who">
              <PersonBadge person={dir.personById(personId)} size={28} />
              <span className="progress__name">{dir.nameOf(personId)}</span>
              <span className="faint" aria-hidden="true">·</span>
              <StatusBadge status={p.status} small />
            </div>
            {p.reason && <p className="small muted preline">{p.reason}</p>}
            {p.evidence?.length > 0 && (
              <ul className="evidence small">
                {p.evidence.map((e, i) => {
                  const href = safeHref(e.link);
                  return (
                    <li key={i}>
                      Done: {e.summary}
                      {href && (
                        <>
                          {' '}
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            Open proof<span className="visually-hidden"> (opens in a new tab)</span>
                          </a>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <Button variant="secondary" small onClick={() => setTarget(personId)} aria-label={`Update ${dir.nameOf(personId)}’s progress`}>
              Update
            </Button>
          </li>
        ))}
      </ul>
      <StatusDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        record={record}
        traveler={target}
        currentStatus={target ? (progress[target]?.status ?? record.status) : record.status}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ dependencies */

function Dependencies({ record, idx, dir, level }: { record: Milestone; idx: Indexes; dir: Directory; level: Level }) {
  const chain = useMemo(() => attempt(() => dependencyChain(record.key, idx.all)), [record.key, idx]);
  const downstream = useMemo(() => attempt(() => downstreamOf(record.key, idx.all)), [record.key, idx]);
  const scope = record.data?.dependency_scope ?? {};
  const direct = record.data?.dependencies ?? [];

  const links = chain.ok
    ? chain.value.map((c) => ({ key: c.key, title: c.title, met: c.met, depth: c.depth, status: c.status }))
    : direct.map((k) => {
        const r = idx.byKey.get(k);
        return { key: k, title: r?.title ?? k, met: r ? ['completed', 'not_applicable', 'eliminated'].includes(r.status) : false, depth: 1, status: r?.status ?? '' };
      });
  const related = ((record.data as { related?: unknown })?.related ?? []) as unknown;
  const relatedKeys = Array.isArray(related) ? related.filter((x): x is string => typeof x === 'string') : [];

  return (
    <Section title="What this depends on" headingLevel={level}>
      {links.length === 0 ? (
        <p className="muted">Nothing has to happen first.</p>
      ) : (
        <ol className="dep-chain">
          {links.map((l) => {
            const rec = idx.byKey.get(l.key);
            const only = scope[l.key];
            return (
              <li key={l.key} className={`dep dep--${l.met ? 'met' : 'unmet'}`} style={{ marginLeft: `${Math.max(0, l.depth - 1) * 16}px` }}>
                <Icon name={l.met ? 'check' : 'hourglass'} size={16} />
                <span>
                  {rec ? <RecordLink id={rec.id}>{l.title}</RecordLink> : l.title}
                  <span className="small faint"> — {l.met ? 'done' : l.status ? (WORK_STATUS_LABEL[l.status as keyof typeof WORK_STATUS_LABEL] ?? 'not done yet') : 'not done yet'}</span>
                  {only && only.length > 0 && <span className="chip chip--neutral chip--sm">Only for {only.map((p) => dir.nameOf(p)).join(' and ')}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {record.data?.dependency_note && <p className="small muted preline">{record.data.dependency_note}</p>}
      {relatedKeys.length > 0 && (
        <p className="small muted">
          Related (nothing waits on these):{' '}
          {relatedKeys.map((k, i) => {
            const r = idx.byKey.get(k);
            return (
              <span key={k}>
                {i > 0 && ', '}
                {r ? <RecordLink id={r.id}>{r.title}</RecordLink> : k}
              </span>
            );
          })}
        </p>
      )}
      {downstream.ok && downstream.value.length > 0 && (
        <div className="downstream">
          <SubHead level={level}>Work that depends on this</SubHead>
          <ul className="plain-list">
            {downstream.value.map((k) => {
              const r = idx.byKey.get(k);
              return (
                <li key={k}>{r ? <RecordLink id={r.id}>{r.title}</RecordLink> : k}</li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ linked tasks */

function LinkedTasks({ record, idx, level }: { record: Milestone; idx: Indexes; level: Level }) {
  const { actions } = useSnapshot();
  const { zone } = usePrefs();
  const [propose, setPropose] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tasks = idx.taskLinksByRecord.get(record.id) ?? [];

  const retry = async (t: TaskLink) => {
    setRetrying(t.id);
    setError(null);
    try {
      await actions.retryTask(t.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Section title="Tasks on your task list" count={tasks.length || undefined} headingLevel={level}>
      {tasks.length === 0 ? (
        <p className="muted">Nothing on your task list is linked to this yet.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((t) => (
            <li key={t.id} className="task">
              <p className="task__title">{t.title}</p>
              <div className="item__meta">
                <OwnerChip owner={t.owner} compact />
                <SyncBadge link={t} />
                {t.due ? <DateText date={t.due} /> : <span className="faint small">No due date</span>}
              </div>
              {t.sync_state === 'pending_capture' && (
                <p className="small muted">Waiting to be added to your task list. Nothing has been created there yet.</p>
              )}
              {t.sync_state === 'snapshot' && (
                <p className="small muted">A read-only copy{t.last_synced_at ? ` from ${instant(t.last_synced_at, zone, 'short')}` : ''}. Changes happen in your task list.</p>
              )}
              {(t.sync_state === 'error' || t.sync_state === 'conflict') && (
                <p className="small">
                  {SYNC_STATE_LABEL[t.sync_state]}.{t.last_error ? ` ${t.last_error}` : ''}{' '}
                  <Button variant="secondary" small busy={retrying === t.id} onClick={() => retry(t)}>
                    Try again
                  </Button>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="field__error" role="alert">{error}</p>}
      <div>
        <Button variant="secondary" icon="plus" onClick={() => setPropose(true)}>
          Propose an action
        </Button>
      </div>
      <ProposeActionDialog open={propose} onClose={() => setPropose(false)} record={record} defaultTitle={record.data?.next_action ?? ''} />
    </Section>
  );
}

/* ------------------------------------------------------------------ main */

export function MilestoneDetail({ record, idx, dir, level }: { record: Milestone; idx: Indexes; dir: Directory; level: Level }) {
  const { actions } = useSnapshot();
  const plain = usePlain();
  const { zone } = usePrefs();
  const { today, deadlinesByRecord } = useData();
  const d = record.data ?? ({} as Milestone['data']);
  const [statusOpen, setStatusOpen] = useState(false);
  const accept = useWrite();

  // Only this milestone's own dates (record or rule). A linked task's or commitment's date is shown separately below.
  const engine = (deadlinesByRecord.get(record.id) ?? []).filter((x) => x.kind !== 'review_date' && (x.source === 'record' || x.source === 'rule'));
  const ownDeadline = d.deadline;
  const hasDates = engine.length > 0 || Boolean(ownDeadline);

  const ownerOptions = [
    ...dir.adults.map((a) => ({ value: a.id, label: a.display_name })),
    { value: 'together', label: 'Together' },
    { value: 'unassigned', label: 'Not decided yet' },
  ];
  const ownerValue = record.owner ?? 'unassigned';

  const scope = d.traveler_scope ?? [];
  const evidence = d.completion_evidence ?? [];

  return (
    <div className="record stack stack--loose">
      <div className="record__summary stack">
        <div className="item__meta">
          <StatusBadge status={record.status} />
          <OwnerChip owner={record.owner} proposed={record.owner_proposed} />
          {d.optional_future_work && <OptionalTag />}
          {d.phase && <span className="chip chip--neutral chip--sm">{PHASE_LABEL[d.phase]}</span>}
        </div>
        {d.status_reason && (record.status === 'blocked' || record.status === 'eliminated' || record.status === 'not_applicable' || record.status === 'waiting_external') && (
          <p className="reason preline">
            <strong>{record.status === 'blocked' ? 'Why it’s blocked: ' : record.status === 'waiting_external' ? 'Waiting for: ' : 'Why: '}</strong>
            {plain(d.status_reason)}
          </p>
        )}
        {d.conditional && (
          <p className="muted">
            <Icon name="info" size={16} /> Only if: {d.conditional}
          </p>
        )}
        <div className="row-actions">
          <Button variant="primary" icon="check" onClick={() => setStatusOpen(true)}>
            Change status
          </Button>
        </div>
      </div>

      <Section title="Next action" headingLevel={level}>
        <InlineEdit
          label="Next action"
          value={d.next_action ?? ''}
          display={d.next_action ? <p className="preline">{plain(d.next_action)}</p> : <p className="muted">No next action written yet.</p>}
          input="textarea"
          version={record.version}
          dirtyKey={`next:${record.id}`}
          onSave={(draft, v) => actions.patchRecord(record.id, v, { data: { next_action: draft } })}
        />
      </Section>

      <TravelerProgress record={record} level={level} />

      <Section title="Who and when" headingLevel={level}>
        <dl className="facts">
          <Fact label="Accountable owner">
            <InlineEdit
              label="Owner"
              value={ownerValue}
              display={
                <span className="row">
                  <OwnerChip owner={record.owner} proposed={record.owner_proposed} />
                  {record.owner_proposed && record.owner && (
                    <Button
                      variant="secondary"
                      small
                      busy={accept.busy}
                      onClick={() => accept.run((v) => actions.patchRecord(record.id, v, { owner_proposed: false }), record.version)}
                    >
                      Accept owner
                    </Button>
                  )}
                </span>
              }
              input="select"
              options={ownerOptions}
              version={record.version}
              dirtyKey={`owner:${record.id}`}
              onSave={(draft, v) => actions.patchRecord(record.id, v, { owner: draft as OwnerRef, owner_proposed: false })}
            />
            {record.owner_proposed && <p className="small muted">Proposed — it isn’t settled until someone accepts it.</p>}
            {accept.error && <p className="field__error" role="alert">{accept.error}</p>}
            {accept.conflict && (
              <ConflictBanner conflict={accept.conflict} busy={accept.busy} onKeepTheirs={accept.keepTheirs} onUseMine={() => void accept.useMine()} />
            )}
          </Fact>
          <Fact label="Working with">
            {(d.collaborators ?? []).length > 0 ? (
              <ul className="chips">
                {d.collaborators!.map((c) => (
                  <li key={c}>
                    <span className="chip chip--neutral">{c}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">{NOT_KNOWN}</span>
            )}
          </Fact>
          <Fact label="Priority">
            <InlineEdit
              label="Priority"
              value={d.priority ?? ''}
              display={<PriorityTag priority={d.priority} />}
              input="select"
              options={[{ value: '', label: 'Not set' }, ...PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]}
              version={record.version}
              dirtyKey={`prio:${record.id}`}
              onSave={(draft, v) => actions.patchRecord(record.id, v, { data: { priority: draft || null } })}
            />
          </Fact>
          <Fact label="Effort">{d.effort_estimate || <span className="muted">{NOT_KNOWN}</span>}</Fact>
          <Fact label="For">
            {scope.length === 0 ? 'Whole household' : scope.map((p) => dir.nameOf(p)).join(' and ')}
          </Fact>
          <Fact label="Target window">{d.target_window || <span className="muted">{NOT_KNOWN}</span>}</Fact>
        </dl>
      </Section>

      <Section title="Dates" headingLevel={level}>
        {!hasDates && !d.review_date && <p className="muted"><DateText date={null} /> — no deadline of its own is attached to this yet.</p>}
        {engine.length > 0
          ? engine.map((c) => (
              <div key={c.id} className="stack stack--tight">
                {engine.length > 1 && <SubHead level={level}>{c.label}</SubHead>}
                <DeadlineFacts deadline={c.deadline} state={c.state} idx={idx} dir={dir} today={today} computed={c} />
                {c.approximate && <p className="small muted">Approximate: public holidays aren’t counted. Check before relying on it.</p>}
              </div>
            ))
          : ownDeadline && <DeadlineFacts deadline={ownDeadline} idx={idx} dir={dir} today={today} />}
        <LinkedDates milestoneId={record.id} today={today} />
        {d.review_date && (
          <div className="review-line">
            <p>
              <DeadlineBadge kind="review_date" /> <DateText date={d.review_date} today={today} />
            </p>
            <p className="small muted">A checkpoint to look at this again. It is not a deadline.</p>
          </div>
        )}
      </Section>

      <Section title="How we’ll know it’s done" headingLevel={level}>
        <p className="preline">{d.completion_criteria || <span className="muted">{NOT_KNOWN}</span>}</p>
        {d.contingency && (
          <p className="small muted preline">
            <strong>If it doesn’t go to plan:</strong> {d.contingency}
          </p>
        )}
        {evidence.length > 0 && (
          <div className="evidence-block">
            <SubHead level={level}>What shows it’s done</SubHead>
            <ul className="evidence">
              {evidence.map((e, i) => {
                const href = safeHref(e.link);
                return (
                  <li key={i}>
                    <span className="preline">{e.summary}</span>
                    <span className="small faint"> — {dir.nameOf(e.by)}, {civil(dayIn(e.at, zone), 'short')}</span>
                    {href && (
                      <>
                        {' '}
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          Open proof<span className="visually-hidden"> (opens in a new tab)</span>
                        </a>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Section>

      <Dependencies record={record} idx={idx} dir={dir} level={level} />
      <LinkedTasks record={record} idx={idx} level={level} />
      <Notes record={record} idx={idx} dir={dir} level={level} />
      <SourceHistory record={record} idx={idx} dir={dir} />

      <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} record={record} currentStatus={record.status} />
    </div>
  );
}

