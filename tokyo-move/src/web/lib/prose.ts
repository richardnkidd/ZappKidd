/**
 * Render-time clean-up of imported prose. Household screens never show record keys, internal names or glued tokens:
 *  - a known record key becomes the record's title (a link on screens that use <Prose>), an unknown key is dropped;
 *  - evidence keys such as the household follow-up note read as that evidence's title;
 *  - "Codex" reads as "your assistant"; "July2027" reads as "July 2027"; ISO dates read as dates.
 * Original text is untouched in Source & history.
 */
import { isCivilDate } from '@shared/dates';
import { civil } from './format';
import type { Indexes } from './records';

export type ProseToken = { kind: 'text'; text: string } | { kind: 'link'; id: string; title: string };

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
const GLUED_MONTH_YEAR = new RegExp(`\\b(${MONTHS})(\\d{4})\\b`, 'g');
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/** Shapes that are record keys (never anchor offsets such as DP-10 or D-45). */
const KEY_SHAPE = String.raw`(?:(?:W|S|Q|D|R|B|A|Y|I|P|M|C)\d{2,3}(?:\.[a-z][a-z0-9]*)?|(?:EX|FW|FN|DOC|INV|PROP|TA|RH|USER|XN|XR)\d{1,3}|(?:D|A|R|W)-RV\d{2}|IT-\d{3}|IT-RULE-\d+|FW-[A-Z])`;
const KEY_TOKEN = new RegExp(`\\b${KEY_SHAPE}\\b`);
const PAREN_KEYS = new RegExp(`\\(\\s*(?:${KEY_SHAPE})(?:\\s*(?:,|and|&|/|;|\\s)\\s*(?:${KEY_SHAPE}))*\\s*\\)`, 'g');
const ANY_KEY = new RegExp(`\\b${KEY_SHAPE}\\b`, 'g');

export function basicProse(text: string): string {
  return text
    .replace(/\bCodex\b/g, 'your assistant')
    .replace(/\bexisting canonical task\b/gi, 'Already in your task list')
    .replace(/\bpending task capture\b/gi, 'Waiting to be added')
    .replace(GLUED_MONTH_YEAR, '$1 $2')
    .replace(ISO_DATE, (m) => (isCivilDate(m) ? civil(m, 'short') : m));
}

function tidy(s: string): string {
  return s
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s+|\s+$/g, '');
}

/** Tokens for rendering: text runs and links to known records. Unknown keys are dropped. */
export function proseTokens(raw: string | null | undefined, idx: Indexes | null | undefined): ProseToken[] {
  if (!raw) return [];
  const text = basicProse(raw);
  const byKey = idx?.byKey;
  const out: ProseToken[] = [];
  let pending = '';
  const flush = () => {
    if (pending) out.push({ kind: 'text', text: pending });
    pending = '';
  };
  const handleKeys = (segment: string, wrapInParens: boolean) => {
    // A segment is "(W04 and W08)" content or bare text with keys inside.
    let last = 0;
    const links: { id: string; title: string }[] = [];
    segment.replace(ANY_KEY, (m, offset: number) => {
      const rec = byKey?.get(m);
      if (!wrapInParens) {
        pending += segment.slice(last, offset);
        last = offset + m.length;
        if (rec) {
          flush();
          out.push({ kind: 'link', id: rec.id, title: rec.title });
        }
      } else if (rec) {
        links.push({ id: rec.id, title: rec.title });
      }
      return m;
    });
    if (!wrapInParens) pending += segment.slice(last);
    else if (links.length) {
      pending += '(';
      links.forEach((l, i) => {
        if (i > 0) pending += ', ';
        flush();
        out.push({ kind: 'link', id: l.id, title: l.title });
      });
      pending += ')';
    }
  };
  let cursor = 0;
  text.replace(PAREN_KEYS, (m, offset: number) => {
    handleKeys(text.slice(cursor, offset), false);
    handleKeys(m, true);
    cursor = offset + m.length;
    return m;
  });
  handleKeys(text.slice(cursor), false);
  flush();
  // tidy the text runs without touching link titles
  return out
    .map((t) => (t.kind === 'text' ? { ...t, text: t.text.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1') } : t))
    .filter((t) => t.kind === 'link' || t.text !== '');
}

/** Plain-string form: link titles in quotes. */
export function proseText(raw: string | null | undefined, idx: Indexes | null | undefined): string {
  const s = proseTokens(raw, idx)
    .map((t) => (t.kind === 'text' ? t.text : `“${t.title}”`))
    .join('');
  return tidy(s);
}

export const looksLikeKey = (s: string): boolean => KEY_TOKEN.test(s);
