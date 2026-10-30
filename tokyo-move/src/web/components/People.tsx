import type { OwnerRef, Person } from '@shared/types';
import { proseText } from '../lib/prose';
import { buildDirectory, type Directory } from '../lib/records';
import { useOptionalSnapshot } from '../state/snapshot';
import { Icon, PawIcon } from './Icon';

const EMPTY_DIR = buildDirectory([], null);

export function useDir(): Directory {
  return useOptionalSnapshot()?.dir ?? EMPTY_DIR;
}

function toneFor(person: Person | null, dir: Directory): 'a' | 'b' | 'pet' | 'none' {
  if (!person) return 'none';
  if (person.kind === 'pet') return 'pet';
  const i = dir.adults.findIndex((a) => a.id === person.id);
  return i === 1 ? 'b' : 'a';
}

/** Monogram circle: initial for adults, a paw for the dog. Always paired with the name in text nearby. */
export function PersonBadge({ person, size = 24 }: { person: Person | null; size?: number }) {
  const dir = useDir();
  const tone = toneFor(person, dir);
  const initial = person?.display_name?.trim().charAt(0).toUpperCase() ?? '?';
  return (
    <span className={`pbadge pbadge--${tone}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.52) }} aria-hidden="true">
      {person?.kind === 'pet' ? <PawIcon size={Math.round(size * 0.62)} /> : initial}
    </span>
  );
}

export function PersonName({ id, withBadge = true }: { id: string | null | undefined; withBadge?: boolean }) {
  const dir = useDir();
  const p = dir.personById(id);
  return (
    <span className="person-name">
      {withBadge && <PersonBadge person={p} size={20} />}
      <span>{p?.display_name ?? dir.nameOf(id)}</span>
    </span>
  );
}

interface OwnerChipProps {
  owner: OwnerRef | null | undefined;
  proposed?: boolean;
  /** Smaller, for dense rows. */
  compact?: boolean;
  prefix?: string;
}

/** "<name>", "Together", "Unassigned" or "Proposed: <name>" (provisional until accepted). */
export function OwnerChip({ owner, proposed = false, compact = false, prefix }: OwnerChipProps) {
  const dir = useDir();
  const o = !owner || owner === 'unassigned' ? 'unassigned' : owner;
  const label = dir.ownerLabel(o);
  const isProposed = proposed && o !== 'unassigned';
  const cls = `chip chip--owner${compact ? ' chip--sm' : ''}${isProposed ? ' chip--proposed' : ''}${o === 'unassigned' ? ' chip--unassigned' : ''}`;
  return (
    <span className={cls}>
      {o === 'together' ? (
        <span className="pbadge-pair" aria-hidden="true">
          {dir.adults.slice(0, 2).map((a) => (
            <PersonBadge key={a.id} person={a} size={compact ? 18 : 20} />
          ))}
        </span>
      ) : o === 'unassigned' ? (
        <span className="pbadge pbadge--none" style={{ width: compact ? 18 : 20, height: compact ? 18 : 20 }} aria-hidden="true">
          <Icon name="user" size={12} />
        </span>
      ) : (
        <PersonBadge person={dir.personById(o)} size={compact ? 18 : 20} />
      )}
      <span>
        {prefix ? `${prefix} ` : ''}
        {label}
        {isProposed ? '? (not agreed yet)' : ''}
      </span>
    </span>
  );
}

/** Imported text with internal codes removed or swapped for plain titles. Display-only. */
export function usePlain(): (text: string | null | undefined) => string {
  const idx = useOptionalSnapshot()?.idx;
  return (text) => proseText(text, idx);
}
