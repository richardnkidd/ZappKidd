import type { Locator, Page } from '@playwright/test';
import { baseUrlFor } from './support/env';
import { expect, loaded, test, type Api } from './support/fixtures';

/**
 * The Plan's Timeline: a Gantt chart (bars on a month axis) with a table as the accessible alternative.
 * Everything is found by role, label and visible text. The demo household (Avery, Jun and Mochi) has Avery's and
 * Mochi's departure dates set, Jun's not set, and a "July 2027" planning target.
 */

async function openTimeline(page: Page) {
  await page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: /^Timeline chart/ })).toBeVisible();
}

function chart(page: Page): Locator {
  return page.getByRole('region', { name: /^Timeline chart/ });
}
const bar = (page: Page, title: string | RegExp): Locator => chart(page).getByRole('button', { name: typeof title === 'string' ? new RegExp(`^${title}, owner`) : title });

/** The page itself must never scroll sideways, whatever the chart is doing inside its own box. */
async function expectNoPageScroll(page: Page, where: string) {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(w.scroll, `${where}: the page is ${w.scroll}px wide in a ${w.client}px window`).toBeLessThanOrEqual(w.client + 1);
}

test.describe('Timeline chart', () => {
  test('draws a bar for every plan item, and says in words how each one is known', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/plan');
    await loaded(page);
    await openTimeline(page);

    // One bar for each item the plan shows (optional future work is hidden by default).
    const snap = await (await api('avery')).snapshot();
    const expected = (snap.records as any[]).filter((r) => r.type === 'milestone' && !r.data.optional_future_work).length;
    expect(expected).toBeGreaterThan(20);
    await expect(chart(page).locator('[data-gantt-bar]')).toHaveCount(expected);

    // Every bar has a full accessible name: title, owner, status, and how its timing is known.
    const names = await chart(page).locator('[data-gantt-bar]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    for (const n of names) expect(n, n).toMatch(/, owner .+, .+, (ends .+\(.+\)|timing from its phase \(.+\), no firm date|placed using the .+ target; set travel dates to make it exact|check-in on .+not a deadline)/);

    // A real date: solid ("firm"), ending where the date is, with the kind of date in words.
    const firm = bar(page, 'Verify both passports and renewal outcomes');
    await expect(firm).toHaveAttribute('data-basis', 'firm');
    await expect(firm).toHaveAccessibleName(/ends Nov 11, 2026 \(we committed\)/);

    // No date: timing comes from its phase, and says so.
    const phase = bar(page, 'Choose a housing shortlist');
    await expect(phase).toHaveAttribute('data-basis', 'phase');
    await expect(phase).toHaveAccessibleName(/owner Avery, planned, timing from its phase \(Jan–Mar 2027\), no firm date/);

    // Hangs on a departure date that is not set: drawn using the planning target, and says so.
    const target = bar(page, 'Release Jun to travel');
    await expect(target).toHaveAttribute('data-basis', 'target');
    await expect(target).toHaveAccessibleName(/placed using the July 2027 target; set travel dates to make it exact/);
    // The same kind of work for Avery, whose departure date IS set, is not drawn as "by the target".
    await expect(bar(page, 'Release Avery to travel')).toHaveAttribute('data-basis', 'phase');

    // A check-in is a marker, never a deadline.
    await expect(bar(page, 'Collect mover quotes')).toHaveAccessibleName(/check-in on Nov 11, 2026, not a deadline/);

    // Blocked and finished work say so in words as well as in the look of the bar.
    await expect(bar(page, "Establish Jun's nonworking residence route")).toHaveAccessibleName(/, blocked, /);
    await expect(bar(page, 'Confirm target month and three-year scope')).toHaveAccessibleName(/, done, /);
  });

  test('shows the key, Today, the departure markers, and where each phase sits', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const key = page.getByRole('list', { name: 'How to read the chart' });
    for (const word of ['Firm date', 'Timing from its phase', 'Placed by the target', 'Deadline', 'Check-in (not a deadline)', 'Today']) await expect(key).toContainText(word);

    const region = chart(page);
    // Today, labelled, and near the left edge of the part of the chart that can be seen.
    const today = region.getByText(/^Today/);
    await expect(today).toBeVisible();
    const box = (await region.boundingBox())!;
    const t = (await today.boundingBox())!;
    expect(t.x, 'Today is inside the visible chart').toBeGreaterThanOrEqual(box.x);
    expect(t.x + t.width).toBeLessThanOrEqual(box.x + box.width + 1);

    // Departures: a set date is a plain marker; Jun's missing one says it falls back to the target.
    await expect(region.getByText('Avery departs')).toBeAttached();
    await expect(region.getByText('Mochi departs')).toBeAttached();
    await expect(region.getByText('Jun: not set — July 2027 target')).toBeAttached();

    // The phase strip uses the short phase names.
    for (const label of ['Nov–Dec 2026', 'Jan–Mar 2027', 'Final weeks']) await expect(region.getByText(label, { exact: true }).first()).toBeAttached();

    // The year and month axis.
    await expect(region.getByText('2027', { exact: true }).first()).toBeAttached();
    await expect(region.getByText('Jan', { exact: true }).first()).toBeAttached();
  });

  test('the chart scrolls inside its own box, and the page never scrolls sideways', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const region = chart(page);
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region).toHaveAccessibleName(/Scroll sideways/);
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth), 'the chart is wider than its box').toBe(true);
    await expectNoPageScroll(page, 'chart');

    await expect(region.getByRole('heading', { name: /^Avery/ })).toBeVisible();
    await expect(region.getByRole('heading', { name: /^Shared/ })).toBeVisible();

    await page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: 'Three years' }).click();
    await page.getByRole('group', { name: 'Group rows by' }).getByRole('button', { name: 'By area' }).click();
    await expect(region.getByText('Q4', { exact: true }).first()).toBeAttached();
    await expect(region.getByRole('heading', { name: /^Mochi: import, transport and care/ })).toBeVisible();
    await expectNoPageScroll(page, 'three years, by area (many small groups)');

    // Scrolling the chart sideways moves the chart, not the page.
    await region.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await expectNoPageScroll(page, 'chart scrolled to its end');
  });

  test('a bar opens its details from the keyboard; Escape closes them and focus returns to the bar', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const b = bar(page, 'Confirm airline and crate feasibility');
    await b.scrollIntoViewIfNeeded();
    await b.focus();
    await expect(b).toBeFocused();
    await expect(b).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');

    const details = page.getByRole('dialog', { name: 'Confirm airline and crate feasibility' });
    await expect(details).toBeVisible();
    await expect(b).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toBeFocused();
    await expect(details.getByText('Avery', { exact: true })).toBeVisible();
    await expect(details.getByText('Planned', { exact: true })).toBeVisible();
    await expect(details.getByText(/No firm date/)).toBeVisible();
    await expect(details.getByText('Waits on')).toBeVisible();
    await expect(details.getByRole('link', { name: "Reconcile Mochi's identity, health and history" })).toBeVisible();
    await expect(details.getByRole('link', { name: 'Open item' })).toBeVisible();

    // What it waits on is outlined, with a line from each to this bar; nothing else is.
    await expect(chart(page).locator('[data-prereq]')).toHaveCount(2);
    await expect(chart(page).locator('svg[data-links="2"]')).toHaveCount(1);
    await expectNoPageScroll(page, 'details open');

    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(b).toBeFocused();
    await expect(b).toHaveAttribute('aria-expanded', 'false');
    await expect(chart(page).locator('[data-prereq]')).toHaveCount(0);
    await expect(chart(page).locator('svg[data-links]')).toHaveCount(0);

    // Tabbing out of the details closes them and carries on from the bar.
    await page.keyboard.press('Enter');
    await expect(details).toBeVisible();
    for (let i = 0; i < 6 && (await details.count()) > 0; i += 1) await page.keyboard.press('Tab');
    await expect(details).toHaveCount(0);
  });

  test('a check-in that many items share is one marker in Key dates, not a circle and a leader on every row', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const region = chart(page);
    const marker = region.getByRole('button', { name: 'Check-in · Nov 11, 2026 · 4 items · not scheduled' });
    await expect(marker).toBeVisible();
    // No row carries a check-in circle or a dotted leader for it...
    await expect(region.locator('[data-check]')).toHaveCount(0);
    await expect(region.locator('[data-leader]')).toHaveCount(0);
    // ...but nothing is lost for a screen reader: each bar's name still says so, and that it is not a deadline.
    await expect(bar(page, 'Collect mover quotes')).toHaveAccessibleName(/household check-in on Nov 11, 2026, not a deadline/);
    await expect(bar(page, "Establish Avery's residence route")).toHaveAccessibleName(/household check-in on Nov 11, 2026, not a deadline/);
    // The bars themselves are untouched.
    await expect(bar(page, 'Collect mover quotes')).toHaveAttribute('data-basis', 'phase');

    // Keyboard: Enter lists the items, each linking to its own page; Escape closes and focus returns to the marker.
    await marker.focus();
    await page.keyboard.press('Enter');
    const list = page.getByRole('dialog', { name: 'Check-in · Nov 11, 2026' });
    await expect(list).toBeVisible();
    await expect(marker).toHaveAttribute('aria-expanded', 'true');
    await expect(list.getByText(/Not a deadline/)).toBeVisible();
    await expect(list.getByRole('link')).toHaveText(['Clarify Avery\'s employer support', 'Collect mover quotes', 'Confirm target month and three-year scope', "Establish Avery's residence route"]);
    await expectNoPageScroll(page, 'check-in list open');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(marker).toBeFocused();

    // A link in the list opens that item.
    await marker.click();
    await list.getByRole('link', { name: 'Collect mover quotes' }).click();
    await expect(page).toHaveURL(/\/r\/milestone%3AW22/);
    await expect(page.getByRole('dialog', { name: 'Check-in · Nov 11, 2026' })).toHaveCount(0);
  });

  test('a check-in that only one or two items have keeps its own circle on the row', async ({ page, signIn }) => {
    // Filtered to Avery's own work, only two items still have that review date.
    await signIn(page, 'avery', '/plan?view=timeline&traveler=avery');
    await loaded(page);
    const region = chart(page);
    await expect(region.getByRole('button', { name: /^Check-in ·/ })).toHaveCount(0);
    await expect(region.locator('[data-check]')).toHaveCount(2);
    await expect(bar(page, "Establish Avery's residence route")).toHaveAccessibleName(/; check-in on Nov 11, 2026, not a deadline/);
    await expect(bar(page, "Establish Avery's residence route")).not.toHaveAccessibleName(/household check-in/);
    await expectNoPageScroll(page, 'one-off check-ins');
  });

  test('"Open item" goes to the item, and a bar with a check-in explains that it is not a deadline', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const b = bar(page, 'Collect mover quotes');
    await b.scrollIntoViewIfNeeded();
    await b.click();
    const details = page.getByRole('dialog', { name: 'Collect mover quotes' });
    await expect(details).toBeVisible();
    await expect(details.getByText(/Not a deadline/)).toBeVisible();
    await expect(details.getByText('Check-in', { exact: true })).toBeVisible();
    await expect(details.getByText(/No firm date/)).toBeVisible();
    // Clicking the same bar again closes the details.
    await b.click();
    await expect(details).toHaveCount(0);

    await b.click();
    await details.getByRole('link', { name: 'Open item' }).click();
    await expect(page).toHaveURL(/\/r\/milestone%3A/);
    await expect(page.getByRole('dialog', { name: 'Collect mover quotes' })).toHaveCount(0);
  });

  test('a firm bar names its date in the details, with the kind of date', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const b = bar(page, 'Verify both passports and renewal outcomes');
    await b.scrollIntoViewIfNeeded();
    await b.click();
    const details = page.getByRole('dialog', { name: 'Verify both passports and renewal outcomes' });
    await expect(details.locator('time[datetime="2026-11-11"]')).toBeVisible();
    await expect(details.getByText('We committed', { exact: true })).toBeVisible();
    await expect(details.getByText(/No firm date/)).toHaveCount(0);
  });

  test('a group can be folded, and its bars leave the chart', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const group = chart(page).getByRole('button', { name: /^Mochi / });
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(group).toContainText(/6 items · 6 to do · 1 blocked/);
    const bars = await chart(page).locator('[data-gantt-bar]').count();
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(chart(page).locator('[data-gantt-bar]')).toHaveCount(bars - 6);
    await group.click();
    await expect(chart(page).locator('[data-gantt-bar]')).toHaveCount(bars);
  });

  test('rows are grouped by traveler first (each person, then Shared), and the grouping and range are remembered', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const grouping = page.getByRole('group', { name: 'Group rows by' });
    const range = page.getByRole('group', { name: 'Time range' });
    await expect(grouping.getByRole('button', { name: 'By traveler' })).toHaveAttribute('aria-pressed', 'true');
    await expect(range.getByRole('button', { name: 'To day 90' })).toHaveAttribute('aria-pressed', 'true');

    const titles = await chart(page).getByRole('heading').evaluateAll((hs) => hs.map((h) => (h.textContent ?? '').replace(/\d+ items?.*$/, '').trim()));
    expect(titles).toEqual(['Avery', 'Jun', 'Mochi', 'Shared']);

    await grouping.getByRole('button', { name: 'By area' }).click();
    await range.getByRole('button', { name: 'Three years' }).click();
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Group rows by' }).getByRole('button', { name: 'By area' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: 'Three years' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chart(page).getByRole('heading', { name: /^Mochi: import, transport and care/ })).toBeVisible();
  });

  test('on a wide screen the chart is its own scroll box with a sticky axis and labels; on a phone the page scrolls and each group has a small axis', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const region = chart(page);
    const viewport = page.viewportSize()!;
    const wide = viewport.width >= 900;
    if (wide) {
      const box = (await region.boundingBox())!;
      expect(box.height, 'the box is no taller than 78% of the window').toBeLessThanOrEqual(viewport.height * 0.78 + 2);
      expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight), 'there is more to scroll to inside the box').toBe(true);
      // The axis (here its "Phases" label) stays at the top of the box while the rows scroll under it.
      const phases = region.getByText('Phases', { exact: true });
      const top0 = (await phases.boundingBox())!.y - box.y;
      await region.evaluate((el) => {
        el.scrollTop = 420;
      });
      await expect.poll(async () => (await phases.boundingBox())!.y - box.y).toBeCloseTo(top0, 0);
      // The label column stays at the left while the timeline scrolls sideways.
      const jun = region.getByRole('heading', { name: /^Jun/ }).getByRole('button');
      const x0 = (await jun.boundingBox())!.x;
      await region.evaluate((el) => {
        el.scrollLeft = 300;
      });
      await expect.poll(async () => (await jun.boundingBox())!.x).toBeCloseTo(x0, 0);
      // The month labels are not repeated in the group headers: one axis, at the top.
      await expect(region.getByText('Mar', { exact: true })).toHaveCount(1);
    } else {
      expect(await region.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), 'no scrolling inside the chart on a phone').toBe(true);
      // The main axis is not in view while reading far down, so each traveler group repeats a small one.
      expect(await region.getByText('Mar', { exact: true }).count()).toBeGreaterThanOrEqual(5);
    }
    await expectNoPageScroll(page, wide ? 'scroll box' : 'phone');
  });

  test('the Today and month lines never cover a group heading (the label is on top at its centre)', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const region = chart(page);
    const toggles = region.getByRole('heading').getByRole('button');
    const n = await toggles.count();
    expect(n).toBe(4);
    const todayBox = (await region.getByText(/^Today/).boundingBox())!;
    const todayX = todayBox.x - 2; // the Today line is just left of its label
    for (let i = 0; i < n; i += 1) {
      const toggle = toggles.nth(i);
      await toggle.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
      const box = (await toggle.boundingBox())!;
      const name = ((await toggle.textContent()) ?? '').trim();
      const points = [
        { label: 'its centre', x: box.x + box.width / 2, y: box.y + box.height / 2 },
        { label: 'where the title starts', x: box.x + 40, y: box.y + box.height / 2 },
        { label: 'under the Today line', x: todayX, y: box.y + box.height / 2 },
      ].filter((p) => p.x >= box.x && p.x <= box.x + box.width);
      for (const p of points) {
        const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? document.elementFromPoint(x, y)?.className ?? '', p);
        expect(hit.trim(), `${name}: what is on top ${p.label}`).toBe(name);
      }
    }
  });

  test('the table is the plain alternative, and the old phase cards are gone', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const layout = page.getByRole('group', { name: 'Timeline layout' });
    await expect(layout.getByRole('button', { name: 'Chart' })).toHaveAttribute('aria-pressed', 'true');
    await expect(layout.getByRole('button', { name: 'Windows' })).toHaveCount(0);

    await layout.getByRole('button', { name: 'Table' }).click();
    await expect(layout.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: /^Timeline chart/ })).toHaveCount(0);
    const table = page.getByRole('table', { name: 'Everything with a date, in date order' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText(['Date', 'What', 'Who', 'Kind of date']);
    await expect(table.getByRole('link', { name: 'Verify both passports and renewal outcomes' })).toBeVisible();
    await expect(page.getByText(/no date yet; the chart shows where their phase puts them/)).toBeVisible();
    await expectNoPageScroll(page, 'table');

    await layout.getByRole('button', { name: 'Chart' }).click();
    await expect(chart(page)).toBeVisible();
    await expect(table).toHaveCount(0);
  });

  test('filters from the plan apply to the chart', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline&status=blocked');
    await loaded(page);
    await expect(chart(page).locator('[data-gantt-bar]')).toHaveCount(2);
    await expect(bar(page, "Establish Jun's nonworking residence route")).toBeVisible();
    await expect(bar(page, 'Confirm the pet import route')).toBeVisible();
  });
});

test.describe('Timeline: travel dates', () => {
  test('are folded away above the chart with a one-line summary, and open to show each traveler', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=timeline');
    await loaded(page);
    const summary = page.locator('summary').filter({ has: page.getByRole('heading', { name: 'Travel dates' }) });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Avery: Jul 5, 2027');
    await expect(summary).toContainText('Jun: not set (uses the July 2027 target)');
    await expect(summary).toContainText('Mochi: Sep 13, 2027');
    const details = page.locator('details').filter({ has: summary });
    expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(page.getByRole('button', { name: 'Set date: Jun departure' })).toBeHidden();

    await summary.click();
    await expect(page.getByRole('region', { name: "Jun's dates" })).toBeVisible();
    await expect(page.getByRole('region', { name: "Avery's dates" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set date: Jun departure' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change date: Avery departure' })).toBeVisible();
    await expectNoPageScroll(page, 'travel dates open');
  });
});

test.describe('Timeline: editing a travel date', () => {
  // Changes Jun's departure date, so it uses the read-only task-list server and runs once, putting the date back.
  test.use({ baseURL: baseUrlFor('snapshot') });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Changes a shared date on one server; runs once (desktop).');
  });

  async function junDeparture(api: Api) {
    return (await api.record('anchor:DR')) as { version: number; data: { date: string | null; confidence: string } };
  }

  test('the date editor still works from the timeline, and the chart follows the new date', async ({ page, signIn, api }) => {
    const avery = await api('avery', 'snapshot');
    const before = await junDeparture(avery);
    expect(before.data.date, 'the demo starts with Jun’s departure not set').toBeNull();
    try {
      await signIn(page, 'avery', '/plan?view=timeline');
      await loaded(page);
      await page.locator('summary').filter({ has: page.getByRole('heading', { name: 'Travel dates' }) }).click();
      await page.getByRole('button', { name: 'Set date: Jun departure' }).click();
      const dialog = page.getByRole('dialog', { name: 'Jun departure' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Date', { exact: true }).fill('2027-08-02');
      await expect(dialog.getByText('What would change')).toBeVisible();
      await dialog.getByRole('button', { name: 'Save date' }).click();
      await expect(dialog).toHaveCount(0);

      // The summary and the chart now use Jun's own date: no more "uses the target", no dashed marker for Jun.
      const summary = page.locator('summary').filter({ has: page.getByRole('heading', { name: 'Travel dates' }) });
      await expect(summary).toContainText('Jun: Aug 2, 2027');
      await expect(summary).not.toContainText('Jun: not set');
      await expect(chart(page).getByText('Jun departs')).toBeAttached();
      await expect(chart(page).getByText('Jun: not set — July 2027 target')).toHaveCount(0);
      await expect(bar(page, 'Release Jun to travel')).toHaveAttribute('data-basis', /^(phase|firm)$/);
      expect((await junDeparture(avery)).data.date).toBe('2027-08-02');
    } finally {
      const now = await junDeparture(avery);
      await avery.send('PUT', '/api/anchors/DR', { baseVersion: now.version, date: before.data.date, confidence: before.data.confidence }).catch(() => undefined);
    }
    expect((await junDeparture(avery)).data.date, 'Jun’s departure is back as it was').toBeNull();
  });
});
