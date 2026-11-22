import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { audienceLabel, QUESTION_DISPOSITION_LABEL } from '@shared/labels';
import { displayQuestion, displayTitle, displaySummary, keyLookup, stripCodes, type KeyLookup } from '@shared/plain';
import type { QuestionDisposition } from '@shared/types';
import { Button, Field, SegmentedControl, TextArea } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { ConflictBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/Layout';
import { More } from '../../components/More';
import { Prose } from '../../components/Prose';
import { RecordLink } from '../../components/RecordLink';
import { currentPhase } from '../../lib/home';
import { copyLine, copyText, countsLine, forAudience, numberedList, questionCounts, questionState, type QuestionState } from '../../lib/questions';
import { isOpenWork, type Directory, type Indexes, type Question } from '../../lib/records';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

/** Per group, the list starts short. */
export const SHOWN_FIRST = 10;
/** "For us" starts shorter: the household's own list is read first, so five, then "Show all (n)". */
export const OWN_FIRST = 5;
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

/** The question as one plain sentence: the plain question, else the source question, else the title. */
export function questionText(q: Question, lookup?: KeyLookup): string {
  return displayQuestion(q, lookup) ?? (stripCodes(q.data?.question, lookup) || displayTitle(q, lookup));
}

function Detail({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="qrow__detail">
      <p className="qrow__label">{label}</p>
      <p className="preline">
        <Prose text={text} />
      </p>
    </div>
  );
}

interface RowProps {
  q: Question;
  idx: Indexes;
  lookup?: KeyLookup;
  /** Set aside questions are listed, not answered here. */
  readOnly?: boolean;
  defaultOpen?: boolean;
  showLink?: boolean;
  onSaved?: (id: string) => void;
}

/** One question: the question, "Our answer: …" or an Answer control, and the context behind Details. */
function QuestionRow({ q, idx, lookup, readOnly = false, defaultOpen = false, showLink = true, onSaved }: RowProps) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const editorId = useId();
  const fieldWrap = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const d = q.data;
  const answered = questionState(q) === 'answered';
  const answer = d?.answer?.trim() ? d.answer : null;
  const summary = displaySummary(q);
  const about = aboutRecords(q, idx);
  const hasDetails = Boolean(d?.known || d?.when_trigger || d?.facts_needed || d?.evidence_basis || d?.local_note || about.length || showLink);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 5000);
    return () => window.clearTimeout(t);
  }, [saved]);

  const open = () => {
    setText(answer ?? '');
    setTried(false);
    w.clear();
    setEditing(true);
    window.setTimeout(() => fieldWrap.current?.querySelector('textarea')?.focus(), 0);
  };
  const cancel = () => {
    setEditing(false);
    w.clear();
    window.setTimeout(() => document.getElementById(`${editorId}-open`)?.focus(), 0);
  };
  const save = async () => {
    const value = text.trim();
    if (value === '') {
      setTried(true);
      fieldWrap.current?.querySelector('textarea')?.focus();
      return;
    }
    const ok = await w.run((v) => actions.patchRecord(q.id, v, { data: { disposition: 'already_answered', answer: value } }), q.version);
    if (!ok) return;
    setEditing(false);
    setSaved(true);
    onSaved?.(q.id);
  };

  return (
    <li id={`q-${q.key}`} className="qrow" tabIndex={-1}>
      <p className="qrow__q">{questionText(q, lookup)}</p>
      {summary && <p className="qrow__summary muted">{summary}</p>}
      {readOnly && <p className="qrow__answer muted">{QUESTION_DISPOSITION_LABEL[(d?.disposition ?? 'explicitly_excluded') as QuestionDisposition]}</p>}
      {!readOnly && answered && answer && (
        <p className="qrow__answer preline">
          <span className="qrow__label">Our answer: </span>
          <Prose text={answer} />
        </p>
      )}
      <div className="qrow__foot">
        {!readOnly && (
        <>
          <div className="qrow__actions" hidden={editing}>
            <Button id={`${editorId}-open`} variant={answered ? 'quiet' : 'secondary'} small aria-expanded={editing} aria-controls={editorId} onClick={open}>
              {answered ? 'Change answer' : 'Answer'}
              <span className="visually-hidden">: {questionText(q, lookup)}</span>
            </Button>
          </div>
          <span className="qrow__saved" role="status">
            {saved ? (
              <>
                <Icon name="check" size={14} /> Saved
              </>
            ) : null}
          </span>
          <div id={editorId} className="qrow__editor" ref={fieldWrap} hidden={!editing}>
            {editing && (
              <>
                <Field label="Our answer" error={tried && text.trim() === '' ? 'Write the answer first.' : null}>
                  <TextArea value={text} rows={3} onChange={(e) => setText(e.target.value)} />
                </Field>
                {w.error && (
                  <p className="field__error" role="alert">
                    {w.error}
                  </p>
                )}
                {w.conflict && (
                  <ConflictBanner
                    conflict={w.conflict}
                    busy={w.busy}
                    onKeepTheirs={() => {
                      w.keepTheirs();
                      setEditing(false);
                    }}
                    onUseMine={async () => {
                      if (await w.useMine()) {
                        setEditing(false);
                        setSaved(true);
                        onSaved?.(q.id);
                      }
                    }}
                  />
                )}
                <div className="qrow__actions">
                  <Button variant="primary" busy={w.busy} onClick={() => void save()}>
                    Save
                  </Button>
                  <Button variant="quiet" onClick={cancel}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
        )}
      {hasDetails && (
        <More label="Details" defaultOpen={defaultOpen} className="qrow__more">
          <Detail label="What we know" text={d?.known} />
          <Detail label="When it matters" text={d?.when_trigger} />
          <Detail label="Facts to bring" text={d?.facts_needed} />
          <Detail label="Source" text={d?.evidence_basis} />
          <Detail label="Note" text={d?.local_note} />
          {about.length > 0 && (
            <p>
              <span className="qrow__label">About: </span>
              {about.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ', '}
                  <RecordLink id={r.id}>{displayTitle(r, lookup)}</RecordLink>
                </span>
              ))}
            </p>
          )}
          {showLink && (
            <p>
              <RecordLink id={q.id}>Open full page</RecordLink>
            </p>
          )}
        </More>
      )}
      </div>
    </li>
  );
}

/** Used on a question's own page. */
export function QuestionCard({ q, idx, defaultOpen = false, showLink = true }: { q: Question; idx?: Indexes; defaultOpen?: boolean; showLink?: boolean }) {
  const lookup = useMemo(() => (idx ? keyLookup(idx.byKey) : undefined), [idx]);
  if (!idx) return null;
  return <QuestionRow q={q} idx={idx} lookup={lookup} defaultOpen={defaultOpen} showLink={showLink} />;
}

export function QuestionsTab() {
  return <DataGate>{({ idx, dir }) => <Questions idx={idx} dir={dir} />}</DataGate>;
}

type Show = 'open' | 'answered' | 'all';
const SHOW_OPTIONS: { value: Show; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'answered', label: 'Answered' },
  { value: 'all', label: 'All' },
];

interface GroupDef {
  key: string;
  title: string;
  /** Questions meant for a professional are asked in a batch, so they can be copied. */
  professional: boolean;
  questions: Question[];
}

function Group({
  group,
  show,
  idx,
  lookup,
  rank,
  kept,
  onSaved,
}: {
  group: GroupDef;
  show: Show;
  idx: Indexes;
  lookup?: KeyLookup;
  rank: (q: Question) => number;
  kept: ReadonlySet<string>;
  onSaved: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // A professional group starts folded to its heading, count and copy control; it opens on tap.
  const [groupOpen, setGroupOpen] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const listId = useId();
  const bodyId = useId();
  const headId = useId();

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 4000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const { shownQs, openQs } = useMemo(() => {
    const open = group.questions.filter((q) => questionState(q) === 'open').sort((a, b) => rank(b) - rank(a) || byKey(a, b));
    const answered = group.questions.filter((q) => questionState(q) === 'answered').sort(byKey);
    // A question answered a moment ago stays where it was while this view is open, so focus is not lost.
    const wanted = (q: Question) => show === 'all' || questionState(q) === show || kept.has(q.id);
    const merged = show === 'answered' ? [...answered] : [...open, ...answered];
    return { shownQs: merged.filter(wanted), openQs: open };
  }, [group.questions, show, rank, kept]);

  if (shownQs.length === 0) return null;
  const first = group.professional ? SHOWN_FIRST : OWN_FIRST;
  // A row answered a moment ago stays in view even when it has moved down the list.
  const visible = expanded ? shownQs : shownQs.filter((q, i) => i < first || kept.has(q.id));
  const copy = async () => {
    const ok = await copyText(numberedList(openQs.map((q) => copyLine(questionText(q, lookup)))));
    setCopied(ok ? 'ok' : 'fail');
  };
  const list = (
    <>
      <ul id={listId} className="qlist">
        {visible.map((q) => (
          <QuestionRow key={q.id} q={q} idx={idx} lookup={lookup} onSaved={onSaved} />
        ))}
      </ul>
      {shownQs.length > first && (
        <Button variant="quiet" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `Show all (${shownQs.length})`}
        </Button>
      )}
    </>
  );

  if (!group.professional) {
    return (
      <section className="qgroup" aria-labelledby={headId}>
        <div className="qgroup__head">
          <h3 id={headId} className="qgroup__title">
            {group.title}
          </h3>
        </div>
        {list}
      </section>
    );
  }

  return (
    <section className={`qgroup qgroup--folded${groupOpen ? ' is-open' : ''}`} aria-labelledby={headId}>
      <div className="qgroup__head">
        <h3 id={headId} className="qgroup__title">
          <button type="button" className="qgroup__toggle" aria-expanded={groupOpen} aria-controls={bodyId} onClick={() => setGroupOpen((v) => !v)}>
            <span>{group.title}</span>
            <span className="qgroup__count">
              {shownQs.length}
              <span className="visually-hidden"> {shownQs.length === 1 ? 'question' : 'questions'}</span>
            </span>
            <Icon name="chevron-down" size={16} className="qgroup__chev" />
          </button>
        </h3>
        {groupOpen && openQs.length > 0 && (
          <Button variant="quiet" small icon="file" onClick={() => void copy()}>
            Copy these questions<span className="visually-hidden"> for {group.title.replace(/^For /, '')}</span>
          </Button>
        )}
      </div>
      <p className="qgroup__copied muted" role="status">
        {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Could not copy. Select the text instead.' : ''}
      </p>
      <div id={bodyId} hidden={!groupOpen}>
        {groupOpen && list}
      </div>
    </section>
  );
}

function Questions({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('show');
  const show: Show = raw === 'answered' || raw === 'all' ? raw : 'open';
  const lookup = useMemo(() => keyLookup(idx.byKey), [idx]);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);

  const counts = useMemo(() => questionCounts(idx.questions), [idx.questions]);
  const phaseKeys = useMemo(() => {
    const phase = currentPhase(idx);
    const keys = new Set<string>();
    if (!phase) return keys;
    for (const m of idx.milestones) if (m.data?.phase === phase && isOpenWork(m.status)) keys.add(m.key);
    return keys;
  }, [idx]);
  const rank = useMemo(() => {
    const cache = new Map<string, number>();
    return (q: Question) => {
      let s = cache.get(q.id);
      if (s === undefined) {
        s = relevanceScore(q, idx, dir, phaseKeys);
        cache.set(q.id, s);
      }
      return s;
    };
  }, [idx, dir, phaseKeys]);

  const { groups, excluded } = useMemo(() => {
    const own: Question[] = [];
    const byAudience = new Map<string, Question[]>();
    const excluded: Question[] = [];
    for (const q of idx.questions) {
      if (questionState(q) === 'excluded') {
        excluded.push(q);
        continue;
      }
      const a = q.data?.audience;
      if (!a || a === 'household') own.push(q);
      else byAudience.set(a, [...(byAudience.get(a) ?? []), q]);
    }
    const groups: GroupDef[] = [];
    const professional = [...byAudience.entries()]
      .map(([a, qs]) => ({ key: a, title: forAudience(a, audienceLabel(a)), professional: true, questions: qs }))
      .sort((a, b) => a.title.localeCompare(b.title));
    // With no professional groups there is only one list, and it needs no heading about who it is for.
    if (own.length > 0) groups.push({ key: 'household', title: professional.length > 0 ? 'For us' : 'Our questions', professional: false, questions: own });
    groups.push(...professional);
    return { groups, excluded: excluded.sort(byKey) };
  }, [idx.questions]);

  const setShow = (v: Show) => {
    const p = new URLSearchParams(params);
    if (v === 'open') p.delete('show');
    else p.set('show', v);
    setParams(p, { replace: true });
  };
  const onSaved = (id: string) => {
    setKept((k) => new Set(k).add(id));
    setFocusId(id);
  };
  useEffect(() => {
    if (!focusId) return;
    const q = idx.questions.find((x) => x.id === focusId);
    if (q) document.getElementById(`q-${q.key}`)?.focus();
    setFocusId(null);
  }, [focusId, idx.questions]);

  const anyShown = groups.some((g) => g.questions.some((q) => show === 'all' || questionState(q) === show || kept.has(q.id)));

  return (
    <div className="qtab">
      <h2 className="visually-hidden">Questions</h2>
      <div className="qtab__bar">
        <p className="qtab__counts">{countsLine(counts)}</p>
        <SegmentedControl<Show> label="Show" value={show} onChange={setShow} options={SHOW_OPTIONS} />
      </div>
      {!anyShown && (
        <EmptyState
          icon="check"
          title={show === 'answered' ? 'Nothing answered yet.' : 'Nothing left to answer.'}
          action={
            counts.answered > 0 && show === 'open' ? (
              <Button variant="quiet" onClick={() => setShow('answered')}>
                Show answered
              </Button>
            ) : undefined
          }
        />
      )}
      {groups.map((g) => (
        <Group key={g.key} group={g} show={show} idx={idx} lookup={lookup} rank={rank} kept={kept} onSaved={onSaved} />
      ))}
      {show === 'all' && excluded.length > 0 && (
        <More label={`Not needed (${excluded.length})`} className="qtab__excluded">
          <ul className="qlist">
            {excluded.map((q) => (
              <QuestionRow key={q.id} q={q} idx={idx} lookup={lookup} readOnly />
            ))}
          </ul>
        </More>
      )}
    </div>
  );
}
