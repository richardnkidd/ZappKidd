import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;

function setBackgroundInert(on: boolean) {
  const root = document.getElementById('root');
  if (!root) return;
  if (on) root.setAttribute('inert', '');
  else root.removeAttribute('inert');
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Modal dialog: traps focus, closes on Escape and on backdrop click, restores focus to the opener, and makes the
 * rest of the app inert while open. Bottom sheet on phones, centred card on larger screens.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    openCount += 1;
    setBackgroundInert(true);
    document.body.classList.add('is-modal-open');

    const panel = panelRef.current;
    // Prefer an explicitly marked field, then a text field; otherwise focus the dialog itself so its title is read
    // first and the sheet does not scroll away from the top.
    const target =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>('input:not([type]), input[type="text"], input[type="email"], input[type="url"], textarea') ??
      panel;
    target?.focus({ preventScroll: true });

    return () => {
      openCount -= 1;
      if (openCount <= 0) {
        openCount = 0;
        setBackgroundInert(false);
        document.body.classList.remove('is-modal-open');
      }
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="dialog-root" onKeyDown={onKeyDown}>
      <div className="dialog-backdrop" onClick={() => closeRef.current()} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`dialog dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="dialog__head">
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={() => closeRef.current()} aria-label="Close">
            <Icon name="x" size={20} />
          </button>
        </div>
        {description && (
          <p id={descId} className="dialog__desc muted">
            {description}
          </p>
        )}
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
