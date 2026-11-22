import type { Locator } from '@playwright/test';
import { addDays, expect, loaded, test, todayInZone } from './support/fixtures';

// Home's heading is one small line (the person's name for screen readers, then the date and season).
const MAIN: { name: string; url: RegExp; h1: string | RegExp }[] = [
  { name: 'Home', url: /\/$/, h1: /^Avery’s home, \w{3}, \w{3} \d{1,2} · /u },
  { name: 'Plan', url: /\/plan/, h1: 'Plan' },
  { name: 'Decide', url: /\/decide/, h1: 'Decide' },
  { name: 'Money', url: /\/money/, h1: 'Money' },
  { name: 'More', url: /\/more/, h1: 'More' },
];

/** A main tab by its label. The Decide tab may carry a count ("Decide, 2 need you") or a dot ("Decide, some need you later"). */
const tab = (nav: Locator, name: string) => nav.getByRole('link', { name: new RegExp(`^${name}(, \\d+ needs? you|, some need you later)?$`) });

/**
 * The Decide badge, worked out independently of the app. "Mine": open or suggested, I must approve, and I have not,
 * or we disagree. The number counts those needed within 14 days (or late), or that my partner already answered.
 */
function expectedBadge(records: any[], me: string, today: string): { count: number; mine: number } {
  const mine = records.filter((r) => {
    if (r.type !== 'decision' || !['open', 'proposed'].includes(r.status) || r.data?.recorded_decision) return false;
    const approvers: string[] = r.data?.required_approvers ?? [];
    if (!approvers.includes(me)) return false;
    const approvals = (r.data?.approvals ?? []).filter((a: any) => approvers.includes(a.person_id));
    const own = approvals.find((a: any) => a.person_id === me);
    if (!own) return true;
    return approvals.some((a: any) => a.person_id !== me && a.option_id !== own.option_id);
  });
  const soon = addDays(today, 14);
  const urgent = mine.filter((r) => {
    const partner = (r.data?.approvals ?? []).some((a: any) => a.person_id !== me && (r.data?.required_approvers ?? []).includes(a.person_id));
    const date: string | null = r.data?.needed_by?.date ?? null;
    return partner || (!!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= soon);
  });
  return { count: urgent.length, mine: mine.length };
}

test.describe('Navigation', () => {
  test('the five main destinations work, say where you are, and sit where the layout promises', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    const viewport = page.viewportSize()!;
    const box = (await nav.boundingBox())!;
    if (viewport.width < 768) {
      // Phones: a tab bar along the bottom edge, the full width of the screen.
      expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 2);
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
    } else if (viewport.width >= 1024) {
      // Wide screens: a rail down the left side.
      expect(box.x).toBeLessThan(40);
      expect(box.width).toBeLessThan(viewport.width / 3);
      expect(box.height).toBeGreaterThan(viewport.height * 0.8);
    }

    for (const dest of MAIN) {
      await tab(nav, dest.name).click();
      await expect(page).toHaveURL(dest.url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(dest.h1);
      await expect(tab(nav, dest.name)).toHaveAttribute('aria-current', 'page');
      for (const other of MAIN.filter((m) => m.name !== dest.name)) {
        await expect(tab(nav, other.name)).not.toHaveAttribute('aria-current', 'page');
      }
      await loaded(page);
    }
  });

  test('the Decide tab counts the decisions that need you soon, for each adult, with a dot when none are urgent', async ({ page, signIn, api }) => {
    for (const who of ['avery', 'jun'] as const) {
      const snap = await (await api(who)).snapshot();
      const records = snap.records as any[];
      const today = todayInZone(snap.me.household.display_timezone);
      const { count: n, mine } = expectedBadge(records, who, today);
      await signIn(page, who, '/');
      await loaded(page);
      const nav = page.getByRole('navigation', { name: 'Main' });
      const decide = tab(nav, 'Decide');
      // The five tabs, in their order.
      const items = nav.locator('.app-nav__list > li');
      await expect(items).toHaveCount(5);
      for (const [i, name] of ['Home', 'Plan', 'Decide', 'Money', 'More'].entries()) {
        await expect(items.nth(i).getByRole('link')).toHaveAccessibleName(new RegExp(`^${name}(,|$)`));
      }
      if (n > 0) {
        await expect(decide).toHaveAccessibleName(`Decide, ${n} ${n === 1 ? 'needs' : 'need'} you`);
        await expect(decide.locator('.nav-badge')).toHaveText(String(n));
        // Home's "Your turn" shows decisions too (never more than three).
        const rows = page.getByRole('region', { name: /^Your turn/ }).getByRole('listitem').filter({ has: page.locator('a[href^="/decide"]') });
        await expect(rows.first()).toBeVisible();
        expect(await rows.count()).toBeLessThanOrEqual(Math.min(mine, 3));
      } else if (mine > 0) {
        // Nothing urgent, but some decisions are still this person's turn: a dot, with words for screen readers.
        await expect(decide).toHaveAccessibleName('Decide, some need you later');
        await expect(decide.locator('.nav-badge--dot')).toHaveCount(1);
        await expect(decide.locator('.nav-badge')).toHaveText('');
      } else {
        await expect(decide).toHaveAccessibleName('Decide');
        await expect(decide.locator('.nav-badge')).toHaveCount(0);
      }
      // The Decisions tab on the Decide screen says the same as the navigation.
      await decide.click();
      await loaded(page);
      const words = n > 0 ? `, ${n} ${n === 1 ? 'needs' : 'need'} you` : mine > 0 ? ', some need you later' : '';
      await expect(page.getByRole('navigation', { name: 'Decide sections' }).getByRole('link', { name: /^Decisions/ })).toHaveAccessibleName(`Decisions${words}`);
      await page.context().clearCookies();
    }
  });

  test('"More" leads to every other screen', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/more');
    await loaded(page);
    // "Future work" joins the list once the plan has loaded (the demo has optional future work).
    const links = page.getByRole('main').getByRole('list').first().getByRole('link');
    await expect(links.filter({ hasText: 'Future work' })).toHaveCount(1);
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(6);
    const seen: string[] = [];
    for (let i = 0; i < count; i += 1) {
      await page.goto('/more');
      await loaded(page);
      // "Future work" joins the list once the plan has loaded, so wait for the full list before picking by position.
      await expect(page.getByRole('main').getByRole('list').first().getByRole('link')).toHaveCount(count);
      const link = page.getByRole('main').getByRole('list').first().getByRole('link').nth(i);
      const label = ((await link.innerText()).split('\n')[0] ?? '').trim();
      await link.click();
      await expect(page).not.toHaveURL(/\/more$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('More');
      const h1 = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
      expect(h1.length).toBeGreaterThan(2);
      await expect(page.getByRole('heading', { level: 1, name: /couldn.t find that page/i }), `${label} is a real screen`).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More', exact: true })).toHaveAttribute('aria-current', 'page');
      seen.push(h1);
    }
    expect(new Set(seen).size, seen.join(" | ")).toBe(count);
  });

  test('on phones the bottom bar never hides the end of a page', async ({ page, signIn }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 768, 'The bottom bar only exists on phones.');
    for (const path of ['/', '/plan?view=list', '/decide', '/money']) {
      await signIn(page, 'avery', path);
      await loaded(page);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const result = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Main"]') as HTMLElement;
        const main = document.querySelector('main') as HTMLElement;
        // Visible, real-sized things only (visually-hidden helper text is parked off to the side and is not content).
        // Anything inside a collapsed "details" box is not on screen either.
        const items = Array.from(main.querySelectorAll('p, li, a, button, h2, h3, td, th, time')).filter((el) => {
          const r = el.getBoundingClientRect();
          const collapsed = el.closest('details:not([open])') && !el.closest('summary');
          return r.width > 4 && r.height > 4 && !collapsed;
        });
        const bottoms = items.map((el) => el.getBoundingClientRect().bottom);
        return { navTop: nav.getBoundingClientRect().top, lowest: Math.max(...bottoms), viewport: window.innerHeight };
      });
      expect(result.lowest, `${path}: the last thing on the page is above the tab bar`).toBeLessThanOrEqual(result.navTop + 1);
    }
  });

  test('Back and Forward behave, and a record keeps you where you came from', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Plan', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    // Switching the plan view replaces the address (it does not add a history step), so Back goes to the page before.
    await page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Board' }).click();
    await expect(page).toHaveURL(/view=board/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Avery');
    await page.goForward();
    await expect(page).toHaveURL(/view=board/);
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');

    // Opening a record and going Back returns to the same plan view.
    await page.getByRole('main').getByRole('link', { name: 'Verify both passports and renewal outcomes', exact: true }).first().click();
    await expect(page).toHaveURL(/\/r\/milestone%3AW06/);
    await page.goBack();
    await expect(page).toHaveURL(/view=board/);
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
  });

  test('a signed-out visitor to a deep link is asked to sign in, then lands on that page', async ({ page }) => {
    await page.goto('/plan?view=board');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await page.getByRole('button', { name: 'Jun', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('an unknown address says so kindly and leads home', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/definitely-not-a-page');
    await expect(page.getByRole('heading', { level: 1, name: /couldn.t find that page/i })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Avery');
    // A record that does not exist (or is someone else's private note) is explained, not a blank page.
    await page.goto('/r/milestone%3AW999');
    await expect(page.getByText(/couldn.t find that item/i)).toBeVisible();
  });

  test('the traveler readiness page opens from Home and lists what is holding things up', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    // Wide screens show a card with "See everything for Jun"; phones show a compact tappable row. Both go to the same page.
    const link = page.getByRole('main').locator('a[href="/ready/jun"]').first();
    await link.click();
    await expect(page).toHaveURL(/\/ready\/jun/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Jun');
    await expect(page.getByRole('heading', { level: 1, name: /couldn.t find that page/i })).toHaveCount(0);
    expect(await page.getByRole('main').getByRole('link').count()).toBeGreaterThan(2);
    expect(await page.getByRole('main').innerText()).not.toContain('%');
  });
});
