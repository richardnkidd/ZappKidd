/** Create, edit and change the status of records. All writes run inside one transaction with their audit entry. */
import type { Deps, AuthContext } from '../context';
import type { AuditEntry, BaseRecord, CompletionEvidence, DecisionData, ImportChange, Person, RecordType, TaskLink, Visibility } from '../../shared/types';
import { HttpError, conflictError, forbidden, notFound, validationError } from '../http/errors';
import { parseWith, type ValidationIssue } from '../http/validate';
import { listPeople } from '../auth/users';
import { listAudit } from './audit';
import { awaitingText, evaluateDecision } from './decisions';
import { taskLinkFromRow } from './task-links-repo';
import { importChangesForRecord } from './import-service';
import {
  getRecordRow,
  insertRecord,
  rowToRecord,
  stateOf,
  writeRecordState,
  type ApiRecord,
  type RecordRow,
  type RecordState,
} from './records-repo';
import {
  CREATE_KEY_PREFIX,
  CREATE_STATUS,
  PATCHABLE_DATA,
  PATCH_REDIRECT,
  STATUS_NEEDS_EVIDENCE,
  STATUS_NEEDS_REASON,
  TRAVELER_PROGRESS_TYPES,
  WORK_STATUSES,
  WORK_STATUS_TYPES,
  createDataSchemas,
  createRecordBody,
  patchRecordBody,
  statusBody,
  type CreatableType,
} from './schemas';
import { startReview } from './reviews-service';
import { deepEqual, clone, FORBIDDEN_KEYS, isPlainObject, mergeOneLevel, parseJson } from '../util/json';
import { shortToken } from '../util/ids';

type Ctx = Pick<AuthContext, 'householdId' | 'personId'>;

/* ---------- helpers ---------- */

export function recordConflict(row: RecordRow, yourChanges: unknown): HttpError {
  return conflictError('This record changed since you opened it. Nothing was saved.', {
    server: rowToRecord(row, false) as BaseRecord,
    your_changes: yourChanges,
    server_version: row.version,
  });
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function validation(message: string, issues: ValidationIssue[]): HttpError {
  return validationError(message, issues);
}

/** Owner must be null, 'together', 'unassigned', or an adult person of the household. */
export function checkOwner(people: Person[], owner: string | null | undefined, path = 'owner'): void {
  if (owner === null || owner === undefined || owner === 'together' || owner === 'unassigned') return;
  if (!people.some((p) => p.id === owner && p.kind === 'adult')) {
    throw validation('Unknown owner', [issue(path, 'Owner must be an adult in this household, "together" or "unassigned"')]);
  }
}

function uniqueKey(deps: Deps, ctx: Ctx, type: RecordType, prefix: string): string {
  for (let i = 0; i < 5; i += 1) {
    const key = `${prefix}-${shortToken(5)}`;
    const exists = deps.db
      .prepare('SELECT 1 FROM records WHERE household_id = ? AND type = ? AND key = ?')
      .get(ctx.householdId, type, key);
    if (!exists) return key;
  }
  throw new Error('could not allocate a record key');
}

/* ---------- create ---------- */

export function createRecord(deps: Deps, ctx: AuthContext, rawBody: unknown): ApiRecord {
  const body = parseWith(createRecordBody, rawBody);
  if (body.type === 'review_session') {
    const parsed = parseWith(createDataSchemas.review_session, body.data ?? {}, 'Review data');
    return startReview(deps, ctx, { title: body.title, participants: parsed.participants }).record;
  }
  const type = body.type as Exclude<CreatableType, 'review_session'>;
  const people = listPeople(deps.db, ctx.householdId);
  checkOwner(people, body.owner);
  const parsedData = parseWith(createDataSchemas[type] as never, body.data ?? {}, 'Record data') as Record<string, unknown>;
  const visibility: Visibility = body.visibility ?? 'household';

  const run = deps.db.transaction(() => {
    const data = buildCreateData(deps, ctx, type, body.title, parsedData, people);
    const key = uniqueKey(deps, ctx, type, CREATE_KEY_PREFIX[type]);
    const row = insertRecord(
      deps.db,
      ctx,
      {
        type,
        key,
        title: body.title,
        status: CREATE_STATUS[type],
        owner: body.owner ?? null,
        visibility,
        data,
      },
      deps.now(),
    );
    return rowToRecord(row, false);
  });
  return run();
}

function buildCreateData(
  deps: Deps,
  ctx: Ctx,
  type: Exclude<CreatableType, 'review_session'>,
  title: string,
  d: Record<string, unknown>,
  people: Person[],
): Record<string, unknown> {
  const v = <T>(k: string, fallback: T): T => (d[k] === undefined ? fallback : (d[k] as T));
  switch (type) {
    case 'note': {
      const linked = v<string | null>('linked_record_id', null);
      if (linked !== null && !getRecordRow(deps.db, ctx, linked)) {
        throw validation('Linked record not found', [issue('data.linked_record_id', 'No such record')]);
      }
      return { body: d.body, linked_record_id: linked };
    }
    case 'risk':
      return {
        raid_kind: v('raid_kind', 'risk'),
        trigger: v('trigger', ''),
        mitigation: v('mitigation', ''),
        fallback: v('fallback', ''),
        review_basis: v('review_basis', ''),
        severity: v('severity', 'medium'),
        escalation_trigger: v('escalation_trigger', null),
        linked_records: v('linked_records', []),
      };
    case 'decision': {
      const rawOptions = v<{ id?: string; label: string; consequences?: string | null }[]>('options', []);
      const options: DecisionData['options'] = [];
      let n = 0;
      for (const o of rawOptions) {
        let id = o.id;
        if (!id) {
          do n += 1;
          while (rawOptions.some((x) => x.id === `opt-${n}`));
          id = `opt-${n}`;
        }
        if (options.some((x) => x.id === id)) throw validation('Duplicate option id', [issue('data.options', `Option id "${id}" is repeated`)]);
        options.push({ id, label: o.label, consequences: o.consequences ?? null, source: 'household' });
      }
      const recommended = v<string | null>('recommended_option_id', null);
      if (recommended !== null && !options.some((o) => o.id === recommended)) {
        throw validation('Unknown recommended option', [issue('data.recommended_option_id', 'Must be one of the options')]);
      }
      const adults = people.filter((p) => p.kind === 'adult').map((p) => p.id);
      const approvers = v<string[]>('required_approvers', adults);
      for (const a of approvers) {
        if (!adults.includes(a)) throw validation('Unknown approver', [issue('data.required_approvers', 'Approvers must be adults in this household')]);
      }
      return {
        question: v('question', title),
        options,
        recommended_option_id: recommended,
        recommendation_text: '',
        rationale: v('rationale', null),
        needed_by: v('needed_by', null),
        trigger: v('trigger', ''),
        consequence_of_delay: v('consequence_of_delay', null),
        dependencies: v('dependencies', []),
        acceptance_evidence: v('acceptance_evidence', ''),
        source_status: 'Added in Kadode',
        required_approvers: approvers,
        approvals: [],
        decided_option_id: null,
        decided_at: null,
        history_note: null,
      };
    }
    case 'finding':
      return {
        reviewer: v('reviewer', 'household'),
        severity: v('severity', 'medium'),
        evidence: v('evidence', ''),
        affected_records: v('affected_records', []),
        affected_screens: v('affected_screens', []),
        impact: v('impact', ''),
        recommendation: v('recommendation', ''),
        finding_owner: v('finding_owner', ''),
        due_or_trigger: v('due_or_trigger', ''),
        finding_type: v('finding_type', 'household_decision'),
        disposition: 'open',
        disposition_rationale: null,
      };
    case 'cost': {
      const estimate = v('estimate', null);
      const quote = v('quote', null);
      const committed = v('committed', null);
      const hasAmount = estimate !== null || quote !== null || committed !== null;
      const applicability = v<string>('applicability', hasAmount ? 'include' : 'review');
      if (applicability === 'exclude' && !String(d.exclusion_reason ?? '').trim()) {
        throw validation('Excluding a cost line needs a reason', [issue('data.exclusion_reason', 'Required when applicability is exclude')]);
      }
      return {
        section: d.section,
        source_section: 'Added in Kadode',
        category: v('category', 'Other'),
        description: d.description,
        applicability,
        exclusion_reason: v('exclusion_reason', null),
        estimate,
        quote,
        committed,
        paid: v('paid', null),
        unpaid_balance: v('unpaid_balance', null),
        payer: v('payer', null),
        quote_source: v('quote_source', null),
        quote_date: v('quote_date', null),
        deposit_due: v('deposit_due', null),
        refundable: v('refundable', 'unknown'),
        uncertainty: v('uncertainty', ''),
        commitment_state: v('commitment_state', committed !== null ? 'approved_commitment' : quote !== null ? 'quote' : estimate !== null ? 'estimate' : 'not_committed'),
        phase: v('phase', null),
        duplication_check: v('duplication_check', null),
      };
    }
    case 'contact':
      return {
        name: d.name,
        role: v('role', ''),
        relevance: v('relevance', ''),
        status_boundary: v('status_boundary', 'Saved name only. Nothing booked or contacted.'),
        relationship: v('relationship', 'potential'),
        source_ids: v('source_ids', []),
        linked_records: v('linked_records', []),
      };
  }
}

/* ---------- edit ---------- */

export function patchRecord(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): ApiRecord {
  const body = parseWith(patchRecordBody, rawBody);
  const people = listPeople(deps.db, ctx.householdId);
  const run = deps.db.transaction(() => {
    const row = getRecordRow(deps.db, ctx, id);
    if (!row) throw notFound();
    const redirect = PATCH_REDIRECT[row.type];
    if (redirect) throw validation(`This record type is edited with ${redirect}`, [issue('', `Use ${redirect}`)]);
    if (row.version !== body.baseVersion) throw recordConflict(row, body.changes);

    const cur = stateOf(row);
    const next: RecordState = clone(cur);
    const edited = new Set(cur.locally_edited);
    const ch = body.changes;

    if (ch.title !== undefined && ch.title !== cur.title) {
      next.title = ch.title;
      edited.add('title');
    }
    if (ch.owner !== undefined) {
      checkOwner(people, ch.owner);
      if (ch.owner !== cur.owner) {
        next.owner = ch.owner;
        edited.add('owner');
        if (ch.owner_proposed === undefined && cur.owner_proposed) {
          next.owner_proposed = false;
          edited.add('owner_proposed');
        }
      }
    }
    if (ch.owner_proposed !== undefined && ch.owner_proposed !== cur.owner_proposed) {
      next.owner_proposed = ch.owner_proposed;
      edited.add('owner_proposed');
    }
    if (ch.visibility !== undefined && ch.visibility !== cur.visibility) {
      if (row.created_by !== ctx.personId) throw forbidden('Only the person who created a record can change who can see it');
      next.visibility = ch.visibility;
      edited.add('visibility');
    }

    if (ch.data !== undefined) {
      const incoming = ch.data;
      const issues: ValidationIssue[] = [];
      const allowed = PATCHABLE_DATA[row.type];
      for (const key of Object.keys(incoming)) {
        if (FORBIDDEN_KEYS.has(key)) {
          issues.push(issue(`data.${key}`, 'Not an editable field'));
        } else if (!allowed || !Object.prototype.hasOwnProperty.call(allowed, key)) {
          issues.push(issue(`data.${key}`, 'This field cannot be edited here'));
        }
      }
      if (issues.length) throw validation('Some fields cannot be edited', issues);

      const merged = mergeOneLevel(cur.data, incoming);
      for (const key of Object.keys(incoming)) {
        const schema = allowed?.[key];
        if (!schema) continue;
        const result = schema.safeParse(merged[key]);
        if (!result.success) {
          for (const i of result.error.issues) issues.push(issue(['data', key, ...i.path.map(String)].join('.'), i.message));
        } else {
          merged[key] = result.data;
        }
      }
      if (issues.length) throw validation('Request did not pass validation', issues);
      for (const key of Object.keys(incoming)) {
        if (!deepEqual(cur.data[key], merged[key])) edited.add(`data.${key}`);
      }
      next.data = merged;
      postValidate(row.type, next.data, people);
      if (row.type === 'decision' && (row.status === 'approved' || row.status === 'proposed')) {
        applyDecisionEvaluation(next, people, deps.now());
      }
    }

    next.locally_edited = [...edited];
    if (deepEqual({ ...next, locally_edited: [] }, { ...cur, locally_edited: [] })) return rowToRecord(row, false);
    const { row: updated } = writeRecordState(deps.db, ctx, row, next, {
      action: 'update',
      reason: body.reason ?? null,
      now: deps.now(),
    });
    return rowToRecord(updated, false);
  });
  return run();
}

/** Cross-field rules that single-field schemas cannot express. */
function postValidate(type: RecordType, data: Record<string, unknown>, people: Person[]): void {
  if (type === 'cost') {
    if (data.applicability === 'exclude' && !String(data.exclusion_reason ?? '').trim()) {
      throw validation('Excluding a cost line needs a reason', [issue('data.exclusion_reason', 'Required when applicability is exclude')]);
    }
  }
  if (type === 'finding') {
    if ((data.disposition === 'rejected' || data.disposition === 'deferred') && !String(data.disposition_rationale ?? '').trim()) {
      throw validation('A rationale is required', [issue('data.disposition_rationale', 'Required when a finding is rejected or deferred')]);
    }
  }
  if (type === 'decision') {
    const options = (data.options as { id: string }[] | undefined) ?? [];
    const ids = options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) throw validation('Duplicate option id', [issue('data.options', 'Option ids must be unique')]);
    const rec = data.recommended_option_id as string | null | undefined;
    if (rec && !ids.includes(rec)) throw validation('Unknown recommended option', [issue('data.recommended_option_id', 'Must be one of the options')]);
    const adults = people.filter((p) => p.kind === 'adult').map((p) => p.id);
    for (const a of (data.required_approvers as string[] | undefined) ?? []) {
      if (!adults.includes(a)) throw validation('Unknown approver', [issue('data.required_approvers', 'Approvers must be adults in this household')]);
    }
    for (const ap of (data.approvals as { option_id: string }[] | undefined) ?? []) {
      if (!ids.includes(ap.option_id)) {
        throw validation('An approval refers to an option that would be removed', [
          issue('data.options', 'Withdraw the approval before removing that option'),
        ]);
      }
    }
  }
}

/** Recompute status/decided fields of a decision state from its approvals. */
export function applyDecisionEvaluation(state: RecordState, people: Person[], now: Date): void {
  const data = state.data as unknown as DecisionData;
  const ev = evaluateDecision(data, people);
  state.status = ev.status;
  if (ev.status === 'approved') {
    if (data.decided_option_id !== ev.decided_option_id) data.decided_at = now.toISOString();
    data.decided_option_id = ev.decided_option_id;
    data.decided_at ??= now.toISOString();
  } else {
    data.decided_option_id = null;
    data.decided_at = null;
  }
}

/* ---------- status ---------- */

export function changeStatus(deps: Deps, ctx: AuthContext, id: string, rawBody: unknown): ApiRecord {
  const body = parseWith(statusBody, rawBody);
  const people = listPeople(deps.db, ctx.householdId);
  const reason = body.reason?.trim() ? body.reason.trim() : null;
  const evidenceIn =
    body.evidence === undefined ? null : typeof body.evidence === 'string' ? { summary: body.evidence, link: null } : { summary: body.evidence.summary, link: body.evidence.link ?? null };
  const summary = evidenceIn?.summary.trim() ?? '';

  const run = deps.db.transaction(() => {
    const row = getRecordRow(deps.db, ctx, id);
    if (!row) throw notFound();
    if (row.version !== body.baseVersion) throw recordConflict(row, { status: body.status, reason, evidence: evidenceIn, traveler: body.traveler });

    // Per-type vocabulary.
    if (WORK_STATUS_TYPES.has(row.type)) {
      if (!(WORK_STATUSES as readonly string[]).includes(body.status)) {
        throw validation('Unknown status', [issue('status', `Expected one of ${WORK_STATUSES.join(', ')}`)]);
      }
    } else if (row.type === 'decision') {
      if (body.status !== 'superseded') {
        throw validation('Decision status is set by approving, rejecting or deferring', [
          issue('status', 'Use /api/decisions/:id/approve, /reject or /defer (only "superseded" is set here)'),
        ]);
      }
    } else if (row.type === 'review_session' || row.type === 'anchor') {
      throw validation('This record type does not use the status endpoint', [issue('status', 'Not applicable')]);
    }
    if (body.traveler !== undefined && !TRAVELER_PROGRESS_TYPES.has(row.type)) {
      throw validation('Per-traveler progress is only available on roadmap and arrival items', [issue('traveler', 'Not applicable')]);
    }

    // Server-enforced status rules.
    const issues: ValidationIssue[] = [];
    if (STATUS_NEEDS_EVIDENCE.has(body.status) && summary.length === 0) {
      issues.push(issue('evidence', 'Completing needs evidence: say what shows it is done'));
    }
    if (STATUS_NEEDS_REASON.has(body.status) && !reason) {
      issues.push(issue('reason', `A reason is required for "${body.status}"`));
    }
    if (issues.length) throw validation('Status change needs more information', issues);

    const cur = stateOf(row);
    const next: RecordState = clone(cur);
    const edited = new Set(cur.locally_edited);
    const at = deps.now().toISOString();
    const newEvidence: CompletionEvidence | null =
      body.status === 'completed' && summary ? { at, by: ctx.personId, summary, link: evidenceIn?.link ?? null } : null;

    if (body.traveler !== undefined) {
      const person = people.find((p) => p.id === body.traveler);
      if (!person) throw validation('Unknown traveler', [issue('traveler', 'No such person in this household')]);
      const scope = Array.isArray(cur.data.traveler_scope) ? (cur.data.traveler_scope as string[]) : [];
      if (scope.length > 0 && !scope.includes(person.id)) {
        throw validation('This item does not apply to that traveler', [issue('traveler', 'Not in this item\'s traveler scope')]);
      }
      const progressMap = isPlainObject(cur.data.traveler_progress) ? { ...(cur.data.traveler_progress as Record<string, unknown>) } : {};
      const prev = isPlainObject(progressMap[person.id]) ? (progressMap[person.id] as { evidence?: CompletionEvidence[] }) : {};
      const prevEvidence = Array.isArray(prev.evidence) ? prev.evidence : [];
      progressMap[person.id] = {
        status: body.status,
        reason,
        evidence: newEvidence ? [...prevEvidence, newEvidence] : prevEvidence,
        updated_at: at,
        updated_by: ctx.personId,
      };
      next.data = { ...next.data, traveler_progress: progressMap };
      edited.add('data.traveler_progress');
      // The record-level status is deliberately untouched.
    } else {
      next.status = body.status;
      if (next.status !== cur.status) edited.add('status');
      const hadReasonKey = Object.prototype.hasOwnProperty.call(cur.data, 'status_reason');
      if (reason !== null || hadReasonKey) {
        if ((cur.data.status_reason ?? null) !== reason) edited.add('data.status_reason');
        next.data = { ...next.data, status_reason: reason };
      }
      if (newEvidence) {
        const list = Array.isArray(cur.data.completion_evidence) ? (cur.data.completion_evidence as CompletionEvidence[]) : [];
        next.data = { ...next.data, completion_evidence: [...list, newEvidence] };
        edited.add('data.completion_evidence');
      }
    }

    next.locally_edited = [...edited];
    const { row: updated } = writeRecordState(deps.db, ctx, row, next, {
      action: 'status_change',
      reason: reason ?? null,
      now: deps.now(),
    });
    return rowToRecord(updated, false);
  });
  return run();
}

/* ---------- read ---------- */

export interface RecordDetail {
  record: ApiRecord;
  audit: AuditEntry[];
  linked_notes: ApiRecord[];
  task_links: TaskLink[];
  /** Import receipts for this record, newest first. */
  import_changes: ImportChange[];
  decision?: { awaiting: string[]; awaiting_text: string | null; disagreement: boolean };
}

export function getRecordDetail(deps: Deps, ctx: AuthContext, id: string): RecordDetail {
  const row = getRecordRow(deps.db, ctx, id);
  if (!row) throw notFound();
  const notes = deps.db
    .prepare(
      `SELECT * FROM records WHERE household_id = @hh AND type = 'note'
          AND (visibility = 'household' OR created_by = @actor)
          AND json_extract(data, '$.linked_record_id') = @id
        ORDER BY created_at DESC`,
    )
    .all({ hh: ctx.householdId, actor: ctx.personId, id: row.id }) as RecordRow[];
  const links = deps.db
    .prepare('SELECT * FROM task_links WHERE household_id = ? AND record_id = ? ORDER BY created_at')
    .all(ctx.householdId, row.id) as Record<string, unknown>[];
  const detail: RecordDetail = {
    record: rowToRecord(row, true),
    audit: listAudit(deps.db, ctx, { recordId: row.id, limit: 200 }),
    linked_notes: notes.map((n) => rowToRecord(n, false)),
    task_links: links.map(taskLinkFromRow),
    import_changes: importChangesForRecord(deps, ctx.householdId, row.id),
  };
  if (row.type === 'decision') {
    const people = listPeople(deps.db, ctx.householdId);
    const data = parseJson<DecisionData>(row.data, {} as DecisionData);
    const ev = evaluateDecision(data, people);
    detail.decision = { awaiting: ev.awaiting, awaiting_text: awaitingText(ev.awaiting, people), disagreement: ev.disagreement };
  }
  return detail;
}
