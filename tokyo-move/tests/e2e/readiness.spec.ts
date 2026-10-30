import type { Page } from '@playwright/test';
import { baseUrlFor } from './support/env';
import { addDays, expect, loaded, test, todayInZone, type Api } from './support/fixtures';

/**
 * Readiness and dates:
 *  - answering "Does this apply to <name>?" (Yes / No / Not sure) on a conditional step changes that traveler's readiness;
 *  - the pet's exam window is a "Not before" date and its weekend advice never names an earlier day;
 *  - the what-if screen is honest when no dates are set at all.
 *
 * The tests that change shared records use their own server or one project, and put everything back.
 */

const enc = encodeURIComponent;
const STEP = 'milestone:W18'; // "Verify Tokyo clinician and pharmacy continuity": conditional for both adults
const STEP_TITLE = 'Verify Tokyo clinician and pharmacy continuity';

async function setApplies(api: Api, personId: string, value: 'yes' | 'no' | 'unknown') {
  const rec = await api.record(STEP);
  if ((rec.data.applies_to?.[personId] ?? 'unknown') === value) return;
  await api.patch(`/api/records/${enc(STEP)}`, { baseVersion: rec.version, changes: { data: { applies_to: { [personId]: value } } }, reason: 'e2e setup' });
}

/** "4 steps are left" in the readiness sentence under the person's name. */
async function stepsLeft(page: Page): Promise<number> {
  const text = await page.getByRole('main').getByText(/\d+ steps? (are|is) left/).first().innerText();
  return Number(text.match(/(\d+) steps? (?:are|is) left/)![1]);
}

test.describe('Conditional steps change readiness', () => {
  test('Yes, No and Not sure move a step in and out of Avery’s list and change the sentence about what is left', async ({ page, signIn, api }, testInfo) => {
    // One project only: the answer is saved on a record both adults share, so parallel projects would collide.
    test.skip(testInfo.project.name !== 'phone', 'Changes a shared record; runs once, on the phone (then re-checked at desktop width).');
    const avery = await api('avery');
    await setApplies(avery, 'avery', 'unknown');
    const question = `Does “${STEP_TITLE}” apply to Avery?`;
    const unsure = page.getByRole('region', { name: /^Not sure yet if it applies/ });
    const notNeeded = page.getByRole('group').filter({ has: page.getByRole('heading', { name: /^Not needed for Avery/ }) });
    const headline = page.getByRole('main').getByText(/Avery is /).first();

    try {
      await signIn(page, 'avery', '/ready/avery');
      await loaded(page);

      // Start: the step is "not sure yet", and the sentence says one step still needs a yes or no.
      await expect(unsure).toBeVisible();
      await expect(unsure.getByRole('group', { name: question })).toBeVisible();
      await expect(unsure.getByRole('button', { name: 'Not sure', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(headline).toContainText(/1 step still needs a yes or no/);
      const left = await stepsLeft(page);

      // NO: it leaves the list, is kept under "Not needed for Avery", and the sentence stops asking.
      await unsure.getByRole('group', { name: question }).getByRole('button', { name: 'No', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: /moved out of this list/ })).toContainText(STEP_TITLE);
      await expect(unsure).toHaveCount(0);
      await expect(headline).not.toContainText(/yes or no/);
      expect(await stepsLeft(page), 'a step that does not apply is not counted').toBe(left);
      await expect(notNeeded).toBeVisible();
      await notNeeded.getByRole('heading', { name: /^Not needed for Avery/ }).click();
      await expect(notNeeded.getByRole('group', { name: 'Does this apply to Avery?' }).getByRole('button', { name: 'No', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect((await avery.record(STEP)).data.applies_to.avery).toBe('no');
      // Jun's own answer is separate: Jun is still asked.
      await page.goto('/ready/jun');
      await loaded(page);
      await expect(page.getByRole('region', { name: /^Not sure yet if it applies/ }).getByRole('group', { name: `Does “${STEP_TITLE}” apply to Jun?` }).getByRole('button', { name: 'Not sure', exact: true })).toHaveAttribute('aria-pressed', 'true');

      // The answer survives a reload and shows on Home (wide screen: the readiness card carries the same sentence).
      await page.goto('/ready/avery');
      await loaded(page);
      await expect(page.getByRole('region', { name: /^Not sure yet if it applies/ })).toHaveCount(0);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await loaded(page);
      const averyCard = page.getByRole('region', { name: /^Who.s ready/ }).getByRole('article').filter({ hasText: 'Avery' }).first();
      await expect(averyCard).toBeVisible();
      await expect(averyCard).not.toContainText(/yes or no/);
      await page.setViewportSize({ width: 390, height: 844 });

      // YES: now it counts. One more step is left, and it is listed outside "Not sure yet".
      await page.goto('/ready/avery');
      await loaded(page);
      await notNeeded.getByRole('heading', { name: /^Not needed for Avery/ }).click();
      await notNeeded.getByRole('group', { name: 'Does this apply to Avery?' }).getByRole('button', { name: 'Yes', exact: true }).click();
      await expect(headline).toContainText(new RegExp(`${left + 1} steps are left`));
      await expect(page.getByRole('region', { name: /^Not sure yet if it applies/ })).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link', { name: STEP_TITLE })).toBeVisible();
      expect((await avery.record(STEP)).data.applies_to.avery).toBe('yes');

      // NOT SURE again: back to being asked, and not counted.
      const stepRow = page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('link', { name: STEP_TITLE }) }).first();
      if ((await stepRow.getByRole('group', { name: question }).count()) === 0) {
        // The "Yes" answer is changed from the step's own page.
        await page.goto(`/r/${enc(STEP)}`);
        await loaded(page);
        const applies = page.getByRole('group', { name: 'Does this apply to Avery?' });
        await applies.getByRole('button', { name: 'Not sure', exact: true }).click();
      } else {
        await stepRow.getByRole('group', { name: question }).getByRole('button', { name: 'Not sure', exact: true }).click();
      }
      await expect.poll(async () => (await avery.record(STEP)).data.applies_to.avery).toBe('unknown');
      await page.goto('/ready/avery');
      await loaded(page);
      await expect(page.getByRole('region', { name: /^Not sure yet if it applies/ })).toBeVisible();
      await expect(headline).toContainText(/1 step still needs a yes or no/);
      expect(await stepsLeft(page)).toBe(left);
    } finally {
      await setApplies(avery, 'avery', 'unknown').catch(() => undefined);
    }
  });

  test('long lists show three rows and a "Show all" button; the sections that are only dates fold away', async ({ page, signIn }) => {
    await signIn(page, 'avery', '/ready/mochi');
    await loaded(page);
    // Mochi has four things holding things up: three are shown, the rest one tap away.
    const holding = page.getByRole('region', { name: /^Holding things up/ });
    await expect(holding).toBeVisible();
    await expect(holding.getByRole('list').first().getByRole('listitem')).toHaveCount(3);
    const all = holding.getByRole('button', { name: /^Show all \d+/ });
    const n = Number(((await all.innerText()).match(/(\d+)/) ?? [])[1]);
    expect(n).toBeGreaterThan(3);
    await all.click();
    await expect(holding.getByRole('list').first().getByRole('listitem')).toHaveCount(n);
    await expect(holding.getByRole('button', { name: /Show fewer/ })).toBeVisible();

    // Steps and dates after arrival are folded sections with a count; each opens to show its rows.
    for (const name of [/^Steps after arrival/, /^Dates after arriving/]) {
      const group = page.getByRole('group').filter({ has: page.getByRole('heading', { name }) });
      await expect(group).toBeVisible();
      if (!(await group.evaluate((el) => (el as HTMLDetailsElement).open))) await group.getByRole('heading', { name }).click();
      await expect(group.getByRole('listitem').first()).toBeVisible();
    }
  });
});

test.describe('The pet’s dates', () => {
  // These change the pet's departure and arrival dates, so they use the read-only task-list server (nothing else there
  // depends on those dates) and run in one project, one after the other, putting every date back afterwards.
  test.use({ baseURL: baseUrlFor('snapshot') });
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Changes shared dates on one server; runs once (desktop).');
  });

  async function anchor(api: Api, code: string) {
    return (await api.record(`anchor:${code}`)) as { version: number; data: { date: string | null; confidence: string } };
  }
  async function setAnchor(api: Api, code: string, date: string | null, confidence: string) {
    const rec = await anchor(api, code);
    await api.send('PUT', `/api/anchors/${code}`, { baseVersion: rec.version, date, confidence });
  }
  /** The next Saturday that is at least `minDays` after `from`. */
  function saturdayAfter(from: string, minDays: number): string {
    let d = addDays(from, minDays);
    for (let i = 0; i < 7; i += 1) {
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === 6) return d;
      d = addDays(d, 1);
    }
    return d;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  test('the exam window is "Not before …", and on a weekend its advice points to a LATER business day, never an earlier one', async ({ page, signIn, api }) => {
    const avery = await api('avery', 'snapshot');
    const zone: string = (await avery.snapshot()).me.household.home_timezone;
    const before = await anchor(avery, 'DP');
    // Put the window's opening day on a Saturday about three weeks away (so the traveler page opens the dates by itself):
    // the window opens 10 days before the pet leaves.
    const windowOpens = saturdayAfter(todayInZone(zone), 21);
    const departs = addDays(windowOpens, 10);
    try {
      await setAnchor(avery, 'DP', departs, 'tentative');
      await signIn(page, 'avery', '/ready/mochi');
      await loaded(page);

      // A date within 90 days is shown without opening anything.
      const dates = page.getByRole('group').filter({ has: page.getByRole('heading', { name: /^Dates before leaving/ }) });
      await expect(dates).toBeVisible();
      expect(await dates.evaluate((el) => (el as HTMLDetailsElement).open), 'dates in the next 90 days start open').toBe(true);
      const row = dates.getByRole('listitem').filter({ hasText: 'Mochi examination window opens' });
      await expect(row).toBeVisible();

      // "Not before <date> (window opens)": the earliest allowed day, not a deadline to meet.
      const dt = row.locator('time[datetime]').first();
      await expect(dt).toHaveAttribute('datetime', windowOpens);
      await expect(row).toContainText('Not before');
      await expect(row).toContainText('(window opens)');
      await expect(row).not.toContainText(/Due by/);

      // Weekend advice: the window opens on a Saturday; it names the first business day INSIDE it (a later day).
      const text = (await row.innerText()).replace(/\s+/g, ' ');
      expect(text).toMatch(/window opens on a Saturday/i);
      const m = text.match(/first business day inside it is (?:[A-Z][a-z]{2}), ([A-Z][a-z]{2}) (\d{1,2})/);
      expect(m, `advice names a business day: ${text}`).toBeTruthy();
      const month = MONTHS.indexOf(m![1]!) + 1;
      const year = Number(windowOpens.slice(0, 4)) + (month < Number(windowOpens.slice(5, 7)) ? 1 : 0);
      const advised = `${year}-${String(month).padStart(2, '0')}-${String(Number(m![2])).padStart(2, '0')}`;
      expect(advised > windowOpens, `${advised} is after the window opens (${windowOpens})`).toBe(true);
      expect(text).not.toMatch(/aim for/i);
      // It never tells the household to act on the Friday before the window opens.
      const friday = addDays(windowOpens, -1);
      const [fy, fm, fd] = friday.split('-').map(Number) as [number, number, number];
      expect(text).not.toContain(`${MONTHS[fm - 1]} ${fd}`);
      void fy;

      // The same wording on the rule's own page.
      await page.goto('/r/deadline_rule%3ARULE-PET-EXAM-WINDOW');
      await loaded(page);
      await expect(page.getByRole('main')).toContainText('The earliest allowed date — nothing before it');
    } finally {
      await setAnchor(avery, 'DP', before.data.date, before.data.confidence).catch(() => undefined);
    }
    expect((await anchor(avery, 'DP')).data.date, 'the pet’s departure date is back as it was').toBe(before.data.date);
  });

  test('a weekday window shows "Not before" with no weekend advice at all', async ({ page, signIn, api }) => {
    const avery = await api('avery', 'snapshot');
    const zone: string = (await avery.snapshot()).me.household.home_timezone;
    const before = await anchor(avery, 'DP');
    // The Monday-to-Friday opening day (a Wednesday) three weeks away.
    let opens = addDays(todayInZone(zone), 21);
    while (new Date(`${opens}T00:00:00Z`).getUTCDay() !== 3) opens = addDays(opens, 1);
    try {
      await setAnchor(avery, 'DP', addDays(opens, 10), 'tentative');
      await signIn(page, 'avery', '/ready/mochi');
      await loaded(page);
      const dates = page.getByRole('group').filter({ has: page.getByRole('heading', { name: /^Dates before leaving/ }) });
      const row = dates.getByRole('listitem').filter({ hasText: 'Mochi examination window opens' });
      await expect(row).toContainText('Not before');
      await expect(row.locator('time[datetime]').first()).toHaveAttribute('datetime', opens);
      await expect(row).not.toContainText(/window opens on a|business day|aim for|Falls on/i);
    } finally {
      await setAnchor(avery, 'DP', before.data.date, before.data.confidence).catch(() => undefined);
    }
  });

  test('what if with no dates set at all: says what is needed, offers an example that is never saved', async ({ page, signIn, api }) => {
    const avery = await api('avery', 'snapshot');
    const tn = await anchor(avery, 'TN');
    const tp = await anchor(avery, 'TP');
    try {
      await signIn(page, 'avery', '/what-if');
      await loaded(page);

      // With the pet's own arrival known, the adult's date is only an extra ("optional") ...
      await setAnchor(avery, 'TN', null, 'awaiting');
      await page.reload();
      await loaded(page);
      const field = page.getByRole('textbox', { name: 'If the first adult arrived on… (optional)' });
      await expect(field).toBeVisible();
      await expect(page.getByRole('button', { name: /^Try / })).toHaveCount(0);

      // ... and with no arrival date anywhere it is needed, with an example to start from.
      await setAnchor(avery, 'TP', null, 'awaiting');
      await page.reload();
      await loaded(page);
      const needed = page.getByRole('textbox', { name: 'Needed for the comparison — no dates are set yet' });
      await expect(needed).toBeVisible();
      await expect(page.getByText('(optional)')).toHaveCount(0);
      await expect(page.getByText(/A date here is only for the comparison and is never saved/)).toBeVisible();
      await expect(page.getByText('Pick when, and the comparison appears here.')).toBeVisible();
      const example = page.getByRole('button', { name: /^Try July 1, 2027 — start of your target month \(example only, never saved\)$/ });
      await expect(example).toBeVisible();

      await example.click();
      await expect(needed).toHaveValue('2027-07-01');
      await expect(page.getByRole('region', { name: /^What would move/ })).toBeVisible();

      // Never saved: the plan still has no arrival dates, and a reload forgets the example.
      expect((await anchor(avery, 'TN')).data.date).toBeNull();
      expect((await anchor(avery, 'TP')).data.date).toBeNull();
      await page.reload();
      await loaded(page);
      await expect(page.getByRole('textbox', { name: 'Needed for the comparison — no dates are set yet' })).toHaveValue('');
    } finally {
      await setAnchor(avery, 'TP', tp.data.date, tp.data.confidence).catch(() => undefined);
      await setAnchor(avery, 'TN', tn.data.date, tn.data.confidence).catch(() => undefined);
    }
    expect((await anchor(avery, 'TN')).data.date).toBe(tn.data.date);
    expect((await anchor(avery, 'TP')).data.date).toBe(tp.data.date);
  });
});
