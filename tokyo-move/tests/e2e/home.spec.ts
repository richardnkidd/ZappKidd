import type { Browser, Page, TestInfo } from '@playwright/test';
import { baseUrlFor, type E2EServer } from './support/env';
import { expect, loaded, newContext, test } from './support/fixtures';

/**
 * Home fits about one phone screen: "Your turn" (three rows at most), "Stuck" (two at most), "Travellers", and one
 * "since you last looked" line. Tests that write use a different throw-away server per project, so the phone,
 * small-phone and desktop runs never complete the same item at the same moment.
 */

const WRITE_SERVER: Record<string, E2EServer> = { phone: 'failcreate', 'small-phone': 'snapshot', desktop: 'main' };
const enc = encodeURIComponent;

const region = (page: Page, name: RegExp | string) => page.getByRole('region', { name });

/** A page signed in as `who` on another of the test servers (its own cookies). */
async function pageOn(browser: Browser, testInfo: TestInfo, server: E2EServer, who: 'avery' | 'jun', path = '/') {
  const url = baseUrlFor(server);
  const context = await newContext(browser, testInfo, url);
  const res = await context.request.post('/api/auth/dev-login', { data: { person_id: who }, headers: { Origin: new URL(url).origin } });
  expect(res.status()).toBe(200);
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await loaded(page);
  return { context, page };
}

/** Put a status change back (cleanup; never fails the test on its own). */
async function undo(api: { raw: (m: 'POST', p: string, d?: unknown) => Promise<unknown> }, auditId: string | null | undefined) {
  if (auditId) await api.raw('POST', `/api/audit/${enc(auditId)}/undo`, {}).catch(() => undefined);
}

test.describe('Home', () => {
  test('fits about one screen: your turn, stuck, travellers; nothing else', async ({ page, signIn, api }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Avery’s home, \w{3}, \w{3} \d{1,2} · /);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const turn = region(page, /^Your turn/);
    await expect(turn).toBeVisible();
    const rows = turn.getByRole('listitem');
    expect(await rows.count()).toBeGreaterThan(0);
    expect(await rows.count()).toBeLessThanOrEqual(3);
    await expect(turn.getByRole('link', { name: 'See everything' })).toHaveAttribute('href', '/plan?view=list');

    // Travellers: one chip per traveller saying what is left, never just "Preparing", each opening its readiness page.
    const travellers = region(page, 'Travellers');
    for (const [id, name] of [['avery', 'Avery'], ['jun', 'Jun'], ['mochi', 'Mochi']]) {
      const chip = travellers.getByRole('link', { name: new RegExp(`^${name}:`) });
      await expect(chip).toHaveAttribute('href', `/ready/${id}`);
      await expect(chip).toHaveAccessibleName(new RegExp(`^${name}: (\\d+ left|Ready to go|Cleared to travel|Arrived|Settled in|Nothing left|Not set up yet)`));
      await expect(chip).not.toContainText('Preparing');
    }

    // Gone from Home: the owner filters, "This week", "Coming up", "Past their date", "Recent changes", the freshness footer.
    await expect(page.getByRole('group', { name: 'Show items for' })).toHaveCount(0);
    for (const gone of [/^This week/, /^Coming up/, /^Needs a decision/, /^Recent changes/, /^Since your last review/, /^Who.s ready/]) {
      await expect(region(page, gone)).toHaveCount(0);
    }
    const text = await page.getByRole('main').innerText();
    for (const phrase of ['Past their date', 'Plan imported', 'This page loaded', 'At most three at a time', 'Preparing', '%']) {
      expect(text, `"${phrase}" is not on Home`).not.toContain(phrase);
    }
    expect(text, 'no internal codes').not.toMatch(/\b(W\d{2}|DOC\d{2}|D\d{2}|R\d{2}|Q\d{3})\b/);

    // Plan still offers every dated item, by link.
    const snap = await (await api('avery')).snapshot();
    expect((snap.records as any[]).length).toBeGreaterThan(0);

    // About one phone screen with the demo data, and never wider than the screen.
    const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(size.w, 'no sideways scrolling').toBeLessThanOrEqual(size.vw);
    // About 955px with the fresh demo; other specs on this server can add the one "since you last looked" line.
    if (page.viewportSize()!.width === 390) expect(size.h, 'Home is about one phone screen').toBeLessThanOrEqual(1100);
  });

  test('your turn shows at most three decisions, phrased for a person, and they open the decision', async ({ page, signIn, api }) => {
    // Jun has three decisions waiting in the demo; one is answered by Avery already.
    const snap = await (await api('jun')).snapshot();
    const d04 = (snap.records as any[]).find((r) => r.id === 'decision:D04');
    await signIn(page, 'jun', '/');
    await loaded(page);
    const turn = region(page, /^Your turn/);
    const decisionRows = turn.getByRole('listitem').filter({ has: page.locator('a[href^="/decide"]') });
    expect(await decisionRows.count()).toBeGreaterThan(0);
    expect(await decisionRows.count()).toBeLessThanOrEqual(3);
    expect(await turn.getByRole('listitem').count()).toBeLessThanOrEqual(3);
    for (const row of await decisionRows.all()) {
      await expect(row.getByRole('link')).toHaveAccessibleName(/^(Decide: .+|Avery chose “[^”]+”\. Agree\?|You chose differently: .+)$/);
    }
    if (d04?.status === 'proposed' && (d04.data.approvals as any[]).some((a) => a.person_id === 'avery') && !(d04.data.approvals as any[]).some((a) => a.person_id === 'jun')) {
      // Other specs on this server can add decisions Avery answered, so pick D04's row by where it goes.
      const agree = turn.locator('a[href="/decide#decision-D04"]');
      await expect(agree).toHaveAccessibleName(/^Avery chose “.+”\. Agree\?/);
      await agree.click();
      await expect(page).toHaveURL(/\/decide#decision-D04$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Decide' })).toBeVisible();
    }
  });

  test('one tap marks an item done, says so, and Undo puts it back', async ({ browser, api }, testInfo) => {
    const server = WRITE_SERVER[testInfo.project.name]!;
    const avery = await api('avery', server);
    const { context, page } = await pageOn(browser, testInfo, server, 'avery');
    let auditId: string | null = null;
    try {
      const turn = region(page, /^Your turn/);
      const done = turn.getByRole('button', { name: /^Mark .+ done$/ }).first();
      await expect(done).toBeVisible();
      const box = (await done.boundingBox())!;
      expect(box.height, '44px target').toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      const title = (await done.getAttribute('aria-label'))!.replace(/^Mark (.+) done$/, '$1');
      const row = turn.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Mark ${title} done` }) });
      const recordId = decodeURIComponent((await row.locator('a[href^="/r/"]').getAttribute('href'))!.slice(3));
      const before = await avery.record(recordId);

      await done.click();
      // Said in a live region, with a keyboard-reachable Undo that has focus.
      await expect(turn.getByRole('status')).toContainText('Marked done');
      const undo = turn.getByRole('button', { name: 'Undo' });
      await expect(undo).toBeFocused();
      await expect(turn.getByRole('button', { name: `Mark ${title} done` })).toHaveCount(0);

      // Saved through the status endpoint, with no evidence asked for, and history says who and when.
      const after = await avery.record(recordId);
      expect(after.status).toBe('completed');
      expect(after.version).toBe(before.version + 1);
      const history = await avery.get(`/api/audit?record_id=${enc(recordId)}`);
      const entry = (history.entries ?? history)[0];
      expect(entry).toMatchObject({ action: 'status_change', actor: 'avery' });
      expect(entry.after.status).toBe('completed');
      auditId = entry.id;

      // Undo, by keyboard.
      await page.keyboard.press('Enter');
      await expect(turn.getByRole('status')).toContainText(/Undone/);
      await expect(turn.getByRole('button', { name: `Mark ${title} done` })).toBeVisible();
      expect((await avery.record(recordId)).status).toBe(before.status);
      auditId = null;
    } finally {
      await undo(avery, auditId);
      await context.close();
    }
  });

  test('"Stuck" lists at most two, says what each waits on, and "See all" lands on the same count of blocked items', async ({ browser }, testInfo) => {
    const { context, page } = await pageOn(browser, testInfo, 'failcreate', 'avery');
    try {
      const stuck = region(page, /^Stuck/);
      await expect(stuck).toBeVisible();
      const heading = await stuck.getByRole('heading', { level: 2 }).innerText();
      const count = Number(/\((\d+)\)/.exec(heading)![1]);
      const rows = stuck.getByRole('listitem');
      expect(await rows.count()).toBe(Math.min(count, 2));
      for (const row of await rows.all()) await expect(row).toHaveText(/^.+ — (waiting on .+|no reason written yet)$/);
      const firstTitle = await rows.first().getByRole('link').innerText();
      const seeAll = stuck.getByRole('link', { name: `See all ${count} stuck` });
      // The List view with "Stuck" chosen: the same word as Home, the same count, and only blocked items.
      await expect(seeAll).toHaveAttribute('href', '/plan?view=workstream&status=blocked');
      await seeAll.click();
      await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
      await loaded(page);
      await expect(page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Stuck', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('status').filter({ hasText: /^Showing \d+ of \d+$/ })).toHaveText(new RegExp(`^Showing ${count} of `));
      const cards = page.getByRole('main').getByRole('listitem').filter({ has: page.locator('a[href^="/r/"]') });
      await expect(cards).toHaveCount(count);
      // A list of only the blocked items, starting near the top: not a board with the column screens down.
      const first = page.getByRole('main').getByRole('link', { name: firstTitle, exact: true }).first();
      await expect(first).toBeVisible();
      const vh = page.viewportSize()!.height;
      const top = await first.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      // On a 320x640 phone the Plan page's own header and filter row push it just past the first screen.
      expect(top, 'first blocked item near the top of Plan').toBeLessThan(vh < 700 ? vh * 1.25 : vh);
    } finally {
      await context.close();
    }
  });

  test('"since you last looked" counts what the other adult did, lists it as actions, and marks it seen', async ({ browser, api }, testInfo) => {
    const server = WRITE_SERVER[testInfo.project.name]!;
    const avery = await api('avery', server);
    const jun = await api('jun', server);
    await avery.post('/api/me/seen', {});
    const target = 'milestone:W08';
    const m = await jun.record(target);
    const done = await jun.post(`/api/records/${enc(target)}/status`, { baseVersion: m.version, status: 'completed' });
    const { context, page } = await pageOn(browser, testInfo, server, 'avery');
    try {
      const line = page.getByRole('button', { name: /^Jun did \d+ things? since you last looked$/ });
      await expect(line).toBeVisible();
      await expect(line).toHaveAttribute('aria-expanded', 'false');
      const seenBefore = (await avery.snapshot()).last_seen_at as string;
      await line.click();
      await expect(line).toHaveAttribute('aria-expanded', 'true');
      const list = page.getByRole('region', { name: 'Since you last looked' }).getByRole('listitem');
      await expect(list.filter({ hasText: /^Jun finished “.+”$/ }).first()).toBeVisible();
      const all = (await list.allInnerTexts()).join('\n');
      expect(all).not.toMatch(/import|brought in/i);
      await expect.poll(async () => (await avery.snapshot()).last_seen_at > seenBefore).toBe(true);
    } finally {
      await undo(jun, done.undo_audit_id);
      await context.close();
    }
  });

  test('stays readable at 200% text without sideways scrolling', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    // Through the CSSOM (the app's content security policy refuses inline style tags).
    await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'));
    await expect(region(page, /^Your turn/)).toBeVisible();
    const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(size.w).toBeLessThanOrEqual(size.vw);
  });
});
