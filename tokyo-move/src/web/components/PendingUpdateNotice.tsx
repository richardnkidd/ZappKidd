import { Icon } from './Icon';
import { Card } from './Layout';
import { useOptionalSnapshot } from '../state/snapshot';

/**
 * One calm banner for local installs: a newer private update has been unpacked into the Kadode folder, but the data is only
 * read when Kadode starts, so what is on screen is still the old data. The server sends a count and nothing else, and only in
 * local modes; with nothing waiting this renders nothing.
 */
export function PendingUpdateNotice() {
  const waiting = useOptionalSnapshot()?.snapshot?.pending_update?.changed ?? 0;
  if (waiting <= 0) return null;
  return (
    <Card as="aside" tone="inset" className="pending-update" aria-label="A newer update is waiting">
      <p>
        <Icon name="info" size={16} /> A newer private update is in your Kadode folder. Close the Terminal window running Kadode, then start it again to load it.
      </p>
    </Card>
  );
}
