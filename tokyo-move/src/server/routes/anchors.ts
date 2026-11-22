import type { FastifyInstance } from 'fastify';
import type { Deps } from '../context';
import { requireAuth } from '../auth/context';
import { applyAnchor, previewAnchor } from '../domain/anchors-service';

export function registerAnchorRoutes(app: FastifyInstance, deps: Deps): void {
  app.post<{ Params: { code: string } }>('/api/anchors/:code/preview', async (request) => ({
    preview: previewAnchor(deps, requireAuth(request), request.params.code, request.body),
  }));

  app.put<{ Params: { code: string } }>('/api/anchors/:code', async (request) =>
    applyAnchor(deps, requireAuth(request), request.params.code, request.body, (msg) => request.log.warn(msg)),
  );
}
