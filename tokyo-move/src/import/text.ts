/**
 * Text helpers for turning workbook free text into structured values. Everything here is data-driven: person names,
 * aliases and collaborators come from the parsed workbook / overrides, never from this file.
 */
import type { OwnerRef, Person } from '../shared/types';
import { slugify } from './util';

export type ParsedPerson = Omit<Person, 'household_id'>;

export function clean(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

export function splitList(text: string | null | undefined, separator: RegExp | string = /[;\n]/): string[] {
  if (!text) return [];
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** IDs like 'W15', 'S01', 'Q077' mentioned anywhere in a text. */
export function findIds(text: string | null | undefined, prefix: string, digits: number): string[] {
  if (!text) return [];
  const re = new RegExp(`\\b${prefix}\\d{${digits}}\\b`, 'g');
  return [...new Set(text.match(re) ?? [])];
}

export function sentenceCase(text: string): string {
  const t = text.trim();
  return t === '' ? t : t.charAt(0).toUpperCase() + t.slice(1);
}

/* ------------------------------------------------------------------ */
/* People resolution                                                   */
/* ------------------------------------------------------------------ */

export class PeopleIndex {
  private readonly byName = new Map<string, ParsedPerson>();
  constructor(readonly people: ParsedPerson[]) {
    for (const p of people) {
      this.byName.set(p.display_name.toLowerCase(), p);
      this.byName.set(p.id, p);
      for (const a of p.aliases) this.byName.set(a.toLowerCase(), p);
    }
  }
  get adults(): ParsedPerson[] {
    return this.people.filter((p) => p.kind === 'adult');
  }
  get pets(): ParsedPerson[] {
    return this.people.filter((p) => p.kind === 'pet');
  }
  resolve(name: string): ParsedPerson | null {
    return this.byName.get(name.trim().toLowerCase()) ?? null;
  }
  /** Distinct names (display names and aliases) as regex alternation, longest first. */
  private alternation(list: ParsedPerson[]): string {
    const names = new Set<string>();
    for (const p of list) {
      names.add(p.display_name);
      for (const a of p.aliases) names.add(a);
    }
    return [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  }
  /** People whose name or alias appears as a whole word in the text. */
  mentioned(text: string | null | undefined, list: ParsedPerson[] = this.people): ParsedPerson[] {
    if (!text) return [];
    const out: ParsedPerson[] = [];
    for (const p of list) {
      const alt = this.alternation([p]);
      if (alt && new RegExp(`(^|[^\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, 'iu').test(text)) out.push(p);
    }
    return out;
  }
}

const EACH_ADULT = /\b(each|both|every)\s+(working\s+|affected\s+)?(adult|adults|account holder|traveler)s?\b|\bnamed patient\b|\ball participants\b|\bboth adults\b/i;
const OWNER_SUFFIX = /^(?:custodian|prepares|verifies|approves?|chooses|decides|only|individually|jointly)\b.*$/i;

export interface OwnerParse {
  owner: OwnerRef;
  owner_proposed: boolean;
  collaborators: string[];
  adults: string[];
}

export function normalizeCollaborator(token: string): string | null {
  const t = clean(token.replace(/\(proposed\)/gi, ''));
  if (!t) return null;
  if (/^(local\s+)?codex\b/i.test(t)) return 'Assistant';
  return sentenceCase(t);
}

/**
 * One accountable owner from a free-text 'owner' cell: a single named adult ⇒ that person; both adults / 'each adult' ⇒
 * 'together'; none ⇒ 'unassigned'. Anyone else (advisers, vet, the assistant) becomes a collaborator.
 */
export function parseOwner(text: string | null | undefined, people: PeopleIndex): OwnerParse {
  const raw = text ?? '';
  const proposed = /\(proposed\)/i.test(raw);
  const stripped = raw.replace(/\(proposed\)/gi, ' ').replace(/\brelevant\b/gi, ' ').replace(/\bshipment owner\b/gi, ' ');
  const tokens = stripped
    .split(/\s*(?:\+|;|,|\/|\band\b|\bor\b)\s*/i)
    .map((t) => t.trim())
    .filter((t) => t !== '');
  const adults = new Set<string>();
  const collaborators: string[] = [];
  const eachAdult = EACH_ADULT.test(stripped);
  for (const token of tokens) {
    const words = token.split(/\s+/);
    const first = words[0] ?? '';
    const person = people.resolve(first);
    const rest = words.slice(1).join(' ');
    if (person && (rest === '' || OWNER_SUFFIX.test(rest))) {
      if (person.kind === 'adult') adults.add(person.id);
      continue;
    }
    if (EACH_ADULT.test(token)) {
      // 'Each adult' itself is an owner; the remainder of a longer phrase is not parsed further
      if (/^(each|both|every)\b.*\b(adult|adults|account holder|traveler)s?$/i.test(token) || /^(named patient|all participants|both adults)$/i.test(token)) continue;
    }
    const c = normalizeCollaborator(token);
    if (c && !collaborators.includes(c)) collaborators.push(c);
  }
  if (eachAdult) for (const a of people.adults) adults.add(a.id);
  const list = [...adults];
  const owner: OwnerRef = list.length === 0 ? 'unassigned' : list.length === 1 ? (list[0] as string) : 'together';
  return { owner, owner_proposed: proposed, collaborators, adults: list };
}

export function personIdFromName(name: string): string {
  return slugify(name);
}
