import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PHASE_LABEL, PHASE_ORDER, WORK_STATUS_LABEL, WORK_STATUS_ORDER } from '@shared/labels';
import { Button, Field, SegmentedControl, Select } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import { applyQuickFilter, quickFilterOf, type PlanFilters, type QuickFilter } from '../../lib/plan';
import type { Directory } from '../../lib/records';

interface Props {
  filters: PlanFilters;
  dir: Directory;
  onChange: (f: PlanFilters) => void;
  onReset: () => void;
  activeCount: number;
  shown: number;
  total: number;
  /** Optional future items the filter hides, so the box can say how many. */
  hiddenOptional: number;
  /** The workload line (a gentle limit), which lives inside "More filters" so the page opens on content. */
  children?: ReactNode;
}

const QUICK: { value: QuickFilter | 'custom'; label: string }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'all', label: 'All' },
];

/**
 * One simple control (Mine, Blocked, All) and, on the same line as the count, a "More filters" button that opens the
 * full set. The count line says how many items are shown, once.
 */
export function PlanFilterBar({ filters, dir, onChange, onReset, activeCount, shown, total, hiddenOptional, children }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const set = <K extends keyof PlanFilters>(k: K, v: PlanFilters[K]) => onChange({ ...filters, [k]: v });
  const otherName = dir.others[0]?.display_name;
  const quick = quickFilterOf(filters);
  // Anything the quick choice does not cover is in the full set: count it on the button so it is never hidden.
  const extra = quick === null ? activeCount : 0;

  return (
    <div className="planbar">
      <SegmentedControl
        label="Show"
        value={(quick ?? 'custom') as QuickFilter | 'custom'}
        options={QUICK}
        onChange={(v) => v !== 'custom' && onChange(applyQuickFilter(v))}
        className="planbar__quick"
      />
      <div className="planbar__line">
        <p className="planbar__count" role="status">
          Showing {shown} of {total}
        </p>
        <button type="button" className="more__btn planbar__more" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
          <span>More filters{extra > 0 ? ` (${extra})` : ''}</span>
          <Icon name="chevron-down" size={16} className="more__chev" />
        </button>
      </div>
      <div id={panelId} className="planbar__panel" hidden={!open}>
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
        <div className="planbar__optional">
          <label className="choice planbar__check">
            <input type="checkbox" checked={filters.hideOptional} onChange={(e) => set('hideOptional', e.target.checked)} />
            <span className="choice__text">
              <span>Hide optional future work{filters.hideOptional && hiddenOptional > 0 ? ` (${hiddenOptional})` : ''}</span>
            </span>
          </label>
          {filters.hideOptional && hiddenOptional > 0 && (
            <Link to="/future" className="more-link">
              See Future work
            </Link>
          )}
        </div>
        {children}
        {activeCount > 0 && (
          <div>
            <Button variant="quiet" onClick={onReset}>
              Clear filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
