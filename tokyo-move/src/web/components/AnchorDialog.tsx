import { useMemo, useState } from 'react';
import { isCivilDate } from '@shared/dates';
import { previewAnchorChange } from '@shared/deadlines';
import type { AnchorData } from '@shared/types';
import { ANCHOR_CONFIDENCE_LABEL } from '@shared/labels';
import { civil } from '../lib/format';
import { attempt } from '../lib/safe';
import { dataOf, type AnyRecord } from '../lib/records';
import { useData } from '../state/data';
import { useSnapshot } from '../state/snapshot';
import { useWrite } from '../state/useWrite';
import { Button, Field, Select, TextArea, TextInput } from './Controls';
import { Dialog } from './Dialog';
import { ConflictBanner } from './Feedback';
import { Icon } from './Icon';
import { useDir } from './People';

/**
 * Set or clear one travel date. The effect on every other date is previewed first (computed here with the shared
 * engine, nothing is saved) and the change is applied only when the person confirms.
 */
export function AnchorDialog({ record, onClose }: { record: AnyRecord; onClose: () => void }) {
  const { actions } = useSnapshot();
  const { deadlineContext } = useData();
  const dir = useDir();
  const w = useWrite();
  const a = dataOf<AnchorData>(record);
  const [date, setDate] = useState(a.date ?? '');
  const [confidence, setConfidence] = useState<Exclude<AnchorData['confidence'], 'awaiting'>>(a.confidence && a.confidence !== 'awaiting' ? a.confidence : 'tentative');
  const [evidence, setEvidence] = useState(a.evidence ?? '');
  const [startVersion] = useState(record.version);
  const [tried, setTried] = useState(false);

  const valid = date === '' || isCivilDate(date);
  const preview = useMemo(
    () => (valid && date !== (a.date ?? '') ? attempt(() => previewAnchorChange(deadlineContext, a.code ?? record.key, date === '' ? null : date)) : null),
    [valid, date, a.date, a.code, record.key, deadlineContext],
  );

  const submit = async () => {
    setTried(true);
    if (!valid) return;
    const ok = await w.run(
      (v) =>
        actions.setAnchor(a.code ?? record.key, v, {
          date: date === '' ? null : date,
          confidence: date === '' ? 'awaiting' : confidence,
          evidence: evidence.trim() || null,
        }),
      startVersion,
    );
    if (ok) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={a.meaning || record.title}
      description="Check what moves before you save. Each traveler’s dates are separate: changing one person’s date never moves another’s."
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Save date
          </Button>
        </>
      }
    >
      <Field label="Date" hint="Leave empty if it is not known yet." error={tried && !valid ? 'Please pick a real date.' : null}>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {date !== '' && (
        <Field label="How sure is it?">
          <Select value={confidence} onChange={(e) => setConfidence(e.target.value as Exclude<AnchorData['confidence'], 'awaiting'>)}>
            {(['tentative', 'planned', 'booked', 'actual'] as const).map((c) => (
              <option key={c} value={c}>
                {ANCHOR_CONFIDENCE_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Where does this date come from? (optional)">
        <TextArea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} />
      </Field>

      {preview && (
        <section aria-live="polite" className="preview">
          <h3 className="money-h3">What would change</h3>
          {!preview.ok ? (
            <p className="muted">We couldn’t work out the effect just now.</p>
          ) : (
            <>
              {preview.value.warnings.map((m) => (
                <p key={m} className="small">
                  <Icon name="alert" size={14} /> {m}
                </p>
              ))}
              {preview.value.changes.length === 0 ? (
                <p className="muted">No other date changes.</p>
              ) : (
                <ul className="preview__list">
                  {preview.value.changes.map((c) => (
                    <li key={c.deadline_id}>
                      <strong>{c.label}</strong>
                      <span className="muted">
                        {' '}
                        {c.before ? civil(c.before, 'short') : 'Awaiting date'} → {c.after ? civil(c.after, 'short') : 'Awaiting date'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.value.unaffected_travelers.length > 0 && (
                <p className="small muted">Unchanged: {preview.value.unaffected_travelers.map((p) => dir.nameOf(p)).join(', ')}’s dates.</p>
              )}
            </>
          )}
        </section>
      )}
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}
