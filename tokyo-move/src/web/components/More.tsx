import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface MoreProps {
  /** The button text. Default "More". Other packages use "Why and history". */
  label?: ReactNode;
  /** Optional text for the open state; by default the label stays the same and the chevron turns. */
  openLabel?: ReactNode;
  defaultOpen?: boolean;
  /** Called with the new state after each toggle. */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** Extra text for screen readers after the label, e.g. the name of the thing it opens. */
  hint?: string;
}

/**
 * One quiet disclosure for everything that is not the main point: a text button with `aria-expanded` and
 * `aria-controls`, and a region that is only shown when open (it stays in the page, hidden, so aria-controls always
 * resolves). 44px tall. Use it instead of a boxed Disclosure on cards.
 */
export function More({ label = 'More', openLabel, defaultOpen = false, onToggle, children, className = '', hint }: MoreProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`more${open ? ' is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="more__btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
          onToggle?.(!open);
        }}
      >
        <span>{open && openLabel ? openLabel : label}</span>
        {hint && <span className="visually-hidden"> {hint}</span>}
        <Icon name="chevron-down" size={16} className="more__chev" />
      </button>
      <div id={id} className="more__body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
