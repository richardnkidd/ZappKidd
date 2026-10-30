/** Import receipts, export, and admin backup/restore. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../context';
import { requireAuth } from '../auth/context';
import { HttpError, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { exportCsv, exportJson } from '../domain/export-service';
import { listImportChanges, listImportRuns } from '../domain/import-service';
import { RECORD_TYPES, line } from '../domain/schemas';
import { createBackup, listBackups, resolveBackupPath, restoreBackup } from '../domain/backup-service';
import { clearSessionCookie } from '../auth/routes';
import type { RecordType } from '../../shared/types';

const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const exportQuery = z.strictObject({
  format: z.enum(['json', 'csv']).optional(),
  type: z.enum(RECORD_TYPES as [RecordType, ...RecordType[]]).optional(),
});
const restoreBody = z.strictObject({ backup: line(120), confirm: z.literal('RESTORE', { error: 'Type RESTORE to confirm' }) });
const emptyBody = z.strictObject({});

export function registerDataRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/import/runs', async (request) => {
    const ctx = requireAuth(request);
    const q = parseWith(pageQuery, request.query, 'Query');
    return { runs: listImportRuns(deps, ctx, q.limit ?? 50) };
  });

  app.get<{ Params: { id: string } }>('/api/import/runs/:id/changes', async (request) => {
    const ctx = requireAuth(request);
    const q = parseWith(pageQuery, request.query, 'Query');
    return listImportChanges(deps, ctx, request.params.id, q.limit ?? 200, q.offset ?? 0);
  });

  app.get('/api/export', async (request, reply) => {
    const ctx = requireAuth(request);
    const q = parseWith(exportQuery, request.query, 'Query');
    const day = deps.now().toISOString().slice(0, 10);
    if ((q.format ?? 'json') === 'csv') {
      if (!q.type) throw validationError('Query did not pass validation', [{ path: 'type', message: 'CSV export needs a record type' }]);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="kadode-${q.type}-${day}.csv"`);
      return exportCsv(deps, ctx, q.type);
    }
    reply.header('Content-Disposition', `attachment; filename="kadode-export-${day}.json"`);
    return exportJson(deps, ctx);
  });

  /** Backups copy the whole database file. Admin actions are refused when the file holds more than one household. */
  function requireSingleHousehold(): void {
    const n = (deps.db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number }).n;
    if (n > 1) {
      throw new HttpError(403, 'forbidden', 'This database holds more than one household. Use the command-line backup and restore scripts.');
    }
  }

  app.post('/api/admin/backup', async (request, reply) => {
    requireAuth(request);
    parseWith(emptyBody, request.body);
    requireSingleHousehold();
    const backup = await createBackup(deps.db, deps.config.dataDir, deps.now());
    reply.code(201);
    return { backup };
  });

  app.get('/api/admin/backups', async (request) => {
    requireAuth(request);
    return { backups: listBackups(deps.config.dataDir) };
  });

  app.post('/api/admin/restore', async (request, reply) => {
    const ctx = requireAuth(request);
    const body = parseWith(restoreBody, request.body);
    requireSingleHousehold();
    const backupPath = resolveBackupPath(deps.config.dataDir, body.backup);
    const result = await restoreBackup(deps.db, {
      dataDir: deps.config.dataDir,
      backupPath,
      actor: { householdId: ctx.householdId, personId: ctx.personId, tokenHash: ctx.tokenHash },
      now: deps.now(),
    });
    if (result.session_invalidated) clearSessionCookie(deps, reply);
    return { restore: result };
  });
}
