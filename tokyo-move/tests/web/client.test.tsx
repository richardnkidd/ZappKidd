import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, ConflictError, isMisdirected, MisdirectedError, NetworkError, onUnauthenticated, UnauthenticatedError } from '../../src/web/net/client';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok,
        status,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
      } as Response;
    }),
  );
}
const sentBody = () => JSON.parse(String(calls[calls.length - 1]!.init.body));

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('api client request shapes match the server contract', () => {
  it('always sends same-origin credentials and JSON', async () => {
    stubFetch(200, { generated_at: 'x' });
    await api.snapshot();
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect(calls[0]!.url).toBe('/api/snapshot');
  });

  it('status change omits empty fields (the server rejects explicit nulls)', async () => {
    stubFetch(200, { record: { id: 'milestone:W01' } });
    await api.setStatus('milestone:W01', { baseVersion: 3, status: 'in_progress', reason: null, evidence: null, traveler: null });
    expect(calls[0]!.url).toBe('/api/records/milestone%3AW01/status');
    expect(sentBody()).toEqual({ baseVersion: 3, status: 'in_progress' });
  });

  it('status change sends evidence and the traveler when given', async () => {
    stubFetch(200, { record: {} });
    await api.setStatus('milestone:W07', { baseVersion: 1, status: 'completed', evidence: { summary: 'Confirmed by email', link: 'https://example.com/x' }, traveler: 'ann' });
    expect(sentBody()).toEqual({ baseVersion: 1, status: 'completed', evidence: { summary: 'Confirmed by email', link: 'https://example.com/x' }, traveler: 'ann' });
  });

  it('reject and defer send a rationale; defer may carry a revisit date', async () => {
    stubFetch(200, { record: {} });
    await api.rejectDecision('decision:D1', { baseVersion: 2, rationale: 'Too costly' });
    expect(sentBody()).toEqual({ baseVersion: 2, rationale: 'Too costly' });
    await api.deferDecision('decision:D1', { baseVersion: 2, rationale: 'Wait', revisit_on: '2026-12-01' });
    expect(sentBody()).toEqual({ baseVersion: 2, rationale: 'Wait', revisit_on: '2026-12-01' });
    await api.deferDecision('decision:D1', { baseVersion: 2, rationale: 'Wait', revisit_on: null });
    expect(sentBody()).toEqual({ baseVersion: 2, rationale: 'Wait' });
  });

  it('proposing a task only sends a due date for an explicit choice', async () => {
    stubFetch(201, { task: {}, outcome: 'pending_capture' });
    await api.proposeTask({ title: 'Call', record_id: 'milestone:W01', owner: 'ann', due: '2026-11-12', due_mode: 'default' });
    expect(sentBody()).toEqual({ title: 'Call', record_id: 'milestone:W01', owner: 'ann', due_mode: 'default' });
    await api.proposeTask({ title: 'Call', due: '2026-11-20', due_mode: 'explicit' });
    expect(sentBody()).toEqual({ title: 'Call', due: '2026-11-20', due_mode: 'explicit' });
    await api.proposeTask({ title: 'Call', due: null, due_mode: 'blank' });
    expect(sentBody()).toEqual({ title: 'Call', due_mode: 'blank' });
  });

  it('unwraps { record } and bare records, and reads { entries } for audit', async () => {
    stubFetch(200, { record: { id: 'a', version: 2 } });
    expect((await api.patchRecord('a', { baseVersion: 1, changes: { owner: 'bo' } })).version).toBe(2);
    stubFetch(200, { entries: [{ id: 'e1' }] });
    expect(await api.audit({ since: '2026-10-01T00:00:00Z' })).toHaveLength(1);
    expect(calls[calls.length - 1]!.url).toBe('/api/audit?since=2026-10-01T00%3A00%3A00Z');
  });

  it('lists development identities from { identities }', async () => {
    stubFetch(200, { identities: [{ person_id: 'ann', display_name: 'Ann' }] });
    expect(await api.identities()).toEqual([{ person_id: 'ann', display_name: 'Ann', username: undefined }]);
  });
});

describe('api client errors', () => {
  it('turns a 409 into a ConflictError carrying the server copy', async () => {
    stubFetch(409, { error: 'conflict', message: 'Changed', details: { server: { id: 'x', version: 5, updated_by: 'bo' }, your_changes: { owner: 'ann' }, server_version: 5 } }, false);
    const err = await api.patchRecord('x', { baseVersion: 4, changes: { owner: 'ann' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).serverVersion).toBe(5);
    expect((err as ConflictError).server?.updated_by).toBe('bo');
    expect((err as ConflictError).yourChanges).toEqual({ owner: 'ann' });
  });

  it('a 401 signals sign-in once and throws UnauthenticatedError', async () => {
    stubFetch(401, { error: 'unauthenticated', message: 'Sign in' }, false);
    const seen = vi.fn();
    const off = onUnauthenticated(seen);
    const err = await api.snapshot().catch((e) => e);
    off();
    expect(err).toBeInstanceOf(UnauthenticatedError);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('the sign-in calls do not trigger the global sign-in redirect', async () => {
    stubFetch(401, { error: 'unauthenticated', message: 'Invalid username or password' }, false);
    const seen = vi.fn();
    const off = onUnauthenticated(seen);
    await api.login('x', 'y').catch(() => undefined);
    off();
    expect(seen).not.toHaveBeenCalled();
  });

  it('an unreachable server becomes a NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(api.snapshot()).rejects.toBeInstanceOf(NetworkError);
  });

  it('other failures carry the server message', async () => {
    stubFetch(403, { error: 'forbidden', message: 'Not allowed here' }, false);
    const err = (await api.snapshot().catch((e) => e)) as ApiError;
    expect(err.status).toBe(403);
    expect(err.message).toBe('Not allowed here');
  });
});


describe('restore and misdirected addresses', () => {
  it('restore sends the plain confirmation, or the explicit one that also brings back logins', async () => {
    stubFetch(200, { restore: { restored_from: 'a.db', pre_restore_backup: 'b.db', session_invalidated: true } });
    await api.restoreBackup('kadode-20261029T120000Z.db');
    expect(sentBody()).toEqual({ backup: 'kadode-20261029T120000Z.db', confirm: 'RESTORE' });
    await api.restoreBackup('kadode-20261029T120000Z.db', 'RESTORE-INCLUDING-USERS');
    expect(sentBody()).toEqual({ backup: 'kadode-20261029T120000Z.db', confirm: 'RESTORE-INCLUDING-USERS' });
  });

  it('a 409 users_differ keeps its reason so the screen can ask a second, explicit question', async () => {
    stubFetch(409, { error: 'conflict', message: 'differs', details: { reason: 'users_differ', confirm_with: 'RESTORE-INCLUDING-USERS' } }, false);
    const err = await api.restoreBackup('kadode-20261029T120000Z.db').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).details).toMatchObject({ reason: 'users_differ' });
  });

  it('any 421 is one calm message and is recognised everywhere', async () => {
    stubFetch(421, { error: 'forbidden', message: 'This address is not served here' }, false);
    const err = await api.snapshot().catch((e) => e);
    expect(err).toBeInstanceOf(MisdirectedError);
    expect((err as ApiError).message).toBe("This address isn't allowed for Kadode.");
    expect(isMisdirected(err)).toBe(true);
    expect(isMisdirected(new ApiError(403, 'forbidden', 'x'))).toBe(false);
  });

  it('a 421 does not trigger the sign-in redirect', async () => {
    stubFetch(421, {}, false);
    const seen = vi.fn();
    const off = onUnauthenticated(seen);
    await api.me().catch(() => undefined);
    off();
    expect(seen).not.toHaveBeenCalled();
  });
});
