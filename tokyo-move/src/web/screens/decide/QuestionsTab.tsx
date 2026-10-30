import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { QUESTION_DISPOSITION_LABEL } from '@shared/labels';
import type { QuestionDisposition } from '@shared/types';
import { Button, FilterChips } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Disclosure } from '../../components/Disclosure';
import { Card, EmptyState, Section } from '../../components/Layout';
import { RecordLink } from '../../components/RecordLink';
import { currentPhase } from '../../lib/home';
import { isOpenWork, type Directory, type Indexes, type Question } from '../../lib/records';

const DISPOSITIONS: QuestionDisposition[] = ['question', 'carry_forward', 'waiting_blocked', 'already_answered', 'not_applicable', 'explicitly_excluded'];

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

export function QuestionCard({ q, defaultOpen = false, showLink = true }: { q: Question; defaultOpen?: boolean; showLink?: boolean }) {
  const d = q.data;
  return (
    <li>
      <Disclosure
        title={d?.question || q.title}
        meta={QUESTION_DISPOSITION_LABEL[d?.disposition as QuestionDisposition] ?? undefined}
        level={3}
        defaultOpen={defaultOpen}
      >
        <div className="stack">
          {d?.topic && <p className="kicker">{d.topic}</p>}
          {d?.known && (
            <div>
              <h4>What we already know</h4>
              <p className="preline">{d.known}</p>
            </div>
          )}
          {d?.when_trigger && (
            <div>
              <h4>When it matters</h4>
              <p className="preline">{d.when_trigger}</p>
            </div>
          )}
          {d?.answer && (
            <div>
              <h4>Answer so far</h4>
              <p className="preline">{d.answer}</p>
            </div>
          )}
          {d?.local_note && (
            <div>
              <h4>Note</h4>
              <p className="preline">{d.local_note}</p>
            </div>
          )}
          {d?.evidence_basis && (
            <div>
              <h4>Where this comes from</h4>
              <p className="preline muted">{d.evidence_basis}</p>
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

function Questions({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const [params, setParams] = useSearchParams();
  const [extra, setExtra] = useState(0);
  const filter = (params.get('disposition') ?? '') as QuestionDisposition | '';
  const viewAll = params.get('all') === '1' || filter !== '';

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of idx.questions) c[q.data?.disposition ?? 'question'] = (c[q.data?.disposition ?? 'question'] ?? 0) + 1;
    return c;
  }, [idx]);

  const phaseKeys = useMemo(() => {
    const phase = currentPhase(idx);
    const keys = new Set<string>();
    if (!phase) return keys;
    for (const m of idx.milestones) if (m.data?.phase === phase && isOpenWork(m.status)) keys.add(m.key);
    return keys;
  }, [idx]);

  const ranked = useMemo(() => {
    return idx.questions
      .filter((q) => (q.data?.disposition ?? 'question') === 'question')
      .map((q) => ({ q, score: relevanceScore(q, idx, dir, phaseKeys) }))
      .sort((a, b) => b.score - a.score || a.q.key.localeCompare(b.q.key, undefined, { numeric: true }))
      .map((x) => x.q);
  }, [idx, dir, phaseKeys]);

  const shown = ranked.slice(0, 5 + extra);
  const all = useMemo(() => {
    const list = filter ? idx.questions.filter((q) => q.data?.disposition === filter) : idx.questions;
    return [...list].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [idx, filter]);

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

  return (
    <div className="stack stack--loose">
      <Section
        title="Where all the questions stand"
        count={idx.questions.length}
        intro="Every question is accounted for. Only a few are shown below at a time, but none are dropped."
      >
        <Card>
          <ul className="coverage">
            {DISPOSITIONS.map((d) => (
              <li key={d} className="coverage__row">
                <span>{QUESTION_DISPOSITION_LABEL[d]}</span>
                <strong>{counts[d] ?? 0}</strong>
              </li>
            ))}
            <li className="coverage__row coverage__row--total">
              <span>All questions</span>
              <strong>{idx.questions.length}</strong>
            </li>
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
        <Section title="A few to think about now" intro="Picked for the stage you’re in and for you.">
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="check" title="No open questions right now." />
            </Card>
          ) : (
            <ul className="stack stack--tight">
              {shown.map((q) => (
                <QuestionCard key={q.id} q={q} />
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
            ]}
          />
          <ul className="stack stack--tight">
            {all.map((q) => (
              <QuestionCard key={q.id} q={q} />
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

