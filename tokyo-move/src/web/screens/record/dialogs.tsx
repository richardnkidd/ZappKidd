import { useEffect, useMemo, useRef, useState } from 'react';
import { addCalendarDays, isCivilDate } from '@shared/dates';
import { defaultNewTaskDue } from '@shared/deadlines';
import { WORK_STATUS_ORDER } from '@shared/labels';
import type { OwnerRef, WorkStatus } from '@shared/types';
import type { AnyRecord } from '../../lib/records';
import { Button, Field, TextArea, TextInput, Select } from '../../components/Controls';
import { Dialog } from '../../components/Dialog';
import { ConflictBanner } from '../../components/Feedback';
import { StatusBadge } from '../../components/Badges';
import { useDir } from '../../components/People';
import { civil, safeHref } from '../../lib/format';
import { attempt } from '../../lib/safe';
import { useData } from '../../state/data';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

const NEEDS_REASON: WorkStatus[] = ['blocked', 'eliminated', 'not_applicable'];

const STATUS_HELP: Record<WorkStatus, string> = {
  planned: 'Not started yet.',
  in_progress: 'Someone is working on it.',
  blocked: 'Stuck. You will say what it is waiting on.',
  waiting_external: 'The next move is someone else’s.',
  completed: 'Finished. You will say what shows it is done.',
  eliminated: 'We chose not to do this. You will say why.',
  not_applicable: 'It does not apply to us. You will say why.',
};

const REASON_LABEL: Partial<Record<WorkStatus, string>> = {
  blocked: 'What is it waiting on?',
  eliminated: 'Why are we dropping this?',
  not_applicable: 'Why isn’t this needed?',
  waiting_external: 'Who or what are we waiting on?',
};

interface StatusDialogProps {
  open: boolean;
  onClose: () => void;
  record: AnyRecord;
  /** Change only this traveler's progress on a shared record. */
  traveler?: string | null;
  currentStatus: string;
}

export function StatusDialog({ open, onClose, record, traveler = null, currentStatus }: StatusDialogProps) {
  const { actions } = useSnapshot();
  const dir = useDir();
  const w = useWrite();
  const [status, setStatus] = useState<WorkStatus>(currentStatus as WorkStatus);
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [link, setLink] = useState('');
  const [startVersion, setStartVersion] = useState(record.version);
  const [tried, setTried] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  // Choosing an option that needs a follow-up moves focus straight into it, so it is never below the fold of the sheet.
  const chosenByUser = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (!chosenByUser.current) return;
    const target = status === 'completed' ? summaryRef.current : NEEDS_REASON.includes(status) || status === 'waiting_external' ? reasonRef.current : null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [status, open]);

  useEffect(() => {
    if (open) {
      chosenByUser.current = false;
      setStatus(currentStatus as WorkStatus);
      setReason('');
      setSummary('');
      setLink('');
      setTried(false);
      setStartVersion(record.version);
      w.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const needsReason = NEEDS_REASON.includes(status);
  const needsEvidence = status === 'completed';
  const reasonMissing = needsReason && reason.trim().length === 0;
  const evidenceMissing = needsEvidence && summary.trim().length === 0;
  const linkBad = link.trim().length > 0 && !safeHref(link);
  const unchanged = status === currentStatus && !traveler;

  const submit = async () => {
    setTried(true);
    // Never fail silently: put the cursor in the first field that needs attention.
    const firstInvalid = reasonMissing ? reasonRef.current : evidenceMissing ? summaryRef.current : linkBad ? linkRef.current : null;
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ block: 'nearest' });
      return;
    }
    const ok = await w.run(
      (baseVersion) =>
        actions.setStatus(record.id, {
          baseVersion,
          status,
          reason: reason.trim() || null,
          evidence: needsEvidence ? { summary: summary.trim(), link: safeHref(link) } : null,
          traveler,
        }),
      startVersion,
    );
    if (ok) onClose();
  };

  const who = traveler ? dir.nameOf(traveler) : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={who ? `Update ${who}’s progress` : 'Change status'}
      description={who ? `This only changes ${who}’s part of “${record.title}”.` : `“${record.title}”`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit} disabled={unchanged && !reason}>
            Save status
          </Button>
        </>
      }
    >
      <fieldset>
        <legend>New status</legend>
        <div className="stack stack--tight">
          {WORK_STATUS_ORDER.map((s) => (
            <div key={s} className="choice-wrap">
              <label className="choice">
                <input
                  type="radio"
                  name="status"
                  value={s}
                  checked={status === s}
                  onChange={() => {
                    chosenByUser.current = true;
                    setStatus(s);
                  }}
                />
                <span className="choice__text">
                  <span>
                    <StatusBadge status={s} small /> {s === currentStatus && <span className="faint small">(current)</span>}
                  </span>
                  <span className="choice__hint">{STATUS_HELP[s]}</span>
                </span>
              </label>
              {status === s && (needsReason || s === 'waiting_external') && (
                <div className="choice-wrap__follow">
                  <Field
                    label={REASON_LABEL[s] ?? 'Reason'}
                    hint={needsReason ? 'Required. A sentence in plain words is enough.' : 'Optional, but it helps the other person.'}
                    error={tried && reasonMissing ? 'Please say why, so it makes sense later.' : null}
                  >
                    <TextArea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                  </Field>
                </div>
              )}
              {status === s && needsEvidence && (
                <div className="choice-wrap__follow stack">
                  <Field
                    label="What shows this is done?"
                    hint="Plain text, for example “Confirmation received by email on the 3rd”."
                    error={tried && evidenceMissing ? 'Please add a line about what shows it is done.' : null}
                  >
                    <TextArea ref={summaryRef} value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
                  </Field>
                  <Field
                    label="Link to the proof (optional)"
                    hint="Link to where the original is kept, such as a restricted folder. Kadode never stores the document itself."
                    error={tried && linkBad ? 'That doesn’t look like a web address (it should start with https://).' : null}
                  >
                    <TextInput ref={linkRef} value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="https://" />
                  </Field>
                </div>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner
          conflict={w.conflict}
          busy={w.busy}
          onKeepTheirs={() => {
            w.keepTheirs();
            onClose();
          }}
          onUseMine={async () => {
            if (await w.useMine()) onClose();
          }}
        />
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ propose an action */

type DueChoice = 'default' | 'explicit' | 'blank';

interface ProposeProps {
  open: boolean;
  onClose: () => void;
  record: AnyRecord;
  defaultTitle?: string;
}

export function ProposeActionDialog({ open, onClose, record, defaultTitle = '' }: ProposeProps) {
  const { actions } = useSnapshot();
  const dir = useDir();
  const { today } = useData();
  const w = useWrite();
  const defaultDue = useMemo(() => {
    const a = attempt(() => defaultNewTaskDue(today));
    return a.ok ? a.value : addCalendarDays(today, 14);
  }, [today]);

  const [title, setTitle] = useState(defaultTitle);
  const [owner, setOwner] = useState<string>(record.owner && record.owner !== 'unassigned' ? record.owner : dir.me?.id ?? 'unassigned');
  const [dueChoice, setDueChoice] = useState<DueChoice>('default');
  const [dueDate, setDueDate] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setOwner(record.owner && record.owner !== 'unassigned' ? record.owner : dir.me?.id ?? 'unassigned');
      setDueChoice('default');
      setDueDate('');
      setTried(false);
      w.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ownerName = owner === 'together' || owner === 'unassigned' ? 'The owner' : dir.nameOf(owner);
  const titleMissing = title.trim().length === 0;
  const dateBad = dueChoice === 'explicit' && !isCivilDate(dueDate);

  const submit = async () => {
    setTried(true);
    if (titleMissing || dateBad) return;
    const ok = await w.run(
      () =>
        actions.proposeTask({
          title: title.trim(),
          record_id: record.id,
          owner: owner as OwnerRef,
          due: dueChoice === 'default' ? defaultDue : dueChoice === 'explicit' ? dueDate : null,
          due_mode: dueChoice,
        }),
      0,
    );
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Propose an action for your task list"
      description={`Kadode won’t add this for you. ${ownerName} will see it on Home until it is added to the task list.`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Propose action
          </Button>
        </>
      }
    >
      <Field label="What needs doing?" error={tried && titleMissing ? 'Please say what needs doing.' : null}>
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Who owns it?">
        <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
          {dir.adults.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
            </option>
          ))}
          <option value="together">Together</option>
          <option value="unassigned">Not decided yet</option>
        </Select>
      </Field>
      <fieldset>
        <legend>Due</legend>
        <div className="stack stack--tight">
          <label className="choice">
            <input type="radio" name="due" checked={dueChoice === 'default'} onChange={() => setDueChoice('default')} />
            <span className="choice__text">
              <span>In about 14 days — {civil(defaultDue, 'weekday')}</span>
              <span className="choice__hint">A gentle default so it doesn’t get lost.</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="due" checked={dueChoice === 'explicit'} onChange={() => setDueChoice('explicit')} />
            <span className="choice__text">
              <span>Pick a date</span>
            </span>
          </label>
          {dueChoice === 'explicit' && (
            <Field label="Due date" error={tried && dateBad ? 'Please pick a date.' : null}>
              <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={today} />
            </Field>
          )}
          <label className="choice">
            <input type="radio" name="due" checked={dueChoice === 'blank'} onChange={() => setDueChoice('blank')} />
            <span className="choice__text">
              <span>Leave blank</span>
              <span className="choice__hint">No due date.</span>
            </span>
          </label>
        </div>
      </fieldset>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
    </Dialog>
  );
}

