import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type Ref } from 'react';
import { Link } from 'react-router';
import { displayDelay, displayQuestion, displaySummary, displayTitle, keyLookup, optionLabel, stripCodes, type KeyLookup } from '@shared/plain';
import type { BaseRecord } from '@shared/types';
import { DateText, YourTurnChip } from '../../components/Badges';
import { ClampText } from '../../components/ClampText';
import { Button, Field, TextInput } from '../../components/Controls';
import { ConflictBanner } from '../../components/Feedback';
import { Icon, type IconName } from '../../components/Icon';
import { Card } from '../../components/Layout';
import { More } from '../../components/More';
import { usePlain } from '../../components/People';
import { Prose } from '../../components/Prose';
import { RecordLink } from '../../components/RecordLink';
import { dateLine } from '../../lib/dateLine';
import { decisionEffect } from '../../lib/decisionEffects';
import { civil, dayIn } from '../../lib/format';
import { recordedDecision, settledPart } from '../../lib/home';
import type { Decision, Directory, Indexes } from '../../lib/records';
import { api } from '../../net/client';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';
import { AddAlternativeDialog, AddNoteDialog, ReasonDialog } from './decisionDialogs';
import {
  bare,
  canReopen,
  decisionStatus,
  decisionTurn,
  initialChoice,
  isOpenDecision,
  mainButtonLabel,
  orderedOptions,
  requiredApproverIds,
  sentence,
  type DecisionStatus,
} from './decisionText';

const trimEnd = (t: string) => t.replace(/[.\s]+$/, '');

/** How long the "Saved" line stays on the card after a choice. */
const SAID_MS = 6000;

/** The shared Button's look, for the few buttons that must take focus back after an action (they need a ref). */
function FocusButton({
  variant = 'secondary',
  small = false,
  icon,
  className = '',
  children,
  ref,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet'; small?: boolean; icon?: IconName; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type={type} className={`btn btn--${variant}${small ? ' btn--sm' : ''} ${className}`.trim()} {...rest}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
const cardSelector = (key: string) => `[id="decision-${key.replace(/["\\]/g, '\\$&')}"]`;

/** How a decision just ended, for the in-place "Decided: … Undo" notice. */
export interface SettledOutcome {
  kind: 'decided' | 'put-off' | 'not-doing';
  /** The chosen option's label, when it was decided. */
  label: string | null;
  record: BaseRecord;
}

/** After a decision settles whether a step applies to the pet, offer to carry that answer to the step. */
function ApplyEffect({ d, idx, dir }: { d: Decision; idx: Indexes; dir: Directory }) {
  const { actions, snapshot } = useSnapshot();
  const w = useWrite();
  const eff = decisionEffect(d, idx, dir, snapshot?.settings);
  if (!eff) return null;
  const title = displayTitle(eff.record);
  const apply = () => w.run((v) => actions.patchRecord(eff.record.id, v, { data: { applies_to: { [eff.personId]: eff.answer } } }), eff.record.version);
  return (
    <div className="applies">
      {eff.applied ? (
        <p>
          <Icon name="check" size={14} /> Applied: <RecordLink id={eff.record.id}>{title}</RecordLink> {eff.answer === 'yes' ? `now counts for ${eff.personName}` : `is not needed for ${eff.personName}`}.
        </p>
      ) : (
        <div>
          <Button variant="secondary" small busy={w.busy} onClick={() => void apply()}>
            Apply to {eff.personName}’s steps
          </Button>
        </div>
      )}
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
    </div>
  );
}

/** Whose turn it is: the one chip when it is mine, plain words with an icon otherwise. */
function StatusLine({ status }: { status: DecisionStatus }) {
  if (status.kind === 'my-turn') return <YourTurnChip small>{status.text}</YourTurnChip>;
  return (
    <span className={`dcard__status dcard__status--${status.kind}`}>
      <Icon name={status.icon} size={16} />
      <span>{status.text}</span>
    </span>
  );
}

/** "By Mon, Nov 30 (8 days)", or "11 days late". */
function DecideBy({ date, today }: { date: string; today: string }) {
  const late = dateLine(date, today).when === 'late';
  return (
    <span className="dcard__by">
      {late ? '' : 'By '}
      <DateText date={date} today={today} />
    </span>
  );
}

/** For a decision with no plain question yet: one quiet action that lets a person write it. */
function WriteQuestion({ d, onSaved }: { d: Decision; onSaved: () => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const cancel = () => {
    setEditing(false);
    setText('');
    setTried(false);
    w.clear();
    window.setTimeout(() => openerRef.current?.focus(), 0);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    let q = text.replace(/\s+/g, ' ').trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }
    if (!q.endsWith('?')) q = `${q.replace(/[.!]+$/, '')}?`;
    const ok = await w.run((v) => actions.patchRecord(d.id, v, { data: { plain_question: q } }), d.version);
    if (ok) {
      setEditing(false);
      setText('');
      onSaved();
    }
  };
  if (!editing) {
    return (
      <div>
        <FocusButton ref={openerRef} variant="quiet" small icon="pencil" onClick={() => setEditing(true)}>
          Write the question
        </FocusButton>
      </div>
    );
  }
  return (
    <form className="dcard__ask" onSubmit={(e) => void save(e)}>
      <Field label="The question" error={tried && !text.trim() ? 'Please write the question.' : null}>
        <TextInput ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" maxLength={200} enterKeyHint="done" />
      </Field>
      <div className="dcard__ask-actions">
        <Button type="submit" variant="secondary" busy={w.busy}>
          Save
        </Button>
        <Button variant="quiet" onClick={cancel}>
          Cancel
        </Button>
      </div>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); cancel(); }} onUseMine={() => void w.useMine().then((ok) => ok && (setEditing(false), onSaved()))} />}
    </form>
  );
}

/** "Reopen" on a decided, put-off or rejected decision, for 7 days. */
function Reopen({ d, label = 'Reopen', onReopened }: { d: Decision; label?: string; onReopened?: (rec: BaseRecord) => void }) {
  const { actions, refresh } = useSnapshot();
  const w = useWrite();
  const [expired, setExpired] = useState(false);
  if (!canReopen(d) && !w.error) return null;
  const run = () =>
    w.run(async (v) => {
      try {
        const rec = await api.reopenDecision(d.id, { baseVersion: v });
        actions.adoptRecord(rec);
        void refresh();
        onReopened?.(rec);
      } catch (e) {
        if (e instanceof Error && /more than \d+ days ago/.test(e.message)) setExpired(true);
        throw e;
      }
    }, d.version);
  return (
    <div className="dcard__reopen">
      {!expired && (
        <Button variant="quiet" small icon="undo" busy={w.busy} onClick={() => void run()}>
          {label}
        </Button>
      )}
      {w.error && (
        <p className="field__error" role="alert">
          {expired ? 'This can no longer be reopened. It was settled over 7 days ago.' : w.error}
        </p>
      )}
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
    </div>
  );
}

interface CardProps {
  d: Decision;
  idx: Indexes;
  dir: Directory;
  today: string;
  /** Show the choices and the actions from the start (record pages, deep links). */
  startOpen?: boolean;
  /** Leave out the card's own heading when the page already shows the title (the record page). */
  hideTitle?: boolean;
  /** Heading level of the card title (the sub-headings follow it). */
  level?: 1 | 2 | 3;
  /** Called when the last required person agrees. */
  onDecidedTogether?: (d: Decision) => void;
  /** Called when the decision is decided, put off or closed from this card, so a list can show "Decided … Undo" in place. */
  onSettled?: (d: Decision, outcome: SettledOutcome) => void;
  /** Called when I pick an answer, before it is saved, so a list can keep the card where it is. */
  onChose?: (d: Decision) => void;
  /** Called when the card is opened from its collapsed state, so a list can keep it where it is. */
  onExpand?: (d: Decision) => void;
  /** Collapsed, show only the question and a quiet "Open" (the cards under "Later"). */
  slim?: boolean;
  /** The words the list heading already says for every card in it ("Your turn"): a status saying the same is left out. */
  groupSays?: string | null;
  /** Called after "Reopen" succeeds. */
  onReopened?: (d: Decision, rec: BaseRecord) => void;
  /** Resolves record codes to names. Built from `idx` when not given. */
  lookup?: KeyLookup;
}

/**
 * One decision, about 60 words: whose turn, the question, when it is needed, what happens if we wait, the choices as
 * radios, and one button that agrees with the picked choice. Everything else sits behind "Why and history".
 * A decision settles only when every required person picked the same choice (the server enforces it).
 */
export function DecisionCard({
  d,
  idx,
  dir,
  today,
  startOpen = false,
  hideTitle = false,
  level = 3,
  onDecidedTogether,
  onSettled,
  onChose,
  onExpand,
  onReopened,
  slim = false,
  groupSays = null,
  lookup: given,
}: CardProps) {
  const data = d.data ?? ({} as Decision['data']);
  const lookup = useMemo(() => given ?? keyLookup(idx.byKey), [given, idx]);
  const meId = dir.me?.id ?? null;
  const status = decisionStatus(d, meId, dir);
  const open = isOpenDecision(d);
  const question = displayQuestion(d, lookup);
  const heading = question ?? displayTitle(d, lookup);
  const [expanded, setExpanded] = useState(startOpen);
  const showBody = startOpen || expanded;
  // What just happened, said on the card under its heading (never over a button): visible words plus words only
  // a screen reader needs.
  const [announce, setAnnounce] = useState<{ shown: string; extra: string }>({ shown: '', extra: '' });
  const saidTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (saidTimer.current) window.clearTimeout(saidTimer.current);
  }, []);
  const articleRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyId = useId();
  const Title = `h${level}` as 'h1' | 'h2' | 'h3';
  const Sub = `h${Math.min(level + 1, 6)}` as 'h2' | 'h3' | 'h4';
  // Only a real date is shown on the card. A trigger sentence ("before the lease is signed") waits behind "Why and
  // history".
  const needed = data.needed_by?.date ?? null;
  const delay = open ? displayDelay(d, lookup) : null;
  const recorded = recordedDecision(d);
  const required = requiredApproverIds(d, dir);
  const iChoose = !!meId && required.includes(meId);
  const showStatus = open && !(groupSays && status.text === groupSays);
  const collapsedSlim = slim && open && !showBody;

  const say = (shown: string, extra = '') => {
    setAnnounce({ shown: '', extra: '' });
    if (saidTimer.current) window.clearTimeout(saidTimer.current);
    window.setTimeout(() => setAnnounce({ shown, extra }), 30);
    saidTimer.current = window.setTimeout(() => setAnnounce({ shown: '', extra: '' }), SAID_MS);
  };

  const expand = () => {
    onExpand?.(d);
    setExpanded(true);
    // Move into the revealed choices so a keyboard or screen-reader user lands on the question's options.
    window.setTimeout(() => {
      const body = document.getElementById(bodyId);
      const target = body?.querySelector<HTMLElement>('input[type="radio"]:checked, input[type="radio"], button, [tabindex="-1"]');
      (target ?? articleRef.current)?.focus();
    }, 30);
  };
  const collapse = () => {
    if (articleRef.current) articleRef.current.style.minHeight = '';
    setExpanded(false);
    window.setTimeout(() => toggleRef.current?.focus(), 30);
  };

  const settled = (outcome: SettledOutcome) => {
    const words = outcome.kind === 'decided' ? `Decided: ${sentence(bare(outcome.label ?? 'done'))}` : outcome.kind === 'put-off' ? 'Put off.' : 'Not doing this.';
    say(words);
    if (onSettled) onSettled(d, outcome);
    else window.setTimeout(() => articleRef.current?.focus(), 60); // the buttons are gone; keep focus on the card
  };

  const labelOf = (id: string | null | undefined) => {
    const o = (data.options ?? []).find((x) => x.id === id);
    return o ? optionLabel(d, o, lookup) : null;
  };

  const hasTop = !collapsedSlim && (showStatus || (open && !!needed) || (open && expanded && !startOpen));

  return (
    <li className="dcard-item">
      <Card
        as="article"
        ref={articleRef}
        id={`decision-${d.key}`}
        tabIndex={-1}
        className={`decision dcard dcard--${status.kind}${showBody ? ' is-open' : ''}${collapsedSlim ? ' dcard--slim' : ''}`}
        aria-labelledby={hideTitle ? undefined : `dt-${d.key}`}
        aria-label={hideTitle ? heading : undefined}
      >
        {hasTop && (
          <div className="dcard__top">
            {showStatus && <StatusLine status={status} />}
            {open && needed && <DecideBy date={needed} today={today} />}
            {open && expanded && !startOpen && (
              <button type="button" className="dcard__close" aria-expanded={true} aria-controls={bodyId} aria-label="Hide choices" title="Hide choices" onClick={collapse}>
                <Icon name="x" size={18} />
              </button>
            )}
          </div>
        )}
        {!hideTitle ? (
          <Title id={`dt-${d.key}`} ref={headingRef} tabIndex={-1} className="dcard__q">
            {heading}
          </Title>
        ) : (
          question && question !== displayTitle(d, lookup) && <p className="dcard__q dcard__q--sub">{question}</p>
        )}
        <p role="status" className="dcard__said">
          {announce.shown && (
            <>
              <Icon name="check" size={16} />
              <span>{announce.shown}</span>
            </>
          )}
          {announce.extra && <span className="visually-hidden"> {announce.extra}</span>}
        </p>
        {delay && showBody && (
          <ClampText lines={2} className="dcard__delay" moreLabel="Show all">
            <span className="dcard__label">If we don’t decide:</span> {delay}
          </ClampText>
        )}

        {open ? (
          <>
            {!showBody && (
              <div className="dcard__toggle">
                {slim ? (
                  <FocusButton ref={toggleRef} variant="quiet" small aria-expanded={false} aria-controls={bodyId} onClick={expand}>
                    Open
                  </FocusButton>
                ) : (
                  <FocusButton ref={toggleRef} variant={status.kind === 'my-turn' ? 'primary' : 'secondary'} aria-expanded={false} aria-controls={bodyId} onClick={expand}>
                    {status.kind === 'my-turn' ? 'Decide' : 'See choices'}
                  </FocusButton>
                )}
              </div>
            )}
            <div id={bodyId} className="dcard__body" hidden={!showBody}>
              {showBody && (
                <OpenBody
                  d={d}
                  idx={idx}
                  dir={dir}
                  lookup={lookup}
                  heading={heading}
                  hasQuestion={!!question}
                  iChoose={iChoose}
                  Sub={Sub}
                  labelOf={labelOf}
                  say={say}
                  onQuestionSaved={() => window.setTimeout(() => headingRef.current?.focus(), 30)}
                  onChose={() => onChose?.(d)}
                  onSettled={(o) => {
                    if (o.kind === 'decided') onDecidedTogether?.(d);
                    settled(o);
                  }}
                />
              )}
            </div>
          </>
        ) : (
          <ClosedBody d={d} idx={idx} dir={dir} today={today} lookup={lookup} Sub={Sub} labelOf={labelOf} recorded={recorded} onReopened={(rec) => {
            say('Reopened.');
            if (onReopened) onReopened(d, rec);
            else window.setTimeout(() => articleRef.current?.focus(), 60);
          }} />
        )}
      </Card>
    </li>
  );
}

/* ------------------------------------------------------------------ open: choosing */

/** "Suggested · Jun picked this", on its own line above a choice. Words, not colour. */
function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="dopt__tags">
      {tags.map((x, i) => (
        <span key={x}>
          {i > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="visually-hidden">, </span>
            </>
          )}
          {x}
        </span>
      ))}
      <span className="visually-hidden">: </span>
    </span>
  );
}

interface OpenBodyProps {
  d: Decision;
  idx: Indexes;
  dir: Directory;
  lookup: KeyLookup | undefined;
  heading: string;
  hasQuestion: boolean;
  iChoose: boolean;
  Sub: 'h2' | 'h3' | 'h4';
  labelOf: (id: string | null | undefined) => string | null;
  say: (shown: string, extra?: string) => void;
  onQuestionSaved: () => void;
  onChose: () => void;
  onSettled: (o: SettledOutcome) => void;
}

function OpenBody({ d, idx, dir, lookup, heading, hasQuestion, iChoose, Sub, labelOf, say, onQuestionSaved, onChose, onSettled }: OpenBodyProps) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const meId = dir.me?.id ?? null;
  const t = decisionTurn(d, meId, dir);
  const options = orderedOptions(d);
  const rec = d.data?.recommended_option_id ?? null;
  const otherName = t.otherId ? dir.nameOf(t.otherId) : null;
  const waitingNames = requiredApproverIds(d, dir).filter((id) => id !== meId && !(d.data?.approvals ?? []).some((a) => a.person_id === id)).map((id) => dir.nameOf(id));
  const [changing, setChanging] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => initialChoice(d, meId, dir));
  const [reasonMode, setReasonMode] = useState<'reject' | 'defer' | null>(null);
  const [adding, setAdding] = useState(false);
  const [noting, setNoting] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const fallback = cardSelector(d.key);

  // Someone else's change arrived (refresh): start again from the rule, unless I am in the middle of picking.
  const versionRef = useRef(d.version);
  useEffect(() => {
    if (versionRef.current !== d.version && !w.busy) {
      versionRef.current = d.version;
      setSelected(initialChoice(d, meId, dir));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.version]);

  const agree = async () => {
    if (!selected) return;
    onChose(); // a list keeps the card where it is while the answer is saved
    // The card gets shorter once the choices give way to "You chose". Near the end of the page that would pull the
    // page up under the reader's thumb, so the card keeps its height until it is closed or the page is left.
    const article = innerRef.current?.closest('article');
    const height = article?.getBoundingClientRect().height ?? 0;
    let out: BaseRecord | null = null;
    const ok = await w.run(async (v) => {
      out = await actions.approveDecision(d.id, v, selected, null);
    }, d.version);
    const res = out as BaseRecord | null;
    if (!ok || !res) return;
    const label = labelOf(selected);
    setChanging(false);
    if (res.status === 'approved') {
      onSettled({ kind: 'decided', label, record: res });
    } else {
      versionRef.current = res.version;
      if (article && height > 0) article.style.minHeight = `${Math.round(height)}px`;
      const names = waitingNames.length ? waitingNames.join(' and ') : null;
      const differs = !!t.otherOptionId && t.otherOptionId !== selected;
      const after = differs ? `${otherName ?? 'They'} picked something else.` : names ? `Waiting for ${names}.` : '';
      say('Saved.', `You chose: ${sentence(bare(label ?? 'your answer'))} ${after}`.trim());
      // Stay on the card: focus the next thing to do, without scrolling the page.
      window.setTimeout(() => changeRef.current?.focus({ preventScroll: true }), 60);
    }
  };

  const showChosen = iChoose && t.turn === 'waiting_partner' && !changing;
  const showDisagree = iChoose && t.turn === 'disagree' && !changing;
  const myLabel = labelOf(t.myOptionId);
  const otherLabel = labelOf(t.otherOptionId);

  const startChanging = (e: React.MouseEvent<HTMLButtonElement>, preselect: string | null) => {
    const card = e.currentTarget.closest('article');
    setChanging(true);
    setSelected(preselect);
    window.setTimeout(() => card?.querySelector<HTMLInputElement>('input[type="radio"]:checked, input[type="radio"]')?.focus(), 30);
  };

  const tags = (id: string) => {
    const out: string[] = [];
    if (id === rec && options.length > 1) out.push('Suggested');
    if (otherName && id === t.otherOptionId) out.push(`${otherName} picked this`);
    if (id === t.myOptionId && changing) out.push('You picked this');
    return out;
  };

  const buttonText = mainButtonLabel(labelOf(selected), { selectedId: selected, otherOptionId: t.otherOptionId, otherName });
  const pickedElse = !!otherName && !!t.otherOptionId && !!selected && selected !== t.otherOptionId;

  const quietActions = (
    <>
      <Button variant="quiet" onClick={() => setReasonMode('defer')}>
        Not now
      </Button>
      <Button variant="quiet" onClick={() => setReasonMode('reject')}>
        None of these work
      </Button>
    </>
  );

  return (
    <div className="dcard__inner" ref={innerRef}>
      {!hasQuestion && <WriteQuestion d={d} onSaved={onQuestionSaved} />}

      {options.length === 0 ? (
        <p className="dcard__none">No choices are written down yet.</p>
      ) : showChosen ? (
        <div className="dcard__chosen">
          <p>
            You chose: <strong>{bare(myLabel ?? 'an answer')}</strong>
          </p>
          <div>
            <FocusButton ref={changeRef} variant="quiet" small onClick={(e) => startChanging(e, t.myOptionId)}>
              Change my answer
            </FocusButton>
          </div>
        </div>
      ) : showDisagree ? (
        <div className="dcard__chosen dcard__chosen--both">
          <p>
            You: <strong>{bare(myLabel ?? 'an answer')}</strong>
          </p>
          <p>
            {otherName ?? 'They'}: <strong>{bare(otherLabel ?? 'another answer')}</strong>
          </p>
          <p className="dcard__hint">Talk it over, then one of you changes.</p>
          <div className="dcard__actions">
            <FocusButton ref={changeRef} variant="primary" onClick={(e) => startChanging(e, t.otherOptionId ?? t.myOptionId)}>
              Change my answer
            </FocusButton>
            {quietActions}
          </div>
          {w.error && <p className="field__error" role="alert">{w.error}</p>}
        </div>
      ) : iChoose ? (
        <>
          {options.length === 1 ? (
            <p className="dopt dopt--single">
              <span className="dopt__text">
                <Tags tags={tags(options[0]!.id).filter((x) => x !== 'Suggested')} />
                <span className="dopt__label">{optionLabel(d, options[0]!, lookup)}</span>
              </span>
            </p>
          ) : (
            <fieldset className="dopts">
              <legend className="visually-hidden">{heading}</legend>
              {options.map((o) => (
                <label key={o.id} className="dopt">
                  <input type="radio" name={`choice-${d.key}`} value={o.id} checked={selected === o.id} onChange={() => setSelected(o.id)} />
                  <span className="dopt__text">
                    <Tags tags={tags(o.id)} />
                    <span className="dopt__label">{optionLabel(d, o, lookup)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {pickedElse && <p className="dcard__hint">{otherName} picked something else</p>}
          <div className="dcard__actions">
            <Button variant="primary" className="dcard__main" busy={w.busy} disabled={!selected || selected === t.myOptionId} onClick={() => void agree()}>
              <span className="dcard__main-text">{buttonText}</span>
            </Button>
            {changing ? (
              <Button variant="quiet" onClick={() => setChanging(false)}>
                Keep my answer
              </Button>
            ) : (
              quietActions
            )}
          </div>
          {w.error && <p className="field__error" role="alert">{w.error}</p>}
          {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
        </>
      ) : (
        <>
          <ul className="dopts dopts--read">
            {options.map((o) => (
              <li key={o.id} className="dopt dopt--single">
                <Tags tags={tags(o.id)} />
                <span className="dopt__label">{optionLabel(d, o, lookup)}</span>
              </li>
            ))}
          </ul>
          <div>
            <Button variant="quiet" small onClick={() => setNoting(true)}>
              Add a note
            </Button>
          </div>
        </>
      )}

      <WhyAndHistory d={d} idx={idx} dir={dir} lookup={lookup} Sub={Sub} labelOf={labelOf} onAddChoice={iChoose ? () => setAdding(true) : undefined} />

      <ReasonDialog
        decision={d}
        mode={reasonMode}
        onClose={() => setReasonMode(null)}
        fallbackFocus={fallback}
        onDone={(res, mode) => onSettled({ kind: mode === 'defer' ? 'put-off' : 'not-doing', label: null, record: res })}
      />
      {adding && <AddAlternativeDialog decision={d} onClose={() => setAdding(false)} fallbackFocus={fallback} />}
      {noting && <AddNoteDialog record={d} onClose={() => setNoting(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ closed: decided, put off, not doing */

/** One line saying how a closed decision ended, in the house status words. */
export function outcomeLine(d: Decision, chosen: string | null, recordedSummary: string | null, today: string, lookup?: KeyLookup): { text: string; date: string | null; icon: IconName } {
  const data = d.data ?? ({} as Decision['data']);
  if (d.status === 'approved' || recordedSummary !== null) {
    const what = chosen ?? (recordedSummary ? stripCodes(recordedSummary, lookup) : null);
    return { text: what ? `Decided: ${bare(what)}` : 'Decided', date: null, icon: 'check' };
  }
  if (d.status === 'superseded') return { text: 'Replaced by a newer decision', date: null, icon: 'x' };
  if (d.status === 'rejected') return { text: 'Not doing this', date: null, icon: 'x' };
  if (d.status === 'deferred') {
    const on = data.revisit_on ?? null;
    return { text: on ? 'Put off until' : 'Put off', date: on && today ? on : null, icon: 'hourglass' };
  }
  return { text: 'Decided', date: null, icon: 'check' };
}

function ClosedBody({
  d,
  idx,
  dir,
  today,
  lookup,
  Sub,
  labelOf,
  recorded,
  onReopened,
}: {
  d: Decision;
  idx: Indexes;
  dir: Directory;
  today: string;
  lookup: KeyLookup | undefined;
  Sub: 'h2' | 'h3' | 'h4';
  labelOf: (id: string | null | undefined) => string | null;
  recorded: ReturnType<typeof recordedDecision>;
  onReopened: (rec: BaseRecord) => void;
}) {
  const data = d.data ?? ({} as Decision['data']);
  const chosen = labelOf(data.decided_option_id);
  const line = outcomeLine(d, chosen, recorded ? (recorded.summary ?? '') : null, today, lookup);
  return (
    <div className="dcard__inner">
      <p className={`dcard__outcome dcard__outcome--${d.status}`}>
        <Icon name={line.icon} size={16} />
        <span className="dcard__outcome-text">
          {line.text}
          {line.date && (
            <>
              {' '}
              <DateText date={line.date} today={today} />
            </>
          )}
        </span>
      </p>
      {d.status === 'approved' && <ApplyEffect d={d} idx={idx} dir={dir} />}
      <Reopen d={d} onReopened={onReopened} />
      <WhyAndHistory d={d} idx={idx} dir={dir} lookup={lookup} Sub={Sub} labelOf={labelOf} />
    </div>
  );
}

/* ------------------------------------------------------------------ why and history */

function WhyAndHistory({
  d,
  idx,
  dir,
  lookup,
  Sub,
  labelOf,
  onAddChoice,
}: {
  d: Decision;
  idx: Indexes;
  dir: Directory;
  lookup: KeyLookup | undefined;
  Sub: 'h2' | 'h3' | 'h4';
  labelOf: (id: string | null | undefined) => string | null;
  onAddChoice?: () => void;
}) {
  const plain = usePlain();
  const { zone } = usePrefs();
  const data = d.data ?? ({} as Decision['data']);
  const recorded = recordedDecision(d);
  const summary = displaySummary(d);
  const settled = settledPart(d);
  const options = data.options ?? [];
  const meanings = options.filter((o) => o.consequences && o.consequences.trim());
  const deps = (data.dependencies ?? []).map((k) => idx.byKey.get(k)).filter((r): r is NonNullable<typeof r> => !!r);
  const approvals = [...(data.approvals ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  const historyLines = (data.history_note ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  // The imported wording, shown only where the plain wording replaced it.
  const shownTitle = displayQuestion(d, lookup) ?? displayTitle(d, lookup);
  const original: { label: string; text: string }[] = [];
  if (d.title.trim() && d.title.trim() !== shownTitle) original.push({ label: 'Title', text: d.title });
  if (data.question && data.question.trim() !== d.title.trim() && data.question.trim() !== shownTitle) original.push({ label: 'Question', text: data.question });
  for (const o of options) if (optionLabel(d, o, lookup) !== o.label.trim()) original.push({ label: 'Choice', text: o.label });
  const why = summary ?? data.rationale ?? null;
  // Why a closed decision ended the way it did is history too: everything but the one outcome line lives here.
  const open = d.status === 'open' || d.status === 'proposed';
  const trigger = open && !data.needed_by?.date ? stripCodes(data.trigger ?? '', lookup) : '';
  const recordedSummary = recorded?.summary ? stripCodes(recorded.summary, lookup) : '';

  return (
    <More label="Why and history" className="dcard__more">
      {recordedSummary && (
        <p>
          <span className="dcard__label">What we decided:</span> {recordedSummary}
        </p>
      )}
      {trigger && (
        <p>
          <span className="dcard__label">Needed when:</span> {trigger}
        </p>
      )}
      {settled && (
        <p>
          <span className="dcard__label">Already decided:</span> {plain(settled)}
        </p>
      )}
      {recorded?.open_part && (
        <p>
          <span className="dcard__label">Still open:</span> {plain(recorded.open_part)}
        </p>
      )}
      {why && (
        <div>
          <Sub className="dcard__sub">Why</Sub>
          <p className="preline">{summary ? summary : <Prose text={why} />}</p>
        </div>
      )}
      {meanings.length > 0 && (
        <div>
          <Sub className="dcard__sub">What each choice means</Sub>
          <ul className="plain-list">
            {meanings.map((o) => (
              <li key={o.id}>
                <span className="dcard__label">{optionLabel(d, o, lookup)}</span> {stripCodes(o.consequences, lookup)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.acceptance_evidence && (
        <div>
          <Sub className="dcard__sub">Done when</Sub>
          <p className="preline">
            <Prose text={data.acceptance_evidence} />
          </p>
        </div>
      )}
      {deps.length > 0 && (
        <div>
          <Sub className="dcard__sub">Depends on</Sub>
          <ul className="plain-list">
            {deps.map((r) => (
              <li key={r.id}>
                <RecordLink id={r.id}>{displayTitle(r, lookup)}</RecordLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(approvals.length > 0 || data.decided_at || historyLines.length > 0) && (
        <div>
          <Sub className="dcard__sub">History</Sub>
          <ul className="plain-list">
            {approvals.map((a) => (
              <li key={`${a.person_id}-${a.at}`}>
                {civil(dayIn(a.at, zone), 'weekday')}: {dir.nameOf(a.person_id)} chose “{trimEnd(labelOf(a.option_id) ?? 'a choice')}”
                {a.note ? `. Note: ${a.note}` : ''}
              </li>
            ))}
            {data.decided_at && <li>{civil(dayIn(data.decided_at, zone), 'weekday')}: decided.</li>}
            {historyLines.map((l, i) => (
              <li key={i} className="preline">
                {plain(l)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {original.length > 0 && (
        <div>
          <Sub className="dcard__sub">Original wording</Sub>
          <ul className="plain-list">
            {original.map((o, i) => (
              <li key={i}>
                <span className="dcard__label">{o.label}:</span> <Prose text={o.text} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {onAddChoice && (
        <div>
          <Button variant="quiet" small icon="plus" onClick={onAddChoice}>
            Add another choice
          </Button>
        </div>
      )}
    </More>
  );
}

/* ------------------------------------------------------------------ in place after settling */

/**
 * Shown for a few seconds where a card was, the moment it is decided, put off or closed: "Decided: … Undo".
 * Focus moves here (the card that held it is gone), so screen readers hear it.
 */
export function SettledNotice({ d, outcome, onUndone, focusMe = true }: { d: Decision; outcome: SettledOutcome; onUndone?: () => void; focusMe?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { actions, refresh, idx } = useSnapshot();
  const w = useWrite();
  useEffect(() => {
    if (!focusMe) return;
    const t = window.setTimeout(() => ref.current?.focus({ preventScroll: false }), 80);
    return () => window.clearTimeout(t);
  }, [focusMe]);
  const current = (idx?.decisions.find((x) => x.id === d.id) ?? outcome.record) as BaseRecord;
  const undo = () =>
    w.run(async (v) => {
      const rec = await api.reopenDecision(d.id, { baseVersion: v });
      actions.adoptRecord(rec);
      void refresh();
      onUndone?.();
    }, current.version);
  const words = outcome.kind === 'decided' ? 'Decided:' : outcome.kind === 'put-off' ? 'Put off.' : 'Not doing this.';
  return (
    <li className="dcard-item">
      <div ref={ref} id={`decision-${d.key}`} tabIndex={-1} className="dsettled" role="group" aria-label={words.replace(/[:.]$/, '')}>
        <Icon name="check" size={16} />
        <p>
          <strong>{words}</strong>
          {outcome.kind === 'decided' && outcome.label ? ` ${trimEnd(outcome.label)}.` : ''}{' '}
          <Link to={{ pathname: '/decide/decided', hash: `#decision-${d.key}` }}>See it</Link>
        </p>
        <Button variant="quiet" small icon="undo" busy={w.busy} onClick={() => void undo()}>
          Undo
        </Button>
        {w.error && <p className="field__error" role="alert">{w.error}</p>}
        {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
      </div>
    </li>
  );
}

/** Kept for older callers: a short confirmation when a decision has just been agreed by everyone. */
export function DecidedTogether({ d, focusMe }: { d: Decision; focusMe?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusMe) return;
    const t = window.setTimeout(() => ref.current?.focus({ preventScroll: false }), 80);
    return () => window.clearTimeout(t);
  }, [focusMe]);
  return (
    <div ref={ref} tabIndex={-1} className="decided-banner">
      <Icon name="check" size={16} />
      <p>
        <strong>Decided</strong>: {displayQuestion(d) ?? displayTitle(d)}{' '}
        <Link to={{ pathname: '/decide/decided', hash: `#decision-${d.key}` }}>See it</Link>
      </p>
    </div>
  );
}
