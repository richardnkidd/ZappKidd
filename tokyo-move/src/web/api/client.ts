/**
 * Typed fetch client for the Kadode API. Same-origin cookies only; JSON in, JSON out.
 * 401 => the app shows sign-in; 409 => ConflictError (carries the server's copy); unreachable => NetworkError.
 */
import type {
  AuditEntry,
  BaseRecord,
  ImportChange,
  ImportRun,
  MeResponse,
  Snapshot,
  TaskLink,
} from '@shared/types';
import type { ApiError as ApiErrorBody, ConflictError as ConflictBody } from '@shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorBody['error'] | 'network' | 'bad_response';
  readonly details: unknown;
  constructor(status: number, code: ApiError['code'], message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(message = 'Please sign in again.') {
    super(401, 'unauthenticated', message);
    this.name = 'UnauthenticatedError';
  }
}

export class NetworkError extends ApiError {
  constructor(message = "Can't reach Kadode right now.") {
    super(0, 'network', message);
    this.name = 'NetworkError';
  }
}

export class ConflictError extends ApiError {
  readonly server: BaseRecord | null;
  readonly yourChanges: Record<string, unknown>;
  readonly serverVersion: number | null;
  constructor(message: string, details: Partial<ConflictBody['details']> | undefined) {
    super(409, 'conflict', message, details);
    this.name = 'ConflictError';
    this.server = (details?.server as BaseRecord | undefined) ?? null;
    this.yourChanges = (details?.your_changes as Record<string, unknown> | undefined) ?? {};
    this.serverVersion = details?.server_version ?? details?.server?.version ?? null;
  }
}

type Listener = () => void;
const unauthListeners = new Set<Listener>();
/** The auth provider subscribes so any 401 from any call returns the person to sign-in. */
export function onUnauthenticated(fn: Listener): () => void {
  unauthListeners.add(fn);
  return () => unauthListeners.delete(fn);
}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the global 401 => sign-in handler (used by the sign-in screen itself). */
  quiet401?: boolean;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError();
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError(res.status, 'bad_response', 'Kadode sent a reply we could not read.');
    }
  }

  if (res.ok) return payload as T;

  const body = (payload ?? {}) as Partial<ApiErrorBody>;
  const message = typeof body.message === 'string' && body.message ? body.message : defaultMessage(res.status);
  if (res.status === 401) {
    if (!opts.quiet401) unauthListeners.forEach((l) => l());
    throw new UnauthenticatedError(message);
  }
  if (res.status === 409 || body.error === 'conflict') {
    throw new ConflictError(message, body.details as Partial<ConflictBody['details']> | undefined);
  }
  throw new ApiError(res.status, (body.error as ApiError['code']) ?? 'server_error', message, body.details);
}

function defaultMessage(status: number): string {
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return "We couldn't find that.";
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  if (status >= 500) return 'Something went wrong on our side.';
  return 'That did not work.';
}

const q = (id: string) => encodeURIComponent(id);
const get = <T>(path: string, signal?: AbortSignal, quiet401 = false) => request<T>('GET', path, { signal, quiet401 });
const send = <T>(method: string, path: string, body?: unknown) => request<T>(method, path, { body: body ?? {} });

/* ---------- response shapes the web app relies on ---------- */

/** Servers may return the record bare or wrapped as { record }. */
export function unwrapRecord(body: unknown): BaseRecord {
  const b = body as { record?: BaseRecord } | BaseRecord;
  return ((b as { record?: BaseRecord }).record ?? (b as BaseRecord)) as BaseRecord;
}

export interface DevIdentity {
  person_id: string;
  display_name: string;
  username?: string;
}

export interface RecordDetail {
  record: BaseRecord;
  audit: AuditEntry[];
  notes: BaseRecord[];
  import_changes: ImportChange[];
}

export interface TasksResponse {
  task_links: TaskLink[];
  adapter?: { name: string; can_write: boolean; as_of: string | null; note: string } | null;
}

export type DueMode = 'default' | 'explicit' | 'blank';

export interface StatusChangeBody {
  baseVersion: number;
  status: string;
  reason?: string | null;
  evidence?: { summary: string; link?: string | null } | null;
  /** When set, changes only this traveler's progress on a shared record. */
  traveler?: string | null;
}

export const api = {
  health: () => get<{ ok: boolean; mode: string }>('/api/health', undefined, true),
  me: (signal?: AbortSignal) => get<MeResponse>('/api/me', signal, true),
  identities: async (): Promise<DevIdentity[]> => {
    const body = await get<unknown>('/api/auth/identities', undefined, true);
    const list = Array.isArray(body) ? body : ((body as { identities?: unknown[] })?.identities ?? []);
    return (list as Partial<DevIdentity>[])
      .filter((i) => i && (i.person_id || i.username))
      .map((i) => ({
        person_id: String(i.person_id ?? ''),
        display_name: String(i.display_name ?? i.username ?? i.person_id ?? ''),
        username: i.username,
      }));
  },
  devLogin: (person_id: string) => request<unknown>('POST', '/api/auth/dev-login', { body: { person_id }, quiet401: true }),
  login: (username: string, password: string) =>
    request<unknown>('POST', '/api/auth/login', { body: { username, password }, quiet401: true }),
  logout: () => send<void>('POST', '/api/auth/logout'),
  snapshot: (signal?: AbortSignal) => get<Snapshot>('/api/snapshot', signal),

  record: async (id: string, signal?: AbortSignal): Promise<RecordDetail> => {
    const body = await get<Partial<RecordDetail> & { record?: BaseRecord }>(`/api/records/${q(id)}`, signal);
    return {
      record: unwrapRecord(body),
      audit: body.audit ?? [],
      notes: body.notes ?? [],
      import_changes: body.import_changes ?? [],
    };
  },
  createRecord: async (body: {
    type: string;
    title: string;
    data: Record<string, unknown>;
    owner?: string | null;
    visibility?: 'household' | 'private';
  }) => unwrapRecord(await send<unknown>('POST', '/api/records', body)),
  patchRecord: async (id: string, body: { baseVersion: number; changes: Record<string, unknown>; reason?: string | null }) =>
    unwrapRecord(await send<unknown>('PATCH', `/api/records/${q(id)}`, body)),
  setStatus: async (id: string, body: StatusChangeBody) =>
    unwrapRecord(await send<unknown>('POST', `/api/records/${q(id)}/status`, body)),

  approveDecision: async (id: string, body: { baseVersion: number; option_id: string; note?: string | null }) =>
    unwrapRecord(await send<unknown>('POST', `/api/decisions/${q(id)}/approve`, body)),
  rejectDecision: async (id: string, body: { baseVersion: number; reason: string }) =>
    unwrapRecord(await send<unknown>('POST', `/api/decisions/${q(id)}/reject`, body)),
  deferDecision: async (id: string, body: { baseVersion: number; reason: string }) =>
    unwrapRecord(await send<unknown>('POST', `/api/decisions/${q(id)}/defer`, body)),

  audit: async (params: { record_id?: string; since?: string | null } = {}, signal?: AbortSignal): Promise<AuditEntry[]> => {
    const qs = new URLSearchParams();
    if (params.record_id) qs.set('record_id', params.record_id);
    if (params.since) qs.set('since', params.since);
    const body = await get<AuditEntry[] | { entries?: AuditEntry[]; audit?: AuditEntry[] }>(
      `/api/audit${qs.size ? `?${qs}` : ''}`,
      signal,
    );
    return Array.isArray(body) ? body : (body.entries ?? body.audit ?? []);
  },
  undoAudit: (auditId: string) => send<unknown>('POST', `/api/audit/${q(auditId)}/undo`),

  tasks: () => get<TasksResponse>('/api/tasks'),
  proposeTask: (body: {
    title: string;
    record_id?: string | null;
    owner?: string | null;
    due?: string | null;
    due_mode: DueMode;
  }) => send<{ task_link?: TaskLink } & Partial<TaskLink>>('POST', '/api/tasks', body),
  retryTask: (id: string) => send<unknown>('POST', `/api/tasks/${q(id)}/retry`),
  syncTasks: () => send<unknown>('POST', '/api/tasks/sync'),

  importRuns: async (): Promise<ImportRun[]> => {
    const body = await get<ImportRun[] | { runs?: ImportRun[] }>('/api/import/runs');
    return Array.isArray(body) ? body : (body.runs ?? []);
  },
};

/** Human message for any thrown error, safe to show. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
