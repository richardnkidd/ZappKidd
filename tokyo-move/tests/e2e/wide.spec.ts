import type { Page } from '@playwright/test';
import { expect, loaded, test } from './support/fixtures';

/**
 * Large desktop monitors (1440px and wider): the content grows to use the screen, Home keeps its two columns, and nothing
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
  /** Home's two columns: "Your turn" and "Stuck" on the left; "Travellers" and the since line on the right. */
  async function expectTwoColumns(page: Page, gap: number) {
    const turn = await left(page, /^Your turn/);
    const stuck = await left(page, /^Stuck/);
    const travellers = await left(page, 'Travellers');
    expect(stuck, 'Stuck sits under Your turn').toBe(turn);
    expect(travellers, 'Travellers is in its own column on the right').toBeGreaterThan(turn + gap);
    // Never a third column: every section heading starts at one of the two edges.
    const edges = await page.getByRole('main').getByRole('heading', { level: 2 }).evaluateAll((hs) => hs.map((h) => Math.round(h.getBoundingClientRect().x)));
    for (const x of edges) expect([turn, travellers], `a heading at ${x}px`).toContain(x);
    const since = page.getByRole('region', { name: 'Since you last looked' });
    if (await since.count()) expect(Math.round((await since.boundingBox())!.x)).toBe(travellers);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }

  test('Home is two columns at 1920px too: there is no three-column version', async ({ page, signIn }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(page, 'avery', '/');
    await open(page, '/');
    await expectTwoColumns(page, 300);
  });

  test('Home is two columns from 1024px', async ({ page, signIn }) => {
    for (const width of [1024, 1280, 1439]) {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page, 'avery', '/');
      await open(page, '/');
      await expectTwoColumns(page, 250);
    }
    // Below 1024px Home is one column.
    await page.setViewportSize({ width: 1000, height: 800 });
    await open(page, '/');
    expect(await left(page, 'Travellers')).toBe(await left(page, /^Your turn/));
  });

  test('the board shows every status column side by side, and the timeline chart uses the whole box', async ({ page, signIn }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(page, 'avery', '/plan?view=board');
    await open(page, '/plan?view=board');
    const names = ['Not started', 'Doing', 'Stuck', 'Waiting on someone', 'Done'];
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

  test('a record page and its side panel keep prose to a readable line, with no stretched column', async ({ page, signIn }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(page, 'avery', '/r/milestone:W06');
    await open(page, '/r/milestone:W06');
    const page_ = await page.locator('.rec').first().boundingBox();
    expect(page_!.width).toBeLessThanOrEqual(760);
    // The next step and its Edit control are side by side, near the left edge of the text.
    const text = await page.locator('.rec-next__text').boundingBox();
    const edit = await page.getByRole('button', { name: 'Edit next action' }).boundingBox();
    expect(edit!.x - (text!.x + text!.width)).toBeLessThan(80);
    expect(Math.abs(edit!.y + edit!.height / 2 - (text!.y + text!.height / 2))).toBeLessThan(40);

    await open(page, '/plan?view=list');
    await page.getByRole('main').getByRole('link', { name: 'Verify both passports and renewal outcomes', exact: true }).first().click();
    const panel = page.getByRole('complementary', { name: 'Item details' });
    await expect(panel.getByRole('heading', { name: 'Verify both passports and renewal outcomes' })).toBeVisible();
    const rec = await panel.locator('.rec').boundingBox();
    const bar = await panel.boundingBox();
    expect(rec!.width).toBeLessThanOrEqual(bar!.width);
    expect(rec!.width).toBeLessThanOrEqual(760);
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
