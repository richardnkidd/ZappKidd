import type { Page } from '@playwright/test';
import { expect, loaded, openRecord, test, unique, type Api } from './support/fixtures';

/**
 * Two people edit the same field at the same time. Nothing may be overwritten silently: the second person sees both
 * versions and chooses. Two separate browser contexts (own cookies, own page) stand in for two phones.
 *
 * Each browser project uses its own roadmap items so the three projects never collide.
 */
const KEEP_THEIRS: Record<string, string> = { phone: 'milestone:W14', 'small-phone': 'milestone:W15', desktop: 'milestone:W16' };
const USE_MINE: Record<string, string> = { phone: 'milestone:W17', 'small-phone': 'milestone:W23', desktop: 'milestone:W24' };

const enc = encodeURIComponent;

async function startEditingNextAction(page: Page, text: string) {
  await page.getByRole('button', { name: 'Edit next action' }).click();
  const box = page.getByRole('textbox', { name: 'Next action' });
  await expect(box).toBeVisible();
  await box.fill(text);
  await expect(page.getByText('Unsaved changes').first()).toBeVisible();
}

async function restoreNextAction(api: Api, id: string, original: string) {
  const rec = await api.record(id);
  if (rec.data.next_action !== original) {
    await api.patch(`/api/records/${enc(id)}`, { baseVersion: rec.version, changes: { data: { next_action: original } }, reason: 'e2e cleanup' });
  }
}

test.describe('Edit conflicts', () => {
  test('the second person sees both versions and can keep the other person’s', async ({ openAs, api }, testInfo) => {
    const id = KEEP_THEIRS[testInfo.project.name]!;
    const avery = await api('avery');
    const original = (await avery.record(id)).data.next_action as string;
    const theirs = unique('Jun: phone the adviser on Monday', testInfo);
    const mine = unique('Avery: email the adviser instead', testInfo);
    try {
      const a = await openAs('avery', `/r/${enc(id)}`);
      const j = await openAs('jun', `/r/${enc(id)}`);
      await loaded(a.page);
      await loaded(j.page);

      // Avery starts editing; Jun edits the same field and saves first.
      await startEditingNextAction(a.page, mine);
      await startEditingNextAction(j.page, theirs);
      await j.page.getByRole('button', { name: 'Save', exact: true }).click();
      // The editor closes only once the server has accepted the change (a typed draft alone would also contain the text).
      await expect(j.page.getByRole('textbox', { name: 'Next action' })).toHaveCount(0);
      await expect(j.page.getByRole('region', { name: 'Next action' })).toContainText(theirs);
      expect((await avery.record(id)).data.next_action).toBe(theirs);

      // Avery saves second: nothing is overwritten, and the conflict is explained in words.
      await a.page.getByRole('button', { name: 'Save', exact: true }).click();
      const banner = a.page.getByRole('alert').filter({ hasText: 'changed this while you were editing' });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('Jun changed this while you were editing.');
      await expect(banner).toContainText('Nothing was overwritten');
      // Both versions are on screen side by side.
      const table = banner.getByRole('table');
      await expect(table.getByRole('cell', { name: theirs })).toBeVisible();
      await expect(table.getByRole('cell', { name: mine })).toBeVisible();
      await expect(banner.getByRole('button', { name: /^Keep Jun.s version$/ })).toBeVisible();
      await expect(banner.getByRole('button', { name: 'Use mine instead' })).toBeVisible();
      expect((await avery.record(id)).data.next_action, 'still Jun’s text on the server while Avery decides').toBe(theirs);

      // Keep theirs: Avery's draft is dropped and Jun's text stays.
      await banner.getByRole('button', { name: /^Keep Jun.s version$/ }).click();
      await expect(a.page.getByRole('alert').filter({ hasText: 'changed this while you were editing' })).toHaveCount(0);
      await expect(a.page.getByRole('textbox', { name: 'Next action' })).toHaveCount(0);
      await expect(a.page.getByRole('region', { name: 'Next action' })).toContainText(theirs);
      await expect(a.page.getByText(mine)).toHaveCount(0);
      expect((await avery.record(id)).data.next_action).toBe(theirs);
    } finally {
      await restoreNextAction(avery, id, original);
    }
  });

  test('the second person can re-apply their own change on top', async ({ openAs, api }, testInfo) => {
    const id = USE_MINE[testInfo.project.name]!;
    const avery = await api('avery');
    const original = (await avery.record(id)).data.next_action as string;
    const theirs = unique('Jun: wait for the written quote', testInfo);
    const mine = unique('Avery: ask for two quotes', testInfo);
    try {
      const a = await openAs('avery', `/r/${enc(id)}`);
      const j = await openAs('jun', `/r/${enc(id)}`);
      await loaded(a.page);
      await loaded(j.page);

      await startEditingNextAction(a.page, mine);
      await startEditingNextAction(j.page, theirs);
      await j.page.getByRole('button', { name: 'Save', exact: true }).click();
      // The editor closes only once the server has accepted the change (a typed draft alone would also contain the text).
      await expect(j.page.getByRole('textbox', { name: 'Next action' })).toHaveCount(0);
      await expect(j.page.getByRole('region', { name: 'Next action' })).toContainText(theirs);

      await a.page.getByRole('button', { name: 'Save', exact: true }).click();
      const banner = a.page.getByRole('alert').filter({ hasText: 'changed this while you were editing' });
      await expect(banner).toBeVisible();
      await banner.getByRole('button', { name: 'Use mine instead' }).click();

      // Avery's wording is now the saved one, and the editor is closed (it closes only after the server accepted it).
      await expect(a.page.getByRole('textbox', { name: 'Next action' })).toHaveCount(0);
      await expect(a.page.getByRole('region', { name: 'Next action' })).toContainText(mine);
      await expect(a.page.getByRole('alert').filter({ hasText: 'changed this while you were editing' })).toHaveCount(0);
      await expect(a.page.getByText(/^Saved\b/)).toBeVisible();
      expect((await avery.record(id)).data.next_action).toBe(mine);

      // Nothing was lost: both changes are in the history, Jun's first and Avery's on top.
      const history = (await avery.get(`/api/audit?record_id=${enc(id)}`)).entries as { after: any; actor: string }[];
      const wrote = history.map((h) => JSON.stringify(h.after ?? {}));
      expect(wrote.some((w) => w.includes(theirs))).toBe(true);
      expect(wrote.some((w) => w.includes(mine))).toBe(true);
    } finally {
      await restoreNextAction(avery, id, original);
    }
  });

  test('a conflicting status change also shows both versions', async ({ openAs, api }, testInfo) => {
    // Same safety net on a different form: the status dialog.
    const id = { phone: 'milestone:W26', 'small-phone': 'milestone:W25', desktop: 'milestone:W12' }[testInfo.project.name]!;
    const avery = await api('avery');
    const rec = await avery.record(id);
    const originalStatus = rec.status as string;
    const reasonJun = unique('Jun: waiting on the clinic', testInfo);
    try {
      if (originalStatus !== 'planned') await avery.post(`/api/records/${enc(id)}/status`, { baseVersion: rec.version, status: 'planned' });
      const a = await openAs('avery', `/r/${enc(id)}`);
      await loaded(a.page);
      await a.page.getByRole('button', { name: 'Change status' }).click();
      const dialog = a.page.getByRole('dialog', { name: 'Change status' });
      await dialog.getByRole('radio', { name: /^In progress/ }).check();

      // Meanwhile Jun blocks the same item (through the API, as a second device would).
      const jun = await api('jun');
      const fresh = await jun.record(id);
      await jun.post(`/api/records/${enc(id)}/status`, { baseVersion: fresh.version, status: 'blocked', reason: reasonJun });

      await dialog.getByRole('button', { name: 'Save status' }).click();
      const banner = dialog.getByRole('alert').filter({ hasText: 'changed this while you were editing' });
      await expect(banner).toBeVisible();
      expect((await avery.record(id)).status, 'Avery’s change was not applied silently').toBe('blocked');
      await banner.getByRole('button', { name: /^Keep Jun.s version$/ }).click();
      await expect(dialog).toHaveCount(0);
      await expect(a.page.getByText(reasonJun)).toBeVisible();
    } finally {
      const now = await avery.record(id);
      if (now.status !== originalStatus) await avery.post(`/api/records/${enc(id)}/status`, { baseVersion: now.version, status: originalStatus }).catch(() => undefined);
    }
  });
});
