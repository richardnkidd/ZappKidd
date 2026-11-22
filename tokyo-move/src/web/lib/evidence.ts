import { CHECK_STATUS_LABEL, reviewerLabel } from '@shared/labels';

/** One check of a source against its official page, normalised from `direct_check` or a `review_check_<reviewer>` field. */
export interface CheckLine {
  /** Who checked: a review's name, or null for the plan's own direct check. */
  who: string | null;
  on: string | null;
  status: string | null;
  statusLabel: string;
  tone: VerificationTone;
  note: string | null;
  quote: string | null;
  url: string | null;
}

/** How well a source has been checked, in plain words. Reads direct_check / review_check_* defensively. */
export interface DirectCheck {
  on?: string | null;
  url?: string | null;
  result?: string | null;
  quote?: string | null;
  note?: string | null;
}

export type VerificationTone = 'matcha' | 'kin' | 'kaki' | 'neutral';

export interface EvidenceVerification {
  label: string;
  tone: VerificationTone;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isCivil = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function directCheckOf(data: unknown): DirectCheck | null {
  const dc = (data as { direct_check?: unknown } | null | undefined)?.direct_check;
  if (!dc || typeof dc !== 'object') return null;
  const o = dc as Record<string, unknown>;
  return { on: str(o.on), url: str(o.url), result: str(o.result), quote: str(o.quote), note: str(o.note) };
}

/** Flat `review_check_*` fields as label/value pairs (older shape). Object-shaped checks are read by `checksOf`. */
export function reviewChecksOf(data: unknown): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) {
    if (!k.startsWith('review_check_') || v === null || v === undefined || v === '') continue;
    if (typeof v === 'object') continue;
    const rest = k.slice('review_check_'.length).replace(/_/g, ' ');
    out.push({ label: rest === 'on' ? 'Review check on' : rest.charAt(0).toUpperCase() + rest.slice(1), value: String(v) });
  }
  return out;
}

/** A code such as `blocked_by_site` -> words, for the rare check status we have no sentence for. */
const words = (code: string) => code.replace(/[_-]+/g, ' ').trim();

/** Free-text results from older records, read as a status. */
function legacyStatus(text: string): string | null {
  if (/(unreach|could not|couldn.?t|can.?t reach|cannot reach|failed|error|blocked|timed? ?out|not reachable|unavailable|no access|refus)/i.test(text)) return 'blocked_by_site';
  if (/(index|snippet|search result|secondary)/i.test(text) && !/verified|confirmed/i.test(text)) return 'indexed_only';
  if (/(not found|404|gone)/i.test(text)) return 'not_found';
  if (/(verified|confirmed|matched|match|found|read|quoted|checked|ok|pass|current)/i.test(text)) return 'confirmed';
  return null;
}

const TONE: Record<string, VerificationTone> = { confirmed: 'matcha', changed: 'kin', blocked_by_site: 'kin', indexed_only: 'kin', not_found: 'kaki', not_checked: 'neutral' };

function lineFrom(who: string | null, o: Record<string, unknown>, statusKey: 'status' | 'result'): CheckLine {
  const raw = str(o[statusKey]);
  const status = raw ? (CHECK_STATUS_LABEL[raw] ? raw : legacyStatus(raw)) : null;
  return {
    who,
    on: str(o.on),
    status,
    statusLabel: status ? (CHECK_STATUS_LABEL[status] ?? words(status)) : raw ? words(raw) : 'Checked',
    tone: status ? (TONE[status] ?? 'neutral') : 'neutral',
    note: str(o.note),
    quote: str(o.quote),
    url: str(o.checked_url) ?? str(o.url),
  };
}

/** Every recorded check of this source, newest first (the plan's own direct check wins a tie). */
export function checksOf(data: unknown): CheckLine[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const out: CheckLine[] = [];
  if (d.direct_check && typeof d.direct_check === 'object') out.push(lineFrom(null, d.direct_check as Record<string, unknown>, 'result'));
  for (const [k, v] of Object.entries(d)) {
    if (!k.startsWith('review_check_') || !v || typeof v !== 'object') continue;
    out.push(lineFrom(reviewerLabel(k.slice('review_check_'.length)), v as Record<string, unknown>, 'status'));
  }
  return out.sort((a, b) => ((b.on ?? '') > (a.on ?? '') ? 1 : (b.on ?? '') < (a.on ?? '') ? -1 : a.who === null ? -1 : 1));
}

/** The most recent of the source's own check date and every recorded check. */
export function lastCheckedOf(data: unknown): string | null {
  const d = (data ?? {}) as { checked_on?: unknown };
  const dates = [str(d.checked_on), ...checksOf(data).map((c) => c.on)].filter((x): x is string => isCivil(x));
  return dates.sort().pop() ?? null;
}

/**
 * Note text made readable: snake_case codes become words ("indexed_only" -> "indexed only"). Record keys and internal
 * names are handled by the shared prose pass.
 */
export function cleanNote(text: string): string {
  return text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, (m) => words(m));
}

const INDEXED = /(index|snippet|search result|secondary)/i;
const UNREACHED = /(unreach|could not|couldn.?t|can.?t reach|cannot reach|failed|error|blocked|timed? ?out|not reachable|unavailable|no access|403|404)/i;

/**
 * "Read directly <date>" / "Official index only" / "Site refused" / "Page gone". Based on the newest recorded check
 * (the plan's direct check first); a record with no check falls back to its `access` text.
 * `dateFor` formats a civil date for display.
 */
export function evidenceVerification(data: unknown, dateFor: (d: string) => string): EvidenceVerification {
  const checks = checksOf(data);
  const top = checks.find((c) => c.status) ?? checks[0];
  if (top && (top.status || top.statusLabel !== 'Checked')) {
    const on = top.on ? ` on ${dateFor(top.on)}` : '';
    if (top.status === 'confirmed') return { label: `Read directly${on}`, tone: 'matcha' };
    if (top.status === 'indexed_only') return { label: 'Official index only — confirm', tone: 'kin' };
    return { label: `${top.statusLabel}${top.status === 'changed' || top.status === 'blocked_by_site' || top.status === 'not_found' || top.status === 'not_checked' ? on : ''}`, tone: top.tone };
  }
  if (top) return { label: `Checked${top.on ? ` on ${dateFor(top.on)}` : ''}`, tone: 'neutral' };
  const access = String((data as { access?: unknown } | null | undefined)?.access ?? '');
  if (INDEXED.test(access)) return { label: 'Official index only — confirm', tone: 'kin' };
  if (UNREACHED.test(access) && !/directly (retrieved|read)|read directly/i.test(access)) return { label: 'Site refused — official index only', tone: 'kin' };
  if (/official/i.test(access) && /(direct|retriev)/i.test(access)) return { label: 'Official page read directly', tone: 'matcha' };
  return { label: access ? 'Checked — see the note' : 'Not checked against the official page yet', tone: 'neutral' };
}
