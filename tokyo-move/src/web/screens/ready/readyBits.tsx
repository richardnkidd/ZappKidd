import type { GateStatus, ReadinessState } from '@shared/engine-contracts';
import { READINESS_STATE_LABEL } from '@shared/labels';
import { Icon, type IconName } from '../../components/Icon';
import { dataOf, type Indexes } from '../../lib/records';

export function readinessTone(state: ReadinessState): { tone: 'kaki' | 'ai' | 'neutral' | 'matcha'; icon: IconName } {
  switch (state) {
    case 'blocked':
      return { tone: 'kaki', icon: 'stop' };
    case 'preparing':
      return { tone: 'ai', icon: 'half' };
    case 'not_started':
      return { tone: 'neutral', icon: 'circle' };
    default:
      return { tone: 'matcha', icon: 'check' };
  }
}

/** The state word with an icon, never colour alone. */
export function ReadinessChip({ state }: { state: ReadinessState }) {
  const { tone, icon } = readinessTone(state);
  return (
    <span className={`chip chip--${tone}`}>
      <Icon name={icon} size={15} />
      <span>{READINESS_STATE_LABEL[state] ?? state}</span>
    </span>
  );
}

/** Optional future work is never shown as a gate, even if an engine list happened to include it. */
export function notOptional(idx: Indexes) {
  return (g: GateStatus | null | undefined): g is GateStatus => {
    if (!g) return false;
    const rec = idx.byId.get(g.record_id);
    return !(rec && dataOf<{ optional_future_work?: boolean }>(rec).optional_future_work);
  };
}
