import { describe, expect, it } from 'vitest';
import { anchorsFrom, collectDeadlines, computeRuleDeadlines, defaultNewTaskDue, previewAnchorChange } from '../../src/shared/deadlines';
import type { DeadlineRuleData, MilestoneData } from '../../src/shared/types';
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

/* ------------------------------------------------------------------ */
/* bounds, business-day advice and holiday calendars                   */
/* ------------------------------------------------------------------ */

import { businessDayAdvice, travelerDeadlines } from '../../src/shared/deadlines';
import { holidaysFor } from '../../src/shared/holidays';

describe('businessDayAdvice', () => {
  it("'by' on a weekend advises the prior business day", () => {
    expect(businessDayAdvice('2026-10-31', 'by')).toBe('Falls on a Saturday — aim for Fri, Oct 30.'); // Saturday
    expect(businessDayAdvice('2026-11-01', 'by')).toBe('Falls on a Sunday — aim for Fri, Oct 30.');
    expect(businessDayAdvice('2026-10-31', undefined)).toBe('Falls on a Saturday — aim for Fri, Oct 30.'); // default bound is 'by'
  });

  it("'not_before' on a weekend advises the FOLLOWING business day, never an earlier one", () => {
    const sat = businessDayAdvice('2026-10-31', 'not_before');
    expect(sat).toBe('The window opens on a Saturday; the first business day inside it is Mon, Nov 2.');
    expect(sat).not.toMatch(/Fri|Oct 30/);
    expect(businessDayAdvice('2026-11-01', 'not_before')).toBe('The window opens on a Sunday; the first business day inside it is Mon, Nov 2.');
  });

  it('is silent on a business day and for bounds where the day itself is the point', () => {
    expect(businessDayAdvice('2026-10-30', 'by')).toBeNull();
    expect(businessDayAdvice('2026-10-30', 'not_before')).toBeNull();
    for (const b of ['on', 'continuous_since', 'recurring'] as const) expect(businessDayAdvice('2026-10-31', b)).toBeNull();
    expect(businessDayAdvice('not a date', 'by')).toBeNull();
  });

  it('knows public holidays when a calendar is supplied, and names them', () => {
    const jp = holidaysFor('JP');
    const name = (d: string) => (d === '2027-05-03' ? 'Constitution Memorial Day' : d === '2027-02-11' ? 'National Foundation Day' : null);
    expect(businessDayAdvice('2027-02-11', 'by', jp, name)).toBe('Falls on a public holiday (National Foundation Day) — aim for Wed, Feb 10.');
    // Golden Week: May 3–5 are holidays, so a window opening on May 3 first has a business day on Thursday May 6
    expect(businessDayAdvice('2027-05-03', 'not_before', jp, name)).toBe('The window opens on a public holiday (Constitution Memorial Day); the first business day inside it is Thu, May 6.');
    // a substitute holiday on a Monday after a Sunday holiday
    expect(businessDayAdvice('2027-03-22', 'by', jp)).toBe('Falls on a public holiday — aim for Fri, Mar 19.');
    expect(businessDayAdvice('2027-03-22', 'by')).toBeNull(); // without a calendar a Monday is just a Monday
  });
});

describe('bounds on computed deadlines', () => {
  function withExamWindow(dp: string, bound: DeadlineRuleData['bound'], extra: Partial<DeadlineRuleData> = {}) {
    let { records } = demo();
    const { people } = demo();
    records = setAnchor(records, 'DP', dp);
    records = patch(records, 'deadline_rule:RULE-PET-EXAM-WINDOW', (r) => {
      const d = r.data as unknown as DeadlineRuleData;
      d.bound = bound;
      Object.assign(d, extra);
    });
    const found = collectDeadlines({ records, people, today: TODAY }).find((d) => d.id === 'rule:RULE-PET-EXAM-WINDOW')!;
    return found;
  }

  it('carries the bound of every deadline (default "by") and the demo exam window is not_before', () => {
    const { records, people } = demo();
    const all = collectDeadlines({ records, people, today: TODAY });
    expect(all.every((d) => d.bound !== undefined)).toBe(true);
    expect(all.find((d) => d.id === 'rule:RULE-PET-EXAM-WINDOW')?.bound).toBe('not_before');
    expect(all.find((d) => d.id === 'rule:RULE-PET-NOTICE-MIN')?.bound).toBe('by');
    expect(all.filter((d) => d.source === 'review').every((d) => d.bound === 'on')).toBe(true);
  });

  it("a not_before window that opens on a Saturday advises the following Monday (never the Friday before)", () => {
    // DP 2027-10-12 − 10 days = Saturday 2027-10-02
    const d = withExamWindow('2027-10-12', 'not_before');
    expect(d.deadline.date).toBe('2027-10-02');
    expect(weekdayName(d.deadline.date!)).toBe('Saturday');
    expect(d.business_day_advice).toBe('The window opens on a Saturday; the first business day inside it is Mon, Oct 4.');
    expect(d.business_day_advice).not.toMatch(/Fri|Oct 1\b/);
  });

  it('skips a public holiday on the way to the first business day (US Labor Day, Monday 2027-09-06)', () => {
    const d = withExamWindow('2027-09-14', 'not_before'); // window opens Saturday 2027-09-04 (a US-HI rule)
    expect(d.deadline.date).toBe('2027-09-04');
    expect(d.business_day_advice).toBe('The window opens on a Saturday; the first business day inside it is Tue, Sep 7.');
  });

  it("a 'by' deadline on a Saturday advises the Friday before", () => {
    const d = withExamWindow('2027-10-12', 'by');
    expect(d.business_day_advice).toBe('Falls on a Saturday — aim for Fri, Oct 1.');
  });

  it("'on', 'continuous_since' and 'recurring' dates carry their bound but no advice", () => {
    for (const b of ['on', 'continuous_since', 'recurring'] as const) {
      const d = withExamWindow('2027-09-14', b);
      expect(d.bound).toBe(b);
      expect(d.business_day_advice).toBeNull();
    }
  });

  it('only dates with an external obligation get advice (not internal targets or estimates)', () => {
    expect(withExamWindow('2027-09-14', 'by', { kind: 'internal_target' }).business_day_advice).toBeNull();
    expect(withExamWindow('2027-09-14', 'by', { kind: 'estimate' }).business_day_advice).toBeNull();
    expect(withExamWindow('2027-09-14', 'by', { kind: 'contractual' }).business_day_advice).not.toBeNull();
    expect(withExamWindow('2027-09-14', 'by', { applies: 'no' }).business_day_advice).toBeNull();
  });

  it('uses the Japanese calendar for Japanese rules and the US calendar for US rules, and says the calendar is computed', () => {
    // 2027-09-23 is Autumnal Equinox Day (Thursday). A JP rule lands on it: DP + 0 → set DP to 2027-09-23.
    const jp = withExamWindow('2027-09-23', 'by', { offset: 0, jurisdiction: 'JP', timezone: 'Asia/Tokyo' });
    expect(jp.deadline.date).toBe('2027-09-23');
    expect(jp.business_day_advice).toBe('Falls on a public holiday (Autumnal Equinox Day) — aim for Wed, Sep 22. (The holiday calendar is computed; verify against the official calendar.)');
    // the same date is an ordinary day for a US rule
    const us = withExamWindow('2027-09-23', 'by', { offset: 0, jurisdiction: 'US-HI', timezone: 'Pacific/Honolulu' });
    expect(us.business_day_advice).toBeNull();
    // 2027-07-05 is the observed Independence Day for US rules but an ordinary Monday in Japan
    const usJuly = withExamWindow('2027-07-05', 'by', { offset: 0, jurisdiction: 'US-HI', timezone: 'Pacific/Honolulu' });
    expect(usJuly.business_day_advice).toContain('public holiday (Independence Day (observed))');
    expect(withExamWindow('2027-07-05', 'by', { offset: 0, jurisdiction: 'JP', timezone: 'Asia/Tokyo' }).business_day_advice).toBeNull();
    // a rule whose jurisdiction is not a country (household/contract) falls back to the calendar of its zone
    expect(withExamWindow('2027-07-05', 'by', { offset: 0, jurisdiction: 'household', timezone: 'Pacific/Honolulu' }).business_day_advice).toContain('public holiday');
  });

  it('business-day rules use the computed holiday calendar and stay labelled approximate; a supplied list is used as given', () => {
    const { records, people } = demo();
    // Mochi arrives Fri 2027-09-24; one business day before is Thu Sep 23, which is a holiday in Japan, so it is Wed Sep 22.
    const r = patch(setAnchor(records, 'TP', '2027-09-24'), 'deadline_rule:RULE-PET-NOTICE-MIN', (x) => {
      const d = x.data as unknown as DeadlineRuleData;
      d.unit = 'business_days';
      d.offset = 1;
    });
    const computed = collectDeadlines({ records: r, people, today: TODAY }).find((d) => d.id === 'rule:RULE-PET-NOTICE-MIN')!;
    expect(computed.deadline.date).toBe('2027-09-22');
    expect(computed.approximate).toBe(true);
    const supplied = collectDeadlines({ records: r, people, today: TODAY, jp_holidays: ['2027-09-21'] }).find((d) => d.id === 'rule:RULE-PET-NOTICE-MIN')!;
    expect(supplied.deadline.date).toBe('2027-09-23');
    expect(supplied.approximate).toBe(false);
  });
});

function weekdayName(date: string): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${date}T12:00:00Z`).getUTCDay()]!;
}

describe('commitments and tasks carry bounds and advice', () => {
  it('an existing user-committed deadline on a weekend says which business day to aim for', () => {
    const { records, people } = demo();
    const r = patch(records, 'existing_commitment:EC-GYM', (x) => {
      (x.data as { recorded_date: string }).recorded_date = '2026-10-31'; // a Saturday
    });
    const d = collectDeadlines({ records: r, people, today: TODAY }).find((x) => x.id === 'commitment:EC-GYM')!;
    expect(d.bound).toBe('by');
    expect(d.business_day_advice).toBe('Falls on a Saturday — aim for Fri, Oct 30.');
    const history = collectDeadlines({ records: r, people, today: TODAY }).find((x) => x.id === 'commitment:EC-OLD-PASSPORT')!;
    expect(history.bound).toBe('on');
    expect(history.business_day_advice).toBeNull();
  });
});

describe('superseded rules', () => {
  const ruleRec = (key: string, patchData: Partial<DeadlineRuleData>, status = 'active') => {
    const base = demo().records.find((r) => r.id === 'deadline_rule:RULE-PET-NOTICE-PREP')!;
    return { ...structuredClone(base), id: `deadline_rule:${key}`, key, title: key, status, data: { ...structuredClone(base.data), label: key, linked_records: [], ...patchData } } as BaseRecord;
  };

  it("a record pointing at a superseded rule gets the active replacement's date, kind, verification and verified_on", () => {
    let { records } = demo();
    const { people } = demo();
    records = [
      ...records,
      ruleRec('RULE-OLD', { offset: 60, kind: 'internal_target', verification: 'not_verified', verified_on: null, superseded_by: 'RULE-MID', linked_records: ['W15'] }, 'superseded'),
      ruleRec('RULE-MID', { superseded_by: 'RULE-NEW', offset: 50 }, 'superseded'),
      ruleRec('RULE-NEW', { offset: 45, kind: 'legal', verification: 'verified_official', verified_on: '2026-10-20' }),
    ];
    records = patch(records, 'milestone:W15', (x) => {
      (x.data as unknown as MilestoneData).deadline!.rule_id = 'RULE-OLD';
    });
    const all = collectDeadlines({ records, people, today: TODAY });
    expect(all.find((d) => d.id === 'rule:RULE-OLD')).toBeUndefined();
    expect(all.find((d) => d.id === 'rule:RULE-MID')).toBeUndefined();
    expect(all.find((d) => d.id === 'record:W15')).toBeUndefined(); // represented by the active rule
    const replacement = all.find((d) => d.id === 'rule:RULE-NEW')!;
    expect(replacement.deadline.date).toBe('2027-07-31'); // TP 2027-09-14 − 45
    expect(replacement.kind).toBe('legal');
    expect(replacement.verification).toBe('verified_official');
    expect(replacement.deadline.verified_on).toBe('2026-10-20');
    expect(replacement.linked_record_keys).toContain('W15');
    expect(replacement.superseded_rule_ids).toEqual(['RULE-OLD', 'RULE-MID']);
  });

  it("a superseded rule's linked records move to its successor even if no record points at the old key", () => {
    let { records } = demo();
    const { people } = demo();
    records = [...records, ruleRec('RULE-OLD2', { superseded_by: 'RULE-NEW2', linked_records: ['W16'] }, 'superseded'), ruleRec('RULE-NEW2', { offset: 30, linked_records: ['W15'] })];
    const replacement = collectDeadlines({ records, people, today: TODAY }).find((d) => d.id === 'rule:RULE-NEW2')!;
    expect(replacement.linked_record_keys?.sort()).toEqual(['W15', 'W16']);
  });

  it('is cycle-safe and falls back to the record\'s own date when nothing active remains', () => {
    let { records } = demo();
    const { people } = demo();
    records = [...records, ruleRec('RULE-A', { superseded_by: 'RULE-B' }, 'superseded'), ruleRec('RULE-B', { superseded_by: 'RULE-A' }, 'superseded')];
    records = patch(records, 'milestone:W15', (x) => {
      (x.data as unknown as MilestoneData).deadline!.rule_id = 'RULE-A';
    });
    const all = collectDeadlines({ records, people, today: TODAY });
    expect(all.find((d) => d.id === 'record:W15')?.deadline.date).toBe('2027-07-16'); // its own TP − 60
    expect(all.find((d) => d.rule_id === 'RULE-A' && d.source === 'rule')).toBeUndefined();
  });

  it('computeRuleDeadlines ignores superseded, inactive and superseded_by rules', () => {
    const { records, people } = demo();
    const rules = [ruleRec('R1', {}, 'superseded'), ruleRec('R2', {}, 'inactive'), ruleRec('R3', { superseded_by: 'R4' }), ruleRec('R4', {})] as unknown as Parameters<typeof computeRuleDeadlines>[0];
    expect(computeRuleDeadlines(rules, anchorsFrom(records), people, TODAY).map((d) => d.rule_id)).toEqual(['R4']);
  });
});

describe('travelerDeadlines', () => {
  it("returns a traveler's own active rule dates split into before leaving and after arrival", () => {
    let { records } = demo();
    const { people } = demo();
    records = setAnchor(records, 'RR', '2027-10-20');
    const mochi = travelerDeadlines('mochi', { records, people, today: TODAY });
    expect(mochi.before_departure.map((d) => d.rule_id).sort()).toEqual(['RULE-PET-EXAM-WINDOW', 'RULE-PET-NOTICE-MIN', 'RULE-PET-NOTICE-PREP']);
    expect(mochi.after_arrival.map((d) => d.rule_id)).toEqual(['RULE-PET-LOCAL-REGISTRATION']);
    expect(mochi.before_departure.every((d) => d.traveler === 'mochi')).toBe(true);
    // dated first (ascending), awaiting last
    const dates = mochi.before_departure.map((d) => d.deadline.date);
    expect(dates).toEqual([...dates].sort());

    const jun = travelerDeadlines('jun', { records, people, today: TODAY });
    expect(jun.before_departure.map((d) => d.rule_id)).toEqual(['RULE-JUN-RELEASE']); // departure release, awaiting Jun's date
    expect(jun.after_arrival.map((d) => d.rule_id).sort()).toEqual(['RULE-BAGGAGE-OUTER', 'RULE-HEALTH-NOTICE', 'RULE-RESIDENCE-NOTICE']);
    expect(jun.after_arrival.find((d) => d.rule_id === 'RULE-RESIDENCE-NOTICE')?.deadline.date).toBe('2027-11-03');
    // household rules and other travelers' rules never appear
    const ids = [...jun.before_departure, ...jun.after_arrival].map((d) => d.id);
    expect(ids.some((id) => id.includes('READINESS-REVIEW') || id.includes('AVERY') || id.includes(':avery'))).toBe(false);
  });

  it('leaves out rules that do not apply or are superseded, and unknown travelers get nothing', () => {
    let { records } = demo();
    const { people } = demo();
    records = patch(records, 'deadline_rule:RULE-PET-NOTICE-MIN', (x) => { (x.data as unknown as DeadlineRuleData).applies = 'no'; });
    records = patch(records, 'deadline_rule:RULE-PET-NOTICE-PREP', (x) => { x.status = 'superseded'; });
    const mochi = travelerDeadlines('mochi', { records, people, today: TODAY });
    expect(mochi.before_departure.map((d) => d.rule_id)).toEqual(['RULE-PET-EXAM-WINDOW']);
    expect(travelerDeadlines('nobody', { records, people, today: TODAY })).toEqual({ before_departure: [], after_arrival: [] });
  });

  it('classifies by the anchor the rule is dated from', () => {
    let { records } = demo();
    const { people } = demo();
    const add = (key: string, d: Partial<DeadlineRuleData>) => {
      const base = records.find((r) => r.id === 'deadline_rule:RULE-PET-NOTICE-PREP')!;
      records = [...records, { ...structuredClone(base), id: `deadline_rule:${key}`, key, title: key, data: { ...structuredClone(base.data), label: key, linked_records: [], traveler_scope: 'mochi', ...d } } as BaseRecord];
    };
    add('RULE-T-BEFORE', { anchor: 'TP', direction: 'before', offset: 5 });
    add('RULE-T-AFTER', { anchor: 'TP', direction: 'after', offset: 5 });
    add('RULE-D-AFTER', { anchor: 'DP', direction: 'after', offset: 3 });
    add('RULE-EVENT-BEFORE', { anchor: 'other', direction: 'before', offset: 14 });
    add('RULE-EVENT-AFTER', { anchor: 'other', direction: 'after', offset: 30 });
    const out = travelerDeadlines('mochi', { records, people, today: TODAY });
    const before = out.before_departure.map((d) => d.rule_id);
    const after = out.after_arrival.map((d) => d.rule_id);
    expect(before).toEqual(expect.arrayContaining(['RULE-T-BEFORE', 'RULE-EVENT-BEFORE']));
    expect(after).toEqual(expect.arrayContaining(['RULE-T-AFTER', 'RULE-D-AFTER', 'RULE-EVENT-AFTER']));
    expect(before).not.toContain('RULE-T-AFTER');
  });
});
