import { Link } from 'react-router';
import { diffDays, isCivilDate } from '@shared/dates';
import { displayQuestion, displayTitle, optionLabel as plainOptionLabel, stripCodes, type KeyLookup } from '@shared/plain';
import type { DecisionData, DecisionOption } from '@shared/types';
import { Chip } from '../../components/Badges';
import { Icon, type IconName } from '../../components/Icon';
import { recordedDecision } from '../../lib/home';
import { civil } from '../../lib/format';
import type { Decision, Directory } from '../../lib/records';
import { turnInfo, type DecisionTurn, type TurnInfo } from '../../lib/turn';

export interface ApprovalSummary {
  /** Plain sentence, e.g. "Approved by <name> · awaiting <name>". */
  text: string;
  state: 'none' | 'partial' | 'agreed' | 'disagree' | 'closed';
}

export function requiredApproverIds(d: Decision, dir: Directory): string[] {
  const req = d.data?.required_approvers ?? [];
  return req.length > 0 ? req : dir.adults.map((a) => a.id);
}

function optionLabel(data: Partial<DecisionData>, id: string | null | undefined): string | null {
  if (!id) return null;
  return data.options?.find((o) => o.id === id)?.label ?? null;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the approvals say, in words. Disagreement is called out rather than hidden:
 * two different choices never read as "approved".
 */
export function approvalSummary(d: Decision, dir: Directory): ApprovalSummary {
  const rec = recordedDecision(d);
  if (rec) return { text: `Decided ${rec.on ? civil(rec.on, 'short') : 'earlier'} (recorded in the plan)`, state: 'agreed' };
  const data = d.data ?? ({} as Partial<DecisionData>);
  const required = requiredApproverIds(d, dir);
  // Latest approval per person wins.
  const latest = new Map<string, { option_id: string; at: string }>();
  for (const a of data.approvals ?? []) {
    const prev = latest.get(a.person_id);
    if (!prev || prev.at <= a.at) latest.set(a.person_id, { option_id: a.option_id, at: a.at });
  }
  const approvedIds = required.filter((id) => latest.has(id));
  const waitingIds = required.filter((id) => !latest.has(id));
  const names = (ids: string[]) => ids.map((id) => dir.nameOf(id));

  if (d.status === 'rejected') return { text: 'Rejected', state: 'closed' };
  if (d.status === 'deferred') return { text: 'Put off for now', state: 'closed' };
  if (d.status === 'superseded') return { text: 'Replaced by a newer decision', state: 'closed' };

  if (approvedIds.length === 0) {
    return { text: waitingIds.length ? `Awaiting ${listNames(names(waitingIds))}` : 'Not yet approved', state: 'none' };
  }
  const options = new Set(approvedIds.map((id) => latest.get(id)!.option_id));
  if (options.size > 1) {
    const parts = approvedIds.map((id) => `${dir.nameOf(id)} chose “${optionLabel(data, latest.get(id)!.option_id) ?? 'a different option'}”`);
    return { text: `${listNames(parts)} — you chose differently, so talk it through`, state: 'disagree' };
  }
  const chosen = optionLabel(data, [...options][0]);
  if (waitingIds.length === 0) {
    return { text: `Approved by ${listNames(names(approvedIds))}${chosen ? ` · “${chosen}”` : ''}`, state: 'agreed' };
  }
  return { text: `Approved by ${listNames(names(approvedIds))} · awaiting ${listNames(names(waitingIds))}`, state: 'partial' };
}

/** True when this person is expected to approve and has not yet. */
export function needsMyApproval(d: Decision, dir: Directory): boolean {
  if (d.status !== 'open' && d.status !== 'proposed') return false;
  const me = dir.me?.id;
  if (!me) return false;
  if (!requiredApproverIds(d, dir).includes(me)) return false;
  return !(d.data?.approvals ?? []).some((a) => a.person_id === me);
}

/** Kept for screens that have not moved to `decisionStatusWords` yet. Shows the one allowed chip. */
export function YourTurnTag({ decision, dir }: { decision: Decision; dir: Directory }) {
  if (!needsMyApproval(decision, dir)) return null;
  return (
    <Chip tone="turn" small>
      Your turn
    </Chip>
  );
}

/* ------------------------------------------------------------------ whose turn, in words */

/** Is the decision still waiting for a choice (and not recorded as decided in the plan)? */
export function isOpenDecision(d: Pick<Decision, 'status' | 'data'>): boolean {
  return (d.status === 'open' || d.status === 'proposed') && !recordedDecision(d);
}

/** `turnInfo` with the required approvers filled in (an empty list means every adult must agree). */
export function decisionTurn(d: Decision, meId: string | null | undefined, dir: Directory): TurnInfo<Decision> {
  const required = requiredApproverIds(d, dir);
  const shaped = { status: recordedDecision(d) ? 'approved' : d.status, data: { ...(d.data ?? {}), required_approvers: required } };
  return { ...turnInfo(shaped, meId ?? null), record: d };
}

export type DecisionStatusKind = 'my-turn' | 'waiting' | 'decided' | 'put-off' | 'not-doing' | 'replaced';

export interface DecisionStatus {
  /** The words, e.g. "Jun chose. Your turn". */
  text: string;
  kind: DecisionStatusKind;
  turn: DecisionTurn;
  icon: IconName;
}

/** Whose turn it is, or how the decision ended, in the words the whole app uses. */
export function decisionStatus(d: Decision, meId: string | null | undefined, dir: Directory): DecisionStatus {
  if (recordedDecision(d) || d.status === 'approved') return { text: 'Decided', kind: 'decided', turn: 'none', icon: 'check' };
  if (d.status === 'deferred') return { text: 'Put off', kind: 'put-off', turn: 'none', icon: 'hourglass' };
  if (d.status === 'rejected') return { text: 'Not doing this', kind: 'not-doing', turn: 'none', icon: 'x' };
  if (d.status === 'superseded') return { text: 'Replaced', kind: 'replaced', turn: 'none', icon: 'x' };
  const t = decisionTurn(d, meId, dir);
  const other = t.otherId ? dir.nameOf(t.otherId) : null;
  switch (t.turn) {
    case 'mine_first':
      return { text: 'Your turn', kind: 'my-turn', turn: t.turn, icon: 'arrow-right' };
    case 'mine_after_partner':
      return { text: `${other ?? 'They'} chose. Your turn`, kind: 'my-turn', turn: t.turn, icon: 'arrow-right' };
    case 'disagree':
      return { text: 'You chose differently', kind: 'my-turn', turn: t.turn, icon: 'alert' };
    case 'waiting_partner': {
      const waitingFor = requiredApproverIds(d, dir).filter((id) => id !== meId && !(d.data?.approvals ?? []).some((a) => a.person_id === id));
      return { text: `Waiting for ${listNames(waitingFor.map((id) => dir.nameOf(id))) || 'the others'}`, kind: 'waiting', turn: t.turn, icon: 'clock' };
    }
    default: {
      // I am not one of the people who choose (or nobody is signed in): say who it is waiting for.
      const waitingFor = requiredApproverIds(d, dir).filter((id) => !(d.data?.approvals ?? []).some((a) => a.person_id === id));
      return { text: waitingFor.length ? `Waiting for ${listNames(waitingFor.map((id) => dir.nameOf(id)))}` : 'Waiting', kind: 'waiting', turn: 'none', icon: 'clock' };
    }
  }
}

/** Status words only. For other packages (Home rows, record pages). */
export function decisionStatusWords(d: Decision, meId: string | null | undefined, dir: Directory): string {
  return decisionStatus(d, meId, dir).text;
}

/** "Jun chose Set firm limits. Agree?" when the other adult already chose and it is my turn; otherwise null. */
export function partnerChoiceLine(d: Decision, meId: string | null | undefined, dir: Directory, lookup?: KeyLookup): string | null {
  const t = decisionTurn(d, meId, dir);
  if (t.turn !== 'mine_after_partner' || !t.otherId || !t.otherOptionId) return null;
  const o = d.data?.options?.find((x) => x.id === t.otherOptionId);
  if (!o) return null;
  return `${dir.nameOf(t.otherId)} chose ${shortLabel(plainOptionLabel(d, o, lookup), 6)}. Agree?`;
}

/* ------------------------------------------------------------------ the options */

/** The suggested option first, then the rest in their recorded order. */
export function orderedOptions(d: Pick<Decision, 'data'>): DecisionOption[] {
  const options = d.data?.options ?? [];
  const rec = d.data?.recommended_option_id;
  const first = options.filter((o) => o.id === rec);
  return [...first, ...options.filter((o) => o.id !== rec)];
}

/**
 * Which option starts selected on the card. Mine if I already chose. If the other adult chose something other than the
 * suggestion, nothing: selecting the suggestion would silently disagree with them. Otherwise the suggestion (or the only
 * option).
 */
export function initialChoice(d: Decision, meId: string | null | undefined, dir: Directory): string | null {
  const options = d.data?.options ?? [];
  if (options.length === 0) return null;
  if (options.length === 1) return options[0]!.id;
  const t = decisionTurn(d, meId, dir);
  const has = (id: string | null | undefined) => !!id && options.some((o) => o.id === id);
  if (has(t.myOptionId)) return t.myOptionId;
  const rec = d.data?.recommended_option_id ?? null;
  if (has(t.otherOptionId) && t.otherOptionId !== rec) return null;
  return has(rec) ? rec : null;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'or', 'but', 'the', 'to', 'of', 'for', 'with', 'in', 'on', 'at', 'by', 'from', 'until', 'than', 'that', 'we', 'our', 'is', 'are', 'be']);

/** The first few words of a label, with "…" when cut. */
export function shortLabel(label: string, maxWords = 5): string {
  const clean = label.replace(/\s+/g, ' ').trim().replace(/[.;:,\s]+$/, '');
  const words = clean.split(' ');
  if (words.length <= maxWords) return clean;
  const cut = words.slice(0, maxWords);
  // Never end on a joining word ("Check what Avery does and…").
  while (cut.length > 2 && SMALL_WORDS.has(cut[cut.length - 1]!.toLowerCase().replace(/[.;:,]+$/, ''))) cut.pop();
  return `${cut.join(' ').replace(/[.;:,]+$/, '')}…`;
}

/** The main button: "Agree: <the first words of the chosen option>". */
export function agreeLabel(label: string | null | undefined): string {
  return label ? `Agree: ${shortLabel(label)}` : 'Agree';
}

/* ------------------------------------------------------------------ when it is needed */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/gi;

/** Calendar dates written in a sentence ("November 11, 2026", "Nov 11", "2026-11-11"). A date without a year takes today's. */
export function datesIn(text: string, today: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) if (isCivilDate(m[1])) out.push(m[1]!);
  for (const m of text.matchAll(MONTH_RE)) {
    const mi = MONTHS.findIndex((name) => name.startsWith(m[1]!.toLowerCase().slice(0, 3)));
    const year = m[3] ?? today.slice(0, 4);
    const iso = `${year}-${String(mi + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
    if (mi >= 0 && isCivilDate(iso)) out.push(iso);
  }
  return out;
}

/**
 * The "needed when" text of a decision without a date, cleaned for one line: codes removed, and any part that names a
 * date already past is dropped (it must not read as upcoming). Null when nothing is left.
 */
export function triggerLine(trigger: string | null | undefined, today: string, lookup?: KeyLookup): string | null {
  const text = stripCodes(trigger ?? '', lookup);
  if (!text) return null;
  const parts = text
    .split(/\s*;\s*|\.\s+/)
    .map((p) => p.trim().replace(/\.$/, ''))
    .filter((p) => p && !(isCivilDate(today) && datesIn(p, today).some((d) => diffDays(today, d) < 0)));
  if (parts.length === 0) return null;
  const line = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ');
  return line;
}

/* ------------------------------------------------------------------ undo / reopen */

/** Days after settling during which a decided, put-off or rejected decision can be reopened. Matches the server. */
export const REOPEN_DAYS = 7;

/** When the decision was settled, as best the record says (the server checks its own audit trail). */
export function settledAtOf(d: Pick<Decision, 'status' | 'data' | 'updated_at'>): string | null {
  if (d.status === 'approved' && d.data?.decided_at) return d.data.decided_at;
  return d.updated_at ?? null;
}

/** True while "Reopen" may be offered: a closed decision settled within the last 7 days. */
export function canReopen(d: Pick<Decision, 'status' | 'data' | 'updated_at'>, now: Date = new Date()): boolean {
  if (d.status !== 'approved' && d.status !== 'rejected' && d.status !== 'deferred') return false;
  if (recordedDecision(d)) return false;
  const at = settledAtOf(d);
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= REOPEN_DAYS * 86_400_000;
}

/* ------------------------------------------------------------------ one compact row for other screens */

export interface DecisionRowProps {
  d: Decision;
  dir: Directory;
  lookup?: KeyLookup;
  /** Called instead of following the link (for example to open the card in place). */
  onOpen?: (d: Decision) => void;
  /** Where the row links to. Default: the decision on the Decide screen. */
  to?: string;
}

/** Where a decision lives on the Decide screen. */
export function decisionHref(d: Decision): string {
  return `${isOpenDecision(d) ? '/decide' : '/decide/decided'}#decision-${encodeURIComponent(d.key)}`;
}

/**
 * One line for a decision: the question (or title), its status words, and a way to open it. Render inside a list.
 * Exported for Home and the record pages.
 */
export function DecisionRow({ d, dir, lookup, onOpen, to }: DecisionRowProps) {
  const status = decisionStatus(d, dir.me?.id, dir);
  const text = displayQuestion(d, lookup) ?? displayTitle(d, lookup);
  const mine = status.kind === 'my-turn';
  return (
    <li className={`drow${mine ? ' drow--mine' : ''}`}>
      {onOpen ? (
        <button type="button" className="drow__open" onClick={() => onOpen(d)}>
          {text}
        </button>
      ) : (
        <Link className="drow__open" to={to ?? decisionHref(d)}>
          {text}
        </Link>
      )}
      <span className={`drow__status drow__status--${status.kind}`}>
        <Icon name={status.icon} size={14} />
        <span>{status.text}</span>
      </span>
    </li>
  );
}
