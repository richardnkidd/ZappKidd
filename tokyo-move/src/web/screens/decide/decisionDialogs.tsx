import { useEffect, useState } from 'react';
import { isCivilDate } from '@shared/dates';
import type { BaseRecord, DecisionOption } from '@shared/types';
import { Button, Field, TextArea, TextInput } from '../../components/Controls';
import { Dialog } from '../../components/Dialog';
import { ConflictBanner } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { settledPart } from '../../lib/home';
import type { AnyRecord, Decision, Directory } from '../../lib/records';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

const trimEnd = (t: string) => t.replace(/[.\s]+$/, '');

/* ------------------------------------------------------------------ add an alternative */

/** Imported suggestions often have no alternatives. Adding one turns a rubber stamp into a real choice. */
export function AddAlternativeDialog({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const [label, setLabel] = useState('');
  const [consequences, setConsequences] = useState('');
  const [tried, setTried] = useState(false);
  const [startVersion] = useState(decision.version);
  const missing = label.trim() === '';
  const submit = async () => {
    setTried(true);
    if (missing) return;
    const id = `alt-${Math.random().toString(36).slice(2, 8)}`;
    const next: DecisionOption[] = [
      ...(decision.data?.options ?? []),
      { id, label: label.trim().replace(/\s+/g, ' '), consequences: consequences.trim() || null, source: 'household' },
    ];
    const ok = await w.run((v) => actions.patchRecord(decision.id, v, { data: { options: next } }), startVersion);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add an alternative"
      description={`Another way to answer “${decision.title}”. It sits beside the existing suggestion; nothing is approved by adding it.`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Add alternative
          </Button>
        </>
      }
    >
      <Field label="What is the alternative?" error={tried && missing ? 'Please say what it is.' : null}>
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="What would it mean? (optional)">
        <TextArea value={consequences} onChange={(e) => setConsequences(e.target.value)} rows={2} />
      </Field>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ approve */

export function ApproveDialog({
  decision,
  open,
  onClose,
  dir,
  onDone,
}: {
  decision: Decision;
  open: boolean;
  onClose: () => void;
  dir: Directory;
  onDone?: (rec: BaseRecord, optionLabel: string | null) => void;
}) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const options = decision.data?.options ?? [];
  const single = options.length === 1;
  const mine = (decision.data?.approvals ?? []).find((a) => a.person_id === dir.me?.id);
  const [optionId, setOptionId] = useState<string>('');
  const [note, setNote] = useState('');
  const [startVersion, setStartVersion] = useState(decision.version);
  const [tried, setTried] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setOptionId(single ? options[0]!.id : (mine?.option_id ?? decision.data?.recommended_option_id ?? ''));
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
    <>
      <Dialog
        open={open && !adding}
        onClose={onClose}
        title={`Approve as ${dir.me?.display_name ?? 'you'}`}
        description={`“${decision.title}” becomes a household decision once everyone who needs to agree has chosen the same option.`}
        footer={
          <>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={w.busy} onClick={submit} disabled={options.length === 0}>
              {single ? 'Approve it as it is' : 'Approve'}
            </Button>
          </>
        }
      >
        {settledPart(decision) && (
          <p className="settled">
            <Icon name="check" size={14} /> <strong>Already decided:</strong> {settledPart(decision)}
          </p>
        )}
        {options.length === 0 ? (
          <p className="muted">No options have been written down for this decision yet, so there is nothing to approve.</p>
        ) : single ? (
          <div className="stack">
            <p className="preline">
              <strong>{options[0]!.label}</strong>
              {options[0]!.consequences ? `\n${options[0]!.consequences}` : ''}
            </p>
            <p className="muted">Only one suggestion is recorded and no alternatives have been considered. Approve it as it is, or put it off to add alternatives.</p>
            <div>
              <Button variant="secondary" small icon="plus" onClick={() => setAdding(true)}>
                Add an alternative
              </Button>
            </div>
          </div>
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
      {adding && <AddAlternativeDialog decision={decision} onClose={() => setAdding(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ defer / reject */

export function ReasonDialog({
  decision,
  mode,
  onClose,
  onDone,
}: {
  decision: Decision;
  mode: 'reject' | 'defer' | null;
  onClose: () => void;
  onDone?: (rec: BaseRecord, mode: 'reject' | 'defer') => void;
}) {
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

/* ------------------------------------------------------------------ a note on a decision */

/** For someone who does not need to approve but wants to leave a thought for the people who do. */
export function AddNoteDialog({ record, onClose }: { record: AnyRecord; onClose: () => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const [body, setBody] = useState('');
  const [tried, setTried] = useState(false);
  const submit = async () => {
    setTried(true);
    const text = body.trim();
    if (!text) return;
    const ok = await w.run(
      () => actions.createRecord({ type: 'note', title: trimEnd(text.replace(/\s+/g, ' ')).slice(0, 60) || 'Note', data: { body: text, linked_record_id: record.id }, visibility: 'household' }),
      0,
    );
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a note"
      description={`On “${record.title}”. The household can read it.`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Add note
          </Button>
        </>
      }
    >
      <Field label="Your note" error={tried && !body.trim() ? 'Please write a note first.' : null}>
        <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={4} data-autofocus />
      </Field>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
    </Dialog>
  );
}
