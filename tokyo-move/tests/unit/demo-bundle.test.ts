import { describe, expect, it } from 'vitest';
import taskStore from '../../fixtures/demo/task-store.json';
import { buildDemoBundle, demoTaskStoreSeed } from '../../fixtures/demo/bundle';
import { applyBundle } from '../../src/import/apply';
import { openDb } from '../../src/server/db/db';
import type { CostData, DecisionData, FundingData, MilestoneData, QuestionData } from '../../src/shared/types';

const bundle = buildDemoBundle();
const of = (type: string) => bundle.records.filter((r) => r.type === type);

describe('demo bundle', () => {
  it('is deterministic and content-addressed', () => {
    const again = buildDemoBundle();
    expect(again.files).toEqual(bundle.files);
    expect(JSON.stringify(again.records)).toBe(JSON.stringify(bundle.records));
    expect(bundle.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.records.every((r) => r.source?.file_sha256 === bundle.files[0]?.sha256)).toBe(true);
  });

  it('uses the same ID schemes as the real plan and unique ids', () => {
    const ids = bundle.records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of bundle.records) expect(r.id).toBe(`${r.type}:${r.key}`);
    const keys = (t: string) => of(t).map((r) => r.key);
    expect(keys('milestone').every((k) => /^W\d{2}$/.test(k))).toBe(true);
    expect(keys('workstream').every((k) => /^S\d{2}$/.test(k))).toBe(true);
    expect(keys('question').every((k) => /^Q\d{3}$/.test(k))).toBe(true);
    expect(keys('decision').every((k) => /^D\d{2}$/.test(k))).toBe(true);
    expect(keys('risk').every((k) => /^R\d{2}$/.test(k))).toBe(true);
    expect(keys('document').every((k) => /^DOC\d{2}$/.test(k))).toBe(true);
    expect(keys('cost').every((k) => /^B\d{2}$/.test(k))).toBe(true);
    expect(keys('arrival').every((k) => /^A\d{2}$/.test(k))).toBe(true);
    expect(keys('horizon').every((k) => /^(Y|EX)\d{2}$/.test(k))).toBe(true);
    expect(keys('contact').every((k) => /^CT-[a-z0-9-]+$/.test(k))).toBe(true);
    expect(keys('deadline_rule').every((k) => /^RULE-[A-Z0-9-]+$/.test(k))).toBe(true);
    expect(keys('anchor').sort()).toEqual(['D', 'DN', 'DP', 'DR', 'EHN', 'EHR', 'EPN', 'EPR', 'RN', 'RR', 'T', 'TN', 'TP', 'TR']);
    expect(of('milestone').length).toBeGreaterThanOrEqual(25);
  });

  it('every internal reference resolves', () => {
    const all = new Set(bundle.records.map((r) => r.key));
    for (const r of of('milestone')) {
      const d = r.data as unknown as MilestoneData;
      for (const dep of d.dependencies) expect(all.has(dep), `${r.key} -> ${dep}`).toBe(true);
      for (const dep of Object.keys(d.dependency_scope ?? {})) expect(d.dependencies).toContain(dep);
      if (d.workstream_key) expect(all.has(d.workstream_key)).toBe(true);
      for (const t of d.linked_task_ids) expect(bundle.task_links.some((l) => l.id === t)).toBe(true);
    }
    for (const r of of('deadline_rule')) for (const k of (r.data as { linked_records: string[] }).linked_records) expect(all.has(k), `${r.key} -> ${k}`).toBe(true);
    for (const cfg of bundle.settings.traveler_gates ?? []) {
      for (const k of [...cfg.required_before_departure, ...cfg.required_at_or_after_arrival, ...cfg.conditional.map((c) => c.key), ...cfg.explicitly_not_gates.map((g) => g.key)]) expect(all.has(k), `${cfg.person_id} -> ${k}`).toBe(true);
    }
    for (const p of bundle.people) for (const code of Object.values(p.anchors)) if (code) expect(all.has(code)).toBe(true);
  });

  it('exercises the key invariants', () => {
    // milestone statuses cover every work status, with reasons where required
    const statuses = new Set(of('milestone').map((r) => r.status));
    for (const s of ['planned', 'in_progress', 'blocked', 'waiting_external', 'completed', 'eliminated', 'not_applicable']) expect(statuses.has(s), s).toBe(true);
    for (const r of of('milestone')) {
      const d = r.data as unknown as MilestoneData;
      if (['blocked', 'waiting_external', 'eliminated', 'not_applicable'].includes(r.status)) expect(d.status_reason, r.key).toBeTruthy();
      if (r.status === 'completed') expect(d.completion_evidence.length, r.key).toBeGreaterThan(0);
    }
    // owners include 'together', a proposed owner, and the shared row with per-traveler progress
    expect(of('milestone').some((r) => r.owner === 'together')).toBe(true);
    expect(of('milestone').some((r) => r.owner_proposed)).toBe(true);
    expect(of('milestone').some((r) => (r.data as unknown as MilestoneData).traveler_progress)).toBe(true);
    expect(of('milestone').some((r) => (r.data as unknown as MilestoneData).optional_future_work)).toBe(true);
    // questions in every disposition
    const dispositions = new Set(of('question').map((r) => (r.data as unknown as QuestionData).disposition));
    expect([...dispositions].sort()).toEqual(['already_answered', 'carry_forward', 'explicitly_excluded', 'not_applicable', 'question', 'waiting_blocked']);
    // decisions owned by both adults, one approved with both approvals and one partly approved
    const decisions = of('decision');
    expect(decisions.every((r) => r.owner === 'together')).toBe(true);
    const approved = decisions.filter((r) => r.status === 'approved');
    expect(approved.length).toBeGreaterThan(0);
    for (const r of approved) expect((r.data as unknown as DecisionData).approvals.map((a) => a.person_id).sort()).toEqual(['avery', 'jun']);
    expect(decisions.some((r) => r.status === 'proposed' && (r.data as unknown as DecisionData).approvals.length === 1)).toBe(true);
    // costs: both currencies, unknown amounts, an exclusion with a reason, a staged-overlap line with a phase
    const costs = of('cost').map((r) => r.data as unknown as CostData);
    const currencies = new Set(costs.flatMap((c) => [c.estimate, c.quote, c.committed, c.unpaid_balance]).filter(Boolean).map((m) => m!.currency));
    expect([...currencies].sort()).toEqual(['JPY', 'USD']);
    expect(costs.some((c) => c.applicability === 'review')).toBe(true);
    expect(costs.some((c) => c.applicability === 'include' && !c.estimate && !c.quote && !c.committed)).toBe(true);
    expect(costs.some((c) => c.applicability === 'exclude' && c.exclusion_reason)).toBe(true);
    expect(costs.some((c) => c.section === 'staged_overlap' && c.phase)).toBe(true);
    // money: FX unknown by default, planning-zero and unverified income
    const funding = of('funding').map((r) => r.data as unknown as FundingData);
    expect(funding.find((f) => f.kind === 'fx_rate')?.jpy_per_usd).toBeNull();
    expect(funding.filter((f) => f.kind === 'income').map((f) => f.income_status).sort()).toEqual(['planning_zero', 'unverified']);
    // contacts never imply a booking
    expect(of('contact').some((r) => (r.data as { relationship: string }).relationship === 'potential')).toBe(true);
    // the pet has its own anchors and dates
    const pet = bundle.people.find((p) => p.kind === 'pet')!;
    expect(pet.anchors).toEqual({ arrival: 'TP', departure: 'DP' });
  });

  it('the fixture task store matches the task links the bundle creates', () => {
    expect(demoTaskStoreSeed()).toEqual(taskStore);
    const ids = new Set((taskStore.tasks as { id: string }[]).map((t) => t.id));
    expect(bundle.task_links.map((l) => l.canonical_id).sort()).toEqual([...ids].sort());
    expect(bundle.task_links.every((l) => l.adapter === 'fixture')).toBe(true);
    expect(bundle.settings.task_adapter).toMatchObject({ name: 'fixture', can_write: true });
  });

  it('seeds an empty database and is a no-op the second time', () => {
    const db = openDb(':memory:');
    const first = applyBundle(db, bundle);
    expect(first.status).toBe('completed');
    expect(first.corrections).toBe(0);
    expect(first.created).toBe(bundle.records.length);
    expect(applyBundle(db, buildDemoBundle()).status).toBe('no_changes');
  });
});
