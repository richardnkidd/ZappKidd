import type { Page, TestInfo } from '@playwright/test';
import { baseUrlFor } from './support/env';
import { addDays, expect, loaded, test, todayInZone } from './support/fixtures';

/**
 * The "later" screens: Money, Documents, Contacts & evidence, Arrival, Future work, Data, Settings, the couple review,
 * "what if the pet arrives later?" and the printable arrival pack.
 *
 * Each test first checks the route is a real screen. While a route still shows the "This part is being built"
 * placeholder (or does not exist yet) the test is skipped with that reason, so the suite stays honest as screens land.
 *
 * Tests that change household-wide state (the exchange rate, the money scenarios) run in the desktop project only and
 * put everything back; the others use their own items per browser project.
 */

const enc = encodeURIComponent;
const PROJECTS = ['phone', 'small-phone', 'desktop'];
const pick = <T>(info: TestInfo, list: T[]): T => list[Math.max(0, PROJECTS.indexOf(info.project.name)) % list.length]!;
const desktopOnly = (info: TestInfo) => test.skip(info.project.name !== 'desktop', 'Changes household-wide settings, so it runs once (desktop).');

/** Open a route; skip the test if it is still a placeholder or not routed yet. */
async function openScreen(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await loaded(page);
  const notFound = await page.getByRole('heading', { level: 1, name: /couldn.t find that page/i }).count();
  test.skip(notFound > 0, `${path} is not routed yet`);
  const placeholder = await page.getByText('This part is being built.').count();
  test.skip(placeholder > 0, `${path} is still a placeholder`);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** The money sections ("One-time move", ...) are folded up; open one and return it. */
async function openMoneyGroup(page: Page, name: string) {
  const group = page.getByRole('group').filter({ has: page.getByRole('heading', { name }) });
  const open = await group.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!open) await group.getByRole('heading', { name }).click();
  await expect(group.getByRole('list').first()).toBeVisible();
  return group;
}

const noBrokenValues = (text: string) => {
  expect(text).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b|Infinity|\[object /);
};

/* ------------------------------------------------------------------ Money */

test.describe('Money', () => {
  test('unknown amounts stay unknown, totals say they are partial, and scenarios switch', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/money', 'Money');
    const main = page.getByRole('main');

    // Honest about what is not known (the demo has a yen amount but no exchange rate, and unverified income).
    await expect(main).toContainText(/Can.t conclude yet/);
    await expect(main).toContainText(/not the full need/);
    await expect(main).toContainText(/Not shown until everything is known/);
    await expect(page.getByRole('region', { name: 'Exchange rate' })).toContainText('No exchange rate yet');
    // The sections are folded up; opening one shows the line that waits for the rate, and a line with no amount.
    const oneTime = await openMoneyGroup(page, 'One-time move');
    await expect(oneTime).toContainText(/Needs the JPY-per-USD exchange rate/);
    await expect(oneTime).toContainText('Not known yet');
    await expect(oneTime.getByRole('button', { name: /^Add amount: / }).first()).toBeVisible();
    await expect(page.getByRole('group').filter({ has: page.getByRole('heading', { name: 'Tokyo monthly' }) })).toContainText('No amounts yet');
    noBrokenValues(await main.innerText());

    // Scenarios: one is chosen at a time; the explanation changes with it.
    const group = page.getByRole('group', { name: 'Scenario' });
    const status = page.getByRole('status').filter({ hasText: /nothing extra assumed|more months|fewer yen|stress/i });
    await expect(group.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Condo delay', 'Delay + stronger yen', 'Planning']) {
      await group.getByRole('button', { name }).click();
      await expect(group.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
    // The stress case is worded in terms of the dollar: it buys fewer yen, so yen costs are more in dollars.
    await group.getByRole('button', { name: 'Delay + stronger yen' }).click();
    await expect(status).toContainText('the dollar buying 10% fewer yen');
    await expect(page.getByRole('region', { name: 'Exchange rate' })).toContainText('If the dollar buys 10% fewer yen, fixed-yen costs are 11.11% more in dollars.');
    await expect(main).not.toContainText(/weaker yen|yen weaker/i);
    await group.getByRole('button', { name: 'Condo delay' }).click();
    await expect(status).toContainText(/months/);
    await group.getByRole('button', { name: 'Planning' }).click();
    await expect(status).toContainText(/nothing extra assumed/);

    // Time span: 90 days or three years.
    const span = page.getByRole('group', { name: 'Time span' });
    await span.getByRole('button', { name: 'Three-year view' }).click();
    await expect(span.getByRole('button', { name: 'Three-year view' })).toHaveAttribute('aria-pressed', 'true');
    noBrokenValues(await main.innerText());
    await span.getByRole('button', { name: 'First 90 days' }).click();
    await expect(span.getByRole('button', { name: 'First 90 days' })).toHaveAttribute('aria-pressed', 'true');

    // Unverified income is not counted; the planning assumption for the other adult is labelled as an assumption.
    await expect(main.getByRole('region', { name: 'Income' })).toContainText(/Not counted/);
    await expect(main.getByRole('region', { name: 'Income' })).toContainText(/planning|assumption/i);
  });

  test('entering the exchange rate turns yen into dollars; clearing it makes them unknown again', async ({ page, signIn }, testInfo) => {
    desktopOnly(testInfo);
    await signIn(page, 'avery');
    await openScreen(page, '/money', 'Money');
    const rate = page.getByRole('region', { name: 'Exchange rate' });
    await expect(rate).toContainText('No exchange rate yet');

    const setRate = async (value: string, source: string) => {
      await rate.getByRole('button', { name: /^(Add rate|Edit)$/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Exchange rate' });
      await dialog.getByRole('textbox', { name: 'Yen per US dollar' }).fill(value);
      await dialog.getByRole('textbox', { name: 'Where did the rate come from?' }).fill(source);
      await dialog.getByRole('textbox', { name: 'Date of the rate' }).fill(value ? '2026-10-29' : '');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toHaveCount(0);
    };

    try {
      await setRate('150', 'Demo rate typed by the test');
      await expect(rate).toContainText('¥150 per $1');
      await expect(rate).toContainText('Demo rate typed by the test');
      await expect(rate.getByRole('button', { name: 'Edit' })).toBeVisible();
      // The yen deposit (960,000 yen) is now about 6,400 dollars and no longer asks for a rate.
      const oneTime = await openMoneyGroup(page, 'One-time move');
      await expect(oneTime.getByText('$6,400').first()).toBeVisible();
      await expect(oneTime).not.toContainText('Needs the JPY-per-USD exchange rate');
      noBrokenValues(await page.getByRole('main').innerText());
    } finally {
      await setRate('', '');
    }
    await expect(rate).toContainText('No exchange rate yet');
    await expect(rate.getByRole('button', { name: 'Add rate' })).toBeVisible();
    const again = await openMoneyGroup(page, 'One-time move');
    await expect(again).toContainText('Needs the JPY-per-USD exchange rate');
  });
});

/* ------------------------------------------------------------------ Documents */

test.describe('Documents', () => {
  test('keeps status and a restricted link only: nothing can be uploaded', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/documents', 'Documents');
    await expect(page.getByText('Originals are not stored here.')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /upload|attach|add file/i })).toHaveCount(0);

    // Each document is one compact row (status, who holds it, when it is needed); "Details" holds the rest.
    const first = page.getByRole('article').first();
    await expect(first).toContainText(/Held by/);
    await expect(first).toContainText(/Needed by/);
    await expect(first.getByRole('button', { name: /^Update status: / })).toBeVisible();
    await first.getByRole('heading', { name: 'Details' }).click();
    await expect(first.getByRole('list', { name: 'Where this document is' })).toContainText(/Requested/);
    await expect(first).toContainText(/Restricted link/);

    // Filtering by person narrows the list and the counts add up.
    const filter = page.getByRole('group', { name: 'Show documents for' });
    const everyone = await page.getByRole('article').count();
    await filter.getByRole('button', { name: /^Mochi/ }).click();
    await expect(filter.getByRole('button', { name: /^Mochi/ })).toHaveAttribute('aria-pressed', 'true');
    const mochi = await page.getByRole('article').count();
    expect(mochi).toBeGreaterThan(0);
    expect(mochi).toBeLessThan(everyone);
    await filter.getByRole('button', { name: /^Everyone/ }).click();
    await expect(page.getByRole('article')).toHaveCount(everyone);

    // "Which documents": what needs action now, or has not been started; the chip counts match the list.
    const which = page.getByRole('group', { name: 'Which documents' });
    const notStarted = which.getByRole('button', { name: /^Not started/ });
    const expected = Number(((await notStarted.innerText()).match(/(\d+)\s*$/) ?? [])[1]);
    await notStarted.click();
    await expect(notStarted).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('article')).toHaveCount(expected);
    for (const a of await page.getByRole('article').all()) await expect(a).toContainText('Not started');
    await which.getByRole('button', { name: /^Needs action now/ }).click();
    expect(await page.getByRole('article').count()).toBeGreaterThan(0);
    await which.getByRole('button', { name: /^All/ }).click();
    await expect(page.getByRole('article')).toHaveCount(everyone);
  });

  test('updating a document records dates, and only accepts a safe https link', async ({ page, signIn, api }, testInfo) => {
    const title = pick(testInfo, ['Passports and renewal receipts', 'Storage contract', 'Marriage and civil records with translations']);
    await signIn(page, 'avery');
    await openScreen(page, '/documents', 'Documents');
    const card = page.getByRole('article', { name: title });
    await card.getByRole('button', { name: `Update status: ${title}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Update this document' });

    // A link that is not https is refused with a plain message; nothing is saved.
    await dialog.getByRole('textbox', { name: 'Restricted link' }).fill('javascript:alert(1)');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/https/);
    await expect(dialog).toBeVisible();

    // Unknown stays unknown: leaving a date empty keeps it empty.
    await dialog.getByRole('textbox', { name: 'Restricted link' }).fill('');
    const avery = await api('avery');
    const before = ((await avery.get('/api/records?type=document')).records as any[]).find((r) => r.title === title);
    const marker = '2026-10-27';
    await dialog.getByRole('textbox', { name: 'Reviewed on' }).fill(marker);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    try {
      await card.getByRole('heading', { name: 'Details' }).click();
      await expect(card.getByRole('list', { name: 'Where this document is' })).toContainText('Oct 27, 2026');
      const after = await avery.record(before.id);
      expect(JSON.stringify(after.data)).toContain(marker);
    } finally {
      // Put it back the way it was.
      const now = await avery.record(before.id);
      await avery.patch(`/api/records/${enc(before.id)}`, { baseVersion: now.version, changes: { data: { reviewed_on: before.data.reviewed_on ?? null } }, reason: 'e2e cleanup' }, [200, 422]);
    }
  });
});

test.describe('Documents: who carries them, and how sensitive they are', () => {
  // Its own server: marking documents changes what every traveler's arrival pack lists.
  test.use({ baseURL: baseUrlFor('snapshot') });

  test('can be set from the document dialog, and the arrival pack follows', async ({ page, signIn, api }, testInfo) => {
    const title = pick(testInfo, ['Passports and renewal receipts', 'Storage contract', 'Marriage and civil records with translations']);
    const avery = await api('avery', 'snapshot');
    const before = ((await avery.get('/api/records?type=document')).records as any[]).find((r) => r.title === title);
    expect(before, title).toBeTruthy();
    try {
      await signIn(page, 'avery', '/documents');
      await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
      await loaded(page);
      await page.getByRole('button', { name: `Update status: ${title}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Update this document' });
      // One checkbox per traveler (the dog too), and a sensitivity choice.
      const group = dialog.getByRole('group', { name: 'Who carries it on arrival' });
      for (const name of ['Avery', 'Jun', 'Mochi']) await expect(group.getByRole('checkbox', { name: `Carry on arrival: ${name}` })).toBeVisible();
      await group.getByRole('checkbox', { name: 'Carry on arrival: Avery' }).check();
      await group.getByRole('checkbox', { name: 'Carry on arrival: Mochi' }).check();
      await dialog.getByRole('combobox', { name: 'How sensitive is it?' }).selectOption('medical');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toHaveCount(0);

      // Saved on the record, through the normal version-checked update.
      const saved = await avery.record(before.id);
      expect([...saved.data.carry_on_arrival].sort()).toEqual(['avery', 'mochi']);
      expect(saved.data.sensitivity).toBe('medical');
      expect(saved.version).toBe(before.version + 1);

      // Opening it again shows what was saved; saving with nothing changed sends nothing (no new version).
      await page.getByRole('button', { name: `Update status: ${title}` }).click();
      const again = page.getByRole('dialog', { name: 'Update this document' });
      await expect(again.getByRole('checkbox', { name: 'Carry on arrival: Avery' })).toBeChecked();
      await expect(again.getByRole('checkbox', { name: 'Carry on arrival: Jun' })).not.toBeChecked();
      await expect(again.getByRole('combobox', { name: 'How sensitive is it?' })).toHaveValue('medical');
      await again.getByRole('button', { name: 'Cancel' }).click();

      // The arrival pack says its rule, lists the document for the people ticked, and keeps a medical one out until ticked.
      await page.goto('/arrival-pack');
      await expect(page.getByRole('heading', { level: 1, name: 'Printable arrival pack' })).toBeVisible();
      const rule = page.getByTestId('pack-documents-rule');
      await expect(rule).toContainText('Only documents marked to carry are listed.');
      await rule.getByRole('link', { name: 'Documents' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
      await page.goto('/arrival-pack');
      const averyPack = page.getByRole('article', { name: 'Arrival pack for Avery' });
      await expect(averyPack).not.toContainText(title);
      await page.getByRole('checkbox', { name: /Include health and medicine/ }).check();
      await expect(averyPack).toContainText(title);
      await expect(page.getByRole('article', { name: 'Arrival pack for Jun' })).not.toContainText(title);
    } finally {
      const now = await avery.record(before.id);
      await avery.patch(`/api/records/${enc(before.id)}`, { baseVersion: now.version, changes: { data: { carry_on_arrival: before.data.carry_on_arrival ?? [], sensitivity: before.data.sensitivity ?? null } }, reason: 'e2e cleanup' }, [200, 422]);
    }
  });
});

/* ------------------------------------------------------------------ Contacts & evidence */

test.describe('Contacts and evidence', () => {
  test('a saved contact is a candidate only, and the three tabs work', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/contacts', 'Contacts & evidence');
    await expect(page.getByText(/nothing here means anyone has been contacted, hired or booked/i)).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();

    const tabs = page.getByRole('navigation', { name: 'Contacts and evidence sections' });
    await tabs.getByRole('link', { name: 'Evidence' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Evidence' })).toBeVisible();
    await expect(page.getByRole('article').first()).toContainText(/Last checked/);
    const worth = page.getByRole('group', { name: 'Which sources' }).getByRole('button', { name: /^Worth checking again/ });
    await worth.click();
    await expect(worth).toHaveAttribute('aria-pressed', 'true');

    await tabs.getByRole('link', { name: 'Plan review findings' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Plan review findings' })).toBeVisible();
    await tabs.getByRole('link', { name: 'Contacts', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Contacts' })).toBeVisible();
  });

  test('changing a relationship is recorded, and can be put back', async ({ page, signIn, api }, testInfo) => {
    await signIn(page, 'avery');
    await openScreen(page, '/contacts', 'Contacts & evidence');
    const avery = await api('avery');
    const contacts = ((await avery.get('/api/records?type=contact')).records as any[]).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    expect(contacts.length).toBeGreaterThanOrEqual(3);
    const before = pick(testInfo, contacts);
    const original = before.data.relationship as string;
    const target = original === 'former' ? 'contacted' : 'former';
    const card = page.getByRole('article', { name: before.title });
    try {
      await card.getByRole('button', { name: 'Change relationship' }).click();
      const dialog = page.getByRole('dialog', { name: 'Change relationship' });
      await dialog.getByRole('combobox', { name: 'Relationship' }).selectOption(target);
      // Saying someone is contacted, engaged or former needs a real basis; Kadode never assumes it.
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Please say what this is based on');
      expect((await avery.record(before.id)).data.relationship).toBe(original);
      await dialog.getByRole('textbox', { name: 'What happened, or what already exists?' }).fill('Recorded by the browser test');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toHaveCount(0);
      expect((await avery.record(before.id)).data.relationship).toBe(target);
    } finally {
      const now = await avery.record(before.id);
      if (now.data.relationship !== original) {
        await avery.patch(`/api/records/${enc(before.id)}`, { baseVersion: now.version, changes: { data: { relationship: original } }, reason: 'e2e cleanup' });
      }
    }
  });
});

/* ------------------------------------------------------------------ Arrival */

test.describe('Arrival and living in Tokyo', () => {
  // Shared arrival items, one per project, so the projects never edit the same record at once.
  const TARGETS: { who: 'Avery' | 'Jun'; record: string }[] = [
    { who: 'Avery', record: 'arrival:A01' },
    { who: 'Jun', record: 'arrival:A03' },
    { who: 'Avery', record: 'arrival:A04' },
  ];

  test('each traveler has their own list, including the dog', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/arrival', 'Arrival & living in Tokyo');
    const group = page.getByRole('group', { name: 'Traveler' });
    for (const name of ['Avery', 'Jun', 'Mochi']) {
      await group.getByRole('button', { name }).click();
      await expect(group.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
      const region = page.getByRole('region', { name: new RegExp(`${name}.s arrival`) });
      await expect(region).toBeVisible();
      await expect(region).toContainText(/Arrival day|First week|First 30 days/);
      await expect(region.getByRole('link').first()).toBeVisible();
    }
    // The dog's list is about the dog.
    await expect(page.getByRole('region', { name: /Mochi.s arrival/ })).toContainText(/Mochi|quarantine|inspection/i);
  });

  test('updating one person’s part never changes the other person’s part or the shared item', async ({ page, signIn, api }, testInfo) => {
    const { who, record } = pick(testInfo, TARGETS);
    const otherId = who === 'Jun' ? 'avery' : 'jun';
    const personId = who.toLowerCase();
    await signIn(page, 'avery');
    await openScreen(page, '/arrival', 'Arrival & living in Tokyo');
    await page.getByRole('group', { name: 'Traveler' }).getByRole('button', { name: who }).click();
    const region = page.getByRole('region', { name: new RegExp(`${who}.s arrival`) });
    const item = region.getByRole('listitem').filter({ has: page.locator(`a[href="/r/${enc(record)}"]`) });
    await expect(item).toBeVisible();

    const avery = await api('avery');
    const before = await avery.record(record);
    const priorMine = before.data.traveler_progress?.[personId]?.status ?? before.status;
    const priorOther = before.data.traveler_progress?.[otherId]?.status ?? null;
    try {
      // A real click on the button: if anything covers it, this fails (and a real finger would miss too).
      await item.getByRole('button', { name: 'Update status' }).click();
      const dialog = page.getByRole('dialog', { name: new RegExp(`Update ${who}.s progress`) });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('radio', { name: /^In progress/ }).check();
      await dialog.getByRole('button', { name: 'Save status' }).click();
      await expect(dialog).toHaveCount(0);

      const after = await avery.record(record);
      expect(after.data.traveler_progress[personId].status).toBe('in_progress');
      expect(after.data.traveler_progress?.[otherId]?.status ?? null, `${otherId}'s part is untouched`).toBe(priorOther);
      expect(after.status, 'the shared item itself is untouched').toBe(before.status);
    } finally {
      const now = await avery.record(record);
      if (now.data.traveler_progress?.[personId]?.status !== priorMine) {
        await avery.post(`/api/records/${enc(record)}/status`, { baseVersion: now.version, status: priorMine, traveler: personId }, [200, 422]);
      }
    }
  });
});

/* ------------------------------------------------------------------ Future work */

test.describe('Future work', () => {
  test('optional, undated, and away from the plan', async ({ page, signIn, api }, testInfo) => {
    await signIn(page, 'avery');
    await openScreen(page, '/future', 'Future work');
    const main = page.getByRole('main');
    await expect(main).toContainText(/Optional\. Not part of the move/);
    await expect(main).toContainText(/Nothing here has a date, a target or a deadline/);
    // Nothing on this page is dated, due or counted toward a deadline.
    expect(await main.locator('time').count()).toBe(0);
    expect(await main.innerText()).not.toMatch(/\b(due|overdue|deadline:|needed by)\b/i);

    // Choosing how an idea feels is saved, and survives a reload.
    const avery = await api('avery');
    const ideas = page.getByRole('article');
    const n = await ideas.count();
    expect(n).toBeGreaterThan(0);
    const idea = ideas.nth(Math.max(0, PROJECTS.indexOf(testInfo.project.name)) % n);
    const title = (await idea.getByRole('heading', { level: 3 }).first().innerText()).trim();
    const feel = idea.getByRole('group', { name: 'How does this feel right now?' });
    const choice = (await feel.getByRole('radio', { name: 'Exploring' }).isChecked()) ? 'Paused' : 'Exploring';
    const recs = () => avery.get('/api/records?type=future_option').then((r) => r.records as any[]);
    const rec = (await recs()).find((r) => r.title === title)!;
    try {
      // A plain click: the radios are controlled by the saved record, so they settle just after the click.
      await feel.getByRole('radio', { name: choice }).click();
      await expect(feel.getByRole('radio', { name: choice })).toBeChecked();
      await expect.poll(async () => JSON.stringify((await recs()).find((r) => r.id === rec.id)!.data)).toContain(choice === 'Exploring' ? 'exploring' : 'paused');
      await page.reload();
      await loaded(page);
      await expect(page.getByRole('article', { name: title }).getByRole('radio', { name: choice })).toBeChecked();
    } finally {
      const now = (await recs()).find((r) => r.id === rec.id)!;
      if (JSON.stringify(now.data) !== JSON.stringify(rec.data)) {
        await avery.patch(`/api/records/${enc(rec.id)}`, { baseVersion: now.version, changes: { data: { interest: rec.data.interest ?? null } }, reason: 'e2e cleanup' }, [200, 422]);
      }
    }

    // Future work stays off Home's plan sections (the change log may mention an edit, so it is not counted).
    await page.goto('/');
    await loaded(page);
    for (const section of [/^This week/, /^Needs a decision/, /^Blocked/, /^Coming up/, /^Who.s ready/]) {
      const region = page.getByRole('region', { name: section }).or(page.getByRole('navigation', { name: section }));
      if ((await region.count()) > 0) await expect(region).not.toContainText(title);
    }
  });
});

/* ------------------------------------------------------------------ Data & imports */

test.describe('Data and imports', () => {
  test('shows where the plan came from, what is stored, and offers real downloads', async ({ page, signIn, api }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/data', 'Data & imports');
    const avery = await api('avery');
    const snap = await avery.snapshot();

    const imports = page.getByRole('region', { name: 'Imports' });
    await expect(imports.getByRole('article').first()).toContainText(/Latest/);
    await expect(imports.getByRole('article').first()).toContainText(/Created \d+, updated \d+, kept \d+ local edit/);

    // "What is stored now" matches the plan the server holds.
    const stored = page.getByRole('region', { name: 'What is stored now' });
    const count = (type: string) => (snap.records as any[]).filter((r) => r.type === type).length;
    await expect(stored.getByRole('listitem').filter({ hasText: 'Plan items' })).toContainText(String(count('milestone')));
    await expect(stored.getByRole('listitem').filter({ hasText: 'Decisions' })).toContainText(String(count('decision')));
    await expect(stored.getByRole('listitem').filter({ hasText: 'Documents' })).toContainText(String(count('document')));

    // The task list says what it is (the demo uses an isolated fixture store).
    await expect(page.getByRole('region', { name: 'Your task list' })).toContainText(/fixture|read-only|up to date/i);

    // JSON export is a real file download that parses.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Everything (JSON)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^kadode-export-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const parsed = JSON.parse((await import('node:fs')).readFileSync(path, 'utf8'));
    expect(parsed.export.counts.records).toBe(parsed.records.length);

    // One CSV per list.
    await page.getByText('One list at a time').click();
    const csvLinks = page.getByRole('region', { name: 'Export' }).getByRole('link').filter({ hasNotText: 'Everything (JSON)' });
    expect(await csvLinks.count()).toBeGreaterThan(3);
    const [csv] = await Promise.all([page.waitForEvent('download'), csvLinks.first().click()]);
    expect(csv.suggestedFilename()).toMatch(/^kadode-.+-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

/* ------------------------------------------------------------------ Settings */

test.describe('Settings', () => {
  test('time zone and appearance are per device; dates never move', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/settings', 'Settings');
    await page.getByRole('combobox', { name: 'Show times in' }).selectOption({ label: 'Tokyo (JST)' });
    await expect(page.getByRole('button', { name: /Tokyo time/ })).toBeVisible();
    await page.getByRole('combobox', { name: 'Show times in' }).selectOption({ label: 'Honolulu (HST)' });

    const html = page.locator('html');
    const appearance = page.getByRole('group', { name: 'Appearance' });
    await appearance.getByRole('button', { name: 'Dark' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await loaded(page);
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Light' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Like my device' }).click();
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
  });

  test('money scenarios validate their numbers and save', async ({ page, signIn }, testInfo) => {
    desktopOnly(testInfo);
    await signIn(page, 'avery');
    await openScreen(page, '/settings', 'Settings');
    const condo = page.getByRole('region', { name: 'Condo delay' });
    // The currency field is worded in terms of the dollar, not "weaker yen".
    await expect(page.getByRole('region', { name: 'Combined stress' }).getByRole('textbox', { name: 'Dollar buys fewer yen by (percent)' })).toHaveValue('10');
    await expect(page.getByRole('region', { name: 'Combined stress' })).not.toContainText(/weaker/i);
    const months = condo.getByRole('textbox', { name: 'Extra months of US costs' });
    const original = await months.inputValue();
    try {
      // Numbers that do not make sense are explained in words and cannot be saved.
      const save = page.getByRole('button', { name: 'Save scenarios' });
      await months.fill('abc');
      await expect(condo.getByText('Whole months, 0 to 60.')).toBeVisible();
      await expect(save).toBeDisabled();
      await months.fill('61');
      await expect(condo.getByText('Whole months, 0 to 60.')).toBeVisible();
      await expect(save).toBeDisabled();
      await months.fill('4');
      await page.getByRole('button', { name: 'Save scenarios' }).click();
      await expect(page.getByText(/^Saved\b/).first()).toBeVisible();
      await page.reload();
      await loaded(page);
      await expect(page.getByRole('region', { name: 'Condo delay' }).getByRole('textbox', { name: 'Extra months of US costs' })).toHaveValue('4');
      // The Money screen uses it.
      await page.goto('/money');
      await loaded(page);
      await page.getByRole('group', { name: 'Scenario' }).getByRole('button', { name: 'Condo delay' }).click();
      await expect(page.getByRole('status').filter({ hasText: /4 more months|4 months/ })).toBeVisible();
    } finally {
      await page.goto('/settings');
      await loaded(page);
      const field = page.getByRole('region', { name: 'Condo delay' }).getByRole('textbox', { name: 'Extra months of US costs' });
      await field.fill(original);
      await page.getByRole('button', { name: 'Save scenarios' }).click();
      await expect(page.getByText(/^Saved\b/).first()).toBeVisible();
    }
  });
});

/* ------------------------------------------------------------------ Couple review */

test.describe('Couple review', () => {
  test('five calm steps, nothing is marked done for you, and saving records the summary', async ({ page, signIn, api }, testInfo) => {
    await signIn(page, 'avery');
    await openScreen(page, '/review', 'Couple review');
    const main = page.getByRole('main');
    await expect(main).toContainText(/Nothing is scored, and nothing is marked done for you/);
    for (const step of ['What changed', 'This week and owners', 'Decisions', 'A few questions', 'Wrap-up']) {
      await expect(main.getByRole('listitem').filter({ hasText: step }).first()).toBeVisible();
    }
    // What the last review said (or that none has been finished yet) is kept on this page.
    await expect(page.getByRole('region', { name: 'Last review' })).toBeVisible();
    await page.getByRole('button', { name: /^(Start a review together|Continue your review)$/ }).click();
    // An open review resumes on the step where it stopped; this run walks all five from the first.
    await expect(page.getByRole('region', { name: /^Step \d of 5/ })).toBeVisible();
    for (let i = 0; i < 4 && !(await page.getByRole('region', { name: /^Step 1 of 5/ }).isVisible()); i += 1) {
      await page.getByRole('button', { name: 'Back' }).click();
    }

    const avery = await api('avery');
    const plan = JSON.stringify((await avery.snapshot()).records.filter((r: any) => r.type === 'milestone').map((r: any) => [r.id, r.status, r.owner]));

    // Step 1 -> 5 with Continue; each step has its own heading, and Back works.
    const titles = ['What changed', 'This week and owners', 'Decisions', 'A few questions', 'Wrap-up'];
    for (let i = 0; i < titles.length; i += 1) {
      await expect(page.getByRole('region', { name: new RegExp(`^Step ${i + 1} of 5`) })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: titles[i]! }).first()).toBeVisible();
      // The step list says where you are for everyone, not by colour: done, current or not started.
      for (let j = 0; j < titles.length; j += 1) {
        const state = j < i ? 'done' : j === i ? 'current' : 'not started';
        await expect(page.getByRole('navigation', { name: 'Review steps' }).getByRole('listitem', { name: `Step ${j + 1} of 5, ${titles[j]}, ${state}`, exact: true })).toBeVisible();
      }
      if (i === 2) {
        // At most three decisions, as everywhere else.
        expect(await page.getByRole('region', { name: /^Step 3 of 5/ }).getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3 }) }).count()).toBeLessThanOrEqual(3);
      }
      if (i < titles.length - 1) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('region', { name: /^Step 4 of 5/ })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Wrap-up: the next review is a week from today in the household's zone, and says what will be saved.
    const zone: string = (await avery.snapshot()).me.household.home_timezone;
    const nextReview = page.getByRole('textbox', { name: 'Next review' });
    const expected = addDays(todayInZone(zone), 7);
    await expect(nextReview).toHaveValue(new RegExp(`^(${expected}|${addDays(expected, 1)})$`));
    await expect(page.getByRole('heading', { name: 'What will be saved' })).toBeVisible();
    await expect(main).toContainText(/does not mark any work as done/);

    // Only desktop saves (a saved review changes "Since your last review" for everyone using this server).
    if (testInfo.project.name !== 'desktop') return;
    await page.getByRole('checkbox', { name: /did this review together/ }).check();
    await page.getByRole('button', { name: 'Save this review' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Review saved' })).toBeVisible();
    const saved = ((await avery.get('/api/records?type=review_session')).records as any[]).filter((r) => r.status === 'completed');
    expect(saved.length).toBeGreaterThan(0);
    // The review changed nothing about the plan itself.
    const planAfter = JSON.stringify((await avery.snapshot()).records.filter((r: any) => r.type === 'milestone').map((r: any) => [r.id, r.status, r.owner]));
    expect(planAfter).toBe(plan);
    await page.goto('/');
    await expect(page.getByRole('region', { name: /^Since your last review/ })).toBeVisible();

    // The review page now shows it as the last review, and its summary is titled by the day.
    await page.goto('/review');
    await loaded(page);
    const last = page.getByRole('region', { name: 'Last review' });
    await expect(last).toContainText(/with Avery and Jun/);
    await expect(last).toContainText(/Next review planned for/);
    await last.getByRole('link', { name: 'Read the whole summary' }).click();
    // (a side panel on wide screens, a page on phones: either way the heading names the day)
    await expect(page.getByRole('heading', { name: /^Couple review · [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/ })).toBeVisible();
  });
});

test.describe('Couple review: leaving and coming back', () => {
  // Its own server, so the one open review the other tests share is left alone.
  test.use({ baseURL: baseUrlFor('snapshot') });

  test('keeps what the review covered, and picks it up where it stopped', async ({ page, signIn, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One open review per household; runs once (desktop).');
    const avery = await api('avery', 'snapshot');
    let acceptedId: string | null = null;
    try {
      await signIn(page, 'avery', '/review');
      await expect(page.getByRole('heading', { level: 1, name: 'Couple review' })).toBeVisible();
      await loaded(page);
      await page.getByRole('button', { name: /^(Start a review together|Continue your review)$/ }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const step2 = page.getByRole('region', { name: /^Step 2 of 5/ });
      await expect(step2).toBeVisible();

      // Confirm one proposed owner (the edit itself is saved on the plan straight away).
      const more = step2.getByRole('button', { name: /^Show (all|\d+ more)/ });
      if (await more.count()) await more.click();
      const accept = step2.getByRole('button', { name: /^Accept / }).first();
      await expect(accept).toBeVisible();
      const first = step2.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Accept / }) }).first();
      const title = (await first.getByRole('link').first().innerText()).trim();
      const row = step2.getByRole('listitem').filter({ hasText: title });
      await accept.click();
      await expect(row).toContainText('accepted.');
      acceptedId = ((await avery.snapshot()).records as { id: string; title: string; owner_proposed: boolean }[]).find((r) => r.title === title)?.id ?? null;

      // The review's own record gets the list and the step (a moment after the change).
      await expect
        .poll(async () => {
          const open = ((await avery.get('/api/records?type=review_session')).records as any[]).find((r) => r.status === 'in_progress');
          return open?.data?.progress ? { step: open.data.progress.step, accepted: open.data.progress.accepted.map((a: { title: string }) => a.title) } : null;
        })
        .toEqual({ step: 1, accepted: [title] });

      // Leave, come back: the page offers to continue and says how far it got.
      await page.goto('/');
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.goto('/review');
      await loaded(page);
      const open = page.getByRole('region', { name: 'A review is open' });
      await expect(open).toContainText('You are on step 2 of 5 (This week and owners)');
      await expect(open).toContainText('1 owner confirmed');
      await page.getByRole('button', { name: 'Continue your review' }).click();
      const again = page.getByRole('region', { name: /^Step 2 of 5/ });
      await expect(again).toBeVisible();
      await expect(again.getByRole('listitem').filter({ hasText: title })).toContainText('accepted.');

      // And it is still in what will be saved at the end.
      for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('region', { name: /^Step 5 of 5/ })).toBeVisible();
      await expect(page.getByText('What will be saved').locator('xpath=..')).toContainText(title);
    } finally {
      if (acceptedId) {
        const rec = await avery.record(acceptedId);
        await avery.patch(`/api/records/${encodeURIComponent(acceptedId)}`, { baseVersion: rec.version, changes: { owner_proposed: true } });
      }
    }
  });
});

/* ------------------------------------------------------------------ What if */

test.describe('What if the pet arrives later?', () => {
  test('is a comparison only: adults’ dates never move and nothing is saved unless asked', async ({ page, signIn, api }, testInfo) => {
    await signIn(page, 'avery');
    await openScreen(page, '/what-if', /What if .* arrives later\?/);
    const main = page.getByRole('main');
    await expect(main).toContainText('Nothing here changes your plan.');
    const avery = await api('avery');
    const before = JSON.stringify((await avery.snapshot()).records.map((r: any) => [r.id, r.version]));

    const moved = page.getByRole('region', { name: /^What would move for/ });
    const unchangedText = /Unchanged:\s*Avery and Jun.s deadlines \(\d+\)/;
    await expect(moved).toContainText(unchangedText);
    const before3 = await moved.innerText();
    await page.getByRole('radio', { name: '+6 months' }).check();
    await expect(page.getByRole('radio', { name: '+6 months' })).toBeChecked();
    await expect.poll(async () => moved.innerText()).not.toBe(before3);
    await expect(moved).toContainText(unchangedText);
    // Arriving after the adult it would travel with raises one calm question, and keeps the true statement about deadlines.
    await expect(main).toContainText(/Mochi would arrive about \d+ months after Avery\. In the meantime, who looks after Mochi in Hawaii, and who flies with Mochi\?/);
    await expect(main).toContainText(/Mochi.s dates never move an adult.s legal deadlines/);
    await page.getByRole('radio', { name: 'With the first adult' }).check();
    await expect(main).not.toContainText(/who looks after Mochi in Hawaii/);
    await expect(moved.locator('time').first()).toBeVisible();
    // Weekend and legal-deadline warnings stay honest.
    await expect(moved).toContainText(/legal deadline/i);

    // Cost: unknown amounts are never counted as zero.
    const cost = page.getByRole('region', { name: 'What it could add in cost' });
    await expect(cost).toContainText(/not known yet/i);
    noBrokenValues(await main.innerText());

    // Nothing was written by exploring.
    expect(JSON.stringify((await avery.snapshot()).records.map((r: any) => [r.id, r.version]))).toBe(before);

    // Saving the comparison is an explicit step and makes one household note.
    if (testInfo.project.name !== 'desktop') return;
    const notesBefore = ((await avery.get('/api/records?type=note')).records as any[]).length;
    await page.getByRole('button', { name: 'Save this comparison as a note' }).click();
    await expect(page.getByRole('button', { name: 'Saved as a note' })).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: /Saved\./ })).toBeVisible();
    expect(((await avery.get('/api/records?type=note')).records as any[]).length).toBe(notesBefore + 1);
  });
});

/* ------------------------------------------------------------------ Arrival pack */

test.describe('Printable arrival pack', () => {
  test('one page per traveler; sensitive sections are left out unless ticked', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/arrival-pack', 'Printable arrival pack');
    const main = page.getByRole('main');
    for (const name of ['Avery', 'Jun', 'Mochi']) {
      await expect(page.getByRole('checkbox', { name })).toBeChecked();
      await expect(page.getByRole('article', { name: `Arrival pack for ${name}` })).toBeVisible();
    }
    // Sensitive sections are off by default and nothing about them appears. (The pack only offers a tick-box for a
    // section when it would actually list something sensitive; the demo has nothing marked sensitive.)
    const sensitive = page.getByRole('group', { name: /Sensitive sections/ });
    await expect(sensitive).toBeVisible();
    const pack = page.getByRole('article', { name: 'Arrival pack for Avery' });
    await expect(pack.getByRole('heading', { name: /health|medicine/i })).toHaveCount(0);
    await expect(pack.getByRole('heading', { name: /money|accounts|banking/i })).toHaveCount(0);
    const boxes = sensitive.getByRole('checkbox');
    const nBoxes = await boxes.count();
    if (nBoxes === 0) {
      await expect(sensitive).toContainText(/Nothing the pack would list is marked sensitive/);
    } else {
      for (const box of await boxes.all()) await expect(box).not.toBeChecked();
    }

    // Unticking a traveler removes their page.
    await page.getByRole('checkbox', { name: 'Mochi' }).uncheck();
    await expect(page.getByRole('article', { name: 'Arrival pack for Mochi' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Mochi' }).check();

    // Ticking a sensitive section (when there is one) adds it, and unticking removes it again.
    if (nBoxes > 0) {
      const headingsBefore = await pack.getByRole('heading').count();
      await boxes.first().check();
      await expect.poll(async () => pack.getByRole('heading').count()).toBeGreaterThan(headingsBefore);
      await boxes.first().uncheck();
      await expect.poll(async () => pack.getByRole('heading').count()).toBe(headingsBefore);
    }

    // Documents show status and who holds them, never document numbers; links are written out as text.
    await expect(pack).toContainText(/Held by/);
    expect(await main.innerText()).not.toMatch(/passport (no|number)\b|\b[A-Z]{2}\d{7}\b/i);
  });

  test('printing hides the app chrome and uses black on white', async ({ page, signIn }) => {
    await signIn(page, 'avery');
    await openScreen(page, '/arrival-pack', 'Printable arrival pack');
    // The Print button asks the browser to print (stubbed here so no dialog opens).
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed += 1;
      };
    });
    await page.getByRole('button', { name: 'Print' }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);

    await page.emulateMedia({ media: 'print' });
    // No navigation, banner, skip link, or controls on paper; the pack itself is still there.
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await expect(page.getByRole('article', { name: 'Arrival pack for Avery' })).toBeVisible();
    const colours = await page.evaluate(() => {
      const el = document.querySelector('article') as HTMLElement;
      const cs = getComputedStyle(el);
      const body = getComputedStyle(document.body);
      return { color: cs.color, bg: body.backgroundColor };
    });
    expect(colours.color).toMatch(/rgb\(0, 0, 0\)|rgb\(\d{1,2}, \d{1,2}, \d{1,2}\)/);
    expect(['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)']).toContain(colours.bg);
    await page.emulateMedia({ media: 'screen' });
  });
});
