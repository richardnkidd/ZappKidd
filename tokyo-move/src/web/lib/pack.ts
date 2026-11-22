/**
 * Arrival pack content: what to print for one traveler. Pure functions over the same records the screens use.
 * A short pack: the arrival day, the first week, the first 30 days, the documents this traveler carries and any contact
 * who can actually be reached. Sensitivity comes from an explicit field on the record (`sensitivity`), never from
 * guessing at words; sensitive items are returned separately so they print only when a person ticks that section.
 */
import { diffDays, isCivilDate } from '@shared/dates';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { ARRIVAL_WINDOW_LABEL, DEADLINE_KIND_LABEL, VERIFICATION_LABEL } from '@shared/labels';
import type { ArrivalData, ContactData, DeadlineRuleData, DocumentData, Sensitivity as DataSensitivity } from '@shared/types';
import { civil, safeHref } from './format';
import { splitTitleAction } from './prose';
import { dataOf, type AnyRecord, type Directory, type Indexes } from './records';

export type Sensitivity = NonNullable<DataSensitivity>;
export const SENSITIVITY_ORDER: Sensitivity[] = ['medical', 'financial', 'identity'];

/** The record's own sensitivity mark. Nothing is inferred from its wording. */
export function sensitivityOf(record: AnyRecord | null | undefined): Sensitivity | null {
  const s = (record?.data as { sensitivity?: unknown } | undefined)?.sensitivity;
  return s === 'medical' || s === 'financial' || s === 'identity' ? s : null;
}

export interface PackItem {
  id: string;
  title: string;
  /** What to do, said once. */
  detail?: string | null;
  /** Practical checks from the record's review note. */
  check?: string | null;
  meta?: string[];
  link?: string | null;
}

export interface PackSection {
  key: string;
  title: string;
  empty: string;
  items: PackItem[];
}

export interface Pack {
  personId: string;
  sections: PackSection[];
  sensitive: Record<Sensitivity, PackItem[]>;
}

/** "Practical checks from the X review: …" -> the checks themselves (the section already says "Check"). */
const checkText = (t: string | null | undefined): string | null => {
  const x = (t ?? '').replace(/^\s*practical checks(?:\s+from\s+[^:]{1,60})?\s*:\s*/i, '').trim();
  return x || null;
};

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().replace(/[.\s]+$/, '').toLowerCase() === (b ?? '').trim().replace(/[.\s]+$/, '').toLowerCase();

function verificationLine(d: ComputedDeadline, idx: Indexes): string | null {
  const rule = d.rule_id ? (idx.byKey.get(d.rule_id) ?? null) : null;
  const v = rule ? (dataOf<DeadlineRuleData>(rule).verification ?? 'not_verified') : d.kind === 'legal' && !d.deadline.verified_on ? 'not_verified' : null;
  return v && v !== 'verified_official' ? VERIFICATION_LABEL[v] : null;
}

/** Contact details a household may have saved. The plan's contact records have no such fields yet, so this is usually empty. */
function reachableVia(c: Partial<ContactData>): string | null {
  const o = c as unknown as Record<string, unknown>;
  const parts = [o.phone, o.email].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return parts.length ? parts.join(' · ') : null;
}

export function buildPack(idx: Indexes, dir: Directory, deadlines: ComputedDeadline[], personId: string): Pack {
  const sensitive: Record<Sensitivity, PackItem[]> = { medical: [], financial: [], identity: [] };
  /** Put an item in a sensitive bucket when its record (or a record it comes from) is marked; otherwise keep it. */
  const route = (item: PackItem, ...records: (AnyRecord | null | undefined)[]): PackItem | null => {
    for (const r of records) {
      const s = sensitivityOf(r);
      if (s) {
        sensitive[s].push(item);
        return null;
      }
    }
    return item;
  };
  const keep = <T,>(x: T | null): x is T => x !== null;
  const person = dir.personById(personId);

  // Arrival checks, grouped by window. The action text is printed once; the practical checks follow it.
  const arrivals = idx.all
    .filter((r) => r.type === 'arrival')
    .filter((r) => {
      const scope = dataOf<ArrivalData>(r).traveler_scope ?? [];
      return scope.length === 0 || scope.includes(personId);
    });
  const forWindow = (key: string): PackItem[] =>
    arrivals
      .filter((r) => (dataOf<ArrivalData>(r).window_key ?? 'ongoing') === key)
      .map((r) => {
        const d = dataOf<ArrivalData>(r);
        const split = splitTitleAction(r.title, d.action);
        const trigger = d.trigger && !same(d.trigger, split.title) && !same(d.trigger, d.action) ? [`When: ${d.trigger}`] : [];
        return route({ id: r.id, title: split.title, detail: split.detail, check: checkText(d.review_note), meta: trigger }, r);
      })
      .filter(keep);

  // Dated rules that start at this traveler's arrival (on or after it) and fall within the first 30 days.
  const arrivalCode = person?.anchors?.arrival ?? null;
  const arrivalAnchor = idx.anchors.find((a) => ((a.data as { code?: string }).code ?? a.key) === arrivalCode);
  const arrivalDate = (arrivalAnchor?.data as { date?: string | null } | undefined)?.date ?? null;
  const codes = new Set<string>();
  for (const k of ['arrival', 'residence', 'health_eligibility', 'pension_eligibility'] as const) {
    const c = person?.anchors?.[k];
    if (c) codes.add(c);
  }
  const dated = deadlines
    .filter((d) => d.source === 'rule' && d.traveler === personId && d.applies !== 'no' && d.state !== 'met' && d.state !== 'not_applicable')
    .filter((d) => {
      const rule = d.rule_id ? idx.byKey.get(d.rule_id) : undefined;
      const anchor = rule ? dataOf<DeadlineRuleData>(rule).anchor : null;
      if (!anchor || !codes.has(anchor)) return false;
      // Only dates on or after landing; anything dated before arrival belongs to the pre-departure checklist.
      if (d.deadline.date && arrivalDate && isCivilDate(d.deadline.date) && isCivilDate(arrivalDate)) {
        const n = diffDays(arrivalDate, d.deadline.date);
        return n >= 0 && n <= 30;
      }
      const off = d.deadline.offset;
      return typeof off === 'number' && off >= 0 && off <= (d.deadline.unit === 'business_days' ? 22 : 30) && d.deadline.unit !== 'calendar_months';
    })
    .sort((a, b) => (a.deadline.date ?? '9999') < (b.deadline.date ?? '9999') ? -1 : 1)
    .map((d) =>
      route(
        {
          id: d.id,
          title: d.label.replace(/\s*\(each adult\)/i, ''),
          detail: verificationLine(d, idx),
          meta: [d.deadline.date ? civil(d.deadline.date, 'weekday') : 'Date to be set', DEADLINE_KIND_LABEL[d.kind]],
        },
        ...(d.linked_record_keys ?? []).map((k) => idx.byKey.get(k)),
      ),
    )
    .filter(keep);

  // Documents this traveler carries. The explicit `carry_on_arrival` list wins; older data falls back to the traveler scope.
  const docs = idx.all.filter((r) => r.type === 'document');
  const anyCarryMarks = docs.some((r) => (dataOf<DocumentData>(r).carry_on_arrival ?? []).length > 0);
  const carried = docs.filter((r) => {
    const d = dataOf<DocumentData>(r);
    if (anyCarryMarks) return (d.carry_on_arrival ?? []).includes(personId);
    const scope = d.traveler_scope ?? [];
    return scope.length === 0 || scope.includes(personId);
  });
  const carry = carried
    .map((r) => {
      const d = dataOf<DocumentData>(r);
      const href = safeHref(d.link);
      return route(
        { id: r.id, title: r.title, detail: d.custodian ? `Held by: ${d.custodian}` : null, check: null, meta: [r.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())], link: href },
        r,
      );
    })
    .filter(keep);

  // Contacts only when someone could be reached, and only the ones that matter in Tokyo (or the pet's vet for the pet).
  const isPet = person?.kind === 'pet';
  const contacts = idx.all
    .filter((r) => r.type === 'contact')
    .map((r) => ({ r, d: dataOf<ContactData>(r) }))
    .filter(({ d }) => reachableVia(d) !== null)
    .filter(({ d }) => (isPet ? /\bvet(erinar\w*)?\b/i.test(d.role ?? '') : !/\bvet(erinar\w*)?\b/i.test(d.role ?? '')))
    .map(({ r, d }) => route({ id: r.id, title: `${d.name} — ${d.role}`.replace(/ — $/, ''), detail: reachableVia(d) }, r))
    .filter(keep);

  const section = (key: string, title: string, items: PackItem[], empty: string): PackSection => ({ key, title, items, empty });
  return {
    personId,
    sections: [
      section('arrival_day', ARRIVAL_WINDOW_LABEL.arrival_day ?? 'Arrival day', forWindow('arrival_day'), 'Nothing listed for arrival day.'),
      section('first_week', 'First week', forWindow('first_week'), 'Nothing listed for the first week.'),
      section('first_30', 'First 30 days', [...forWindow('day_30'), ...dated], 'Nothing listed for the first 30 days yet.'),
      section('documents', 'Documents to carry', carry, 'No documents are marked to carry on arrival.'),
      section('contacts', 'Who to call in Tokyo', contacts, 'No contacts with a phone number or email are saved yet.'),
    ],
    sensitive,
  };
}
