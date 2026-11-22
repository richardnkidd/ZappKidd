import type { Page } from '@playwright/test';
import { expect, loaded, test } from './support/fixtures';

/**
 * Reading load: a guard so the screens do not drift back to walls of text. On the demo data, at 390x844:
 *  - Home is under 1,400px tall and its main content has under 180 words;
 *  - an expanded decision card shows under 90 words, not counting what sits behind its folded "Why and history";
 *  - no visible text is smaller than 14px (monogram letters excepted), on any of the main screens.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Measured once, at the phone size the limits are written for (390x844).');
});

const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await loaded(page);
  await page.waitForLoadState('networkidle');
}

/** Visible text smaller than 14px: "<tag.class> 13px "text"". Monograms (the letters in a person's badge) are allowed. */
async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      if (el.closest('.pbadge, .visually-hidden, [aria-hidden="true"] .pbadge')) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || style.visibility === 'hidden' || el.closest('[hidden]')) continue;
      // Screen-reader-only text is clipped to a 1px box; it is not seen.
      if (style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)') continue;
      const size = parseFloat(style.fontSize);
      if (size < 14) out.push(`<${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}> ${size}px "${text.slice(0, 30)}"`);
    }
    return [...new Set(out)];
  });
}

test.describe('Reading load', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Home fits under 1,400px and under 180 words', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await open(page, '/');
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height, 'Home page height at 390x844').toBeLessThan(1400);
    const count = words(await page.getByRole('main').innerText());
    expect(count, 'words in Home’s main content').toBeLessThan(180);
  });

  test('an expanded decision card shows under 90 words, with the rest folded away', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/decide');
    await open(page, '/decide');
    const opener = page.getByRole('article').filter({ has: page.getByRole('button', { name: 'Decide', exact: true }) }).first();
    const card = page.locator(`article[id="${await opener.getAttribute('id')}"]`);
    await card.getByRole('button', { name: 'Decide', exact: true }).click();
    const why = card.getByRole('button', { name: /^Why and history/ });
    if (await why.count()) await expect(why).toHaveAttribute('aria-expanded', 'false');
    // innerText leaves out what is hidden, so the folded section is not counted.
    const count = words(await card.innerText());
    expect(count, 'words on an open decision card').toBeLessThan(90);
  });

  test('no visible text is under 14px on the main screens', async ({ page, signIn }) => {
    test.setTimeout(90_000);
    await signIn(page, 'avery', '/');
    const failures: string[] = [];
    for (const path of ['/', '/decide', '/decide/questions', '/decide/risks', '/plan?view=workstream', '/plan?view=list', '/r/milestone%3AW06', '/money', '/documents', '/arrival', '/ready/avery', '/review', '/more']) {
      await open(page, path);
      for (const s of await smallText(page)) failures.push(`${path}: ${s}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('no card carries two filled buttons', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    const failures: string[] = [];
    for (const path of ['/', '/decide', '/decide/questions', '/plan?view=workstream', '/plan?view=list', '/r/milestone%3AW06', '/money', '/documents', '/arrival', '/review']) {
      await open(page, path);
      // Each visible filled button belongs to its nearest card; two in the same card is one too many.
      const bad = await page.evaluate(() => {
        const byCard = new Map<Element, number>();
        for (const b of Array.from(document.querySelectorAll('main .btn--primary'))) {
          if ((b as HTMLElement).offsetParent === null) continue;
          const card = b.closest('.card, .item, article, li');
          if (card) byCard.set(card, (byCard.get(card) ?? 0) + 1);
        }
        return [...byCard.entries()].filter(([, n]) => n > 1).map(([c]) => (c.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50));
      });
      for (const b of bad) failures.push(`${path}: "${b}"`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
