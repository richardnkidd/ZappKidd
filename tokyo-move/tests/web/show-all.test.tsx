// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ShowAllList } from '../../src/web/screens/arrival/ShowAll';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function mount(n: number, first: number, extra: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const rows = Array.from({ length: n }, (_, i) => createElement('li', { key: i }, createElement('a', { href: `#r${i}` }, `Row ${i}`)));
  act(() => root.render(createElement(ShowAllList, { rows, first, label: 'in a group', ...extra })));
  return host;
}

describe('ShowAllList', () => {
  it('shows the first rows and "Show all (N)", and says what it is for to a screen reader', () => {
    const el = mount(8, 3);
    expect(el.querySelectorAll('li')).toHaveLength(3);
    const button = el.querySelector('button')!;
    expect(button.textContent).toBe('Show all (8) in a group');
    expect(button.querySelector('.visually-hidden')?.textContent).toBe(' in a group');
  });

  it('opens the rest, takes the button away, and moves focus to the first new row', () => {
    const el = mount(8, 3);
    act(() => el.querySelector('button')!.click());
    expect(el.querySelectorAll('li')).toHaveLength(8);
    expect(el.querySelector('button')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Row 3');
  });

  it('has no button when everything already fits', () => {
    expect(mount(3, 3).querySelector('button')).toBeNull();
  });

  it('can be controlled by the screen that owns the choice', () => {
    let all = false;
    const el = mount(7, 5, {
      all,
      onAll: () => {
        all = true;
      },
    });
    act(() => el.querySelector('button')!.click());
    expect(all).toBe(true);
  });
});
