import { describe, expect, it } from 'vitest';
import { collectDeadlines } from '../../src/shared/deadlines';
import type { BaseRecord, TaskLink } from '../../src/shared/types';

// Old dates from a dated, read-only copy (or old task dates kept for history) prove nothing about completion,
// so they must never be presented as overdue.

const base = {
  household_id: 'h', owner: null, owner_proposed: false, visibility: 'household' as const, created_by: 'import',
  source: null, version: 1, created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z', updated_by: null,
};

function link(over: Partial<TaskLink>): TaskLink {
  return {
    id: 'tl-1', household_id: 'h', adapter: 'snapshot', canonical_id: 'T1', record_id: null, title: 'Old task',
    status: 'open', due: '2026-08-15', due_basis: 'source', owner: null, notes: null, proposal_note: null,
    sync_state: 'snapshot', last_synced_at: null, last_error: null, remote_revision: null, version: 1,
    created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z', ...over,
  };
}

describe('historical dates are never overdue', () => {
  it('a past due date in a read-only task-list copy is historical, with a plain caution', () => {
    const [d] = collectDeadlines({ records: [], people: [], task_links: [link({})], today: '2026-10-29' });
    expect(d?.state).toBe('historical');
    expect(d?.deadline.basis).toMatch(/does not show whether the task was done/);
  });

  it('a past due date on a live (synced) task is still overdue', () => {
    const [d] = collectDeadlines({ records: [], people: [], task_links: [link({ sync_state: 'synced', adapter: 'fixture' })], today: '2026-10-29' });
    expect(d?.state).toBe('overdue');
  });

  it('a future date in the snapshot copy is unaffected', () => {
    const [d] = collectDeadlines({ records: [], people: [], task_links: [link({ due: '2026-11-20' })], today: '2026-10-29' });
    expect(d?.state).not.toBe('historical');
  });

  it('an existing commitment flagged historical is shown calmly', () => {
    const rec = {
      ...base, id: 'existing_commitment:EC-OLD', type: 'existing_commitment' as const, key: 'EC-OLD', title: 'Old task date',
      status: 'active',
      data: { recorded_date: '2026-08-15', meaning: 'Historical task date', deadline_kind: 'review_date', evidence_caution: '', linked_records: [], historical: true },
    } as unknown as BaseRecord;
    const d = collectDeadlines({ records: [rec], people: [], today: '2026-10-29' }).find((x) => x.source === 'commitment');
    expect(d?.state).toBe('historical');
  });
});

describe('pending task proposals are not deadlines', () => {
  it('a proposal waiting to be added never produces a deadline, even with a past date', () => {
    const out = collectDeadlines({
      records: [], people: [], today: '2026-10-29',
      task_links: [link({ adapter: 'snapshot', canonical_id: null, sync_state: 'pending_capture', due: '2026-10-20', due_basis: 'explicit' })],
    });
    expect(out).toHaveLength(0);
  });

  it('a failed capture (no id in the task list) is also not a deadline', () => {
    const out = collectDeadlines({
      records: [], people: [], today: '2026-10-29',
      task_links: [link({ adapter: 'fixture', canonical_id: null, sync_state: 'error', due: '2026-11-12', due_basis: 'default_14_days' })],
    });
    expect(out).toHaveLength(0);
  });
});
