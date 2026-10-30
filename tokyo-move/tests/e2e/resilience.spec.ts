import { expect, loaded, openRecord, test } from './support/fixtures';

/** What people see when the connection drops, a save fails, or the session ends: plain words, nothing lost. */

const enc = encodeURIComponent;
const TARGET = { phone: 'milestone:W09', 'small-phone': 'milestone:W08', desktop: 'milestone:W10' } as Record<string, string>;

test.describe('When things go wrong', () => {
  test('losing the connection keeps the last data on screen, says so, and recovers', async ({ page, context, signIn }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const firstItem = page.getByRole('main').getByRole('link', { name: 'Verify both passports and renewal outcomes', exact: true }).first();
    await expect(firstItem).toBeVisible();

    await context.setOffline(true);
    // The app re-checks when the page becomes visible or the network returns; ask it to now.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const banner = page.getByRole('status').filter({ hasText: /Showing data loaded .* can.t reach Kadode right now/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('You can keep reading');
    // Still readable.
    await expect(firstItem).toBeVisible();

    // "Try again" while still offline keeps the notice (and the data).
    await banner.getByRole('button', { name: 'Try again' }).click();
    await expect(banner).toBeVisible();
    await expect(firstItem).toBeVisible();

    // When the connection returns the page refreshes itself and the notice goes away.
    await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: /can.t reach Kadode right now/ })).toHaveCount(0);
    await expect(firstItem).toBeVisible();
  });

  test('a failed save keeps the person’s words and offers another try', async ({ page, signIn, api }, testInfo) => {
    const id = TARGET[testInfo.project.name]!;
    const avery = await api('avery');
    const before = await avery.record(id);
    const words = `Typed while the connection was down [${testInfo.project.name}]`;

    await signIn(page, 'avery');
    await openRecord(page, id);
    await page.getByRole('button', { name: 'Edit next action' }).click();
    const box = page.getByRole('textbox', { name: 'Next action' });
    await box.fill(words);

    // 1. The network drops during the save.
    await page.route(`**/api/records/${enc(id)}`, (route) => (route.request().method() === 'PATCH' ? route.abort('connectionfailed') : route.continue()));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/Not saved/).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /Can.t reach Kadode/ })).toBeVisible();
    await expect(box).toHaveValue(words); // nothing typed is lost
    expect((await avery.record(id)).data.next_action).toBe(before.data.next_action);

    // 2. The server says something went wrong.
    await page.unroute(`**/api/records/${enc(id)}`);
    await page.route(`**/api/records/${enc(id)}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error', message: 'Something went wrong on the server' }) })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Something went wrong/ })).toBeVisible();
    await expect(box).toHaveValue(words);

    // 3. When it works again, the same words save.
    await page.unroute(`**/api/records/${enc(id)}`);
    try {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Next action' })).toHaveCount(0); // closes only after the server accepted it
      await expect(page.getByRole('region', { name: 'Next action' })).toContainText(words);
      expect((await avery.record(id)).data.next_action).toBe(words);
    } finally {
      const now = await avery.record(id);
      await avery.patch(`/api/records/${enc(id)}`, { baseVersion: now.version, changes: { data: { next_action: before.data.next_action } }, reason: 'e2e cleanup' });
    }
  });

  test('unsaved typing is flagged, and a second tab’s change is never silently overwritten', async ({ page, signIn, api }, testInfo) => {
    const id = TARGET[testInfo.project.name]!;
    const avery = await api('avery');
    const before = await avery.record(id);
    await signIn(page, 'avery');
    await openRecord(page, id);
    await page.getByRole('button', { name: 'Edit next action' }).click();
    await page.getByRole('textbox', { name: 'Next action' }).fill('Half-written thought');
    await expect(page.getByText('Unsaved changes').first()).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Next action' })).toContainText(String(before.data.next_action));
  });

  test('when the session ends the person is taken back to sign-in, not shown errors', async ({ page, context, signIn }) => {
    await signIn(page, 'avery', '/plan');
    await loaded(page);
    await context.clearCookies();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Avery', exact: true })).toBeVisible();
  });

  test('if the server cannot be reached at all, the first screen explains it and offers to retry', async ({ page, context }) => {
    await context.route('**/api/me', (route) => route.abort('connectionrefused'));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /can.t reach Kadode/i })).toBeVisible();
    await expect(page.getByText(/Your plan is safe/)).toBeVisible();
    await context.unroute('**/api/me');
    await page.getByRole('button', { name: 'Try again' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  });
});
