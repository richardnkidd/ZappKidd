import { useEffect, useMemo, useState } from 'react';
import { DECISION_STATE_LABEL } from '@shared/labels';
import { DateText, DeadlineBadge } from '../../components/Badges';
import { isCivilDate } from '@shared/dates';
import { Button, Field, TextArea, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { Dialog } from '../../components/Dialog';
import { Disclosure } from '../../components/Disclosure';
import { ConflictBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, Section } from '../../components/Layout';
import { OwnerChip } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { civil, plural } from '../../lib/format';
import { compareDates } from '../../lib/format';
import type { BaseRecord } from '@shared/types';
import { selectDecisions } from '../../lib/home';
import { firstReviewDecisionKeys, type Decision, type Directory, type Indexes } from '../../lib/records';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';
import { approvalSummary, YourTurnTag } from './decisionText';

/* ------------------------------------------------------------------ approve */

export function ApproveDialog({ decision, open, onClose, dir, onDone }: { decision: Decision; open: boolean; onClose: () => void; dir: Directory; onDone?: (rec: BaseRecord, optionLabel: string | null) => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const options = decision.data?.options ?? [];
  const mine = (decision.data?.approvals ?? []).find((a) => a.person_id === dir.me?.id);
  const [optionId, setOptionId] = useState<string>('');
  const [note, setNote] = useState('');
  const [startVersion, setStartVersion] = useState(decision.version);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (open) {
      setOptionId(mine?.option_id ?? decision.data?.recommended_option_id ?? '');
      setNote('');
      setStartVersion(decision.version);
      setTried(false);
      w.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    setTried(true);
    if (!optionId) return;
    let out: BaseRecord | null = null;
    const ok = await w.run(async (v) => {
      out = await actions.approveDecision(decision.id, v, optionId, note.trim() || null);
    }, startVersion);
    if (ok) {
      if (out) onDone?.(out, options.find((o) => o.id === optionId)?.label ?? null);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Approve as ${dir.me?.display_name ?? 'you'}`}
      description={`“${decision.title}” becomes a household decision once everyone who needs to agree has chosen the same option.`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit} disabled={options.length === 0}>
            Approve
          </Button>
        </>
      }
    >
      {options.length === 0 ? (
        <p className="muted">No options have been written down for this decision yet, so there is nothing to approve.</p>
      ) : (
        <fieldset>
          <legend>Which option do you approve?</legend>
          <div className="stack stack--tight">
            {options.map((o) => (
              <label key={o.id} className="choice">
                <input type="radio" name="option" checked={optionId === o.id} onChange={() => setOptionId(o.id)} />
                <span className="choice__text">
                  <span>
                    {o.label}
                    {o.id === decision.data?.recommended_option_id && <span className="chip chip--ai chip--sm" style={{ marginLeft: 8 }}>Recommended</span>}
                  </span>
                  {o.consequences && <span className="choice__hint preline">{o.consequences}</span>}
                </span>
              </label>
            ))}
          </div>
          {tried && !optionId && <p className="field__error" role="alert">Please choose an option.</p>}
        </fieldset>
      )}
      <Field label="A note (optional)" hint="Anything you want the other person to know about your choice.">
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ defer / reject */

export function ReasonDialog({ decision, mode, onClose, onDone }: { decision: Decision; mode: 'reject' | 'defer' | null; onClose: () => void; onDone?: (rec: BaseRecord, mode: 'reject' | 'defer') => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const [reason, setReason] = useState('');
  const [revisit, setRevisit] = useState('');
  const [startVersion, setStartVersion] = useState(decision.version);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (mode) {
      setReason('');
      setRevisit('');
      setStartVersion(decision.version);
      setTried(false);
      w.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const submit = async () => {
    setTried(true);
    if (!reason.trim()) return;
    let out: BaseRecord | null = null;
    const ok = await w.run(async (v) => {
      out = mode === 'reject' ? await actions.rejectDecision(decision.id, v, reason.trim()) : await actions.deferDecision(decision.id, v, reason.trim(), isCivilDate(revisit) ? revisit : null);
    }, startVersion);
    if (ok) {
      if (out && mode) onDone?.(out, mode);
      onClose();
    }
  };

  return (
    <Dialog
      open={mode !== null}
      onClose={onClose}
      title={mode === 'reject' ? 'Reject this decision' : 'Put this off for now'}
      description={`“${decision.title}”`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={mode === 'reject' ? 'danger' : 'primary'} busy={w.busy} onClick={submit}>
            {mode === 'reject' ? 'Reject' : 'Put off'}
          </Button>
        </>
      }
    >
      <Field
        label={mode === 'reject' ? 'Why are we rejecting it?' : 'Why are we putting it off, and until when?'}
        hint="Required, so it still makes sense later."
        error={tried && !reason.trim() ? 'Please add a reason.' : null}
      >
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
      {mode === 'defer' && (
        <Field label="Look at it again on (optional)" hint="A date to come back to this.">
          <TextInput type="date" value={revisit} onChange={(e) => setRevisit(e.target.value)} />
        </Field>
      )}
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ card */

export function DecisionCard({ d, idx, dir, today }: { d: Decision; idx: Indexes; dir: Directory; today: string }) {
  const data = d.data ?? ({} as Decision['data']);
  const summary = approvalSummary(d, dir);
  const open = d.status === 'open' || d.status === 'proposed';
  const [approve, setApprove] = useState(false);
  const [reasonMode, setReasonMode] = useState<'reject' | 'defer' | null>(null);
  const options = data.options ?? [];
  const recommended = options.find((o) => o.id === data.recommended_option_id);
  const mine = (data.approvals ?? []).find((a) => a.person_id === dir.me?.id);
  const myOption = mine ? options.find((o) => o.id === mine.option_id) : null;
  const needed = data.needed_by;
  const tone = d.status === 'proposed' ? 'proposal' : d.status === 'approved' ? 'done' : 'default';
  const chipTone = d.status === 'approved' ? 'matcha' : d.status === 'proposed' ? 'neutral' : d.status === 'open' ? 'ai' : 'neutral';

  return (
    <li>
      <Card as="article" tone={tone} id={`decision-${d.key}`} tabIndex={-1} className="decision" aria-labelledby={`dt-${d.key}`}>
        <header className="decision__head">
          <span className={`chip chip--${chipTone} chip--sm`}>
            <Icon name={d.status === 'approved' ? 'check' : d.status === 'proposed' ? 'pencil' : 'decide'} size={13} />
            <span>{DECISION_STATE_LABEL[d.status as keyof typeof DECISION_STATE_LABEL] ?? d.status}</span>
          </span>
          <YourTurnTag decision={d} dir={dir} />
        </header>
        <h3 id={`dt-${d.key}`} className="decision__title">
          {d.title}
        </h3>
        {data.question && data.question !== d.title && <p className="muted preline">{data.question}</p>}

        <div className="item__meta">
          <OwnerChip owner={d.owner} proposed={d.owner_proposed} compact />
          {needed?.date ? (
            <span className="item__when">
              <span className="faint small">Needed by</span>
              <DateText date={needed.date} today={today} />
              <DeadlineBadge kind={needed.kind} />
            </span>
          ) : data.trigger ? (
            <span className="small muted">Needed when: {data.trigger}</span>
          ) : (
            <span className="small faint">No date yet</span>
          )}
        </div>

        {(recommended || data.recommendation_text) && (
          <p className="decision__rec">
            <span className="item__label">Suggested</span> {recommended ? recommended.label : data.recommendation_text}
          </p>
        )}

        <p className={`approval approval--${summary.state}`}>
          <Icon name={summary.state === 'agreed' ? 'check' : summary.state === 'disagree' ? 'alert' : 'clock'} size={16} /> {summary.text}
        </p>

        {data.consequence_of_delay && open && (
          <p className="small muted preline">
            <strong>If we wait:</strong> {data.consequence_of_delay}
          </p>
        )}

        {open && (
          <div className="row-actions">
            <Button variant="primary" onClick={() => setApprove(true)}>
              {mine ? 'Change my approval' : `Approve as ${dir.me?.display_name ?? 'me'}`}
            </Button>
            <Button variant="secondary" onClick={() => setReasonMode('defer')}>
              Put off…
            </Button>
            <Button variant="quiet" onClick={() => setReasonMode('reject')}>
              Reject…
            </Button>
          </div>
        )}
        {mine && myOption && open && <p className="small faint">You approved “{myOption.label}”.</p>}

        <Disclosure title="Options, reasoning and history" level={4} className="disclosure--flat">
          <div className="stack">
            {options.length > 0 && (
              <div>
                <h4>Options</h4>
                <ul className="options">
                  {options.map((o) => {
                    const chose = (data.approvals ?? []).filter((a) => a.option_id === o.id).map((a) => dir.nameOf(a.person_id));
                    return (
                      <li key={o.id} className="option">
                        <p>
                          <strong>{o.label}</strong>
                          {o.id === data.recommended_option_id && <span className="chip chip--ai chip--sm" style={{ marginLeft: 8 }}>Recommended</span>}
                          {data.decided_option_id === o.id && <span className="chip chip--matcha chip--sm" style={{ marginLeft: 8 }}>Chosen</span>}
                        </p>
                        {o.consequences && <p className="small muted preline">{o.consequences}</p>}
                        {chose.length > 0 && <p className="small faint">Approved by {chose.join(' and ')}</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {data.rationale && (
              <div>
                <h4>Why</h4>
                <p className="preline">{data.rationale}</p>
              </div>
            )}
            {data.recommendation_text && recommended && (
              <div>
                <h4>Original suggestion</h4>
                <p className="preline muted">{data.recommendation_text}</p>
              </div>
            )}
            {data.acceptance_evidence && (
              <div>
                <h4>How we’ll know it’s settled</h4>
                <p className="preline">{data.acceptance_evidence}</p>
              </div>
            )}
            {(data.dependencies ?? []).length > 0 && (
              <div>
                <h4>Depends on</h4>
                <ul className="plain-list">
                  {data.dependencies.map((k) => {
                    const r = idx.byKey.get(k);
                    return <li key={k}>{r ? <RecordLink id={r.id}>{r.title}</RecordLink> : k}</li>;
                  })}
                </ul>
              </div>
            )}
            <div>
              <h4>History</h4>
              {(data.approvals ?? []).length === 0 && !data.history_note && !data.decided_at ? (
                <p className="muted">Nothing has happened on this yet.</p>
              ) : (
                <ul className="plain-list">
                  {[...(data.approvals ?? [])]
                    .sort((a, b) => (a.at < b.at ? 1 : -1))
                    .map((a) => (
                      <li key={`${a.person_id}-${a.at}`}>
                        {civil(a.at.slice(0, 10), 'short')}: {dir.nameOf(a.person_id)} approved “{options.find((o) => o.id === a.option_id)?.label ?? 'an option'}”
                        {a.note ? ` — ${a.note}` : ''}
                      </li>
                    ))}
                  {data.decided_at && <li>{civil(data.decided_at.slice(0, 10), 'short')}: decided.</li>}
                  {data.history_note && <li className="preline">{data.history_note}</li>}
                </ul>
              )}
            </div>
          </div>
        </Disclosure>
      </Card>
      <ApproveDialog decision={d} open={approve} onClose={() => setApprove(false)} dir={dir} />
      <ReasonDialog decision={d} mode={reasonMode} onClose={() => setReasonMode(null)} />
    </li>
  );
}

/* ------------------------------------------------------------------ tab */

export function DecisionsTab() {
  const { today } = useData();
  return (
    <DataGate>
      {({ idx, dir }) => <DecisionsList idx={idx} dir={dir} today={today} />}
    </DataGate>
  );
}

function DecisionsList({ idx, dir, today }: { idx: Indexes; dir: Directory; today: string }) {
  const { snapshot } = useSnapshot();
  const firstKeys = useMemo(() => firstReviewDecisionKeys(snapshot?.settings), [snapshot]);
  const { openOnes, closed } = useMemo(() => {
    const byDate = (a: Decision, b: Decision) => {
      const c = compareDates(a.data?.needed_by?.date, b.data?.needed_by?.date);
      return c !== 0 ? c : a.key.localeCompare(b.key, undefined, { numeric: true });
    };
    // Same order as Home. A card never jumps away just because you approved it (approval does not change the order).
    const openOnes = selectDecisions(idx, 'all', { meId: null, otherIds: [] }, { today, firstReviewKeys: firstKeys });
    const closed = idx.decisions
      .filter((d) => d.status !== 'open' && d.status !== 'proposed')
      .sort((a, b) => ((b.data?.decided_at ?? b.updated_at) > (a.data?.decided_at ?? a.updated_at) ? 1 : -1));
    return { openOnes, closed };
  }, [idx, today, firstKeys]);

  return (
    <div className="stack stack--loose">
      <Section
        title="Waiting for a decision"
        count={openOnes.length || undefined}
        intro="Proposals have a dashed outline until everyone who needs to agree has approved."
      >
        {openOnes.length === 0 ? (
          <Card>
            <EmptyState icon="check" title="No decisions are waiting.">
              When a new choice comes up, it will show here with what’s needed and by when.
            </EmptyState>
          </Card>
        ) : (
          <ul className="stack">
            {openOnes.map((d) => (
              <DecisionCard key={d.id} d={d} idx={idx} dir={dir} today={today} />
            ))}
          </ul>
        )}
      </Section>

      {closed.length > 0 && (
        <Section title="Decided or set aside" count={closed.length}>
          <ul className="stack">
            {closed.map((d) => (
              <DecisionCard key={d.id} d={d} idx={idx} dir={dir} today={today} />
            ))}
          </ul>
          <p className="small faint">{plural(closed.length, 'decision')} in the household’s record.</p>
        </Section>
      )}
    </div>
  );
}
