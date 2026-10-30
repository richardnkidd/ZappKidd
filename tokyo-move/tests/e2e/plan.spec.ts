import type { Page } from '@playwright/test';
import { baseUrlFor } from './support/env';
import { addDays, expect, loaded, openRecord, test, todayInZone, unique, weekdayLabel, type Api } from './support/fixtures';

/** Each browser project mutates its own roadmap items, so the three projects never trip over each other. */
const STATUS_TARGET: Record<string, string> = { phone: 'milestone:W18', 'small-phone': 'milestone:W22', desktop: 'milestone:W27' };
const PROPOSE_TARGET = 'milestone:W11';

const enc = encodeURIComponent;

async function resetStatus(api: Api, id: string, status: string = 'planned') {
  const rec = await api.record(id);
  if (rec.status !== status) await api.post(`/api/records/${enc(id)}/status`, { baseVersion: rec.version, status });
}

/** On phones the filters live behind a "Filters" button; on wide screens they are always open. */
async function openFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

async function chooseView(page: Page, name: 'By workstream' | 'List' | 'Board' | 'Timeline') {
  const group = page.getByRole('group', { name: 'Plan view' });
  await group.getByRole('button', { name }).click();
  await expect(group.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

async function milestoneIds(page: Page): Promise<string[]> {
  const ids = await page.locator('main a[href^="/r/milestone"]').evaluateAll((as) => as.map((a) => decodeURIComponent((a.getAttribute('href') ?? '').slice(3))));
  return [...new Set(ids)].sort();
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
    for (const view of ['By workstream', 'List', 'Board', 'Timeline'] as const) {
      await chooseView(page, view);
      if (view === 'Board') {
        // Long columns show the first few cards; "Show N more" reveals the rest.
        for (const more of await page.getByRole('button', { name: /^Show \d+ more$/ }).all()) await more.click();
      }
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

    await chooseView(page, 'List');
    await expect(page).toHaveURL(/view=list/);

    // Optional future work is hidden by default and says so; switching the filter off lists it too.
    const note = page.getByText(/optional future items? (is|are) hidden/);
    await expect(note).toBeVisible();
    await openFilters(page);
    const hideOptional = page.getByRole('checkbox', { name: /Hide optional future work/ });
    await expect(hideOptional).toBeChecked();
    // A plain click (not .uncheck()): the box is controlled by the address bar, so it settles a moment after the click.
    await hideOptional.click();
    await expect(hideOptional).not.toBeChecked();
    await expect(page).toHaveURL(/optional=show/);
    const snap = await (await api('avery')).snapshot();
    const all = (snap.records as any[]).filter((r) => r.type === 'milestone').length;
    await expect(page.getByRole('status').filter({ hasText: /^Showing/ })).toHaveText(`Showing ${all} of ${all}`);
    await expect(note).toHaveCount(0);
  });

  test('filters narrow the list and can be cleared', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const count = page.getByRole('status').filter({ hasText: /^Showing/ });
    const initial = (await count.innerText()).match(/Showing (\d+) of (\d+)/)!;
    await openFilters(page);

    await page.getByRole('combobox', { name: 'Owner' }).selectOption({ label: 'Mine' });
    await expect(count).not.toHaveText(`Showing ${initial[1]} of ${initial[2]}`);
    const mine = Number((await count.innerText()).match(/Showing (\d+)/)![1]);
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(Number(initial[1]));
    // Every item left on screen is Avery's, according to the server's own data.
    const snap = await (await api('avery')).snapshot();
    const ownerById = new Map<string, string | null>((snap.records as any[]).map((r) => [r.id, r.owner]));
    const shownIds = await milestoneIds(page);
    expect(shownIds).toHaveLength(mine);
    for (const id of shownIds) expect(ownerById.get(id), id).toBe('avery');

    await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Blocked' });
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count).toHaveText(`Showing ${initial[1]} of ${initial[2]}`);
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
    for (const section of ['Next action', 'Who and when', 'Dates', /How we.ll know it.s done/, 'What this depends on', /^Tasks on your task list/, /^Notes/]) {
      await expect(page.getByRole('region', { name: section }).first()).toBeVisible();
    }
    // Internal codes live only inside the collapsed "Source & history" panel.
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/W\d{2}/);
    await expect(page.getByText(/Source (&|and) history/i).first()).toBeVisible();
  });
});

test.describe('Status rules', () => {
  test('Blocked needs a reason; Done needs evidence (and rejects an unsafe link)', async ({ page, signIn, api }, testInfo) => {
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
      await dialog.getByRole('radio', { name: /^Blocked/ }).check();
      await dialog.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Please say why');
      await expect(dialog.getByRole('textbox', { name: 'What is it waiting on?' })).toHaveAttribute('aria-invalid', 'true');
      expect((await jun.record(id)).status).toBe('planned');

      // --- With a reason it saves, shows the reason, and says so.
      await dialog.getByRole('textbox', { name: 'What is it waiting on?' }).fill(reason);
      await dialog.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(/^Saved\b/)).toBeVisible();
      await expect(page.getByText(reason)).toBeVisible();
      await expect(page.getByText(/Why it.s blocked/)).toBeVisible();
      const blocked = await jun.record(id);
      expect(blocked.status).toBe('blocked');
      expect(blocked.data.status_reason).toBe(reason);

      // --- Done without evidence is refused.
      await page.getByRole('button', { name: 'Change status' }).click();
      const dialog2 = page.getByRole('dialog', { name: 'Change status' });
      await dialog2.getByRole('radio', { name: /^Done/ }).check();
      await dialog2.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog2.getByRole('alert')).toContainText('what shows it is done');
      await expect(dialog2.getByRole('textbox', { name: 'What shows this is done?' })).toHaveAttribute('aria-invalid', 'true');
      expect((await jun.record(id)).status).toBe('blocked');

      // --- A link that is not a web address is refused (no javascript: links ever reach a page).
      await dialog2.getByRole('textbox', { name: 'What shows this is done?' }).fill(proof);
      await dialog2.getByRole('textbox', { name: /^Link to the proof/ }).fill('javascript:alert(1)');
      await dialog2.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog2.getByRole('alert')).toContainText(/web address/);
      expect((await jun.record(id)).status).toBe('blocked');

      // --- Evidence plus a normal link completes it.
      await dialog2.getByRole('textbox', { name: /^Link to the proof/ }).fill('https://example.invalid/receipt');
      await dialog2.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog2).toHaveCount(0);
      await expect(page.getByText(proof)).toBeVisible();
      await expect(page.getByRole('link', { name: /Open proof/ })).toHaveAttribute('href', 'https://example.invalid/receipt');
      const done = await jun.record(id);
      expect(done.status).toBe('completed');
      expect(done.data.completion_evidence.at(-1).summary).toBe(proof);
    } finally {
      await resetStatus(jun, id, 'planned').catch(() => undefined);
    }
  });

  test('the server enforces the same rules (a script cannot skip the reason or the evidence)', async ({ api }) => {
    const avery = await api('avery');
    const id = 'milestone:W25';
    const rec = await avery.record(id);
    for (const [status, field] of [['blocked', 'reason'], ['completed', 'evidence']] as const) {
      const res = await avery.raw('POST', `/api/records/${enc(id)}/status`, { baseVersion: rec.version, status });
      expect(res.status(), `${status} without ${field}`).toBe(422);
    }
    expect((await avery.record(id)).status).toBe(rec.status);
  });
});

test.describe('Propose an action', () => {
  test('defaults the due date to 14 days after today in the household zone; "leave blank" stays blank', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    const snap = await avery.snapshot();
    const zone: string = snap.me.household.home_timezone;
    const titleDefault = unique('Ask the mover about boxes', testInfo);
    const titleBlank = unique('Photograph the crate label', testInfo);

    await signIn(page, 'avery');
    await openRecord(page, PROPOSE_TARGET);
    const tasks = page.getByRole('region', { name: /^Tasks on your task list/ });

    // --- Default: 14 calendar days after today, in the household's zone (not the computer's).
    await tasks.getByRole('button', { name: 'Propose an action' }).click();
    const dialog = page.getByRole('dialog', { name: 'Propose an action for your task list' });
    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill(titleDefault);
    const expectedBefore = addDays(todayInZone(zone), 14);
    await expect(dialog.getByRole('radio', { name: /^In about 14 days/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^In about 14 days/ })).toHaveAccessibleName(new RegExp(weekdayLabel(expectedBefore)));
    await dialog.getByRole('button', { name: 'Propose action' }).click();
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
    await tasks.getByRole('button', { name: 'Propose an action' }).click();
    const dialog2 = page.getByRole('dialog', { name: 'Propose an action for your task list' });
    await dialog2.getByRole('textbox', { name: 'What needs doing?' }).fill(titleBlank);
    await dialog2.getByRole('radio', { name: /^Leave blank/ }).check();
    await dialog2.getByRole('button', { name: 'Propose action' }).click();
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
    await page.getByRole('button', { name: 'Propose an action' }).click();
    const dialog = page.getByRole('dialog', { name: 'Propose an action for your task list' });
    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill('');
    await dialog.getByRole('button', { name: 'Propose action' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please say what needs doing');

    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill(title);
    await dialog.getByRole('radio', { name: 'Pick a date' }).check();
    await dialog.getByRole('button', { name: 'Propose action' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please pick a date');
    await dialog.getByRole('textbox', { name: 'Due date' }).fill('2027-03-15');
    await dialog.getByRole('button', { name: 'Propose action' }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByRole('region', { name: /^Tasks on your task list/ }).getByRole('listitem').filter({ hasText: title });
    await expect(row.locator('time[datetime]')).toHaveAttribute('datetime', '2027-03-15');
    const jun = await api('jun');
    const created = ((await jun.get('/api/tasks')).task_links as any[]).find((t) => t.title === title);
    expect(created.due).toBe('2027-03-15');
  });
});

test.describe('Propose an action on a read-only task list', () => {
  test.use({ baseURL: baseUrlFor('snapshot') });

  test('stays "Waiting to be added to your task list" and nothing pretends it was created', async ({ page, signIn, api }, testInfo) => {
    const title = unique('Check the crate size', testInfo);
    await signIn(page, 'avery', `/r/${enc(PROPOSE_TARGET)}`);
    await loaded(page);
    await page.getByRole('button', { name: 'Propose an action' }).click();
    const dialog = page.getByRole('dialog', { name: 'Propose an action for your task list' });
    await dialog.getByRole('textbox', { name: 'What needs doing?' }).fill(title);
    await dialog.getByRole('button', { name: 'Propose action' }).click();
    await expect(dialog).toHaveCount(0);

    const row = page.getByRole('region', { name: /^Tasks on your task list/ }).getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText('Waiting to be added to your task list').first()).toBeVisible();
    await expect(row).not.toContainText('Up to date');
    await expect(row).toContainText(/Nothing has been created there yet/);

    const avery = await api('avery', 'snapshot');
    const created = ((await avery.get('/api/tasks')).task_links as any[]).find((t) => t.title === title);
    expect(created.sync_state).toBe('pending_capture');
    expect(created.canonical_id).toBeNull();
    // The footer on Home is honest about the task list copy being read-only.
    await page.goto('/');
    await loaded(page);
    await expect(page.getByText(/Task list copy .* read-only/)).toBeVisible();
  });
});
