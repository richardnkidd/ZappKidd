import type { Page } from '@playwright/test';
import { expect, loaded, newContext, openAccount, test } from './support/fixtures';

/**
 * A date-only deadline ("Wed, Nov 11") is a calendar date, not a moment. Changing the display time zone may change
 * what "today" is and how times of day are written, but never the text of a date-only deadline.
 */

const ZONES = [
  { option: 'Tokyo (JST)', short: 'JST' },
  { option: 'New York (EST/EDT)', short: 'EST|EDT' },
  { option: 'Honolulu (HST)', short: 'HST' },
] as const;

/**
 * Pages to check. On Home the "Coming up" window moves with "today", so a date near the edge may legitimately appear or
 * disappear when the zone changes; every date that is on screen both times must read the same (`windowed`).
 */
const PAGES: { path: string; windowed: boolean }[] = [
  { path: '/', windowed: true },
  { path: '/plan?view=list', windowed: false },
  { path: '/plan?view=timeline', windowed: false },
  { path: '/r/milestone%3AW06', windowed: false },
  { path: '/r/milestone%3AW23', windowed: false },
  { path: '/decide', windowed: false },
];

/** datetime attribute -> visible text, for every date-only <time> on the page (one text per date, or the test fails). */
async function dateOnlyTimes(page: Page): Promise<Record<string, string>> {
  const raw = await page.locator('main time[datetime]').evaluateAll((els) => {
    const out: Record<string, string[]> = {};
    for (const el of els) {
      const dt = el.getAttribute('datetime') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) continue;
      (out[dt] ??= []).push((el.textContent ?? '').trim());
    }
    return out;
  });
  const out: Record<string, string> = {};
  for (const [dt, texts] of Object.entries(raw)) {
    expect(new Set(texts).size, `${dt} is always written the same way on one page (${texts.join(' | ')})`).toBe(1);
    out[dt] = texts[0]!;
  }
  return out;
}

function expectSameDates(now: Record<string, string>, baseline: Record<string, string>, windowed: boolean, label: string) {
  if (!windowed) {
    expect(now, label).toEqual(baseline);
    return;
  }
  const shared = Object.keys(baseline).filter((k) => k in now);
  expect(shared.length, `${label}: some dates are on screen both times`).toBeGreaterThan(0);
  for (const k of shared) expect(now[k], `${label}: ${k}`).toBe(baseline[k]);
}

/** Full instants (with a time of day), which SHOULD follow the display zone. */
async function instants(page: Page): Promise<string[]> {
  return page.locator('main time[datetime]').evaluateAll((els) =>
    els.filter((el) => /T\d{2}:\d{2}/.test(el.getAttribute('datetime') ?? '')).map((el) => (el.textContent ?? '').trim()),
  );
}

async function chooseZone(page: Page, option: string) {
  const dialog = await openAccount(page, 'Avery');
  await dialog.getByRole('combobox', { name: 'Show times in' }).selectOption({ label: option });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('Time zones', () => {
  test('switching the display zone never changes a date-only deadline', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    for (const { path, windowed } of PAGES) {
      await page.goto(path);
      await loaded(page);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Start every page from Honolulu (the household's own zone) and record the dates.
      await chooseZone(page, 'Honolulu (HST)');
      const baseline = await dateOnlyTimes(page);
      expect(Object.keys(baseline).length, `${path} shows at least one date-only value`).toBeGreaterThan(0);

      for (const zone of ZONES) {
        await chooseZone(page, zone.option);
        await expect(page.getByRole('button', { name: new RegExp(`(${zone.short}) time`) })).toBeVisible();
        const now = await dateOnlyTimes(page);
        expectSameDates(now, baseline, windowed, `${path} dates in ${zone.option}`);
      }
    }
  });

  test('times of day do follow the zone, and the page says which zone it is using', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    await chooseZone(page, 'Honolulu (HST)');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Avery');
    await expect(page.getByText(/· Honolulu time/)).toBeVisible();
    const hst = await instants(page);
    expect(hst.length).toBeGreaterThan(0);
    for (const t of hst) expect(t).toMatch(/HST/);

    await chooseZone(page, 'Tokyo (JST)');
    await expect(page.getByText(/· Tokyo time/)).toBeVisible();
    const jst = await instants(page);
    expect(jst).toHaveLength(hst.length);
    for (const t of jst) expect(t).toMatch(/JST/);
    expect(jst, 'the same moments are written differently in another zone').not.toEqual(hst);

    await chooseZone(page, 'New York (EST/EDT)');
    await expect(page.getByText(/· New York time/)).toBeVisible();
    for (const t of await instants(page)) expect(t).toMatch(/E[SD]T/);
  });

  test('the zone choice is remembered for this person, and the dates are the same', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/plan?view=list');
    await loaded(page);
    const baseline = await dateOnlyTimes(page);
    await chooseZone(page, 'Tokyo (JST)');
    await page.reload();
    await loaded(page);
    await expect(page.getByRole('button', { name: /JST time/ })).toBeVisible();
    expect(await dateOnlyTimes(page)).toEqual(baseline);
  });

  test('the computer’s own time zone makes no difference either', async ({ browser, baseURL }, testInfo) => {
    const results: Record<string, Record<string, string[]>> = {};
    // Far ahead of Tokyo (UTC+14), far behind Honolulu (UTC-11), and the default.
    for (const tz of [undefined, 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const context = await newContext(browser, testInfo, baseURL!, tz ? { timezoneId: tz } : {});
      try {
        const res = await context.request.post('/api/auth/dev-login', { data: { person_id: 'avery' }, headers: { Origin: new URL(baseURL!).origin } });
        expect(res.status()).toBe(200);
        const page = await context.newPage();
        await page.goto('/plan?view=list');
        await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
        await loaded(page);
        await expect(page.getByRole('table').or(page.getByRole('list')).first()).toBeVisible();
        results[tz ?? 'default'] = await dateOnlyTimes(page);
      } finally {
        await context.close();
      }
    }
    const keys = Object.keys(results);
    expect(Object.keys(results['default']!).length).toBeGreaterThan(5);
    for (const k of keys) expectSameDates(results[k]!, results['default']!, false, `dates with the computer set to ${k}`);
  });
});
