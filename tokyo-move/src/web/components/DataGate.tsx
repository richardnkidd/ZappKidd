import type { ReactNode } from 'react';
import type { Snapshot } from '@shared/types';
import type { Directory, Indexes } from '../lib/records';
import { describeError } from '../api/client';
import { useSnapshot } from '../state/snapshot';
import { ErrorBanner } from './Feedback';
import { SkeletonCards } from './Layout';

export interface Loaded {
  snapshot: Snapshot;
  idx: Indexes;
  dir: Directory;
}

/** Renders children once the snapshot exists; skeletons while loading; an error with Retry if it never loaded. */
export function DataGate({ children, skeleton }: { children: (loaded: Loaded) => ReactNode; skeleton?: ReactNode }) {
  const { snapshot, idx, dir, status, error, refresh } = useSnapshot();
  if (snapshot && idx && dir) return <>{children({ snapshot, idx, dir })}</>;
  if (status === 'error') {
    return (
      <ErrorBanner title="We couldn't load your plan." onRetry={() => void refresh()}>
        {error ? describeError(error) : 'Something went wrong.'} Nothing has been lost.
      </ErrorBanner>
    );
  }
  return <>{skeleton ?? <SkeletonCards count={3} />}</>;
}
