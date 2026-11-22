import { expect, loaded, openAccount, openRecord, test, unique } from './support/fixtures';

const DEMO_BANNER = /Demo\s*[—–-]\s*fictional data/i;

test.describe('sign-in with a development identity', () => {
  test('lists the demo people, shows the demo banner, and signs out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Avery', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Jun', exact: true })).toBeVisible();
    // Honest about what this is.
    await expect(page.getByText(/development identity/i).first()).toBeVisible();
    await expect(page.getByText(/not real\s+authentication/i)).toBeVisible();

    await page.getByRole('button', { name: 'Avery', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Avery');
    // The banner says this is demo data (it is a "note" landmark, present on every screen).
    await expect(page.getByRole('note').filter({ hasText: DEMO_BANNER })).toBeVisible();
    await page.goto('/plan');
    await expect(page.getByRole('note').filter({ hasText: DEMO_BANNER })).toBeVisible();

    // Sign out through the account dialog ("Switch person" in a development-identity mode).
    const dialog = await openAccount(page, 'Avery');
    await expect(dialog).toContainText('Signed in as Avery');
    await expect(dialog).toContainText(/development identity/i);
    await dialog.getByRole('button', { name: /Switch person|Sign out/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    // The session really ended on the server, not just on screen.
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(401);
    // Protected pages send a signed-out person back to the sign-in screen rather than showing data.
    await page.goto('/plan');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  });

  test('a second identity sees shared records but not the first person’s private note', async ({ page, api }, testInfo) => {
    const privateText = unique('Private to Avery', testInfo);
    const sharedText = unique('Shared with the household', testInfo);

    // --- Avery writes one private and one shared note on the same record, in the UI.
    await page.goto('/');
    await page.getByRole('button', { name: 'Avery', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await openRecord(page, 'milestone:W06', /Verify both passports/);

    const notes = page.getByRole('region', { name: /^Notes/ });
    await notes.getByRole('textbox', { name: 'Add a note' }).fill(sharedText);
    await notes.getByRole('button', { name: 'Add note' }).click();
    await expect(notes.getByText(sharedText)).toBeVisible();

    await notes.getByRole('textbox', { name: 'Add a note' }).fill(privateText);
    await notes.getByRole('radio', { name: 'Only me' }).check();
    await notes.getByRole('button', { name: 'Add note' }).click();
    await expect(notes.getByText(privateText)).toBeVisible();
    await expect(notes.getByRole('listitem').filter({ hasText: privateText })).toContainText('Only you can see this');
    await expect(notes.getByRole('listitem').filter({ hasText: sharedText })).not.toContainText('Only you can see this');

    // --- Switch person, sign in as Jun.
    const dialog = await openAccount(page, 'Avery');
    await dialog.getByRole('button', { name: /Switch person/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await page.getByRole('button', { name: 'Jun', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    // The account button now names Jun (the app returns to the page that was open).
    await expect(page.getByRole('button', { name: /^Jun\b.*Account and display time zone/ })).toBeVisible();

    // Jun sees the same plan (shared record) and the household note, but never the private one.
    await openRecord(page, 'milestone:W06', /Verify both passports/);
    const junNotes = page.getByRole('region', { name: /^Notes/ });
    await expect(junNotes.getByText(sharedText)).toBeVisible();
    await expect(page.getByText(privateText)).toHaveCount(0);
    await expect(junNotes.getByText('Only you can see this')).toHaveCount(0);

    // The server agrees (not just the screen): Jun's data never contains the private note; Avery's does.
    const jun = await api('jun');
    const junSnapshot = JSON.stringify(await jun.snapshot());
    expect(junSnapshot).toContain(sharedText);
    expect(junSnapshot).not.toContain(privateText);
    const avery = await api('avery');
    expect(JSON.stringify(await avery.snapshot())).toContain(privateText);

    // Jun cannot fetch it by id either.
    const averyNotes = (await avery.get('/api/records?type=note')).records as { id: string; data: { body: string } }[];
    const privateNote = averyNotes.find((n) => n.data.body === privateText)!;
    expect(privateNote).toBeTruthy();
    const peek = await jun.raw('GET', `/api/records/${encodeURIComponent(privateNote.id)}`);
    expect(peek.status()).toBe(404);
    await loaded(page);
  });
});
