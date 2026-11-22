import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ClampTextProps {
  children: ReactNode;
  /** How many lines to show before the text is cut. Any screen can pass any number. Default 3. */
  lines?: number;
  className?: string;
  /** Button words. Defaults "More" and "Show less". */
  moreLabel?: string;
  lessLabel?: string;
  /** Element to render. Default a paragraph; use `div` when the children contain block markup. */
  as?: 'p' | 'div' | 'span';
}

/**
 * Long text cut to a few lines with a More / Show less toggle (button with aria-expanded and aria-controls).
 * The toggle appears only when the text really is cut (measured, so it adapts to width and text size), and it is a
 * 44px touch target.
 */
export function ClampText({ children, lines = 3, className = '', moreLabel = 'More', lessLabel = 'Show less', as = 'p' }: ClampTextProps) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children, lines]);

  const Tag = as as 'p';
  return (
    <>
      <Tag
        id={id}
        ref={ref as React.RefObject<HTMLParagraphElement>}
        className={`clamp${open ? '' : ' clamp--on'} ${className}`.trim()}
        style={open ? undefined : ({ '--clamp-lines': lines } as CSSProperties)}
      >
        {children}
      </Tag>
      {(cut || open) && (
        <div className="clamp__more">
          <button type="button" className="more__btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            <span>{open ? lessLabel : moreLabel}</span>
            <Icon name="chevron-down" size={16} className="more__chev" />
          </button>
        </div>
      )}
    </>
  );
}
