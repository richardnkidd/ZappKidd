import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767.98px)';

/** True on a phone-width screen, where the board's columns stack one under the other. Updates when the window changes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(QUERY).matches : false),
    () => false,
  );
}
