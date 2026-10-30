/**
 * Real workbook package → normalized ImportBundle (deterministic for identical inputs).
 *
 * All household specifics (names, aliases, timezone, baseline dates) come from the parsed workbook and from the
 * optional private `household-overrides.json`; nothing about a particular household lives in this file.
 *
 * Mapping decisions that involve judgement are collected in `validation.notes` and are summarized in the private
 * reconciliation report. Heuristic fields (traveler_scope, phase, workstream_key, provisional gates) are provisional:
 * reviewed values replace them through corrections.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { addCalendarDays, compareCivil, diffDays, isCivilDate } from '../shared/dates';
import type { TravelerGateConfig } from '../shared/engine-contracts';
import type {
  AnchorData,
  ArrivalData,
  ContactData,
  CostData,
  CostPhase,
  CostSection,
  Currency,
  Deadline,
  DeadlineKind,
  DeadlineRuleData,
  DecisionData,
  DocumentData,
  EvidenceData,
  ExistingCommitmentData,
  FundingData,
  FutureOptionData,
  HorizonData,
  IanaZone,
  ImportBundle,
  InventoryData,
  MilestoneData,
  Money,
  PhaseKey,
  PropertyData,
  QuestionData,
  RecordType,
  RiskData,
  TaskLink,
  TravelerAnchorCodes,
  WorkStatus,
  WorkstreamData,
} from '../shared/types';
import { clean, findIds, PeopleIndex, parseDependencies, parseOwner, splitList, type ParsedPerson } from './text';
import { fileEntry, mapDisposition, readCoverage, readCrosswalk, readOverrides, sidecarPaths, type CoverageRow, type CrosswalkRow, type FileEntry, type Overrides } from './sidecars';
import { slugify } from './util';
import { table, type Raw, type TableRow } from './workbook';
import { civilAt, readWorkbook } from './xlsx';

type BundleRecord = ImportBundle['records'][number];

export const EXPECTED_COUNTS: Record<string, number> = {
  milestone: 71,
  workstream: 29,
  question: 78,
  decision: 23,
  risk: 18,
  document: 37,
  cost: 49,
  arrival: 15,
  evidence: 57,
};

/** Source Status text (Milestones column E) → normalized WorkStatus. Documented in the reconciliation report. */
export const MILESTONE_STATUS_MAP: Record<string, WorkStatus> = {
  Answered: 'completed',
  Waiting: 'blocked',
  'Waiting — repo unavailable here': 'blocked',
  Proposed: 'planned',
  Question: 'planned',
  'Existing; verify': 'in_progress',
  'Deferred — conditional': 'planned',
  'Not established': 'planned',
  'No arrangements yet': 'planned',
  'Template prepared; inputs missing': 'in_progress',
  'Recommendation ready': 'in_progress',
  'Draft ready; repo evidence pending': 'in_progress',
};

export interface ParseOptions {
  overridesPath?: string;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function srcRef(row: TableRow, fileName: string, sha: string, label: string): NonNullable<BundleRecord['source']> {
  return {
    import_run_id: '',
    file: fileName,
    sheet: row.sheet,
    row: row.row,
    cell_range: row.range,
    file_sha256: sha,
    source_label: label,
    raw: row.raw as Raw,
  };
}

/** Only ID-shaped tokens (e.g. 'P01', 'TA07'); free-text source labels stay in the preserved raw row. */
function idTokens(text: string | null): string[] {
  return splitList(text, /[;,]/).filter((t) => /^[A-Za-z]+\d*$/.test(t) && /\d/.test(t) || /^BRIEF$/i.test(t));
}

function instantOf(civil: string | null | undefined): string {
  return `${civil && isCivilDate(civil) ? civil : '1970-01-01'}T00:00:00Z`;
}

function zoneOfAnchor(code: string, role: string | null): IanaZone {
  if (code === 'D' || role === 'departure') return 'Pacific/Honolulu';
  return 'Asia/Tokyo';
}

function moneyIf(amount: number | null, currency: Currency): Money | null {
  return amount === null ? null : { amount, currency };
}

interface MilestoneDraft {
  row: TableRow;
  key: string;
  title: string;
  ownerText: string | null;
  sourceStatus: string;
  data: MilestoneData;
  owner: ReturnType<typeof parseOwner>;
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

export function parseSourcePackage(dir: string, opts: ParseOptions = {}): ImportBundle {
  const paths = sidecarPaths(dir);
  const overridesPath = opts.overridesPath ?? [paths.overrides, join(dir, 'household-overrides.json')].find((p) => existsSync(p)) ?? paths.overrides;
  const notes: string[] = [];

  /* ---------- files ---------- */
  const files: FileEntry[] = [];
  const addFile = (path: string, required: boolean, name?: string): FileEntry | null => {
    if (!existsSync(path)) {
      if (required) throw new Error(`Required source file is missing: ${basename(path)} (looked in ${dirname(path)})`);
      return null;
    }
    const entry = fileEntry(path, name);
    files.push(entry);
    return entry;
  };
  const workbookFile = addFile(paths.workbook, true) as FileEntry;
  addFile(paths.crosswalk, false);
  addFile(paths.coverage, false);
  addFile(paths.verification, false);
  addFile(paths.pdf, false);
  addFile(paths.handoff, false);
  addFile(overridesPath, false, 'household-overrides.json');
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const wb = readWorkbook(readFileSync(paths.workbook));
  const crosswalk: CrosswalkRow[] = existsSync(paths.crosswalk) ? readCrosswalk(paths.crosswalk) : [];
  const coverage: CoverageRow[] = existsSync(paths.coverage) ? readCoverage(paths.coverage) : [];
  if (crosswalk.length === 0) notes.push('No roadmap-queue crosswalk was found; no task links were created.');
  if (coverage.length === 0) notes.push('No questionnaire coverage file was found; question dispositions use the workbook status only.');
  const overrides: Overrides = readOverrides(overridesPath);
  const sourceLabel = overrides.plan_baseline?.source_label ?? 'Imported workbook';

  const mk = (
    type: RecordType,
    key: string,
    title: string,
    status: string,
    data: object,
    row: TableRow | null,
    extra: { owner?: string | null; owner_proposed?: boolean } = {},
  ): BundleRecord => ({
    id: `${type}:${key}`,
    type,
    key,
    title,
    status,
    owner: extra.owner ?? null,
    owner_proposed: extra.owner_proposed ?? false,
    visibility: 'household',
    created_by: 'import',
    data: data as Record<string, unknown>,
    source: row ? srcRef(row, basename(paths.workbook), workbookFile.sha256, sourceLabel) : null,
  });

  /* ---------- evidence keys (for reference checks and staleness) ---------- */
  const evidenceRows = table(wb, 'evidence');
  const evidenceKeys = new Set(evidenceRows.map((r) => r.t('A') as string));

  /* ---------- people and anchors (Dates sheet) ---------- */
  const anchorRows = table(wb, 'dates_anchors');
  interface PersonDraft { name: string; anchors: Partial<TravelerAnchorCodes> }
  const drafts = new Map<string, PersonDraft>();
  const anchorOwner = new Map<string, string>(); // anchor code → person id | 'household'
  const roleOf = new Map<string, keyof TravelerAnchorCodes>();
  for (const r of anchorRows) {
    const code = r.t('A') as string;
    const meaning = r.t('B') ?? code;
    if (/^household\b/i.test(meaning) || code === 'T' || code === 'D') {
      anchorOwner.set(code, 'household');
      continue;
    }
    const m = /^(.+?)\s+(arrival|departure(?:\s*\/.*)?|residence established|NHI eligibility begins|Category I pension eligibility)\s*$/i.exec(meaning);
    if (!m) {
      notes.push(`Dates anchor ${code} ("${meaning}") does not name a traveler; treated as a household anchor.`);
      anchorOwner.set(code, 'household');
      continue;
    }
    const name = (m[1] as string).trim();
    const what = (m[2] as string).toLowerCase();
    const role: keyof TravelerAnchorCodes = what.startsWith('arrival') ? 'arrival' : what.startsWith('departure') ? 'departure' : what.startsWith('residence') ? 'residence' : what.startsWith('nhi') ? 'health_eligibility' : 'pension_eligibility';
    const id = slugify(name);
    const d = drafts.get(id) ?? { name, anchors: {} };
    d.anchors[role] = code;
    drafts.set(id, d);
    anchorOwner.set(code, id);
    roleOf.set(code, role);
  }

  const people: ParsedPerson[] = [];
  for (const [id, d] of drafts) {
    const ov = overrides.people[id];
    const adult = !!(d.anchors.residence || d.anchors.health_eligibility || d.anchors.pension_eligibility);
    if (!d.anchors.arrival || !d.anchors.departure) notes.push(`Traveler "${d.name}" is missing an arrival or departure anchor in the Dates sheet.`);
    people.push({
      id,
      display_name: ov?.display_name ?? d.name,
      kind: adult ? 'adult' : 'pet',
      aliases: ov?.aliases ?? [],
      descriptor: ov?.descriptor ?? null,
      anchors: {
        arrival: d.anchors.arrival ?? '',
        departure: d.anchors.departure ?? '',
        ...(adult ? { residence: d.anchors.residence ?? null, health_eligibility: d.anchors.health_eligibility ?? null, pension_eligibility: d.anchors.pension_eligibility ?? null } : {}),
      },
    });
  }
  const pidx = new PeopleIndex(people);
  const personName = (id: string): string => people.find((p) => p.id === id)?.display_name ?? id;

  const datesSheet = wb.sheet('Dates');
  const anchorRecords: BundleRecord[] = [];
  const anchorMap = new Map<string, AnchorData>();
  const applicability = new Map<string, string | null>();
  for (const r of anchorRows) {
    const code = r.t('A') as string;
    const owner = anchorOwner.get(code) ?? 'household';
    const role = roleOf.get(code) ?? null;
    const date = civilAt(datesSheet, `C${r.row}`);
    const data: AnchorData = {
      code,
      traveler: owner,
      meaning: r.t('B') ?? code,
      date,
      timezone: zoneOfAnchor(code, role),
      confidence: date ? 'tentative' : 'awaiting',
      evidence: null,
      coordination_only: owner === 'household',
    };
    anchorMap.set(code, data);
    applicability.set(code, r.t('D'));
    anchorRecords.push(mk('anchor', code, data.meaning, data.confidence, data, r));
  }

  /* ---------- evidence ---------- */
  const reviewedOn = overrides.plan_baseline?.reviewed_on ?? overrides.plan_baseline?.baseline_on ?? evidenceRows.map((r) => r.t('D')).filter((d): d is string => !!d && isCivilDate(d)).sort(compareCivil).pop() ?? null;
  const baselineOn = overrides.plan_baseline?.baseline_on ?? reviewedOn;
  const evidenceRecords = evidenceRows.map((r) => {
    const checked = r.t('D') && isCivilDate(r.t('D') as string) ? (r.t('D') as string) : null;
    // Stale only on age: checked more than 90 days before the plan's review date. The refresh trigger is shown, not scored.
    const stale = !!(checked && reviewedOn && diffDays(checked, reviewedOn) > 90);
    const data: EvidenceData = {
      url_or_reference: r.t('C') ?? '',
      checked_on: checked,
      access: r.t('E') ?? '',
      supported_scope: r.t('F') ?? '',
      refresh_trigger: r.t('G') ?? '',
      stale,
      superseded_by: null,
    };
    return mk('evidence', r.t('A') as string, r.t('B') ?? (r.t('A') as string), stale ? 'stale' : 'current', data, r);
  });

  /* ---------- milestones: pass 1 ---------- */
  const msRows = table(wb, 'milestones');
  const msKeys = new Set(msRows.map((r) => r.t('A') as string));
  const crossById = new Map(crosswalk.map((c) => [c.id, c]));
  const danglingRefs: ImportBundle['validation']['dangling_refs'] = [];

  const drafts71: MilestoneDraft[] = msRows.map((r) => {
    const key = r.t('A') as string;
    const title = r.t('C') ?? key;
    const ownerText = r.t('D');
    const owner = parseOwner(ownerText, pidx);
    const sourceStatus = r.t('E') ?? '';
    const reviewRaw = r.t('G');
    const parsedDeps = parseDependencies(r.t('J'), key, msKeys, pidx);
    for (const ref of parsedDeps.dangling) danglingRefs.push({ record: `milestone:${key}`, field: 'data.dependencies', ref });
    const { dependencies: deps, scope, note } = parsedDeps;
    const crossRow = crossById.get(key);
    const workArea = r.t('B') ?? '';
    const optional = sourceStatus === 'Deferred — conditional';
    const mentioned = [...new Set([...pidx.mentioned(title), ...pidx.mentioned(workArea)].map((p) => p.id))];
    const eachAdult = /\b(both|each)\s+(adult|adults|passports?)\b/i.test(title);
    const travelerScope = new Set<string>(mentioned);
    if (eachAdult) for (const a of pidx.adults) travelerScope.add(a.id);
    const data: MilestoneData = {
      work_area: workArea,
      workstream_key: null,
      next_action: r.t('F') ?? '',
      source_status: sourceStatus,
      status_reason: null,
      completion_criteria: r.t('K') ?? '',
      completion_evidence: [],
      contingency: r.t('L') ?? '',
      collaborators: owner.collaborators,
      priority: null,
      effort_estimate: null,
      dependencies: deps,
      dependency_note: note,
      review_date: reviewRaw && isCivilDate(reviewRaw) ? reviewRaw : null,
      target_window: r.t('H') ?? '',
      deadline: null,
      traveler_scope: [...travelerScope],
      phase: null,
      optional_future_work: optional,
      conditional: optional ? (r.t('I') ?? r.t('H')) : null,
      parent_key: null,
      queue_disposition: crossRow?.disposition || null,
      linked_task_ids: (crossRow?.links ?? []).map((l) => `tl-snapshot-${l.id}`),
      source_ids: idTokens(r.t('M')),
      due_basis: r.t('I'),
    };
    if (Object.keys(scope).length > 0) data.dependency_scope = scope;
    return { row: r, key, title, ownerText, sourceStatus, data, owner };
  });
  const draftByKey = new Map(drafts71.map((d) => [d.key, d]));

  /* ---------- statuses (pass 2) ---------- */
  const statusOf = new Map<string, WorkStatus>();
  for (const d of drafts71) {
    let s = MILESTONE_STATUS_MAP[d.sourceStatus];
    if (!s) {
      s = 'planned';
      notes.push(`Milestone ${d.key}: unrecognized source status "${d.sourceStatus}" was mapped to planned.`);
    }
    statusOf.set(d.key, s);
  }
  for (const d of drafts71) {
    const status = statusOf.get(d.key) as WorkStatus;
    if (status === 'blocked') {
      const unmet = d.data.dependencies.filter((k) => statusOf.get(k) !== 'completed');
      const titles = unmet.map((k) => draftByKey.get(k)?.title ?? k);
      if (/repo(sitory)? unavailable/i.test(d.sourceStatus)) {
        d.data.status_reason = 'The source plan says the local repository was unavailable.' + (titles.length ? ` Also waiting on: ${titles.join('; ')}.` : '');
      } else if (titles.length > 0) {
        d.data.status_reason = `Waiting on: ${titles.join('; ')}.`;
      } else if (d.data.dependency_note) {
        d.data.status_reason = `Waiting on: ${d.data.dependency_note}.`;
      } else {
        d.data.status_reason = 'Waiting on facts the source plan has not established yet.';
      }
    }
    if (status === 'completed') {
      d.data.completion_evidence = [
        {
          at: instantOf(baselineOn),
          by: 'import',
          summary: `Recorded as "${d.sourceStatus}" in the source plan (${basename(paths.workbook)}, ${d.row.sheet} row ${d.row.row}). ${d.data.completion_criteria}`.trim(),
          link: null,
        },
      ];
    }
  }

  /* ---------- workstream derivation (provisional) ---------- */
  const wsRows = table(wb, 'workstreams');
  const wsKeys = new Set(wsRows.map((r) => r.t('A') as string));
  const qRows = table(wb, 'questionnaire');
  const covById = new Map(coverage.map((c) => [c.id, c]));
  const votes = new Map<string, Map<string, number>>();
  for (const q of qRows) {
    const ws = covById.get(q.t('A') as string)?.workstream ?? q.t('B');
    if (!ws) continue;
    const blob = [q.t('C'), q.t('E'), q.t('F'), q.t('I'), q.t('J'), covById.get(q.t('A') as string)?.local_note].filter(Boolean).join(' ');
    for (const w of findIds(blob, 'W', 2)) {
      const m = votes.get(w) ?? new Map<string, number>();
      m.set(ws, (m.get(ws) ?? 0) + 1);
      votes.set(w, m);
    }
  }
  // The Workstreams 'Dependencies' cell sometimes names milestones directly; that is an explicit mapping.
  const explicitWs = new Map<string, string>();
  for (const w of table(wb, 'workstreams')) for (const id of findIds(w.t('G'), 'W', 2)) if (!explicitWs.has(id)) explicitWs.set(id, w.t('A') as string);
  for (const d of drafts71) {
    const explicit = explicitWs.get(d.key);
    if (explicit) {
      d.data.workstream_key = explicit;
      continue;
    }
    const m = votes.get(d.key);
    if (!m) continue;
    const ranked = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (ranked.length === 1 || (ranked[0] && ranked[1] && ranked[0][1] > ranked[1][1])) d.data.workstream_key = ranked[0]?.[0] ?? null;
  }

  /* ---------- deadline rules (Dates!G37:K54) ---------- */
  const ruleRows = table(wb, 'dates_rules');
  const ruleRecords: BundleRecord[] = [];
  const ruleInfo: { key: string; anchor: string; signed: number; unit: 'calendar_days' | 'calendar_months'; kind: DeadlineKind; traveler: string }[] = [];
  for (const r of ruleRows) {
    const label = r.t('G') as string;
    const anchorCode = r.t('H') ?? '';
    const basis = r.t('I') ?? '';
    const formula = datesSheet.cells.get(`J${r.row}`)?.formula ?? '';
    let signed: number | null = null;
    let unit: 'calendar_days' | 'calendar_months' = 'calendar_days';
    const edate = /EDATE\(\s*[A-Z]+\d+\s*,\s*(-?\d+)\s*\)/i.exec(formula);
    const plus = /\+\(\s*(-?\d+)\s*\)/.exec(formula);
    if (edate) {
      signed = Number(edate[1]);
      unit = 'calendar_months';
    } else if (plus) {
      signed = Number(plus[1]);
    }
    if (signed === null) {
      notes.push(`Dates rule "${label}": could not read an offset from its formula; the rule was skipped.`);
      continue;
    }
    const anchor = anchorMap.get(anchorCode);
    if (!anchor) {
      notes.push(`Dates rule "${label}": anchor ${anchorCode} is not defined; the rule was skipped.`);
      continue;
    }
    const traveler = anchor.traveler;
    const lowerBasis = basis.toLowerCase();
    let kind: DeadlineKind = lowerBasis.startsWith('official') || lowerBasis.startsWith('within') ? 'legal' : 'internal_target';
    if (anchor.coordination_only) kind = 'internal_target'; // household helpers never carry a legal deadline
    const sourceIds = splitList(r.t('K'), /[;,]/).filter((s) => /^[A-Z]+\d+$/.test(s));
    const app = (applicability.get(anchorCode) ?? '').toLowerCase();
    const key = `RULE-${slugify(label).toUpperCase()}`;
    const data: DeadlineRuleData = {
      label,
      traveler_scope: traveler,
      anchor: anchorCode,
      anchor_role: null,
      offset: Math.abs(signed),
      unit,
      direction: signed < 0 ? 'before' : 'after',
      kind,
      jurisdiction: kind === 'legal' ? (anchor.timezone === 'Asia/Tokyo' ? 'JP' : null) : 'household',
      timezone: anchor.timezone,
      source_ids: sourceIds,
      source_url: null,
      verified_on: null,
      verification: 'not_verified',
      applies: app === 'applies' ? 'yes' : app === 'does not apply' || app === 'not applicable' ? 'no' : 'unknown',
      applies_when: basis,
      linked_records: [],
      notes: /internal proposal/i.test(r.t('K') ?? '') ? 'Internal proposal.' : null,
    };
    ruleRecords.push(mk('deadline_rule', key, label, 'active', data, r));
    ruleInfo.push({ key, anchor: anchorCode, signed, unit, kind, traveler });
  }

  /* ---------- milestone deadlines from the date-anchor columns (O/P) ---------- */
  const msSheet = wb.sheet('Milestones');
  const phaseOf = (d: MilestoneDraft, anchorOffset: number | null): PhaseKey | null => guessPhase(d, anchorOffset);
  for (const d of drafts71) {
    const code = msSheet.cells.get(`O${d.row.row}`)?.value;
    const off = msSheet.cells.get(`P${d.row.row}`)?.value;
    let anchorOffset: number | null = null;
    if (typeof code === 'string' && typeof off === 'number') {
      anchorOffset = off;
      const anchor = anchorMap.get(code);
      if (!anchor) {
        notes.push(`Milestone ${d.key}: date anchor "${code}" is not defined in the Dates sheet; no deadline was set.`);
      } else {
        const rule = ruleInfo.find((x) => x.anchor === code && x.signed === off && x.unit === 'calendar_days');
        const basisText = d.data.target_window || d.data.due_basis || '';
        const household = anchor.coordination_only;
        let kind: DeadlineKind;
        if (household) kind = 'internal_target';
        else if (rule) kind = rule.kind;
        else if (/^official/i.test(d.data.due_basis ?? '')) kind = 'legal';
        else if (/review date is a proposal/i.test(d.data.due_basis ?? '')) kind = 'review_date';
        else kind = 'internal_target';
        const deadline: Deadline = {
          date: anchor.date ? addCalendarDays(anchor.date, off) : null,
          kind,
          basis: household ? `Household coordination helper — each traveler's own dates govern. ${basisText}`.trim() : basisText,
          source_ids: d.data.source_ids,
          jurisdiction: household ? 'household' : kind === 'legal' ? 'JP' : null,
          timezone: anchor.timezone,
          verified_on: null,
          traveler: household ? 'household' : anchor.traveler,
          rule_id: rule?.key ?? null,
          anchor: code,
          offset: off,
          unit: 'calendar_days',
        };
        d.data.deadline = deadline;
        if (rule) {
          const rec = ruleRecords.find((x) => x.key === rule.key);
          if (rec) (rec.data as unknown as DeadlineRuleData).linked_records.push(d.key);
        }
        if (!household && !d.data.traveler_scope.includes(anchor.traveler)) d.data.traveler_scope.push(anchor.traveler);
      }
    }
    d.data.phase = phaseOf(d, anchorOffset);
  }

  const milestoneRecords = drafts71.map((d) =>
    mk('milestone', d.key, d.title, statusOf.get(d.key) as WorkStatus, d.data, d.row, { owner: d.owner.owner, owner_proposed: d.owner.owner_proposed }),
  );

  /* ---------- existing commitments (Dates!G7:I15) ---------- */
  const commitRows = table(wb, 'dates_commitments');
  const dateCounts = new Map<string, number>();
  for (const d of drafts71) if (d.data.review_date) dateCounts.set(d.data.review_date, (dateCounts.get(d.data.review_date) ?? 0) + 1);
  const commonReview = [...dateCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const commitmentRecords = commitRows.map((r) => {
    const label = r.t('G') as string;
    const meaning = r.t('I') ?? '';
    const date = r.t('H') && isCivilDate(r.t('H') as string) ? (r.t('H') as string) : null;
    const lower = meaning.toLowerCase();
    let kind: DeadlineKind = 'estimate';
    let caution = 'A recorded date; confirm it before relying on it.';
    if (lower.startsWith('existing deadline')) {
      kind = 'user_committed';
      caution = 'An existing deadline from the source plan; the outcome is not verified here.';
    } else if (lower.includes('suggested window')) {
      kind = 'estimate';
      caution = 'A suggested window only; nothing is booked.';
    } else if (lower.startsWith('historical task date')) {
      kind = 'review_date';
      caution = 'An old task date. It does not show the work was left undone or is complete.';
    } else if (lower.startsWith('existing review') || lower.startsWith('verify current contract')) {
      kind = 'review_date';
      caution = 'A review checkpoint, not a contract deadline; verify the underlying terms.';
    } else if (lower.startsWith('recorded date')) {
      kind = 'estimate';
      caution = 'A recorded date; the contract has not been verified.';
    }
    const linked = date && date !== commonReview ? drafts71.filter((d) => d.data.review_date === date).map((d) => d.key) : [];
    const data: ExistingCommitmentData = { recorded_date: date, meaning, deadline_kind: kind, evidence_caution: caution, linked_records: linked };
    return mk('existing_commitment', `EC-${slugify(label).toUpperCase()}`, label, 'open', data, r);
  });

  /* ---------- workstreams ---------- */
  const workstreamRecords = wsRows.map((r) => {
    const key = r.t('A') as string;
    const sourceStatus = r.t('D') ?? '';
    const status = workstreamStatus(sourceStatus);
    const rel = splitList(r.t('G'), ';').filter((x) => !/^none$/i.test(x));
    const related: string[] = [];
    const relNotes: string[] = [];
    for (const token of rel) {
      const ids = [...findIds(token, 'S', 2), ...findIds(token, 'W', 2)];
      if (ids.length === 0) {
        relNotes.push(token);
        continue;
      }
      for (const id of ids) {
        if (wsKeys.has(id) || msKeys.has(id)) {
          if (!related.includes(id)) related.push(id);
        } else danglingRefs.push({ record: `workstream:${key}`, field: 'data.related', ref: id });
      }
      if (!/^[SW]\d{2}$/.test(token)) relNotes.push(token);
    }
    const owner = parseOwner(r.t('C'), pidx);
    const data: WorkstreamData = {
      next_action: r.t('E') ?? '',
      done_evidence: r.t('F') ?? '',
      source_status: sourceStatus,
      status_reason: status === 'blocked' ? sourceStatus : null,
      related,
      related_note: relNotes.length ? relNotes.join('; ') : null,
      milestone_keys: drafts71.filter((d) => d.data.workstream_key === key).map((d) => d.key),
      question_keys: qRows.filter((q) => (covById.get(q.t('A') as string)?.workstream ?? q.t('B')) === key).map((q) => q.t('A') as string),
      collaborators: owner.collaborators,
    };
    return mk('workstream', key, r.t('B') ?? key, status, data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed });
  });

  /* ---------- questions ---------- */
  const questionRecords = qRows.map((r) => {
    const key = r.t('A') as string;
    const cov = covById.get(key);
    const sourceDisposition = r.t('D') ?? '';
    const local = mapDisposition(cov?.disposition);
    const fromWorkbook = mapDisposition(sourceDisposition === 'Answered' ? 'already answered' : sourceDisposition);
    const disposition = local ?? fromWorkbook ?? 'question';
    if (!local && cov) notes.push(`Question ${key}: coverage disposition "${cov.disposition}" was not recognized; the workbook status was used.`);
    const owner = parseOwner(r.t('G'), pidx);
    const blob = [r.t('C'), r.t('E'), r.t('F'), r.t('J'), cov?.local_note].filter(Boolean).join(' ');
    const relevance = [...findIds(blob, 'W', 2).filter((w) => msKeys.has(w)), ...pidx.mentioned(blob).map((p) => p.id)];
    const data: QuestionData = {
      workstream_key: cov?.workstream ?? r.t('B'),
      topic: r.t('C') ?? '',
      disposition,
      source_disposition: sourceDisposition,
      local_disposition: cov?.disposition ?? null,
      known: r.t('E') ?? '',
      question: r.t('F') ?? '',
      when_trigger: r.t('H') ?? '',
      evidence_basis: r.t('I') ?? '',
      answer: r.t('J'),
      local_note: cov?.local_note ? cov.local_note : null,
      relevance: [...new Set(relevance)],
    };
    const status = disposition === 'already_answered' ? 'answered' : disposition === 'not_applicable' ? 'not_applicable' : disposition === 'explicitly_excluded' ? 'excluded' : 'open';
    if (data.workstream_key && !wsKeys.has(data.workstream_key)) danglingRefs.push({ record: `question:${key}`, field: 'data.workstream_key', ref: data.workstream_key });
    return mk('question', key, data.topic || key, status, data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed });
  });

  /* ---------- decisions ---------- */
  const adultIds = pidx.adults.map((a) => a.id);
  const decisionRecords = table(wb, 'decisions').map((r) => {
    const key = r.t('A') as string;
    const sourceStatus = r.t('H') ?? '';
    const lower = sourceStatus.toLowerCase();
    const state: 'open' | 'proposed' = lower.startsWith('open — proposed') ? 'proposed' : lower.startsWith('open') ? 'open' : 'proposed';
    const confirmed = /confirmed|permitted/i.test(sourceStatus);
    const depsText = r.t('F');
    const related = [...findIds(depsText, 'S', 2), ...findIds(depsText, 'W', 2), ...findIds(depsText, 'D', 2)];
    const owner = parseOwner(r.t('D'), pidx);
    const recText = r.t('C') ?? '';
    const data: DecisionData = {
      question: r.t('B') ?? key,
      options: [{ id: 'opt-1', label: recText, consequences: null, source: 'imported' }],
      recommended_option_id: 'opt-1',
      recommendation_text: recText,
      rationale: null,
      needed_by: null,
      trigger: r.t('E') ?? '',
      consequence_of_delay: null,
      dependencies: [],
      acceptance_evidence: r.t('G') ?? '',
      source_status: sourceStatus,
      required_approvers: adultIds,
      approvals: [],
      decided_option_id: null,
      decided_at: null,
      history_note: confirmed
        ? 'The source plan records this as confirmed in a household follow-up; no approval has been recorded in the app yet. Only the imported recommendation is shown; add alternatives when you have considered them.'
        : 'Only the imported recommendation is recorded. Add alternatives here when you have considered them.',
      related,
    };
    return mk('decision', key, data.question, state, data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed });
  });

  /* ---------- risks ---------- */
  const riskRecords = table(wb, 'risks').map((r) => {
    const key = r.t('A') as string;
    const sev = (r.t('H') ?? 'medium').toLowerCase();
    const severity: RiskData['severity'] = sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low' ? sev : 'medium';
    const owner = parseOwner(r.t('F'), pidx);
    const blob = [r.t('B'), r.t('C'), r.t('D'), r.t('E')].join(' ');
    const data: RiskData = {
      raid_kind: 'risk',
      trigger: r.t('C') ?? '',
      mitigation: r.t('D') ?? '',
      fallback: r.t('E') ?? '',
      review_basis: r.t('G') ?? '',
      severity,
      escalation_trigger: null,
      linked_records: findIds(blob, 'W', 2).filter((w) => msKeys.has(w)),
    };
    return mk('risk', key, r.t('B') ?? key, 'open', data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed });
  });

  /* ---------- documents ---------- */
  const documentRecords = table(wb, 'documents').map((r) => {
    const key = r.t('A') as string;
    const forWhom = r.t('C') ?? '';
    const scope = documentScope(forWhom, pidx);
    const owner = parseOwner(r.t('D'), pidx);
    const blob = [r.t('B'), r.t('E'), r.t('G')].join(' ');
    const data: DocumentData = {
      for_whom: forWhom,
      traveler_scope: scope,
      custodian: (r.t('D') ?? '').replace(/\s*\(proposed\)\s*/i, '').trim(),
      needed_by: r.t('E') ?? '',
      validity: r.t('F') ?? '',
      completion_criteria: r.t('G') ?? '',
      source_status: r.t('H') ?? '',
      privacy: r.t('I') ?? '',
      requested_at: null,
      received_at: null,
      reviewed_at: null,
      accepted_by_authority_at: null,
      accepted_by: null,
      expiry: null,
      refresh_trigger: null,
      link: null,
      linked_records: findIds(blob, 'W', 2).filter((w) => msKeys.has(w)),
    };
    // Lifecycle facts are never inferred from a status phrase; they start empty.
    return mk('document', key, r.t('B') ?? key, 'not_started', data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed });
  });

  /* ---------- costs ---------- */
  const costSheet = wb.sheet('Cost Inputs');
  const costRecords = table(wb, 'costs').map((r) => {
    const key = r.t('A') as string;
    const sourceSection = r.t('B') ?? '';
    let section: CostSection = sourceSection === 'One-time' ? 'one_time' : sourceSection === 'Tokyo monthly' ? 'tokyo_monthly' : sourceSection === 'US monthly' ? 'us_monthly' : 'one_time';
    if (!['One-time', 'Tokyo monthly', 'US monthly'].includes(sourceSection)) notes.push(`Cost ${key}: unrecognized section "${sourceSection}" was mapped to one_time.`);
    const description = r.t('D') ?? '';
    const category = r.t('C') ?? key;
    // A US monthly line that is explicitly about staged/overlapping living is a staged-overlap line.
    if (section === 'us_monthly' && /\bstaged\b|\boverlap/i.test(`${category} ${description}`)) section = 'staged_overlap';
    const app = (r.t('E') ?? 'Review').toLowerCase();
    const applicability: CostData['applicability'] = app === 'include' ? 'include' : app === 'exclude' ? 'exclude' : 'review';
    const quoteSource = r.t('O');
    const quoteDate = r.t('P') && isCivilDate(r.t('P') as string) ? (r.t('P') as string) : null;
    const usdQuote = r.n('F');
    const jpyQuote = r.n('G');
    const pair = (usd: number | null, jpy: number | null, what: string): Money | null => {
      if (usd !== null && jpy !== null) {
        notes.push(`Cost ${key}: both USD and JPY were entered for ${what}; only one currency per amount is allowed, so the amount was left unknown.`);
        return null;
      }
      return usd !== null ? moneyIf(usd, 'USD') : moneyIf(jpy, 'JPY');
    };
    const quoted = pair(usdQuote, jpyQuote, 'the quote');
    const unpaid = pair(r.n('I'), r.n('J'), 'the unpaid balance');
    const paid = pair(r.n('L'), r.n('M'), 'the paid amount');
    const stateText = (r.t('T') ?? 'Not committed').toLowerCase();
    const stateMap: Record<string, CostData['commitment_state']> = {
      'not committed': 'not_committed', estimate: 'estimate', quote: 'quote', quoted: 'quote', approved: 'approved_commitment', 'approved commitment': 'approved_commitment', paid: 'paid', 'partially paid': 'partially_paid',
    };
    const commitment = stateMap[stateText] ?? 'not_committed';
    const hasProvenance = !!(quoteSource && quoteDate);
    const phaseNote = r.t('W');
    const phaseEnd = r.t('X') && isCivilDate(r.t('X') as string) ? (r.t('X') as string) : null;
    const phase: CostPhase | null =
      section === 'staged_overlap' || phaseEnd || phaseNote
        ? { traveler: null, start_anchor: null, start_date: null, end_anchor: null, end_date: phaseEnd, months: null, note: phaseNote }
        : null;
    const refundable = (r.t('R') ?? 'Unknown').toLowerCase();
    const data: CostData = {
      section,
      source_section: sourceSection,
      category,
      description,
      applicability,
      exclusion_reason: applicability === 'exclude' ? r.t('V') : null,
      estimate: quoted && !hasProvenance ? quoted : null,
      quote: quoted && hasProvenance ? quoted : null,
      committed: null,
      paid,
      unpaid_balance: unpaid,
      payer: r.t('N') && !/^to confirm$/i.test(r.t('N') as string) ? r.t('N') : null,
      quote_source: quoteSource,
      quote_date: quoteDate,
      deposit_due: r.t('Q') && isCivilDate(r.t('Q') as string) ? (r.t('Q') as string) : null,
      refundable: refundable === 'yes' || refundable === 'no' || refundable === 'partial' ? refundable : 'unknown',
      uncertainty: r.t('S') ?? '',
      commitment_state: commitment,
      phase,
      duplication_check: phaseNote,
    };
    void costSheet;
    return mk('cost', key, category, commitment, data, r);
  });

  /* ---------- funding (Budget sheet inputs) ---------- */
  const budget = wb.sheet('Budget');
  const bt = (ref: string) => {
    const c = budget.cells.get(ref);
    if (!c || c.value === null) return null;
    return typeof c.value === 'string' ? clean(c.value) : null;
  };
  const bn = (ref: string) => {
    const c = budget.cells.get(ref);
    return c && typeof c.value === 'number' ? c.value : null;
  };
  const bd = (ref: string) => {
    const c = budget.cells.get(ref);
    return c && c.is_date && typeof c.value === 'string' ? c.value.slice(0, 10) : null;
  };
  const budgetRow = (rowNo: number, fakeRaw: Raw): TableRow => ({ sheet: 'Budget', row: rowNo, range: `B${rowNo}:C${rowNo}`, t: () => null, n: () => null, raw: fakeRaw });
  const fundingRecords: BundleRecord[] = [];
  const cashDate = bd('C11');
  const usdAmt = (v: number | null): Money | null => moneyIf(v, 'USD');
  fundingRecords.push(
    mk('funding', 'CASH', 'Current unrestricted cash', bn('C10') === null ? 'unknown' : 'recorded', { kind: 'cash_snapshot', person_id: null, amount: usdAmt(bn('C10')), as_of: cashDate, source: null, evidence: null } satisfies FundingData, budgetRow(10, { Item: 'Current unrestricted cash (USD)', Value: bn('C10'), 'Snapshot date': cashDate })),
    mk('funding', 'RESERVE', 'Return reserve', bn('C12') === null ? 'unknown' : 'recorded', { kind: 'return_reserve', person_id: null, amount: usdAmt(bn('C12')), as_of: cashDate, source: null, evidence: null } satisfies FundingData, budgetRow(12, { Item: 'Return reserve (USD)', Value: bn('C12') })),
    mk('funding', 'OTHER', 'Other unpaid commitments', bn('C13') === null ? 'unknown' : 'recorded', { kind: 'other_commitments', person_id: null, amount: usdAmt(bn('C13')), as_of: cashDate, source: null, evidence: null } satisfies FundingData, budgetRow(13, { Item: 'Other unpaid commitments (USD)', Value: bn('C13') })),
    mk('funding', 'FX', 'JPY per USD', bn('C6') === null ? 'unknown' : 'recorded', { kind: 'fx_rate', person_id: null, amount: null, jpy_per_usd: bn('C6'), as_of: bd('C7'), source: bt('F6'), evidence: null } satisfies FundingData, budgetRow(6, { Item: 'Base FX (JPY per USD)', Value: bn('C6'), 'FX source': bt('F6'), 'FX quote date': bd('C7') })),
  );
  for (const rowNo of [5, 6, 7, 8]) {
    const name = bt(`J${rowNo}`);
    if (!name || !pidx.resolve(name)) continue;
    const person = pidx.resolve(name) as ParsedPerson;
    const statusText = (bt(`K${rowNo}`) ?? '').toLowerCase();
    const income_status: NonNullable<FundingData['income_status']> = statusText.startsWith('planning zero') ? 'planning_zero' : statusText.startsWith('verified') ? 'verified_lawful' : statusText.startsWith('confirmed none') ? 'confirmed_none' : 'unverified';
    const usd = bn(`L${rowNo}`);
    const jpy = bn(`M${rowNo}`);
    const amount = usd !== null && jpy === null ? moneyIf(usd, 'USD') : jpy !== null && usd === null ? moneyIf(jpy, 'JPY') : null;
    fundingRecords.push(
      mk('funding', `INC-${person.id.toUpperCase()}`, `${person.display_name} earned income`, amount ? 'recorded' : 'unknown', { kind: 'income', person_id: person.id, amount, monthly: true, income_status, as_of: bd(`O${rowNo}`), source: bt(`N${rowNo}`), evidence: bt(`N${rowNo}`) } satisfies FundingData, budgetRow(rowNo, { Person: name, 'Income status': bt(`K${rowNo}`), 'Net earned USD / month': usd, 'Net earned JPY / month': jpy, 'Evidence source': bt(`N${rowNo}`), 'Evidence date': bd(`O${rowNo}`) })),
    );
  }

  /* ---------- arrival ---------- */
  const arrivalRecords = table(wb, 'arrival').map((r) => {
    const key = r.t('A') as string;
    const win = r.t('B') ?? '';
    const ownerText = r.t('E');
    const owner = parseOwner(ownerText, pidx);
    const petInWindow = pidx.mentioned(win, pidx.pets);
    const scope = petInWindow.length > 0 ? petInWindow.map((p) => p.id) : pidx.adults.map((a) => a.id);
    const data: ArrivalData = {
      window: win,
      window_key: arrivalWindowKey(win),
      trigger: r.t('C') ?? '',
      action: r.t('D') ?? '',
      traveler_scope: scope,
      dependencies: r.t('F') ?? '',
      completion_criteria: r.t('G') ?? '',
      source_ids: idTokens(r.t('H')),
      completion_evidence: [],
      status_reason: null,
      deadline: null,
    };
    const title = (r.t('D') ?? key).split(/(?<=[.!?])\s/)[0] ?? key;
    return mk('arrival', key, title.length > 120 ? `${title.slice(0, 117)}…` : title, 'planned', data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed });
  });

  /* ---------- horizon (Y01.. and EX01..) ---------- */
  const horizonRecords = table(wb, 'horizon').map((r) => {
    const key = r.t('A') as string;
    const trigger = r.t('B') ?? '';
    const cadence: HorizonData['cadence'] = /\bquarterly\b/i.test(trigger) ? 'quarterly' : /\bannual\b/i.test(trigger) ? 'annual' : /^(when|on the actual|during|around|after|at )/i.test(trigger) ? 'event' : null;
    const owner = parseOwner(r.t('D'), pidx);
    const data: HorizonData = {
      trigger,
      scope: r.t('C') ?? '',
      completion_criteria: r.t('E') ?? '',
      source_ids: idTokens(r.t('F')),
      milestone_links: splitList(r.t('G'), /[;,]/).filter((w) => msKeys.has(w)),
      cadence,
      deadline: null,
    };
    for (const w of splitList(r.t('G'), /[;,]/)) if (!msKeys.has(w)) danglingRefs.push({ record: `horizon:${key}`, field: 'data.milestone_links', ref: w });
    return mk('horizon', key, trigger.length > 120 ? `${trigger.slice(0, 117)}…` : trigger, 'planned', data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed });
  });
  const expiryRecords: BundleRecord[] = [];
  const expiryAnchors: BundleRecord[] = [];
  for (const r of table(wb, 'horizon_expiries')) {
    const key = r.t('A') as string;
    const label = r.t('B') ?? key;
    const actual = r.t('F') && isCivilDate(r.t('F') as string) ? (r.t('F') as string) : null;
    const m = /^(.+?)\s+residence-status expiry$/i.exec(label);
    const person = m ? pidx.resolve(m[1] as string) : null;
    let deadline: Deadline | null = null;
    if (person && person.kind === 'adult') {
      const arr = person.anchors.arrival;
      const code = `X${arr.length === 2 && arr.startsWith('T') ? arr.slice(1) : person.id.slice(0, 1).toUpperCase()}`;
      if (!anchorMap.has(code)) {
        const a: AnchorData = { code, traveler: person.id, meaning: label, date: actual, timezone: 'Asia/Tokyo', confidence: actual ? 'tentative' : 'awaiting', evidence: null, coordination_only: false };
        anchorMap.set(code, a);
        expiryAnchors.push(mk('anchor', code, label, a.confidence, a, r));
      }
      deadline = {
        date: actual ? addCalendarDays(actual, -120) : null,
        kind: 'internal_target',
        basis: r.t('E') ?? 'Internal review target: expiry minus 120 days.',
        source_ids: [],
        jurisdiction: 'household',
        timezone: 'Asia/Tokyo',
        verified_on: null,
        traveler: person.id,
        rule_id: null,
        anchor: code,
        offset: -120,
        unit: 'calendar_days',
      };
    }
    const data: HorizonData = {
      trigger: label,
      scope: r.t('C') ?? '',
      completion_criteria: r.t('E') ?? '',
      source_ids: idTokens(r.t('D')),
      milestone_links: [],
      cadence: 'once',
      deadline,
    };
    expiryRecords.push(mk('horizon', key, label, 'planned', data, r));
  }

  /* ---------- future work ---------- */
  const futureRecords: BundleRecord[] = [];
  for (const r of table(wb, 'future_options')) {
    const key = `FW-${r.t('A')}`;
    const data: FutureOptionData = {
      rank: r.n('B'),
      path: r.t('C') ?? '',
      why_fit: r.t('D') ?? '',
      offer_hypothesis: r.t('E') ?? '',
      first_test: r.t('F') ?? '',
      success_evidence: r.t('G') ?? '',
      limits: r.t('H') ?? '',
      unknowns: r.t('I') ?? '',
      source_ids: idTokens(r.t('J')),
      outside_critical_path: true,
      interest: null,
      kind: 'option',
    };
    futureRecords.push(mk('future_option', key, data.path || key, 'planned', data, r));
  }
  for (const r of table(wb, 'future_phases')) {
    const key = r.t('A') as string;
    const owner = parseOwner(r.t('G'), pidx);
    const links = splitList(r.t('H'), /[;,]/).filter((w) => /^W\d{2}$/.test(w));
    const review = r.t('I') && isCivilDate(r.t('I') as string) ? (r.t('I') as string) : null;
    const data: FutureOptionData = {
      rank: r.n('B'),
      path: r.t('C') ?? '',
      why_fit: '',
      offer_hypothesis: '',
      first_test: r.t('D') ?? '',
      success_evidence: r.t('E') ?? '',
      limits: r.t('F') ?? '',
      unknowns: '',
      source_ids: idTokens(r.t('J')),
      outside_critical_path: true,
      interest: null,
      kind: 'phase',
      window: r.t('C'),
      completion_evidence: r.t('E'),
      milestone_links: links.filter((w) => msKeys.has(w)),
      review_date: review,
    };
    futureRecords.push(mk('future_option', key, data.path.length > 120 ? `${data.path.slice(0, 117)}…` : data.path || key, 'planned', data, r, { owner: owner.owner, owner_proposed: owner.owner_proposed }));
  }
  for (const r of table(wb, 'future_notes')) {
    const key = r.t('A') as string;
    const data: FutureOptionData = {
      rank: null,
      path: r.t('C') ?? '',
      why_fit: '',
      offer_hypothesis: '',
      first_test: '',
      success_evidence: '',
      limits: '',
      unknowns: '',
      source_ids: [],
      outside_critical_path: true,
      interest: null,
      kind: 'note',
      origin: r.t('B'),
      body: r.t('D'),
    };
    futureRecords.push(mk('future_option', key, data.path || key, 'planned', data, r));
  }

  /* ---------- contacts ---------- */
  const propRows = table(wb, 'property');
  const contactRecords = table(wb, 'contacts').map((r) => {
    const name = r.t('I') as string;
    const role = r.t('J') ?? '';
    const relevance = r.t('K') ?? '';
    const boundary = r.t('L') ?? '';
    const basis = `${role} ${relevance} ${boundary}`;
    let relationship: ContactData['relationship'] = 'potential';
    let why = 'No interaction or booking is recorded in the source; kept as a potential contact.';
    if (/\bknown\b.*\brelationship\b|\bexisting\b.*\brelationship\b/i.test(role)) {
      relationship = 'engaged';
      why = `The source records an existing professional relationship ("${role}"). No new booking is implied.`;
    } else if (/\bmeasured\b|\bmeasurement\b|\bvisit(ed)?\b|\bdiscussion\b|\bexisting\b.*\breview\b|\bmanagement contact\b/i.test(basis) && !/\bcandidate\b|\bpossible\b|\bno arrangement\b/i.test(role)) {
      relationship = 'contacted';
      why = `The source records an interaction or an existing contact ("${role}"). It does not record a booking or engagement.`;
    }
    const linkedMs = new Set<string>();
    const lowerName = name.toLowerCase();
    for (const p of propRows) {
      if ((p.t('Q') ?? '').toLowerCase().includes(lowerName.split('/')[0]?.trim() ?? lowerName)) for (const w of splitList(p.t('S'), /[;,]/)) if (msKeys.has(w)) linkedMs.add(w);
    }
    const data: ContactData = {
      name,
      role,
      relevance,
      status_boundary: boundary,
      relationship,
      relationship_basis: why,
      source_ids: idTokens(r.t('M')),
      linked_records: [...linkedMs],
    };
    return mk('contact', `CT-${slugify(name)}`, name, relationship, data, r);
  });

  /* ---------- inventory and property ---------- */
  const inventoryRecords = table(wb, 'inventory').map((r) => {
    const owner = parseOwner(r.t('J'), pidx);
    const data: InventoryData = {
      category: r.t('B') ?? '',
      location: r.t('C'),
      quantity: r.t('D'),
      dimensions_weight: r.t('E'),
      disposition: r.t('F') ?? '',
      value_text: r.t('G'),
      restriction_check: r.t('H'),
      quote_source: r.t('I'),
      decision_evidence: r.t('K'),
      notes: r.t('L'),
    };
    return mk('inventory', r.t('A') as string, data.category, (data.disposition || 'review').toLowerCase(), data, r, { owner: r.t('J') ? owner.owner : null, owner_proposed: owner.owner_proposed });
  });
  const propertyRecords = propRows.map((r) => {
    const key = r.t('N') as string;
    const links = splitList(r.t('S'), /[;,]/);
    for (const w of links) if (!msKeys.has(w)) danglingRefs.push({ record: `property:${key}`, field: 'data.milestone_links', ref: w });
    const data: PropertyData = {
      obligation: r.t('O') ?? '',
      known_context: r.t('P') ?? '',
      people_resources: r.t('Q') ?? '',
      evidence_caution: r.t('R') ?? '',
      milestone_links: links.filter((w) => msKeys.has(w)),
      evidence_status: r.t('T'),
    };
    return mk('property', key, data.obligation || key, 'open', data, r);
  });

  /* ---------- task links (read-only snapshot) ---------- */
  const asOf = overrides.task_snapshot_as_of ?? null;
  const taskLinks: ImportBundle['task_links'] = [];
  for (const c of crosswalk) {
    for (const l of c.links) {
      if (!l.id) continue;
      const status: TaskLink['status'] = l.status === 'open' || l.status === 'done' || l.status === 'cancelled' ? l.status : 'unknown';
      taskLinks.push({
        id: `tl-snapshot-${l.id}`,
        adapter: 'snapshot',
        canonical_id: l.id,
        record_id: msKeys.has(c.id) ? `milestone:${c.id}` : null,
        title: l.title,
        status,
        due: l.due && isCivilDate(l.due) ? l.due : null,
        due_basis: 'source',
        owner: null,
        notes: null,
        proposal_note: l.proposal,
        sync_state: 'snapshot',
        last_synced_at: null,
        last_error: null,
        remote_revision: null,
      });
    }
  }

  /* ---------- assemble ---------- */
  const records: BundleRecord[] = [
    ...anchorRecords,
    ...expiryAnchors,
    ...ruleRecords,
    ...commitmentRecords,
    ...milestoneRecords,
    ...workstreamRecords,
    ...questionRecords,
    ...decisionRecords,
    ...riskRecords,
    ...documentRecords,
    ...costRecords,
    ...fundingRecords,
    ...arrivalRecords,
    ...horizonRecords,
    ...expiryRecords,
    ...futureRecords,
    ...evidenceRecords,
    ...contactRecords,
    ...inventoryRecords,
    ...propertyRecords,
  ];

  // Reference checks
  const keysByType = new Map<string, Set<string>>();
  for (const r of records) {
    const set = keysByType.get(r.type) ?? new Set<string>();
    set.add(r.key);
    keysByType.set(r.type, set);
  }
  const check = (rec: BundleRecord, field: string, refs: string[], type: string): void => {
    const set = keysByType.get(type) ?? new Set<string>();
    for (const ref of refs) if (!set.has(ref)) danglingRefs.push({ record: rec.id, field, ref });
  };
  for (const rec of records) {
    const d = rec.data as Record<string, unknown>;
    if (rec.type === 'milestone') {
      check(rec, 'data.source_ids', (d.source_ids as string[]) ?? [], 'evidence');
      const ws = d.workstream_key as string | null;
      if (ws) check(rec, 'data.workstream_key', [ws], 'workstream');
    }
    if (['arrival', 'horizon', 'contact', 'future_option'].includes(rec.type)) check(rec, 'data.source_ids', ((d.source_ids as string[]) ?? []).filter((s) => !/^(Proposal|Limits)$/i.test(s)), 'evidence');
    if (rec.type === 'risk' || rec.type === 'document' || rec.type === 'existing_commitment') check(rec, 'data.linked_records', (d.linked_records as string[]) ?? [], 'milestone');
    if (rec.type === 'decision') check(rec, 'data.related', ((d.related as string[]) ?? []).filter((x) => x.startsWith('S')), 'workstream');
  }
  for (const c of crosswalk) if (!msKeys.has(c.id)) danglingRefs.push({ record: `crosswalk:${c.id}`, field: 'id', ref: c.id });

  // Provisional per-traveler gates (replaced by reviewed gates through corrections)
  const gates: TravelerGateConfig[] = people.map((p) => ({
    person_id: p.id,
    required_before_departure: milestoneRecords
      .filter((m) => {
        const d = m.data as unknown as MilestoneData;
        return !d.optional_future_work && d.traveler_scope.includes(p.id) && !['eliminated', 'not_applicable'].includes(m.status);
      })
      .map((m) => m.key),
    required_at_or_after_arrival: arrivalRecords.filter((a) => (a.data as unknown as ArrivalData).traveler_scope.includes(p.id)).map((a) => a.key),
    conditional: [],
    explicitly_not_gates: milestoneRecords
      .filter((m) => (m.data as unknown as MilestoneData).optional_future_work)
      .map((m) => ({ key: m.key, reason: 'Optional future work; never a move gate.' })),
    release_key: null,
  }));

  // Counts and validation
  const counts: Record<string, number> = {};
  for (const r of records) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const missingIds: string[] = [];
  for (let i = 1; i <= 71; i++) {
    const id = `W${String(i).padStart(2, '0')}`;
    if (!msKeys.has(id)) missingIds.push(id);
  }
  if (missingIds.length > 0) notes.push(`Missing milestone IDs: ${missingIds.join(', ')}`);
  for (const [type, expected] of Object.entries(EXPECTED_COUNTS)) {
    if ((counts[type] ?? 0) !== expected) notes.push(`Count mismatch for ${type}: expected ${expected}, found ${counts[type] ?? 0}.`);
  }
  notes.push('traveler_scope, phase and workstream_key on milestones, and the per-traveler gate lists, are provisional heuristics. Reviewed values replace them through corrections.');

  const homeTz: IanaZone = overrides.home_timezone ?? 'Pacific/Honolulu';
  const householdName = overrides.household_name ?? (people.length ? `${people.map((p) => p.display_name).join(', ')}` : 'Household');
  const bundle: ImportBundle = {
    source_label: sourceLabel,
    files,
    household: {
      id: overrides.household_id ?? (slugify(householdName) || 'household'),
      name: householdName,
      data_label: overrides.data_label ?? `Imported plan — ${sourceLabel} (local copy)`,
      home_timezone: homeTz,
    },
    people,
    records,
    task_links: taskLinks,
    settings: {
      traveler_gates: gates,
      task_adapter: {
        name: 'snapshot',
        can_write: false,
        as_of: asOf,
        note: 'Read-only dated copy of the linked tasks from the supplied roadmap-queue crosswalk. Nothing is written to the task list.',
      },
      plan_baseline: { baseline_on: baselineOn, reviewed_on: overrides.plan_baseline?.reviewed_on ?? null, source_label: sourceLabel },
      jp_holidays: [],
    },
    validation: { counts, expected: { ...EXPECTED_COUNTS }, dangling_refs: danglingRefs, notes },
  };
  return bundle;
}

/* ------------------------------------------------------------------ */
/* heuristics (provisional; documented in the report)                  */
/* ------------------------------------------------------------------ */

function workstreamStatus(sourceStatus: string): WorkStatus {
  const s = sourceStatus.toLowerCase();
  if (s.startsWith('waiting')) return 'blocked';
  if (s.startsWith('carry forward') || s.includes('answered') || s.includes('confirmed')) return 'in_progress';
  return 'planned';
}

function documentScope(forWhom: string, pidx: PeopleIndex): string[] {
  const named = pidx.mentioned(forWhom);
  const out = new Set(named.map((p) => p.id));
  if (/\b(each|both)\b.*\badult|\beach\b|\bboth adults\b|\btravelers?\b/i.test(forWhom)) for (const a of pidx.adults) out.add(a.id);
  return [...out];
}

function arrivalWindowKey(window: string): ArrivalData['window_key'] {
  const w = window.toLowerCase();
  if (/arrival day|arrival customs/.test(w)) return 'arrival_day';
  if (/30\s*[–-]\s*60/.test(w)) return 'day_60';
  if (/t\+90|by t\+90|\bday 90\b/.test(w)) return 'day_90';
  if (/14\s*[–-]\s*30|first 30|\+30|30 days/.test(w)) return 'day_30';
  if (/t to t\+3|[a-z]\+14|coverage start|e\+14/.test(w)) return 'first_week';
  return 'ongoing';
}

function guessPhase(d: MilestoneDraft, anchorOffset: number | null): PhaseKey | null {
  if (anchorOffset !== null) {
    if (anchorOffset <= -75) return 'p4_stage_minus_90';
    if (anchorOffset <= 0) return 'p5_final_60_30_14';
    return 'p6_departure_to_day90';
  }
  const text = `${d.data.target_window} ${d.data.due_basis ?? ''} ${d.title}`;
  if (/three-year|annual|quarterly|renewal|year ?2|year ?3|recurring/i.test(text)) return 'p7_three_year';
  if (/\bT\+\d+|day ?90|first 90|after arrival|arrival day|first week|within \d+ days after/i.test(text)) return 'p6_departure_to_day90';
  if (/\b(D|T|DP)-\d+|final|before each (adult )?departure|release/i.test(text)) return 'p5_final_60_30_14';
  if (/\bT-?(90|75)\b/i.test(text)) return 'p4_stage_minus_90';
  if (/Jan[\s–-]*(Mar|May)|Nov[\s–-]*Mar|Jan-/i.test(text)) return 'p3_jan_mar2027';
  if (/Nov[\s–-]*Dec|November[\s–-]*December/i.test(text)) return 'p2_nov_dec2026';
  if (/\bnow\b|Nov 11|first review/i.test(text)) return 'p1_now_nov2026';
  return null;
}

