import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { addCalendarDays } from '@shared/dates';
import { PHASE_LABEL } from '@shared/labels';
import type { PlanningTarget } from '@shared/types';
import { DateText, DeadlineBadge, StatusBadge } from '../../components/Badges';
import { SegmentedControl } from '../../components/Controls';
import { Icon, type IconName } from '../../components/Icon';
import { OwnerChip, PersonBadge } from '../../components/People';
import { RecordLink } from '../../components/RecordLink';
import { civil, plural } from '../../lib/format';
import {
  barLabel,
  buildAxis,
  chartRange,
  clipDate,
  clipSpan,
  compactAxisRows,
  compareSpan,
  dayX,
  departureAnchors,
  departureMarkers,
  groupByTraveler,
  groupSpan,
  parseGroupPref,
  parseRangePref,
  phaseBands,
  placeItems,
  referenceDeparture,
  sharedCheckIns,
  type DepartureMarker,
  type GanttAxis,
  type GanttItem,
  type GanttRangeMode,
  type GroupMode,
  type ItemGroup,
  type SharedCheckIn,
} from '../../lib/gantt';
import { groupPlan, sortPlanItems, type PlanItemData } from '../../lib/plan';
import { dataOf, isOpenWork, type Directory, type Indexes } from '../../lib/records';
import { loadPref, savePref } from '../../state/prefs';
import { Chain } from './Chain';

/* Sizes that the layout and the pixel maths must agree on. Everything else about looks lives in styles/gantt.css. */
const UNIT_PX = { wide: 72, phone: 56 }; // the narrowest month (or quarter) column
const MIN_BAR = 24; // a bar is never narrower than a comfortable touch target
const HIT_PAD = 8; // room for a diamond or a circle that hangs past the bar
const PHONE_QUERY = '(max-width: 600px)'; // titles move above their bars
const WIDE_QUERY = '(min-width: 900px)'; // the chart becomes its own scroll box with a sticky axis (see gantt.css)

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const RANGE_PREF = 'timeline-range';
const GROUP_PREF = 'timeline-group';

const STATUS_GLYPH: Partial<Record<string, IconName>> = {
  completed: 'check',
  blocked: 'stop',
  waiting_external: 'hourglass',
  in_progress: 'half',
  eliminated: 'x',
  not_applicable: 'dash',
};

/** A custom property goes through React's style prop (CSSOM), so the strict CSP stays untouched. */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

/* ------------------------------------------------------------------ geometry */

interface Geometry {
  left: number;
  width: number;
  fill: { left: number; width: number; continuesBefore: boolean; continuesAfter: boolean; off: 'before' | 'after' | null } | null;
  diamond: number | null;
  check: { x: number; off: 'before' | 'after' | null } | null;
}

/** Pixel positions of one row's marks inside the timeline area (axis.width wide). */
function geometry(g: GanttItem, axis: GanttAxis): Geometry {
  let fill: Geometry['fill'] = null;
  let diamond: number | null = null;
  let check: Geometry['check'] = null;
  if (g.start && g.end) {
    const c = clipSpan(g.start, g.end, axis.range);
    let x0 = dayX(axis, c.start);
    let x1 = dayX(axis, addCalendarDays(c.end, 1));
    if (c.offRange === 'before') {
      x0 = 0;
      x1 = MIN_BAR;
    } else if (c.offRange === 'after') {
      x1 = axis.width;
      x0 = axis.width - MIN_BAR;
    } else if (x1 - x0 < MIN_BAR) {
      x1 = Math.min(axis.width, x0 + MIN_BAR);
      x0 = x1 - MIN_BAR;
    }
    fill = { left: x0, width: x1 - x0, continuesBefore: c.continuesBefore, continuesAfter: c.continuesAfter, off: c.offRange };
    if (g.deadline && !c.continuesAfter && !c.offRange) diamond = x1;
  }
  if (g.checkIn && !g.sharedCheckIn) {
    const c = clipDate(g.checkIn, axis.range);
    const x = c.offRange === 'before' ? HIT_PAD : c.offRange === 'after' ? axis.width - HIT_PAD : dayX(axis, c.date) + axis.pxPerDay / 2;
    check = { x, off: c.offRange };
  }
  const xs = [fill?.left, fill ? fill.left + fill.width : undefined, diamond !== null ? diamond - HIT_PAD : undefined, diamond !== null ? diamond + HIT_PAD : undefined, check ? check.x - HIT_PAD : undefined, check ? check.x + HIT_PAD : undefined].filter(
    (n): n is number => n !== undefined,
  );
  const left = Math.max(0, Math.min(...xs));
  const right = Math.min(axis.width, Math.max(...xs));
  return { left, width: Math.max(MIN_BAR, right - left), fill, diamond, check };
}

/* ------------------------------------------------------------------ pieces */

function OwnerAvatar({ owner, dir }: { owner: string | null; dir: Directory }) {
  const o = !owner || owner === 'unassigned' ? 'unassigned' : owner;
  if (o === 'together') {
    return (
      <span className="pbadge-pair" aria-hidden="true">
        {dir.adults.slice(0, 2).map((a) => (
          <PersonBadge key={a.id} person={a} size={20} />
        ))}
      </span>
    );
  }
  if (o === 'unassigned') {
    return (
      <span className="pbadge pbadge--none" style={{ width: 20, height: 20 }} aria-hidden="true">
        <Icon name="user" size={12} />
      </span>
    );
  }
  return <PersonBadge person={dir.personById(o)} size={20} />;
}

interface BarProps {
  g: GanttItem;
  axis: GanttAxis;
  label: string;
  selected: boolean;
  prereq: boolean;
  onToggle: (id: string) => void;
  register: (id: string, el: HTMLButtonElement | null) => void;
}

function GanttBar({ g, axis, label, selected, prereq, onToggle, register }: BarProps) {
  const geo = useMemo(() => geometry(g, axis), [g, axis]);
  const { fill, diamond, check } = geo;
  const glyph = STATUS_GLYPH[g.status];
  const cls = ['gbar', `gbar--${g.basis ?? 'mark'}`, `gbar--${g.tone}`, selected ? 'is-selected' : '', prereq ? 'is-prereq' : ''].filter(Boolean).join(' ');
  // A dotted leader joins a one-off check-in to its bar, but only when the check-in falls outside the bar.
  const tie =
    fill && check
      ? check.x < fill.left
        ? { from: check.x, to: fill.left }
        : check.x > fill.left + fill.width
          ? { from: fill.left + fill.width, to: check.x }
          : null
      : null;
  return (
    <button
      type="button"
      ref={(el) => register(g.id, el)}
      className={cls}
      style={{ left: geo.left, width: geo.width }}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={selected}
      data-gantt-bar=""
      data-basis={g.basis ?? 'check-in'}
      data-prereq={prereq ? '' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(g.id);
      }}
    >
      {tie && <span className="gbar__tie" data-leader="" style={{ left: tie.from - geo.left, width: tie.to - tie.from }} />}
      {fill && (
        <span className="gbar__fill" style={{ left: fill.left - geo.left, width: fill.width }}>
          {fill.off === 'before' || (!fill.off && fill.continuesBefore) ? (
            <Icon name="chevron-left" size={14} />
          ) : (
            glyph && !fill.off && <Icon name={glyph} size={14} />
          )}
          {(fill.off === 'after' || (!fill.off && fill.continuesAfter)) && <Icon name="chevron-right" size={14} className="gbar__more" />}
        </span>
      )}
      {diamond !== null && (
        <span className={`gbar__diamond${g.deadline?.kind === 'legal' ? ' gbar__diamond--legal' : ''}`} style={{ left: diamond - geo.left }}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" />
          </svg>
        </span>
      )}
      {check && <span className="gbar__check" data-check="" style={{ left: check.x - geo.left }} />}
    </button>
  );
}

/* ------------------------------------------------------------------ axis header */

interface MarkerLabel {
  key: string;
  x: number;
  text: string;
  hidden: string;
  kind: 'today' | 'anchor' | 'target' | 'checkin';
  /** The selection id of a shared check-in marker ("checkin:<date>"); the other labels are not interactive. */
  id?: string;
  lane: number;
  flip: boolean;
}

/** Labels for Today and each departure, stacked on lanes so near neighbours never overlap. */
function markerLabels(axis: GanttAxis, markers: DepartureMarker[], checkIns: SharedCheckIn[], today: string): { labels: MarkerLabel[]; lanes: number } {
  const entries: { key: string; date: string; text: string; kind: MarkerLabel['kind']; id?: string }[] = [
    { key: 'today', date: today, text: 'Today', kind: 'today' },
    ...markers.map((m) => ({ key: `${m.basis}-${m.date}`, date: m.date, text: m.label, kind: m.basis })),
    ...checkIns.map((c) => ({ key: `checkin-${c.date}`, date: c.date, text: c.label, kind: 'checkin' as const, id: `checkin:${c.date}` })),
  ];
  const raw = entries
    .map((r) => ({ ...r, ...clipDate(r.date, axis.range) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const laneEnds: number[] = [];
  const labels = raw.map((r): MarkerLabel => {
    const x = dayX(axis, r.date) + axis.pxPerDay / 2;
    const width = r.text.length * 6.6 + (r.kind === 'checkin' ? 36 : 30);
    const flip = x + width > axis.width;
    const from = flip ? x - width : x;
    let lane = laneEnds.findIndex((end) => end + 6 < from);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = flip ? x : from + width;
    return {
      key: r.key,
      x,
      text: r.text,
      hidden: r.kind === 'checkin' ? '' : `, ${civil(r.date, 'short')}${r.offRange ? (r.offRange === 'before' ? ' (before the chart starts)' : ' (after the chart ends)') : ''}`,
      kind: r.kind,
      id: r.id,
      lane,
      flip,
    };
  });
  return { labels, lanes: Math.max(1, laneEnds.length) };
}

/** Heights of the header rows, so the sticky axis can tell the scroll box how much room it takes. */
const HEAD_ROW = { years: 24, cols: 26, lane: 26, pad: 4 };

interface HeadProps {
  axis: GanttAxis;
  bands: ReturnType<typeof phaseBands>;
  bandLanes: number;
  labels: MarkerLabel[];
  lanes: number;
  selectedId: string | null;
  onToggle: (id: string) => void;
  register: (id: string, el: HTMLButtonElement | null) => void;
}

function ChartHead({ axis, bands, bandLanes, labels, lanes, selectedId, onToggle, register }: HeadProps) {
  const areaStyle = { width: axis.width };
  return (
    <div className="ghead">
      <div className="ghrow ghrow--years">
        <div className="ghrow__label" />
        <div className="ghrow__area" style={areaStyle}>
          {axis.years.map((y) => (
            <span key={y.label + y.x} className="gyear" style={{ left: y.x, width: y.w }}>
              <span className="gyear__text">{y.label}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="ghrow ghrow--cols">
        <div className="ghrow__label" />
        <div className="ghrow__area" style={areaStyle}>
          {axis.columns.map((c) => (
            <span key={c.start} className="gcol" style={{ left: c.x, width: c.w }}>
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <div className="ghrow ghrow--bands">
        <div className="ghrow__label">Phases</div>
        <div className="ghrow__area" style={{ ...areaStyle, height: bandLanes * HEAD_ROW.lane + HEAD_ROW.pad }}>
          {bands.map((b) => {
            const x0 = dayX(axis, b.start);
            const x1 = dayX(axis, addCalendarDays(b.end, 1));
            return (
              <span
                key={b.phase}
                className={`gband gband--${b.source}${b.continuesAfter ? ' gband--more' : ''}`}
                style={{ left: x0, width: Math.max(2, x1 - x0), top: b.lane * HEAD_ROW.lane + 2 }}
                title={b.title + (b.source === 'target' ? ' — placed by the planning target' : '')}
              >
                <span className="gband__text">{b.label}</span>
                {b.continuesAfter && <Icon name="chevron-right" size={12} />}
              </span>
            );
          })}
        </div>
      </div>
      <div className="ghrow ghrow--marks">
        <div className="ghrow__label">Key dates</div>
        <div className="ghrow__area" style={{ ...areaStyle, height: lanes * HEAD_ROW.lane + HEAD_ROW.pad }}>
          {labels.map((l) => {
            const pos = l.flip ? { right: axis.width - l.x, top: l.lane * HEAD_ROW.lane + 2 } : { left: l.x, top: l.lane * HEAD_ROW.lane + 2 };
            if (l.kind === 'checkin' && l.id) {
              const id = l.id;
              return (
                <button
                  key={l.key}
                  type="button"
                  ref={(el) => register(id, el)}
                  className={`gmark gmark--checkin${l.flip ? ' gmark--flip' : ''}${selectedId === id ? ' is-selected' : ''}`}
                  style={pos}
                  aria-haspopup="dialog"
                  aria-expanded={selectedId === id}
                  data-gantt-item=""
                  onClick={() => onToggle(id)}
                >
                  <span className="gcheck" aria-hidden="true" />
                  {l.text}
                </button>
              );
            }
            return (
              <span key={l.key} className={`gmark gmark--${l.kind}${l.flip ? ' gmark--flip' : ''}`} style={pos}>
                {l.kind !== 'today' && <Icon name="plane" size={13} />}
                {l.text}
                <span className="visually-hidden">{l.hidden}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChartLines({ axis, markers, checkIns, today }: { axis: GanttAxis; markers: DepartureMarker[]; checkIns: SharedCheckIn[]; today: string }) {
  const t = clipDate(today, axis.range);
  return (
    <div className="glines" aria-hidden="true" style={{ width: axis.width }}>
      {axis.columns.map((c, i) => (i === 0 ? null : <span key={c.start} className="gline" style={{ left: c.x }} />))}
      {markers.map((m) => (
        <span key={`${m.basis}-${m.date}`} className={`gline gline--dep gline--${m.basis}`} style={{ left: dayX(axis, clipDate(m.date, axis.range).date) + axis.pxPerDay / 2 }} />
      ))}
      {checkIns.map((c) => (
        <span key={`checkin-${c.date}`} className="gline gline--checkin" style={{ left: dayX(axis, clipDate(c.date, axis.range).date) + axis.pxPerDay / 2 }} />
      ))}
      <span className="gline gline--today" style={{ left: dayX(axis, t.date) + axis.pxPerDay / 2 }} />
    </div>
  );
}

function Legend() {
  return (
    <ul className="glegend" aria-label="How to read the chart">
      <li>
        <span className="gsw gsw--firm" aria-hidden="true" />
        Firm date
      </li>
      <li>
        <span className="gsw gsw--phase" aria-hidden="true" />
        Timing from its phase
      </li>
      <li>
        <span className="gsw gsw--target" aria-hidden="true" />
        Placed by the target
      </li>
      <li>
        <svg className="gsw-icon gsw-icon--diamond" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" />
        </svg>
        Deadline
      </li>
      <li>
        <span className="gsw gsw--check" aria-hidden="true" />
        Check-in (not a deadline)
      </li>
      <li>
        <span className="gsw gsw--today" aria-hidden="true" />
        Today
      </li>
    </ul>
  );
}

/* ------------------------------------------------------------------ detail popover */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ShellProps {
  /** Changes when the popover is about something else, so focus and position start again. */
  subject: string;
  title: string;
  anchor: HTMLElement | null;
  phone: boolean;
  /** The sheet's height on a phone (0 otherwise): the chart makes room for it so the last rows can still be scrolled above it. */
  pad: number;
  onSheetHeight: (height: number) => void;
  onClose: (restoreFocus: boolean) => void;
  children: ReactNode;
}

/**
 * A small non-modal popover beside its anchor (a bottom sheet on a phone). It takes focus when it opens; Escape or leaving
 * either end with Tab closes it and puts focus back on the anchor, so keyboard users are never trapped.
 */
function PopoverShell({ subject, title, anchor, phone, pad, onSheetHeight, onClose, children }: ShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight?: number } | null>(null);

  const place = useCallback(() => {
    const pop = ref.current;
    if (!pop || !anchor || phone) return;
    const a = anchor.getBoundingClientRect();
    const box = anchor.closest('.gantt__scroll')?.getBoundingClientRect();
    if (box && (a.bottom < box.top || a.top > box.bottom || a.right < box.left || a.left > box.right)) {
      onClose(false); // the anchor has been scrolled out of the chart, so there is nothing left to point at
      return;
    }
    const w = pop.offsetWidth;
    const natural = pop.scrollHeight + 2;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const edge = 12;
    const left = Math.min(Math.max(edge, a.left), Math.max(edge, vw - w - edge));
    const below = vh - a.bottom - gap - edge;
    const above = a.top - gap - edge;
    let top: number;
    let maxHeight: number | undefined;
    if (natural <= below) top = a.bottom + gap;
    else if (natural <= above) top = a.top - gap - natural;
    else if (below >= above) {
      top = a.bottom + gap;
      maxHeight = Math.max(180, below);
    } else {
      maxHeight = Math.max(180, above);
      top = a.top - gap - maxHeight;
    }
    top = Math.max(edge, top);
    setPos((p) => (p && p.top === top && p.left === left && p.maxHeight === maxHeight ? p : { top, left, maxHeight }));
  }, [anchor, phone, onClose]);

  useLayoutEffect(place, [place, subject]);
  useLayoutEffect(() => {
    if (!phone) return;
    onSheetHeight(ref.current?.offsetHeight ?? 0);
    return () => onSheetHeight(0);
  }, [phone, subject, onSheetHeight]);
  // On a phone the details are a sheet over the lower part of the screen: scroll so the anchor stays visible above it.
  useLayoutEffect(() => {
    const pop = ref.current;
    if (!phone || !anchor || !pop) return;
    const sheetTop = pop.getBoundingClientRect().top;
    const r = anchor.getBoundingClientRect();
    const appHeader = 72;
    if (r.bottom > sheetTop - 12 || r.top < appHeader) {
      const wanted = Math.max(appHeader + 8, Math.min(sheetTop - r.height - 24, window.innerHeight * 0.3));
      window.scrollBy({ top: r.top - wanted });
    }
  }, [phone, anchor, subject, pad]);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [subject]);
  useEffect(() => {
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const pop = ref.current;
    if (!pop) return;
    const els = Array.from(pop.querySelectorAll<HTMLElement>(FOCUSABLE));
    const active = document.activeElement;
    // No trap: leaving either end of the popover closes it and puts focus back on the anchor, so Tab carries on from there.
    if (!e.shiftKey && (els.length === 0 || active === els[els.length - 1])) {
      e.preventDefault();
      onClose(true);
    } else if (e.shiftKey && (active === pop || active === els[0])) {
      e.preventDefault();
      onClose(true);
    }
  };

  const style: CSSProperties | undefined = phone ? undefined : { top: pos?.top ?? 0, left: pos?.left ?? 0, maxHeight: pos?.maxHeight, opacity: pos ? 1 : 0 };

  return createPortal(
    <div
      ref={ref}
      className={`gpop${phone ? ' gpop--sheet' : ''}`}
      style={style}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // Following a link leaves the chart behind (on a wide screen the item opens beside it), so the details step aside.
      onClick={(e) => {
        if ((e.target as Element).closest('a')) onClose(false);
      }}
    >
      <div className="gpop__head">
        <p id={titleId} className="gpop__title">
          {title}
        </p>
        <button type="button" className="icon-btn" onClick={() => onClose(true)} aria-label="Close details">
          <Icon name="x" size={20} />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}

type PopoverBase = Omit<ShellProps, 'subject' | 'title' | 'children'>;

function ItemPopover({ g, idx, today, target, ...shell }: PopoverBase & { g: GanttItem; idx: Indexes; today: string; target: PlanningTarget | null }) {
  const m = g.item.m;
  return (
    <PopoverShell subject={g.id} title={m.title} {...shell}>
      <div className="gpop__meta">
        <OwnerChip owner={m.owner} proposed={m.owner_proposed} compact />
        <StatusBadge status={m.status} small />
      </div>
      <div className="gpop__timing">
        {g.basis === 'firm' && g.deadline ? (
          <p className="gpop__when">
            <DateText date={g.deadline.date} today={today} state={g.item.dateState ?? undefined} />
            <DeadlineBadge kind={g.deadline.kind} />
          </p>
        ) : g.basis === 'target' ? (
          <p className="small">
            <strong>No firm date.</strong> Drawn using the {target?.label ?? 'planning'} target, because a departure date is not set. Set travel dates to make it exact.
          </p>
        ) : g.basis === 'phase' ? (
          <p className="small">
            <strong>No firm date.</strong> Timing comes from its phase: {g.item.m.data?.phase ? PHASE_LABEL[g.item.m.data.phase] : 'not set'}.
          </p>
        ) : null}
        {g.checkIn && (
          <p className="gpop__when small">
            <DateText date={g.checkIn} today={today} />
            <DeadlineBadge kind="review_date" />
            <span className="faint">{g.sharedCheckIn ? 'Shared with other items. Not a deadline.' : 'Not a deadline.'}</span>
          </p>
        )}
      </div>
      <Chain itemKey={m.key} idx={idx} />
      <div className="gpop__foot">
        <RecordLink id={m.id} className="btn btn--secondary btn--sm">
          Open item
        </RecordLink>
      </div>
    </PopoverShell>
  );
}

/** The items that share one proposed check-in date, each linking to its own page. */
function CheckInPopover({ c, ...shell }: PopoverBase & { c: SharedCheckIn }) {
  const sorted = useMemo(() => [...c.items].sort((a, b) => a.title.localeCompare(b.title)), [c]);
  return (
    <PopoverShell subject={`checkin:${c.date}`} title={`Check-in · ${civil(c.date, 'short')}`} {...shell}>
      <div className="gpop__meta">
        <DeadlineBadge kind="review_date" />
        <span className="small faint">Proposed, not scheduled. Not a deadline.</span>
      </div>
      <p className="small muted">A moment to look at these {c.items.length} items together.</p>
      <ul className="gpop__list">
        {sorted.map((g) => (
          <li key={g.id}>
            <RecordLink id={g.id}>{g.title}</RecordLink>
          </li>
        ))}
      </ul>
    </PopoverShell>
  );
}

/* ------------------------------------------------------------------ the chart */

export interface GanttChartProps {
  items: PlanItemData[];
  idx: Indexes;
  dir: Directory;
  today: string;
  baselineOn: string | null;
  target: PlanningTarget | null;
}

export function GanttChart({ items, idx, dir, today, baselineOn, target }: GanttChartProps) {
  const phone = useMedia(PHONE_QUERY);
  const wide = useMedia(WIDE_QUERY);
  const [mode, setModeState] = useState<GanttRangeMode>(() => parseRangePref(loadPref(RANGE_PREF)));
  const [groupBy, setGroupByState] = useState<GroupMode>(() => parseGroupPref(loadPref(GROUP_PREF)));
  const setMode = useCallback((m: GanttRangeMode) => {
    setModeState(m);
    savePref(RANGE_PREF, m);
  }, []);
  const setGroupBy = useCallback((g: GroupMode) => {
    setGroupByState(g);
    savePref(GROUP_PREF, g);
  }, []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetPad, setSheetPad] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bars = useRef(new Map<string, HTMLButtonElement>());
  const arrowId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const departures = useMemo(() => departureAnchors(idx.anchors.map((a) => dataOf(a)), dir.people), [idx, dir]);
  const placed = useMemo(() => placeItems({ items, today, baselineOn, target, departures }), [items, today, baselineOn, target, departures]);
  const markers = useMemo(() => departureMarkers(departures, dir.people, target), [departures, dir, target]);
  const range = useMemo(() => chartRange(mode, { today, baselineOn, markerDates: markers.map((m) => m.date) }), [mode, today, baselineOn, markers]);
  const axis = useMemo(() => buildAxis(range, phone ? UNIT_PX.phone : UNIT_PX.wide), [range, phone]);
  const bands = useMemo(() => phaseBands({ today, baselineOn, departure: referenceDeparture(departures, target) }, range), [today, baselineOn, departures, target, range]);

  const checkIns = useMemo(() => sharedCheckIns(placed), [placed]);
  const checkInById = useMemo(() => new Map(checkIns.map((c) => [`checkin:${c.date}`, c])), [checkIns]);
  const { labels: markLabels, lanes: markLanes } = useMemo(() => markerLabels(axis, markers, checkIns, today), [axis, markers, checkIns, today]);
  const bandLanes = bands.reduce((n, b) => Math.max(n, b.lane + 1), 1);
  const headHeight = HEAD_ROW.years + HEAD_ROW.cols + bandLanes * HEAD_ROW.lane + HEAD_ROW.pad + markLanes * HEAD_ROW.lane + HEAD_ROW.pad + 1;

  const byId = useMemo(() => new Map(placed.map((g) => [g.id, g])), [placed]);
  const byKey = useMemo(() => new Map(placed.map((g) => [g.key, g])), [placed]);

  const groups = useMemo<ItemGroup<GanttItem>[]>(() => {
    const on = placed.filter((g) => g.placed);
    let gs: ItemGroup<GanttItem>[];
    if (groupBy === 'traveler') {
      gs = groupByTraveler(on, dir.people);
    } else {
      const sorted = sortPlanItems(
        on.map((g) => g.item),
        'date',
        (o) => dir.ownerLabel(o),
      );
      gs = groupPlan(sorted, idx).groups.map((g) => ({ key: g.key || 'other', title: g.title, items: g.items.map((i) => byId.get(i.m.id)!).filter(Boolean) }));
    }
    return gs.map((g) => ({ ...g, items: [...g.items].sort(compareSpan) })).filter((g) => g.items.length > 0);
  }, [placed, groupBy, dir, idx, byId]);
  const unplaced = useMemo(() => placed.filter((g) => !g.placed).sort((a, b) => a.title.localeCompare(b.title)), [placed]);

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const selectedCheckIn = selectedId ? (checkInById.get(selectedId) ?? null) : null;
  const ownerText = useCallback((g: GanttItem) => `${dir.ownerLabel(g.owner)}${g.ownerProposed && g.owner && g.owner !== 'unassigned' ? ' (not agreed yet)' : ''}`, [dir]);

  const register = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) bars.current.set(id, el);
    else bars.current.delete(id);
  }, []);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const close = useCallback((restoreFocus: boolean) => {
    const id = selectedRef.current;
    if (id && restoreFocus) bars.current.get(id)?.focus({ preventScroll: true });
    setSelectedId(null);
  }, []);
  const toggle = useCallback((id: string) => setSelectedId((cur) => (cur === id ? null : id)), []);

  // Escape closes the details and returns focus to the bar; a press outside the details and the rows just closes them.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.gpop, [data-gantt-item]')) return;
      close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [selectedId, close]);

  // A selected row that is no longer on screen (its group was folded, a filter changed) has nothing to point at.
  useLayoutEffect(() => {
    if (selectedId && !bars.current.has(selectedId)) setSelectedId(null);
  }, [selectedId, groups, collapsed, groupBy]);

  // Bring the chosen bar into view when it was chosen from its row label.
  useLayoutEffect(() => {
    const el = selectedId ? bars.current.get(selectedId) : undefined;
    if (!el || selectedId?.startsWith('checkin:')) return; // the Key dates row is always in view
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  // First paint and each change of range: today sits near the left edge of the timeline.
  const startKey = `${range.mode}|${range.start}|${phone}`;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const t = clipDate(today, range);
    el.scrollLeft = Math.max(0, dayX(axis, t.date) - 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey]);

  // Connector lines: from each unmet prerequisite's bar to the selected bar, for the selected item only.
  const prereqIds = useMemo(() => new Set((selected?.item.unmet ?? []).map((k) => byKey.get(k)?.id).filter((v): v is string => !!v)), [selected, byKey]);
  const [links, setLinks] = useState<{ key: string; d: string }[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selected || prereqIds.size === 0) {
      setLinks((l) => (l.length === 0 ? l : []));
      return;
    }
    const compute = () => {
      const c = canvas.getBoundingClientRect();
      const edge = (id: string, side: 'start' | 'end') => {
        const btn = bars.current.get(id);
        if (!btn) return null;
        const part = btn.querySelector<HTMLElement>('.gbar__fill') ?? btn.querySelector<HTMLElement>('.gbar__check') ?? btn;
        const r = part.getBoundingClientRect();
        return { x: (side === 'start' ? r.left : r.right) - c.left, y: r.top + r.height / 2 - c.top };
      };
      const to = edge(selected.id, 'start');
      const next: { key: string; d: string }[] = [];
      if (to) {
        for (const id of prereqIds) {
          const from = edge(id, 'end');
          if (!from) continue;
          const dx = Math.max(24, Math.abs(to.x - from.x) / 2);
          next.push({ key: id, d: `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}` });
        }
      }
      setLinks(next);
      setCanvasSize((s) => (s.w === c.width && s.h === c.height ? s : { w: c.width, h: c.height }));
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(compute);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [selected, prereqIds, groups, collapsed, axis]);

  // Where the main axis cannot stay in view (no scroll box), a small month axis is repeated at the top of a group.
  const axisRows = useMemo(
    () => compactAxisRows(groups.map((g) => (collapsed[`${groupBy}:${g.key}`] ? 0 : g.items.length)), groupBy === 'traveler' ? 0 : 8).map((show) => show && !wide),
    [groups, collapsed, groupBy, wide],
  );

  const canvasStyle = vars({ width: (phone ? 0 : 240) + axis.width, '--gw': `${axis.width}px` });
  const groupKey = (k: string) => `${groupBy}:${k}`;

  const renderRow = (g: GanttItem) => (
    <li key={g.id} className={`grow grow--${g.tone}${selectedId === g.id ? ' is-selected' : ''}`} data-gantt-item="" data-item-id={g.id} onClick={() => toggle(g.id)}>
      <div className="grow__label" aria-hidden="true">
        <OwnerAvatar owner={g.owner} dir={dir} />
        <span className="grow__title">{g.title}</span>
      </div>
      <div className="grow__area">
        <GanttBar g={g} axis={axis} label={barLabel(g, ownerText(g), target, range)} selected={selectedId === g.id} prereq={prereqIds.has(g.id)} onToggle={toggle} register={register} />
      </div>
    </li>
  );

  const total = placed.length;
  return (
    <div className="gantt">
      <div className="gantt__tools">
        <SegmentedControl
          label="Time range"
          value={mode}
          onChange={setMode}
          className="segmented--tool"
          options={[
            { value: 'day90', label: 'To day 90' },
            { value: 'three_years', label: 'Three years' },
          ]}
        />
        <SegmentedControl
          label="Group rows by"
          value={groupBy}
          onChange={setGroupBy}
          className="segmented--tool"
          options={[
            { value: 'area', label: 'By area' },
            { value: 'traveler', label: 'By traveler' },
          ]}
        />
      </div>
      <Legend />
      <div
        ref={scrollRef}
        className="gantt__scroll"
        style={vars({ '--gh': `${headHeight}px` })}
        role="region"
        aria-label={`Timeline chart, ${plural(total, 'item')}. Scroll sideways to move through time.`}
        tabIndex={0}
      >
        <div ref={canvasRef} className="gantt__canvas" style={canvasStyle}>
          <ChartHead axis={axis} bands={bands} bandLanes={bandLanes} labels={markLabels} lanes={markLanes} selectedId={selectedId} onToggle={toggle} register={register} />
          <ChartLines axis={axis} markers={markers} checkIns={checkIns} today={today} />
          {groups.map((grp, gi) => {
            const open = !collapsed[groupKey(grp.key)];
            const todo = grp.items.filter((g) => isOpenWork(g.status)).length;
            const blocked = grp.items.filter((g) => g.status === 'blocked').length;
            const span = groupSpan(grp.items);
            const clipped = span ? clipSpan(span.start, span.end, range) : null;
            const x0 = clipped ? dayX(axis, clipped.start) : 0;
            const x1 = clipped ? (clipped.offRange ? x0 : dayX(axis, addCalendarDays(clipped.end, 1))) : 0;
            const labelled = axisRows[gi];
            return (
              <section key={grp.key} className="ggroup">
                <h3 className="ggroup__head">
                  <button type="button" className="ggroup__toggle" aria-expanded={open} onClick={() => setCollapsed((c) => ({ ...c, [groupKey(grp.key)]: open }))}>
                    <Icon name="chevron-right" size={16} className="ggroup__chev" />
                    <span className="ggroup__title">{grp.title}</span>
                    <span className="ggroup__meta">{`${plural(grp.items.length, 'item')} · ${todo} to do${blocked ? ` · ${blocked} blocked` : ''}`}</span>
                  </button>
                  <span className={`ggroup__area${labelled ? ' ggroup__area--axis' : ''}`} aria-hidden="true">
                    {labelled &&
                      axis.columns.map((c, i) => (
                        <span key={c.start} className="ggroup__tick" style={{ left: c.x }}>
                          {c.label}
                          {i === 0 || c.start.slice(5, 7) === '01' ? ` ’${c.start.slice(2, 4)}` : ''}
                        </span>
                      ))}
                    {clipped && <span className="ggroup__span" style={{ left: x0, width: Math.max(6, x1 - x0) }} />}
                  </span>
                </h3>
                {open && <ul className="ggroup__rows">{grp.items.map(renderRow)}</ul>}
              </section>
            );
          })}
          {unplaced.length > 0 && (
            <section className="ggroup ggroup--unplaced">
              <h3 className="ggroup__head ggroup__head--static">
                <span className="ggroup__toggle">
                  <span className="ggroup__title">Not placed yet</span>
                  <span className="ggroup__meta">{plural(unplaced.length, 'item')}</span>
                </span>
                <span className="ggroup__area" aria-hidden="true" />
              </h3>
              <ul className="ggroup__rows">
                {unplaced.map((g) => (
                  <li key={g.id} className="grow grow--unplaced" data-gantt-item="" data-item-id={g.id}>
                    <div className="grow__label">
                      <OwnerAvatar owner={g.owner} dir={dir} />
                      <RecordLink id={g.id} className="grow__title">
                        {g.title}
                      </RecordLink>
                    </div>
                    <div className="grow__area">
                      <span className="grow__why">
                        {g.unplacedReason === 'needs_departure'
                          ? 'Waiting for a departure date or a planning target.'
                          : g.unplacedReason === 'only_check_in'
                            ? 'Only the shared check-in so far.'
                            : 'No phase or date yet.'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {links.length > 0 && (
            <svg className="glinks" data-links={links.length} width={canvasSize.w} height={canvasSize.h} aria-hidden="true" focusable="false">
              <defs>
                <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0.5 7.5 4 0 7.5z" className="glinks__arrow" />
                </marker>
              </defs>
              {links.map((l) => (
                <path key={l.key} d={l.d} className="glinks__path" markerEnd={`url(#${arrowId})`} />
              ))}
            </svg>
          )}
        </div>
      </div>
      {sheetPad > 0 && <div aria-hidden="true" style={{ height: sheetPad }} />}
      {selected && (
        <ItemPopover
          key={selected.id}
          g={selected}
          anchor={bars.current.get(selected.id) ?? null}
          phone={phone}
          idx={idx}
          today={today}
          target={target}
          pad={sheetPad}
          onSheetHeight={setSheetPad}
          onClose={close}
        />
      )}
      {selectedCheckIn && selectedId && (
        <CheckInPopover key={selectedId} c={selectedCheckIn} anchor={bars.current.get(selectedId) ?? null} phone={phone} pad={sheetPad} onSheetHeight={setSheetPad} onClose={close} />
      )}
    </div>
  );
}
