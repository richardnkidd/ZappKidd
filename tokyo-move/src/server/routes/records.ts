import type { FastifyInstance } from 'fastify';
import type { Deps } from '../context';
import { requireAuth } from '../auth/context';
import { parseWith } from '../http/validate';
import { listRecordRows, rowToRecord } from '../domain/records-repo';
import { changeStatus, createRecord, getRecordDetail, patchRecord } from '../domain/records-service';
import { approveDecision, deferDecision, rejectDecision } from '../domain/decisions-service';
import { listRecordsQuery } from '../domain/schemas';
import { buildSnapshot } from '../domain/snapshot-service';

export function registerRecordRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/snapshot', async (request) => buildSnapshot(deps, requireAuth(request)));

  app.get('/api/records', async (request) => {
    const ctx = requireAuth(request);
    const q = parseWith(listRecordsQuery, request.query, 'Query');
    return { records: listRecordRows(deps.db, ctx, q.type).map((r) => rowToRecord(r, false)) };
  });

  app.get<{ Params: { id: string } }>('/api/records/:id', async (request) =>
    getRecordDetail(deps, requireAuth(request), request.params.id),
  );

  app.post('/api/records', async (request, reply) => {
    const record = createRecord(deps, requireAuth(request), request.body);
    reply.code(201);
    return { record };
  });

  app.patch<{ Params: { id: string } }>('/api/records/:id', async (request) => ({
    record: patchRecord(deps, requireAuth(request), request.params.id, request.body),
  }));

  app.post<{ Params: { id: string } }>('/api/records/:id/status', async (request) => ({
    record: changeStatus(deps, requireAuth(request), request.params.id, request.body),
  }));

  app.post<{ Params: { id: string } }>('/api/decisions/:id/approve', async (request) =>
    approveDecision(deps, requireAuth(request), request.params.id, request.body),
  );
  app.post<{ Params: { id: string } }>('/api/decisions/:id/reject', async (request) =>
    rejectDecision(deps, requireAuth(request), request.params.id, request.body),
  );
  app.post<{ Params: { id: string } }>('/api/decisions/:id/defer', async (request) =>
    deferDecision(deps, requireAuth(request), request.params.id, request.body),
  );
}
