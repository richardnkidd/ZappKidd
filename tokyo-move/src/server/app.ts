/**
 * Fastify application factory. `buildApp` is what the server entry point and every API test use (via app.inject).
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db/db';
import type { AppMode } from '../shared/types';
import { devIdentitiesAllowed, isStrictMode, type AppConfig } from './config';
import type { Deps } from './context';
import { HttpError } from './http/errors';
import { BODY_LIMIT_BYTES, csrfGuard, loggerOptions, registerHelmet } from './http/security';
import { buildAuthContext } from './auth/context';
import { registerAuthRoutes, setSessionCookie, clearSessionCookie } from './auth/routes';
import { SESSION_COOKIE, lookupSession } from './auth/sessions';
import { findUserById } from './auth/users';
import { createDefaultTaskAdapter } from './tasks';
import type { TaskAdapter } from './tasks/adapter';
import { registerRecordRoutes } from './routes/records';
import { registerAuditRoutes } from './routes/audit';
import { registerAnchorRoutes } from './routes/anchors';
import { registerTaskRoutes } from './routes/tasks';
import { registerReviewRoutes } from './routes/reviews';
import { registerDataRoutes } from './routes/data';
import { registerSettingsRoutes } from './routes/settings';
import { schemaVersion } from './db/db';

export interface BuildAppOptions {
  db: Db;
  mode: AppMode;
  dataDir: string;
  /** Injectable clock (tests). */
  now?: () => Date;
  taskAdapter?: TaskAdapter;
  logger?: boolean | { level?: string; stream?: NodeJS.WritableStream };
  /** Secure attribute on the session cookie. Defaults to true in staging/production. */
  cookieSecure?: boolean;
  /** Development identities. Honoured only in local-demo (always on) and local (explicit); refused elsewhere. */
  devIdentities?: boolean;
  /** Extra allowed browser origins, e.g. the Vite dev server. */
  allowedOrigins?: string[];
  /** TEST ONLY: accept mutating requests without an Origin header. Not allowed in staging/production. */
  allowMissingOrigin?: boolean;
  trustProxy?: boolean;
  /** Directory of the built web app. Default: <project>/dist/web when it exists. null disables static serving. */
  webRoot?: string | null;
}

const DEFAULT_WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'web');
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/identities', '/api/auth/dev-login', '/api/auth/login', '/api/auth/logout']);

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const strict = isStrictMode(opts.mode);
  if (strict && opts.devIdentities) {
    throw new Error(`Development identities cannot be enabled in ${opts.mode} mode`);
  }
  if (strict && opts.allowMissingOrigin) {
    throw new Error(`allowMissingOrigin is not permitted in ${opts.mode} mode`);
  }
  const cookieSecure = opts.cookieSecure ?? strict;
  if (strict && !cookieSecure) throw new Error(`${opts.mode} mode requires secure cookies`);

  const config: AppConfig = {
    mode: opts.mode,
    dataDir: opts.dataDir,
    cookieSecure,
    devIdentitiesEnabled: devIdentitiesAllowed(opts.mode, opts.devIdentities ?? false),
    allowedOrigins: opts.allowedOrigins ?? [],
    allowMissingOrigin: opts.allowMissingOrigin ?? false,
    trustProxy: opts.trustProxy ?? false,
  };
  const now = opts.now ?? (() => new Date());
  const taskAdapter = opts.taskAdapter ?? createDefaultTaskAdapter(opts.mode, opts.db, opts.dataDir);
  const deps: Deps = { db: opts.db, config, now, taskAdapter };

  const fastifyOpts: FastifyServerOptions = {
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: config.trustProxy,
    logger: opts.logger ? loggerOptions(typeof opts.logger === 'object' ? opts.logger : {}) : false,
  };
  const app = Fastify(fastifyOpts);

  await registerHelmet(app, config);
  await app.register(cookie);

  // JSON body parser: empty body => {}, never inherit __proto__ keys.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: BODY_LIMIT_BYTES }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text, (k, v) => (k === '__proto__' ? undefined : v)));
    } catch {
      done(new HttpError(400, 'validation', 'Request body is not valid JSON'));
    }
  });

  app.decorateRequest('auth', null);

  const guard = csrfGuard(config);
  app.addHook('onRequest', async (request, reply) => {
    await guard(request);
    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/api/') && path !== '/api') return;
    if (PUBLIC_PATHS.has(path)) return;

    const token = request.cookies[SESSION_COOKIE];
    const session = token ? lookupSession(deps.db, token, now()) : null;
    const ctx = session ? buildAuthContext(deps, findUserById(deps.db, session.userId), session.tokenHash) : null;
    if (!ctx || !token) {
      if (token) clearSessionCookie(deps, reply);
      throw new HttpError(401, 'unauthenticated', 'Sign in required');
    }
    request.auth = ctx;
    if (session?.slid) setSessionCookie(deps, reply, token);
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      if (error.headers) for (const [k, v] of Object.entries(error.headers)) reply.header(k, v);
      return reply.code(error.status).send({
        error: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
    }
    const fe = error as { statusCode?: number; code?: string; message?: string };
    if (fe.statusCode === 413) {
      return reply.code(413).send({ error: 'validation', message: 'Request body is too large' });
    }
    if (fe.statusCode === 415) {
      return reply.code(403).send({ error: 'forbidden', message: 'Requests must use Content-Type: application/json' });
    }
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply.code(fe.statusCode).send({ error: 'validation', message: 'The request could not be processed' });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong on the server' });
  });

  const webRoot = opts.webRoot === undefined ? DEFAULT_WEB_ROOT : opts.webRoot;
  const serveWeb = webRoot !== null && existsSync(join(webRoot, 'index.html'));

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (path.startsWith('/api/') || path === '/api') {
      return reply.code(404).send({ error: 'not_found', message: 'No such endpoint' });
    }
    if (serveWeb && request.method === 'GET' && (request.headers.accept ?? '').includes('text/html')) {
      reply.header('Cache-Control', 'no-cache');
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });

  app.get('/api/health', async () => ({ ok: true, mode: config.mode, schema_version: schemaVersion(deps.db) }));
  registerAuthRoutes(app, deps);
  registerRecordRoutes(app, deps);
  registerAuditRoutes(app, deps);
  registerAnchorRoutes(app, deps);
  registerTaskRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerDataRoutes(app, deps);
  registerSettingsRoutes(app, deps);

  if (serveWeb && webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      index: ['index.html'],
      setHeaders(reply, filePath) {
        reply.header('Cache-Control', filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  return app;
}
