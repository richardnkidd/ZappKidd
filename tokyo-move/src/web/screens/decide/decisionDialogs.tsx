import { useEffect, useRef, useState, type RefObject } from 'react';
import { isCivilDate } from '@shared/dates';
import { displayQuestion, displayTitle, optionLabel } from '@shared/plain';
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
/** The question a dialog is about: the plain question, else the cleaned title. */
const about = (d: Decision) => displayQuestion(d) ?? displayTitle(d);

/* ------------------------------------------------------------------ add an alternative */

/** Imported suggestions often have no alternatives. Adding one turns a rubber stamp into a real choice. */
export function AddAlternativeDialog({ decision, onClose, fallbackFocus }: { decision: Decision; onClose: () => void; fallbackFocus?: RefObject<HTMLElement | null> | string }) {
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
      title="Add another choice"
      description={about(decision)}
      fallbackFocus={fallbackFocus}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Add choice
          </Button>
        </>
      }
    >
      <Field label="The choice" error={tried && missing ? 'Please write the choice.' : null}>
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="What it would mean (optional)">
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
        title="Pick an answer"
        description={about(decision)}
        footer={
          <>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={w.busy} onClick={submit} disabled={options.length === 0}>
              Agree
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
          <p className="muted">No choices are written down yet.</p>
        ) : single ? (
          <div className="stack">
            <p className="preline">
              <strong>{optionLabel(decision, options[0]!)}</strong>
              {options[0]!.consequences ? `\n${options[0]!.consequences}` : ''}
            </p>
            <div>
              <Button variant="quiet" small icon="plus" onClick={() => setAdding(true)}>
                Add another choice
              </Button>
            </div>
          </div>
        ) : (
          <fieldset>
            <legend>Which answer do you agree with?</legend>
            <div className="stack stack--tight">
              {options.map((o) => (
                <label key={o.id} className="choice">
                  <input type="radio" name="option" checked={optionId === o.id} onChange={() => setOptionId(o.id)} />
                  <span className="choice__text">
                    <span>
                      {o.id === decision.data?.recommended_option_id && <span className="dopt__tag">Suggested </span>}
                      {optionLabel(decision, o)}
                    </span>
                    {o.consequences && <span className="choice__hint preline">{o.consequences}</span>}
                  </span>
                </label>
              ))}
            </div>
            {tried && !optionId && <p className="field__error" role="alert">Please pick an answer.</p>}
          </fieldset>
        )}
        <Field label="A note (optional)">
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
  fallbackFocus,
}: {
  decision: Decision;
  mode: 'reject' | 'defer' | null;
  onClose: () => void;
  onDone?: (rec: BaseRecord, mode: 'reject' | 'defer') => void;
  /** Where focus goes if the card that opened the dialog has left the page. */
  fallbackFocus?: RefObject<HTMLElement | null> | string;
}) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
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
    if (!reason.trim()) {
      reasonRef.current?.focus();
      return;
    }
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
      title={mode === 'reject' ? 'None of these work' : 'Not now'}
      description={about(decision)}
      fallbackFocus={fallbackFocus}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={mode === 'reject' ? 'danger' : 'primary'} busy={w.busy} onClick={submit}>
            {mode === 'reject' ? 'Close this decision' : 'Put off'}
          </Button>
        </>
      }
    >
      <Field
        label={
          <>
            {mode === 'reject' ? 'Why do none of these work?' : 'Why not now?'} <span className="field__req">(required)</span>
          </>
        }
        error={tried && !reason.trim() ? 'Please add a reason.' : null}
      >
        <TextArea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-required="true" />
      </Field>
      {mode === 'defer' && (
        <Field label="Look again on (optional)">
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
      description={`On “${displayTitle(record)}”. The household can read it.`}
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
