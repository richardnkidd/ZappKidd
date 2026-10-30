import { useState } from 'react';
import { PHASE_LABEL } from '@shared/labels';
import { Button, Field, TextInput } from '../../components/Controls';
import { currentPhase } from '../../lib/home';
import { plural } from '../../lib/format';
import { isOpenWork, type Directory, type Indexes } from '../../lib/records';
import { loadPref, savePref } from '../../state/prefs';

/** Open, owned, non-optional items in the current phase, per accountable person. Never judges; the household sets any limit. */
export function WorkloadLine({ idx, dir }: { idx: Indexes; dir: Directory }) {
  const phase = currentPhase(idx);
  const [limit, setLimit] = useState<number | null>(() => {
    const n = Number(loadPref('workload-limit'));
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(limit ? String(limit) : '');
  if (!phase) return null;
  const open = idx.milestones.filter((m) => m.data?.phase === phase && isOpenWork(m.status) && !m.data?.optional_future_work);
  if (open.length === 0) return null;
  const counts = dir.adults.map((a) => ({ id: a.id, name: a.display_name, n: open.filter((m) => m.owner === a.id).length }));
  const together = open.filter((m) => m.owner === 'together').length;
  const unassigned = open.filter((m) => !m.owner || m.owner === 'unassigned').length;
  const over = limit ? counts.filter((c) => c.n > limit) : [];

  const save = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n) || n <= 0) {
      savePref('workload-limit', '');
      setLimit(null);
    } else {
      savePref('workload-limit', String(Math.round(n)));
      setLimit(Math.round(n));
    }
    setEditing(false);
  };

  return (
    <div className="workload">
      <p className="small muted">
        <strong>{PHASE_LABEL[phase]}:</strong>{' '}
        {counts.map((c, i) => (
          <span key={c.id}>
            {i > 0 && ' · '}
            {c.name} {plural(c.n, 'open item')}
          </span>
        ))}
        {together > 0 && ` · ${together} together`}
        {unassigned > 0 && ` · ${unassigned} without an owner`}.
        {over.length > 0 && (
          <span>
            {' '}
            That is more than the {limit} you set for {over.map((c) => c.name).join(' and ')}; it may be worth moving something.
          </span>
        )}{' '}
        {!editing && (
          <Button variant="quiet" small onClick={() => setEditing(true)}>
            {limit ? 'Change the limit' : 'Set a gentle limit'}
          </Button>
        )}
      </p>
      {editing && (
        <div className="workload__edit">
          <Field label="Mention it when one person has more than this many open items" hint="Saved on this device only. Leave empty for no limit.">
            <TextInput type="number" inputMode="numeric" min={1} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <div className="row-actions" style={{ marginTop: 0 }}>
            <Button variant="primary" small onClick={save}>
              Save
            </Button>
            <Button variant="quiet" small onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
