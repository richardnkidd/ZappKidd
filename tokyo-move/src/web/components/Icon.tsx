import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'home' | 'plan' | 'decide' | 'money' | 'more'
  | 'check' | 'alert' | 'clock' | 'hourglass' | 'stop' | 'x' | 'dash' | 'circle' | 'half'
  | 'chevron-right' | 'chevron-down' | 'chevron-left' | 'plus' | 'link' | 'lock' | 'info'
  | 'flag' | 'calendar' | 'target' | 'doc' | 'tilde' | 'eye' | 'undo' | 'pencil' | 'user'
  | 'logout' | 'refresh' | 'list' | 'board' | 'timeline' | 'rows' | 'file' | 'book' | 'plane'
  | 'sprout' | 'shield' | 'arrow-right' | 'bookmark' | 'sync' | 'contacts' | 'database' | 'gear' | 'compass';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3.5 11 12 3.5 20.5 11M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5" />,
  plan: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth={2.4} />,
  decide: <path d="M12 3.5v7M12 10.5 6 15.5M12 10.5l6 5M6 15.5v5M18 15.5v5M3.5 20.5h5M15.5 20.5h5" />,
  money: <path d="M3.5 8.5h14a3 3 0 0 1 3 3V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 8.5l11-4v4M15.5 14h2.5" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: <path d="M12 4 21 19.5H3zM12 10v4.5M12 17.2h.01" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  hourglass: <path d="M7 3.5h10M7 20.5h10M8 3.5v4l4 4.5-4 4.5v4M16 3.5v4L12 12l4 4.5v4" />,
  stop: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.7 5.7l12.6 12.6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  dash: <path d="M6 12h12" />,
  circle: <circle cx="12" cy="12" r="8" />,
  half: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  lock: <path d="M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3" />,
  info: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8h.01" />,
  flag: <path d="M5.5 21V4h11l-2 4 2 4h-11" />,
  calendar: <path d="M5 5.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1zM4 10h16M8.5 3.5v4M15.5 3.5v4" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  doc: <path d="M7 3.5h7.5L19 8v12a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20zM14.5 3.5V8H19M9.5 13h6M9.5 16.5h6" />,
  tilde: <path d="M4 9.5c2.7-3 5.3 3 8 0s5.3 3 8 0M4 15.5c2.7-3 5.3 3 8 0s5.3 3 8 0" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h9.5a6 6 0 0 1 0 12H11" />,
  pencil: <path d="M4 20h4L19.5 8.5l-4-4L4 16zM13 7l4 4" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.6-3.6 3.6-5.5 7.5-5.5s6.9 1.9 7.5 5.5" />,
  logout: <path d="M10 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H10M15 8l4 4-4 4M19 12H9.5" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.5l1.7-2M20 20v-4.5h-4.5" />,
  list: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  board: <path d="M4.5 5h4.5v14H4.5zM10 5h4.5v9H10zM15.5 5H20v11.5h-4.5z" />,
  timeline: <path d="M6 3.5v17M6 7h6M6 12h10M6 17h5" />,
  rows: <path d="M4.5 5.5h15v5h-15zM4.5 13.5h15v5h-15z" />,
  file: <path d="M7 3.5h7.5L19 8v12a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20z" />,
  book: <path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" />,
  plane: <path d="m3.5 13 17-8-4 15-4.5-5.5zM12 14.5 20.5 5" />,
  sprout: <path d="M12 20.5v-9M12 11.5c0-3.5-2.5-5.5-6.5-5.5 0 3.5 2.5 5.5 6.5 5.5zM12 14c0-3 2-5 6.5-5 0 3.2-2.3 5-6.5 5z" />,
  shield: <path d="M12 3.5 19 6v5.5c0 4.2-2.8 7.4-7 9-4.2-1.6-7-4.8-7-9V6z" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  bookmark: <path d="M7 4.5h10v16l-5-3.5-5 3.5z" />,
  sync: <path d="M4 12a8 8 0 0 1 13.5-5.8L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.5 5.8L4 15.5M4 20v-4.5h4.5" />,
  contacts: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.3 3-5 6.5-5s6 1.7 6.5 5M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 15.2c1.7.6 2.8 2 3 4.8" />,
  database: <path d="M12 9c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

/** Decorative icon (aria-hidden). Meaning is always carried by adjacent text. */
export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`icon${className ? ` ${className}` : ''}`}
      {...S}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Simple paw glyph for the dog (filled shapes, never colour alone). */
export function PawIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="currentColor" className={`icon${className ? ` ${className}` : ''}`}>
      <ellipse cx="5.8" cy="10.2" rx="2.1" ry="2.7" />
      <ellipse cx="10" cy="5.9" rx="2.1" ry="2.7" />
      <ellipse cx="15" cy="5.9" rx="2.1" ry="2.7" />
      <ellipse cx="19.2" cy="10.2" rx="2.1" ry="2.7" />
      <path d="M12.5 11.2c-3 0-6.4 3.7-6.4 6.5 0 2 1.7 2.7 3.4 2.4.9-.2 1.8-.5 3-.5s2.1.3 3 .5c1.7.3 3.4-.4 3.4-2.4 0-2.8-3.4-6.5-6.4-6.5z" />
    </svg>
  );
}
