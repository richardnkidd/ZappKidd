/**
 * Arrival pack content: what to print for one traveler. Pure functions over the same records the screens use.
 * Sensitive text (health and medicine, money and accounts) is kept OUT of the main sections and returned separately,
 * so it can only appear when a person ticks that section.
 */
import { diffDays, isCivilDate } from '@shared/dates';
import type { ComputedDeadline } from '@shared/engine-contracts';
import { ARRIVAL_WINDOW_LABEL, CONTACT_RELATIONSHIP_LABEL, DEADLINE_KIND_LABEL, VERIFICATION_LABEL } from '@shared/labels';
import type { ArrivalData, ContactData, DeadlineRuleData, DocumentData } from '@shared/types';
import { humanizeKey, safeHref, civil } from './format';
import { dataOf, type Directory, type Indexes } from './records';

export type Sensitivity = 'health' | 'money';

const HEALTH = /\b(health|medic\w*|medicine|prescription|vaccin\w*|insurance|clinic|doctor|hospital|nhi|dental|therapy|treatment)\b/i;
const MONEY = /\b(bank|banking|money|account|accounts|tax|taxes|pension|payment|payments|cash|funds|transfer|credit|card|salary|income|invoice)\b/i;

export function sensitivityOf(...texts: (string | null | undefined)[]): Sensitivity | null {
  const t = texts.filter(Boolean).join(' ');
  if (HEALTH.test(t)) return 'health';
  if (MONEY.test(t)) return 'money';
  return null;
}

export interface PackItem {
  id: string;
  title: string;
  detail?: string | null;
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

function verificationLine(d: ComputedDeadline, idx: Indexes): string | null {
  const rule = d.rule_id ? (idx.byKey.get(d.rule_id) ?? null) : null;
  const v = rule ? (dataOf<DeadlineRuleData>(rule).verification ?? 'not_verified') : d.kind === 'legal' && !d.deadline.verified_on ? 'not_verified' : null;
  return v && v !== 'verified_official' ? VERIFICATION_LABEL[v] : null;
}

export function buildPack(idx: Indexes, dir: Directory, deadlines: ComputedDeadline[], personId: string): Pack {
  const sensitive: Record<Sensitivity, PackItem[]> = { health: [], money: [] };
  const route = (item: PackItem, ...texts: (string | null | undefined)[]): PackItem | null => {
    const s = sensitivityOf(item.title, item.detail, ...texts);
    if (s) {
      sensitive[s].push(item);
      return null;
    }
    return item;
  };
  const keep = <T,>(x: T | null): x is T => x !== null;

  // Arrival checks, grouped by window.
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
        const same = (a: string, b: string) => a.trim().replace(/[.\s]+$/, '').toLowerCase() === b.trim().replace(/[.\s]+$/, '').toLowerCase();
        const detail = d.action && !same(d.action, r.title) ? d.action : null;
        return route({ id: r.id, title: r.title, detail, meta: d.trigger ? [`When: ${d.trigger}`] : [] }, d.completion_criteria);
      })
      .filter(keep);

  // Deadlines that start at this traveler's arrival and fall in the first 30 days.
  const person = dir.personById(personId);
  const arrivalCode = person?.anchors?.arrival ?? null;
  const arrivalAnchor = idx.anchors.find((a) => ((a.data as { code?: string }).code ?? a.key) === arrivalCode);
  const arrivalDate = (arrivalAnchor?.data as { date?: string | null } | undefined)?.date ?? null;
  const codes = new Set<string>();
  for (const k of ['arrival', 'residence', 'health_eligibility', 'pension_eligibility'] as const) {
    const c = person?.anchors?.[k];
    if (c) codes.add(c);
  }
  const first30 = deadlines
    .filter((d) => d.source === 'rule' && d.traveler === personId && d.applies !== 'no' && d.state !== 'met' && d.state !== 'not_applicable')
    .filter((d) => {
      const rule = d.rule_id ? idx.byKey.get(d.rule_id) : undefined;
      const anchor = rule ? dataOf<DeadlineRuleData>(rule).anchor : null;
      if (!anchor || !codes.has(anchor)) return false;
      if (d.deadline.date && arrivalDate && isCivilDate(d.deadline.date) && isCivilDate(arrivalDate)) {
        const n = diffDays(arrivalDate, d.deadline.date);
        return n >= 0 && n <= 30;
      }
      const off = d.deadline.offset;
      return typeof off === 'number' && off >= 0 && off <= (d.deadline.unit === 'business_days' ? 22 : 30) && d.deadline.unit !== 'calendar_months';
    })
    .map((d) =>
      route(
        {
          id: d.id,
          title: d.label.replace(/\s*\(each adult\)/i, ''),
          detail: verificationLine(d, idx),
          meta: [d.deadline.date ? civil(d.deadline.date, 'weekday') : 'Date to be set', DEADLINE_KIND_LABEL[d.kind]],
        },
        d.deadline.basis,
      ),
    )
    .filter(keep);

  // Contacts by role and relationship only. Names are never printed.
  const contacts = idx.all
    .filter((r) => r.type === 'contact')
    .map((r) => {
      const d = dataOf<ContactData>(r);
      return route({ id: r.id, title: d.role?.trim() || 'Contact', meta: [CONTACT_RELATIONSHIP_LABEL[d.relationship ?? 'potential'] ?? humanizeKey(d.relationship ?? 'potential')] }, d.relevance);
    })
    .filter(keep);

  // Documents to carry: status and who holds them. Never identifiers.
  const docs = idx.all
    .filter((r) => r.type === 'document')
    .filter((r) => {
      const scope = dataOf<DocumentData>(r).traveler_scope ?? [];
      return scope.length === 0 || scope.includes(personId);
    });
  const carry = docs
    .map((r) => {
      const d = dataOf<DocumentData>(r);
      return route({ id: r.id, title: r.title, detail: d.custodian ? `Held by: ${d.custodian}` : null, meta: [humanizeKey(r.status)] }, d.completion_criteria);
    })
    .filter(keep);

  // Links: restricted links only, printed as text.
  const links = docs
    .map((r) => ({ r, href: safeHref(dataOf<DocumentData>(r).link) }))
    .filter((x): x is { r: (typeof docs)[number]; href: string } => Boolean(x.href))
    .map((x) => route({ id: x.r.id, title: x.r.title, link: x.href }))
    .filter(keep);

  const section = (key: string, title: string, items: PackItem[], empty: string): PackSection => ({ key, title, items, empty });
  return {
    personId,
    sections: [
      section('arrival_day', ARRIVAL_WINDOW_LABEL.arrival_day ?? 'Arrival day', forWindow('arrival_day'), 'Nothing listed for arrival day.'),
      section('first_week', 'First-week essentials', forWindow('first_week'), 'Nothing listed for the first week.'),
      section('first_30', 'First 30 days: dates', first30, 'No dated rules fall in the first 30 days yet.'),
      section('contacts', 'Key contacts (by role)', contacts, 'No contacts listed.'),
      section('documents', 'Documents to carry', carry, 'No documents listed.'),
      section('links', 'Links', links, 'No links saved.'),
    ],
    sensitive,
  };
}

