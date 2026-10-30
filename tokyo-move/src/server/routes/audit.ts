import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../context';
import { requireAuth } from '../auth/context';
import { notFound, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { listAudit } from '../domain/audit';
import { getRecordRow } from '../domain/records-repo';
import { undoAudit } from '../domain/undo-service';
import { line } from '../domain/schemas';

const auditQuery = z.strictObject({
  record_id: line(200).optional(),
  since: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function registerAuditRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/audit', async (request) => {
    const ctx = requireAuth(request);
    const q = parseWith(auditQuery, request.query, 'Query');
    if (q.record_id && !getRecordRow(deps.db, ctx, q.record_id)) throw notFound();
    let since: string | undefined;
    if (q.since !== undefined) {
      const t = Date.parse(q.since);
      if (Number.isNaN(t)) throw validationError('Query did not pass validation', [{ path: 'since', message: 'Expected an ISO date-time' }]);
      since = new Date(t).toISOString();
    }
    return {
      entries: listAudit(deps.db, ctx, {
        limit: q.limit ?? 100,
        ...(q.record_id ? { recordId: q.record_id } : {}),
        ...(since ? { since } : {}),
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/audit/:id/undo', async (request) =>
    undoAudit(deps, requireAuth(request), request.params.id, request.body),
  );
}
