import { useMemo, useState } from 'react';
import { diffDays, zoneLabel } from '@shared/dates';
import { displayNext, displayTitle, keyLookup, stripCodes } from '@shared/plain';
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
import { DateText, LineTime, DeadlineBadge, DeadlineWhen, OptionalTag, PriorityTag, StatusBadge, SyncBadge, VerificationNote } from '../../components/Badges';
import { More } from '../../components/More';
import { DeadlineRow } from '../../components/DeadlineRow';
import { Prose } from '../../components/Prose';
import { SegmentedControl } from '../../components/Controls';
import { TaskDateLine } from '../../components/LinkedDates';
import { AppliesToControl } from './AppliesTo';
import { Button } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import { Fact, Section } from '../../components/Layout';
import { OwnerChip, PersonBadge, useDir, usePlain } from '../../components/People';
import { LinkedDates } from '../../components/LinkedDates';
import { RecordLink } from '../../components/RecordLink';
import { civil, dayIn, instant, safeHref } from '../../lib/format';
import { deadlineVerification } from '../../lib/home';
import { dateLine } from '../../lib/dateLine';
import { whenFor, type WhenCandidate } from '../../lib/when';
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
  const plain = usePlain();
  const verification = computed ? deadlineVerification(computed, idx) : deadline.kind === 'legal' && !deadline.verified_on ? ('not_verified' as DeadlineRuleData['verification']) : null;
  const rule = computed?.rule_id ? (idx.byKey.get(computed.rule_id) ?? null) : null;
  const counted = rule ? dataOf<DeadlineRuleData>(rule).inclusive_note : null;
  const traveler =
    deadline.traveler === 'household' || deadline.traveler === 'each_adult' || !deadline.traveler
      ? deadline.traveler === 'each_adult'
        ? 'Each adult separately'
        : 'Whole household'
      : dir.nameOf(deadline.traveler);
  return (
    <div className="deadline-block">
      <p className="deadline-block__head">
        {computed ? (
          <DeadlineWhen d={computed} today={today} />
        ) : (
          <DateText date={deadline.date} today={today} state={state} prefix={deadline.kind === 'legal' || deadline.kind === 'contractual' ? 'Due by ' : ''} />
        )}{' '}
        <DeadlineBadge kind={deadline.kind} />
      </p>
      <VerificationNote verification={verification} kind={deadline.kind} />
      {counted && (
        <p className="small muted preline">
          <strong>How it’s counted:</strong> {plain(counted)}
        </p>
      )}
      <dl className="facts facts--tight">
        <Fact label="Why this date" wide>
          <span className="preline">{plain(deadline.basis) || NOT_KNOWN}</span>
        </Fact>
        <Fact label="Applies in">{deadline.jurisdiction ? (JURISDICTION_LABEL[deadline.jurisdiction] ?? deadline.jurisdiction) : NOT_KNOWN}</Fact>
        <Fact label="Calendar date in">{zoneLabel(deadline.timezone)}</Fact>
        <Fact label="Last checked">{deadline.verified_on ? civil(deadline.verified_on, 'weekday') : 'Not checked yet'}</Fact>
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
    <Section title="Each person’s part" headingLevel={level}>
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
  const plain = usePlain();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const scopePeople = (record.data?.traveler_scope ?? []).filter((p) => dir.personById(p));
  // A shared record has one chain per traveler: one adult's route must never appear as a step of the other adult's release.
  // Records such as "<step>.<person>" already name their traveler; the engine infers it.
  const named = /\.[a-z0-9_-]+$/i.test(record.key);
  const [picked, setPicked] = useState<string | null>(null);
  const who = named ? null : scopePeople.length > 1 ? (picked && scopePeople.includes(picked) ? picked : scopePeople.includes(dir.me?.id ?? '') ? dir.me!.id : scopePeople[0]!) : (scopePeople[0] ?? null);
  const chain = useMemo(() => attempt(() => dependencyChain(record.key, idx.all, who)), [record.key, idx, who]);
  const downstream = useMemo(() => attempt(() => downstreamOf(record.key, idx.all, who)), [record.key, idx, who]);
  const scope = record.data?.dependency_scope ?? {};
  const direct = record.data?.dependencies ?? [];

  const links = chain.ok
    ? chain.value.map((c) => ({ key: c.key, title: ((r) => (r ? displayTitle(r) : c.title))(idx.byKey.get(c.key)), met: c.met, depth: c.depth, status: c.status, reason: (c as { reason?: string }).reason ?? null }))
    : direct
        .filter((k) => !who || !scope[k] || scope[k]!.includes(who))
        .map((k) => {
          const r = idx.byKey.get(k);
          return { key: k, title: r ? displayTitle(r) : k, met: r ? ['completed', 'not_applicable', 'eliminated'].includes(r.status) : false, depth: 1, status: r?.status ?? '', reason: null as string | null };
        });
  const related = ((record.data as { related?: unknown })?.related ?? []) as unknown;
  const relatedKeys = Array.isArray(related) ? related.filter((x): x is string => typeof x === 'string') : [];
  const whoName = who ? dir.nameOf(who) : null;

  return (
    <More label="What it waits on" className="rec-more">
    <Section title="What it waits on" headingLevel={level} className="section--bare">
      {scopePeople.length > 1 && !named && (
        <SegmentedControl label="Whose steps" value={who ?? ''} onChange={setPicked} options={scopePeople.map((p) => ({ value: p, label: dir.nameOf(p) }))} />
      )}
      {links.length === 0 ? (
        <p className="muted">{whoName ? `Nothing has to happen first for ${whoName}.` : 'Nothing has to happen first.'}</p>
      ) : (
        <ol className="dep-chain">
          {links.map((l) => {
            const rec = idx.byKey.get(l.key);
            const only = scope[l.key];
            return (
              <li key={l.key} className={`dep dep--${l.met ? 'met' : 'unmet'}`} style={{ marginLeft: `${Math.max(0, l.depth - 1) * 16}px` }}>
                <Icon name={l.met ? 'check' : 'hourglass'} size={16} />
                <span>
                  {rec ? <RecordLink id={rec.id}>{displayTitle(rec, lookup)}</RecordLink> : stripCodes(l.title, lookup)}
                  <span className="small faint"> — {l.met ? 'done' : l.status ? (WORK_STATUS_LABEL[l.status as keyof typeof WORK_STATUS_LABEL] ?? 'not done yet') : 'not done yet'}</span>
                  {only && only.length > 0 && <span className="chip chip--neutral chip--sm">Only for {only.map((p) => dir.nameOf(p)).join(' and ')}</span>}
                  {l.reason && <span className="dep__reason small muted preline">{plain(l.reason)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {record.data?.dependency_note && (
        <p className="small muted preline">
          <Prose text={record.data.dependency_note} />
        </p>
      )}
      {relatedKeys.length > 0 && (
        <p className="small muted">
          Related:{' '}
          {relatedKeys.map((k, i) => {
            const r = idx.byKey.get(k);
            return (
              <span key={k}>
                {i > 0 && ', '}
                {r ? <RecordLink id={r.id}>{displayTitle(r, lookup)}</RecordLink> : null}
              </span>
            );
          })}
        </p>
      )}
      {downstream.ok && downstream.value.length > 0 && (
        <div className="downstream">
          <SubHead level={level}>Work that waits on this</SubHead>
          <ul className="plain-list">
            {downstream.value.map((k) => {
              const r = idx.byKey.get(k);
              return r ? <li key={k}><RecordLink id={r.id}>{displayTitle(r, lookup)}</RecordLink></li> : null;
            })}
          </ul>
        </div>
      )}
    </Section>
    </More>
  );
}

/* ------------------------------------------------------------------ does this apply? */

function ConditionalAnswers({ record, dir, level }: { record: Milestone; dir: Directory; level: Level }) {
  const d = record.data;
  const answered = Object.keys(d?.applies_to ?? {});
  if (!d?.conditional && answered.length === 0) return null;
  const people = (d.traveler_scope?.length ? d.traveler_scope : dir.adults.map((a) => a.id)).filter((p) => dir.personById(p));
  return (
    <Section title="Does this apply?" headingLevel={level} intro={d.conditional ? `Only if: ${d.conditional}` : undefined}>
      <div className="stack">
        {people.map((p) => (
          <AppliesToControl key={p} record={record} personId={p} name={dir.nameOf(p)} />
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ linked tasks */

function LinkedTasks({ record, idx, dir, level }: { record: Milestone; idx: Indexes; dir: Directory; level: Level }) {
  const { actions, snapshot } = useSnapshot();
  const { zone } = usePrefs();
  const { today } = useData();
  const [propose, setPropose] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const all = idx.taskLinksByRecord.get(record.id) ?? [];
  const proposed = all.filter((t) => t.sync_state === 'pending_capture');
  const onList = all.filter((t) => t.sync_state !== 'pending_capture');
  const canWrite = snapshot?.settings?.task_adapter?.can_write ?? false;
  const asOfDay = dayIn(snapshot?.settings?.task_adapter?.as_of ?? null, zone);

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
    <More label={`Task list${onList.length + proposed.length ? ` (${onList.length + proposed.length})` : ''}`} className="rec-more">
    <Section title="Tasks on your task list" count={onList.length || undefined} headingLevel={level} className="section--bare">
      {onList.length === 0 ? (
        proposed.length === 0 && <p className="muted">Nothing linked yet.</p>
      ) : (
        <ul className="task-list">
          {onList.map((t) => (
            <li key={t.id} className="task">
              <p className="task__title">{t.title}</p>
              <div className="item__meta">
                <OwnerChip owner={t.owner} compact />
                <SyncBadge link={t} />
                {t.due ? <TaskDateLine t={t} today={today} asOfDay={asOfDay} /> : <span className="faint small">No due date</span>}
              </div>
              {t.sync_state === 'snapshot' && (
                <p className="small muted">A read-only copy{t.last_synced_at ? ` from ${instant(t.last_synced_at, zone, 'short')}` : ''}.</p>
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
      {proposed.length > 0 && (
        <div className="stack stack--tight">
          <SubHead level={level}>Waiting to be added to your task list</SubHead>
          <ul className="task-list">
            {proposed.map((t) => (
              <li key={t.id} className="task">
                <p className="task__title">{t.title}</p>
                <div className="item__meta">
                  <OwnerChip owner={t.owner} compact />
                  {t.due &&
                    (today && diffDays(today, t.due) < 0 ? (
                      <span className="faint">
                        Its date was <time dateTime={t.due}>{civil(t.due, 'weekday')}</time>
                      </span>
                    ) : (
                      <DateText date={t.due} today={today} />
                    ))}
                </div>
                {canWrite ? (
                  <div className="row-actions" style={{ marginTop: 0 }}>
                    <Button variant="secondary" small busy={retrying === t.id} onClick={() => retry(t)}>
                      Mark as added
                    </Button>
                  </div>
                ) : (
                  <p className="small muted">Kadode can’t add this. {t.owner && t.owner !== 'together' && t.owner !== 'unassigned' ? dir.nameOf(t.owner) : 'Whoever owns it'} adds it by hand.</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="field__error" role="alert">{error}</p>}
      <div>
        <Button variant="secondary" icon="plus" onClick={() => setPropose(true)}>
          Propose an action
        </Button>
      </div>
      <ProposeActionDialog open={propose} onClose={() => setPropose(false)} record={record} defaultTitle={displayNext(record, keyLookup(idx.byKey)) ?? ''} />
    </Section>
    </More>
  );
}

/* ------------------------------------------------------------------ main */

/** One date, in words and in the one shared format. */
function WhenText({ c, today }: { c: WhenCandidate; today: string }) {
  // A check-in is a reminder to look again, never a deadline: it never reads as late.
  if (c.kind === 'review_date') {
    return (
      <span className="rec-when">
        <DeadlineBadge kind="review_date" />
        <LineTime date={c.date} line={dateLine(c.date, today, { open: false })} />
      </span>
    );
  }
  return (
    <span className="rec-when">
      {c.deadline ? <DeadlineWhen d={c.deadline} today={today} /> : <DateText date={c.date} today={today} state={c.state ?? undefined} />}
      {c.kind === 'task' ? <span className="faint"> Task list</span> : <DeadlineBadge kind={c.kind} />}
    </span>
  );
}

export function MilestoneDetail({ record, idx, dir, level }: { record: Milestone; idx: Indexes; dir: Directory; level: Level }) {
  const { actions } = useSnapshot();
  const plain = usePlain();
  const { zone } = usePrefs();
  const { today, deadlinesByRecord, deadlinesByLinkedKey } = useData();
  const d = record.data ?? ({} as Milestone['data']);
  const [statusOpen, setStatusOpen] = useState(false);
  const accept = useWrite();
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);

  // Only this milestone's own dates (record or rule). A linked task's or commitment's date is shown separately below.
  const engine = (deadlinesByRecord.get(record.id) ?? []).filter((x) => x.kind !== 'review_date' && (x.source === 'record' || x.source === 'rule'));
  const ownDeadline = d.deadline;
  // Rule-derived dates that point at this record (one per traveler where the rule runs per person).
  const shownIds = new Set(engine.map((x) => x.id));
  const ruleDates = (deadlinesByLinkedKey.get(record.key) ?? []).filter((x) => !shownIds.has(x.id) && x.applies !== 'no' && x.state !== 'not_applicable');
  const hasDates = engine.length > 0 || Boolean(ownDeadline) || ruleDates.length > 0;
  const when = whenFor(record, idx, deadlinesByRecord.get(record.id), today);
  const taskDates = (idx.taskLinksByRecord.get(record.id) ?? []).some((t) => t.status === 'open' && t.due);
  const commitments = (idx.commitmentsByMilestoneKey.get(record.key) ?? []).some((c) => c.data?.recorded_date);
  // "No date yet" is said only when there truly is none, never above a recorded date.
  const noDates = !when.primary && !hasDates && !d.review_date && !taskDates && !commitments;

  const ownerOptions = [
    ...dir.adults.map((a) => ({ value: a.id, label: a.display_name })),
    { value: 'together', label: 'Together' },
    { value: 'unassigned', label: 'Not decided yet' },
  ];
  const ownerValue = record.owner ?? 'unassigned';

  const scope = d.traveler_scope ?? [];
  const evidence = d.completion_evidence ?? [];
  const next = displayNext(record, lookup);
  // The next step is edited where it is shown: the plain wording when the record has it, otherwise the imported text.
  const hasPlainNext = typeof d.plain_next === 'string' && d.plain_next.trim().length > 0;
  const blockedLike = record.status === 'blocked' || record.status === 'eliminated' || record.status === 'not_applicable' || record.status === 'waiting_external';
  const phase = d.phase ? PHASE_LABEL[d.phase] : null;

  return (
    <div className="record rec stack stack--loose">
      <div className="rec-head stack">
        <div className="rec-head__line">
          <StatusBadge status={record.status} />
          <OwnerChip owner={record.owner} proposed={record.owner_proposed} />
          {d.optional_future_work && <OptionalTag />}
          {when.primary ? <WhenText c={when.primary} today={today} /> : noDates ? <span className="faint">No date yet</span> : null}
        </div>
        {d.status_reason && blockedLike && (
          <p className="reason preline">
            <strong>{record.status === 'blocked' ? 'Why it’s stuck: ' : record.status === 'waiting_external' ? 'Waiting for: ' : 'Why: '}</strong>
            <Prose text={d.status_reason} />
          </p>
        )}
        <div>
          <Button variant="secondary" icon="check" onClick={() => setStatusOpen(true)} data-status-control>
            Change status
          </Button>
        </div>
      </div>

      <Section title="Next action" headingLevel={level} className="rec-next">
        <InlineEdit
          label="Next action"
          value={hasPlainNext ? (d.plain_next as string) : (d.next_action ?? '')}
          display={
            next ? (
              <p className="rec-next__text preline">{hasPlainNext ? next : <Prose text={d.next_action ?? ''} />}</p>
            ) : (
              <p className="muted">Not written yet.</p>
            )
          }
          input="textarea"
          version={record.version}
          dirtyKey={`next:${record.id}`}
          // Editing the plain wording replaces it: the person's own words become the next action, and the old plain
          // wording is cleared so it can never show a step that was just changed.
          onSave={(draft, v) => actions.patchRecord(record.id, v, { data: hasPlainNext ? { next_action: draft, plain_next: null } : { next_action: draft } })}
        />
      </Section>

      {d.completion_criteria && (
        <Section title="Done when" headingLevel={level}>
          <p className="preline">{plain(d.completion_criteria)}</p>
        </Section>
      )}

      {evidence.length > 0 && record.status === 'completed' && (
        <Section title="What shows it’s done" headingLevel={level}>
          <ul className="evidence">
            {evidence.map((e, i) => {
              const href = safeHref(e.link);
              return (
                <li key={i}>
                  <span className="preline">{e.summary}</span>
                  <span className="small faint"> — {dir.nameOf(e.by)}, {civil(dayIn(e.at, zone), 'weekday')}</span>
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
        </Section>
      )}

      {(when.others.length > 0 || (d.review_date && when.primary?.kind !== 'review_date' && !when.others.some((o) => o.kind === 'review_date'))) && (
        <Section title="Dates" headingLevel={level}>
          <ul className="rec-dates">
            {when.others.map((c, i) => (
              <li key={`${c.source}-${c.date}-${i}`}>
                <span className="rec-dates__label">{c.label}</span> <WhenText c={c} today={today} />
              </li>
            ))}
            {d.review_date && !when.others.some((o) => o.kind === 'review_date') && when.primary?.kind !== 'review_date' && (
              <li>
                <WhenText c={{ date: d.review_date, kind: 'review_date', source: 'review', state: null, deadline: null, label: 'Check-in' }} today={today} />
              </li>
            )}
          </ul>
        </Section>
      )}

      <TravelerProgress record={record} level={level} />
      <ConditionalAnswers record={record} dir={dir} level={level} />

      <div className="rec-mores">
        <More label="Details" className="rec-more">
          <dl className="facts">
            <Fact label="Owner">
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
              {accept.error && <p className="field__error" role="alert">{accept.error}</p>}
              {accept.conflict && (
                <ConflictBanner conflict={accept.conflict} busy={accept.busy} onKeepTheirs={accept.keepTheirs} onUseMine={() => void accept.useMine()} />
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
            {(d.collaborators ?? []).length > 0 && (
              <Fact label="Working with">{d.collaborators!.join(', ')}</Fact>
            )}
            {phase && <Fact label="Phase">{phase}</Fact>}
            {d.effort_estimate && <Fact label="Effort">{d.effort_estimate}</Fact>}
            {d.target_window && <Fact label="Target window">{d.target_window}</Fact>}
            <Fact label="For">{scope.length === 0 ? 'Whole household' : scope.map((p) => dir.nameOf(p)).join(' and ')}</Fact>
            {d.contingency && (
              <Fact label="If it doesn’t go to plan" wide>
                <span className="preline">{plain(d.contingency)}</span>
              </Fact>
            )}
          </dl>
        </More>

        {(hasDates || d.review_date) && (
          <More label="Date details" className="rec-more">
            <div className="stack">
              {engine.length > 0
                ? engine.map((c) => (
                    <div key={c.id} className="stack stack--tight">
                      {engine.length > 1 && <SubHead level={level}>{c.label}</SubHead>}
                      <DeadlineFacts deadline={c.deadline} state={c.state} idx={idx} dir={dir} today={today} computed={c} />
                    </div>
                  ))
                : ownDeadline && <DeadlineFacts deadline={ownDeadline} idx={idx} dir={dir} today={today} />}
              {ruleDates.length > 0 && (
                <div className="stack stack--tight">
                  <SubHead level={level}>Dates from rules</SubHead>
                  <ul className="item-list">
                    {ruleDates.map((r) => (
                      <DeadlineRow key={r.id} d={r} idx={idx} today={today} dir={dir} showWho linkRecord={false} />
                    ))}
                  </ul>
                </div>
              )}
              <LinkedDates milestoneId={record.id} today={today} />
              {d.review_date && (
                <p>
                  <DeadlineBadge kind="review_date" /> <LineTime date={d.review_date} line={dateLine(d.review_date, today, { open: false })} />
                </p>
              )}
            </div>
          </More>
        )}

        {evidence.length > 0 && record.status !== 'completed' && (
          <More label="What shows it’s done" className="rec-more">
            <ul className="evidence">
              {evidence.map((e, i) => {
                const href = safeHref(e.link);
                return (
                  <li key={i}>
                    <span className="preline">{e.summary}</span>
                    <span className="small faint"> — {dir.nameOf(e.by)}, {civil(dayIn(e.at, zone), 'weekday')}</span>
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
          </More>
        )}

        <Dependencies record={record} idx={idx} dir={dir} level={level} />
        <LinkedTasks record={record} idx={idx} dir={dir} level={level} />
        <Notes record={record} idx={idx} dir={dir} level={level} />
        <SourceHistory record={record} idx={idx} dir={dir} level={level} />
      </div>

      <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} record={record} currentStatus={record.status} />
    </div>
  );
}
