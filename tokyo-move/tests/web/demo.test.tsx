/** Runs the screens' selection logic and the shared engines over the fictional demo household. */
import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '../../fixtures/demo/bundle';
import { collectDeadlines } from '../../src/shared/deadlines';
import { householdReadiness } from '../../src/shared/readiness';
import type { BaseRecord, Person, TaskLink } from '../../src/shared/types';
import { currentPhase, selectBlocked, selectComingUp, selectDecisions, selectNow, type FilterContext } from '../../src/web/lib/home';
import { buildPlanItems, DEFAULT_FILTERS, filterPlanItems, groupByStatus } from '../../src/web/lib/plan';
import { buildDirectory, buildIndexes } from '../../src/web/lib/records';

const bundle = buildDemoBundle();
const NOW = '2026-10-29T12:00:00Z';
const people: Person[] = bundle.people.map((p) => ({ ...p, household_id: 'demo' }));
const records = bundle.records.map((r) => ({ ...r, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW, updated_by: null })) as BaseRecord[];
const taskLinks = bundle.task_links.map((t) => ({ ...t, household_id: 'demo', version: 1, created_at: NOW, updated_at: NOW })) as TaskLink[];
const idx = buildIndexes(records, taskLinks);
const adults = people.filter((p) => p.kind === 'adult');
const dir = buildDirectory(people, adults[0]!.id);
const ctx: FilterContext = { meId: adults[0]!.id, otherIds: [adults[1]!.id] };
const TODAY = '2026-10-29';

describe('Home over the demo household', () => {
  const deadlines = collectDeadlines({ records, people, task_links: taskLinks, today: TODAY });
  const byRecord = new Map<string, typeof deadlines>();
  for (const d of deadlines) if (d.record_id) byRecord.set(d.record_id, [...(byRecord.get(d.record_id) ?? []), d]);

  it('shows a short, meaningful Now list', () => {
    const items = selectNow(idx, { today: TODAY, filter: 'all', ctx, deadlinesByRecord: byRecord });
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
    for (const it of items) {
      if (it.kind !== 'milestone') continue;
      const m = idx.milestoneByKey.get(it.recordId!.split(':')[1]!)!;
      expect(['planned', 'in_progress']).toContain(m.status);
      expect(m.data.optional_future_work).toBe(false);
    }
    expect(currentPhase(idx)).not.toBeNull();
  });

  it('never lists optional future work as blocked or as a decision gate', () => {
    for (const b of selectBlocked(idx, 'all', ctx)) expect(b.record.data.optional_future_work).toBe(false);
    expect(selectDecisions(idx, 'all', ctx).every((d) => d.status === 'open' || d.status === 'proposed')).toBe(true);
  });

  it('builds Coming up without throwing, with review checkpoints collapsed and awaiting dates separate', () => {
    const out = selectComingUp(deadlines, idx, dir, { today: TODAY, filter: 'all', ctx });
    const rows = out.groups.flatMap((g) => g.rows);
    for (const r of rows) {
      if (r.kind === 'review_summary') expect(r.reviews!.length).toBeGreaterThanOrEqual(2);
      else expect(r.deadline!.deadline.date).not.toBeNull();
    }
    for (const a of out.awaiting) expect(a.deadline.date).toBeNull();
    // the same review date never appears twice as separate review rows once it is collapsed
    const reviewDates = rows.filter((r) => r.kind === 'deadline' && r.deadline!.kind === 'review_date').map((r) => r.date);
    const summaryDates = rows.filter((r) => r.kind === 'review_summary').map((r) => r.date);
    for (const d of reviewDates) expect(summaryDates).not.toContain(d);
  });

  it('gives each traveler (two adults and the dog) a readiness card with no percentages', () => {
    const cards = householdReadiness(people, records, bundle.settings.traveler_gates ?? [], TODAY);
    expect(cards.map((c) => c.person_id).sort()).toEqual(people.map((p) => p.id).sort());
    for (const c of cards) {
      expect(c.headline).not.toMatch(/\d+\s?%/);
      expect(c.headline.length).toBeGreaterThan(0);
    }
  });
});

describe('Plan over the demo household', () => {
  const items = buildPlanItems(idx);
  it('hides optional future work by default but keeps everything else', () => {
    const hidden = filterPlanItems(items, DEFAULT_FILTERS, ctx);
    const all = filterPlanItems(items, { ...DEFAULT_FILTERS, hideOptional: false }, ctx);
    expect(all.length).toBe(items.length);
    expect(hidden.every((i) => !i.m.data.optional_future_work)).toBe(true);
    expect(hidden.length).toBeLessThanOrEqual(all.length);
  });
  it('places every milestone on exactly one board column', () => {
    const cols = groupByStatus(items);
    const total = [...cols.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(items.length);
  });
});
