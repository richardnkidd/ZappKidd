import { describe, expect, it } from 'vitest';
import { collectDeadlines } from '../../src/shared/deadlines';
import type { AuditEntry } from '../../src/shared/types';
import { describeAudit, describeAuditList, changedFields } from '../../src/web/lib/audit';
import { conflictDiffs, flattenChanges } from '../../src/web/lib/changes';
import { compareDates, plain, plainRefs, safeHref, truncate, greetingFor } from '../../src/web/lib/format';
import {
  currentPhase,
  deadlineVerification,
  matchesOwnerFilter,
  selectBlocked,
  selectComingUp,
  selectDecisions,
  selectNow,
  weekLabel,
  weekStart,
  type FilterContext,
} from '../../src/web/lib/home';
import {
  buildPlanItems,
  DEFAULT_FILTERS,
  filterPlanItems,
  groupByStatus,
  groupByWorkstream,
  parseFilters,
  serializeFilters,
  sortPlanItems,
} from '../../src/web/lib/plan';
import { buildIndexes, unmetDependencyKeys } from '../../src/web/lib/records';
import { solarTermFor, solarTermLine, SOLAR_TERMS } from '../../src/web/lib/solarTerms';
import { approvalSummary, needsMyApproval } from '../../src/web/screens/decide/decisionText';
import { computed, DIR, decision, deadline, milestone, PEOPLE, rec } from './helpers';

const TODAY = '2026-10-29';
const CTX: FilterContext = { meId: 'ann', otherIds: ['bo'] };

describe('solar terms (decorative)', () => {
  it('names the term in effect, matching the design brief example', () => {
    expect(solarTermLine('2026-10-29')).toBe('霜降 Sōkō · Frost descends');
    expect(solarTermFor('2026-10-23').kanji).toBe('霜降');
    expect(solarTermFor('2026-10-22').kanji).toBe('寒露');
  });
  it('wraps around the new year', () => {
    expect(solarTermFor('2027-01-02').kanji).toBe('冬至');
    expect(solarTermFor('2027-01-05').kanji).toBe('小寒');
    expect(solarTermFor('2026-12-31').kanji).toBe('冬至');
  });
  it('has all 24 terms in calendar order', () => {
    expect(SOLAR_TERMS).toHaveLength(24);
    const keys = SOLAR_TERMS.map((t) => t.month * 100 + t.day);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });
});

describe('format helpers', () => {
  it('plain() strips parenthesised reference codes only', () => {
    expect(plain('Waiting on the route (W02) and the check (W06).')).toBe('Waiting on the route and the check.');
    expect(plain('Needs W02 and W03 (W02 and W03)')).toBe('Needs W02 and W03');
    expect(plain('Call the office (open 9-5)')).toBe('Call the office (open 9-5)');
    expect(plain(null)).toBe('');
  });
  it('plainRefs() swaps known codes for quoted titles and leaves unknown ones', () => {
    const titleOf = (k: string) => (k === 'W27' ? 'Pick the dates' : null);
    expect(plainRefs('choose exact dates in W27 (W27)', titleOf)).toBe('choose exact dates in “Pick the dates”');
    expect(plainRefs('see W99', titleOf)).toBe('see W99');
  });
  it('safeHref() only allows http(s)', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
  it('compareDates() puts unknown dates last', () => {
    expect(['2026-12-01', null, '2026-11-01'].sort(compareDates)).toEqual(['2026-11-01', '2026-12-01', null]);
  });
  it('truncate() and greetings', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(greetingFor(8)).toBe('Good morning');
    expect(greetingFor(14)).toBe('Good afternoon');
    expect(greetingFor(21)).toBe('Good evening');
  });
});

describe('owner filter', () => {
  it('matches mine / other / together / unassigned / waiting', () => {
    expect(matchesOwnerFilter('mine', 'ann', 'planned', CTX)).toBe(true);
    expect(matchesOwnerFilter('mine', 'bo', 'planned', CTX)).toBe(false);
    expect(matchesOwnerFilter('other', 'bo', 'planned', CTX)).toBe(true);
    expect(matchesOwnerFilter('together', 'together', 'planned', CTX)).toBe(true);
    expect(matchesOwnerFilter('unassigned', null, 'planned', CTX)).toBe(true);
    expect(matchesOwnerFilter('unassigned', 'unassigned', 'planned', CTX)).toBe(true);
    expect(matchesOwnerFilter('waiting', 'ann', 'waiting_external', CTX)).toBe(true);
    expect(matchesOwnerFilter('waiting', 'ann', 'planned', CTX)).toBe(false);
    expect(matchesOwnerFilter('all', null, null, CTX)).toBe(true);
  });
});

describe('Now', () => {
  const records = [
    milestone('W01', 'planned', { priority: 'now' }),
    milestone('W02', 'blocked', { status_reason: 'Waiting', priority: 'now' }),
    milestone('W03', 'planned', { dependencies: ['W02'], priority: 'now' }), // unmet dependency
    milestone('W04', 'planned', { optional_future_work: true, priority: 'now' }),
    milestone('W05', 'in_progress', { deadline: deadline('2026-11-08', 'legal'), priority: 'soon' }),
    milestone('W06', 'planned', { phase: 'p4_stage_minus_90', priority: 'now' }), // later phase
    milestone('W07', 'planned', { review_date: '2026-11-11', priority: 'later' }),
    milestone('W08', 'completed', {}),
    milestone('W09', 'waiting_external', { priority: 'now' }),
    rec('existing_commitment', 'EC1', { data: { recorded_date: '2026-11-02', meaning: 'Soon', deadline_kind: 'user_committed', evidence_caution: '', linked_records: [] } }),
    rec('existing_commitment', 'EC2', { data: { recorded_date: '2026-08-15', meaning: 'Long past', deadline_kind: 'user_committed', evidence_caution: '', linked_records: [] } }),
  ];
  const idx = buildIndexes(records, []);

  it('picks open, unblocked, in-phase, non-optional work, soonest real deadline first', () => {
    const items = selectNow(idx, { today: TODAY, filter: 'all', ctx: CTX });
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(['existing_commitment:EC1', 'milestone:W05', 'milestone:W01', 'milestone:W07']);
    expect(ids).not.toContain('milestone:W02'); // blocked
    expect(ids).not.toContain('milestone:W03'); // dependency unmet
    expect(ids).not.toContain('milestone:W04'); // optional
    expect(ids).not.toContain('milestone:W06'); // later phase
    expect(ids).not.toContain('existing_commitment:EC2'); // an old date proves nothing and is not "now"
  });

  it('caps the list', () => {
    expect(selectNow(idx, { today: TODAY, filter: 'all', ctx: CTX, limit: 2 })).toHaveLength(2);
  });

  it('review checkpoints never rank as deadlines', () => {
    const items = selectNow(idx, { today: TODAY, filter: 'all', ctx: CTX });
    const w07 = items.find((i) => i.id === 'milestone:W07');
    expect(w07?.dateKind).toBe('review_date');
    expect(items.findIndex((i) => i.id === 'milestone:W07')).toBeGreaterThan(items.findIndex((i) => i.id === 'milestone:W01'));
  });

  it('"waiting on someone else" shows only waiting items', () => {
    const items = selectNow(idx, { today: TODAY, filter: 'waiting', ctx: CTX });
    expect(items.map((i) => i.id)).toEqual(['milestone:W09']);
  });

  it('current phase is the earliest with open non-optional work', () => {
    expect(currentPhase(idx)).toBe('p1_now_nov2026');
    expect(unmetDependencyKeys(idx.milestoneByKey.get('W03')!, idx)).toEqual(['W02']);
  });
});

describe('Blocked and decisions', () => {
  const records = [
    milestone('W01', 'blocked', { status_reason: 'Waiting on the vet' }),
    milestone('W02', 'waiting_external', {}, { owner: 'bo' }),
    milestone('W03', 'blocked', { optional_future_work: true }),
    decision('D01', 'open', { needed_by: deadline('2026-12-01', 'internal_target') }),
    decision('D02', 'proposed', { needed_by: deadline('2026-11-15', 'internal_target') }),
    decision('D03', 'approved'),
    decision('D04', 'open'),
  ];
  const idx = buildIndexes(records, []);
  it('lists blocked first, then waiting; never optional work', () => {
    const items = selectBlocked(idx, 'all', CTX);
    expect(items.map((i) => i.record.key)).toEqual(['W01', 'W02']);
    expect(items[0]!.reason).toBe('Waiting on the vet');
    expect(selectBlocked(idx, 'other', CTX).map((i) => i.record.key)).toEqual(['W02']);
  });
  it('orders open and proposed decisions by needed-by date, undated last', () => {
    expect(selectDecisions(idx, 'all', CTX).map((d) => d.key)).toEqual(['D02', 'D01', 'D04']);
  });
});

describe('Coming up', () => {
  const idx = buildIndexes(
    [
      milestone('W01', 'planned', {}),
      milestone('W02', 'planned', {}),
      milestone('W03', 'planned', {}),
      milestone('W04', 'completed', {}),
    ],
    [],
  );
  const deadlines = [
    computed('record:W01', '2026-10-27', 'legal', { record_id: 'milestone:W01', state: 'overdue' }),
    computed('record:W02', '2026-11-04', 'internal_target', { record_id: 'milestone:W02' }),
    computed('record:W03', '2026-11-04', 'estimate', { record_id: 'milestone:W03' }),
    computed('review:W01', '2026-11-11', 'review_date', { record_id: 'milestone:W01', source: 'review' }),
    computed('review:W02', '2026-11-11', 'review_date', { record_id: 'milestone:W02', source: 'review' }),
    computed('review:W03', '2026-11-11', 'review_date', { record_id: 'milestone:W03', source: 'review' }),
    computed('review:W04', '2026-11-18', 'review_date', { record_id: 'milestone:W03', source: 'review' }),
    computed('record:W04', '2026-11-05', 'internal_target', { record_id: 'milestone:W04' }), // completed record: hidden
    computed('rule:later', '2027-03-01', 'legal'), // outside the 60-day window
    computed('rule:await', null, 'legal', { traveler: 'bo' }),
    computed('rule:none', '2026-11-06', 'legal', { applies: 'no' }),
  ];

  it('collapses review checkpoints that share a date into one summary row and never calls them deadlines', () => {
    const out = selectComingUp(deadlines, idx, DIR, { today: TODAY, filter: 'all', ctx: CTX });
    const rows = out.groups.flatMap((g) => g.rows);
    const summaries = rows.filter((r) => r.kind === 'review_summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.reviews).toHaveLength(3);
    expect(summaries[0]!.date).toBe('2026-11-11');
    // the lone review checkpoint on Nov 18 stays an ordinary (review-kind) row
    const lone = rows.find((r) => r.kind === 'deadline' && r.deadline!.id === 'review:W04');
    expect(lone?.deadline?.kind).toBe('review_date');
  });

  it('groups by week, puts past dates first, and keeps awaiting-date items separate', () => {
    const out = selectComingUp(deadlines, idx, DIR, { today: TODAY, filter: 'all', ctx: CTX });
    expect(out.groups.map((g) => g.label)).toEqual(['Past their date', 'Next week', 'Week of Nov 9', 'Week of Nov 16']);
    expect(out.groups[0]!.rows[0]!.deadline!.id).toBe('record:W01');
    expect(out.awaiting.map((d) => d.id)).toEqual(['rule:await']);
  });

  it('hides completed work, not-applicable rules and dates outside the window', () => {
    const out = selectComingUp(deadlines, idx, DIR, { today: TODAY, filter: 'all', ctx: CTX });
    const ids = out.groups.flatMap((g) => g.rows).flatMap((r) => (r.kind === 'deadline' ? [r.deadline!.id] : r.reviews!.map((x) => x.id)));
    expect(ids).not.toContain('record:W04');
    expect(ids).not.toContain('rule:later');
    expect(ids).not.toContain('rule:none');
  });

  it('week helpers', () => {
    expect(weekStart('2026-10-29')).toBe('2026-10-26'); // Thursday -> Monday
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sunday belongs to the week before
    expect(weekLabel('2026-10-26', '2026-10-26')).toBe('This week');
    expect(weekLabel('2026-11-02', '2026-10-26')).toBe('Next week');
    expect(weekLabel('2026-11-16', '2026-10-26')).toBe('Week of Nov 16');
  });

  it('person filter limits by the owner of the dated record', () => {
    const owned = buildIndexes([milestone('W01', 'planned', {}, { owner: 'bo' }), milestone('W02', 'planned', {}, { owner: 'ann' })], []);
    const d = [computed('record:W01', '2026-11-04', 'internal_target', { record_id: 'milestone:W01' }), computed('record:W02', '2026-11-04', 'internal_target', { record_id: 'milestone:W02' })];
    const mine = selectComingUp(d, owned, DIR, { today: TODAY, filter: 'mine', ctx: CTX });
    expect(mine.groups.flatMap((g) => g.rows).map((r) => r.deadline!.id)).toEqual(['record:W02']);
  });

  it('works with the real deadline engine (does not throw on an empty plan)', () => {
    const result = collectDeadlines({ records: [], people: PEOPLE, task_links: [], today: TODAY });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('verification label logic', () => {
  const ruleIdx = buildIndexes(
    [
      rec('deadline_rule', 'RULE-A', { data: { verification: 'indexed_only' } }),
      rec('deadline_rule', 'RULE-B', { data: { verification: 'verified_official' } }),
      rec('deadline_rule', 'RULE-C', { data: {} }),
    ],
    [],
  );
  it('flags anything that is not verified from official text', () => {
    expect(deadlineVerification(computed('x', '2026-11-01', 'legal', { rule_id: 'RULE-A' }), ruleIdx)).toBe('indexed_only');
    expect(deadlineVerification(computed('x', '2026-11-01', 'legal', { rule_id: 'RULE-B' }), ruleIdx)).toBe('verified_official');
    expect(deadlineVerification(computed('x', '2026-11-01', 'legal', { rule_id: 'RULE-C' }), ruleIdx)).toBe('not_verified');
  });
  it('treats a legal date with no verification date as not verified, but leaves ordinary targets alone', () => {
    expect(deadlineVerification(computed('x', '2026-11-01', 'legal'), ruleIdx)).toBe('not_verified');
    expect(deadlineVerification(computed('y', '2026-11-01', 'internal_target'), ruleIdx)).toBeNull();
  });
});

describe('Plan filters, sorting and grouping', () => {
  const records = [
    milestone('W01', 'in_progress', { workstream_key: 'S02', traveler_scope: ['ann'], phase: 'p1_now_nov2026', deadline: deadline('2026-11-20', 'legal') }, { owner: 'ann' }),
    milestone('W02', 'planned', { workstream_key: 'S01', traveler_scope: [], phase: 'p2_nov_dec2026' }, { owner: 'together' }),
    milestone('W03', 'blocked', { workstream_key: 'S02', traveler_scope: ['bo'], optional_future_work: false }, { owner: null }),
    milestone('W04', 'planned', { optional_future_work: true, workstream_key: null }, { owner: 'bo' }),
    milestone('W05', 'completed', { workstream_key: 'S01' }, { owner: 'ann' }),
    rec('workstream', 'S01', { title: 'Alpha stream', data: { related: ['W04'] } }),
    rec('workstream', 'S02', { title: 'Beta stream' }),
  ];
  const idx = buildIndexes(records, []);
  const items = buildPlanItems(idx);

  it('hides optional work by default and shows it on request', () => {
    expect(filterPlanItems(items, DEFAULT_FILTERS, CTX).map((i) => i.m.key)).not.toContain('W04');
    expect(filterPlanItems(items, { ...DEFAULT_FILTERS, hideOptional: false }, CTX).map((i) => i.m.key)).toContain('W04');
  });
  it('filters by owner, traveler, phase and status', () => {
    expect(filterPlanItems(items, { ...DEFAULT_FILTERS, owner: 'unassigned' }, CTX).map((i) => i.m.key)).toEqual(['W03']);
    expect(filterPlanItems(items, { ...DEFAULT_FILTERS, traveler: 'bo' }, CTX).map((i) => i.m.key)).toEqual(['W03']);
    expect(filterPlanItems(items, { ...DEFAULT_FILTERS, traveler: 'household' }, CTX).map((i) => i.m.key)).toEqual(['W02', 'W05']);
    expect(filterPlanItems(items, { ...DEFAULT_FILTERS, phase: 'p2_nov_dec2026' }, CTX).map((i) => i.m.key)).toEqual(['W02']);
    expect(filterPlanItems(items, { ...DEFAULT_FILTERS, status: 'open' }, CTX).map((i) => i.m.key)).not.toContain('W05');
    expect(filterPlanItems(items, { ...DEFAULT_FILTERS, status: 'blocked' }, CTX).map((i) => i.m.key)).toEqual(['W03']);
  });
  it('sorts by date with unknown last, and by status order', () => {
    expect(sortPlanItems(items, 'date', DIR.ownerLabel)[0]!.m.key).toBe('W01');
    expect(sortPlanItems(items, 'status', DIR.ownerLabel).map((i) => i.m.status)[0]).toBe('planned');
  });
  it('groups by workstream (titles, order) and by status', () => {
    const groups = groupByWorkstream(items, idx);
    expect(groups.map((g) => g.title)).toEqual(['Alpha stream', 'Beta stream', 'Other work']);
    expect(groups[0]!.related).toEqual(['W04']);
    expect(groupByStatus(items).get('blocked')!.map((i) => i.m.key)).toEqual(['W03']);
  });
  it('round-trips filters through the URL and omits defaults', () => {
    const f = { ...DEFAULT_FILTERS, owner: 'mine' as const, hideOptional: false, phase: 'p3_jan_mar2027' as const };
    const qs = serializeFilters(f, 'board');
    expect(qs.get('view')).toBe('board');
    expect(qs.has('traveler')).toBe(false);
    expect(parseFilters(qs)).toEqual(f);
    expect(parseFilters(new URLSearchParams('owner=bogus&phase=zzz&status=nope'))).toEqual(DEFAULT_FILTERS);
  });
});

describe('decisions: approvals read honestly', () => {
  it('says who has approved and who is awaited', () => {
    const d = decision('D1', 'open', { approvals: [{ person_id: 'ann', at: '2026-10-28T10:00:00Z', option_id: 'a', note: null }] });
    expect(approvalSummary(d as never, DIR)).toEqual({ text: 'Approved by Ann · awaiting Bo', state: 'partial' });
    expect(needsMyApproval(d as never, DIR)).toBe(false); // I am Ann and already approved
    expect(needsMyApproval(decision('D2', 'open') as never, DIR)).toBe(true);
  });
  it('calls out disagreement instead of showing approved', () => {
    const d = decision('D1', 'open', {
      approvals: [
        { person_id: 'ann', at: '2026-10-28T10:00:00Z', option_id: 'a', note: null },
        { person_id: 'bo', at: '2026-10-28T11:00:00Z', option_id: 'b', note: null },
      ],
    });
    const s = approvalSummary(d as never, DIR);
    expect(s.state).toBe('disagree');
    expect(s.text).toContain('Ann chose “Option A”');
    expect(s.text).toContain('Bo chose “Option B”');
  });
  it('reads as approved only when everyone required chose the same option', () => {
    const d = decision('D1', 'approved', {
      approvals: [
        { person_id: 'ann', at: '2026-10-28T10:00:00Z', option_id: 'a', note: null },
        { person_id: 'bo', at: '2026-10-28T11:00:00Z', option_id: 'a', note: null },
      ],
    });
    expect(approvalSummary(d as never, DIR)).toEqual({ text: 'Approved by Ann and Bo · “Option A”', state: 'agreed' });
  });
  it('uses the latest approval when someone changes their mind', () => {
    const d = decision('D1', 'open', {
      approvals: [
        { person_id: 'ann', at: '2026-10-28T10:00:00Z', option_id: 'b', note: null },
        { person_id: 'ann', at: '2026-10-29T10:00:00Z', option_id: 'a', note: null },
      ],
    });
    expect(approvalSummary(d as never, DIR).text).toBe('Approved by Ann · awaiting Bo');
  });
  it('closed decisions read plainly', () => {
    expect(approvalSummary(decision('D1', 'rejected') as never, DIR).state).toBe('closed');
    expect(approvalSummary(decision('D1', 'deferred') as never, DIR).text).toBe('Put off for now');
  });
});

describe('history in plain language', () => {
  const idx = buildIndexes([milestone('W01', 'planned', {}, { title: 'Book the movers' })], []);
  const entry = (over: Partial<AuditEntry>): AuditEntry => ({
    id: 'a1',
    household_id: 'h',
    at: '2026-10-29T10:00:00Z',
    actor: 'bo',
    record_id: 'milestone:W01',
    action: 'update',
    before: null,
    after: null,
    reason: null,
    undone_by: null,
    ...over,
  });
  it('names who did what to which item, without IDs', () => {
    const line = describeAudit(entry({ action: 'status_change', after: { status: 'blocked' } }), idx, DIR);
    expect(line.who).toBe('Bo');
    expect(line.what).toBe('marked “Book the movers” as Blocked');
    const edit = describeAudit(entry({ before: { data: { next_action: 'a', priority: 'now' } }, after: { data: { next_action: 'b', priority: 'now' } } }), idx, DIR);
    expect(edit.what).toBe('changed the next action on “Book the movers”');
    expect(describeAudit(entry({ action: 'approve' }), idx, DIR).what).toBe('approved “Book the movers”');
  });
  it('rolls imports into one line so they do not bury real edits', () => {
    const lines = describeAuditList(
      [
        entry({ id: '1', action: 'import_create', actor: 'import', at: '2026-10-01T00:00:00Z' }),
        entry({ id: '2', action: 'import_update', actor: 'import', at: '2026-10-01T00:00:01Z' }),
        entry({ id: '3', action: 'update', at: '2026-10-29T10:00:00Z' }),
      ],
      idx,
      DIR,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.id).toBe('3'); // newest first
    expect(lines[1]!.what).toBe('brought in 2 changes');
  });
  it('changedFields only reports labelled fields that differ', () => {
    expect(changedFields({ owner: 'ann', title: 'x' }, { owner: 'bo', title: 'x' })).toEqual(['owner']);
    expect(changedFields(null, 'nonsense')).toEqual([]);
  });
});

describe('conflict diffs', () => {
  it('flattens nested changes and shows theirs beside yours with friendly names', () => {
    expect(flattenChanges({ owner: 'bo', data: { next_action: 'x', deadline: { date: '2026-11-01' } } })).toEqual({
      owner: 'bo',
      'data.next_action': 'x',
      'data.deadline': { date: '2026-11-01' },
    });
    const server = milestone('W01', 'planned', { next_action: 'Their text' }, { owner: 'ann' });
    const diffs = conflictDiffs({ owner: 'bo', data: { next_action: 'My text' } }, server, DIR);
    expect(diffs).toEqual([
      { path: 'owner', label: 'owner', theirs: 'Ann', yours: 'Bo' },
      { path: 'data.next_action', label: 'next action', theirs: 'Their text', yours: 'My text' },
    ]);
  });
});
