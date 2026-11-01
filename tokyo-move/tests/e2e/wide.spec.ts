import type { Page } from '@playwright/test';
import { expect, loaded, test } from './support/fixtures';

/**
 * Large desktop monitors (1440px and wider): the content grows to use the screen, Home has three columns, and nothing
 * ever scrolls sideways at any common desktop width. Phones and tablets are covered by the other specs.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Sets its own large viewport, so it runs once (desktop).');
});

const ROUTES = [
  '/',
  '/plan?view=workstream',
  '/plan?view=list',
  '/plan?view=board',
  '/plan?view=timeline',
  '/decide',
  '/decide/questions',
  '/decide/risks',
  '/money',
  '/documents',
  '/contacts',
  '/arrival',
  '/ready/avery',
  '/settings',
  '/what-if',
  '/data',
];

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await loaded(page);
  await page.waitForLoadState('networkidle');
}

/** Left edge of a heading on the page, in CSS pixels. */
async function left(page: Page, name: string | RegExp, level = 2): Promise<number> {
  const box = await page.getByRole('heading', { level, name }).first().boundingBox();
  expect(box, `heading ${String(name)} is on screen`).not.toBeNull();
  return Math.round(box!.x);
}

test.describe('Large desktops', () => {
  test('Home has three columns at 1920px (this week | decisions and blocked | who is ready and coming up)', async ({ page, signIn }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(page, 'avery', '/');
    await open(page, '/');
    const thisWeek = await left(page, 'This week');
    const decisions = await left(page, /^Needs a decision/);
    const ready = await left(page, /^Who.s ready/);
    // Three distinct, increasing column edges...
    expect(decisions).toBeGreaterThan(thisWeek + 200);
    expect(ready).toBeGreaterThan(decisions + 200);
    // ...with the rest of each column under its first heading.
    expect(await left(page, /^Blocked/)).toBe(decisions);
    expect(await left(page, /^(Recent changes|Since your last review)/)).toBe(decisions); // named by whether a review has been saved yet
    expect(await left(page, 'Coming up')).toBe(ready);
    // The content uses the screen: the third column ends well past where the old 1100px page stopped.
    const last = await page.getByRole('heading', { level: 2, name: 'Coming up' }).evaluate((el) => (el.closest('section')?.getBoundingClientRect().right ?? 0));
    expect(last).toBeGreaterThan(1700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });

  test('Home keeps two columns from 1024px to 1439px', async ({ page, signIn }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'avery', '/');
    await open(page, '/');
    const decisions = await left(page, /^Needs a decision/);
    const ready = await left(page, /^Who.s ready/);
    const thisWeek = await left(page, 'This week');
    expect(decisions).toBe(thisWeek); // this week and decisions share the main column
    expect(ready).toBeGreaterThan(decisions + 300);
  });

  test('the board shows every status column side by side, and the timeline chart uses the whole box', async ({ page, signIn }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(page, 'avery', '/plan?view=board');
    await open(page, '/plan?view=board');
    const names = ['Planned', 'In progress', 'Blocked', 'Waiting on someone else', 'Done'];
    const boxes = [];
    for (const n of names) {
      const col = page.getByRole('region', { name: new RegExp(`^${n}`) }).first();
      const b = await col.boundingBox();
      expect(b, n).not.toBeNull();
      boxes.push(b!);
    }
    // One row: same top edge, strictly left to right, all inside the window.
    for (const b of boxes) expect(Math.abs(b.y - boxes[0]!.y)).toBeLessThan(4);
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x + boxes[i - 1]!.width - 2);
    expect(boxes[boxes.length - 1]!.x + boxes[boxes.length - 1]!.width).toBeLessThanOrEqual(1920);

    await open(page, '/plan?view=timeline');
    const chart = page.getByRole('region', { name: /timeline|chart|when things happen/i }).first();
    if (await chart.count()) {
      const scrolls = await chart.evaluate((el) => el.scrollWidth - el.clientWidth);
      // The months stretch to the box on a wide screen, so there is nothing to scroll sideways.
      expect(scrolls).toBeLessThanOrEqual(2);
    }
  });

  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    test(`no page scrolls sideways at ${width}px`, async ({ page, signIn }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await signIn(page, 'avery', '/');
      const wide: string[] = [];
      for (const path of ROUTES) {
        await open(page, path);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (over > 0) wide.push(`${path} (+${over}px)`);
      }
      expect(wide, 'pages wider than the window').toEqual([]);
    });
  }
});
