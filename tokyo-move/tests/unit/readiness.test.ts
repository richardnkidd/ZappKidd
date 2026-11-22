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

/** Answer a conditional step for one traveler on the record itself (record.data.applies_to). */
function answer(records: BaseRecord[], key: string, personId: string, value: 'yes' | 'no' | 'unknown'): BaseRecord[] {
  return patch(records, `milestone:${key}`, (r) => {
    const d = r.data as unknown as MilestoneData;
    d.applies_to = { ...(d.applies_to ?? {}), [personId]: value };
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
    // an unanswered conditional step (applicability still unknown) keeps the traveler out of "ready"
    const unanswered = travelerReadiness(person('jun'), done, gates, TODAY);
    expect(unanswered.state).toBe('preparing');
    expect(unanswered.conditional_unknown.map((g) => g.key)).toEqual(['W18']);
    expect(unanswered.headline).toContain('1 step still needs a yes or no');
    expect(unanswered.next_action).toBeNull();
    // once it is answered "no", Jun is ready without any future-work item
    const r = travelerReadiness(person('jun'), answer(done, 'W18', 'jun', 'no'), gates, TODAY);
    expect(r.state).toBe('ready_to_release');
    expect(r.blockers).toEqual([]);
    expect(r.open).toEqual([]);
    expect(r.met.map((g) => g.key).sort()).toEqual([...gates.required_before_departure].sort());
    expect(r.headline).not.toMatch(/%/);
    expect(r.conditional_unknown).toEqual([]);
  });

  it('an optional future-work record listed as a gate never counts and emits no blocker', () => {
    const { records } = demo();
    const gates = { ...gatesFor('jun'), required_before_departure: [...gatesFor('jun').required_before_departure, 'W05'], explicitly_not_gates: [], conditional: [] };
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
    r = answer(complete(r, ['W02', 'W04', 'W06', 'W17']), 'W18', 'avery', 'no');
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

  it('a release record listed among the required steps is never counted as one, so readiness can be reached before release', () => {
    const { records } = demo();
    const gates: TravelerGateConfig = { ...gatesFor('avery'), required_before_departure: ['W06', 'W17', 'W24'], required_at_or_after_arrival: [], conditional: [], release_key: 'W24' };
    const ready = complete(records, ['W06', 'W17']);
    const r = travelerReadiness(person('avery'), ready, gates, TODAY);
    expect(r.state).toBe('ready_to_release');
    expect([...r.met, ...r.open, ...r.blockers].map((g) => g.key)).not.toContain('W24');
    expect(travelerReadiness(person('avery'), complete(ready, ['W24']), gates, TODAY).state).toBe('released');
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

describe('conditional steps and applicability', () => {
  const base = (): TravelerGateConfig => ({ person_id: 'jun', required_before_departure: ['W06'], required_at_or_after_arrival: [], conditional: [{ key: 'W18', condition: 'Only if a medicine needs a permit.', applies: 'unknown' }], explicitly_not_gates: [] });

  it("the record's own applies_to answer wins over the gate config", () => {
    const { records } = demo();
    const done = complete(records, ['W06']);
    // config unknown + record "yes" => required (must be completed before ready)
    const yes = travelerReadiness(person('jun'), answer(done, 'W18', 'jun', 'yes'), base(), TODAY);
    expect(yes.state).not.toBe('ready_to_release'); // W18 is now a required step and is not done (it waits on W17)
    expect([...yes.open, ...yes.blockers].map((g) => g.key)).toContain('W18');
    expect(yes.conditional_unknown).toEqual([]);
    expect(travelerReadiness(person('jun'), complete(answer(done, 'W18', 'jun', 'yes'), ['W18']), base(), TODAY).state).toBe('ready_to_release');
    // config "yes" + record "no" => not needed, listed with the reason
    const cfgYes: TravelerGateConfig = { ...base(), conditional: [{ key: 'W18', condition: 'Only if a medicine needs a permit.', applies: 'yes' }] };
    const no = travelerReadiness(person('jun'), answer(done, 'W18', 'jun', 'no'), cfgYes, TODAY);
    expect(no.state).toBe('ready_to_release');
    expect(no.not_needed).toEqual([{ record_id: 'milestone:W18', key: 'W18', title: 'Verify Tokyo clinician and pharmacy continuity', reason: 'Not needed for Jun. Only if a medicine needs a permit.' }]);
    // config "no" => not needed too; config "unknown" with no answer keeps the traveler out of ready
    expect(travelerReadiness(person('jun'), done, { ...base(), conditional: [{ key: 'W18', condition: null as never, applies: 'no' }] }, TODAY).not_needed?.[0]?.reason).toBe('Not needed for Jun.');
    const unknown = travelerReadiness(person('jun'), done, base(), TODAY);
    expect(unknown.state).toBe('preparing');
    expect(unknown.headline).toMatch(/1 step still needs a yes or no/);
    // an explicit "unknown" on the record falls back to unknown, and one traveler's answer never answers for another
    expect(travelerReadiness(person('jun'), answer(done, 'W18', 'jun', 'unknown'), cfgYes, TODAY).conditional_unknown.map((g) => g.key)).toEqual(['W18']);
    expect(travelerReadiness(person('jun'), answer(done, 'W18', 'avery', 'no'), base(), TODAY).state).toBe('preparing');
  });

  it('says how many steps still need a yes or no, in plain words', () => {
    const { records } = demo();
    const cfg: TravelerGateConfig = { ...base(), conditional: [{ key: 'W18', condition: 'a', applies: 'unknown' }, { key: 'W11', condition: 'b', applies: 'unknown' }, { key: 'W08', condition: 'c', applies: 'no' }] };
    const r = travelerReadiness(person('jun'), complete(records, ['W06']), cfg, TODAY);
    expect(r.state).toBe('preparing');
    expect(r.headline).toContain('2 steps still need a yes or no');
    expect(r.headline).not.toMatch(/%/);
    expect(r.not_needed?.map((n) => n.key)).toEqual(['W08']);
  });
});

describe('blocker reasons', () => {
  it('names the unmet dependency and why, when the waiting record says why', () => {
    const { records } = demo();
    const r = patch(records, 'milestone:W11', (x) => {
      (x.data as unknown as MilestoneData).dependency_reason = { W08: 'the tax adviser decides what can be moved' };
    });
    const out = travelerReadiness(person('jun'), r, gatesFor('jun'), TODAY);
    const w11 = out.blockers.find((g) => g.key === 'W11');
    expect(w11?.blocker).toContain('Get a coordinated US-Japan tax review — the tax adviser decides what can be moved');
    expect(w11?.blocker).toMatch(/^Waiting on: /);
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

  it("is one traveler's chain when a traveler is given or inferred: scoped dependencies of others are skipped, progress is theirs", () => {
    const { records } = demo();
    // W25 (Jun's release) depends on W03 and W07; W07 depends on W02 for Avery and W03 for Jun (scoped), and has per-traveler progress.
    const forJun = dependencyChain('W25', records, 'jun');
    expect(forJun.map((c) => c.key)).toEqual(['W03', 'W07', 'W01', 'W02', 'W06', 'W04']);
    const w07 = forJun.find((c) => c.key === 'W07')!;
    expect(w07.status).toBe('planned'); // Jun's own progress on the shared row, not the shared status
    expect(w07.met).toBe(false);
    // Avery's chain through the same shared row: Avery's part of W07 is completed, so the walk stops there
    const forAvery = dependencyChain('W24', records, 'avery');
    expect(forAvery.find((c) => c.key === 'W07')).toMatchObject({ met: true, status: 'completed' });
    expect(forAvery.map((c) => c.key)).not.toContain('W03'); // Jun's route is not Avery's dependency
    // without a traveler the chain is the shared one
    expect(dependencyChain('W07', records).map((c) => c.key)).toEqual(expect.arrayContaining(['W02', 'W03']));
    expect(dependencyChain('W07', records, 'avery').map((c) => c.key)).not.toContain('W03');
    // Jun's own route is a dependency of W07 for Jun; it reaches Avery's route only through Jun's own dependency on it
    expect(dependencyChain('W07', records, 'jun').map((c) => c.key)).toEqual(['W03', 'W06', 'W01', 'W02', 'W04']);
  });

  it("infers the traveler from a 'W64.<person>' style key", () => {
    let { records } = demo();
    const child = (key: string, deps: string[], scope?: Record<string, string[]>) =>
      patch(records, 'milestone:W25', (x) => {
        void x;
      }).concat([] as BaseRecord[]);
    void child;
    const base = records.find((r) => r.id === 'milestone:W25')!;
    const mk = (key: string, personId: string, deps: string[], scope: Record<string, string[]>): BaseRecord => ({
      ...structuredClone(base),
      id: `milestone:${key}`,
      key,
      title: `Release ${personId}`,
      status: 'planned',
      data: { ...structuredClone(base.data), dependencies: deps, dependency_scope: scope, traveler_scope: [personId] } as Record<string, unknown>,
    });
    records = [...records, mk('W64.avery', 'avery', ['W02', 'W03', 'W13'], { W02: ['avery'], W03: ['jun'], W13: ['mochi'] })];
    expect(dependencyChain('W64.avery', records).map((c) => c.key)).toEqual(['W02', 'W01', 'W04']);
    expect(dependencyChain('W64.avery', records, 'jun').map((c) => c.key)).toEqual(['W03', 'W01', 'W02', 'W06', 'W04']);
    // downstream honours the same scope
    records = [...records, mk('W65.jun', 'jun', ['W64.avery'], {})];
    expect(downstreamOf('W13', records, 'avery')).not.toContain('W64.avery'); // that dependency is the pet's
    expect(downstreamOf('W13', records, 'mochi')).toContain('W64.avery');
    expect(downstreamOf('W13', records)).toContain('W64.avery');
    expect(downstreamOf('W02', records, 'avery')).toContain('W64.avery');
    expect(downstreamOf('W64.avery', records)).toEqual(['W65.jun']);
  });

  it('includes the recorded reason on a chain entry and never walks through optional future work', () => {
    const { records } = demo();
    const r = patch(records, 'milestone:W03', (x) => {
      const d = x.data as unknown as MilestoneData;
      d.dependencies = ['W02', 'W05'];
      d.dependency_reason = { W02: 'the route decides which documents are needed' };
    });
    const chain = dependencyChain('W03', r);
    expect(chain.find((c) => c.key === 'W02')?.reason).toBe('the route decides which documents are needed');
    expect(chain.map((c) => c.key)).not.toContain('W05');
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
