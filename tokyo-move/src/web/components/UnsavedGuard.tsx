import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { Button } from './Controls';
import { Dialog } from './Dialog';
import { useSnapshot } from '../state/snapshot';

/**
 * Stops a page change (a link, the back button) while a form holds unsaved text, and asks. Closing the tab or reloading
 * gets the browser's own prompt. Needs a data router; mount it once, inside the app shell.
 */
export function UnsavedGuard() {
  const { dirtyCount } = useSnapshot();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyCount > 0 && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyCount]);

  // If the unsaved text goes away while the question is open (it was saved), let the person go on.
  useEffect(() => {
    if (blocker.state === 'blocked' && dirtyCount === 0) blocker.proceed();
  }, [blocker, dirtyCount]);

  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      title="You have changes that aren’t saved"
      description="If you leave this page now, what you typed is lost."
      footer={
        <>
          <Button variant="primary" onClick={() => blocker.reset?.()}>
            Keep editing
          </Button>
          <Button variant="quiet" onClick={() => blocker.proceed?.()}>
            Discard and leave
          </Button>
        </>
      }
    >
      <p className="muted">You can go back, finish, and press Save. Nothing is saved until you do.</p>
    </Dialog>
  );
}
