import { useEffect, useState } from 'react';
import { isCivilDate } from '@shared/dates';
import type { CostData, CostPhase, Currency, FundingData, Money } from '@shared/types';
import { Button, Field, Select, TextArea, TextInput } from '../../components/Controls';
import { Dialog } from '../../components/Dialog';
import { ConflictBanner } from '../../components/Feedback';
import type { AnyRecord } from '../../lib/records';
import { dataOf } from '../../lib/records';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

type AmountKind = 'estimate' | 'quote' | 'committed' | 'paid_part' | 'paid_full';

const KIND_LABEL: Record<AmountKind, { label: string; hint: string }> = {
  estimate: { label: 'An estimate', hint: 'A best guess for now.' },
  quote: { label: 'A quote', hint: 'Someone gave us this price.' },
  committed: { label: 'Approved', hint: 'We have agreed to pay this.' },
  paid_part: { label: 'Paid so far (part)', hint: 'Part of it has been paid.' },
  paid_full: { label: 'Paid in full', hint: 'Nothing is left to pay.' },
};

function currentKind(d: Partial<CostData>): AmountKind {
  if (d.commitment_state === 'paid') return 'paid_full';
  if (d.commitment_state === 'partially_paid') return 'paid_part';
  if (d.commitment_state === 'approved_commitment') return 'committed';
  if (d.commitment_state === 'quote') return 'quote';
  return 'estimate';
}

function existingMoney(d: Partial<CostData>, kind: AmountKind): Money | null {
  switch (kind) {
    case 'estimate':
      return d.estimate ?? null;
    case 'quote':
      return d.quote ?? null;
    case 'committed':
      return d.committed ?? null;
    default:
      return d.paid ?? null;
  }
}

/** Edit one cost line: ONE amount in ONE currency, where it came from, when, and any notes about timing. */
export function CostLineDialog({ open, onClose, record }: { open: boolean; onClose: () => void; record: AnyRecord }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const d = dataOf<CostData>(record);
  const [kind, setKind] = useState<AmountKind>('estimate');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [applicability, setApplicability] = useState<CostData['applicability']>('include');
  const [exclusion, setExclusion] = useState('');
  const [startVersion, setStartVersion] = useState(record.version);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    const k = currentKind(d);
    const m = existingMoney(d, k) ?? d.estimate ?? d.quote ?? d.committed ?? null;
    setKind(k);
    setCurrency(m?.currency ?? 'USD');
    setAmount(m ? String(m.amount) : '');
    setSource(d.quote_source ?? '');
    setDate(d.quote_date ?? '');
    setNote(d.phase?.note ?? '');
    setApplicability(d.applicability ?? 'include');
    setExclusion(d.exclusion_reason ?? '');
    setStartVersion(record.version);
    setTried(false);
    w.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hasAmount = amount.trim() !== '';
  const num = Number(amount);
  const amountBad = hasAmount && (!Number.isFinite(num) || num < 0);
  const dateBad = date !== '' && !isCivilDate(date);
  const exclusionMissing = applicability === 'exclude' && exclusion.trim() === '';

  const submit = async () => {
    setTried(true);
    if (amountBad || dateBad || exclusionMissing) return;
    const money: Money | null = hasAmount ? { amount: num, currency } : null;
    const data: Record<string, unknown> = {
      commitment_state: kind === 'estimate' ? 'estimate' : kind === 'quote' ? 'quote' : kind === 'committed' ? 'approved_commitment' : kind === 'paid_full' ? 'paid' : 'partially_paid',
      quote_source: source.trim() || null,
      quote_date: date || null,
      applicability,
      exclusion_reason: applicability === 'exclude' ? exclusion.trim() : null,
    };
    if (hasAmount) {
      if (kind === 'estimate') data.estimate = money;
      else if (kind === 'quote') data.quote = money;
      else if (kind === 'committed') data.committed = money;
      else data.paid = money;
    } else if (!hasAmount) {
      // Clearing the amount for the chosen kind keeps unknown as unknown (never 0).
      if (kind === 'estimate') data.estimate = null;
      else if (kind === 'quote') data.quote = null;
      else if (kind === 'committed') data.committed = null;
      else data.paid = null;
    }
    if (note.trim() !== (d.phase?.note ?? '')) {
      const base: CostPhase = d.phase ?? { traveler: null, start_anchor: null, start_date: null, end_anchor: null, end_date: null, months: null, note: null };
      data.phase = { ...base, note: note.trim() || null };
    }
    const ok = await w.run((v) => actions.patchRecord(record.id, v, { data }), startVersion);
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit this amount"
      description={record.title}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <fieldset>
        <legend>This amount is</legend>
        <div className="stack stack--tight">
          {(Object.keys(KIND_LABEL) as AmountKind[]).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              <span className="choice__text">
                <span>{KIND_LABEL[k].label}</span>
                <span className="choice__hint">{KIND_LABEL[k].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-row">
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="USD">US dollars</option>
            <option value="JPY">Japanese yen</option>
          </Select>
        </Field>
        <Field
          label="Amount"
          hint="Enter it once, in one currency. Leave empty if it is not known yet."
          error={tried && amountBad ? 'Please enter a number that is zero or more.' : null}
        >
          <TextInput value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Not known yet" />
        </Field>
      </div>
      <Field label="Where did it come from?" hint="For example the name of the quote or the website.">
        <TextInput value={source} onChange={(e) => setSource(e.target.value)} />
      </Field>
      <Field label="Date of the quote or estimate" error={tried && dateBad ? 'Please pick a real date.' : null}>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Notes on timing" hint="For monthly costs: who it follows and for how long, in plain words.">
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      <Field label="Counts toward the plan?" hint={applicability === 'review' && hasAmount ? 'While this says “Not decided yet”, the amount is not counted. Choose Yes to count it.' : undefined}>
        <Select value={applicability} onChange={(e) => setApplicability(e.target.value as CostData['applicability'])}>
          <option value="include">Yes, include it</option>
          <option value="review">Not decided yet</option>
          <option value="exclude">No, leave it out</option>
        </Select>
      </Field>
      {applicability === 'exclude' && (
        <Field label="Why is it left out?" error={tried && exclusionMissing ? 'Please say why, so it makes sense later.' : null}>
          <TextArea value={exclusion} onChange={(e) => setExclusion(e.target.value)} rows={2} />
        </Field>
      )}
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}

/** Edit the base exchange rate (yen per dollar), its source and its date. */
export function FxDialog({ open, onClose, record }: { open: boolean; onClose: () => void; record: AnyRecord | null }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const d = record ? dataOf<FundingData>(record) : {};
  const [rate, setRate] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState('');
  const [startVersion, setStartVersion] = useState(record?.version ?? 1);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open || !record) return;
    setRate(d.jpy_per_usd ? String(d.jpy_per_usd) : '');
    setSource(d.source ?? '');
    setDate(d.as_of ?? '');
    setStartVersion(record.version);
    setTried(false);
    w.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const num = Number(rate);
  const rateBad = rate.trim() !== '' && (!Number.isFinite(num) || num <= 0);
  const dateBad = date !== '' && !isCivilDate(date);

  const submit = async () => {
    setTried(true);
    if (!record || rateBad || dateBad) return;
    const ok = await w.run(
      (v) => actions.patchRecord(record.id, v, { data: { jpy_per_usd: rate.trim() === '' ? null : num, source: source.trim() || null, as_of: date || null } }),
      startVersion,
    );
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Exchange rate"
      description="The base rate before any scenario. Amounts in yen can only be turned into dollars once a rate is set."
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={w.busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Yen per US dollar" hint="Leave empty if it is not known yet." error={tried && rateBad ? 'Please enter a number above zero.' : null}>
        <TextInput value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="Not known yet" />
      </Field>
      <Field label="Where did the rate come from?">
        <TextInput value={source} onChange={(e) => setSource(e.target.value)} />
      </Field>
      <Field label="Date of the rate" error={tried && dateBad ? 'Please pick a real date.' : null}>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && (
        <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={() => { w.keepTheirs(); onClose(); }} onUseMine={async () => { if (await w.useMine()) onClose(); }} />
      )}
    </Dialog>
  );
}
