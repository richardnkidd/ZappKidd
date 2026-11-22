import type { Locator, Page } from '@playwright/test';
import { expect, loaded, openAccount, openRecord, test } from './support/fixtures';

/** Everything a keyboard user needs: skip link, reachable navigation and actions, visible focus, dialogs that trap and return focus. */

interface Focused {
  tag: string;
  name: string;
  outlineStyle: string;
  outlineWidth: number;
  boxShadow: string;
  inViewport: boolean;
  insideDialog: boolean;
}

async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'BODY', name: '', outlineStyle: 'none', outlineWidth: 0, boxShadow: 'none', inViewport: false, insideDialog: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const label = el.getAttribute('aria-label') || (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      tag: el.tagName,
      name: label.slice(0, 80),
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth) || 0,
      boxShadow: cs.boxShadow,
      inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth,
      insideDialog: Boolean(el.closest('[role="dialog"]')),
    };
  });
}

const hasVisibleFocusRing = (f: Focused) => (f.outlineStyle !== 'none' && f.outlineWidth >= 2) || (f.boxShadow !== 'none' && f.boxShadow !== '');

/** Press Tab until `done` says the focused element is the one we want; returns everything that was focused on the way. */
async function tabUntil(page: Page, done: (f: Focused) => boolean, max = 60): Promise<Focused[]> {
  const seen: Focused[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    seen.push(f);
    if (done(f)) return seen;
  }
  throw new Error(`Never reached the target with Tab. Focus visited: ${seen.map((s) => s.name || s.tag).join(' > ')}`);
}

/** Put keyboard focus on an element the way a keyboard user gets there (so :focus-visible applies). */
async function keyboardFocus(page: Page, target: Locator) {
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

test.describe('Keyboard', () => {
  test('the skip link is the first stop, is visible when focused, and jumps to the main content', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan');
    await loaded(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    const f = await focused(page);
    expect(f.inViewport, 'the skip link is on screen when it has focus').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    // The next Tab lands inside the page content, not back in the navigation.
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => Boolean(document.activeElement?.closest('main')));
    expect(next).toBe(true);
  });

  test('Tab reaches the main navigation and each destination shows a visible focus ring', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    const names = ['Home', 'Plan', 'Decide', 'Money', 'More'];
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const name of names) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();

    const visited: Focused[] = [];
    for (const name of names) {
      const seen = await tabUntil(page, (f) => f.tag === 'A' && f.name === name, 40);
      const last = seen[seen.length - 1]!;
      visited.push(last);
      expect(hasVisibleFocusRing(last), `${name}: focus is visible (outline ${last.outlineStyle} ${last.outlineWidth}px)`).toBe(true);
      expect(last.inViewport, `${name} is on screen when focused`).toBe(true);
    }
    // Enter on the focused destination navigates, and focus moves to the new page's heading.
    await keyboardFocus(page, nav.getByRole('link', { name: 'Plan', exact: true }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/plan/);
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeFocused();
  });

  test('primary actions are reachable by Tab, show focus, and work with Enter or Space', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);

    // The view switcher: Tab to "Board", press Space, it is pressed.
    const board = page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Board' });
    const seen = await tabUntil(page, (f) => f.tag === 'BUTTON' && f.name === 'Board', 60);
    expect(hasVisibleFocusRing(seen[seen.length - 1]!)).toBe(true);
    await page.keyboard.press('Space');
    await expect(board).toHaveAttribute('aria-pressed', 'true');

    // A record's main action.
    await openRecord(page, 'milestone:W06', /Verify both passports/);
    const change = page.getByRole('button', { name: 'Change status' });
    const trail = await tabUntil(page, (f) => f.tag === 'BUTTON' && f.name.includes('Change status'), 60);
    const atChange = trail[trail.length - 1]!;
    expect(hasVisibleFocusRing(atChange), `outline ${atChange.outlineStyle} ${atChange.outlineWidth}px`).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Change status' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(change).toBeFocused();
  });

  const dialogs: { name: string; open: (page: Page) => Promise<{ opener: Locator; dialog: Locator }> }[] = [
    {
      name: 'the account dialog',
      open: async (page) => {
        await page.goto('/');
        await loaded(page);
        const opener = page.getByRole('button', { name: /^Avery\b.*Account and display time zone/ });
        await keyboardFocus(page, opener);
        await page.keyboard.press('Enter');
        return { opener, dialog: page.getByRole('dialog', { name: 'You' }) };
      },
    },
    {
      name: 'the change-status dialog',
      open: async (page) => {
        await openRecord(page, 'milestone:W06', /Verify both passports/);
        const opener = page.getByRole('button', { name: 'Change status' });
        await keyboardFocus(page, opener);
        await page.keyboard.press('Enter');
        return { opener, dialog: page.getByRole('dialog', { name: 'Change status' }) };
      },
    },
    {
      name: 'the propose-an-action dialog',
      open: async (page) => {
        await openRecord(page, 'milestone:W06', /Verify both passports/);
        const opener = page.getByRole('button', { name: 'Propose an action' });
        await keyboardFocus(page, opener);
        await page.keyboard.press('Space');
        return { opener, dialog: page.getByRole('dialog', { name: 'Propose an action for your task list' }) };
      },
    },
  ];

  for (const d of dialogs) {
    test(`${d.name} traps focus and Escape closes it and returns focus`, async ({ page, signIn }) => {
      await signIn(page, 'avery', '/');
      const { opener, dialog } = await d.open(page);
      await expect(dialog).toBeVisible();
      // The rest of the app is inert while a dialog is open, so it can neither be tabbed to nor read.
      await expect(page.locator('#root')).toHaveAttribute('inert', '');
      expect((await focused(page)).insideDialog, 'focus starts inside the dialog').toBe(true);

      // Tab forward and back many more times than there are controls: focus never leaves the dialog.
      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press('Tab');
        expect((await focused(page)).insideDialog, `Tab #${i + 1} stays in the dialog`).toBe(true);
      }
      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press('Shift+Tab');
        expect((await focused(page)).insideDialog, `Shift+Tab #${i + 1} stays in the dialog`).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('#root')).not.toHaveAttribute('inert', /.*/);
      await expect(opener).toBeFocused();
    });
  }

  test('the dialog Close button also returns focus to where the person was', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    const dialog = await openAccount(page, 'Avery');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Avery\b.*Account and display time zone/ })).toBeFocused();
  });

  test('on wide screens a record opens in a side panel; Escape closes it and focus returns to the link', async ({ page, signIn }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'The side panel only exists on wide screens.');
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const link = page.getByRole('main').getByRole('link', { name: 'Verify both passports and renewal outcomes', exact: true }).first();
    await link.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Item details' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Verify both passports and renewal outcomes' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/plan/);
    await expect(link).toBeFocused();
  });
});
