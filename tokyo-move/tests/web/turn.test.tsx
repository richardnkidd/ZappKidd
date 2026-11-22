import { describe, expect, it } from 'vitest';
import { countMyTurn, isMyTurn, myTurnDecisions, neededByDate, turnBadge, turnInfo } from '../../src/web/lib/turn';

const dec = (status: string, approvals: { person_id: string; option_id: string }[], approvers = ['avery', 'jun']) => ({
  status,
  data: { required_approvers: approvers, approvals: approvals.map((a) => ({ ...a, at: '2026-11-01T00:00:00Z', note: null })) },
});

describe('whose turn is it on a decision', () => {
  it('is mine first when nobody has chosen', () => {
    expect(turnInfo(dec('open', []), 'avery').turn).toBe('mine_first');
  });
  it('is mine after my partner chose, and reports their choice', () => {
    const t = turnInfo(dec('proposed', [{ person_id: 'jun', option_id: 'opt-2' }]), 'avery');
    expect(t.turn).toBe('mine_after_partner');
    expect(t.otherId).toBe('jun');
    expect(t.otherOptionId).toBe('opt-2');
  });
  it('waits for my partner once I have chosen', () => {
    const d = dec('proposed', [{ person_id: 'avery', option_id: 'opt-1' }]);
    expect(turnInfo(d, 'avery').turn).toBe('waiting_partner');
    expect(isMyTurn(d, 'avery')).toBe(false);
    expect(isMyTurn(d, 'jun')).toBe(true);
  });
  it('flags a disagreement to both people', () => {
    const d = dec('proposed', [{ person_id: 'avery', option_id: 'opt-1' }, { person_id: 'jun', option_id: 'opt-2' }]);
    expect(turnInfo(d, 'avery').turn).toBe('disagree');
    expect(turnInfo(d, 'jun').turn).toBe('disagree');
  });
  it('is nobody\'s turn when settled, put off, rejected, or I am not an approver', () => {
    expect(turnInfo(dec('approved', []), 'avery').turn).toBe('none');
    expect(turnInfo(dec('deferred', []), 'avery').turn).toBe('none');
    expect(turnInfo(dec('rejected', []), 'avery').turn).toBe('none');
    expect(turnInfo(dec('open', [], ['jun']), 'avery').turn).toBe('none');
    expect(turnInfo(dec('open', []), null).turn).toBe('none');
  });
  it('lists my turn with disagreements and partner-answered first, and counts them', () => {
    const list = [dec('open', []), dec('proposed', [{ person_id: 'jun', option_id: 'opt-1' }]), dec('proposed', [{ person_id: 'avery', option_id: 'opt-1' }]), dec('approved', [])];
    expect(myTurnDecisions(list, 'avery').map((t) => t.turn)).toEqual(['mine_after_partner', 'mine_first']);
    expect(countMyTurn(list, 'avery')).toBe(2);
    expect(countMyTurn(list, 'jun')).toBe(2);
  });
});

describe('the Decide tab badge', () => {
  const TODAY = '2026-11-22';
  const withDate = (date: string | null, approvals: { person_id: string; option_id: string }[] = []) => {
    const d = dec(approvals.length ? 'proposed' : 'open', approvals);
    return { ...d, data: { ...d.data, needed_by: date ? { date } : null } };
  };
  const badge = (list: ReturnType<typeof withDate>[], me = 'avery') => turnBadge(list.map((r) => turnInfo(r, me)), TODAY);

  it('counts my turn needed within 14 days, or already late', () => {
    expect(badge([withDate('2026-12-06'), withDate('2026-11-01'), withDate('2026-12-07')])).toEqual({ count: 2, mine: 3 });
  });
  it('counts my turn when my partner already chose, whatever the date', () => {
    expect(badge([withDate(null, [{ person_id: 'jun', option_id: 'opt-1' }]), withDate(null)])).toEqual({ count: 1, mine: 2 });
    // A disagreement: my partner chose too.
    expect(badge([withDate(null, [{ person_id: 'avery', option_id: 'opt-1' }, { person_id: 'jun', option_id: 'opt-2' }])]).count).toBe(1);
  });
  it('does not count decisions waiting for my partner', () => {
    expect(badge([withDate('2026-11-23', [{ person_id: 'avery', option_id: 'opt-1' }])])).toEqual({ count: 0, mine: 0 });
  });
  it('has nothing urgent but still some of mine: count 0 and mine above 0 (the tab shows a dot)', () => {
    expect(badge([withDate(null), withDate('2027-03-01')])).toEqual({ count: 0, mine: 2 });
  });
  it('ignores a needed-by that is not a real date', () => {
    expect(neededByDate(withDate('T+90 internal project gate'))).toBeNull();
    expect(badge([withDate('T+90 internal project gate')]).count).toBe(0);
  });
});
