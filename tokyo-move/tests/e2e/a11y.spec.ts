import type { Page } from '@playwright/test';
import { expect, loaded, openAccount, openRecord, test } from './support/fixtures';
import { FIXED_ROUTES, recordRoutes } from './support/routes';

/**
 * Accessibility smoke test on every route, written as small DOM checks (no axe dependency is installed).
 * It does not replace a manual screen-reader pass; see docs/TEST-REPORT.md for what is and is not covered.
 *
 * Per page: no sideways scrolling, every input has a label, every button and link has a name, exactly one h1, one
 * main landmark, a real page title, no duplicate ids, no console errors, and (phones) comfortable touch targets.
 */

interface Problems {
  overflow: string[];
  unlabelledInputs: string[];
  unnamedButtons: string[];
  unnamedLinks: string[];
  h1Count: number;
  mainCount: number;
  duplicateIds: string[];
  badLang: boolean;
  badBlankLinks: string[];
  headingJumps: string[];
  smallTargets: string[];
  imagesWithoutAlt: string[];
}

/** Runs inside the page. Keep it dependency-free. */
function inspect(scope: string | null): Problems {
  const root: ParentNode = scope ? (document.querySelector(scope) ?? document) : document;
  const visible = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (!h.getClientRects || h.getClientRects().length === 0) return false;
    const cs = getComputedStyle(h);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return true;
  };
  const textOf = (node: Node): string => {
    let s = '';
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) s += c.textContent ?? '';
      else if (c.nodeType === 1) {
        const e = c as Element;
        if (e.getAttribute('aria-hidden') === 'true') return;
        if (e.tagName === 'IMG') s += e.getAttribute('alt') ?? '';
        else if (e.tagName.toLowerCase() === 'svg') s += e.querySelector('title')?.textContent ?? '';
        else s += ' ' + textOf(e) + ' ';
      }
    });
    return s.replace(/\s+/g, ' ').trim();
  };
  const nameOf = (el: Element): string => {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => (document.getElementById(id) ? textOf(document.getElementById(id)!) : '')).join(' ').trim();
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const t = Array.from(labels).map((l) => textOf(l)).join(' ').trim();
      if (t) return t;
    }
    const t = textOf(el);
    if (t) return t;
    const title = el.getAttribute('title');
    return title && title.trim() ? title.trim() : '';
  };
  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : '';
    const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
    return `<${el.tagName.toLowerCase()}${id}${(el as HTMLInputElement).type ? ` type=${(el as HTMLInputElement).type}` : ''}> "${txt}"`;
  };

  const all = (sel: string) => Array.from(root.querySelectorAll(sel)).filter(visible);

  const unlabelledInputs = all('input:not([type="hidden"]), select, textarea')
    .filter((el) => !nameOf(el))
    .map(describe);
  const unnamedButtons = all('button, [role="button"], input[type="button"], input[type="submit"]')
    .filter((el) => !nameOf(el) && !(el as HTMLInputElement).value)
    .map(describe);
  const unnamedLinks = all('a[href]')
    .filter((el) => !nameOf(el))
    .map(describe);
  const badBlankLinks = all('a[target="_blank"]')
    .filter((el) => !/noopener/.test(el.getAttribute('rel') ?? ''))
    .map(describe);
  const imagesWithoutAlt = all('img').filter((el) => !el.hasAttribute('alt')).map(describe);

  const h1Count = Array.from(document.querySelectorAll('h1, [role="heading"][aria-level="1"]')).filter(visible).length;
  const mainCount = Array.from(document.querySelectorAll('main, [role="main"]')).filter(visible).length;

  const seen = new Map<string, number>();
  document.querySelectorAll('[id]').forEach((el) => seen.set(el.id, (seen.get(el.id) ?? 0) + 1));
  const duplicateIds = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  // Headings must not skip a level going down (h1 -> h3).
  const headingJumps: string[] = [];
  let prev = 0;
  Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(visible).forEach((h) => {
    const level = Number(h.tagName.slice(1));
    if (prev && level > prev + 1) headingJumps.push(`h${prev} -> h${level} "${(h.textContent ?? '').trim().slice(0, 40)}"`);
    prev = level;
  });

  // Touch targets: buttons and form controls at least 24x24 CSS px (WCAG 2.2 AA minimum; the design aims for 44).
  const smallTargets = all('button, select, textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 24 || r.height < 24;
    })
    .map((el) => `${describe(el)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);

  // Sideways scrolling: the document itself must not scroll horizontally. Report the widest offenders for diagnosis.
  const doc = document.documentElement;
  const overflow: string[] = [];
  if (doc.scrollWidth > doc.clientWidth + 1) {
    overflow.push(`document is ${doc.scrollWidth}px wide in a ${doc.clientWidth}px window`);
    const offenders = Array.from(document.body.querySelectorAll('*'))
      .filter(visible)
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter((x) => x.right > doc.clientWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5);
    for (const o of offenders) overflow.push(`${describe(o.el)} reaches ${Math.round(o.right)}px`);
  }

  return {
    overflow,
    unlabelledInputs,
    unnamedButtons,
    unnamedLinks,
    h1Count,
    mainCount,
    duplicateIds,
    badLang: !/^[a-z]{2}/i.test(document.documentElement.lang || ''),
    badBlankLinks,
    headingJumps,
    smallTargets,
    imagesWithoutAlt,
  };
}

function watchErrors(page: Page): { errors: string[] } {
  const bag = { errors: [] as string[] };
  page.on('pageerror', (e) => bag.errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') bag.errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) bag.errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return bag;
}

/**
 * `required` checks fail the test. `bestPractice` checks (heading order, touch-target size) are separate so a missed
 * level in a heading never hides a missing label, and all routes are reported together (soft assertions).
 */
async function check(page: Page, label: string, opts: { scope?: string; bestPractice?: boolean } = {}) {
  const p = await page.evaluate(inspect, opts.scope ?? null);
  const where = `[${label}]`;
  if (opts.bestPractice) {
    expect.soft(p.headingJumps, `${where} headings do not skip levels`).toEqual([]);
    if ((page.viewportSize()?.width ?? 1280) < 768) expect.soft(p.smallTargets, `${where} touch targets are at least 24x24`).toEqual([]);
    return;
  }
  expect.soft(p.overflow, `${where} no sideways scrolling`).toEqual([]);
  expect.soft(p.unlabelledInputs, `${where} every input has a label`).toEqual([]);
  expect.soft(p.unnamedButtons, `${where} every button has a name`).toEqual([]);
  expect.soft(p.unnamedLinks, `${where} every link has a name`).toEqual([]);
  if (!opts.scope) {
    expect.soft(p.h1Count, `${where} exactly one h1`).toBe(1);
    expect.soft(p.mainCount, `${where} exactly one main landmark`).toBe(1);
    expect.soft(p.badLang, `${where} <html lang> is set`).toBe(false);
  }
  expect.soft(p.duplicateIds, `${where} no duplicate ids`).toEqual([]);
  expect.soft(p.badBlankLinks, `${where} links that open a new tab use rel=noopener`).toEqual([]);
  expect.soft(p.imagesWithoutAlt, `${where} images have alt text`).toEqual([]);
}

/** Wait until the route has rendered its heading and finished its first load. */
async function settle(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await loaded(page);
  await page.waitForLoadState('networkidle');
}

test.describe('Accessibility smoke', () => {
  for (const mode of ['required', 'best practice'] as const) {
  test(`every route (${mode}): ${mode === 'required' ? 'no sideways scroll, labelled inputs, named buttons, one h1' : 'heading order and comfortable touch targets'}`, async ({ page, signIn, api }) => {
    test.setTimeout(180_000);
    await signIn(page, 'avery', '/');
    await settle(page);
    const bag = watchErrors(page);
    const routes = [...FIXED_ROUTES, ...(await recordRoutes(await api('avery')))];
    expect(routes.length).toBeGreaterThan(20);

    for (const route of routes) {
      bag.errors.length = 0;
      await page.goto(route.path);
      await settle(page);
      if (mode === 'best practice') {
        await check(page, route.label, { bestPractice: true });
        continue;
      }
      await check(page, route.label);
      // The document title follows the page heading, so tabs and screen readers can tell pages apart.
      await expect.soft(page, `[${route.label}] page title`).toHaveTitle(/Kadode/);
      expect.soft(bag.errors, `[${route.label}] no console errors or failed requests`).toEqual([]);
    }
  });
  }

  test('the sign-in screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Avery', exact: true })).toBeVisible();
    await check(page, 'sign-in (development identities)');
  });

  test('the password sign-in form (as shown outside the demo)', async ({ page }) => {
    // Outside the demo there are no development identities, so the screen shows a username/password form.
    await page.route('**/api/auth/identities', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ identities: [] }) }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await check(page, 'sign-in (password)');
  });

  test('dialogs: named, labelled, and they fit the screen', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await settle(page);

    const account = await openAccount(page, 'Avery');
    await check(page, 'account dialog', { scope: '[role="dialog"]' });
    await account.getByRole('button', { name: 'Done' }).click();

    await openRecord(page, 'milestone:W06', /Verify both passports/);
    for (const [opener, dialogName] of [
      ['Change status', 'Change status'],
      ['Propose an action', 'Propose an action for your task list'],
    ] as const) {
      await page.getByRole('button', { name: opener }).click();
      const dialog = page.getByRole('dialog', { name: dialogName });
      await expect(dialog).toBeVisible();
      await check(page, `${dialogName} dialog`, { scope: '[role="dialog"]' });
      // Open dialogs never create sideways scrolling or push their buttons off screen.
      const box = await dialog.boundingBox();
      const vw = page.viewportSize()!.width;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }

    await page.goto('/decide');
    await settle(page);
    const first = page.getByRole('article').first();
    await first.getByRole('button', { name: 'Review options and decide' }).click(); // the approve buttons appear once the options do
    await first.getByRole('button', { name: /^Approve as|Change my approval/ }).click();
    const approve = page.getByRole('dialog', { name: /^Approve as/ });
    await expect(approve).toBeVisible();
    await check(page, 'approve dialog', { scope: '[role="dialog"]' });
    await page.keyboard.press('Escape');
    await expect(approve).toHaveCount(0);
  });

  test('text can be enlarged to 200% without losing content or scrolling sideways', async ({ page, signIn }) => {
    // At 320px the 400%-zoom reflow rule applies instead (covered by the sideways-scroll checks above).
    test.skip((page.viewportSize()?.width ?? 0) < 380, 'Reflow at 320px is covered by the per-route checks.');
    await signIn(page, 'avery', '/');
    // WCAG "resize text": a larger root font size must still fit the width.
    for (const path of ['/plan?view=list', '/', '/decide']) {
      await page.goto(path);
      await settle(page);
      // Set through the DOM (the app's strict CSP rightly refuses injected <style> tags).
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const result = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide = doc.scrollWidth - doc.clientWidth;
        const offenders = Array.from(document.body.querySelectorAll('*'))
          .filter((el) => (el as HTMLElement).getClientRects().length > 0)
          .map((el) => ({ el, right: el.getBoundingClientRect().right }))
          .filter((x) => x.right > doc.clientWidth + 1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 4)
          .map((x) => `<${x.el.tagName.toLowerCase()}> "${(x.el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}" reaches ${Math.round(x.right)}px of ${doc.clientWidth}px`);
        return { wide, offenders };
      });
      expect.soft(result.wide, `${path} at 200% text: ${result.offenders.join('; ')}`).toBeLessThanOrEqual(1);
    }
  });
});
