import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { audienceLabel, QUESTION_DISPOSITION_LABEL } from '@shared/labels';
import type { QuestionDisposition } from '@shared/types';
import { Button, FilterChips } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Disclosure } from '../../components/Disclosure';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, Section } from '../../components/Layout';
import { usePlain } from '../../components/People';
import { Prose } from '../../components/Prose';
import { RecordLink } from '../../components/RecordLink';
import { civil } from '../../lib/format';
import { currentPhase } from '../../lib/home';
import { isAdviserQuestion, isPlanQuestion } from '../../lib/questions';
import { isOpenWork, type Directory, type Indexes, type Question } from '../../lib/records';
import { useData } from '../../state/data';

const DISPOSITIONS: QuestionDisposition[] = ['question', 'carry_forward', 'waiting_blocked', 'already_answered', 'not_applicable', 'explicitly_excluded'];
/** On screen the list starts short; paper and the copied text always carry every question. */
const SHOWN_ON_SCREEN = 6;
const byKey = (a: Question, b: Question) => a.key.localeCompare(b.key, undefined, { numeric: true });

/** Higher = more relevant to this person right now. Uses the question's own relevance links; never hides anything. */
export function relevanceScore(q: Question, idx: Indexes, dir: Directory, phaseKeys: Set<string>): number {
  let score = 0;
  const rel = q.data?.relevance ?? [];
  for (const r of rel) {
    if (phaseKeys.has(r)) score += 3;
    if (dir.me && r === dir.me.id) score += 2;
    if (dir.others.some((o) => o.id === r)) score += 1;
  }
  const ws = q.data?.workstream_key;
  if (ws && idx.milestones.some((m) => m.data?.workstream_key === ws && m.status === 'in_progress')) score += 1;
  return score;
}

/** Records a question is about, from its relevance links (travelers and unknown keys are left out). */
function aboutRecords(q: Question, idx: Indexes) {
  const out = [];
  for (const k of q.data?.relevance ?? []) {
    const r = idx.byKey.get(k);
    if (r && r.id !== q.id) out.push(r);
  }
  return out.slice(0, 4);
}

export function QuestionCard({ q, idx, defaultOpen = false, showLink = true }: { q: Question; idx?: Indexes; defaultOpen?: boolean; showLink?: boolean }) {
  const d = q.data;
  const adviser = isAdviserQuestion(q);
  const about = idx ? aboutRecords(q, idx) : [];
  return (
    <li>
      <Disclosure
        title={d?.question || q.title}
        meta={adviser ? `For the ${audienceLabel(d?.audience ?? '')}` : (QUESTION_DISPOSITION_LABEL[d?.disposition as QuestionDisposition] ?? undefined)}
        level={3}
        defaultOpen={defaultOpen}
      >
        <div className="stack">
          {d?.topic && <p className="kicker">{d.topic}</p>}
          {d?.facts_needed && (
            <div>
              <h4>Facts to bring</h4>
              <p className="preline">
                <Prose text={d.facts_needed} />
              </p>
            </div>
          )}
          {d?.known && (
            <div>
              <h4>What we already know</h4>
              <p className="preline">
                <Prose text={d.known} />
              </p>
            </div>
          )}
          {d?.when_trigger && (
            <div>
              <h4>When it matters</h4>
              <p className="preline">
                <Prose text={d.when_trigger} />
              </p>
            </div>
          )}
          {d?.answer && (
            <div>
              <h4>Answer so far</h4>
              <p className="preline">
                <Prose text={d.answer} />
              </p>
            </div>
          )}
          {d?.local_note && (
            <div>
              <h4>Note</h4>
              <p className="preline">
                <Prose text={d.local_note} />
              </p>
            </div>
          )}
          {about.length > 0 && (
            <p className="small">
              <span className="faint">About: </span>
              {about.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ', '}
                  <RecordLink id={r.id}>{r.title}</RecordLink>
                </span>
              ))}
            </p>
          )}
          {d?.evidence_basis && (
            <div>
              <h4>Where this comes from</h4>
              <p className="preline muted">
                <Prose text={d.evidence_basis} />
              </p>
            </div>
          )}
          {showLink && (
            <p className="small">
              <RecordLink id={q.id}>Open details and history</RecordLink>
            </p>
          )}
        </div>
      </Disclosure>
    </li>
  );
}

export function QuestionsTab() {
  return <DataGate>{({ idx, dir }) => <Questions idx={idx} dir={dir} />}</DataGate>;
}

/** A list the household can take to an appointment: printed, or copied as plain text. */
function AdviserQuestions({ idx, questions }: { idx: Indexes; questions: Question[] }) {
  const [params, setParams] = useSearchParams();
  const { today } = useData();
  const plain = usePlain();
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Open questions are the list to take along; answered or no-longer-needed ones fold away under it.
  const audiences = useMemo(() => {
    const seen = new Map<string, { open: Question[]; closed: Question[] }>();
    for (const q of [...questions].sort(byKey)) {
      const a = q.data?.audience ?? 'adviser';
      const entry = seen.get(a) ?? { open: [], closed: [] };
      (q.status === 'open' ? entry.open : entry.closed).push(q);
      seen.set(a, entry);
    }
    return [...seen.entries()].sort((a, b) => b[1].open.length - a[1].open.length || audienceLabel(a[0]).localeCompare(audienceLabel(b[0])));
  }, [questions]);
  const openCount = questions.filter((q) => q.status === 'open').length;
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 3000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const wanted = params.get('for');
  const current = audiences.find(([a]) => a === wanted) ?? audiences[0];
  if (!current) return null;
  const [audience, { open: list, closed }] = current;
  const label = audienceLabel(audience);
  const heading = `Questions for the ${label}`;

  const choose = (v: string) => {
    setShowAll(false);
    const p = new URLSearchParams(params);
    p.set('for', v);
    setParams(p, { replace: true });
  };
  const print = () => {
    const root = document.documentElement;
    root.dataset.print = 'advisers';
    const clear = () => {
      delete root.dataset.print;
      window.removeEventListener('afterprint', clear);
    };
    window.addEventListener('afterprint', clear);
    window.print();
    // Some browsers do not fire afterprint; never leave the page in print mode.
    window.setTimeout(clear, 1500);
  };
  const copy = async () => {
    const lines = [heading, ''];
    list.forEach((q, i) => {
      lines.push(`${i + 1}. ${plain(q.data?.question || q.title)}`);
      if (q.data?.facts_needed) lines.push(`   Bring: ${plain(q.data.facts_needed)}`);
      lines.push('');
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n').trim());
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  return (
    <Section
      title="Questions for your advisers"
      count={openCount || undefined}
      intro="Take these to the appointment. Each one says which facts to bring. Answered or no-longer-needed questions are folded away under each list."
      className="advisers-print"
    >
      <div className="no-print">
        {audiences.length > 1 && (
          <FilterChips
            label="Whose questions"
            value={audience}
            onChange={choose}
            options={audiences.map(([a, qs]) => ({ value: a, label: `${audienceLabel(a)[0]?.toUpperCase()}${audienceLabel(a).slice(1)}`, count: qs.open.length }))}
          />
        )}
      </div>
      <Card>
        <div className="advisers__head">
          <h3>{heading}</h3>
          <div className="row-actions no-print" style={{ marginTop: 0 }}>
            <Button variant="secondary" small icon="file" onClick={print}>
              Print this list
            </Button>
            <Button variant="quiet" small onClick={() => void copy()}>
              Copy as text
            </Button>
          </div>
        </div>
        <p className="print-only small">Prepared {civil(today, 'weekday')}</p>
        <p className="small muted no-print" role="status">
          {copied === 'ok' ? 'Copied. Paste it into an email or a note.' : copied === 'fail' ? 'Could not copy. Use Print instead, or select the text.' : ' '}
        </p>
        <ol className="advisers__list">
          {list.map((q, i) => (
            <li key={q.id} className={`advisers__q${!showAll && i >= SHOWN_ON_SCREEN ? ' advisers__q--more' : ''}`}>
              <p className="advisers__question">
                <Prose text={q.data?.question || q.title} />
              </p>
              {q.data?.facts_needed && (
                <p className="small">
                  <strong>Bring:</strong> <Prose text={q.data.facts_needed} />
                </p>
              )}
              {q.data?.when_trigger && (
                <p className="small muted">
                  <strong>Matters when:</strong> <Prose text={q.data.when_trigger} />
                </p>
              )}
              {q.data?.answer && (
                <p className="small">
                  <strong>Answer so far:</strong> <Prose text={q.data.answer} />
                </p>
              )}
              <p className="small no-print">
                <RecordLink id={q.id}>Open details</RecordLink>
                {aboutRecords(q, idx).length > 0 && (
                  <>
                    <span className="faint"> · About: </span>
                    {aboutRecords(q, idx).map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && ', '}
                        <RecordLink id={r.id}>{r.title}</RecordLink>
                      </span>
                    ))}
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
        {list.length === 0 && <p className="muted">Nothing is open for the {label} right now.</p>}
        {list.length > SHOWN_ON_SCREEN && (
          <div className="no-print">
            <Button variant="quiet" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${list.length}`}
            </Button>
            <p className="faint small">Printing and copying always include the whole list.</p>
          </div>
        )}
        {closed.length > 0 && (
          <Disclosure title="Answered or no longer needed" meta={`${closed.length}`} className="disclosure--flat no-print">
            <ul className="plain-list plain-list--spaced">
              {closed.map((q) => (
                <li key={q.id}>
                  <RecordLink id={q.id}>{q.title}</RecordLink>
                  {q.data?.answer && (
                    <span className="small muted">
                      {' '}
                      · <Prose text={q.data.answer} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </Card>
    </Section>
  );
}

function Questions({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const [params, setParams] = useSearchParams();
  const [extra, setExtra] = useState(0);
  const filter = (params.get('disposition') ?? '') as QuestionDisposition | 'advisers' | 'review' | '';
  const viewAll = params.get('all') === '1' || filter !== '';

  const { plan, advisers, added } = useMemo(() => {
    const plan: Question[] = [];
    const advisers: Question[] = [];
    const added: Question[] = [];
    for (const q of idx.questions) {
      if (isAdviserQuestion(q)) advisers.push(q);
      else if (q.data?.origin === 'review') added.push(q);
      else plan.push(q);
    }
    return { plan, advisers, added };
  }, [idx]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of plan) c[q.data?.disposition ?? 'question'] = (c[q.data?.disposition ?? 'question'] ?? 0) + 1;
    return c;
  }, [plan]);

  const phaseKeys = useMemo(() => {
    const phase = currentPhase(idx);
    const keys = new Set<string>();
    if (!phase) return keys;
    for (const m of idx.milestones) if (m.data?.phase === phase && isOpenWork(m.status)) keys.add(m.key);
    return keys;
  }, [idx]);

  const ranked = useMemo(() => {
    return plan
      .filter((q) => (q.data?.disposition ?? 'question') === 'question' && isPlanQuestion(q))
      .map((q) => ({ q, score: relevanceScore(q, idx, dir, phaseKeys) }))
      .sort((a, b) => b.score - a.score || byKey(a.q, b.q))
      .map((x) => x.q);
  }, [plan, idx, dir, phaseKeys]);

  const shown = ranked.slice(0, 5 + extra);
  const all = useMemo(() => {
    const list = filter === 'advisers' ? advisers : filter === 'review' ? added : filter ? plan.filter((q) => q.data?.disposition === filter) : idx.questions;
    return [...list].sort(byKey);
  }, [idx, plan, advisers, added, filter]);

  const setFilter = (v: string) => {
    const p = new URLSearchParams(params);
    if (v === '') p.delete('disposition');
    else p.set('disposition', v);
    if (v === '') p.delete('all');
    setParams(p, { replace: true });
  };
  const showAll = () => {
    const p = new URLSearchParams(params);
    p.set('all', '1');
    setParams(p, { replace: true });
  };

  const coverageIntro =
    advisers.length > 0
      ? `${plan.length} from your plan · ${advisers.length} for your advisers${added.length ? ` · ${added.length} added at a review` : ''}. Every question is accounted for; only a few are shown at a time, but none are dropped.`
      : 'Every question is accounted for. Only a few are shown below at a time, but none are dropped.';

  return (
    <div className="stack stack--loose">
      {advisers.length > 0 && !viewAll && <AdviserQuestions idx={idx} questions={advisers} />}

      <Section title="Where all the questions stand" count={idx.questions.length} intro={coverageIntro} className="print-hide">
        <Card>
          <ul className="coverage">
            {DISPOSITIONS.map((d) => (
              <li key={d} className="coverage__row">
                <span>{QUESTION_DISPOSITION_LABEL[d]}</span>
                <strong>{counts[d] ?? 0}</strong>
              </li>
            ))}
            <li className="coverage__row coverage__row--total">
              <span>From your plan</span>
              <strong>{plan.length}</strong>
            </li>
            {advisers.length > 0 && (
              <li className="coverage__row">
                <span>For your advisers</span>
                <strong>{advisers.length}</strong>
              </li>
            )}
            {added.length > 0 && (
              <li className="coverage__row">
                <span>Added at a review</span>
                <strong>{added.length}</strong>
              </li>
            )}
          </ul>
          {!viewAll && (
            <div className="row-actions">
              <Button variant="secondary" onClick={showAll}>
                View all {idx.questions.length}
              </Button>
            </div>
          )}
        </Card>
      </Section>

      {!viewAll && (
        <Section title="A few to think about now" intro="Picked for the stage you’re in and for you." className="print-hide">
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="check" title="No open questions right now." />
            </Card>
          ) : (
            <ul className="stack stack--tight">
              {shown.map((q) => (
                <QuestionCard key={q.id} q={q} idx={idx} />
              ))}
            </ul>
          )}
          {ranked.length > shown.length && (
            <div>
              <Button variant="quiet" onClick={() => setExtra((e) => e + 5)}>
                Show 5 more ({ranked.length - shown.length} open questions left)
              </Button>
            </div>
          )}
        </Section>
      )}

      {viewAll && (
        <Section title="All questions" count={all.length}>
          <FilterChips
            label="Filter questions"
            value={filter}
            onChange={setFilter}
            options={[
              { value: '' as const, label: 'All', count: idx.questions.length },
              ...DISPOSITIONS.map((d) => ({ value: d as string, label: QUESTION_DISPOSITION_LABEL[d], count: counts[d] ?? 0 })),
              ...(advisers.length ? [{ value: 'advisers', label: 'For your advisers', count: advisers.length }] : []),
              ...(added.length ? [{ value: 'review', label: 'Added at a review', count: added.length }] : []),
            ]}
          />
          <ul className="stack stack--tight">
            {all.map((q) => (
              <QuestionCard key={q.id} q={q} idx={idx} />
            ))}
          </ul>
          {!filter && (
            <p className="small">
              <Button variant="quiet" onClick={() => setFilter('')}>
                Back to the short list
              </Button>
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
