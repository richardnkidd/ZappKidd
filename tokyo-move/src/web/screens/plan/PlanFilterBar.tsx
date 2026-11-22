import { useId, useState } from 'react';
import { PHASE_LABEL, PHASE_ORDER, WORK_STATUS_LABEL, WORK_STATUS_ORDER } from '@shared/labels';
import { Button, Field, Select } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import type { PlanFilters } from '../../lib/plan';
import type { Directory } from '../../lib/records';

interface Props {
  filters: PlanFilters;
  dir: Directory;
  onChange: (f: PlanFilters) => void;
  onReset: () => void;
  activeCount: number;
  shown: number;
  total: number;
}

/** Filters: collapsed behind a button on phones, always visible on wider screens. */
export function PlanFilterBar({ filters, dir, onChange, onReset, activeCount, shown, total }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const set = <K extends keyof PlanFilters>(k: K, v: PlanFilters[K]) => onChange({ ...filters, [k]: v });
  const otherName = dir.others[0]?.display_name;

  return (
    <div className="filterbar">
      <div className="filterbar__top">
        <Button
          variant="secondary"
          icon="plan"
          className="filterbar__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        </Button>
        <p className="filterbar__count" role="status">
          Showing {shown} of {total}
        </p>
        {activeCount > 0 && (
          <Button variant="quiet" onClick={onReset}>
            Clear filters
          </Button>
        )}
      </div>
      <div id={panelId} className={`filterbar__panel${open ? ' is-open' : ''}`}>
        <Field label="Owner">
          <Select value={filters.owner} onChange={(e) => set('owner', e.target.value as PlanFilters['owner'])}>
            <option value="all">Anyone</option>
            <option value="mine">Mine</option>
            {dir.others.length > 0 && <option value="other">{dir.others.length === 1 ? `${otherName}’s` : 'Others’'}</option>}
            <option value="together">Together</option>
            <option value="unassigned">Unassigned</option>
          </Select>
        </Field>
        <Field label="Traveler">
          <Select value={filters.traveler} onChange={(e) => set('traveler', e.target.value)}>
            <option value="all">Everyone</option>
            {dir.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
            <option value="household">Whole household</option>
          </Select>
        </Field>
        <Field label="Phase">
          <Select value={filters.phase} onChange={(e) => set('phase', e.target.value as PlanFilters['phase'])}>
            <option value="all">Any time</option>
            {PHASE_ORDER.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={filters.status} onChange={(e) => set('status', e.target.value as PlanFilters['status'])}>
            <option value="all">Any status</option>
            <option value="open">Still to do</option>
            {WORK_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {WORK_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <label className="choice filterbar__check">
          <input type="checkbox" checked={filters.hideOptional} onChange={(e) => set('hideOptional', e.target.checked)} />
          <span className="choice__text">
            <span>Hide optional future work</span>
            <span className="choice__hint">Ideas that are not part of the move.</span>
          </span>
        </label>
      </div>
    </div>
  );
}
