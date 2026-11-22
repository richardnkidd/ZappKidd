import type { Page } from '@playwright/test';
import { expect, loaded, test, unique, type Api } from './support/fixtures';

/** A household decision needs every required approver (both adults) to choose the SAME option. */

async function newDecision(api: Api, title: string) {
  const res = await api.post('/api/records', {
    type: 'decision',
    title,
    data: {
      question: `${title}?`,
      options: [
        { label: 'By sea', consequences: 'Cheaper, about two months.' },
        { label: 'By air', consequences: 'Faster, costs more.' },
      ],
    },
  });
  return res.record as { id: string; version: number };
}

const card = (page: Page, title: string) => page.getByRole('article', { name: title });

/**
 * Find a decision on the Decisions tab and open it for deciding. The first three open decisions sit under "Up next" and
 * the rest under "Later"; each card shows its options and actions only after "Review options and decide".
 */
async function findCard(page: Page, title: string) {
  const c = card(page, title);
  if (!(await c.isVisible())) await page.getByRole('heading', { name: /^Later/ }).click();
  await expect(c).toBeVisible();
  return c;
}

async function openCard(page: Page, title: string) {
  const c = await findCard(page, title);
  const review = c.getByRole('button', { name: 'Review options and decide' });
  if (await review.isVisible()) await review.click();
  await expect(c.getByRole('button', { name: 'Hide options' })).toBeVisible();
  return c;
}

async function approve(page: Page, title: string, who: string, option: RegExp, change = false) {
  const c = await openCard(page, title);
  await c.getByRole('button', { name: change ? 'Change my approval' : `Approve as ${who}` }).click();
  const dialog = page.getByRole('dialog', { name: `Approve as ${who}` });
  await dialog.getByRole('radio', { name: option }).check();
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('Decide', () => {
  test('a joint decision stays "awaiting" until both adults approve the same option', async ({ openAs, api }, testInfo) => {
    const title = unique('How do we ship the boxes', testInfo);
    const avery = await api('avery');
    const d = await newDecision(avery, title);

    const a = await openAs('avery', '/decide');
    const j = await openAs('jun', '/decide');
    await loaded(a.page);
    await loaded(j.page);

    // Nobody has approved yet: both people are awaited, and it is Avery's turn.
    const first = await openCard(a.page, title);
    await expect(first).toContainText('Awaiting Avery and Jun');
    await expect(first).toContainText('Open question');
    await expect(first).toContainText('Your approval is needed');
    // Nothing can be approved until the options are on screen: the buttons only appear after "Review options and decide".
    await first.getByRole('button', { name: 'Hide options' }).click();
    await expect(first.getByRole('button', { name: /^Approve as/ })).toHaveCount(0);

    // Avery approves "By sea". The decision is still NOT a household decision.
    await approve(a.page, title, 'Avery', /^By sea/);
    await expect(card(a.page, title)).toContainText('Approved by Avery · awaiting Jun');
    await expect(card(a.page, title)).toContainText('Suggested'); // one approval is a suggestion, not a decision
    await expect(card(a.page, title)).not.toContainText('Household-approved');
    await expect(card(a.page, title)).not.toContainText('Your approval is needed');
    await expect(card(a.page, title)).toContainText(/You approved “By sea\.?”/);
    let rec = await avery.record(d.id);
    expect(rec.status, 'one approval is a proposal, not a decision').toBe('proposed');
    expect(rec.data.decided_option_id ?? null).toBeNull();

    // Jun's screen (reloaded, as it would after the next refresh) says what Avery chose and that Jun's turn is next.
    await j.page.reload();
    await loaded(j.page);
    const juns = await findCard(j.page, title);
    await expect(juns).toContainText('Approved by Avery · awaiting Jun');
    await expect(juns).toContainText('Your approval is needed');

    // Jun chooses the OTHER option: disagreement is called out, never shown as approved.
    await approve(j.page, title, 'Jun', /^By air/);
    await expect(card(j.page, title)).toContainText(/Avery chose “By sea”.*Jun chose “By air”.*chose differently/);
    await expect(card(j.page, title)).not.toContainText('Household-approved');
    rec = await avery.record(d.id);
    expect(rec.status).not.toBe('approved');
    expect(rec.data.decided_option_id ?? null).toBeNull();

    // Jun changes to the same option: now it is household-approved, with both names.
    await approve(j.page, title, 'Jun', /^By sea/, true);
    rec = await avery.record(d.id);
    expect(rec.status).toBe('approved');
    expect(rec.data.decided_option_id).toBeTruthy();
    expect(rec.data.approvals.map((x: any) => x.person_id).sort()).toEqual(['avery', 'jun']);
    // The page says so, and the decision moves to the Decided tab.
    const done = j.page.getByRole('status').filter({ hasText: /Decided together/ });
    await expect(done).toContainText(`“${title}” moved to Decided`);
    await done.getByRole('link', { name: 'See it' }).click();
    await expect(j.page).toHaveURL(/\/decide\/decided/);
    const settled = card(j.page, title);
    await expect(settled).toContainText('Household-approved');
    await expect(settled).toContainText('Approved by Avery and Jun · “By sea”');
    await expect(card(j.page, title)).toHaveCount(1);

    // The history on the card records who approved what.
    // (The card opens by itself when you arrive through "See it"; otherwise "Show details" opens it.)
    const show = settled.getByRole('button', { name: 'Show details' });
    if (await show.isVisible()) await show.click();
    await expect(settled.getByText(/Avery approved “By sea”/)).toBeVisible();
    await expect(settled.getByText(/Jun approved “By sea”/)).toBeVisible();

    // It is no longer waiting on the Decisions tab.
    await j.page.goto('/decide');
    await loaded(j.page);
    await expect(card(j.page, title)).toHaveCount(0);
  });

  test('putting a decision off, or rejecting it, needs a reason', async ({ page, signIn, api }, testInfo) => {
    const titleDefer = unique('Which pharmacy do we use', testInfo);
    const titleReject = unique('Do we ship the piano', testInfo);
    const avery = await api('avery');
    await newDecision(avery, titleDefer);
    const rejectable = await newDecision(avery, titleReject);

    await signIn(page, 'avery', '/decide');
    await loaded(page);

    const deferrable = await openCard(page, titleDefer);
    await deferrable.getByRole('button', { name: 'Put off…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Put this off for now' });
    await dialog.getByRole('button', { name: 'Put off', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please add a reason');
    await dialog.getByRole('textbox', { name: /^Why are we putting it off/ }).fill('We need the clinic list first.');
    await dialog.getByRole('button', { name: 'Put off', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const rejectableCard = await openCard(page, titleReject);
    await rejectableCard.getByRole('button', { name: 'Reject…' }).click();
    const reject = page.getByRole('dialog', { name: 'Reject this decision' });
    await reject.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(reject.getByRole('alert')).toContainText('Please add a reason');
    await reject.getByRole('textbox', { name: /^Why are we rejecting it/ }).fill('Too costly for the benefit.');
    await reject.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(reject).toHaveCount(0);
    expect((await avery.record(rejectable.id)).status).toBe('rejected');

    // Both now sit on the Decided tab, with what happened, and are no longer waiting on the Decisions tab.
    await page.goto('/decide/decided');
    await loaded(page);
    await expect(card(page, titleDefer)).toContainText('Deferred');
    await expect(card(page, titleDefer)).toContainText('Put off for now');
    await expect(card(page, titleReject)).toContainText('Rejected');
    await page.goto('/decide');
    await loaded(page);
    await expect(card(page, titleDefer)).toHaveCount(0);
    await expect(card(page, titleReject)).toHaveCount(0);
  });

  test('Home never shows more than three decisions, however many are open', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    for (let i = 1; i <= 4; i += 1) await newDecision(avery, unique(`Extra choice ${i}`, testInfo));
    await signIn(page, 'avery', '/');
    await loaded(page);
    const section = page.getByRole('region', { name: /^Needs a decision/ });
    await expect(section.getByRole('listitem')).toHaveCount(3);
    await expect(section.getByRole('link', { name: /\d+ more decisions? waiting in Decide/ })).toBeVisible();
    // The Decide screen itself lists all of them: three "Up next", the rest under "Later".
    await section.getByRole('link', { name: /more decisions? waiting in Decide/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Decide' })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Up next/ }).getByRole('article')).toHaveCount(3);
    await page.getByRole('heading', { name: /^Later/ }).click();
    expect(await page.getByRole('article').count()).toBeGreaterThan(3);
  });
});
