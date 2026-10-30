import { describe, expect, it } from 'vitest';
import { anchorsFrom, collectDeadlines, computeRuleDeadlines, defaultNewTaskDue, previewAnchorChange } from '../../src/shared/deadlines';
import type { DeadlineRuleData } from '../../src/shared/types';
import type { BaseRecord } from '../../src/shared/types';
import { demo, patch, setAnchor } from './helpers';

const TODAY = '2026-10-29';

function ctxOf(records: BaseRecord[], people = demo().people) {
  return { records, people, today: TODAY };
}

function ruleRecords(records: BaseRecord[]) {
  return records.filter((r) => r.type === 'deadline_rule') as unknown as import('../../src/shared/types').BaseRecord<'deadline_rule', DeadlineRuleData>[];
}

describe('missing anchors', () => {
  it('yields awaiting_date with a null date, never a guess', () => {
    const { records, people } = demo();
    const deadlines = collectDeadlines(ctxOf(records, people));
    const junRelease = deadlines.find((d) => d.id === 'rule:RULE-JUN-RELEASE');
    expect(junRelease?.state).toBe('awaiting_date');
    expect(junRelease?.deadline.date).toBeNull();
    expect(junRelease?.days_until).toBeNull();
    // Jun's residence anchor is blank, so Jun's residence notice awaits
    const junResidence = deadlines.find((d) => d.id === 'rule:RULE-RESIDENCE-NOTICE:jun');
    expect(junResidence?.state).toBe('awaiting_date');
  });

  it('an unknown or absent anchor says the rule starts when it is triggered', () => {
    const { records, people } = demo();
    const withEvent = patch(records, 'deadline_rule:RULE-PET-LOCAL-REGISTRATION', (r) => {
      (r.data as unknown as DeadlineRuleData).anchor = 'other';
    });
    const d = computeRuleDeadlines(ruleRecords(withEvent), anchorsFrom(withEvent), people, TODAY).find((x) => x.rule_id === 'RULE-PET-LOCAL-REGISTRATION');
    expect(d?.state).toBe('awaiting_date');
    expect(d?.deadline.basis).toBe('Starts when Mochi local registration is triggered.');
  });
});

describe('rule expansion', () => {
  it('each_adult rules expand per adult using that adult\'s own anchors', () => {
    let { records } = demo();
    const { people } = demo();
    records = setAnchor(records, 'RN', '2027-07-10', 'planned');
    records = setAnchor(records, 'RR', '2027-10-20', 'planned');
    const out = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, TODAY).filter((d) => d.rule_id === 'RULE-RESIDENCE-NOTICE');
    expect(out.map((d) => [d.traveler, d.deadline.date])).toEqual([
      ['avery', '2027-07-24'],
      ['jun', '2027-11-03'],
    ]);
    expect(out.every((d) => d.kind === 'legal')).toBe(true);
    expect(out[0]?.label).toBe('Residence notification (each adult) — Avery');
  });

  it('calendar-month rules use EDATE semantics (end-of-month clamp)', () => {
    let { records } = demo();
    const { people } = demo();
    records = setAnchor(records, 'TN', '2027-08-31');
    const out = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, TODAY).find((d) => d.id === 'rule:RULE-BAGGAGE-OUTER:avery');
    expect(out?.deadline.date).toBe('2028-02-29');
    expect(out?.deadline.unit).toBe('calendar_months');
    // Jun's arrival is blank, so Jun's window awaits
    const jun = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, TODAY).find((d) => d.id === 'rule:RULE-BAGGAGE-OUTER:jun');
    expect(jun?.state).toBe('awaiting_date');
  });

  it('computes before/after offsets and due states from today', () => {
    const { records, people } = demo();
    const out = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, '2027-07-01');
    const prep = out.find((d) => d.rule_id === 'RULE-PET-NOTICE-PREP');
    expect(prep?.deadline.date).toBe('2027-07-16'); // TP 2027-09-14 minus 60
    const min = out.find((d) => d.rule_id === 'RULE-PET-NOTICE-MIN');
    expect(min?.deadline.date).toBe('2027-08-05'); // TP minus 40
    expect(min?.kind).toBe('legal');
    expect(prep?.state).toBe('upcoming');
    const sameDay = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, '2027-07-16').find((d) => d.rule_id === 'RULE-PET-NOTICE-PREP');
    expect(sameDay?.state).toBe('due_today');
    const near = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, '2027-07-10').find((d) => d.rule_id === 'RULE-PET-NOTICE-PREP');
    expect(near?.state).toBe('due_soon');
    const late = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, '2027-07-20').find((d) => d.rule_id === 'RULE-PET-NOTICE-PREP');
    expect(late?.state).toBe('overdue');
    expect(late?.days_until).toBe(-4);
  });

  it('ignores superseded and inactive rules, and rules with superseded_by', () => {
    const { records, people } = demo();
    let r = patch(records, 'deadline_rule:RULE-PET-NOTICE-PREP', (x) => { x.status = 'superseded'; });
    r = patch(r, 'deadline_rule:RULE-PET-NOTICE-MIN', (x) => { x.status = 'inactive'; });
    r = patch(r, 'deadline_rule:RULE-PET-EXAM-WINDOW', (x) => { (x.data as unknown as DeadlineRuleData).superseded_by = 'RULE-OTHER'; });
    const ids = computeRuleDeadlines(ruleRecords(r), anchorsFrom(r), people, TODAY).map((d) => d.rule_id);
    expect(ids).not.toContain('RULE-PET-NOTICE-PREP');
    expect(ids).not.toContain('RULE-PET-NOTICE-MIN');
    expect(ids).not.toContain('RULE-PET-EXAM-WINDOW');
    expect(ids).toContain('RULE-PET-LOCAL-REGISTRATION');
  });

  it('business-day rules without a holiday calendar are flagged approximate', () => {
    const { records, people } = demo();
    const r = patch(records, 'deadline_rule:RULE-PET-NOTICE-MIN', (x) => {
      const d = x.data as unknown as DeadlineRuleData;
      d.unit = 'business_days';
      d.offset = 5;
    });
    const withoutCal = computeRuleDeadlines(ruleRecords(r), anchorsFrom(r), people, TODAY).find((d) => d.rule_id === 'RULE-PET-NOTICE-MIN');
    expect(withoutCal?.approximate).toBe(true);
    const withCal = computeRuleDeadlines(ruleRecords(r), anchorsFrom(r), people, TODAY, { holidays: new Set(['2027-09-08']) }).find((d) => d.rule_id === 'RULE-PET-NOTICE-MIN');
    expect(withCal?.approximate).toBe(false);
    expect(withCal?.deadline.date).not.toBe(withoutCal?.deadline.date);
  });
});

describe('household coordination dates', () => {
  it('household T/D rules are coordination only and keep traveler "household"', () => {
    const { records, people } = demo();
    const out = computeRuleDeadlines(ruleRecords(records), anchorsFrom(records), people, TODAY);
    const review = out.find((d) => d.rule_id === 'RULE-READINESS-REVIEW');
    expect(review?.traveler).toBe('household');
    expect(review?.deadline.date).toBe('2027-06-22'); // T 2027-07-06 minus 14
    expect(review?.kind).toBe('internal_target');
  });

  it('never lets T or D date a traveler-specific action or a legal deadline', () => {
    const { records, people } = demo();
    let r = patch(records, 'deadline_rule:RULE-AVERY-RELEASE', (x) => { (x.data as unknown as DeadlineRuleData).anchor = 'D'; });
    r = patch(r, 'deadline_rule:RULE-READINESS-REVIEW', (x) => { (x.data as unknown as DeadlineRuleData).kind = 'legal'; });
    const out = computeRuleDeadlines(ruleRecords(r), anchorsFrom(r), people, TODAY);
    const travelerRule = out.find((d) => d.rule_id === 'RULE-AVERY-RELEASE');
    expect(travelerRule?.deadline.date).toBeNull();
    expect(travelerRule?.state).toBe('awaiting_date');
    const legalHousehold = out.find((d) => d.rule_id === 'RULE-READINESS-REVIEW');
    expect(legalHousehold?.deadline.date).toBeNull();
  });
});

describe('anchor-change preview', () => {
  it("changing the pet's TP/DP changes ONLY the pet's deadlines", () => {
    const { records, people } = demo();
    const ctx = ctxOf(records, people);
    for (const code of ['TP', 'DP']) {
      const current = anchorsFrom(records).find((a) => a.code === code)?.date as string;
      const next = current.replace('2027-09', '2027-10');
      const preview = previewAnchorChange(ctx, code, next);
      expect(preview.traveler).toBe('mochi');
      expect(preview.changes.length).toBeGreaterThan(0);
      expect(preview.changes.every((c) => c.traveler === 'mochi')).toBe(true);
      expect(preview.unaffected_travelers.sort()).toEqual(['avery', 'jun']);
      expect(preview.unchanged_count).toBeGreaterThan(0);
    }
    const tp = previewAnchorChange(ctx, 'TP', '2027-10-14');
    const prep = tp.changes.find((c) => c.deadline_id === 'rule:RULE-PET-NOTICE-PREP');
    expect(prep).toMatchObject({ before: '2027-07-16', after: '2027-08-15', traveler: 'mochi' });
    expect(prep?.record_keys).toContain('W15');
    // the adults' deadlines are identical before and after
    const before = collectDeadlines(ctx).filter((d) => d.traveler === 'avery' || d.traveler === 'jun');
    const after = collectDeadlines(ctxOf(setAnchor(records, 'TP', '2027-10-14'), people)).filter((d) => d.traveler === 'avery' || d.traveler === 'jun');
    expect(after.map((d) => [d.id, d.deadline.date])).toEqual(before.map((d) => [d.id, d.deadline.date]));
    expect(tp.warnings.some((w) => /legal deadline/i.test(w))).toBe(true);
  });

  it("changing one adult's departure leaves the other adult and the pet unchanged", () => {
    const { records, people } = demo();
    const preview = previewAnchorChange(ctxOf(records, people), 'DN', '2027-07-12');
    expect(preview.changes.every((c) => c.traveler === 'avery')).toBe(true);
    expect(preview.changes.map((c) => c.deadline_id)).toContain('rule:RULE-AVERY-RELEASE');
    expect(preview.unaffected_travelers.sort()).toEqual(['jun', 'mochi']);
  });

  it('household helper dates carry a warning and do not move any traveler deadline', () => {
    const { records, people } = demo();
    const preview = previewAnchorChange(ctxOf(records, people), 'T', '2027-07-20');
    expect(preview.changes.every((c) => c.traveler === 'household')).toBe(true);
    expect(preview.unaffected_travelers.sort()).toEqual(['avery', 'jun', 'mochi']);
    expect(preview.warnings.some((w) => /helper/i.test(w))).toBe(true);
  });

  it('warns about past dates and about clearing a date, and rejects bad input', () => {
    const { records, people } = demo();
    const ctx = ctxOf(records, people);
    expect(previewAnchorChange(ctx, 'TP', '2026-01-01').warnings.some((w) => /before today/i.test(w))).toBe(true);
    const cleared = previewAnchorChange(ctx, 'TP', null);
    expect(cleared.after).toBeNull();
    expect(cleared.changes.every((c) => c.after === null)).toBe(true);
    expect(cleared.warnings.some((w) => /Awaiting date/.test(w))).toBe(true);
    expect(previewAnchorChange(ctx, 'TP', '2027-13-45').warnings[0]).toMatch(/valid/);
    expect(previewAnchorChange(ctx, 'NOPE', '2027-01-01').warnings[0]).toMatch(/no date called/i);
  });

  it('applies nothing: the input records are untouched', () => {
    const { records, people } = demo();
    const snapshot = JSON.stringify(records);
    previewAnchorChange(ctxOf(records, people), 'TP', '2027-12-01');
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});

describe('collectDeadlines', () => {
  it('shows review dates as review_date, never legal or an expiry', () => {
    const { records, people } = demo();
    const reviews = collectDeadlines(ctxOf(records, people)).filter((d) => d.source === 'review');
    expect(reviews.length).toBeGreaterThan(0);
    for (const r of reviews) {
      expect(r.kind).toBe('review_date');
      expect(r.deadline.kind).toBe('review_date');
      expect(r.deadline.basis).toMatch(/not a filing deadline or an expiry/i);
    }
    expect(reviews.find((r) => r.record_key === 'W02')?.deadline.date).toBe('2026-11-11');
  });

  it('includes commitments, task dues and explicit deadlines, sorted with awaiting dates last', () => {
    const { records, people, bundle } = demo();
    const taskLinks = bundle.task_links.map((l) => ({ ...l, household_id: 'demo-household', version: 1, created_at: '', updated_at: '' }));
    const out = collectDeadlines({ ...ctxOf(records, people), task_links: taskLinks });
    expect(out.some((d) => d.id === 'commitment:EC-STORAGE')).toBe(true);
    expect(out.find((d) => d.id === 'commitment:EC-GYM')?.kind).toBe('user_committed');
    expect(out.find((d) => d.id === 'commitment:EC-OLD-PASSPORT')?.kind).toBe('review_date');
    expect(out.find((d) => d.source === 'task' && d.label.startsWith('Order a spare'))?.state).toBe('met');
    expect(out.find((d) => d.id === 'record:W06')?.deadline.date).toBe('2026-11-11');
    const dated = out.filter((d) => d.deadline.date);
    const firstAwaiting = out.findIndex((d) => !d.deadline.date);
    expect(firstAwaiting).toBeGreaterThanOrEqual(dated.length);
    for (let i = 1; i < dated.length; i++) expect((dated[i - 1]?.deadline.date ?? '') <= (dated[i]?.deadline.date ?? '')).toBe(true);
  });

  it('a record deadline derived from a rule is represented once, by the rule, and linked to the record', () => {
    const { records, people } = demo();
    const out = collectDeadlines(ctxOf(records, people));
    expect(out.find((d) => d.id === 'record:W15')).toBeUndefined();
    expect(out.find((d) => d.id === 'rule:RULE-PET-NOTICE-PREP')?.linked_record_keys).toContain('W15');
  });

  it('marks a rule deadline met when its linked work is completed', () => {
    const { records, people } = demo();
    const r = patch(records, 'milestone:W24', (x) => { x.status = 'completed'; });
    const out = collectDeadlines(ctxOf(r, people));
    expect(out.find((d) => d.id === 'rule:RULE-AVERY-RELEASE')?.state).toBe('met');
  });
});

describe('defaultNewTaskDue', () => {
  it('is 14 calendar days after creation', () => {
    expect(defaultNewTaskDue('2026-10-29')).toBe('2026-11-12');
    expect(defaultNewTaskDue('2026-12-25')).toBe('2027-01-08');
    expect(defaultNewTaskDue('2028-02-20')).toBe('2028-03-05');
  });
});
