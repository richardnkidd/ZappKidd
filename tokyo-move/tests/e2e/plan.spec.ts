import type { Page, TestInfo } from '@playwright/test';
import { baseUrlFor } from './support/env';
import { addDays, expect, loaded, openRecord, test, todayInZone, unique, weekdayLabel, type Api } from './support/fixtures';

/** Each browser project mutates its own roadmap items, so the three projects never trip over each other. */
const STATUS_TARGET: Record<string, string> = { phone: 'milestone:W18', 'small-phone': 'milestone:W22', desktop: 'milestone:W27' };
const PROPOSE_TARGET = 'milestone:W11';

const enc = encodeURIComponent;

async function openRecordOrPlan(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await loaded(page);
}

async function resetStatus(api: Api, id: string, status: string = 'planned') {
  const rec = await api.record(id);
  if (rec.status !== status) await api.post(`/api/records/${enc(id)}/status`, { baseVersion: rec.version, status });
}

/** The full set of filters sits behind "More filters" on every screen size. */
async function openFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^More filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** Opens a "More" control on the record page (Details, Task list, Notes, ...) when it is closed. */
async function openMore(page: Page, name: RegExp | string) {
  const btn = page.getByRole('button', { name }).first();
  if ((await btn.getAttribute('aria-expanded')) === 'false') await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
}

async function chooseView(page: Page, name: 'List' | 'By date' | 'Board' | 'Timeline') {
  const group = page.getByRole('group', { name: 'Plan view' });
  await group.getByRole('button', { name }).click();
  await expect(group.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

/**
 * Unfold every group and press every "Show all (N)", so a test can count everything a view holds. Each view opens
 * with groups folded and five rows a group (see the reading-load tests); this is the "one tap away" part.
 */
async function revealAll(page: Page) {
  for (let pass = 0; pass < 4; pass += 1) {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('main .pgroup__btn[aria-expanded="false"], main .ggroup__toggle[aria-expanded="false"], main button.show-all'));
      for (const b of buttons) b.click();
      return buttons.length;
    });
    if (clicked === 0) break;
    await page.waitForTimeout(120);
  }
}

/** Every plan item on screen: by its link, or (the timeline chart, whose rows open a details panel) by its row. */
async function milestoneIds(page: Page): Promise<string[]> {
  const linked = await page.locator('main a[href^="/r/milestone"]').evaluateAll((as) => as.map((a) => decodeURIComponent((a.getAttribute('href') ?? '').slice(3))));
  const rows = await page.locator('main [data-gantt-item][data-item-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-item-id') ?? ''));
  return [...new Set([...linked, ...rows])].sort();
}

test.describe('Plan: views and filters', () => {
  test('the four views show the same items', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/plan');
    await loaded(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Plan view' })).toBeVisible();

    // What the server says the plan contains (optional future work is hidden by default, with a note saying so).
    const snap = await (await api('avery')).snapshot();
    const expected = (snap.records as any[])
      .filter((r) => r.type === 'milestone' && !r.data.optional_future_work)
      .map((r) => r.id as string)
      .sort();
    expect(expected.length).toBeGreaterThan(20);
    await expect(page.getByRole('status').filter({ hasText: /^Showing \d+ of \d+$/ })).toHaveText(`Showing ${expected.length} of ${expected.length + 1}`);

    const found: Record<string, string[]> = {};
    for (const view of ['List', 'By date', 'Board', 'Timeline'] as const) {
      await chooseView(page, view);
      // Groups and columns open short: "Show all (N)" and the group headings reveal the rest.
      await revealAll(page);
      found[view] = await milestoneIds(page);
    }
    for (const [view, ids] of Object.entries(found)) {
      expect(ids, `${view} lists every plan item`).toEqual(expected);
    }
  });

  test('the view choice is kept in the address, and optional work can be shown', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/plan?view=board');
    await expect(page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/view=board/);

    await chooseView(page, 'By date');
    await expect(page).toHaveURL(/view=list/);

    // Optional future work is hidden by default; the box says how many, and switching it off lists them too.
    await openFilters(page);
    const note = page.getByRole('link', { name: 'See Future work' });
    await expect(note).toBeVisible();
    const hideOptional = page.getByRole('checkbox', { name: /Hide optional future work/ });
    await expect(hideOptional).toBeChecked();
    await expect(hideOptional).toHaveAccessibleName('Hide optional future work (1)');
    // A plain click (not .uncheck()): the box is controlled by the address bar, so it settles a moment after the click.
    await hideOptional.click();
    await expect(hideOptional).not.toBeChecked();
    await expect(page).toHaveURL(/optional=show/);
    const snap = await (await api('avery')).snapshot();
    const all = (snap.records as any[]).filter((r) => r.type === 'milestone').length;
    await expect(page.getByRole('status').filter({ hasText: /^Showing/ })).toHaveText(`Showing ${all} of ${all}`);
    await expect(note).toHaveCount(0);
  });

  test('Mine, Stuck and All are the one simple control, and the count matches the list', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const quick = page.getByRole('group', { name: 'Show' });
    const count = page.getByRole('status').filter({ hasText: /^Showing/ });
    await expect(quick.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    const initial = (await count.innerText()).match(/Showing (\d+) of (\d+)/)!;
    await revealAll(page);
    expect(await milestoneIds(page)).toHaveLength(Number(initial[1]));

    const snap = await (await api('avery')).snapshot();
    const byId = new Map<string, any>((snap.records as any[]).map((r) => [r.id, r]));

    await quick.getByRole('button', { name: 'Mine' }).click();
    await expect(quick.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
    const mine = Number((await count.innerText()).match(/Showing (\d+)/)![1]);
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(Number(initial[1]));
    await revealAll(page);
    const shownIds = await milestoneIds(page);
    expect(shownIds).toHaveLength(mine);
    for (const id of shownIds) expect(byId.get(id).owner, id).toBe('avery');

    await quick.getByRole('button', { name: 'Stuck' }).click();
    await expect(quick.getByRole('button', { name: 'Stuck' })).toHaveAttribute('aria-pressed', 'true');
    const blockedIds = (snap.records as any[]).filter((r) => r.type === 'milestone' && r.status === 'blocked' && !r.data.optional_future_work).map((r) => r.id as string).sort();
    await expect(count).toHaveText(`Showing ${blockedIds.length} of ${initial[2]}`);
    await revealAll(page);
    expect(await milestoneIds(page)).toEqual(blockedIds);

    await quick.getByRole('button', { name: 'All' }).click();
    await expect(count).toHaveText(`Showing ${initial[1]} of ${initial[2]}`);
  });

  test('a link with ?status=blocked lands on the blocked items, open, at the top, with a matching count', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/plan?status=blocked');
    await loaded(page);
    await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Stuck' })).toHaveAttribute('aria-pressed', 'true');
    const snap = await (await api('avery')).snapshot();
    const blocked = (snap.records as any[]).filter((r) => r.type === 'milestone' && r.status === 'blocked' && !r.data.optional_future_work);
    expect(blocked.length).toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({ hasText: /^Showing/ })).toHaveText(new RegExp(`^Showing ${blocked.length} of \\d+$`));
    // The items are open and visible, not hidden inside closed groups, and the first one is near the top of the page.
    const links = page.getByRole('main').locator('a[href^="/r/milestone"]');
    await expect(links).toHaveCount(blocked.length);
    await expect(links.first()).toBeVisible();
    expect((await links.first().boundingBox())!.y).toBeLessThan(900);
  });

  test('"More filters" holds the full set; the choices narrow the list and can be cleared', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const count = page.getByRole('status').filter({ hasText: /^Showing/ });
    const initial = (await count.innerText()).match(/Showing (\d+) of (\d+)/)!;
    await openFilters(page);

    await page.getByRole('combobox', { name: 'Owner' }).selectOption({ label: 'Mine' });
    await expect(count).not.toHaveText(`Showing ${initial[1]} of ${initial[2]}`);
    // A custom mix is not one of the three simple choices: none of them looks pressed, and the button counts what is set.
    await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Stuck' });
    await expect(page.getByText('Nothing matches.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Show' }).locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^More filters \(2\)/ })).toBeVisible();

    await page.getByRole('button', { name: 'Show everything' }).click();
    await expect(count).toHaveText(`Showing ${initial[1]} of ${initial[2]}`);
    await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('combobox', { name: 'Owner' }).selectOption({ label: 'Mine' });
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count).toHaveText(`Showing ${initial[1]} of ${initial[2]}`);
  });

  test('the List opens on content: groups are closed except the first with unfinished items, five rows each', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan');
    await loaded(page);
    const heads = page.locator('main .pgroup > .pgroup__head > .pgroup__btn');
    await expect(heads.first()).toBeVisible();
    expect(await heads.count()).toBeGreaterThan(3);
    // Proper disclosures: each heading is a button that says whether it is open and what it controls.
    for (const h of await heads.all()) {
      await expect(h).toHaveAttribute('aria-expanded', /^(true|false)$/);
      await expect(h).toHaveAttribute('aria-controls', /.+/);
    }
    const open = await page.locator('main .grid-wide > .pgroup > .pgroup__head > .pgroup__btn[aria-expanded="true"]').count();
    expect(open).toBe(1);
    // Every group heading carries its name and a count.
    for (const t of await page.locator('main .grid-wide > .pgroup > .pgroup__head > .pgroup__btn').allInnerTexts()) expect(t).toMatch(/\S[\s\S]*\d+/);
    // No group lists more than five rows until "Show all (N)" is pressed.
    for (const body of await page.locator('main .grid-wide > .pgroup > .pgroup__body:not([hidden])').all()) {
      expect(await body.locator(':scope > ul > li').count()).toBeLessThanOrEqual(5);
    }
    // No filter chips, no helper paragraphs, no "Showing ... gentle limit ..." lines: content starts in the first screen.
    const firstItem = page.getByRole('main').locator('a[href^="/r/milestone"]:visible').first();
    await expect(firstItem).toBeVisible();
    const height = page.viewportSize()!.height;
    // On a 320 by 640 phone the first group heading is in view; on larger screens an item is too.
    expect((await heads.first().boundingBox())!.y).toBeLessThan(height);
    if (height >= 800) expect((await firstItem.boundingBox())!.y).toBeLessThan(height);
  });

  test('a group that was opened stays open for the rest of the visit', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=workstream');
    await loaded(page);
    const heads = page.locator('main .grid-wide > .pgroup > .pgroup__head > .pgroup__btn');
    const index = (await heads.evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-expanded') === 'false')));
    expect(index).toBeGreaterThan(-1);
    await heads.nth(index).click();
    await expect(heads.nth(index)).toHaveAttribute('aria-expanded', 'true');
    // Leave the screen and come back: the choice is remembered for this visit only.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/plan?view=workstream');
    await loaded(page);
    await expect(heads.nth(index)).toHaveAttribute('aria-expanded', 'true');
  });

  test('"By date" lists what is past its date first, then what is coming up', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    await expect(page.getByRole('heading', { level: 2, name: 'By date' })).toBeVisible();
    const headings = await page.getByRole('main').locator('h3').allInnerTexts();
    const order = headings.map((h) => h.replace(/\d+$/, '').trim()).filter((h) => ['Past their date', 'Coming up', 'No date yet'].includes(h));
    expect(order).toEqual(['Past their date', 'Coming up', 'No date yet'].filter((h) => order.includes(h)));
    expect(order).toContain('Coming up');
    const past = page.locator('.bydate--past');
    if ((await past.count()) > 0) {
      // Past-due work says how late, in the one date format, and is never a check-in.
      for (const t of await past.locator('.item__when').allInnerTexts()) expect(t).toMatch(/\d+ days? late/);
    }
    // A check-in keeps its word and reads in the one date format, the same as on Home and on the record page.
    for (const t of await page.locator('main .item__meta').allInnerTexts()) {
      const m = t.match(/Check-in (.*)/);
      if (m) expect(m[1], t).toMatch(/^(Today|Tomorrow|\d+ days? late|\w{3}, \w{3} \d+(, \d{4})?( \(\d+ days?\))?)/);
    }
  });
});

test.describe('Plan: opening a record', () => {
  test('a record opens from the list, shows its facts, and closes back to the plan', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const title = "Verify both passports and renewal outcomes";
    await page.getByRole('main').getByRole('link', { name: title, exact: true }).first().click();
    await expect(page).toHaveURL(/\/r\/milestone%3AW06/);

    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) {
      // Wide screens: a side panel over the plan; Escape or Close returns.
      const panel = page.getByRole('complementary', { name: 'Item details' });
      await expect(panel.getByRole('heading', { name: title })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Change status' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
      await panel.getByRole('button', { name: 'Close' }).click();
      await expect(panel).toHaveCount(0);
      await expect(page).toHaveURL(/\/plan/);
    } else {
      // Phones: a full page with its own heading and a Back button.
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    }

    // Opening the record directly always works and shows the same plain-language sections.
    await openRecord(page, 'milestone:W06', title);
    // The next step and when it is done come first; everything else sits behind plain "More" controls.
    for (const section of ['Next action', 'Done when']) {
      await expect(page.getByRole('region', { name: section }).first()).toBeVisible();
    }
    const mores = ['Details', 'Date details', 'What it waits on', /^Task list/, /^Notes/, 'History and source'];
    for (const name of mores) {
      const btn = page.getByRole('button', { name }).first();
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await expect(btn).toHaveAttribute('aria-controls', /.+/);
    }
    // Opening one shows its content under the same name.
    await openMore(page, 'What it waits on');
    await expect(page.getByRole('region', { name: 'What it waits on' })).toBeVisible();
    await openMore(page, /^Task list/);
    await expect(page.getByRole('region', { name: /^Tasks on your task list/ })).toBeVisible();
    // No internal code anywhere on the page, even with the sections open (the original text lives in the history).
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/W\d{2}/);
    await expect(page.getByRole('main')).not.toContainText(/\b(W|D|Q)\d{2,3}\b/);
  });

  test('the header says status, person and one date; the next step has its Edit control beside it', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openRecord(page, 'milestone:W06', 'Verify both passports and renewal outcomes');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    // One date line, and no "Awaiting date" or "No date yet" above a real date.
    await expect(page.getByText(/Awaiting date|No date yet/)).toHaveCount(0);
    await expect(page.locator('.rec-head .rec-when time')).toHaveCount(1);
    // The Edit control is on the same row as the next step, not at the far side of the screen.
    const text = await page.locator('.rec-next__text').boundingBox();
    const edit = await page.getByRole('button', { name: 'Edit next action' }).boundingBox();
    expect(text && edit).toBeTruthy();
    expect(edit!.y).toBeLessThan(text!.y + text!.height);
    expect(edit!.y + edit!.height).toBeGreaterThan(text!.y);
    expect(edit!.x - (text!.x + text!.width)).toBeLessThan(80);
    // The page says each thing once: the one verification line is "Not checked yet" with a small info control.
    await openMore(page, 'Date details');
    const notChecked = page.getByText('Not checked yet');
    expect(await notChecked.count()).toBeLessThanOrEqual(1);
  });

  test('at 200% text a record page and the plan never scroll sideways, even with every "More" open', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    for (const path of ['/r/milestone:W06', '/r/milestone:W24', '/r/decision:D02', '/plan', '/plan?view=list']) {
      await openRecordOrPlan(page, path);
      const closed = page.locator('button.more__btn[aria-expanded="false"]');
      while ((await closed.count()) > 0) await closed.first().click();
      await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'));
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${path} scrolls sideways by ${over}px at 200% text`).toBeLessThanOrEqual(1);
    }
  });

  test('a record with no date says so once, and shows no date line above nothing', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openRecord(page, 'milestone:W12');
    await expect(page.getByText('No date yet')).toHaveCount(1);
    await expect(page.getByText('Awaiting date')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Dates' })).toHaveCount(0);
  });

  test('plain wording shows as the title; the imported wording is only in the history', async ({ page, signIn, api }) => {
    const avery = await api('avery');
    const rec = await avery.record('milestone:W12');
    await signIn(page, 'avery');
    await openRecord(page, 'milestone:W12');
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/\b[WDQ]\d{2}\b/);
    await openMore(page, 'History and source');
    const history = page.getByRole('main').locator('.more__body').filter({ hasText: 'Where this came from' });
    await expect(history.getByRole('heading', { name: 'Where this came from' })).toBeVisible();
    if (rec.data.plain_title) await expect(history.getByRole('heading', { name: 'Original wording' })).toBeVisible();
    // The internal reference line is gone.
    await expect(page.getByText(/Internal reference/)).toHaveCount(0);
  });
});

test.describe('Notes', () => {
  test('Add note stays enabled; an empty note gets a short error, and a note with words is added', async ({ page, signIn }, testInfo) => {
    const text = unique('Ask about the crate size', testInfo);
    await signIn(page, 'avery');
    await openRecord(page, 'milestone:W06');
    await openMore(page, /^Notes/);
    const add = page.getByRole('button', { name: 'Add note' });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Write a note first.' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Add a note' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Add a note' }).fill(text);
    await expect(page.getByRole('alert').filter({ hasText: 'Write a note first.' })).toHaveCount(0);
    await add.click();
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Notes \(\d+\)/ })).toBeVisible();
  });
});

test.describe('Status rules', () => {
  test('Blocked needs a reason; Done takes optional evidence (and rejects an unsafe link)', async ({ page, signIn, api }, testInfo) => {
    const id = STATUS_TARGET[testInfo.project.name]!;
    const jun = await api('jun');
    await resetStatus(jun, id, 'planned');
    const title = (await jun.record(id)).title as string;
    const reason = unique('Waiting on the landlord reply', testInfo);
    const proof = unique('Receipt emailed by the agent', testInfo);

    try {
      await signIn(page, 'avery');
      await openRecord(page, id, title);

      // --- Blocked without a reason is refused, with a plain message, and nothing is saved.
      await page.getByRole('button', { name: 'Change status' }).click();
      const dialog = page.getByRole('dialog', { name: 'Change status' });
      // The four most-used statuses come first, one short line each; the others are behind "More".
      for (const main of [/^Not started/, /^Doing/, /^Stuck/, /^Done/]) await expect(dialog.getByRole('radio', { name: main })).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /^Waiting on someone/ })).toBeHidden();
      await dialog.getByRole('button', { name: 'More' }).click();
      await expect(dialog.getByRole('radio', { name: /^Waiting on someone/ })).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /^Dropped/ })).toBeVisible();
      await dialog.getByRole('button', { name: 'More' }).click();
      await dialog.getByRole('radio', { name: /^Stuck/ }).check();
      await dialog.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Please say why');
      await expect(dialog.getByRole('textbox', { name: 'What is it waiting on?' })).toHaveAttribute('aria-invalid', 'true');
      expect((await jun.record(id)).status).toBe('planned');

      // --- With a reason it saves, shows the reason, and says so.
      await dialog.getByRole('textbox', { name: 'What is it waiting on?' }).fill(reason);
      await dialog.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(/^Saved\b/)).toBeVisible();
      // Focus goes back to the control that opened the dialog, and "Saved" is announced in the status region.
      await expect(page.getByRole('button', { name: 'Change status' })).toBeFocused();
      await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
      await expect(page.getByText(reason)).toBeVisible();
      await expect(page.getByText(/Why it.s stuck/)).toBeVisible();
      const blocked = await jun.record(id);
      expect(blocked.status).toBe('blocked');
      expect(blocked.data.status_reason).toBe(reason);

      // --- Done: the evidence fields are optional in the form, and nothing is sent for them when they are empty.
      await page.getByRole('button', { name: 'Change status' }).click();
      const dialog2 = page.getByRole('dialog', { name: 'Change status' });
      await dialog2.getByRole('radio', { name: /^Done/ }).check();
      await expect(dialog2.getByRole('textbox', { name: 'What shows this is done? (optional)' })).not.toHaveAttribute('aria-invalid', 'true');
      const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/status$/.test(r.url()));
      await dialog2.getByRole('button', { name: 'Save status' }).click();
      expect(((await sent).postDataJSON() as { evidence?: unknown }).evidence ?? null).toBeNull();
      // A server that still asks for evidence says so in the dialog; one that does not simply saves it.
      const accepted = await dialog2.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false);
      if (accepted) {
        expect((await jun.record(id)).status).toBe('completed');
        await expect(page.getByRole('button', { name: 'Change status' })).toBeFocused();
        return;
      }
      await expect(dialog2.getByRole('alert')).toBeVisible();
      expect((await jun.record(id)).status).toBe('blocked');

      // --- A link that is not a web address is refused (no javascript: links ever reach a page).
      await dialog2.getByRole('textbox', { name: 'What shows this is done? (optional)' }).fill(proof);
      await dialog2.getByRole('textbox', { name: /^Link to the proof/ }).fill('javascript:alert(1)');
      await dialog2.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog2.getByRole('alert').filter({ hasText: /web address/ })).toBeVisible();
      expect((await jun.record(id)).status).toBe('blocked');

      // --- Evidence plus a normal link completes it.
      await dialog2.getByRole('textbox', { name: /^Link to the proof/ }).fill('https://example.invalid/receipt');
      await dialog2.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog2).toHaveCount(0);
      await expect(page.getByText(proof)).toBeVisible();
      await expect(page.getByRole('link', { name: /Open proof/ })).toHaveAttribute('href', 'https://example.invalid/receipt');
      await expect(page.getByRole('button', { name: 'Change status' })).toBeFocused();
      const done = await jun.record(id);
      expect(done.status).toBe('completed');
      expect(done.data.completion_evidence.at(-1).summary).toBe(proof);
    } finally {
      await resetStatus(jun, id, 'planned').catch(() => undefined);
    }
  });

  test('the server still enforces the reason (a script cannot skip it); evidence is optional', async ({ api }) => {
    const avery = await api('avery');
    const id = 'milestone:W25';
    const rec = await avery.record(id);
    const res = await avery.raw('POST', `/api/records/${enc(id)}/status`, { baseVersion: rec.version, status: 'blocked' });
    expect(res.status(), 'blocked without a reason').toBe(422);
    expect((await avery.record(id)).status).toBe(rec.status);
    // Completing without evidence is either refused or accepted, depending on the server's rule; never a crash.
    const done = await avery.raw('POST', `/api/records/${enc(id)}/status`, { baseVersion: rec.version, status: 'completed' });
    expect([200, 422]).toContain(done.status());
    if (done.status() === 200) await resetStatus(avery, id, rec.status);
  });
});

test.describe('Suggest a task', () => {
  test('defaults the due date to 14 days after today in the household zone; "leave blank" stays blank', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    const snap = await avery.snapshot();
    const zone: string = snap.me.household.home_timezone;
    const titleDefault = unique('Ask the mover about boxes', testInfo);
    const titleBlank = unique('Photograph the crate label', testInfo);

    await signIn(page, 'avery');
    await openRecord(page, PROPOSE_TARGET);
    await openMore(page, /^Task list/);
    const tasks = page.getByRole('region', { name: /^Tasks on your task list/ });

    // --- Default: 14 calendar days after today, in the household's zone (not the computer's).
    await tasks.getByRole('button', { name: 'Suggest a task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Suggest a task for your task list' });
    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill(titleDefault);
    const expectedBefore = addDays(todayInZone(zone), 14);
    await expect(dialog.getByRole('radio', { name: /^In about 14 days/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^In about 14 days/ })).toHaveAccessibleName(new RegExp(weekdayLabel(expectedBefore)));
    await dialog.getByRole('button', { name: 'Suggest task' }).click();
    await expect(dialog).toHaveCount(0);
    const expectedAfter = addDays(todayInZone(zone), 14);

    const row = tasks.getByRole('listitem').filter({ hasText: titleDefault });
    await expect(row).toBeVisible();
    await expect(row.locator('time[datetime]')).toHaveAttribute('datetime', expectedBefore === expectedAfter ? expectedBefore : /^\d{4}-\d{2}-\d{2}$/);
    // The sync state is visible in words (the demo uses a task list it can write to).
    await expect(row).toContainText(/Up to date|Waiting to be added to your task list/);
    const created = ((await avery.get('/api/tasks')).task_links as any[]).find((t) => t.title === titleDefault);
    expect([expectedBefore, expectedAfter]).toContain(created.due);
    expect(created.due_basis).toBe('default_14_days');

    // --- Leave blank: no date is invented anywhere.
    await tasks.getByRole('button', { name: 'Suggest a task' }).click();
    const dialog2 = page.getByRole('dialog', { name: 'Suggest a task for your task list' });
    await dialog2.getByRole('textbox', { name: 'What needs doing?' }).fill(titleBlank);
    await dialog2.getByRole('radio', { name: /^Leave blank/ }).check();
    await dialog2.getByRole('button', { name: 'Suggest task' }).click();
    await expect(dialog2).toHaveCount(0);
    const blankRow = tasks.getByRole('listitem').filter({ hasText: titleBlank });
    await expect(blankRow).toBeVisible();
    await expect(blankRow).toContainText('No due date');
    await expect(blankRow.locator('time')).toHaveCount(0);
    const blank = ((await avery.get('/api/tasks')).task_links as any[]).find((t) => t.title === titleBlank);
    expect(blank.due).toBeNull();
    expect(blank.due_basis).not.toBe('default_14_days');
  });

  test('a title is required and an explicit date is kept as typed', async ({ page, signIn, api }, testInfo) => {
    const title = unique('Book the vet for the export exam', testInfo);
    await signIn(page, 'jun', `/r/${enc(PROPOSE_TARGET)}`);
    await loaded(page);
    await openMore(page, /^Task list/);
    await page.getByRole('button', { name: 'Suggest a task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Suggest a task for your task list' });
    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill('');
    await dialog.getByRole('button', { name: 'Suggest task' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please say what needs doing');

    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill(title);
    await dialog.getByRole('radio', { name: 'Pick a date' }).check();
    await dialog.getByRole('button', { name: 'Suggest task' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please pick a date');
    await dialog.getByRole('textbox', { name: 'Due date' }).fill('2027-03-15');
    await dialog.getByRole('button', { name: 'Suggest task' }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByRole('region', { name: /^Tasks on your task list/ }).getByRole('listitem').filter({ hasText: title });
    await expect(row.locator('time[datetime]')).toHaveAttribute('datetime', '2027-03-15');
    const jun = await api('jun');
    const created = ((await jun.get('/api/tasks')).task_links as any[]).find((t) => t.title === title);
    expect(created.due).toBe('2027-03-15');
  });
});

test.describe('Suggest a task on a read-only task list', () => {
  test.use({ baseURL: baseUrlFor('snapshot') });

  async function makeProposals(avery: Api, testInfo: TestInfo) {
    const zone: string = (await avery.snapshot()).me.household.home_timezone;
    const today = todayInZone(zone);
    const proposals = [
      { label: 'soon', title: unique('Call the mover about dates', testInfo), due: addDays(today, 3) },
      { label: 'past', title: unique('Photocopy the lease', testInfo), due: addDays(today, -9) },
      { label: 'default', title: unique('Ask the vet for a copy of the records', testInfo), due: addDays(today, 14) },
    ];
    for (const p of proposals) {
      const made = await avery.post('/api/tasks', { title: p.title, record_id: PROPOSE_TARGET, owner: 'avery', due: p.due, due_mode: 'explicit' });
      expect(made.task.sync_state).toBe('pending_capture');
    }
    return proposals;
  }
  const LATE = /overdue|past its date|date has passed|\blate\b|not done/i;
  const IN_LIST = /\bin your task list\b|from your task list/i;

  test('a pending proposal says "Waiting to be added" wherever it is listed, never "in your task list" and never overdue', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery', 'snapshot');
    const proposals = await makeProposals(avery, testInfo);

    // 1. Home says how many are waiting, in one line, and never lists a proposal as plan work, late, or "in your task list".
    await signIn(page, 'avery', '/');
    await loaded(page);
    const pending = ((await avery.get('/api/tasks')).task_links as any[]).filter((t) => t.sync_state === 'pending_capture' && t.status === 'open').length;
    expect(pending).toBeGreaterThanOrEqual(proposals.length);
    await expect(page.getByRole('main').getByRole('link', { name: `${pending} tasks waiting to be added` })).toBeVisible();
    const home = await page.getByRole('main').innerText();
    for (const p of proposals) expect(home, `${p.label} is not listed on Home as work`).not.toContain(p.title);
    expect(home).not.toMatch(IN_LIST);

    // 2. They are not plan work: not under "Your turn" or "Stuck".
    for (const section of [/^Your turn/, /^Stuck/]) {
      const region = page.getByRole('region', { name: section });
      if ((await region.count()) === 0) continue;
      for (const p of proposals) await expect(region, `${p.label} is not listed under ${String(section)}`).not.toContainText(p.title);
    }

    // 3. On the item itself: "Waiting to be added", with the date told honestly, and no claim it is on the task list.
    await openRecord(page, PROPOSE_TARGET);
    await openMore(page, /^Task list/);
    const tasks = page.getByRole('region', { name: /^Tasks on your task list/ });
    // Said once, in the sub-heading: the rows do not repeat it, and never say "proposed".
    await expect(tasks.getByRole('heading', { name: 'Waiting to be added to your task list' })).toBeVisible();
    for (const p of proposals) {
      const row = tasks.getByRole('listitem').filter({ hasText: p.title });
      await expect(row, p.label).toBeVisible();
      await expect(row).not.toContainText(/proposed/i);
      await expect(row).not.toContainText(IN_LIST);
      await expect(row).not.toContainText(LATE);
      if (p.label === 'past') await expect(row).toContainText(/date was/i);
    }

    // 4. Not in the plan views or on the traveler page as dated work either.
    for (const path of ['/plan?view=list', '/plan?view=timeline', '/ready/avery']) {
      await page.goto(path);
      await loaded(page);
      for (const p of proposals) await expect(page.getByRole('main'), `${p.label} on ${path}`).not.toContainText(p.title);
    }
  });

  test('a pending proposal never turns up in "Coming up" as a committed date, and is never "past its date"', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery', 'snapshot');
    const proposals = await makeProposals(avery, testInfo);
    // "Coming up" and "Past their date" live in Plan's By date view now.
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const coming = page.getByRole('region', { name: /^Coming up/ });
    await expect(coming).toBeVisible();
    for (const section of [/^Coming up/, /^Past their date/]) {
      const region = page.getByRole('region', { name: section });
      if ((await region.count()) === 0) continue;
      for (const p of proposals) {
        await expect(region, `"${p.title}" (${p.label}) is only a proposal; it has no date of its own to count down to`).not.toContainText(p.title);
      }
    }
  });
  test('stays "Waiting to be added to your task list" and nothing pretends it was created', async ({ page, signIn, api }, testInfo) => {
    const title = unique('Check the crate size', testInfo);
    await signIn(page, 'avery', `/r/${enc(PROPOSE_TARGET)}`);
    await loaded(page);
    await openMore(page, /^Task list/);
    await page.getByRole('button', { name: 'Suggest a task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Suggest a task for your task list' });
    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill(title);
    await dialog.getByRole('button', { name: 'Suggest task' }).click();
    await expect(dialog).toHaveCount(0);

    const row = page.getByRole('region', { name: /^Tasks on your task list/ }).getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(page.getByRole('region', { name: /^Tasks on your task list/ }).getByRole('heading', { name: 'Waiting to be added to your task list' })).toBeVisible();
    await expect(row).not.toContainText(/proposed/i);
    await expect(row).toContainText(/Kadode can.t add this/);
    await expect(row).not.toContainText('Up to date');
    await expect(row).not.toContainText(/\bin your task list\b/i);

    const avery = await api('avery', 'snapshot');
    const created = ((await avery.get('/api/tasks')).task_links as any[]).find((t) => t.title === title);
    expect(created.sync_state).toBe('pending_capture');
    expect(created.canonical_id).toBeNull();
    // The Data page is honest about the task list copy being read-only.
    await page.goto('/data');
    await loaded(page);
    await expect(page.getByText(/Read-only copy as of .+\. New actions wait to be added\./)).toBeVisible();
  });
});

test.describe('Suggest a task when the task list fails once', () => {
  // This server's demo task store is told to fail the first "create": the proposal must not be lost or pretended done.
  test.describe.configure({ mode: 'serial' });
  test.use({ baseURL: baseUrlFor('failcreate') });

  test('shows "Couldn’t reach your task list", keeps the proposal, and "Try again" finishes it', async ({ page, signIn, api }, testInfo) => {
    // Only the first create on this server fails, so run it in one project.
    test.skip(testInfo.project.name !== 'phone', 'The injected failure happens once per server run.');
    const title = unique('Order the moving boxes', testInfo);
    await signIn(page, 'avery', `/r/${enc(PROPOSE_TARGET)}`);
    await loaded(page);
    await openMore(page, /^Task list/);
    await page.getByRole('button', { name: 'Suggest a task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Suggest a task for your task list' });
    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill(title);
    await dialog.getByRole('button', { name: 'Suggest task' }).click();
    await expect(dialog).toHaveCount(0);

    const row = page.getByRole('region', { name: /^Tasks on your task list/ }).getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible(); // the proposal is kept
    await expect(row).toContainText(/Couldn.t reach your task list/);
    await expect(row).not.toContainText('Up to date');
    const avery = await api('avery', 'failcreate');
    const failed = ((await avery.get('/api/tasks')).task_links as any[]).find((t) => t.title === title);
    expect(failed.sync_state).toBe('error');
    expect(failed.canonical_id).toBeNull();

    // Try again: the same proposal now reaches the (fixture) task list, with the same due date, once.
    await row.getByRole('button', { name: 'Try again' }).click();
    await expect(row).toContainText('Up to date');
    await expect(row.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    const done = ((await avery.get('/api/tasks')).task_links as any[]).filter((t) => t.title === title);
    expect(done).toHaveLength(1);
    expect(done[0].sync_state).toBe('synced');
    expect(done[0].canonical_id).toBeTruthy();
    expect(done[0].due).toBe(failed.due);
  });
});
