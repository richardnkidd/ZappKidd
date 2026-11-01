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
function inspect({ scope, nominal }: { scope: string | null; nominal: number }): Problems {
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
  // On a phone the browser may widen its layout viewport to fit overflowing content instead of scrolling, which makes
  // clientWidth grow with it; so the width the test asked for (`nominal`) is the limit, not what the browser reports.
  const doc = document.documentElement;
  const overflow: string[] = [];
  if (doc.scrollWidth > doc.clientWidth + 1 || doc.scrollWidth > nominal + 1 || window.innerWidth > nominal + 1) {
    overflow.push(`document is ${doc.scrollWidth}px wide in a ${nominal}px window`);
    const offenders = Array.from(document.body.querySelectorAll('*'))
      .filter(visible)
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter((x) => x.right > Math.min(doc.clientWidth, nominal) + 1)
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
  const p = await page.evaluate(inspect, { scope: opts.scope ?? null, nominal: page.viewportSize()?.width ?? 1280 });
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
    const nominal = page.viewportSize()!.width;
    // WCAG 1.4.10 / "resize text": a larger root font size must still fit the width. On phones the browser widens its layout
    // viewport rather than scroll, so the requested width (not clientWidth) is what the page has to fit in.
    const paths = ['/plan?view=list', '/', '/decide', '/plan?view=board', '/plan?view=workstream', '/plan?view=timeline', '/r/milestone:W24', '/money', '/documents', '/ready/avery', '/what-if', '/settings'];
    for (const path of paths) {
      await page.goto(path);
      await settle(page);
      // Set through the DOM (the app's strict CSP rightly refuses injected <style> tags).
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const result = await page.evaluate((limit) => {
        const doc = document.documentElement;
        const wide = Math.max(doc.scrollWidth, window.innerWidth) - limit;
        const offenders = Array.from(document.body.querySelectorAll('*'))
          .filter((el) => (el as HTMLElement).getClientRects().length > 0)
          .map((el) => ({ el, right: el.getBoundingClientRect().right }))
          .filter((x) => x.right > limit + 1 && !(x.el.closest('[role="region"][tabindex], .app-nav, .save-indicator-wrap')))
          .sort((a, b) => b.right - a.right)
          .slice(0, 4)
          .map((x) => `<${x.el.tagName.toLowerCase()}.${String((x.el as HTMLElement).className).slice(0, 30)}> "${(x.el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}" reaches ${Math.round(x.right)}px of ${limit}px`);
        return { wide, offenders };
      }, nominal);
      expect.soft(result.wide, `${path} at 200% text: ${result.offenders.join('; ')}`).toBeLessThanOrEqual(1);
    }
  });

  test('phones: every tap target is at least 24x24 CSS px, or has room around it (WCAG 2.5.8)', async ({ page, signIn }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Measured at 390px wide.');
    test.setTimeout(120_000);
    await signIn(page, 'avery', '/');
    const steps: { path: string; act?: (p: Page) => Promise<void>; label: string }[] = [
      ...['/', '/plan?view=list', '/plan?view=board', '/plan?view=timeline', '/decide', '/decide/questions', '/decide/risks', '/money', '/documents', '/contacts', '/arrival', '/future', '/data', '/settings', '/ready/avery', '/review', '/what-if', '/arrival-pack', '/r/milestone:W24'].map((path) => ({ path, label: path })),
      { path: '/plan?view=timeline', label: 'timeline table', act: async (p) => { await p.getByRole('button', { name: 'Table' }).click(); } },
      { path: '/documents', label: 'document dialog', act: async (p) => { await p.getByRole('button', { name: /^Update status/ }).first().click(); } },
    ];
    for (const step of steps) {
      await page.goto(step.path);
      await settle(page);
      if (step.act) await step.act(page);
      const bad = await page.evaluate(() => {
        const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=checkbox], [role=radio], [tabindex]:not([tabindex="-1"])';
        const shown = (el: Element) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],[inert]') && cs.opacity !== '0';
        };
        // A link inside a sentence is exempt (WCAG 2.5.8 "inline"); a link on a line of its own is not.
        const inSentence = (el: Element) => {
          if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
          const rest = (el.parentElement?.textContent ?? '').replace(el.textContent ?? '', '').replace(/\s+/g, ' ').trim();
          return rest.length >= 3;
        };
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
        };
        const items = [...document.querySelectorAll(SEL)].filter(shown).map((el) => ({ el, r: box(el) }));
        const small = (r: { w: number; h: number }) => r.w < 23.5 || r.h < 23.5;
        const centreDistance = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
        const circleTouches = (c: ReturnType<typeof box>, r: ReturnType<typeof box>) => {
          const cx = c.x + c.w / 2;
          const cy = c.y + c.h / 2;
          return Math.hypot(cx - Math.max(r.x, Math.min(cx, r.x + r.w)), cy - Math.max(r.y, Math.min(cy, r.y + r.h))) < 12;
        };
        const out: string[] = [];
        for (const s of items.filter((i) => small(i.r) && !inSentence(i.el))) {
          // The 24px-circle spacing exception: a small target passes when its circle touches no other target.
          const crowded = items.some((o) => o.el !== s.el && !o.el.contains(s.el) && !s.el.contains(o.el) && (small(o.r) ? centreDistance(s.r, o.r) < 24 : circleTouches(s.r, o.r)));
          if (crowded) out.push(`<${s.el.tagName.toLowerCase()}> "${(s.el.getAttribute('aria-label') || s.el.textContent || '').trim().slice(0, 30)}" ${Math.round(s.r.w)}x${Math.round(s.r.h)}`);
        }
        return out;
      });
      expect.soft(bad, `[${step.label}] targets under 24x24 with no room around them`).toEqual([]);
    }
  });

  test('phones: the bottom bar never covers the control that has keyboard focus (WCAG 2.4.11)', async ({ page, signIn }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'The bottom bar is a phone layout.');
    test.setTimeout(120_000);
    await signIn(page, 'avery', '/');
    for (const path of ['/', '/plan?view=list', '/plan?view=timeline', '/decide', '/money', '/documents', '/settings', '/ready/avery']) {
      await page.goto(path);
      await settle(page);
      const covered: string[] = [];
      for (let i = 0; i < 70; i += 1) {
        await page.keyboard.press('Tab');
        const hit = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || el.closest('.app-nav')) return null;
          const r = el.getBoundingClientRect();
          if (r.height === 0 || r.bottom < 0 || r.top > innerHeight) return null;
          // What is on top at the centre of the focused control (clamped into the window)?
          const x = Math.min(Math.max(r.x + r.width / 2, 1), innerWidth - 1);
          const y = Math.min(Math.max(r.y + r.height / 2, 1), innerHeight - 1);
          const top = document.elementFromPoint(x, y);
          let bar: Element | null = null;
          for (let e: Element | null = top; e && e !== document.documentElement; e = e.parentElement) {
            const position = getComputedStyle(e).position;
            if (position === 'fixed' || position === 'sticky') {
              bar = e;
              break;
            }
          }
          return bar && !bar.contains(el) && !el.contains(top) ? `${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)} under ${bar.className || bar.tagName}` : null;
        });
        if (hit) covered.push(hit);
      }
      expect.soft(covered, `[${path}] focused controls hidden under a fixed bar`).toEqual([]);
    }
  });
});
