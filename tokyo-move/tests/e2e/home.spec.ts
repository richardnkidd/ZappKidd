import type { Locator, Page } from '@playwright/test';
import { expect, loaded, test } from './support/fixtures';

/** Home answers six questions: what matters now, who owns it, what is blocked, what decision is needed, what is next, and is each traveler ready. */

const sections = (page: Page) => ({
  now: page.getByRole('region', { name: /^This week/ }),
  decisions: page.getByRole('region', { name: /^Needs a decision/ }),
  blocked: page.getByRole('region', { name: /^Blocked/ }),
  coming: page.getByRole('region', { name: /^Coming up/ }),
  // Wide screens: a section with a card per traveler. Phones: a compact "Who's ready" list of links under the greeting.
  ready: page.getByRole('region', { name: /^Who.s ready/ }).or(page.getByRole('navigation', { name: /^Who.s ready/ })),
  recent: page.getByRole('region', { name: /^(Recent changes|Since your last review)/ }),
});

async function openHome(page: Page, signIn: (p: Page, who: 'avery' | 'jun', path?: string) => Promise<void>) {
  await signIn(page, 'avery', '/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Avery');
  await loaded(page);
  await expect(sections(page).now).toBeVisible();
  // First visit starts from "Needs me" on phones and "Everything" on wide screens; the checks below start from everything.
  const everything = page.getByRole('group', { name: 'Show items for' }).getByRole('button', { name: 'Everything', exact: true });
  await everything.click();
  await expect(everything).toHaveAttribute('aria-pressed', 'true');
}

/** Record ids (milestone:W03 ...) linked from a section, ignoring items that come from the task list. */
async function recordIds(section: Locator): Promise<string[]> {
  const ids = await section.locator('li').evaluateAll((items) => {
    const out: string[] = [];
    for (const li of items) {
      if ((li.textContent ?? '').includes('From your task list')) continue;
      const a = li.querySelector('a[href^="/r/"]');
      if (a) out.push(decodeURIComponent((a.getAttribute('href') ?? '').slice(3)));
    }
    return out;
  });
  return [...new Set(ids)];
}

test.describe('Home', () => {
  test('answers the six questions with plain, honest content', async ({ page, signIn, api }) => {
    await openHome(page, signIn);
    const s = sections(page);
    const avery = await api('avery');
    const snap = await avery.snapshot();

    // 1. What matters now.
    await expect(s.now.getByRole('heading', { level: 2 })).toBeVisible();
    const nowItems = s.now.getByRole('listitem');
    expect(await nowItems.count()).toBeGreaterThan(0);
    expect(await nowItems.count()).toBeLessThanOrEqual(5);
    // Each "now" item names a person (owner) and links to its record.
    for (const item of await nowItems.all()) {
      await expect(item.getByRole('link').first()).toBeVisible();
      await expect(item).toContainText(/Avery|Jun|Together|Unassigned|Not decided/);
    }

    // 2. What decision is needed: never more than three at once.
    const decisionItems = s.decisions.getByRole('listitem');
    const nDecisions = await decisionItems.count();
    expect(nDecisions).toBeGreaterThan(0);
    expect(nDecisions).toBeLessThanOrEqual(3);
    const openDecisions = (snap.records as any[]).filter((r) => r.type === 'decision' && (r.status === 'open' || r.status === 'proposed'));
    expect(openDecisions.length).toBeGreaterThanOrEqual(nDecisions);
    // A decision says who still has to agree.
    await expect(decisionItems.first()).toContainText(/Awaiting|Approved by|Not yet approved/);

    // 3. What is blocked, and why. Wide screens list the blocked items with their reasons; phones show one honest line
    // ("Blocked: 3") with a link to the board, and the reason lives on each item (checked at the end).
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    const blockedRecords = (snap.records as any[]).filter((r) => r.type === 'milestone' && (r.status === 'blocked' || r.status === 'waiting_external'));
    expect(blockedRecords.length).toBeGreaterThan(0);
    if (wide) {
      const blockedItems = s.blocked.getByRole('listitem');
      expect(await blockedItems.count()).toBeGreaterThan(0);
      for (const item of await blockedItems.all()) {
        const text = (await item.innerText()).replace(/\s+/g, ' ');
        expect(text, 'a blocked item always says why or what it waits for').toMatch(/(why|waiting for)\s+\S{3,}/i);
      }
      // The reason shown matches the reason stored with the record (not an empty placeholder).
      const blockedIds = await recordIds(s.blocked);
      expect(blockedIds.length).toBeGreaterThan(0);
      for (const id of blockedIds) {
        const rec = (snap.records as any[]).find((r) => r.id === id);
        expect(['blocked', 'waiting_external']).toContain(rec.status);
        expect(String(rec.data.status_reason ?? '').length, `${id} has a written reason`).toBeGreaterThan(5);
      }
    } else {
      await expect(s.blocked).toContainText(new RegExp(`Blocked:\\s*${blockedRecords.length}(?!\\d)`));
      await expect(s.blocked.getByRole('link', { name: /See what.s blocked/ })).toHaveAttribute('href', /\/plan\?view=board/);
    }

    // 4. What is next / coming up: dated rows with a real <time>, nothing invented.
    await expect(s.coming.locator('time[datetime]').first()).toBeVisible();
    const dates = await s.coming.locator('time[datetime]').evaluateAll((els) => els.map((e) => e.getAttribute('datetime')));
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 5. Is each traveler ready: one card per traveler (two adults and the dog), each with a state word.
    for (const name of ['Avery', 'Jun', 'Mochi']) {
      const card = s.ready.getByRole('listitem').filter({ hasText: name }).first();
      await expect(card, `readiness for ${name}`).toBeVisible();
      await expect(card).toContainText(/Not started|Preparing|Blocked|Ready for your go-ahead|Cleared to travel|Arrived|Settled in/);
    }

    // 6. What changed lately.
    await expect(s.recent.getByRole('listitem').first()).toBeVisible();
    await expect(s.recent.locator('time[datetime]').first()).toBeVisible();

    // Honest numbers: no completion percentages anywhere on Home, no internal record codes in normal text.
    const text = await page.locator('body').innerText();
    expect(text, 'no "%" anywhere on Home').not.toContain('%');
    expect(text).not.toMatch(/\b\d+\s*percent\b/i);
    expect(text, 'no internal IDs such as W06 or DOC12 on Home').not.toMatch(/\b(W\d{2}|DOC\d{2}|D\d{2}|R\d{2}|Q\d{3})\b/);

    // However it is summarised on Home, every blocked item says why on its own page, in the words stored with it.
    for (const rec of blockedRecords.filter((r) => r.status === 'blocked')) {
      await page.goto(`/r/${encodeURIComponent(rec.id)}`);
      await expect(page.getByRole('heading', { level: 1, name: rec.title })).toBeVisible();
      await expect(page.getByText(/Why it.s blocked/)).toBeVisible();
      expect(String(rec.data.status_reason ?? '').length).toBeGreaterThan(5);
      await expect(page.getByRole('main')).toContainText(String(rec.data.status_reason).slice(0, 14));
    }
  });

  test('the owner filters change what is listed', async ({ page, signIn, api }) => {
    await openHome(page, signIn);
    const s = sections(page);
    const snap = await (await api('avery')).snapshot();
    const byId = new Map<string, any>((snap.records as any[]).map((r) => [r.id, r]));
    const ownerOf = (id: string) => byId.get(id)?.owner ?? 'unassigned';

    const group = page.getByRole('group', { name: 'Show items for' });
    await expect(group).toBeVisible();
    const chip = (name: string | RegExp) => group.getByRole('button', { name, exact: typeof name === 'string' });
    for (const label of ['Everything', 'Needs me', 'Only mine', 'Together', 'Unassigned', 'Waiting on someone else']) {
      await expect(chip(label)).toBeVisible();
    }
    await expect(chip(/^Jun.s$/)).toBeVisible(); // the other adult, by name
    await expect(chip('Everything')).toHaveAttribute('aria-pressed', 'true');

    const listed = async () => {
      // Now + Blocked + Decisions together; decisions link to /decide#decision-D02, so read those separately.
      const ids = [...(await recordIds(s.now)), ...(await recordIds(s.blocked))];
      const textOf = async (l: Locator) => ((await l.count()) > 0 ? await l.innerText() : '');
      return { ids, text: ((await textOf(s.now)) + (await textOf(s.blocked)) + (await textOf(s.decisions))).replace(/\s+/g, ' ') };
    };
    const filters: { chip: string | RegExp; allows: (id: string) => boolean; empty: RegExp }[] = [
      // "Needs me" is wider than "Only mine": mine, shared with me, or (for decisions) waiting for my approval.
      { chip: 'Needs me', allows: (id) => ['avery', 'together'].includes(ownerOf(id)), empty: /Nothing (here|is blocked)|No open decisions/ },
      { chip: 'Only mine', allows: (id) => ownerOf(id) === 'avery', empty: /Nothing (here|is blocked|waiting|is waiting)|No open decisions/ },
      { chip: /^Jun.s$/, allows: (id) => ownerOf(id) === 'jun', empty: /Nothing (here|is blocked)|No open decisions/ },
      { chip: 'Together', allows: (id) => ownerOf(id) === 'together', empty: /Nothing (here|is blocked)|No open decisions/ },
      { chip: 'Unassigned', allows: (id) => ['unassigned', null].includes(byId.get(id)?.owner ?? null), empty: /Nothing (here|is blocked)|No open decisions/ },
      { chip: 'Waiting on someone else', allows: (id) => byId.get(id)?.status === 'waiting_external', empty: /Nothing (here|is blocked)|No open decisions/ },
    ];

    const everything = await listed();
    const seen = new Map<string, string[]>();
    for (const f of filters) {
      await chip(f.chip).click();
      await expect(chip(f.chip)).toHaveAttribute('aria-pressed', 'true');
      await expect(chip('Everything')).toHaveAttribute('aria-pressed', 'false');
      const now = await listed();
      for (const id of now.ids) expect(f.allows(id), `${id} (${ownerOf(id)}, ${byId.get(id)?.status}) should not be listed under "${String(f.chip)}"`).toBe(true);
      // When nothing matches the page says so in words instead of showing an empty box.
      if (now.ids.length === 0) expect(now.text).toMatch(f.empty);
      seen.set(String(f.chip), now.ids);
    }
    // The filters really do different things: the two adults' lists share nothing, and not every view equals "Everything".
    const mine = seen.get('Only mine')!;
    const jun = seen.get(String(/^Jun.s$/))!;
    expect(mine.filter((id) => jun.includes(id))).toEqual([]);
    expect(mine.length + jun.length + (seen.get('Together')?.length ?? 0)).toBeGreaterThan(0);
    const differing = [...seen.values()].filter((ids) => ids.join() !== everything.ids.join());
    expect(differing.length).toBeGreaterThan(0);
    // The waiting view shows the demo's one "waiting on someone else" item with what it waits for.
    await chip('Waiting on someone else').click();
    await expect(s.now.getByRole('listitem').first()).toContainText(/waiting|employer/i);
    expect((await recordIds(s.now)).length).toBeGreaterThan(0);

    // Back to everything restores the first list.
    await chip('Everything').click();
    expect((await listed()).ids).toEqual(everything.ids);
  });

  test('the first visit starts from "Needs me" on a phone and from everything on a wide screen', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/');
    await loaded(page);
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    const group = page.getByRole('group', { name: 'Show items for' });
    await expect(group.getByRole('button', { name: wide ? 'Everything' : 'Needs me', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { pressed: true })).toHaveCount(1);
  });

  test('remembers the chosen filter for this person on this device', async ({ page, signIn }) => {
    await openHome(page, signIn);
    const group = page.getByRole('group', { name: 'Show items for' });
    await group.getByRole('button', { name: 'Together' }).click();
    await expect(group.getByRole('button', { name: 'Together' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await loaded(page);
    await expect(page.getByRole('group', { name: 'Show items for' }).getByRole('button', { name: 'Together' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('group', { name: 'Show items for' }).getByRole('button', { name: 'Everything' }).click();
  });

  test('a decision on Home opens the Decide screen', async ({ page, signIn }) => {
    await openHome(page, signIn);
    const s = sections(page);
    const link = s.decisions.getByRole('link').first();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/decide/);
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Decide' })).toBeVisible();
    await expect(page).toHaveURL(/\/decide/);
  });
});
