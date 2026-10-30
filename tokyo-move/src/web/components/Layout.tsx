import { useEffect, useId, useRef, type ElementType, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

let firstTitleMounted = false;

/**
 * Page heading. Focus moves here on every route change (not on the very first load) so keyboard and
 * screen-reader users land at the top of the new page.
 */
export function PageTitle({ children, kicker, actions, id }: { children: ReactNode; kicker?: ReactNode; actions?: ReactNode; id?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // Decided during the first render so React's dev-mode double effect does not steal focus on the initial load.
  const skipFocus = useRef(!firstTitleMounted);
  useEffect(() => {
    firstTitleMounted = true;
    if (skipFocus.current) return;
    ref.current?.focus({ preventScroll: false });
    window.scrollTo?.({ top: 0 });
  }, []);
  // Keep the browser tab title in step with the page heading.
  useEffect(() => {
    const text = ref.current?.textContent?.trim();
    if (text) document.title = `${text} · Kadode`;
  });
  return (
    <header className="page-head">
      <div className="page-head__text">
        {kicker && <p className="kicker">{kicker}</p>}
        <h1 ref={ref} tabIndex={-1} id={id}>
          {children}
        </h1>
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}

interface CardProps {
  as?: ElementType;
  className?: string;
  tone?: 'default' | 'inset' | 'proposal' | 'attention' | 'blocked' | 'done';
  children: ReactNode;
  [k: string]: unknown;
}

export function Card({ as: Tag = 'div', className = '', tone = 'default', children, ...rest }: CardProps) {
  return (
    <Tag className={`card card--${tone} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

interface SectionProps {
  title: ReactNode;
  count?: number | string;
  action?: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}

export function Section({ title, count, action, intro, children, className = '', headingLevel = 2 }: SectionProps) {
  const id = useId();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`section ${className}`.trim()} aria-labelledby={id}>
      <div className="section__head">
        <H id={id} className="section__title">
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </H>
        {action && <div className="section__action">{action}</div>}
      </div>
      {intro && <p className="section__intro muted">{intro}</p>}
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action, icon = 'sprout' }: { title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      {title && <p className="empty__title">{title}</p>}
      {children && <p className="empty__body muted">{children}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton__line" style={{ width: `${i === lines - 1 ? 60 : 100 - ((i * 13) % 30)}%`, height }} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="stack" role="status" aria-label="Loading">
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card">
          <Skeleton lines={3} />
        </div>
      ))}
    </div>
  );
}

/** Definition list row used on record detail. */
export function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`fact${wide ? ' fact--wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
