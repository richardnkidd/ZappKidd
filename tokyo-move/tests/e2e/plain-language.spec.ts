import { expect, loaded, test } from './support/fixtures';
import { FIXED_ROUTES, recordRoutes } from './support/routes';

/**
 * Design principle 3: plain language. Internal codes (W45, DOC12), raw status words (in_progress), raw timestamps and
 * "undefined"/"NaN" never appear in normal screens. IDs live only in the collapsed "Source & history" panel on a record
 * and on the Data screen, so those two places are excluded.
 */

const INTERNAL_ID = /\b(W\d{2}|S\d{2}|Q\d{3}|D\d{2}|R\d{2}|DOC\d{2}|B\d{2}|A\d{2}|Y\d{2}|EC-[A-Z0-9-]+|CT-[a-z0-9-]+|RULE-[A-Z0-9-]+)\b/;
const RAW_ENUM = /\b(?:in_progress|waiting_external|not_applicable|pending_capture|pending_update|household_approved|user_committed|internal_target|review_date|verified_official|planning_zero|potential_resource)\b/;
const SNAKE_CASE = /\b[a-z]{2,}_[a-z]{2,}(?:_[a-z]+)*\b/;
const RAW_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const BROKEN = /\bNaN\b|\bundefined\b|\[object |\bnull\b/;

test.describe('Plain language', () => {
  test('no internal codes, raw enum words, raw timestamps or broken values on any normal screen', async ({ page, signIn, api }) => {
    test.setTimeout(180_000);
    await signIn(page, 'avery', '/');
    await loaded(page);
    const routes = [...FIXED_ROUTES, ...(await recordRoutes(await api('avery')))].filter((r) => r.path !== '/data');
    const failures: string[] = [];
    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await loaded(page);
      await page.waitForLoadState('networkidle');
      const text = await page.getByRole('main').innerText();
      for (const [label, re] of [
        ['an internal ID', INTERNAL_ID],
        ['a raw status word', RAW_ENUM],
        ['a snake_case token', SNAKE_CASE],
        ['a raw timestamp', RAW_TIMESTAMP],
        ['a broken value', BROKEN],
      ] as const) {
        const m = text.match(re);
        if (m) failures.push(`${route.label} (${route.path}) shows ${label}: "${m[0]}" near "${text.slice(Math.max(0, m.index! - 30), m.index! + 40).replace(/\s+/g, ' ')}"`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('the browser tab title names the page', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    for (const [path, expected] of [
      ['/plan', /^Plan/],
      ['/decide', /^Decide/],
      ['/money', /^Money/],
      ['/more', /^More/],
      ['/settings', /^Settings/],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page).toHaveTitle(expected);
      await expect(page).toHaveTitle(/Kadode/);
    }
  });
});
