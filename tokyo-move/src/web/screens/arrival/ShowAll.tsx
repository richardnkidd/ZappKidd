import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/Controls';

/**
 * A list that shows its first few rows and then "Show all (n)". Rows are passed as ready-made `<li>` elements.
 * Once opened it stays open. The button is 44px tall and says how many there are. When it opens, focus moves to the
 * first row that was not shown before, so a keyboard or screen-reader user is never left on a button that vanished.
 *
 * `all` and `onAll` make it controlled (a screen that keeps the choice itself); leave them out and it keeps its own.
 */
export function ShowAllList({
  rows,
  first = 3,
  className = 'item-list',
  label,
  all: allProp,
  onAll,
}: {
  rows: ReactNode[];
  first?: number;
  className?: string;
  label?: string;
  all?: boolean;
  onAll?: () => void;
}) {
  const [own, setOwn] = useState(false);
  const all = allProp ?? own;
  const listRef = useRef<HTMLUListElement>(null);
  const reveal = useRef(false);
  const shown = all ? rows : rows.slice(0, first);

  useEffect(() => {
    if (!all || !reveal.current) return;
    reveal.current = false;
    const li = listRef.current?.children[first];
    const target = li?.querySelector<HTMLElement>('a[href], button:not([disabled]), input, select, textarea') ?? null;
    if (target) target.focus();
    else if (li instanceof HTMLElement) {
      li.tabIndex = -1;
      li.focus();
    }
  }, [all, first]);

  return (
    <>
      <ul ref={listRef} className={className}>
        {shown}
      </ul>
      {rows.length > shown.length && (
        <div>
          <Button
            variant="quiet"
            className="show-all"
            onClick={() => {
              reveal.current = true;
              if (onAll) onAll();
              else setOwn(true);
            }}
          >
            Show all ({rows.length})
            {label && <span className="visually-hidden"> {label}</span>}
          </Button>
        </div>
      )}
    </>
  );
}
