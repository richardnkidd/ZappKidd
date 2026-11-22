/**
 * Arrival pack content: what to print for one traveler. Pure functions over the same records the screens use.
 * A short pack: the arrival day, the first week, the first 30 days, the documents this traveler carries and any contact
 * who can actually be reached. Sensitivity comes from an explicit field on the record (`sensitivity`), never from
 * guessing at words; sensitive items are returned separately so they print only when a person ticks that section.
 */
import { diffDays, isCivilDate } from '@shared/dates';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { ARRIVAL_WINDOW_LABEL } from '@shared/labels';
import type { ArrivalData, ContactData, DeadlineRuleData, DocumentData, Sensitivity as DataSensitivity } from '@shared/types';
import { safeHref } from './format';
import { dateLineText } from './dateLine';
import { displayNext, displayTitle, keyLookup, stripCodes } from '@shared/plain';
import { dataOf, type AnyRecord, type Directory, type Indexes } from './records';

export type Sensitivity = NonNullable<DataSensitivity>;
export const SENSITIVITY_ORDER: Sensitivity[] = ['medical', 'financial', 'identity'];

/** The record's own sensitivity mark. Nothing is inferred from its wording. */
export function sensitivityOf(record: AnyRecord | null | undefined): Sensitivity | null {
  const s = (record?.data as { sensitivity?: unknown } | undefined)?.sensitivity;
  return s === 'medical' || s === 'financial' || s === 'identity' ? s : null;
}

/**
 * One line on paper. An arrival step is its plain title, its date and the document to bring, and nothing else: the
 * reasons, rules and review notes stay in the app. `detail` and `meta` are only for the document and contact rows
 * (who holds it, its status, how to reach someone).
 */
export interface PackItem {
  id: string;
  title: string;
  /** The date, in the one short format with no distance ("Mon, Nov 30"). */
  date?: string | null;
  /** The document to bring for this step, when a document is linked to it. */
  bring?: string | null;
  detail?: string | null;
  meta?: string[];
  link?: string | null;
}

export interface PackSection {
  key: string;
  title: string;
  empty: string;
  items: PackItem[];
  /** What every row of the section has in common, said once ("Held by: Each document holder"). */
  note?: string | null;
}

export interface Pack {
  personId: string;
  sections: PackSection[];
  sensitive: Record<Sensitivity, PackItem[]>;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().replace(/[.\s]+$/, '').toLowerCase() === (b ?? '').trim().replace(/[.\s]+$/, '').toLowerCase();

/** A line for paper: codes removed, and no slashes, semicolons or bracketed asides (the house style for anything a person reads). */
function plainLine(text: string | null | undefined, lookup?: ReturnType<typeof keyLookup>): string {
  return stripCodes(text ?? '', lookup)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
  const lookup = keyLookup(idx.byKey);

  // Documents this traveler carries. The explicit `carry_on_arrival` list wins; older data falls back to the traveler scope.
  const docs = idx.all.filter((r) => r.type === 'document');
  const anyCarryMarks = docs.some((r) => (dataOf<DocumentData>(r).carry_on_arrival ?? []).length > 0);
  const carried = docs.filter((r) => {
    const d = dataOf<DocumentData>(r);
    if (anyCarryMarks) return (d.carry_on_arrival ?? []).includes(personId);
    const scope = d.traveler_scope ?? [];
    return scope.length === 0 || scope.includes(personId);
  });
  // Who holds a document and its status are said once above the rows when every row is the same.
  const holderOf = (d: Partial<DocumentData>) => stripCodes((d.custodian ?? '').replace(/\s*\((?:proposed|tbc|draft)\)/gi, ''), lookup).trim();
  const statusOf = (r: AnyRecord) => r.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const holders = new Set(carried.map((r) => holderOf(dataOf<DocumentData>(r))));
  const statuses = new Set(carried.map(statusOf));
  const commonHolder = carried.length > 1 && holders.size === 1 ? ([...holders][0] ?? '') : '';
  const commonStatus = carried.length > 1 && statuses.size === 1 ? [...statuses][0]! : '';
  const carryNote = [commonHolder ? `Held by: ${commonHolder}` : '', commonStatus ? `All: ${commonStatus}` : ''].filter(Boolean).join(' · ') || null;
  const carry = carried
    .map((r) => {
      const d = dataOf<DocumentData>(r);
      const href = safeHref(d.link);
      const holder = holderOf(d);
      return route(
        { id: r.id, title: plainLine(displayTitle(r, lookup), lookup), detail: holder && !commonHolder ? `Held by: ${holder}` : null, meta: commonStatus ? [] : [statusOf(r)], link: href },
        r,
      );
    })
    .filter(keep);

  // The document to bring for a step: a carried document that points at it (by key or id).
  const bringFor = (keys: string[]): string | null => {
    const doc = carried.find((r) => (dataOf<DocumentData>(r).linked_records ?? []).some((k) => keys.includes(k)));
    return doc ? plainLine(displayTitle(doc, lookup), lookup) || null : null;
  };

  // Arrival checks, grouped by window. One line each: the plain title, its date and the document to bring.
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
        const next = displayNext(r, lookup);
        const title = plainLine(displayTitle(r, lookup), lookup);
        return route(
          {
            id: r.id,
            title: next && !same(next, title) ? `${title}. ${plainLine(next, lookup)}` : title,
            date: d.deadline?.date ? dateLineText(d.deadline.date) : null,
            bring: bringFor([r.key, r.id]),
          },
          r,
        );
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
          title: plainLine(d.label, lookup),
          date: dateLineText(d.deadline.date),
          bring: bringFor(d.linked_record_keys ?? []),
        },
        ...(d.linked_record_keys ?? []).map((k) => idx.byKey.get(k)),
      ),
    )
    .filter(keep);

  // Contacts only when someone could be reached, and only the ones that matter in Tokyo (or the pet's vet for the pet).
  const isPet = person?.kind === 'pet';
  const contacts = idx.all
    .filter((r) => r.type === 'contact')
    .map((r) => ({ r, d: dataOf<ContactData>(r) }))
    .filter(({ d }) => reachableVia(d) !== null)
    .filter(({ d }) => (isPet ? /\bvet(erinar\w*)?\b/i.test(d.role ?? '') : !/\bvet(erinar\w*)?\b/i.test(d.role ?? '')))
    .map(({ r, d }) => route({ id: r.id, title: plainLine(`${d.name} — ${d.role}`.replace(/ — $/, ''), lookup), detail: reachableVia(d) }, r))
    .filter(keep);

  const section = (key: string, title: string, items: PackItem[], empty: string, note: string | null = null): PackSection => ({ key, title, items, empty, note });
  return {
    personId,
    sections: [
      section('arrival_day', ARRIVAL_WINDOW_LABEL.arrival_day ?? 'Arrival day', forWindow('arrival_day'), 'Nothing listed for arrival day.'),
      section('first_week', 'First week', forWindow('first_week'), 'Nothing listed for the first week.'),
      section('first_30', 'First 30 days', [...forWindow('day_30'), ...dated], 'Nothing listed for the first 30 days yet.'),
      section('documents', 'Documents to carry', carry, 'No documents are marked to carry on arrival.', carry.length > 0 ? carryNote : null),
      section('contacts', 'Who to call in Tokyo', contacts, 'No contacts with a phone number or email are saved yet.'),
    ],
    sensitive,
  };
}
