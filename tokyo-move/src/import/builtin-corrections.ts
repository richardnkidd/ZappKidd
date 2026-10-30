/**
 * Generic reviewed-model corrections (C-001 … C-004). They are ID-based and data-driven: each one inspects the bundle
 * and emits ops only for records that are actually present in the superseded state, so a plan without those records
 * (for example the fictional demo household) is left untouched and gets no receipts.
 *
 * Real-data-specific wording can replace a built-in by shipping a file in `private/corrections/` with the same id.
 */
import type { TravelerGateConfig } from '../shared/engine-contracts';
import type { DeadlineRuleData, ImportBundle, MilestoneData, QuestionData } from '../shared/types';
import type { Correction, CorrectionOp, NewRecordSpec } from './corrections';
import { clone } from './util';

type Bundle = ImportBundle;

function find(bundle: Bundle, id: string) {
  return bundle.records.find((r) => r.id === id);
}

function reviewedInstant(bundle: Bundle): string {
  const on = bundle.settings.plan_baseline?.reviewed_on ?? bundle.settings.plan_baseline?.baseline_on ?? '1970-01-01';
  return `${on}T00:00:00Z`;
}

function gates(bundle: Bundle): TravelerGateConfig[] | null {
  return Array.isArray(bundle.settings.traveler_gates) ? bundle.settings.traveler_gates : null;
}

/* ------------------------------------------------------------------ */
/* C-001: residence completion must not depend on optional future work */
/* ------------------------------------------------------------------ */

export const OPTIONAL_FUTURE_WORK_KEYS = ['W05', 'W58', 'W65', 'W67', 'W68', 'W69'] as const;

const C001: Correction = {
  id: 'C-001',
  title: 'Residence completion does not depend on optional future work',
  rationale:
    'Entry-permission and residence completion (W45) must stay independent of the optional later-work milestone (W65). The reference ties nonworking residence closure to future work, so it is removed; the rest of the wording is kept.',
  source: 'reviewed model',
  expand(bundle) {
    const rec = find(bundle, 'milestone:W45');
    if (!rec) return [];
    const data = rec.data as unknown as MilestoneData;
    const ops: CorrectionOp[] = [];
    if (data.dependencies?.includes('W65')) ops.push({ op: 'remove', record: rec.id, path: 'data.dependencies', value: 'W65' });
    for (const path of ['data.completion_criteria', 'data.contingency'] as const) {
      const text = rec.data[path.slice(5)];
      if (typeof text === 'string' && /\bW65\b/.test(text)) ops.push({ op: 'strip_clause', record: rec.id, path, pattern: '\\bW65\\b' });
    }
    return ops;
  },
};

/* ------------------------------------------------------------------ */
/* C-002: traveler-specific readiness review (W60) and release (W64)   */
/* ------------------------------------------------------------------ */

const PARENTS = [
  { key: 'W60', ruleStem: 'READINESS-REVIEW', offset: 14, direction: 'before' as const, label: 'readiness review', basis: (name: string) => `Internal checkpoint: 14 calendar days before ${name}'s own departure.` },
  { key: 'W64', ruleStem: 'FINAL-DEPARTURE-RELEASE', offset: 0, direction: 'after' as const, label: 'final departure release', basis: (name: string) => `Internal target: ${name}'s own departure date, after the final checks.` },
];

function ruleSuffix(personId: string): string {
  return personId.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
}

const C002: Correction = {
  id: 'C-002',
  title: 'Traveler-specific readiness review and release',
  rationale:
    "W60 and W64 stay household coordination rows (their household T/D dates are helpers only). Each traveler gets their own readiness review and release record, dated from that traveler's own departure date, so a later traveler's open item cannot hold back a ready one.",
  source: 'reviewed model',
  expand(bundle) {
    const ops: CorrectionOp[] = [];
    const travelers = bundle.people.filter((p) => p.anchors.departure);
    const parents = PARENTS.map((p) => ({ spec: p, rec: find(bundle, `milestone:${p.key}`) })).filter((x) => !!x.rec);
    if (parents.length === 0 || travelers.length === 0) return ops;

    for (const { spec, rec } of parents) {
      if (!rec) continue;
      const parentData = rec.data as unknown as MilestoneData;
      ops.push({ op: 'set', record: rec.id, path: 'data.traveler_scope', value: [] });
      ops.push({
        op: 'set',
        record: rec.id,
        path: 'data.review_note',
        value: `Household coordination row only. Each traveler's own ${spec.label} is tracked as ${spec.key}.<person> and dated from that traveler's departure date.`,
      });
      for (const person of travelers) {
        const depCode = person.anchors.departure;
        const anchorRec = find(bundle, `anchor:${depCode}`);
        const tz = ((anchorRec?.data as { timezone?: string } | undefined)?.timezone ?? 'Pacific/Honolulu') as DeadlineRuleData['timezone'];
        const childKey = `${spec.key}.${person.id}`;
        const ruleKey = `RULE-${spec.ruleStem}-${ruleSuffix(person.id)}`;
        const signed = spec.direction === 'before' ? -spec.offset : spec.offset;

        // A traveler's release depends on that traveler's own readiness review, not on the household row.
        const deps = (parentData.dependencies ?? [])
          .filter((d) => {
            const scope = parentData.dependency_scope?.[d];
            return !scope || scope.includes(person.id);
          })
          .map((d) => (d === 'W60' && spec.key === 'W64' ? `W60.${person.id}` : d));
        const childData: MilestoneData = {
          ...clone(parentData),
          traveler_scope: [person.id],
          parent_key: spec.key,
          status_reason: null,
          completion_evidence: [],
          dependencies: deps,
          dependency_scope: undefined,
          linked_task_ids: [],
          deadline: {
            date: null,
            kind: 'internal_target',
            basis: spec.basis(person.display_name),
            source_ids: [],
            jurisdiction: 'household',
            timezone: tz,
            verified_on: null,
            traveler: person.id,
            rule_id: ruleKey,
            anchor: depCode,
            offset: signed,
            unit: 'calendar_days',
          },
          review_note: `Created by C-002 from ${spec.key}: ${person.display_name}'s own ${spec.label}, dated from ${person.display_name}'s own departure date.`,
        };
        delete (childData as Partial<MilestoneData>).dependency_scope;
        const child: NewRecordSpec = {
          type: 'milestone',
          key: childKey,
          title: `${rec.title} — ${person.display_name}`,
          status: 'planned',
          owner: person.kind === 'adult' ? person.id : 'together',
          owner_proposed: true,
          visibility: 'household',
          created_by: 'import',
          data: childData as unknown as Record<string, unknown>,
          source: null,
        };
        ops.push({ op: 'create', record: child });

        const ruleData: DeadlineRuleData = {
          label: `${person.display_name} ${spec.label}`,
          traveler_scope: person.id,
          anchor: depCode,
          anchor_role: null,
          offset: spec.offset,
          unit: 'calendar_days',
          direction: spec.direction,
          kind: 'internal_target',
          jurisdiction: 'household',
          timezone: tz,
          source_ids: [],
          source_url: null,
          verified_on: null,
          verification: 'not_verified',
          applies: 'yes',
          applies_when: spec.basis(person.display_name),
          linked_records: [childKey],
          notes: `Added by correction C-002 (replaces the household-date version for ${spec.key}).`,
        };
        ops.push({
          op: 'create',
          record: { type: 'deadline_rule', key: ruleKey, title: ruleData.label, status: 'active', owner: null, owner_proposed: false, visibility: 'household', created_by: 'import', data: ruleData as unknown as Record<string, unknown>, source: null },
        });

        // The workbook's own per-person final-release rule is superseded by the record-linked one.
        if (spec.key === 'W64') {
          for (const r of bundle.records) {
            if (r.type !== 'deadline_rule' || r.key === ruleKey) continue;
            const d = r.data as unknown as DeadlineRuleData;
            if (d.traveler_scope === person.id && d.anchor === depCode && d.offset === 0 && d.unit === 'calendar_days' && /final departure release/i.test(d.label)) {
              ops.push({ op: 'set', record: r.id, path: 'status', value: 'superseded' });
              ops.push({ op: 'set', record: r.id, path: 'data.superseded_by', value: ruleKey });
            }
          }
        }
      }
    }

    // Provisional gates: add each traveler's own review to their required list and point release_key at their own release.
    const current = gates(bundle);
    if (current) {
      const next = clone(current);
      for (const cfg of next) {
        if (!travelers.some((t) => t.id === cfg.person_id)) continue;
        for (const { spec } of parents) {
          const key = `${spec.key}.${cfg.person_id}`;
          if (spec.key === 'W60' && !cfg.required_before_departure.includes(key)) cfg.required_before_departure.push(key);
          if (spec.key === 'W64' && !cfg.release_key) cfg.release_key = key;
        }
      }
      ops.push({ op: 'setting', key: 'traveler_gates', value: next });
    }
    return ops;
  },
};

/* ------------------------------------------------------------------ */
/* C-003: superseded 'local repository unavailable' state              */
/* ------------------------------------------------------------------ */

const C003: Correction = {
  id: 'C-003',
  title: 'Local evidence review replaces the "repository unavailable" state',
  rationale:
    "A bounded local evidence review was completed after the plan was written, so the earlier 'local repository unavailable' state is superseded. Commercial rights and demand remain unverified, and the review is not a comprehensive ownership, skill or commercial audit.",
  source: 'reviewed model',
  expand(bundle) {
    const ops: CorrectionOp[] = [];
    const w67 = find(bundle, 'milestone:W67');
    if (w67 && w67.status !== 'completed' && /unavailable/i.test(String((w67.data as unknown as MilestoneData).source_status ?? ''))) {
      ops.push({ op: 'set', record: w67.id, path: 'status', value: 'completed' });
      ops.push({ op: 'set', record: w67.id, path: 'data.status_reason', value: null });
      ops.push({
        op: 'set',
        record: w67.id,
        path: 'data.completion_evidence',
        value: [
          {
            at: reviewedInstant(bundle),
            by: 'import',
            summary: "A bounded local evidence review replaced the earlier 'local repository unavailable' state. Commercial rights, ownership beyond the reviewed examples, and demand remain unverified.",
            link: null,
          },
        ],
      });
    }
    const q = find(bundle, 'question:Q077');
    if (q) {
      const qd = q.data as unknown as QuestionData;
      if (/not mounted|unavailable|not available/i.test(qd.known ?? '') && (qd.disposition === 'waiting_blocked' || qd.disposition === 'question')) {
        ops.push({ op: 'set', record: q.id, path: 'data.disposition', value: 'carry_forward' });
      }
      if (/not mounted|unavailable|not available/i.test(qd.known ?? '') && !qd.local_note) {
        ops.push({ op: 'set', record: q.id, path: 'data.local_note', value: 'A bounded local evidence review was completed; ownership, depth beyond the reviewed examples, demand and commercial permissions remain unverified.' });
      }
    }
    return ops;
  },
};

/* ------------------------------------------------------------------ */
/* C-004: optional future work is never a move gate                    */
/* ------------------------------------------------------------------ */

const C004: Correction = {
  id: 'C-004',
  title: 'Optional future work is outside every traveler gate',
  rationale: 'Optional later-work milestones are not part of any traveler gate. They are flagged as optional future work and removed from every traveler gate list.',
  source: 'reviewed model',
  expand(bundle) {
    const ops: CorrectionOp[] = [];
    const present = OPTIONAL_FUTURE_WORK_KEYS.filter((k) => find(bundle, `milestone:${k}`));
    for (const key of present) {
      const rec = find(bundle, `milestone:${key}`);
      if (!rec) continue;
      const d = rec.data as unknown as MilestoneData;
      if (d.optional_future_work !== true) ops.push({ op: 'set', record: rec.id, path: 'data.optional_future_work', value: true });
      if ((d.traveler_scope ?? []).length > 0) ops.push({ op: 'set', record: rec.id, path: 'data.traveler_scope', value: [] });
    }
    const current = gates(bundle);
    if (current && present.length > 0) {
      const next = clone(current);
      let changed = false;
      for (const cfg of next) {
        for (const key of present) {
          for (const list of ['required_before_departure', 'required_at_or_after_arrival'] as const) {
            const i = cfg[list].indexOf(key);
            if (i >= 0) {
              cfg[list].splice(i, 1);
              changed = true;
            }
          }
          const ci = cfg.conditional.findIndex((c) => c.key === key);
          if (ci >= 0) {
            cfg.conditional.splice(ci, 1);
            changed = true;
          }
          if (!cfg.explicitly_not_gates.some((g) => g.key === key)) {
            cfg.explicitly_not_gates.push({ key, reason: 'Optional future work; never a move gate.' });
            changed = true;
          }
        }
      }
      if (changed) ops.push({ op: 'setting', key: 'traveler_gates', value: next });
    }
    return ops;
  },
};

export const BUILTIN_CORRECTIONS: Correction[] = [C001, C002, C003, C004];
