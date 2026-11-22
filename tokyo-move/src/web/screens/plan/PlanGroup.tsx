import { useCallback, useId, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';

/**
 * Open or closed choices for the Plan's groups, kept for this browser session only (never between visits).
 * Storage can be missing or throw (private windows, blocked site data), so every access is wrapped and a plain
 * in-memory copy keeps the choice for the rest of the page's life.
 */
const STORE_KEY = 'kadode.plan.open';
let memory: Record<string, boolean> = {};
let loaded = false;

function readAll(): Record<string, boolean> {
  if (loaded) return memory;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) memory = { ...(parsed as Record<string, boolean>) };
  } catch {
    /* storage is not available: the in-memory copy is used */
  }
  return memory;
}

/** The remembered open or closed choice for `id` this session, or undefined when none was made. */
export function readOpen(id: string): boolean | undefined {
  const v = readAll()[id];
  return typeof v === 'boolean' ? v : undefined;
}

/** Remember a choice for the rest of this session. */
export function writeOpen(id: string, open: boolean) {
  memory = { ...readAll(), [id]: open };
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(memory));
  } catch {
    /* ignore: the choice is still kept in memory */
  }
}

/** For tests: forget every choice, so one test does not leak into the next. */
export function resetOpenChoices() {
  memory = {};
  loaded = true;
  try {
    window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** The remembered choice for `id`, or `fallback` when none was made this session. */
export function useSessionOpen(id: string, fallback: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => readOpen(id) ?? fallback);
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      writeOpen(id, next);
    },
    [id],
  );
  return [open, setOpen];
}

interface PlanGroupProps {
  /** Stable id for the remembered choice, such as "workstream:S03". */
  id: string;
  title: ReactNode;
  /** The number on the heading, when it is cheap to know. */
  count?: number;
  /** Words only a screen reader hears after the count, such as "to do". */
  countLabel?: string;
  /** Quiet words after the count, such as "2 stuck". */
  note?: ReactNode;
  defaultOpen: boolean;
  children: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * A proper disclosure: the heading holds one button with `aria-expanded` and `aria-controls`; the panel stays in the
 * page (hidden) so the control always points at something. Name and count on one line.
 */
export function PlanGroup({ id, title, count, countLabel, note, defaultOpen, children, headingLevel = 3, className = '' }: PlanGroupProps) {
  const panelId = useId();
  const [open, setOpen] = useSessionOpen(id, defaultOpen);
  const H = headingLevel === 2 ? 'h2' : headingLevel === 3 ? 'h3' : 'h4';
  return (
    <section className={`pgroup${open ? ' is-open' : ''} ${className}`.trim()}>
      <H className="pgroup__head">
        <button type="button" className="pgroup__btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          <Icon name="chevron-right" size={18} className="pgroup__chev" />
          <span className="pgroup__title">{title}</span>
          {count !== undefined && (
            <span className="pgroup__count">
              {count}
              {countLabel && <span className="visually-hidden"> {countLabel}</span>}
            </span>
          )}
          {note && <span className="pgroup__note">{note}</span>}
        </button>
      </H>
      <div id={panelId} className="pgroup__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
