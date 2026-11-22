import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DECISION_STATE_LABEL } from '@shared/labels';
import { DateText, DeadlineBadge } from '../../components/Badges';
import { Button } from '../../components/Controls';
import { ConflictBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Card } from '../../components/Layout';
import { OwnerChip, usePlain } from '../../components/People';
import { Prose } from '../../components/Prose';
import { RecordLink } from '../../components/RecordLink';
import { decisionEffect } from '../../lib/decisionEffects';
import { civil, dayIn } from '../../lib/format';
import { recordedDecision, settledPart } from '../../lib/home';
import type { Decision, Directory, Indexes } from '../../lib/records';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';
import { AddAlternativeDialog, AddNoteDialog, ApproveDialog, ReasonDialog } from './decisionDialogs';
import { approvalSummary, requiredApproverIds, YourTurnTag } from './decisionText';

const trimEnd = (t: string) => t.replace(/[.\s]+$/, '');

/** After a decision settles whether a step applies to the pet, offer to carry that answer to the step. */
function ApplyEffect({ d, idx, dir }: { d: Decision; idx: Indexes; dir: Directory }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const { snapshot } = useSnapshot();
  const eff = decisionEffect(d, idx, dir, snapshot?.settings);
  if (!eff) return null;
  const apply = () => w.run((v) => actions.patchRecord(eff.record.id, v, { data: { applies_to: { [eff.personId]: eff.answer } } }), eff.record.version);
  return (
    <div className="applies">
      {eff.applied ? (
        <p>
          <Icon name="check" size={14} /> Applied: <RecordLink id={eff.record.id}>{eff.record.title}</RecordLink> {eff.answer === 'yes' ? `now counts for ${eff.personName}` : `is not needed for ${eff.personName}`}.
        </p>
      ) : (
        <>
          <p>
            This answers whether <RecordLink id={eff.record.id}>{eff.record.title}</RecordLink> applies to {eff.personName}: <strong>{eff.answer === 'yes' ? 'yes' : 'no'}</strong>.
          </p>
          <div>
            <Button variant="secondary" small busy={w.busy} onClick={() => void apply()}>
              Apply to {eff.personName}’s steps
            </Button>
          </div>
        </>
      )}
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
    </div>
  );
}

interface CardProps {
  d: Decision;
  idx: Indexes;
  dir: Directory;
  today: string;
  /** Show the options and the action row from the start (record pages, deep links, the "Later" list). */
  startOpen?: boolean;
  /** Leave out the card's own title when the page already shows it (the record page). */
  hideTitle?: boolean;
  /** Heading level of the card title (the sub-headings follow it). */
  level?: 1 | 2 | 3;
  /** Called when the last required person approves, so the page can keep the card visible for a moment. */
  onDecidedTogether?: (d: Decision) => void;
}

/**
 * One decision. Collapsed it shows the question, who owns it, when it is needed and where approvals stand; Approve is
 * offered only after the options are on screen. Decisions already recorded as decided never ask again.
 */
export function DecisionCard({ d, idx, dir, today, startOpen = false, hideTitle = false, level = 3, onDecidedTogether }: CardProps) {
  const data = d.data ?? ({} as Decision['data']);
  const plain = usePlain();
  const { zone } = usePrefs();
  const summary = approvalSummary(d, dir);
  const recorded = recordedDecision(d);
  const settled = settledPart(d);
  const open = (d.status === 'open' || d.status === 'proposed') && !recorded;
  const [expanded, setExpanded] = useState(startOpen);
  const [approve, setApprove] = useState(false);
  const [reasonMode, setReasonMode] = useState<'reject' | 'defer' | null>(null);
  const [adding, setAdding] = useState(false);
  const [noting, setNoting] = useState(false);
  const options = data.options ?? [];
  const recommended = options.find((o) => o.id === data.recommended_option_id);
  const mine = (data.approvals ?? []).find((a) => a.person_id === dir.me?.id);
  const myOption = mine ? options.find((o) => o.id === mine.option_id) : null;
  const needed = data.needed_by;
  const required = requiredApproverIds(d, dir);
  const iNeedToApprove = !dir.me ? true : required.includes(dir.me.id);
  const onlyNames = required.map((id) => dir.nameOf(id));
  const tone = recorded || d.status === 'approved' ? 'done' : d.status === 'proposed' ? 'proposal' : 'default';
  const chipTone = recorded || d.status === 'approved' ? 'matcha' : d.status === 'proposed' ? 'neutral' : d.status === 'open' ? 'ai' : 'neutral';
  const stateLabel = recorded ? 'Decided' : (DECISION_STATE_LABEL[d.status as keyof typeof DECISION_STATE_LABEL] ?? d.status);
  const regionId = `dec-body-${d.key}`;
  const Title = `h${level}` as 'h1' | 'h2' | 'h3';
  const Sub = `h${Math.min(level + 1, 6)}` as 'h2' | 'h3' | 'h4';
  const showBody = expanded || startOpen;

  return (
    <li>
      <Card as="article" tone={tone} id={`decision-${d.key}`} tabIndex={-1} className="decision" aria-labelledby={hideTitle ? undefined : `dt-${d.key}`} aria-label={hideTitle ? d.title : undefined}>
        <header className="decision__head">
          <span className={`chip chip--${chipTone} chip--sm`}>
            <Icon name={recorded || d.status === 'approved' ? 'check' : d.status === 'proposed' ? 'pencil' : 'decide'} size={13} />
            <span>{stateLabel}</span>
          </span>
          {open && <YourTurnTag decision={d} dir={dir} />}
        </header>
        {!hideTitle && (
          <Title id={`dt-${d.key}`} className="decision__title">
            {d.title}
          </Title>
        )}

        {recorded ? (
          <div className="stack stack--tight">
            <p className="approval approval--agreed">
              <Icon name="check" size={16} /> Decided {recorded.on ? civil(recorded.on, 'short') : 'earlier'} (recorded in the plan)
            </p>
            {recorded.summary && <p className="preline">{plain(recorded.summary)}</p>}
            {recorded.open_part && (
              <p className="small muted preline">
                <strong>Still open, separately:</strong> {plain(recorded.open_part)}
              </p>
            )}
          </div>
        ) : (
          <>
            {settled && (
              <p className="settled">
                <Icon name="check" size={14} /> <strong>Already decided:</strong> {plain(settled)}
              </p>
            )}
            {data.question && data.question !== d.title && (
              <p className="muted preline">
                <Prose text={data.question} />
              </p>
            )}
            <div className="item__meta">
              <OwnerChip owner={d.owner} proposed={d.owner_proposed && open} compact />
              {needed?.date ? (
                <span className="item__when">
                  <span className="faint small">Needed by</span>
                  <DateText date={needed.date} today={today} />
                  <DeadlineBadge kind={needed.kind} />
                </span>
              ) : data.trigger ? (
                <span className="small muted">Needed when: {plain(data.trigger)}</span>
              ) : (
                <span className="small faint">No date yet</span>
              )}
            </div>
            <p className={`approval approval--${summary.state}`}>
              <Icon name={summary.state === 'agreed' ? 'check' : summary.state === 'disagree' ? 'alert' : 'clock'} size={16} /> {summary.text}
            </p>
          </>
        )}

        {!startOpen && (
          <div>
            <Button variant="secondary" small aria-expanded={expanded} aria-controls={regionId} icon={expanded ? 'chevron-down' : 'chevron-right'} onClick={() => setExpanded((v) => !v)}>
              {open && !recorded ? (expanded ? 'Hide options' : 'Review options and decide') : expanded ? 'Hide details' : 'Show details'}
            </Button>
          </div>
        )}

        {!open && <ApplyEffect d={d} idx={idx} dir={dir} />}

        {showBody && (
          <div id={regionId} className="stack decision__body">
            {!recorded && (
              <>
                {options.length > 0 && (
                  <div>
                    <Sub className="decision__sub">Options</Sub>
                    <ul className="options">
                      {options.map((o) => {
                        const chose = (data.approvals ?? []).filter((a) => a.option_id === o.id).map((a) => dir.nameOf(a.person_id));
                        return (
                          <li key={o.id} className="option">
                            <p>
                              <strong>{o.label}</strong>
                              {o.id === data.recommended_option_id && <span className="chip chip--ai chip--sm" style={{ marginLeft: 8 }}>Suggested</span>}
                              {data.decided_option_id === o.id && <span className="chip chip--matcha chip--sm" style={{ marginLeft: 8 }}>Chosen</span>}
                            </p>
                            {o.consequences && <p className="small muted preline">{o.consequences}</p>}
                            {chose.length > 0 && <p className="small faint">Approved by {chose.join(' and ')}</p>}
                          </li>
                        );
                      })}
                    </ul>
                    {open && options.length === 1 && (
                      <p className="small muted">Only one suggestion is recorded and no alternatives have been considered.</p>
                    )}
                  </div>
                )}
                {!options.length && data.recommendation_text && (
                  <p className="decision__rec">
                    <span className="item__label">Suggested</span> <Prose text={data.recommendation_text} />
                  </p>
                )}
                {recommended && data.recommendation_text && options.length > 1 && (
                  <p className="small muted preline">
                    <strong>Original suggestion:</strong> <Prose text={data.recommendation_text} />
                  </p>
                )}
                {data.consequence_of_delay && open && (
                  <p className="small muted preline">
                    <strong>If we wait:</strong> <Prose text={data.consequence_of_delay} />
                  </p>
                )}
                {data.rationale && (
                  <div>
                    <Sub className="decision__sub">Why</Sub>
                    <p className="preline">
                      <Prose text={data.rationale} />
                    </p>
                  </div>
                )}
                {data.acceptance_evidence && (
                  <div>
                    <Sub className="decision__sub">How we’ll know it’s settled</Sub>
                    <p className="preline">
                      <Prose text={data.acceptance_evidence} />
                    </p>
                  </div>
                )}
                {(data.dependencies ?? []).length > 0 && (
                  <div>
                    <Sub className="decision__sub">Depends on</Sub>
                    <ul className="plain-list">
                      {data.dependencies.map((k) => {
                        const r = idx.byKey.get(k);
                        return r ? (
                          <li key={k}>
                            <RecordLink id={r.id}>{r.title}</RecordLink>
                          </li>
                        ) : null;
                      })}
                    </ul>
                  </div>
                )}
              </>
            )}

            <div>
              <Sub className="decision__sub">History</Sub>
              {(data.approvals ?? []).length === 0 && !data.history_note && !data.decided_at ? (
                <p className="muted">Nothing has happened on this yet.</p>
              ) : (
                <ul className="plain-list">
                  {[...(data.approvals ?? [])]
                    .sort((a, b) => (a.at < b.at ? 1 : -1))
                    .map((a) => (
                      <li key={`${a.person_id}-${a.at}`}>
                        {civil(dayIn(a.at, zone), 'short')}: {dir.nameOf(a.person_id)} approved “{trimEnd(options.find((o) => o.id === a.option_id)?.label ?? 'an option')}”
                        {a.note ? ` — ${a.note}` : ''}
                      </li>
                    ))}
                  {data.decided_at && <li>{civil(dayIn(data.decided_at, zone), 'short')}: decided.</li>}
                  {data.history_note && <li className="preline">{plain(data.history_note)}</li>}
                </ul>
              )}
            </div>

            {open && showBody && (
              <div className="decision__actions">
                {iNeedToApprove ? (
                  <>
                    <div className="row-actions" style={{ marginTop: 0 }}>
                      {mine ? (
                        <Button variant="quiet" onClick={() => setApprove(true)}>
                          Change my approval
                        </Button>
                      ) : (
                        <Button variant="primary" onClick={() => setApprove(true)}>
                          Approve as {dir.me?.display_name ?? 'me'}
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => setReasonMode('defer')}>
                        Put off…
                      </Button>
                      <Button variant="quiet" onClick={() => setReasonMode('reject')}>
                        Reject…
                      </Button>
                    </div>
                    {mine && myOption && <p className="small faint">You approved “{trimEnd(myOption.label)}.”</p>}
                    {options.length === 1 && (
                      <div>
                        <Button variant="secondary" small icon="plus" onClick={() => setAdding(true)}>
                          Add an alternative
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="muted">
                      Only {onlyNames.length === 1 ? onlyNames[0] : onlyNames.join(' and ')} {onlyNames.length === 1 ? 'needs' : 'need'} to approve this.
                    </p>
                    <div>
                      <Button variant="secondary" small onClick={() => setNoting(true)}>
                        Add a note
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        )}
      </Card>
      <ApproveDialog
        decision={d}
        open={approve}
        onClose={() => setApprove(false)}
        dir={dir}
        onDone={(rec) => {
          if (rec.status === 'approved') onDecidedTogether?.(d);
        }}
      />
      <ReasonDialog decision={d} mode={reasonMode} onClose={() => setReasonMode(null)} />
      {adding && <AddAlternativeDialog decision={d} onClose={() => setAdding(false)} />}
      {noting && <AddNoteDialog record={d} onClose={() => setNoting(false)} />}
    </li>
  );
}

/** Shown for a few seconds in place of a card the moment the last required approval lands. */
export function DecidedTogether({ d, focusMe }: { d: Decision; focusMe?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusMe) return;
    // The card that held focus is gone; keep keyboard and screen-reader users on the confirmation.
    const t = window.setTimeout(() => ref.current?.focus({ preventScroll: false }), 80);
    return () => window.clearTimeout(t);
  }, [focusMe]);
  return (
    <div ref={ref} tabIndex={-1} className="decided-banner">
      <Icon name="check" size={16} />
      <p>
        <strong>Decided together ✓</strong> — “{d.title}” moved to Decided.{' '}
        <Link to={{ pathname: '/decide/decided', hash: `#decision-${d.key}` }}>See it</Link>
      </p>
    </div>
  );
}
