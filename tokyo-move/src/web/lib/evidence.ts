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

export function directCheckOf(data: unknown): DirectCheck | null {
  const dc = (data as { direct_check?: unknown } | null | undefined)?.direct_check;
  if (!dc || typeof dc !== 'object') return null;
  const o = dc as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return { on: str(o.on), url: str(o.url), result: str(o.result), quote: str(o.quote), note: str(o.note) };
}

/** All `review_check_*` fields as readable label/value pairs. */
export function reviewChecksOf(data: unknown): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) {
    if (!k.startsWith('review_check_') || v === null || v === undefined || v === '') continue;
    const rest = k.slice('review_check_'.length).replace(/_/g, ' ');
    out.push({ label: rest === 'on' ? 'Review check on' : rest.charAt(0).toUpperCase() + rest.slice(1), value: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  return out;
}

const UNREACHED = /(unreach|could not|couldn.?t|can.?t reach|cannot reach|failed|error|blocked|timed? ?out|not reachable|unavailable|no access)/i;
const INDEXED = /(index|snippet|search result|secondary)/i;
const CONFIRMED = /(verified|confirmed|matched|match|found|read|quoted|checked|ok|pass|current)/i;

/**
 * "Verified on the official page <date>" / "From indexed official text — confirm" / "Couldn't reach".
 * `dateFor` formats a civil date for display.
 */
export function evidenceVerification(data: unknown, dateFor: (d: string) => string): EvidenceVerification {
  const dc = directCheckOf(data);
  const access = String((data as { access?: unknown } | null | undefined)?.access ?? '');
  const on = dc?.on ? ` on ${dateFor(dc.on)}` : '';
  if (dc) {
    const r = dc.result ?? '';
    if (UNREACHED.test(r)) return { label: `Couldn’t reach the official page${on}`, tone: 'kaki' };
    if (INDEXED.test(r) && !/verified|confirmed/i.test(r)) return { label: 'From indexed official text — confirm', tone: 'kin' };
    if (CONFIRMED.test(r) || dc.quote) return { label: `Verified on the official page${on}`, tone: 'matcha' };
    return { label: `Checked${on}${r ? ` — ${r}` : ''}`, tone: 'neutral' };
  }
  if (UNREACHED.test(access)) return { label: 'Couldn’t reach the official page', tone: 'kaki' };
  if (INDEXED.test(access)) return { label: 'From indexed official text — confirm', tone: 'kin' };
  if (/direct/i.test(access)) return { label: 'Official page read directly', tone: 'matcha' };
  return { label: 'Not checked against the official page yet', tone: 'neutral' };
}
