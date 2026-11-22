import type { Page } from '@playwright/test';
import { expect, loaded, test, unique, type Api } from './support/fixtures';

/**
 * A household decision needs every required person (both adults) to pick the SAME choice. The card asks one plain
 * question, shows the choices as radios, and agrees in one tap. Disagreement is said out loud, never hidden.
 */

const enc = encodeURIComponent;

/** A two-choice decision with "By sea" suggested, and a plain question. Returns the question the card shows. */
async function newDecision(api: Api, label: string, testInfo: Parameters<typeof unique>[1], opts: { question?: boolean } = {}) {
  const title = unique(label, testInfo);
  const res = await api.post('/api/records', {
    type: 'decision',
    title,
    data: {
      options: [
        { label: 'By sea', consequences: 'Cheaper, about two months.' },
        { label: 'By air', consequences: 'Faster, costs more.' },
      ],
      recommended_option_id: 'opt-1',
    },
  });
  const rec = res.record as { id: string; version: number };
  const question = `${title}?`;
  if (opts.question !== false) {
    await api.patch(`/api/records/${enc(rec.id)}`, { baseVersion: rec.version, changes: { data: { plain_question: question } } });
  }
  return { id: rec.id, title, question };
}

const card = (page: Page, name: string) => page.getByRole('article', { name });

/** Open a collapsed card for deciding: the one "Decide" (or "See choices") button expands it in place. */
async function openCard(page: Page, name: string) {
  const c = card(page, name);
  await expect(c).toBeVisible();
  const toggle = c.getByRole('button', { name: /^(Decide|See choices)$/ });
  if (await toggle.isVisible()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
  }
  await expect(c.getByRole('button', { name: 'Hide choices' })).toHaveAttribute('aria-expanded', 'true');
  return c;
}

test.describe('Decide', () => {
  test('both adults must pick the same choice; a different pick is called out, never hidden', async ({ openAs, api }, testInfo) => {
    const avery = await api('avery');
    const d = await newDecision(avery, 'How do we ship the boxes', testInfo);

    const a = await openAs('avery', '/decide');
    const j = await openAs('jun', '/decide');
    await loaded(a.page);
    await loaded(j.page);

    // Collapsed: whose turn, the question, one "Decide" button. No old chips or helper text.
    const yourTurn = a.page.getByRole('region', { name: /^Your turn/ });
    const first = card(a.page, d.question);
    await expect(yourTurn.getByRole('article', { name: d.question })).toBeVisible();
    await expect(first).toContainText('Your turn');
    await expect(first).not.toContainText('Open question');
    await expect(first).not.toContainText('Your approval is needed');
    await expect(first.getByRole('radio')).toHaveCount(0);

    // Expanded: the choices are real radios in a group named by the question, the suggestion first and preselected.
    await openCard(a.page, d.question);
    const group = first.getByRole('group', { name: d.question });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByRole('radio').first()).toHaveAccessibleName(/Suggested.*By sea/);
    await expect(group.getByRole('radio', { name: /By sea/ })).toBeChecked();
    await expect(first.getByRole('button', { name: 'Agree: By sea' })).toBeVisible();
    await expect(first.getByRole('button', { name: /^Approve as/ })).toHaveCount(0);

    // Avery picks the other choice; the button names it; one tap agrees. One choice is not a decision.
    await group.getByRole('radio', { name: /By air/ }).check();
    await first.getByRole('button', { name: 'Agree: By air' }).click();
    await expect(first).toContainText('You chose: By air. Waiting for Jun.');
    await expect(first).toContainText('Waiting for Jun');
    await expect(a.page.getByRole('status').filter({ hasText: 'You chose: By air. Waiting for Jun.' })).toHaveCount(1);
    await expect(first.getByRole('button', { name: 'Change my choice' })).toBeFocused();
    let rec = await avery.record(d.id);
    expect(rec.status, 'one person agreeing is not a decision').toBe('proposed');
    expect(rec.data.decided_option_id ?? null).toBeNull();

    // Jun sees that Avery chose, and that it is Jun's turn. Avery's pick differs from the suggestion, so NOTHING is
    // preselected: agreeing cannot silently disagree with Avery.
    await j.page.reload();
    await loaded(j.page);
    const juns = card(j.page, d.question);
    await expect(juns).toContainText('Avery chose. Your turn');
    await openCard(j.page, d.question);
    const jGroup = juns.getByRole('group', { name: d.question });
    await expect(jGroup.getByRole('radio', { name: /Avery picked this.*By air/ })).toBeVisible();
    await expect(jGroup.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(juns.getByRole('button', { name: /^Agree/ })).toBeDisabled();

    // Jun picks the OTHER choice: it reads as a disagreement and nothing is decided.
    await jGroup.getByRole('radio', { name: /By sea/ }).check();
    await juns.getByRole('button', { name: 'Agree: By sea' }).click();
    await expect(juns).toContainText('You chose differently');
    rec = await avery.record(d.id);
    expect(rec.status).not.toBe('approved');
    expect(rec.data.decided_option_id ?? null).toBeNull();

    // Avery sees the disagreement, with both picks named on the choices. Avery's own pick stays selected.
    await a.page.reload();
    await loaded(a.page);
    const again = card(a.page, d.question);
    await expect(again).toContainText('You chose differently');
    await openCard(a.page, d.question);
    const aGroup = again.getByRole('group', { name: d.question });
    await expect(aGroup.getByRole('radio', { name: /You picked this.*By air/ })).toBeChecked();
    await expect(aGroup.getByRole('radio', { name: /Jun picked this.*By sea/ })).toBeVisible();
    await expect(again.getByRole('button', { name: 'Agree: By air' })).toBeDisabled();

    // Avery moves to Jun's choice: now it is decided, and the card says so in place before it moves.
    await aGroup.getByRole('radio', { name: /By sea/ }).check();
    await again.getByRole('button', { name: 'Agree: By sea' }).click();
    const done = a.page.getByRole('group', { name: 'Decided' });
    await expect(done).toContainText('Decided: By sea.');
    await expect(done).toBeFocused();
    await expect(done.getByRole('button', { name: 'Undo' })).toBeVisible();
    rec = await avery.record(d.id);
    expect(rec.status).toBe('approved');
    expect(rec.data.decided_option_id).toBe('opt-1');

    // On the Decided tab: what was decided, and the history behind "Why and history".
    await done.getByRole('link', { name: 'See it' }).click();
    await expect(a.page).toHaveURL(/\/decide\/decided/);
    const settled = card(a.page, d.question);
    await expect(settled).toContainText('Decided');
    await expect(settled).toContainText('Decided: By sea');
    const why = settled.getByRole('button', { name: 'Why and history' });
    await expect(why).toHaveAttribute('aria-expanded', 'false');
    await why.click();
    await expect(why).toHaveAttribute('aria-expanded', 'true');
    await expect(settled.getByText(/Jun chose “By sea”/)).toBeVisible();
    await expect(settled.getByText(/Avery chose “By sea”/)).toBeVisible();

    // Reopen (within 7 days): back to open, both picks cleared, and the page says where it went.
    await settled.getByRole('button', { name: 'Reopen' }).click();
    const reopened = a.page.getByRole('group', { name: 'Reopened' });
    await expect(reopened).toBeFocused();
    rec = await avery.record(d.id);
    expect(rec.status).toBe('open');
    expect(rec.data.approvals).toEqual([]);
    await reopened.getByRole('link', { name: 'Decide it now' }).click();
    await expect(card(a.page, d.question)).toContainText('Your turn');
  });

  test('"Undo" right after deciding puts the decision back', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    const jun = await api('jun');
    const d = await newDecision(avery, 'Which carrier do we use', testInfo);
    const v = (await jun.record(d.id)).version;
    await jun.post(`/api/decisions/${enc(d.id)}/approve`, { baseVersion: v, option_id: 'opt-1' });

    await signIn(page, 'avery', '/decide');
    await loaded(page);
    const c = await openCard(page, d.question);
    await expect(c).toContainText('Jun chose. Your turn');
    // Jun chose the suggestion, so it is preselected: agreeing agrees with Jun.
    await expect(c.getByRole('radio', { name: /Jun picked this.*By sea/ })).toBeChecked();
    await c.getByRole('button', { name: 'Agree: By sea' }).click();
    const done = page.getByRole('group', { name: 'Decided' });
    await expect(done).toContainText('Decided: By sea.');
    expect((await avery.record(d.id)).status).toBe('approved');
    await done.getByRole('button', { name: 'Undo' }).click();
    await expect(card(page, d.question)).toBeVisible();
    await expect(card(page, d.question)).toContainText('Your turn');
    expect((await avery.record(d.id)).status).toBe('open');
  });

  test('"Not now" and "None of these work" need a reason, and can be reopened', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    const later = await newDecision(avery, 'Which pharmacy do we use', testInfo);
    const no = await newDecision(avery, 'Do we ship the piano', testInfo);

    await signIn(page, 'avery', '/decide');
    await loaded(page);

    const c1 = await openCard(page, later.question);
    await c1.getByRole('button', { name: 'Not now' }).click();
    const dialog = page.getByRole('dialog', { name: 'Not now' });
    const reason = dialog.getByRole('textbox', { name: /Why not now\? \(required\)/ });
    await expect(reason).toHaveAttribute('aria-required', 'true');
    await dialog.getByRole('button', { name: 'Put off', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please add a reason');
    await expect(reason).toBeFocused();
    await reason.fill('We need the clinic list first.');
    await dialog.getByRole('button', { name: 'Put off', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    // The card does not vanish silently: it says what happened, in place, and focus is not lost.
    const putOff = page.getByRole('group', { name: 'Put off' });
    await expect(putOff).toContainText('Put off.');
    await expect(putOff).toBeFocused();
    expect((await avery.record(later.id)).status).toBe('deferred');

    const c2 = await openCard(page, no.question);
    await c2.getByRole('button', { name: 'None of these work' }).click();
    const reject = page.getByRole('dialog', { name: 'None of these work' });
    await reject.getByRole('button', { name: 'Close this decision' }).click();
    await expect(reject.getByRole('alert')).toContainText('Please add a reason');
    await reject.getByRole('textbox', { name: /Why do none of these work\? \(required\)/ }).fill('Too costly for the benefit.');
    await reject.getByRole('button', { name: 'Close this decision' }).click();
    await expect(reject).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Not doing this' })).toBeVisible();
    expect((await avery.record(no.id)).status).toBe('rejected');

    // Both sit on the Decided tab with plain status words, and no longer wait on the Decisions tab.
    await page.goto('/decide/decided');
    await loaded(page);
    await expect(card(page, later.question)).toContainText('Put off');
    await expect(card(page, later.question)).toContainText('We need the clinic list first.');
    await expect(card(page, no.question)).toContainText('Not doing this');
    await page.goto('/decide');
    await loaded(page);
    await expect(card(page, later.question)).toHaveCount(0);
    await expect(card(page, no.question)).toHaveCount(0);

    // A put-off decision can be reopened for 7 days.
    await page.goto('/decide/decided');
    await loaded(page);
    await card(page, later.question).getByRole('button', { name: 'Reopen' }).click();
    await expect(page.getByRole('group', { name: 'Reopened' })).toBeVisible();
    expect((await avery.record(later.id)).status).toBe('open');
  });

  test('a decision settled more than 7 days ago offers no Reopen, and the server refuses it', async ({ page, signIn, api }) => {
    const avery = await api('avery');
    const d01 = await avery.record('decision:D01'); // demo data: decided in October
    const res = await avery.raw('POST', `/api/decisions/${enc(d01.id)}/reopen`, { baseVersion: d01.version });
    expect(res.status()).toBe(422);
    expect(await res.text()).toContain('more than 7 days ago');

    await signIn(page, 'avery', '/decide/decided');
    await loaded(page);
    const c = card(page, 'Is the move month and three-year plan settled?');
    await expect(c).toContainText('Decided');
    await expect(c.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
  });

  test('a decision without a plain question shows its title and lets a person write the question', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    const d = await newDecision(avery, 'Storage unit plan', testInfo, { question: false });
    await signIn(page, 'avery', '/decide');
    await loaded(page);
    const c = await openCard(page, d.title);
    // Never the rationale by default; one quiet action instead.
    await c.getByRole('button', { name: 'Write the question' }).click();
    const box = c.getByRole('textbox', { name: 'The question' });
    await expect(box).toBeFocused();
    const q = `Do we keep the storage unit ${testInfo.project.name} ${d.id.slice(-6)}?`;
    await box.fill(q.slice(0, -1)); // the "?" is added when it is missing
    await c.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: q })).toBeVisible();
    await expect(page.getByRole('heading', { name: q })).toBeFocused();
    expect((await avery.record(d.id)).data.plain_question).toBe(q);
  });

  test('the Decide list puts my turn first and shows every open decision', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    const mine = await newDecision(avery, 'Extra choice mine', testInfo);
    const waiting = await newDecision(avery, 'Extra choice waiting', testInfo);
    const v = (await avery.record(waiting.id)).version;
    await avery.post(`/api/decisions/${enc(waiting.id)}/approve`, { baseVersion: v, option_id: 'opt-1' });

    await signIn(page, 'avery', '/decide');
    await loaded(page);
    // The Decisions tab counts the ones that need me.
    await expect(page.getByRole('link', { name: /^Decisions\b.*\b\d+ your turn$/ })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Your turn/ }).getByRole('article', { name: mine.question })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Waiting for Jun/ }).getByRole('article', { name: waiting.question })).toContainText('Waiting for Jun');
    // No helper sentences that explain the app.
    await expect(page.getByText('Proposals have a dashed outline')).toHaveCount(0);
  });

  test('Home never shows more than three decisions, however many are open', async ({ page, signIn, api }, testInfo) => {
    const avery = await api('avery');
    for (let i = 1; i <= 4; i += 1) await newDecision(avery, `Extra choice ${i}`, testInfo);
    await signIn(page, 'avery', '/');
    await loaded(page);
    // Home's "Your turn" holds three rows at most, decisions and items together.
    const section = page.getByRole('region', { name: /^Your turn/ });
    const decisionRows = section.getByRole('listitem').filter({ has: page.locator('a[href^="/decide"]') });
    await expect(decisionRows.first()).toBeVisible();
    const shown = await decisionRows.count();
    expect(shown).toBeGreaterThanOrEqual(1);
    expect(shown).toBeLessThanOrEqual(3);
    expect(await section.getByRole('listitem').count()).toBeLessThanOrEqual(3);
    // The Decide tab says how many need Avery (at least the four just added), and the Decide screen lists all of them.
    const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Decide, \d+ need you$/ });
    const waiting = Number(/(\d+) need you/.exec((await tab.getAttribute('aria-label')) ?? '')![1]);
    expect(waiting).toBeGreaterThanOrEqual(4);
    await tab.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Decide' })).toBeVisible();
    expect(await page.getByRole('region', { name: /^Your turn/ }).getByRole('article').count()).toBeGreaterThan(3);
  });
});
