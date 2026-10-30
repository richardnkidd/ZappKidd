import { Button } from '../../components/Controls';
import { ConflictBanner } from '../../components/Feedback';
import type { AnyRecord } from '../../lib/records';
import { dataOf } from '../../lib/records';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

export type Applies = 'yes' | 'no' | 'unknown';

const CHOICES: { value: Applies; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Not sure' },
];

/** The household's answer to "does this step apply to <name>?". Saved per person, merged per key, audited. */
export function currentAnswer(record: AnyRecord, personId: string): Applies {
  const a = dataOf<{ applies_to?: Record<string, Applies> }>(record).applies_to?.[personId];
  return a === 'yes' || a === 'no' ? a : 'unknown';
}

export function AppliesToControl({ record, personId, name, onSaved }: { record: AnyRecord; personId: string; name: string; onSaved?: () => void }) {
  const { actions } = useSnapshot();
  const w = useWrite();
  const now = currentAnswer(record, personId);
  const choose = (value: Applies) => {
    if (value === now) return;
    void w.run((v) => actions.patchRecord(record.id, v, { data: { applies_to: { [personId]: value } } }), record.version).then((ok) => ok && onSaved?.());
  };
  return (
    <div className="applies">
      <p className="applies__q" id={`applies-${record.id}-${personId}`}>
        Does this apply to {name}?
      </p>
      <div role="group" aria-labelledby={`applies-${record.id}-${personId}`} className="applies__choices">
        {CHOICES.map((c) => (
          <Button key={c.value} variant="secondary" small className="applies__btn" aria-pressed={now === c.value} disabled={w.busy} onClick={() => choose(c.value)}>
            {c.label}
          </Button>
        ))}
      </div>
      {w.error && <p className="field__error" role="alert">{w.error}</p>}
      {w.conflict && <ConflictBanner conflict={w.conflict} busy={w.busy} onKeepTheirs={w.keepTheirs} onUseMine={() => void w.useMine()} />}
    </div>
  );
}
