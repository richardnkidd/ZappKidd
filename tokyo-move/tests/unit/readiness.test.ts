import { describe, expect, it } from 'vitest';
import { dependencyChain, downstreamOf, householdReadiness, travelerReadiness } from '../../src/shared/readiness';
import type { TravelerGateConfig } from '../../src/shared/engine-contracts';
import type { BaseRecord, MilestoneData, WorkStatus } from '../../src/shared/types';
import { demoTravelerGates } from '../../fixtures/demo/bundle';
import { demo, patch, setAnchor } from './helpers';

const TODAY = '2026-10-29';

function gatesFor(personId: string): TravelerGateConfig {
  const g = demoTravelerGates().find((x) => x.person_id === personId);
  if (!g) throw new Error(personId);
  return g;
}

function complete(records: BaseRecord[], keys: string[]): BaseRecord[] {
  let out = records;
  for (const key of keys) out = patch(out, `milestone:${key}`, (r) => {
    r.status = 'completed';
    const d = r.data as unknown as MilestoneData;
    d.status_reason = null;
    // a shared row's per-traveler progress overrides the shared status, so complete it for everyone too
    for (const p of Object.values(d.traveler_progress ?? {})) p.status = 'completed';
  });
  return out;
}

function setStatus(records: BaseRecord[], key: string, status: WorkStatus, reason: string | null = null): BaseRecord[] {
  return patch(records, `milestone:${key}`, (r) => {
    r.status = status;
    (r.data as unknown as MilestoneData).status_reason = reason;
  });
}

function person(id: string) {
  const p = demo().people.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
}

describe('nonworking adult readiness needs no future-work items', () => {
  it('reaches ready_to_release with every required gate done and the optional work item untouched', () => {
    const { records } = demo();
    const gates = gatesFor('jun');
    // simulate the adult's own required gates being completed; W05 (optional future work) stays 'planned'
    const done = complete(records, gates.required_before_departure);
    expect(done.find((r) => r.id === 'milestone:W05')?.status).toBe('planned');
    const r = travelerReadiness(person('jun'), done, gates, TODAY);
    expect(r.state).toBe('ready_to_release');
    expect(r.blockers).toEqual([]);
    expect(r.open).toEqual([]);
    expect(r.met.map((g) => g.key).sort()).toEqual([...gates.required_before_departure].sort());
    expect(r.headline).not.toMatch(/%/);
    expect(r.conditional_unknown.map((g) => g.key)).toEqual(['W18']);
  });

  it('an optional future-work record listed as a gate never counts and emits no blocker', () => {
    const { records } = demo();
    const gates = { ...gatesFor('jun'), required_before_departure: [...gatesFor('jun').required_before_departure, 'W05'], explicitly_not_gates: [] };
    const blockedOptional = setStatus(complete(records, gatesFor('jun').required_before_departure), 'W05', 'blocked', 'Waiting on a future decision');
    const r = travelerReadiness(person('jun'), blockedOptional, gates, TODAY);
    expect(r.state).toBe('ready_to_release');
    expect([...r.blockers, ...r.open, ...r.met].map((g) => g.key)).not.toContain('W05');
  });

  it('a gate that depends on optional future work is not blocked by it', () => {
    const { records } = demo();
    const r = patch(complete(records, ['W01', 'W02', 'W06']), 'milestone:W03', (x) => {
      x.status = 'planned';
      (x.data as unknown as MilestoneData).dependencies = ['W05'];
      (x.data as unknown as MilestoneData).status_reason = null;
    });
    const out = travelerReadiness(person('jun'), r, gatesFor('jun'), TODAY);
    const w03 = [...out.open, ...out.blockers].find((g) => g.key === 'W03');
    expect(w03?.blocked_by).toEqual([]);
    expect(out.open.map((g) => g.key)).toContain('W03');
  });
});

describe('pet gates are independent of adults', () => {
  it("a pet gate does not appear in an adult's readiness unless it is in that adult's config", () => {
    const { records, people } = demo();
    const all = householdReadiness(people, records, demoTravelerGates(), TODAY);
    const avery = all.find((r) => r.person_id === 'avery')!;
    const mochi = all.find((r) => r.person_id === 'mochi')!;
    const keysOf = (r: typeof avery) => [...r.blockers, ...r.open, ...r.met, ...r.conditional_unknown, ...r.after_arrival].map((g) => g.key);
    for (const petKey of ['W12', 'W13', 'W14', 'W15', 'W16']) {
      expect(keysOf(avery)).not.toContain(petKey);
      expect(keysOf(mochi)).toContain(petKey);
    }
    // completing the pet's gates does not move the adults, and vice versa
    const petDone = complete(records, ['W12', 'W13', 'W14', 'W15', 'W16']);
    const after = householdReadiness(people, petDone, demoTravelerGates(), TODAY);
    expect(after.find((r) => r.person_id === 'mochi')?.state).toBe('ready_to_release');
    expect(after.find((r) => r.person_id === 'avery')).toEqual(avery);
    expect(after.find((r) => r.person_id === 'jun')).toEqual(all.find((r) => r.person_id === 'jun'));
    // listing a pet key in an adult's config is what makes it appear
    const custom = { ...gatesFor('avery'), required_before_departure: [...gatesFor('avery').required_before_departure, 'W13'], explicitly_not_gates: [] };
    expect(keysOf(travelerReadiness(person('avery'), records, custom, TODAY))).toContain('W13');
  });
});

describe('blockers and next action', () => {
  it('carry plain-language reasons from status_reason or from unmet dependency titles', () => {
    const { records, people } = demo();
    const jun = travelerReadiness(person('jun'), records, gatesFor('jun'), TODAY);
    const w03 = jun.blockers.find((g) => g.key === 'W03');
    expect(w03?.blocker).toBe("Waiting on Avery's residence route (W02) and the passport check (W06).");
    expect(w03?.blocked_by.sort()).toEqual(['W02', 'W06']);
    // planned work whose dependencies are unmet is blocked, with the dependency titles in the reason
    const w11 = jun.blockers.find((g) => g.key === 'W11');
    expect(w11?.blocker).toMatch(/^Waiting on: /);
    expect(w11?.blocker).toContain('Get a coordinated US-Japan tax review');
    expect(w11?.blocker).not.toMatch(/\bW\d\d\b/);
    expect(people.length).toBe(3);
  });

  it('picks the first open gate as the next action and never invents one', () => {
    const { records } = demo();
    const avery = travelerReadiness(person('avery'), records, gatesFor('avery'), TODAY);
    expect(avery.next_action).not.toBeNull();
    expect(avery.open[0]?.key).toBe(avery.next_action?.key);
    const none = travelerReadiness(person('avery'), complete(records, gatesFor('avery').required_before_departure), gatesFor('avery'), TODAY);
    expect(none.next_action).toBeNull();
  });

  it('reports blocked only when everything left is waiting', () => {
    const { records } = demo();
    const gates: TravelerGateConfig = { person_id: 'jun', required_before_departure: ['W03'], required_at_or_after_arrival: [], conditional: [], explicitly_not_gates: [] };
    const r = travelerReadiness(person('jun'), records, gates, TODAY);
    expect(r.state).toBe('blocked');
    expect(r.headline).toContain('all waiting');
    expect(r.headline).not.toMatch(/%/);
  });
});

describe('shared rows with per-traveler progress and scoped dependencies', () => {
  it("lets one adult reach ready_to_release while the other adult's route is still blocked", () => {
    const { records } = demo();
    // A shared "entry permissions" row: Avery's part is done; Jun's part depends on Jun's own route (W03).
    let r = patch(records, 'milestone:W07', (x) => {
      const d = x.data as unknown as MilestoneData;
      x.status = 'in_progress';
      d.dependencies = ['W02', 'W03'];
      d.dependency_scope = { W03: ['jun'] };
      d.traveler_progress = {
        avery: { status: 'completed', reason: null, evidence: [], updated_at: null, updated_by: null },
        jun: { status: 'planned', reason: null, evidence: [], updated_at: null, updated_by: null },
      };
    });
    r = complete(r, ['W02', 'W04', 'W06', 'W17']);
    const avery = travelerReadiness(person('avery'), r, gatesFor('avery'), TODAY);
    expect(avery.state).toBe('ready_to_release');
    expect(avery.met.map((g) => g.key)).toContain('W07');

    const jun = travelerReadiness(person('jun'), r, gatesFor('jun'), TODAY);
    expect(jun.state).not.toBe('ready_to_release');
    expect(jun.blockers.find((g) => g.key === 'W03')).toBeDefined(); // Jun's own route is still blocked
    const junW07 = [...jun.blockers, ...jun.open].find((g) => g.key === 'W07');
    expect(junW07?.blocked_by).toEqual(['W03']);
    expect(junW07?.blocker).toContain("Establish Jun's nonworking residence route");
  });

  it("skips a dependency whose scope excludes the traveler, and uses the dependency's own per-traveler progress", () => {
    const { records } = demo();
    let r = patch(records, 'milestone:W25', (x) => {
      const d = x.data as unknown as MilestoneData;
      d.dependencies = ['W03', 'W07'];
      d.dependency_scope = { W03: ['avery'] }; // does not apply to Jun
    });
    // W07's shared status is not done, but Jun's own progress on it is
    r = patch(r, 'milestone:W07', (x) => {
      (x.data as unknown as MilestoneData).traveler_progress = { jun: { status: 'completed', reason: null, evidence: [], updated_at: null, updated_by: null } };
    });
    const gates: TravelerGateConfig = { person_id: 'jun', required_before_departure: ['W25'], required_at_or_after_arrival: [], conditional: [], explicitly_not_gates: [] };
    const out = travelerReadiness(person('jun'), r, gates, TODAY);
    const w25 = [...out.open, ...out.blockers].find((g) => g.key === 'W25');
    expect(w25?.blocked_by).toEqual([]);
    expect(out.open.map((g) => g.key)).toContain('W25');
  });

  it('treats not_applicable as met only with a recorded reason', () => {
    const { records } = demo();
    const gates: TravelerGateConfig = { person_id: 'jun', required_before_departure: ['W21'], required_at_or_after_arrival: [], conditional: [], explicitly_not_gates: [] };
    expect(travelerReadiness(person('jun'), records, gates, TODAY).state).toBe('ready_to_release'); // demo W21 is n/a with a reason
    const noReason = setStatus(records, 'W21', 'not_applicable', null);
    expect(travelerReadiness(person('jun'), noReason, gates, TODAY).state).not.toBe('ready_to_release');
  });
});

describe('states', () => {
  it('moves through not_started, preparing, ready_to_release, released, arrived and settled without percentages', () => {
    const { records } = demo();
    const gates: TravelerGateConfig = { ...gatesFor('avery'), required_before_departure: ['W06', 'W17'], required_at_or_after_arrival: ['A01'], conditional: [], release_key: 'W24' };
    const avery = person('avery');
    const s0 = travelerReadiness(avery, setStatus(records, 'W06', 'planned'), gates, TODAY);
    expect(s0.state).toBe('not_started');
    const s1 = travelerReadiness(avery, records, gates, TODAY); // W06 is in progress
    expect(s1.state).toBe('preparing');
    const ready = complete(records, ['W06', 'W17']);
    expect(travelerReadiness(avery, ready, gates, TODAY).state).toBe('ready_to_release');
    const released = complete(ready, ['W24']);
    expect(travelerReadiness(avery, released, gates, TODAY).state).toBe('released');
    const arrivedRecords = setAnchor(released, 'TN', '2026-10-20', 'actual');
    expect(travelerReadiness(avery, arrivedRecords, gates, TODAY).state).toBe('arrived');
    const settled = patch(arrivedRecords, 'arrival:A01', (x) => { x.status = 'completed'; });
    expect(travelerReadiness(avery, settled, gates, TODAY).state).toBe('settled');
    for (const rr of [s0, s1]) expect(rr.headline).not.toMatch(/%|percent/i);
  });

  it('a traveler with no configured gates is not_started, not ready', () => {
    const { records, people } = demo();
    const out = householdReadiness(people, records, [], TODAY);
    expect(out.map((r) => r.state)).toEqual(['not_started', 'not_started', 'not_started']);
  });

  it('includes the traveler\'s own departure and arrival anchors', () => {
    const { records } = demo();
    const r = travelerReadiness(person('mochi'), records, gatesFor('mochi'), TODAY);
    expect(r.departure?.code).toBe('DP');
    expect(r.arrival?.code).toBe('TP');
  });
});

describe('dependencyChain and downstreamOf', () => {
  it('walks dependencies nearest first and marks met ones', () => {
    const { records } = demo();
    const chain = dependencyChain('W03', records);
    expect(chain.map((c) => [c.key, c.depth, c.met])).toEqual([
      ['W01', 1, true],
      ['W02', 1, false],
      ['W06', 1, false],
      ['W04', 2, false],
    ]);
    expect(chain.find((c) => c.key === 'W02')?.title).toBe("Establish Avery's residence route");
    expect(dependencyChain('W01', records)).toEqual([]);
    expect(dependencyChain('W999', records)).toEqual([]);
  });

  it('is cycle-safe', () => {
    const { records } = demo();
    const cyclic = patch(records, 'milestone:W01', (x) => { (x.data as unknown as MilestoneData).dependencies = ['W03']; });
    const keys = dependencyChain('W03', cyclic).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(downstreamOf('W03', cyclic)).not.toContain('W03');
  });

  it('lists downstream records transitively', () => {
    const { records } = demo();
    const down = downstreamOf('W02', records);
    expect(down).toContain('W03');
    expect(down).toContain('W24'); // depends on W02 directly
    expect(down).toContain('W25'); // via W03
    expect(down).not.toContain('W01');
  });
});
