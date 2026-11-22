// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DateText, DeadlineBadge, StatusBadge, VerificationNote, YourTurnChip, OptionalTag } from '../../src/web/components/Badges';
import { More } from '../../src/web/components/More';
import { InfoNote } from '../../src/web/components/InfoNote';
import { ClampText } from '../../src/web/components/ClampText';
import { ItemCard } from '../../src/web/components/ItemCard';
import { MemoryRouter } from 'react-router';
import { setFormatToday } from '../../src/web/lib/format';
import { FilterChips, SegmentedControl, Field, TextInput } from '../../src/web/components/Controls';
import { Dialog } from '../../src/web/components/Dialog';
import { Disclosure } from '../../src/web/components/Disclosure';
import { ErrorBanner } from '../../src/web/components/Feedback';
import { EmptyState } from '../../src/web/components/Layout';
import { OwnerChip, PersonBadge, TogetherBadge } from '../../src/web/components/People';
import { PendingUpdateNotice } from '../../src/web/components/PendingUpdateNotice';
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
    // Quiet by default: plain text, no pill; "not agreed yet" only for the provisional owner.
    expect(text.match(/not agreed yet/g)).toHaveLength(1);
    expect(el.querySelectorAll('.chip')).toHaveLength(0);
    expect(el.querySelectorAll('.owner--proposed')).toHaveLength(1);
    // badges are decorative (name is in text)
    expect(el.querySelector('.pbadge')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the full chip is still there for a screen that asks for it', () => {
    const el = mount(withPeople(createElement('div', null, createElement(OwnerChip, { owner: 'bo', proposed: true, variant: 'chip' }), createElement(OwnerChip, { owner: 'ann', variant: 'chip' }))));
    expect(el.textContent).toContain('Bo? (not agreed yet)');
    expect(el.querySelectorAll('.chip--proposed')).toHaveLength(1);
    expect(el.querySelectorAll('.chip--owner')).toHaveLength(2);
  });

  it('monograms are at least 18px with 11px letters, and "together" is one glyph, never two overlapping circles', () => {
    const el = mount(withPeople(createElement('div', null, createElement(PersonBadge, { person: PEOPLE[0]!, size: 10 }), createElement(OwnerChip, { owner: 'together', compact: true }), createElement(TogetherBadge, {}))));
    const badges = [...el.querySelectorAll<HTMLElement>('.pbadge')];
    for (const b of badges) expect(parseInt(b.style.width, 10)).toBeGreaterThanOrEqual(18);
    expect(parseInt(badges[0]!.style.fontSize, 10)).toBeGreaterThanOrEqual(11);
    expect(el.querySelectorAll('.pbadge-pair')).toHaveLength(0);
    expect(el.querySelectorAll('.pbadge--together')).toHaveLength(2);
  });

  it('the dog badge is an svg paw, not a letter', () => {
    const el = mount(withPeople(createElement(PersonBadge, { person: PEOPLE[2]! })));
    expect(el.querySelector('.pbadge--pet svg')).not.toBeNull();
    expect(el.textContent).toBe('');
  });
});

describe('status and deadline badges carry words and icons', () => {
  it('shows status as a small icon with the words for screen readers, not a pill', () => {
    const el = mount(createElement('div', null, createElement(StatusBadge, { status: 'waiting_external', small: true }), createElement(StatusBadge, { status: 'completed', small: true }), createElement(StatusBadge, { status: 'eliminated', small: true })));
    expect(el.textContent).toBe('Waiting on someoneDoneDropped');
    expect(el.querySelectorAll('svg')).toHaveLength(3);
    expect(el.querySelectorAll('.chip')).toHaveLength(0);
    expect(el.querySelectorAll('.visually-hidden')).toHaveLength(3);
    expect(el.querySelector('.status-icon')?.getAttribute('title')).toBe('Waiting on someone');
  });
  it('the larger form prints the word as plain text beside the icon', () => {
    const el = mount(createElement(StatusBadge, { status: 'blocked' }));
    expect(el.querySelector('.status-icon__label')?.textContent).toBe('Stuck');
    expect(el.querySelector('.visually-hidden')).toBeNull();
    expect(el.querySelector('.chip')).toBeNull();
  });
  it('the full status chip is still available', () => {
    const el = mount(createElement(StatusBadge, { status: 'blocked', variant: 'chip' }));
    expect(el.querySelector('.chip--kaki')?.textContent).toBe('Stuck');
  });
  it('flags only legal and contract dates; a check-in keeps its word so it never reads as a deadline', () => {
    const kinds = ['legal', 'contractual', 'review_date', 'internal_target', 'user_committed', 'estimate'] as const;
    const el = mount(createElement('div', null, ...kinds.map((kind) => createElement(DeadlineBadge, { kind, key: kind }))));
    expect(el.textContent).toBe('Legal deadlineContract dateCheck-in');
    expect(el.querySelectorAll('.kind-flag')).toHaveLength(2);
    expect(el.querySelectorAll('.chip')).toHaveLength(0);
  });
  it('labels every deadline kind in the full chip form', () => {
    const el = mount(createElement('div', null, createElement(DeadlineBadge, { kind: 'legal', variant: 'chip' }), createElement(DeadlineBadge, { kind: 'review_date', variant: 'chip' }), createElement(DeadlineBadge, { kind: 'internal_target', variant: 'chip' })));
    expect(el.textContent).toBe('Legal deadlineCheck-inOur target');
  });
  it('"your turn" is one solid indigo chip', () => {
    const el = mount(createElement(YourTurnChip));
    expect(el.querySelector('.chip--turn')?.textContent).toBe('Your turn');
  });
  it('"Optional" is plain text', () => {
    const el = mount(createElement(OptionalTag));
    expect(el.querySelector('.chip')).toBeNull();
    expect(el.textContent).toBe('Optional');
  });
  it('marks any rule that is not verified from official text as "Not checked yet", with the full wording behind an info button', () => {
    const el = mount(createElement('div', null, createElement(VerificationNote, { verification: 'indexed_only', kind: 'legal' }), createElement(VerificationNote, { verification: 'verified_official' }), createElement(VerificationNote, { verification: 'not_verified' })));
    expect(el.querySelectorAll('.verify-note')).toHaveLength(2); // nothing for verified_official
    expect(el.querySelectorAll('.verify-note__text')).toHaveLength(2);
    const btn = el.querySelector<HTMLButtonElement>('button.info-btn')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const region = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(region.hidden).toBe(true);
    expect(region.textContent).toContain('Rule not yet confirmed for you. ');
    expect(region.textContent).toContain('official index only');
    act(() => btn.click());
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
  });
  it('the full verification sentence can still be printed in the page', () => {
    const el = mount(createElement(VerificationNote, { verification: 'not_verified', kind: 'legal', variant: 'full' }));
    expect(el.textContent).toContain('Rule not yet confirmed for you. Not verified — check before relying on it');
    expect(el.querySelector('button')).toBeNull();
  });
});

describe('the info control', () => {
  it('is a button with aria-expanded and aria-controls, opens on press, and Escape closes it', () => {
    const el = mount(<InfoNote label="About this date">Because of a holiday.</InfoNote>);
    const btn = el.querySelector<HTMLButtonElement>('button')!;
    expect(btn.getAttribute('aria-label')).toBe('About this date');
    const region = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(region.hidden).toBe(true);
    act(() => btn.click());
    expect(region.hidden).toBe(false);
    act(() => {
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the More disclosure', () => {
  it('defaults to "More", is a button with aria-expanded and aria-controls, and the label can change', () => {
    const el = mount(createElement('div', null, createElement(More, { children: createElement('p', null, 'Detail') }), createElement(More, { label: 'Why and history', children: 'History' })));
    const [a, b] = [...el.querySelectorAll<HTMLButtonElement>('button')];
    expect(a!.textContent).toBe('More');
    expect(b!.textContent).toBe('Why and history');
    const region = document.getElementById(a!.getAttribute('aria-controls')!)!;
    expect(a!.getAttribute('aria-expanded')).toBe('false');
    expect(region.hidden).toBe(true);
    act(() => a!.click());
    expect(a!.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    expect(region.textContent).toBe('Detail');
  });
});

describe('ClampText', () => {
  it('takes any line limit and element', () => {
    const el = mount(<ClampText lines={5} as="div">Long text</ClampText>);
    const box = el.querySelector<HTMLElement>('.clamp')!;
    expect(box.tagName).toBe('DIV');
    expect(box.style.getPropertyValue('--clamp-lines')).toBe('5');
    // jsdom has no layout, so nothing is cut and there is no toggle yet.
    expect(el.querySelector('button')).toBeNull();
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
  it('holiday and weekend advice sits behind an info button, not in a paragraph', () => {
    const el = mount(<DateText date="2026-11-07" prefix="Due by " advice="Falls on a public holiday. (The holiday calendar is computed; verify against the official calendar.)" today="2026-10-29" />);
    expect(el.querySelector('.date-note')).toBeNull();
    const btn = el.querySelector<HTMLButtonElement>('button.info-btn')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const region = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(region.hidden).toBe(true);
    expect(region.textContent).toContain('The holiday calendar is computed');
    act(() => btn.click());
    expect(region.hidden).toBe(false);
  });
});

describe('one date format', () => {
  const T = '2026-11-22';
  const text = (props: Partial<Parameters<typeof DateText>[0]> & { date: string | null }) => {
    const el = mount(<DateText today={T} {...props} />);
    const out = (el.querySelector('.date-text')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    act(() => root.unmount());
    container.remove();
    return out;
  };
  it('a future date reads "Mon, Nov 30 (8 days)"', () => {
    expect(text({ date: '2026-11-30' })).toBe('Mon, Nov 30 (8 days)');
    expect(text({ date: '2026-12-01', prefix: 'Due by ' })).toBe('Due by Tue, Dec 1 (9 days)');
  });
  /** What a sighted person reads: the text without the screen-reader-only parts. */
  const seen = (props: Partial<Parameters<typeof DateText>[0]> & { date: string | null }) => {
    const el = mount(<DateText today={T} {...props} />);
    const t = el.querySelector('.date-text')!.cloneNode(true) as HTMLElement;
    t.querySelectorAll('.visually-hidden').forEach((n) => n.remove());
    const out = (t.textContent ?? '').replace(/\s+/g, ' ').trim();
    act(() => root.unmount());
    container.remove();
    return out;
  };
  it('today and tomorrow are words, and the date is never printed twice', () => {
    expect(seen({ date: T })).toBe('Today');
    expect(seen({ date: '2026-11-23' })).toBe('Tomorrow');
    expect(seen({ date: T, prefix: 'Due by ' })).toBe('Due by today');
    expect(seen({ date: '2026-11-23', prefix: 'On ' })).toBe('Tomorrow');
    // Screen readers also hear the calendar date, once.
    expect(text({ date: T })).toBe('Today (Sun, Nov 22)');
  });
  it('the <time> element holds only the calendar date; the distance from today sits outside it', () => {
    for (const [date, state] of [['2026-11-30', undefined], [T, undefined], ['2026-11-23', undefined], ['2026-11-11', 'overdue']] as const) {
      const el = mount(<DateText date={date} today={T} state={state} />);
      const times = [...el.querySelectorAll('time')];
      expect(times).toHaveLength(1);
      expect(times[0]!.getAttribute('datetime')).toBe(date);
      expect(times[0]!.textContent).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
      act(() => root.unmount());
      container.remove();
    }
  });
  it('a past date on an open item reads "11 days late", in the late colour, with the date for screen readers only', () => {
    const el = mount(<DateText date="2026-11-11" state="overdue" today={T} />);
    const t = el.querySelector('.date-text')!;
    expect(t.classList.contains('date-text--past')).toBe(true);
    expect(t.textContent).toBe('11 days late (was Wed, Nov 11)');
    expect(t.querySelector('.visually-hidden')?.textContent).toBe(' (was Wed, Nov 11)');
    act(() => root.unmount());
    container.remove();
    expect(text({ date: '2026-11-21', state: 'overdue' })).toMatch(/^1 day late/);
  });
  it('a past date that is not an open due date stays a plain date', () => {
    expect(text({ date: '2026-11-11', state: 'met' })).toBe('Wed, Nov 11');
    expect(text({ date: '2026-11-11', prefix: 'Not before ', state: 'upcoming' })).toBe('Not before Wed, Nov 11');
  });
  it('without today there is no distance, and the long month form is never used', () => {
    setFormatToday('2026-11-22'); // the data provider sets this; it decides whether a year is needed
    const el = mount(<DateText date="2026-11-30" />);
    expect(el.textContent).toBe('Mon, Nov 30');
    expect(el.textContent).not.toMatch(/November/);
    setFormatToday(null);
  });
  it('a date with its own bracket ("window opens") does not get a second one', () => {
    expect(text({ date: '2026-12-10', prefix: 'Not before ', suffix: ' (window opens)' })).toBe('Not before Thu, Dec 10 (window opens)');
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

describe('the "newer update is waiting" notice', () => {
  const withSnapshot = (snapshot: unknown) => createElement(SnapshotContext.Provider, { value: { ...fakeSnapshot(), snapshot: snapshot as never } }, createElement(PendingUpdateNotice));
  it('shows one calm sentence when the server says something is waiting, and tells what to do', () => {
    const el = mount(withSnapshot({ pending_update: { changed: 3 } }));
    const note = el.querySelector('aside');
    expect(note).not.toBeNull();
    expect(note!.getAttribute('aria-label')).toBe('A newer update is waiting');
    expect(note!.textContent).toContain('A newer private update is in your Kadode folder. Close the Terminal window running Kadode, then start it again to load it.');
    // A count is all the server sends; the page never prints it, a file name or anything from the files.
    expect(note!.textContent).not.toMatch(/\b3\b|\.json/);
    expect(note!.getAttribute('role')).toBeNull(); // not a live region: a refresh of the page data must not announce it again
  });
  it('shows nothing when nothing is waiting (or in staging and production, where the server never sends it)', () => {
    expect(mount(withSnapshot({})).querySelector('aside')).toBeNull();
    act(() => root.unmount());
    expect(mount(withSnapshot({ pending_update: { changed: 0 } })).querySelector('aside')).toBeNull();
    act(() => root.unmount());
    expect(mount(withSnapshot(null)).querySelector('aside')).toBeNull();
  });
  it('renders nothing outside the snapshot provider (the sign-in screen)', () => {
    expect(mount(createElement(PendingUpdateNotice)).querySelector('aside')).toBeNull();
  });
});

describe('the slim list card', () => {
  const card = (props: Partial<Parameters<typeof ItemCard>[0]> = {}) =>
    mount(
      createElement(
        MemoryRouter,
        null,
        withPeople(createElement('ul', null, createElement(ItemCard, { recordId: 'milestone:a', title: 'Renew the visa', owner: 'ann', nextAction: 'Book the appointment', today: '2026-11-22', date: '2026-11-30', dateKind: 'legal', status: 'blocked', showStatus: true, ...props }))),
      ),
    );
  it('shows the title, the next step with no "Next" label, and one meta line with the date left and the person right', () => {
    const el = card();
    expect(el.querySelector('.item__title')?.textContent).toBe('Renew the visa');
    const action = el.querySelector('.item__action')!;
    expect(action.textContent).toBe('Book the appointment');
    expect(action.getAttribute('style')).toContain('--clamp-lines: 2');
    expect(el.querySelector('.item__label')).toBeNull();
    const meta = el.querySelector('.item__meta')!;
    expect(meta.firstElementChild?.classList.contains('item__meta-start')).toBe(true);
    expect(meta.lastElementChild?.classList.contains('owner')).toBe(true);
    expect(meta.querySelector('.item__meta-start')?.textContent).toContain('Mon, Nov 30 (8 days)');
  });
  it('is quiet by default: no chips at all, a flag for a legal date, status and owner as icon and plain text', () => {
    const el = card();
    expect(el.querySelectorAll('.chip')).toHaveLength(0);
    expect(el.querySelector('.kind-flag--legal')).not.toBeNull();
    expect(el.querySelector('.status-icon')?.textContent).toBe('Stuck');
    expect(el.querySelector('.owner__name')?.textContent).toBe('Ann');
    expect(el.textContent).not.toMatch(/not agreed yet/);
  });
  it("the household's own dates carry no flag, and \"not agreed yet\" shows only when true", () => {
    const el = card({ dateKind: 'internal_target', owner: 'bo', ownerProposed: true });
    expect(el.querySelector('.kind-flag')).toBeNull();
    expect(el.textContent).toContain('not agreed yet');
  });
  it('carries at most one chip: "your turn"', () => {
    const el = card({ turn: true });
    expect(el.querySelectorAll('.chip')).toHaveLength(1);
    expect(el.querySelector('.chip--turn')?.textContent).toBe('Your turn');
  });
  it('the full form brings the chips back', () => {
    const el = card({ variant: 'full', owner: 'bo' });
    expect(el.querySelector('.chip--owner')).not.toBeNull();
    expect(el.querySelector('.chip--kind-legal')).not.toBeNull();
    expect(el.querySelector('.chip--status')).not.toBeNull();
  });
});

describe('dialog focus when the opener is gone', () => {
  function Gone({ fallback }: { fallback?: string }) {
    const [open, setOpen] = useState(false);
    const [card, setCard] = useState(true);
    return (
      <div>
        <h1 id="page-h1">Decide</h1>
        <button id="other">Other</button>
        {card && (
          <button id="opener" onClick={() => setOpen(true)}>
            Open
          </button>
        )}
        <Dialog
          open={open}
          onClose={() => {
            setCard(false);
            setOpen(false);
          }}
          title="Answer"
          fallbackFocus={fallback}
        >
          <input type="text" aria-label="x" />
        </Dialog>
      </div>
    );
  }
  it('moves focus to the page heading when the card that opened the dialog left the list', () => {
    const el = mount(<Gone />);
    const opener = el.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    act(() => opener.click());
    const dlg = document.body.querySelector('[role=dialog]') as HTMLElement;
    act(() => {
      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(el.querySelector('#opener')).toBeNull();
    expect(document.activeElement?.id).toBe('page-h1');
  });
  it('accepts a selector for a different fallback', () => {
    const el = mount(<Gone fallback="#other" />);
    const opener = el.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    act(() => opener.click());
    const dlg = document.body.querySelector('[role=dialog]') as HTMLElement;
    act(() => {
      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.activeElement?.id).toBe('other');
  });
});
