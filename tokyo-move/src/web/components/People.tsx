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

export const MIN_BADGE = 18;

/**
 * Monogram circle: initial for adults, a paw for the dog. Always paired with the name in text nearby.
 * At least 18px wide; the letter is at least 11px (the badge is decorative, the name beside it is the text).
 */
export function PersonBadge({ person, size = 24 }: { person: Person | null; size?: number }) {
  const dir = useDir();
  const tone = toneFor(person, dir);
  const px = Math.max(MIN_BADGE, size);
  const initial = person?.display_name?.trim().charAt(0).toUpperCase() ?? '?';
  return (
    <span className={`pbadge pbadge--${tone}`} style={{ width: px, height: px, fontSize: Math.max(11, Math.round(px * 0.52)) }} aria-hidden="true">
      {person?.kind === 'pet' ? <PawIcon size={Math.round(px * 0.62)} /> : initial}
    </span>
  );
}

/** "Together" is one glyph with two people in it, never two overlapping monograms. */
export function TogetherBadge({ size = 24 }: { size?: number }) {
  const px = Math.max(MIN_BADGE, size);
  return (
    <span className="pbadge pbadge--together" style={{ width: px, height: px }} aria-hidden="true">
      <Icon name="together" size={Math.round(px * 0.72)} />
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
  /** The owner is only suggested: "not agreed yet" is shown, in plain text, and only then. */
  proposed?: boolean;
  /**
   * `quiet` (default): monogram and name in plain text, no pill. `chip`: the old bordered pill, for a screen that
   * genuinely needs it.
   */
  variant?: 'quiet' | 'chip';
  /** Smaller, for dense rows. Only changes the monogram size. */
  compact?: boolean;
  prefix?: string;
}

/** "<name>", "Together" or "Unassigned", with a monogram. "not agreed yet" only when the owner is provisional. */
export function OwnerChip({ owner, proposed = false, variant = 'quiet', compact = false, prefix }: OwnerChipProps) {
  const dir = useDir();
  const o = !owner || owner === 'unassigned' ? 'unassigned' : owner;
  const label = dir.ownerLabel(o);
  const isProposed = proposed && o !== 'unassigned';
  const size = compact ? MIN_BADGE : 20;
  const badge =
    o === 'together' ? (
      <TogetherBadge size={size} />
    ) : o === 'unassigned' ? (
      <span className="pbadge pbadge--none" style={{ width: size, height: size }} aria-hidden="true">
        <Icon name="user" size={12} />
      </span>
    ) : (
      <PersonBadge person={dir.personById(o)} size={size} />
    );
  if (variant === 'chip') {
    const cls = `chip chip--owner${compact ? ' chip--sm' : ''}${isProposed ? ' chip--proposed' : ''}${o === 'unassigned' ? ' chip--unassigned' : ''}`;
    return (
      <span className={cls}>
        {badge}
        <span>
          {prefix ? `${prefix} ` : ''}
          {label}
          {isProposed ? '? (not agreed yet)' : ''}
        </span>
      </span>
    );
  }
  return (
    <span className={`owner${o === 'unassigned' ? ' owner--unassigned' : ''}${isProposed ? ' owner--proposed' : ''}`}>
      {badge}
      <span className="owner__name">
        {prefix ? `${prefix} ` : ''}
        {label}
      </span>
      {isProposed && <span className="owner__note">not agreed yet</span>}
    </span>
  );
}

/** Imported text with internal codes removed or swapped for plain titles. Display-only. */
export function usePlain(): (text: string | null | undefined) => string {
  const idx = useOptionalSnapshot()?.idx;
  return (text) => proseText(text, idx);
}
