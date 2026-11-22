import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Controls';

/**
 * A list that shows its first few rows and then "Show all (n)". Rows are passed as ready-made `<li>` elements.
 * Once opened it stays open. The button is 44px tall and says how many there are.
 */
export function ShowAllList({ rows, first = 3, className = 'item-list', label }: { rows: ReactNode[]; first?: number; className?: string; label?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, first);
  return (
    <>
      <ul className={className}>{shown}</ul>
      {rows.length > shown.length && (
        <div>
          <Button variant="quiet" className="show-all" onClick={() => setAll(true)}>
            Show all ({rows.length})
            {label && <span className="visually-hidden"> {label}</span>}
          </Button>
        </div>
      )}
    </>
  );
}
