import type { FastifyInstance } from 'fastify';
import type { Deps } from '../context';
import { requireAuth } from '../auth/context';
import { completeReview, patchReview, startReviewFromBody } from '../domain/reviews-service';

export function registerReviewRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/api/reviews', async (request, reply) => {
    const result = startReviewFromBody(deps, requireAuth(request), request.body);
    reply.code(result.resumed ? 200 : 201);
    return result;
  });

  app.patch<{ Params: { id: string } }>('/api/reviews/:id', async (request) => ({
    record: patchReview(deps, requireAuth(request), request.params.id, request.body),
  }));

  app.post<{ Params: { id: string } }>('/api/reviews/:id/complete', async (request) => ({
    record: completeReview(deps, requireAuth(request), request.params.id, request.body),
  }));
}
