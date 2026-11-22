/**
 * Plain-language display helpers. The interface prefers the optional `data.plain_*` fields and falls back to the
 * imported wording with internal record codes (W04, D02, Q017, DOC12 ...) removed. Pure: no I/O, usable on the
 * server and in the browser. Original text is never changed; these only choose what to show.
 */
import type { PlainFields } from './types';

/** Shapes that are record keys (never anchor offsets such as DP-10 or D-45). */
export const KEY_SHAPE = String.raw`(?:(?:W|S|Q|D|R|B|A|Y|I|P|M|C)\d{2,3}(?:\.[a-z][a-z0-9]*)?|(?:EX|FW|FN|DOC|INV|PROP|TA|RH|USER|XN|XR)\d{1,3}|(?:D|A|R|W)-RV\d{2}|IT-\d{3}|IT-RULE-\d+|FW-[A-Z])`;
const KEY_TOKEN = new RegExp(`\\b${KEY_SHAPE}\\b`);
const ANY_KEY = new RegExp(`\\b${KEY_SHAPE}\\b`, 'g');
/** "(W04)", "(W04 and W08)", "(W04, W08)": a bracketed group made only of keys. */
export const PAREN_KEYS = new RegExp(`\\(\\s*(?:${KEY_SHAPE})(?:\\s*(?:,|and|&|/|;|\\s)\\s*(?:${KEY_SHAPE}))*\\s*\\)`, 'g');
/** "W04", "W04 and W08", "W04 / W08": a run of bare keys. */
const KEY_RUN = new RegExp(`\\b${KEY_SHAPE}\\b(?:\\s*(?:,|/|&|;|\\band\\b|\\bor\\b)\\s*\\b${KEY_SHAPE}\\b)*`, 'g');

/** Resolves a record key such as "W04" to that record's display title, or null/undefined when unknown. */
export type KeyLookup = (key: string) => string | null | undefined;

/** Build a lookup from any map of key to something with a title (for example the web app's `idx.byKey`). */
export function keyLookup(byKey: ReadonlyMap<string, { title: string }> | null | undefined): KeyLookup | undefined {
  if (!byKey) return undefined;
  return (key) => byKey.get(key)?.title ?? null;
}

export const looksLikeKey = (s: string): boolean => KEY_TOKEN.test(s);

/** Tidy what is left behind when a code is taken out: empty brackets, stray slashes and commas, double spaces. */
export function tidyProse(s: string): string {
  let t = s;
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/\(\s*[,;/&]*\s*\)/g, '')
      .replace(/\[\s*[,;/&]*\s*\]/g, '')
      .replace(/\(\s*[,;/&]+\s*/g, '(')
      .replace(/\s*[,;/&]+\s*\)/g, ')')
      .replace(/(^|\s)[/&]+(?=\s|$)/g, '$1')
      .replace(/\s+([,.;:?!])/g, '$1')
      .replace(/([,;])(\s*[,;])+/g, '$1')
      .replace(/\(\s+/g, '(')
      .replace(/[ \t]{2,}/g, ' ');
  }
  return t
    .replace(/^[\s,;:/&-]+/, '')
    .replace(/[\s,;:/&-]+$/, '')
    .trim();
}

/**
 * Remove internal record codes from text. A bracketed group of codes is dropped. A bare code becomes the record's
 * title when `lookup` knows it, otherwise it is dropped. Leftover brackets, slashes and double spaces are tidied.
 */
export function stripCodes(raw: string | null | undefined, lookup?: KeyLookup): string {
  if (!raw) return '';
  const noParens = raw.replace(PAREN_KEYS, '');
  const replaced = noParens.replace(KEY_RUN, (run) => {
    if (!lookup) return '';
    const titles: string[] = [];
    for (const m of run.match(ANY_KEY) ?? []) {
      const t = lookup(m);
      if (t && t.trim()) titles.push(t.trim());
    }
    if (titles.length <= 1) return titles[0] ?? '';
    return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
  });
  return tidyProse(replaced);
}

/* ---------- reading the plain fields ---------- */

/** Anything with a title and a `data` bag; typed records and loosely typed API records both fit. */
export interface PlainSubject {
  type?: string;
  title: string;
  data?: unknown;
}

function dataBag(r: { data?: unknown } | null | undefined): Record<string, unknown> {
  const d = r?.data;
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

function plainText(r: { data?: unknown } | null | undefined, field: keyof PlainFields): string | null {
  const v = dataBag(r)[field];
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

function orNull(s: string): string | null {
  return s === '' ? null : s;
}

/** The title to show: plain_title, else the title with codes removed. Never empty if the title was not empty. */
export function displayTitle(record: PlainSubject, lookup?: KeyLookup): string {
  return plainText(record, 'plain_title') ?? (stripCodes(record.title, lookup) || record.title.trim());
}

/** The question to ask: plain_question, else the title when it already ends in "?", else null. */
export function displayQuestion(record: PlainSubject, lookup?: KeyLookup): string | null {
  const q = plainText(record, 'plain_question');
  if (q) return q;
  const t = stripCodes(record.title, lookup);
  return t.endsWith('?') ? t : null;
}

/** The "why": plain_summary, else null. */
export function displaySummary(record: PlainSubject): string | null {
  return plainText(record, 'plain_summary');
}

/** "If we don't decide": plain_delay, else the imported consequence with codes removed, else null. */
export function displayDelay(decision: PlainSubject, lookup?: KeyLookup): string | null {
  const p = plainText(decision, 'plain_delay');
  if (p) return p;
  const c = dataBag(decision).consequence_of_delay;
  return typeof c === 'string' ? orNull(stripCodes(c, lookup)) : null;
}

/** The next step of a milestone: plain_next, else next_action with codes removed, else null. */
export function displayNext(milestone: PlainSubject, lookup?: KeyLookup): string | null {
  const p = plainText(milestone, 'plain_next');
  if (p) return p;
  const n = dataBag(milestone).next_action;
  return typeof n === 'string' ? orNull(stripCodes(n, lookup)) : null;
}

/** An option's label: plain_options[option.id], else the option's own label with codes removed. */
export function optionLabel(decision: PlainSubject, option: { id: string; label: string }, lookup?: KeyLookup): string {
  const map = dataBag(decision).plain_options;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const v = (map as Record<string, unknown>)[option.id];
    if (typeof v === 'string' && v.trim() !== '') return v.replace(/\s+/g, ' ').trim();
  }
  return stripCodes(option.label, lookup) || option.label.trim();
}

/**
 * True when the record has the plain fields its type needs:
 * decisions and questions need `plain_question`; milestones need `plain_next`; any other type needs `plain_title`.
 */
export function hasPlainWording(record: PlainSubject): boolean {
  switch (record.type) {
    case 'decision':
    case 'question':
      return plainText(record, 'plain_question') !== null;
    case 'milestone':
      return plainText(record, 'plain_next') !== null;
    default:
      return plainText(record, 'plain_title') !== null;
  }
}
