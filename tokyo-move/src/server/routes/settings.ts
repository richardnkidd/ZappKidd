import type { FastifyInstance } from 'fastify';
import type { Deps } from '../context';
import { requireAuth } from '../auth/context';
import { listSettings, putSetting } from '../domain/settings-service';

export function registerSettingsRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/settings', async (request) => listSettings(deps, requireAuth(request)));

  app.put<{ Params: { key: string } }>('/api/settings/:key', async (request) =>
    putSetting(deps, requireAuth(request), request.params.key, request.body),
  );
}
