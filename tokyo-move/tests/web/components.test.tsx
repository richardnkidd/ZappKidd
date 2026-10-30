// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DateText, DeadlineBadge, StatusBadge, VerificationNote } from '../../src/web/components/Badges';
import { FilterChips, SegmentedControl, Field, TextInput } from '../../src/web/components/Controls';
import { Dialog } from '../../src/web/components/Dialog';
import { Disclosure } from '../../src/web/components/Disclosure';
import { ErrorBanner } from '../../src/web/components/Feedback';
import { EmptyState } from '../../src/web/components/Layout';
import { OwnerChip, PersonBadge } from '../../src/web/components/People';
import { SnapshotContext, type SnapshotCtx } from '../../src/web/state/snapshot';
import { buildDirectory, buildIndexes } from '../../src/web/lib/records';
import { applyTheme } from '../../src/web/state/prefs';
import { PEOPLE } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(node: ReactElement) {
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  document.body.className = '';
});
beforeAll(() => {
  // jsdom has no layout: treat everything as visible for the focus trap.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; } });
});

const fakeSnapshot = (): SnapshotCtx =>
  ({
    snapshot: null,
    idx: buildIndexes([], []),
    dir: buildDirectory(PEOPLE, 'ann'),
    status: 'ready',
    loadedAt: new Date(),
    error: null,
    refresh: async () => undefined,
    save: { kind: 'idle' },
    setDirty: () => undefined,
    dirtyCount: 0,
    actions: {} as never,
  }) as SnapshotCtx;

const withPeople = (node: ReactElement) => createElement(SnapshotContext.Provider, { value: fakeSnapshot() }, node);

describe('people are never shown by colour alone', () => {
  it('adults show an initial plus their name; the dog gets a paw glyph and the name', () => {
    const el = mount(
      withPeople(
        createElement('div', null, createElement(OwnerChip, { owner: 'ann' }), createElement(OwnerChip, { owner: 'pip' as never }), createElement(OwnerChip, { owner: 'together' }), createElement(OwnerChip, { owner: null }), createElement(OwnerChip, { owner: 'bo', proposed: true })),
      ),
    );
    const text = el.textContent ?? '';
    expect(text).toContain('Ann');
    expect(text).toContain('Pip');
    expect(text).toContain('Together');
    expect(text).toContain('Unassigned');
    expect(text).toContain('Bo? (not agreed yet)');
    expect(el.querySelectorAll('.chip--proposed')).toHaveLength(1);
    // badges are decorative (name is in text)
    expect(el.querySelector('.pbadge')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the dog badge is an svg paw, not a letter', () => {
    const el = mount(withPeople(createElement(PersonBadge, { person: PEOPLE[2]! })));
    expect(el.querySelector('.pbadge--pet svg')).not.toBeNull();
    expect(el.textContent).toBe('');
  });
});

describe('status and deadline badges carry words and icons', () => {
  it('shows plain status words with an icon', () => {
    const el = mount(createElement('div', null, createElement(StatusBadge, { status: 'waiting_external' }), createElement(StatusBadge, { status: 'completed' }), createElement(StatusBadge, { status: 'eliminated' })));
    expect(el.textContent).toBe('Waiting on someone elseDoneDropped');
    expect(el.querySelectorAll('svg')).toHaveLength(3);
  });
  it('labels deadline kinds so a review checkpoint never reads as a deadline', () => {
    const el = mount(createElement('div', null, createElement(DeadlineBadge, { kind: 'legal' }), createElement(DeadlineBadge, { kind: 'review_date' }), createElement(DeadlineBadge, { kind: 'internal_target' })));
    expect(el.textContent).toBe('Legal deadlineCheck-inOur target');
  });
  it('shows an honest note for any rule that is not verified from official text', () => {
    const el = mount(createElement('div', null, createElement(VerificationNote, { verification: 'indexed_only', kind: 'legal' }), createElement(VerificationNote, { verification: 'verified_official' }), createElement(VerificationNote, { verification: 'not_verified' })));
    expect(el.textContent).toContain('official index only');
    expect(el.textContent).toContain('Not verified');
    expect(el.querySelectorAll('.verify-note')).toHaveLength(2); // nothing for verified_official
  });
});

describe('controls', () => {
  it('filter chips are a labelled group of toggle buttons', () => {
    const onChange = vi.fn();
    const el = mount(
      createElement(FilterChips, {
        label: 'Show items for',
        value: 'mine',
        options: [
          { value: 'all', label: 'Everything' },
          { value: 'mine', label: 'Mine' },
        ],
        onChange,
      }),
    );
    expect(el.querySelector('[role=group]')?.getAttribute('aria-label')).toBe('Show items for');
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    act(() => buttons[0]!.click());
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('segmented control switches views', () => {
    const onChange = vi.fn();
    const el = mount(
      <SegmentedControl label="Plan view" value="list" options={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} onChange={onChange} />,
    );
    act(() => (el.querySelectorAll('button')[1] as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith('board');
  });

  it('every field has a label tied to its input, plus hint and error wiring', () => {
    const el = mount(
      <Field label="Title" hint="Short" error="Required">
        <TextInput />
      </Field>,
    );
    const input = el.querySelector('input')!;
    const label = el.querySelector('label')!;
    expect(label.getAttribute('for')).toBe(input.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((input.getAttribute('aria-describedby') ?? '').split(' ')).toHaveLength(2);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Required');
  });

  it('disclosure is a native details/summary', () => {
    const el = mount(<Disclosure title="Source & history">inside</Disclosure>);
    const d = el.querySelector('details')!;
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')?.textContent).toContain('Source & history');
  });

  it('error banner is announced and offers a retry', () => {
    const retry = vi.fn();
    const el = mount(
      <ErrorBanner title="Could not load" onRetry={retry}>
        Nothing was lost.
      </ErrorBanner>,
    );
    expect(el.querySelector('[role=alert]')).not.toBeNull();
    act(() => (el.querySelector('button') as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalled();
  });

  it('empty state gives a sentence and a next step', () => {
    const el = mount(
      <EmptyState title="Nothing here" action={<a href="#x">Go</a>}>
        Try again later.
      </EmptyState>,
    );
    expect(el.textContent).toContain('Nothing here');
    expect(el.textContent).toContain('Try again later.');
    expect(el.querySelector('a')).not.toBeNull();
  });
});

describe('dialog', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button id="opener" onClick={() => setOpen(true)}>
          open
        </button>
        <Dialog
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          title="Change status"
          footer={<button id="last">Save</button>}
        >
          <input id="first" type="text" aria-label="reason" />
        </Dialog>
      </div>
    );
  }

  it('is a labelled modal that moves focus in, traps Tab, closes on Escape and returns focus', () => {
    const onClose = vi.fn();
    const el = mount(createElement(Harness, { onClose }));
    const opener = el.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    act(() => opener.click());

    const dlg = document.body.querySelector('[role=dialog]') as HTMLElement;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const titleId = dlg.getAttribute('aria-labelledby')!;
    expect(document.getElementById(titleId)?.textContent).toBe('Change status');
    expect(document.activeElement?.id).toBe('first'); // the first text field is focused
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true); // the page behind is inert

    // Tab from the last control wraps to the first (focus trap)
    const last = dlg.querySelector<HTMLElement>('#last')!;
    last.focus();
    act(() => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.id).not.toBe('last');

    act(() => {
      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    expect(document.body.querySelector('[role=dialog]')).toBeNull();
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement?.id).toBe('opener'); // focus returns to what opened it
  });
});


describe('dates are honest about what they are', () => {
  it('an old date from a copy or an old record is neutral and says it proves nothing', () => {
    const el = mount(<DateText date="2026-08-15" state="historical" today="2026-10-29" />);
    expect(el.textContent).toContain('Aug 15, 2026');
    expect(el.textContent).toContain('Date has passed · check whether it’s done');
    expect(el.textContent).not.toMatch(/past its date|ago/i);
    expect(el.querySelector('.date-text--old')).not.toBeNull();
    expect(el.querySelector('.date-text--past')).toBeNull();
  });
  it('shows the engine’s business-day advice exactly as given, and nothing of its own', () => {
    const withAdvice = mount(<DateText date="2026-11-07" prefix="Due by " advice="Falls on a weekend — aim for Fri, Nov 6." today="2026-10-29" />);
    expect(withAdvice.textContent).toContain('Due by Sat, Nov 7');
    expect(withAdvice.textContent).toContain('Falls on a weekend — aim for Fri, Nov 6.');
    act(() => root.unmount());
    container.remove();
    const none = mount(<DateText date="2026-11-07" kind="legal" today="2026-10-29" />);
    expect(none.textContent).not.toContain('weekend');
  });
  it('a window shows both ends and a not-before date says the window opens', () => {
    const win = mount(<DateText date="2027-08-21" endDate="2027-08-31" prefix="Exam window: " today="2026-10-29" />);
    expect(win.querySelectorAll('time')).toHaveLength(2);
    expect(win.textContent).toContain('Exam window: Sat, Aug 21, 2027 – Tue, Aug 31, 2027');
  });
  it('unknown stays unknown', () => {
    expect(mount(<DateText date={null} />).textContent).toBe('Awaiting date');
  });
});

describe('phone filter chips and theme', () => {
  it('chips can sit in their own sideways-scrolling box', () => {
    const el = mount(<FilterChips label="Show" value="a" scroll options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={() => undefined} />);
    expect(el.querySelector('.chips-scroll .filter-chips--scroll')).not.toBeNull();
    expect(el.querySelectorAll('button')).toHaveLength(2);
  });
  it('a chosen theme is a data-theme on <html>; "like my device" removes it', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
