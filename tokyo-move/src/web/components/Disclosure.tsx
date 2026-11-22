import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';

interface DisclosureProps {
  title: ReactNode;
  /** Short text shown at the right of the summary, e.g. a count. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  level?: 3 | 4;
}

/** Collapsible region built on native <details>, so it is keyboard and screen-reader friendly. */
export function Disclosure({ title, meta, defaultOpen = false, onToggle, children, className = '', level = 3 }: DisclosureProps) {
  const id = useId();
  const H = level === 3 ? 'h3' : 'h4';
  return (
    <details
      className={`disclosure ${className}`.trim()}
      open={defaultOpen || undefined}
      onToggle={(e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="disclosure__summary" aria-describedby={undefined}>
        <Icon name="chevron-right" size={18} className="disclosure__chev" />
        <H className="disclosure__title" id={id}>
          {title}
        </H>
        {meta && <span className="disclosure__meta">{meta}</span>}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
