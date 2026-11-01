import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { addCalendarDays, diffDays, isCivilDate } from '@shared/dates';
import type { AuditEntry, BaseRecord, ReviewProgress, ReviewSessionData } from '@shared/types';
import { api, ConflictError, describeError } from '../../net/client';
import { Button, Field, TextArea, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { ClampText } from '../../components/ClampText';
import { ErrorBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { ItemCard } from '../../components/ItemCard';
import { Card, EmptyState, PageTitle, Section, Skeleton } from '../../components/Layout';
import { OwnerChip } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { AuditLines } from '../../components/AuditLines';
import { describeAuditList } from '../../lib/audit';
import { completedReviews, describeProgress, mergeProgress, progressOf, REVIEW_STEP_TITLES, toProgress } from '../../lib/reviews';
import { whenFor } from '../../lib/when';
import { civil, dayIn, instant, plural } from '../../lib/format';
import { selectDecisions, selectNow, type FilterContext } from '../../lib/home';
import { dataOf, firstReviewDecisionKeys, isOpenWork, type AnyRecord, type Decision, type Directory, type Indexes, type Question } from '../../lib/records';
import { buildReviewSummary } from '../../lib/reviewSummary';
import { useData } from '../../state/data';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';
import { approvalSummary } from '../decide/decisionText';
import { ApproveDialog, ReasonDialog } from '../decide/decisionDialogs';
import { relevanceScore } from '../decide/QuestionsTab';
import { isPlanQuestion } from '../../lib/questions';
import { currentPhase } from '../../lib/home';

const STEPS = REVIEW_STEP_TITLES;

interface Outcome {
  id: string;
  title: string;
  outcome: string;
}

interface Session {
  record: BaseRecord;
  accepted: { id: string; title: string; owner: string }[];
  decisions: Outcome[];
  questions: Outcome[];
  changeCount: number;
}

/* ------------------------------------------------------------------ timer */

function GentleTimer({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const mins = Math.floor((Date.now() - startedAt) / 60_000);
  // Not a live region on purpose: a timer should never interrupt anyone.
  return <p className="review-timer faint small">{mins < 1 ? 'Just started' : `${mins} min so far — no rush`}</p>;
}

/* ------------------------------------------------------------------ steps */

function StepChanges({ idx, dir, since, onCount }: { idx: Indexes; dir: Directory; since: string | null; onCount: (n: number) => void }) {
  const { zone } = usePrefs();
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; entries: AuditEntry[] }>({ kind: 'loading' });
  const [all, setAll] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setState({ kind: 'loading' });
    api
      .audit({ since }, ctl.signal)
      .then((entries) => setState({ kind: 'ready', entries }))
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState({ kind: 'error', message: describeError(e) });
      });
    return () => ctl.abort();
  }, [since, tick]);
  const lines = useMemo(() => (state.kind === 'ready' ? describeAuditList(state.entries, idx, dir) : []), [state, idx, dir]);
  useEffect(() => {
    if (state.kind === 'ready') onCount(lines.length);
  }, [state.kind, lines.length, onCount]);

  return (
    <div className="stack">
      <p className="muted">{since ? `Everything that changed after ${instant(since, zone, 'long')}.` : 'This is the first review, so here is what changed most recently.'}</p>
      {state.kind === 'loading' && <Skeleton lines={4} />}
      {state.kind === 'error' && (
        <ErrorBanner title="We couldn't load the changes." onRetry={() => setTick((t) => t + 1)}>
          {state.message}
        </ErrorBanner>
      )}
      {state.kind === 'ready' &&
        (lines.length === 0 ? (
          <Card>
            <EmptyState icon="check" title="Nothing has changed since then." />
          </Card>
        ) : (
          <Card>
            <AuditLines lines={all ? lines : lines.slice(0, 10)} />
            {lines.length > 10 && (
              <div className="center">
                <Button variant="quiet" onClick={() => setAll((v) => !v)}>
                  {all ? 'Show fewer' : `Show all ${lines.length}`}
                </Button>
              </div>
            )}
          </Card>
        ))}
    </div>
  );
}

function OwnerRow({ rec, dir, done, onAccepted }: { rec: AnyRecord; dir: Directory; done: boolean; onAccepted: () => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const accept = async () => {
    const ok = await w.run((v) => actions.patchRecord(rec.id, v, { owner_proposed: false }), rec.version);
    if (ok) onAccepted();
  };
  return (
    <li className="item item--flat">
      <div className="item__main">
        <RecordLink id={rec.id} className="item__title">
          {rec.title}
        </RecordLink>
        <div className="item__meta">
          <OwnerChip owner={rec.owner} proposed={!done} compact />
        </div>
        {done ? (
          <p className="small muted">
            <Icon name="check" size={14} /> {dir.ownerLabel(rec.owner)} accepted.
          </p>
        ) : (
          <div className="row-actions" style={{ marginTop: 0 }}>
            <Button variant="secondary" small busy={w.busy} onClick={accept}>
              Accept {dir.ownerLabel(rec.owner)}
            </Button>
          </div>
        )}
        {w.error && <p className="field__error" role="alert">{w.error}</p>}
        {w.conflict && <p className="field__error" role="alert">This changed while you were looking. Open it to see the newer version.</p>}
      </div>
    </li>
  );
}

function StepThisWeek({ idx, dir, session, setSession }: { idx: Indexes; dir: Directory; session: Session; setSession: (f: (s: Session) => Session) => void }) {
  const { today, deadlinesByRecord, deadlines } = useData();
  const ctx: FilterContext = { meId: dir.me?.id ?? null, otherIds: dir.others.map((o) => o.id) };
  const now = useMemo(() => selectNow(idx, { today, filter: 'all', ctx, deadlinesByRecord: deadlines.ok ? deadlinesByRecord : undefined, limit: 5 }), [idx, today, deadlinesByRecord, deadlines, ctx]);
  const proposed = idx.milestones.filter((m) => m.owner_proposed && m.owner && m.owner !== 'unassigned' && isOpenWork(m.status) && !m.data?.optional_future_work);
  const acceptedIds = new Set(session.accepted.map((a) => a.id));
  const pending = proposed.filter((m) => !acceptedIds.has(m.id));
  // Only what falls in this week or the next two is worth a conversation now; the rest can wait. Soonest first, three at most.
  const soon = useMemo(() => {
    const dated = pending.map((m) => ({ m, date: whenFor(m, idx, deadlines.ok ? deadlinesByRecord.get(m.id) : undefined, today).primary?.date ?? null }));
    return dated
      .filter((x) => x.date !== null && diffDays(today, x.date) <= 21)
      .sort((a, b) => (a.date! < b.date! ? -1 : 1))
      .map((x) => x.m);
  }, [pending, idx, deadlines, deadlinesByRecord, today]);
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? pending : soon.slice(0, 3);
  const later = pending.length - rows.length;
  return (
    <div className="stack stack--loose">
      <Section title="This week" headingLevel={3} intro="The next few things worth doing.">
        {now.length === 0 ? (
          <p className="muted">Nothing is ready to start right now.</p>
        ) : (
          <ul className="item-list">
            {now.map((it) => (
              <ItemCard key={it.id} recordId={it.recordId} title={it.title} owner={it.owner} ownerProposed={it.ownerProposed} nextAction={it.nextAction} when={it.when} today={today} note={it.note} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Owners to confirm" count={pending.length || undefined} headingLevel={3} intro="Each item has one accountable owner. A proposed owner stays provisional until someone accepts it. Only what falls in the next three weeks is shown first.">
        {pending.length === 0 && session.accepted.length === 0 ? (
          <p className="muted">No owners are waiting to be confirmed.</p>
        ) : rows.length === 0 && session.accepted.length === 0 ? (
          <p className="muted">No owner needs confirming for the next three weeks. {plural(pending.length, 'other')} can wait.</p>
        ) : (
          <ul className="item-list">
            {session.accepted.map((a) => {
              const rec = idx.byId.get(a.id);
              return rec ? <OwnerRow key={a.id} rec={rec} dir={dir} done onAccepted={() => undefined} /> : null;
            })}
            {rows.map((m) => (
              <OwnerRow
                key={m.id}
                rec={m}
                dir={dir}
                done={false}
                onAccepted={() => setSession((s) => ({ ...s, accepted: [...s.accepted, { id: m.id, title: m.title, owner: dir.ownerLabel(m.owner) }] }))}
              />
            ))}
          </ul>
        )}
        {later > 0 && !showAll && (
          <Button variant="quiet" onClick={() => setShowAll(true)}>
            Show {later === pending.length ? `all ${pending.length}` : `${later} more that can wait`}
          </Button>
        )}
      </Section>
    </div>
  );
}

function StepDecisions({ idx, dir, session, setSession }: { idx: Indexes; dir: Directory; session: Session; setSession: (f: (s: Session) => Session) => void }) {
  const { today } = useData();
  const { snapshot } = useSnapshot();
  const first = useMemo(() => firstReviewDecisionKeys(snapshot?.settings), [snapshot]);
  const ctx: FilterContext = { meId: dir.me?.id ?? null, otherIds: [] };
  // At most three: the household's chosen first-review decisions when there are any, otherwise the top three by needed-by.
  const picks = useMemo(() => {
    const open = selectDecisions(idx, 'all', ctx, { today });
    if (first.length > 0) {
      const chosen = first.map((k) => open.find((d) => d.key === k)).filter((d): d is Decision => Boolean(d));
      if (chosen.length > 0) return chosen.slice(0, 3);
    }
    return open.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, today, first]);
  const doneIds = new Set(session.decisions.map((d) => d.id));
  const [approving, setApproving] = useState<Decision | null>(null);
  const [reasoning, setReasoning] = useState<{ d: Decision; mode: 'defer' | 'reject' } | null>(null);
  const me = dir.me?.display_name ?? 'You';

  if (picks.length === 0 && session.decisions.length === 0) return <EmptyState icon="check" title="No decisions are waiting." />;
  const shown = [...picks, ...session.decisions.filter((o) => !picks.some((p) => p.id === o.id)).map((o) => idx.byId.get(o.id) as unknown as Decision).filter(Boolean)];
  return (
    <div className="stack">
      <p className="muted">At most three, so there is room to talk about each. Each of you can approve, or put it off for another time.</p>
      <ul className="stack">
        {shown.map((d) => {
          const out = session.decisions.find((o) => o.id === d.id);
          const summary = approvalSummary(d, dir);
          return (
            <li key={d.id}>
              <Card tone={d.status === 'proposed' ? 'proposal' : 'default'} className="stack">
                <h3 className="decision__title">{d.title}</h3>
                {d.data?.question && d.data.question !== d.title && <p className="muted preline">{d.data.question}</p>}
                <p className={`approval approval--${summary.state}`}>
                  <Icon name={summary.state === 'agreed' ? 'check' : 'clock'} size={16} /> {summary.text}
                </p>
                {(d.data?.options ?? []).length > 0 && (
                  <ul className="plain-list small">
                    {d.data.options.map((o) => (
                      <li key={o.id}>
                        {o.label}
                        {o.id === d.data.recommended_option_id && <span className="faint"> (suggested)</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {out ? (
                  <p>
                    <Icon name="check" size={14} /> {out.outcome}
                  </p>
                ) : (
                  <div className="row-actions" style={{ marginTop: 0 }}>
                    <Button variant="primary" onClick={() => setApproving(d)}>
                      Approve as {me}
                    </Button>
                    <Button variant="secondary" onClick={() => setReasoning({ d, mode: 'defer' })}>
                      Put off…
                    </Button>
                    <RecordLink id={d.id} className="more-link">
                      Open details
                    </RecordLink>
                  </div>
                )}
                {out && !doneIds.has(d.id) ? null : null}
              </Card>
            </li>
          );
        })}
      </ul>
      {approving && (
        <ApproveDialog
          decision={approving}
          open
          dir={dir}
          onClose={() => setApproving(null)}
          onDone={(rec, label) => {
            const d = approving;
            setSession((s) => ({ ...s, decisions: [...s.decisions.filter((x) => x.id !== d.id), { id: d.id, title: d.title, outcome: `${me} approved ${label ? `“${label.replace(/[.\s]+$/, '')}”` : 'an option'}${rec.status === 'approved' ? ', and the household decided' : ''}` }] }));
          }}
        />
      )}
      {reasoning && (
        <ReasonDialog
          decision={reasoning.d}
          mode={reasoning.mode}
          onClose={() => setReasoning(null)}
          onDone={() => {
            const d = reasoning.d;
            setSession((s) => ({ ...s, decisions: [...s.decisions.filter((x) => x.id !== d.id), { id: d.id, title: d.title, outcome: 'put off for now' }] }));
          }}
        />
      )}
    </div>
  );
}

function QuestionRow({ q, onOutcome, done }: { q: Question; onOutcome: (outcome: string) => void; done: string | null }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const [answer, setAnswer] = useState('');
  const [tried, setTried] = useState(false);
  const save = (disposition: string, outcome: string, withAnswer: boolean) => {
    if (withAnswer && answer.trim() === '') {
      setTried(true);
      return;
    }
    void w
      .run((v) => actions.patchRecord(q.id, v, { data: { disposition, ...(withAnswer ? { answer: answer.trim() } : {}) } }), q.version)
      .then((ok) => ok && onOutcome(outcome));
  };
  return (
    <Card className="stack">
      <h3 className="decision__title">{q.data?.question || q.title}</h3>
      {q.data?.known && <p className="muted small preline">What we know: {q.data.known}</p>}
      {done ? (
        <p>
          <Icon name="check" size={14} /> {done}
        </p>
      ) : (
        <>
          <Field label="Our answer, if we have one" error={tried && answer.trim() === '' ? 'Write the answer first, or choose another option.' : null}>
            <TextArea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} />
          </Field>
          <div className="row-actions" style={{ marginTop: 0 }}>
            <Button variant="primary" busy={w.busy} onClick={() => save('already_answered', 'answered', true)}>
              Save our answer
            </Button>
            <Button variant="secondary" busy={w.busy} onClick={() => save('carry_forward', 'carried forward', false)}>
              Carry forward
            </Button>
            <Button variant="quiet" busy={w.busy} onClick={() => save('not_applicable', 'marked not applicable', false)}>
              Not applicable
            </Button>
          </div>
        </>
      )}
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && <p className="field__error" role="alert">This changed while you were looking. Open it to see the newer version.</p>}
    </Card>
  );
}

function StepQuestions({ idx, dir, session, setSession }: { idx: Indexes; dir: Directory; session: Session; setSession: (f: (s: Session) => Session) => void }) {
  const picks = useMemo(() => {
    const phase = currentPhase(idx);
    const keys = new Set<string>();
    if (phase) for (const m of idx.milestones) if (m.data?.phase === phase && isOpenWork(m.status)) keys.add(m.key);
    return idx.questions
      .filter((q) => (q.data?.disposition ?? 'question') === 'question' && isPlanQuestion(q))
      .map((q) => ({ q, score: relevanceScore(q, idx, dir, keys) }))
      .sort((a, b) => b.score - a.score || a.q.key.localeCompare(b.q.key, undefined, { numeric: true }))
      .slice(0, 5)
      .map((x) => x.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx.questions.length]);
  if (picks.length === 0) return <EmptyState icon="check" title="No open questions right now." />;
  return (
    <div className="stack">
      <p className="muted">A few that matter at this stage, five at most. You can answer, carry one forward unchanged, or mark it as not applicable.</p>
      {picks.map((q) => (
        <QuestionRow
          key={q.id}
          q={q}
          done={session.questions.find((o) => o.id === q.id)?.outcome ? `Recorded as ${session.questions.find((o) => o.id === q.id)!.outcome}.` : null}
          onOutcome={(outcome) => setSession((s) => ({ ...s, questions: [...s.questions.filter((x) => x.id !== q.id), { id: q.id, title: q.data?.question || q.title, outcome }] }))}
        />
      ))}
    </div>
  );
}

function StepWrapUp({ session, idx, dir, since, prepare, onSaved }: { session: Session; idx: Indexes; dir: Directory; since: string | null; prepare: () => Promise<number>; onSaved: (rec: BaseRecord) => void }) {
  const { today } = useData();
  const { actions, refresh } = useSnapshot();
  const [next, setNext] = useState(() => addCalendarDays(today, 7));
  const [note, setNote] = useState('');
  const [names, setNames] = useState<string[]>([dir.me?.display_name ?? 'You']);
  const [both, setBoth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNames(both ? dir.adults.map((a) => a.display_name) : [dir.me?.display_name ?? 'You']);
  }, [both, dir]);

  const nextBad = next !== '' && !isCivilDate(next);
  // Decisions that became final since the last review, from the plan itself (so none depends on someone remembering).
  const decidedSince = useMemo(
    () =>
      idx.decisions
        .filter((d) => since !== null && d.status === 'approved' && d.data?.decided_at && d.data.decided_at > since && !session.decisions.some((o) => o.id === d.id))
        .map((d) => ({ id: d.id, title: d.title })),
    [idx, since, session.decisions],
  );
  const { text, recordIds } = buildReviewSummary({
    date: today,
    names,
    hasPreviousReview: since !== null,
    changeCount: session.changeCount,
    decidedSince,
    accepted: session.accepted,
    decisions: session.decisions,
    questions: session.questions,
    nextReviewOn: next === '' ? null : next,
    closingNote: note,
  });

  const save = async () => {
    if (nextBad) return;
    setBusy(true);
    setError(null);
    try {
      // Settle the review's own record of what it covered first, so the version this save is based on is the newest.
      const baseVersion = (await prepare()) || (idx.byId.get(session.record.id) ?? session.record).version;
      const rec = await api.completeReview(session.record.id, {
        baseVersion,
        participants: both ? dir.adults.map((a) => a.id) : [dir.me?.id ?? ''].filter(Boolean),
        reviewed_record_ids: recordIds,
        decisions: session.decisions.slice(0, 3).map((d) => ({ record_id: d.id, outcome: d.outcome.replace(/\s+/g, ' ').slice(0, 480) })),
        summary: text,
        next_review_on: next === '' ? null : next,
      });
      actions.adoptRecord(rec);
      await refresh();
      onSaved(rec);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Field label="Next review" hint="A week from today unless you pick another day. This is a checkpoint, not a deadline." error={nextBad ? 'Please pick a real date.' : null}>
        <TextInput type="date" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      {dir.adults.length > 1 && (
        <label className="choice">
          <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} />
          <span className="choice__text">{dir.adults.map((a) => a.display_name).join(' and ')} did this review together</span>
        </label>
      )}
      <Field label="Anything to add? (optional)">
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      <Card tone="inset" className="stack">
        <h3 className="money-h3">What will be saved</h3>
        <p className="preline">{text}</p>
        {recordIds.length > 0 && (
          <p className="small muted">
            Linked records:{' '}
            {recordIds.map((id, i) => (
              <span key={id}>
                {i > 0 && ', '}
                <RecordLink id={id}>{idx.byId.get(id)?.title ?? 'A record'}</RecordLink>
              </span>
            ))}
          </p>
        )}
        <p className="small faint">This only records what you looked at and decided. It does not mark any work as done, and it is not advice.</p>
      </Card>
      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="row-actions" style={{ marginTop: 0 }}>
        <Button variant="primary" busy={busy} onClick={save}>
          Save this review
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ start */

function ReviewStart({
  idx,
  dir,
  past,
  since,
  open,
  starting,
  error,
  onStart,
}: {
  idx: Indexes;
  dir: Directory;
  past: AnyRecord[];
  since: string | null;
  open: AnyRecord | null;
  starting: boolean;
  error: string | null;
  onStart: () => void;
}) {
  const { today } = useData();
  const { zone } = usePrefs();
  const [showPast, setShowPast] = useState(false);
  const last = past[0] ?? null;
  const lastData = last ? dataOf<ReviewSessionData>(last) : null;
  const earlier = past.slice(1);
  return (
    <div className="stack stack--loose">
      <Card className="stack">
        <p>
          A short, calm walk through where things stand — about twenty minutes, five steps. You can skip any step. Nothing is scored, and nothing is marked done for you.
        </p>
        <ol className="review-outline">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="muted small">Today is {civil(today, 'long')}.</p>
        {open && (
          <Card as="section" tone="inset" className="stack" aria-labelledby="review-open-title">
            <h2 id="review-open-title" className="money-h3">
              A review is open
            </h2>
            <p>{describeProgress(progressOf(open))}</p>
            <p className="small muted">Nothing you confirmed or answered has been lost. Continuing picks up where it stopped.</p>
          </Card>
        )}
        {error && <p className="field__error" role="alert">{error}</p>}
        <div className="row-actions">
          <Button variant="primary" busy={starting} onClick={onStart}>
            {open ? 'Continue your review' : 'Start a review together'}
          </Button>
        </div>
      </Card>

      <Section title="Last review" headingLevel={2}>
        {!last || !lastData ? (
          <Card>
            <p className="muted">No review has been finished yet. The first one will be kept here.</p>
          </Card>
        ) : (
          <Card className="stack">
            <p>
              <strong>{civil(dayIn(lastData.completed_at ?? since ?? '', zone), 'long')}</strong>
              {lastData.participants?.length ? <span className="muted"> · with {lastData.participants.map((p) => dir.nameOf(p)).join(' and ')}</span> : null}
            </p>
            {lastData.summary && <ClampText className="preline">{lastData.summary}</ClampText>}
            {lastData.next_review_on && <p className="small muted">Next review planned for {civil(lastData.next_review_on, 'long')}.</p>}
            <p>
              <RecordLink id={last.id} className="more-link">
                Read the whole summary
              </RecordLink>
            </p>
          </Card>
        )}
      </Section>

      {earlier.length > 0 && (
        <Section title="Past reviews" count={earlier.length} headingLevel={2}>
          <Card>
            <ul className="audit-list">
              {(showPast ? earlier : earlier.slice(0, 3)).map((r) => {
                const d = dataOf<ReviewSessionData>(r);
                return (
                  <li key={r.id} className="audit-line">
                    <span className="audit-line__text">
                      <RecordLink id={r.id} className="audit-line__link">
                        {r.title}
                      </RecordLink>
                      {d.participants?.length ? <span className="muted"> · with {d.participants.map((p) => dir.nameOf(p)).join(' and ')}</span> : null}
                    </span>
                    <time className="faint small" dateTime={d.completed_at ?? undefined}>
                      {instant(d.completed_at, zone, 'short')}
                    </time>
                  </li>
                );
              })}
            </ul>
            {earlier.length > 3 && (
              <div className="center">
                <Button variant="quiet" onClick={() => setShowPast((v) => !v)}>
                  {showPast ? 'Show fewer' : `Show all ${earlier.length}`}
                </Button>
              </div>
            )}
          </Card>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ flow */

/** How long to wait after the last change before the review's own record of what it covered is saved. */
const PROGRESS_SAVE_DELAY_MS = 600;

function ReviewFlow({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const { snapshot, actions } = useSnapshot();
  const since = snapshot?.last_review_completed_at ?? null;
  const { today, zone } = useData();
  const open = idx.all.find((r) => r.type === 'review_session' && r.status === 'in_progress');
  const [session, setSessionState] = useState<Session | null>(null);
  const [step, setStep] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState(false);
  const startedAt = useRef(Date.now());
  const [saved, setSaved] = useState<BaseRecord | null>(null);
  const [placeNotSaved, setPlaceNotSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const setSession = (f: (s: Session) => Session) => setSessionState((s) => (s ? f(s) : s));

  // The review's own record of what it covered (owners confirmed, decisions, questions, step) is kept on the open
  // review, a moment after each change, so leaving this page and coming back loses nothing.
  const progress: ReviewProgress | null = session ? toProgress(session, step) : null;
  const progressKey = progress ? JSON.stringify(progress) : '';
  const wanted = useRef<ReviewProgress | null>(null);
  wanted.current = progress;
  const sentKey = useRef('');
  const version = useRef(0);
  const recordId = useRef('');
  const finished = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    const run = async () => {
      let body = wanted.current;
      if (finished.current || !body || !recordId.current || JSON.stringify(body) === sentKey.current) return;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const rec = await api.patchReview(recordId.current, { baseVersion: version.current, changes: { progress: body } });
          version.current = rec.version;
          sentKey.current = JSON.stringify(body);
          actions.adoptRecord(rec);
          setPlaceNotSaved(false);
          // Someone else covered things too: show their entries as well as ours.
          if (attempt > 0) {
            const theirs = body;
            setSessionState((s) => {
              if (!s) return s;
              const merged = mergeProgress(theirs, toProgress(s, 0)); // what was added while this save was under way stays
              return { ...s, accepted: merged.accepted, decisions: merged.decisions, questions: merged.questions, changeCount: merged.change_count };
            });
          }
          return;
        } catch (e) {
          if (e instanceof ConflictError && e.server && e.server.status === 'in_progress' && attempt < 2) {
            // A newer copy exists (the other adult saved first): take its version number and keep both people's entries.
            version.current = e.server.version;
            body = mergeProgress(progressOf(e.server), body);
            continue;
          }
          if (e instanceof ConflictError && e.server && e.server.status !== 'in_progress') finished.current = true; // saved elsewhere
          setPlaceNotSaved(true);
          return;
        }
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, [actions]);

  useEffect(() => {
    if (!progressKey || progressKey === sentKey.current) return;
    const t = window.setTimeout(() => void flush(), PROGRESS_SAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [progressKey, flush]);

  // Leaving the page (or hiding the tab) saves straight away instead of waiting out the delay.
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
    if (session) headingRef.current?.focus();
  }, [step, session]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const r = await api.startReview({ title: `Couple review · ${civil(today, 'weekday')}`, participants: dir.me ? [dir.me.id] : undefined });
      const back = r.resumed ? progressOf(r.record) : null;
      startedAt.current = Date.now();
      recordId.current = r.record.id;
      version.current = r.record.version;
      finished.current = false;
      const first: Session = { record: r.record, accepted: back?.accepted ?? [], decisions: back?.decisions ?? [], questions: back?.questions ?? [], changeCount: back?.change_count ?? 0 };
      // Nothing to save until something changes from what the record already holds.
      sentKey.current = JSON.stringify(toProgress(first, back?.step ?? 0));
      setSessionState(first);
      setStep(back?.step ?? 0);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStarting(false);
    }
  };

  if (saved) {
    return (
      <Card className="stack">
        <h2>Review saved</h2>
        <p>Thank you. The summary is kept with the plan{(dataOf<{ next_review_on?: string | null }>(saved).next_review_on) ? `, and your next review is ${civil(dataOf<{ next_review_on?: string | null }>(saved).next_review_on)}` : ''}.</p>
        <div className="row-actions">
          <Link className="btn btn--primary" to="/">
            Back to Home
          </Link>
          <RecordLink id={saved.id} className="btn btn--secondary">
            Read the summary
          </RecordLink>
        </div>
      </Card>
    );
  }

  if (!session) {
    const past = completedReviews(idx);
    return <ReviewStart idx={idx} dir={dir} past={past} since={since} open={open ?? null} starting={starting} error={error} onStart={start} />;
  }

  const stepNode =
    step === 0 ? (
      <StepChanges idx={idx} dir={dir} since={since} onCount={(n) => setSessionState((s) => (s && s.changeCount !== n ? { ...s, changeCount: n } : s))} />
    ) : step === 1 ? (
      <StepThisWeek idx={idx} dir={dir} session={session} setSession={setSession} />
    ) : step === 2 ? (
      <StepDecisions idx={idx} dir={dir} session={session} setSession={setSession} />
    ) : step === 3 ? (
      <StepQuestions idx={idx} dir={dir} session={session} setSession={setSession} />
    ) : (
      <StepWrapUp session={session} idx={idx} dir={dir} since={since} prepare={async () => { await flush(); return version.current; }} onSaved={(rec) => { finished.current = true; setSaved(rec); }} />
    );

  return (
    <div className="stack stack--loose">
      <nav aria-label="Review steps">
        <p className="review-compact" aria-hidden="true">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        <div className="review-bar" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={`review-bar__seg${i < step ? ' is-past' : ''}${i === step ? ' is-current' : ''}`} />
          ))}
        </div>
        <ol className="review-steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={`review-steps__item${i === step ? ' is-current' : ''}${i < step ? ' is-past' : ''}`}
              aria-current={i === step ? 'step' : undefined}
              aria-label={`Step ${i + 1} of ${STEPS.length}, ${s}, ${i < step ? 'done' : i === step ? 'current' : 'not started'}`}
            >
              <span className="review-steps__n" aria-hidden="true">
                {i < step ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className="review-steps__label">{s}</span>
            </li>
          ))}
        </ol>
      </nav>
      <div className="row row--between">
        <label className="choice choice--inline">
          <input type="checkbox" checked={timer} onChange={(e) => setTimer(e.target.checked)} />
          <span className="choice__text">Show a gentle timer</span>
        </label>
        {timer && <GentleTimer startedAt={startedAt.current} />}
      </div>
      <Section title={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} headingLevel={2}>
        <h3 ref={headingRef} tabIndex={-1} className="visually-hidden">
          {STEPS[step]}
        </h3>
        {stepNode}
      </Section>
      <div className="review-nav">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </Button>
        {step < STEPS.length - 1 && (
          <>
            <Button variant="quiet" onClick={() => setStep((s) => s + 1)}>
              Skip this step
            </Button>
            <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          </>
        )}
      </div>
      <p className="faint small">Leaving this page keeps what you have done; the review stays open until you save it.</p>
      {placeNotSaved && (
        <p role="status" className="small muted">
          We couldn’t note your place in this review just now. Everything you confirmed or answered is saved; only this list of what you covered may be missing if you leave.
        </p>
      )}
    </div>
  );
}

export function Review() {
  return (
    <div className="page review">
      <PageTitle kicker="Together, about twenty minutes">Couple review</PageTitle>
      <DataGate>{({ idx, dir }) => <ReviewFlow idx={idx} dir={dir} />}</DataGate>
    </div>
  );
}

