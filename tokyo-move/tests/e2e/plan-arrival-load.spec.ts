import type { Page } from '@playwright/test';
import { expect, loaded, test } from './support/fixtures';

/**
 * Reading load for the Plan views, Arrival, the arrival pack and the status dialog, on the demo household.
 * Budgets are for a phone 390 wide and 844 tall (the size the limits are written for): each page should open at about
 * two screens or less, with the rest one tap away. The real plan is bigger than the demo, so the budgets also hold
 * because groups and lists are capped (five rows, three on Arrival), which the structure tests below check directly.
 */

const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await loaded(page);
  await page.waitForLoadState('networkidle');
}

const height = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);
const mainWords = async (page: Page) => words(await page.getByRole('main').innerText());

test.describe('Page length at 390x844', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Measured once, at the phone size the limits are written for.');
  });
  test.use({ viewport: { width: 390, height: 844 } });

  const BUDGETS: { name: string; path: string; maxHeight: number; maxWords: number }[] = [
    { name: 'Plan list', path: '/plan?view=workstream', maxHeight: 2000, maxWords: 220 },
    { name: 'Plan by date', path: '/plan?view=list', maxHeight: 1800, maxWords: 180 },
    { name: 'Plan board', path: '/plan?view=board', maxHeight: 1800, maxWords: 150 },
    { name: 'Plan timeline', path: '/plan?view=timeline', maxHeight: 2000, maxWords: 300 },
    { name: 'The stuck list', path: '/plan?view=workstream&status=blocked', maxHeight: 1400, maxWords: 140 },
    { name: 'Arrival', path: '/arrival', maxHeight: 1500, maxWords: 120 },
    { name: 'The arrival pack page (previews folded)', path: '/arrival-pack', maxHeight: 1000, maxWords: 80 },
  ];
  for (const b of BUDGETS) {
    test(`${b.name} opens under ${b.maxHeight}px and ${b.maxWords} words`, async ({ page, signIn }) => {
      await signIn(page, 'avery', '/');
      await open(page, b.path);
      expect(await height(page), `${b.name} page height`).toBeLessThan(b.maxHeight);
      expect(await mainWords(page), `${b.name} words`).toBeLessThan(b.maxWords);
    });
  }

  test('an opened arrival pack is one short line for each item: no codes, slashes or rationale', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await open(page, '/arrival-pack');
    // Folded by default.
    const preview = page.getByRole('button', { name: /^Preview Avery/ });
    await expect(preview).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('article', { name: 'Arrival pack for Avery' })).toBeHidden();
    await preview.click();
    const pack = page.getByRole('article', { name: 'Arrival pack for Avery' });
    await expect(pack).toBeVisible();
    const text = await pack.innerText();
    expect(text).not.toMatch(/\b[A-Z]{1,3}\d{2,3}\b/); // no record codes
    expect(text).not.toMatch(/[/;]/); // no slashes or semicolons
    expect(text).not.toMatch(/Check:|Risk flag|Practical checks|Steps count from|When:/);
    expect(words(text), 'words in one opened pack').toBeLessThan(200);
    // Dates are short and carry no distance on paper.
    for (const t of await pack.locator('.pack__meta').allInnerTexts()) expect(t).not.toMatch(/\(\d+ days?\)|days? late/);
  });
});

test.describe('Plan: stuck items and small details', () => {
  test('the stuck list says what each item waits on', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=workstream&status=blocked');
    await loaded(page);
    const rows = page.getByRole('main').locator('li.item--card');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await expect(row.locator('.item__why')).toHaveText(/^(Waiting on: .{3,}|No reason written yet)$/);
    // The same wording as Home's "Stuck" rows (they say it after a dash, in lower case).
    await page.goto('/');
    await loaded(page);
    const home = await page.getByRole('region', { name: /^Stuck/ }).innerText();
    expect(home).toMatch(/waiting on/i);
  });

  test('"not agreed yet" is not on every card, and no owner word breaks in the middle', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=board');
    await loaded(page);
    await expect(page.getByRole('main')).not.toContainText('not agreed yet');
    // A word is never split across lines: the owner's name has no break-anywhere rule.
    const rules = await page.evaluate(() => Array.from(document.querySelectorAll('main .owner__name')).map((e) => getComputedStyle(e).overflowWrap + '/' + getComputedStyle(e).wordBreak));
    for (const r of rules) expect(r).not.toMatch(/anywhere|break-all|break-word/);
  });

  test('titles, group buttons and timeline bars are at least 44px to touch', async ({ page, signIn }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop', 'Phone sizes only.');
    await signIn(page, 'avery', '/plan?view=board');
    await loaded(page);
    const small = async () =>
      page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('main a.item__title, main .pgroup__btn, main .gbar, main .ggroup__toggle, main button.show-all'))) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || el.closest('[hidden]')) continue;
          if (r.height < 43.5) out.push(`${el.className} ${Math.round(r.height)}px "${(el.textContent ?? '').trim().slice(0, 30)}"`);
        }
        return out;
      });
    expect(await small(), 'board').toEqual([]);
    await page.goto('/plan?view=timeline');
    await loaded(page);
    await expect(page.getByRole('region', { name: /^Timeline chart/ })).toBeVisible();
    expect(await small(), 'timeline').toEqual([]);
  });

  test('Done sits on its own line below the text on narrow screens', async ({ page, signIn }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop', 'Phone sizes only.');
    for (const path of ['/plan?view=workstream', '/arrival']) {
      await signIn(page, 'avery', path);
      await loaded(page);
      await expect(page.getByRole('main').locator(path === '/arrival' ? '.step .row-1__side' : '.item--with-action > .item__side').first()).toBeVisible();
      const cards = await page.evaluate((p) => {
        const out: { gap: number; label: string }[] = [];
        const sides = p === '/arrival' ? Array.from(document.querySelectorAll<HTMLElement>('main .step .row-1__side')) : Array.from(document.querySelectorAll<HTMLElement>('main .item--with-action > .item__side'));
        for (const side of sides) {
          if (side.getBoundingClientRect().height < 2 || side.closest('[hidden]')) continue;
          const main = p === '/arrival' ? side.parentElement!.querySelector<HTMLElement>('.row-1__main')! : side.parentElement!.querySelector<HTMLElement>('.item__main')!;
          out.push({ gap: side.getBoundingClientRect().top - main.getBoundingClientRect().bottom, label: p });
        }
        return out;
      }, path);
      expect(cards.length, `${path} has a visible Done`).toBeGreaterThan(0);
      for (const c of cards) expect(c.gap, `${c.label}: Done is below the text`).toBeGreaterThanOrEqual(-1);
    }
  });
});

test.describe('Arrival opens short', () => {
  test('one part is open with three steps at most; the other parts are one tap away', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/arrival');
    await loaded(page);
    const heads = page.locator('main .pgroup > .pgroup__head > .pgroup__btn');
    for (const h of await heads.all()) {
      await expect(h).toHaveAttribute('aria-expanded', /^(true|false)$/);
      await expect(h).toHaveAttribute('aria-controls', /.+/);
    }
    // Among the "when" parts (level 3), exactly one is open.
    const windows = page.locator('main h3.pgroup__head > .pgroup__btn');
    expect(await windows.count()).toBeGreaterThan(1);
    expect(await page.locator('main h3.pgroup__head > .pgroup__btn[aria-expanded="true"]').count()).toBe(1);
    // The sections below (dates, ongoing, renewals, property, return) start closed.
    const sections = page.locator('main h2.pgroup__head > .pgroup__btn');
    expect(await sections.count()).toBeGreaterThanOrEqual(4);
    for (const s of await sections.all()) await expect(s).toHaveAttribute('aria-expanded', 'false');
    // Each open list shows three rows at most.
    for (const list of await page.locator('main .pgroup__body:not([hidden]) > ul.step-list').all()) expect(await list.locator(':scope > li').count()).toBeLessThanOrEqual(3);
    // Opening a section shows its content in place, and keeps focus on the button.
    await sections.first().click();
    await expect(sections.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(sections.first()).toBeFocused();
  });

  test('a step shows its title, next step and one date line; rules and conditions sit behind Details', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/arrival');
    await loaded(page);
    const snap = await (await api('avery')).snapshot();
    const arrival = (snap.records as any[]).filter((r) => r.type === 'arrival');
    // Trigger and review wording is in the record but not in the visible page.
    const visible = await page.getByRole('main').innerText();
    for (const r of arrival) {
      for (const field of ['trigger', 'review_note', 'completion_criteria', 'dependencies'] as const) {
        const value = (r.data[field] as string | null | undefined)?.trim();
        if (value && value.length > 12) expect(visible, `${r.key} ${field}`).not.toContain(value);
      }
    }
    // The text is still one tap away: Details opens it.
    const details = page.getByRole('main').getByRole('button', { name: /^Details/ }).first();
    if (await details.count()) {
      await expect(details).toHaveAttribute('aria-expanded', 'false');
      await details.click();
      await expect(details).toHaveAttribute('aria-expanded', 'true');
    }
    // Section headings are plain words, never a code or a raw planning label.
    for (const t of await page.getByRole('main').getByRole('heading').allInnerTexts()) expect(t).not.toMatch(/\b[A-Z]{1,3}\d{2,3}\b|_/);
  });
});

test.describe('Status dialog', () => {
  test('has no helper line that only repeats the status, and asks only what it needs to', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/r/milestone%3AW06');
    await loaded(page);
    await page.getByRole('button', { name: 'Change status' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change status' });
    await expect(dialog).toBeVisible();
    for (const restated of ['Not started yet.', 'Someone is working on it.', 'Stuck. Say what it waits on.', 'All finished.', 'We chose not to do it.', 'We do not need it.', 'The next move is someone else’s.']) {
      await expect(dialog.getByText(restated)).toHaveCount(0);
    }
    // A prompt that asks for input stays.
    await dialog.getByRole('radio', { name: /^Stuck/ }).check();
    await expect(dialog.getByRole('textbox', { name: 'What is it waiting on?' })).toBeVisible();
  });

  test('the task-list button on a record says what it does', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/r/milestone%3AW11');
    await loaded(page);
    const more = page.getByRole('button', { name: /^Task list/ }).first();
    if ((await more.getAttribute('aria-expanded')) === 'false') await more.click();
    await expect(page.getByRole('button', { name: 'Suggest a task' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Propose an action' })).toHaveCount(0);
  });
});
