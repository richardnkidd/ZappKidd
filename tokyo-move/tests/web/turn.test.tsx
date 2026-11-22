import { describe, expect, it } from 'vitest';
import { countMyTurn, isMyTurn, myTurnDecisions, turnInfo } from '../../src/web/lib/turn';

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
