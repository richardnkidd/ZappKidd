import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface InfoNoteProps {
  /** Accessible name of the button, e.g. "About this date". Say what it reveals. */
  label?: string;
  /** The text revealed on tap. Kept in the page (hidden) so the button can point at it with aria-controls. */
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

/**
 * A small "i" button that reveals a caveat on tap or keyboard press. It is a real button with `aria-expanded`
 * and `aria-controls`, never a hover-only tooltip. The hit area is 44px square even though the glyph is small.
 * Escape closes it and keeps focus on the button.
 */
export function InfoNote({ label = 'More about this', children, className = '', defaultOpen = false }: InfoNoteProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <span className={`info-note${open ? ' is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="info-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <Icon name="info" size={16} />
      </button>
      <span id={id} role="note" className="info-note__body" hidden={!open}>
        {children}
      </span>
    </span>
  );
}
