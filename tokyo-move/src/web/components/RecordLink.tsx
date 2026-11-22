import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

export const recordPath = (id: string) => `/r/${encodeURIComponent(id)}`;

/**
 * Link to a record. The current location is passed along so that on a wide screen the record opens as a side
 * panel over the page you were on; on a phone (or when opened directly) it is a full page.
 */
export function RecordLink({ id, children, className, ariaLabel }: { id: string; children: ReactNode; className?: string; ariaLabel?: string }) {
  const location = useLocation();
  const bg = (location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation ?? location;
  return (
    <Link to={recordPath(id)} state={{ backgroundLocation: bg }} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
