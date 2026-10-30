import type { FastifyInstance } from 'fastify';
import type { Deps } from '../context';
import { requireAuth } from '../auth/context';
import { completeTask, listTasks, patchTask, proposeTask, retryTask, syncTasks, adapterStatus } from '../domain/tasks-service';

export function registerTaskRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/tasks', async (request) => listTasks(deps, requireAuth(request)));

  app.post('/api/tasks', async (request, reply) => {
    const ctx = requireAuth(request);
    const result = await proposeTask(deps, ctx, request.body);
    reply.code(201);
    return result;
  });

  // Registered before /api/tasks/:id/... so the literal path wins.
  app.post('/api/tasks/sync', async (request) => syncTasks(deps, requireAuth(request), request.body));

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    const ctx = requireAuth(request);
    return { ...(await patchTask(deps, ctx, request.params.id, request.body)), adapter: adapterStatus(deps, ctx) };
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/complete', async (request) => {
    const ctx = requireAuth(request);
    return { ...(await completeTask(deps, ctx, request.params.id, request.body)), adapter: adapterStatus(deps, ctx) };
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/retry', async (request) => {
    const ctx = requireAuth(request);
    return { ...(await retryTask(deps, ctx, request.params.id, request.body)), adapter: adapterStatus(deps, ctx) };
  });
}
