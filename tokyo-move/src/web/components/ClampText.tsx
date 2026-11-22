import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Controls';

/**
 * Long text cut to a few lines with a More / Less toggle. The toggle appears only when the text really is cut
 * (measured, so it adapts to width and text size).
 */
export function ClampText({ children, lines = 3, className = '' }: { children: ReactNode; lines?: number; className?: string }) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
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

  return (
    <>
      <p id={id} ref={ref} className={`clamp${open ? '' : ' clamp--on'} ${className}`.trim()} style={open ? undefined : ({ '--clamp-lines': lines } as React.CSSProperties)}>
        {children}
      </p>
      {(cut || open) && (
        <div>
          <Button variant="quiet" small aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            {open ? 'Show less' : 'More'}
          </Button>
        </div>
      )}
    </>
  );
}
