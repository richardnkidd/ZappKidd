/** The one-screen Home: what goes in "Your turn", "Stuck", "Travellers" and the "since you last looked" line. */
import { describe, expect, it } from 'vitest';
import type { GateStatus, TravelerReadiness } from '../../src/shared/engine-contracts';
import type { AuditEntry, BaseRecord } from '../../src/shared/types';
import { countSince, describeSince, selectStuck, selectYourTurn, travellerChip, waitingOnText } from '../../src/web/lib/home';
import { buildIndexes, type Milestone } from '../../src/web/lib/records';
import { countMyTurn } from '../../src/web/lib/turn';
import { DIR, decision, milestone } from './helpers';

const TODAY = '2026-11-22';
const approval = (person_id: string, option_id: string) => ({ person_id, option_id, at: '2026-11-01T00:00:00Z', note: null });

function turn(records: BaseRecord[], meId = 'ann') {
  const idx = buildIndexes(records, []);
  return selectYourTurn({ idx, meId, nameOf: DIR.nameOf, today: TODAY });
}

describe('Your turn', () => {
  it('phrases a partner-answered decision as a yes-or-no, and others as "Decide: <question>"', () => {
    const d1 = decision('D01', 'proposed', { approvals: [approval('bo', 'b')], plain_options: { b: 'Protect a safety fund.' } });
    const d2 = decision('D02', 'open', { plain_question: 'How much can we spend on the move?' });
    const { rows } = turn([d1, d2]);
    expect(rows.map((r) => (r.kind === 'decision' ? r.text : r.title))).toEqual([
      'Bo chose “Protect a safety fund”. Agree?',
      'Decide: How much can we spend on the move?',
    ]);
  });

  it('never shows more than three decisions, and the count matches the Decide tab badge', () => {
    const ds = ['D01', 'D02', 'D03', 'D04', 'D05'].map((k) => decision(k, 'open'));
    const out = turn(ds);
    expect(out.rows).toHaveLength(3);
    expect(out.rows.every((r) => r.kind === 'decision')).toBe(true);
    expect(out.decisions).toBe(countMyTurn(ds, 'ann'));
  });

  it('keeps a row for the most urgent item, overdue first, and leaves out other people’s work', () => {
    const ds = ['D01', 'D02', 'D03'].map((k) => decision(k, 'open'));
    const late = milestone('W01', 'in_progress', { deadline: { date: '2026-11-11', kind: 'user_committed' } as never }, { owner: 'together' });
    const soon = milestone('W02', 'planned', { deadline: { date: '2026-12-01', kind: 'user_committed' } as never });
    const theirs = milestone('W03', 'planned', { deadline: { date: '2026-11-01', kind: 'user_committed' } as never }, { owner: 'bo' });
    const { rows } = turn([...ds, soon, late, theirs]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.kind === 'decision')).toHaveLength(2);
    const task = rows.find((r) => r.kind === 'task');
    expect(task && task.kind === 'task' ? [task.recordId, task.date] : null).toEqual(['milestone:W01', '2026-11-11']);
  });

  it('is empty when nothing needs me', () => {
    expect(turn([decision('D01', 'approved')]).rows).toEqual([]);
  });
});

describe('Stuck', () => {
  it('counts exactly the blocked items Plan lists for status=blocked, and says what each waits on', () => {
    const w1 = milestone('W01', 'in_progress', {}, { title: 'Get the visa (W01)' });
    const w2 = milestone('W02', 'blocked', { dependencies: ['W01'] }, { title: 'Book flights' });
    const w3 = milestone('W03', 'blocked', { status_reason: 'Waiting on the landlord’s reply (W09).' }, { title: 'Storage contract' });
    const waiting = milestone('W04', 'waiting_external', { status_reason: 'Employer' });
    const optional = milestone('W05', 'blocked', { optional_future_work: true });
    const idx = buildIndexes([w1, w2, w3, waiting, optional], []);
    const { rows, total } = selectStuck(idx);
    expect(total).toBe(2);
    expect(rows.map((r) => `${r.title} — waiting on ${r.waitingOn}`)).toEqual([
      'Book flights — waiting on Get the visa',
      'Storage contract — waiting on the landlord’s reply',
    ]);
  });

  it('names one prerequisite and counts the rest', () => {
    const a = milestone('W01', 'planned', {}, { title: 'First thing' });
    const b = milestone('W02', 'planned', {}, { title: 'Second thing' });
    const c = milestone('W03', 'blocked', { dependencies: ['W01', 'W02'] });
    const idx = buildIndexes([a, b, c], []);
    expect(waitingOnText(c as unknown as Milestone, idx)).toBe('First thing and 1 more');
  });
});

describe('Travellers', () => {
  const gate = (key: string, title: string): GateStatus => ({
    record_id: `milestone:${key}`, key, title, status: 'planned', met: false, requirement: 'required', condition: null,
    stage: 'before_departure', blocker: null, owner: null, blocked_by: [],
  });
  const ready = (over: Partial<TravelerReadiness>): TravelerReadiness => ({
    person_id: 'ann', state: 'preparing', headline: '', blockers: [], open: [], met: [], conditional_unknown: [], after_arrival: [],
    next_action: null, departure: null, arrival: null, ...over,
  });

  it('says how many steps are left and the one thing holding them up, never "Preparing"', () => {
    const idx = buildIndexes([milestone('W01', 'blocked', {}, { title: 'Visa (W01)' })], []);
    const chip = travellerChip(ready({ state: 'blocked', blockers: [gate('W01', 'Visa')], open: [gate('W02', 'a'), gate('W03', 'b'), gate('W04', 'c')] }), idx);
    expect(chip.text).toBe('4 left · stuck on Visa');
    expect(travellerChip(ready({ open: [gate('W02', 'a')] }), idx).text).toBe('1 left');
    expect(travellerChip(ready({ state: 'ready_to_release' }), idx).text).toBe('Ready to go');
  });

  it('never counts optional future work', () => {
    const idx = buildIndexes([milestone('W09', 'planned', { optional_future_work: true })], []);
    expect(travellerChip(ready({ open: [gate('W09', 'Later')] }), idx).left).toBe(0);
  });
});

describe('Since you last looked', () => {
  const entry = (over: Partial<AuditEntry>): AuditEntry => ({
    id: Math.random().toString(36).slice(2), household_id: 'h', at: '2026-11-21T10:00:00Z', actor: 'bo', record_id: null,
    action: 'update', before: null, after: null, reason: null, undone_by: null, ...over,
  });

  it('counts records the other adult changed after I last looked; nothing on a first visit', () => {
    const recs = [
      { updated_by: 'bo', updated_at: '2026-11-21T10:00:00Z' },
      { updated_by: 'bo', updated_at: '2026-11-01T10:00:00Z' },
      { updated_by: 'ann', updated_at: '2026-11-21T10:00:00Z' },
      { updated_by: 'import', updated_at: '2026-11-21T10:00:00Z' },
    ];
    expect(countSince(recs, 'bo', '2026-11-20T00:00:00Z')).toBe(1);
    expect(countSince(recs, 'bo', null)).toBe(0);
  });

  it('phrases what they did as actions and leaves out import events', () => {
    const d = decision('D01', 'proposed', { plain_question: 'How much can we spend?', approvals: [approval('ann', 'a'), approval('bo', 'b')] });
    const m = milestone('W01', 'completed', {}, { title: 'Check passports (W01)' });
    const idx = buildIndexes([d, m], []);
    const lines = describeSince(
      [
        entry({ action: 'approve', record_id: d.id, at: '2026-11-21T11:00:00Z' }),
        entry({ action: 'status_change', record_id: m.id, after: { status: 'completed' } }),
        entry({ action: 'import_update', actor: 'bo', record_id: m.id }),
        entry({ action: 'update', actor: 'ann', record_id: m.id }),
      ],
      idx,
      'bo',
      'ann',
    );
    expect(lines.map((l) => l.text)).toEqual(['chose a different option on “How much can we spend?”', 'finished “Check passports”']);
  });
});
