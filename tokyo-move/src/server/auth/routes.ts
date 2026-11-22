import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../context';
import { HttpError, notAuthorizedInMode, notFound, validationError } from '../http/errors';
import { parseWith } from '../http/validate';
import { line } from '../domain/schemas';
import { buildMe } from '../domain/snapshot-service';
import { contextForUserId, requireAuth } from './context';
import { LoginRateLimiter } from './rate-limit';
import { verifyAgainstDummy, verifyPassword } from './password';
import { SESSION_ABSOLUTE_TTL_MS, SESSION_COOKIE, createSession, destroySession } from './sessions';
import { findUserByUsername, listDevIdentities } from './users';

const devLoginBody = z.strictObject({ person_id: line(100), household_id: line(100).optional() });
const loginBody = z.strictObject({ username: line(100), password: z.string().min(1).max(1000) });

export function setSessionCookie(deps: Deps, reply: FastifyReply, token: string, maxAgeSeconds = Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000)): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: deps.config.cookieSecure,
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(deps: Deps, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/', secure: deps.config.cookieSecure });
}

function requireDevMode(deps: Deps): void {
  if (!deps.config.devIdentitiesEnabled) {
    throw notAuthorizedInMode('Development identities are not available in this mode. Sign in with a password.');
  }
}

export function registerAuthRoutes(app: FastifyInstance, deps: Deps): void {
  const limiter = new LoginRateLimiter();

  app.get('/api/auth/identities', async () => {
    requireDevMode(deps);
    return {
      identities: listDevIdentities(deps.db).map((i) => ({
        user_id: i.user_id,
        person_id: i.person_id,
        household_id: i.household_id,
        display_name: i.display_name,
      })),
    };
  });

  app.post('/api/auth/dev-login', async (request, reply) => {
    requireDevMode(deps);
    const body = parseWith(devLoginBody, request.body);
    const matches = listDevIdentities(deps.db).filter(
      (i) => i.person_id === body.person_id && (body.household_id === undefined || i.household_id === body.household_id),
    );
    if (matches.length === 0) throw notFound('Identity');
    if (matches.length > 1) throw validationError('More than one household has that person; include household_id', [{ path: 'household_id', message: 'Required' }]);
    const identity = matches[0]!;
    const session = createSession(deps.db, identity.user_id, deps.now(), request.headers['user-agent'] ?? null);
    const ctx = contextForUserId(deps, identity.user_id, session.tokenHash);
    if (!ctx) throw notFound('Identity');
    setSessionCookie(deps, reply, session.token);
    return { me: buildMe(deps, ctx) };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = parseWith(loginBody, request.body);
    const nowMs = deps.now().getTime();
    // Admission is decided and recorded synchronously, before any await, so concurrent guesses cannot all pass.
    const admission = limiter.admit(body.username, request.ip, nowMs);
    if (!admission.allowed || !admission.ticket) {
      const minutes = Math.max(1, Math.ceil(admission.retryAfterSeconds / 60));
      throw new HttpError(429, 'rate_limited', `Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`, { retry_after_seconds: admission.retryAfterSeconds }, {
        'Retry-After': String(admission.retryAfterSeconds),
      });
    }
    const ticket = admission.ticket;
    try {
      const user = findUserByUsername(deps.db, body.username);
      let ok = false;
      if (user && user.password_hash) {
        ok = await verifyPassword(body.password, user.password_hash);
      } else {
        await verifyAgainstDummy(body.password);
      }
      // Development identities can never sign in with a password where they are disabled; disabled users never can.
      if (ok && user && (user.disabled === 1 || (user.is_dev_identity === 1 && !deps.config.devIdentitiesEnabled))) ok = false;
      if (!ok || !user) {
        limiter.fail(ticket, deps.now().getTime());
        throw new HttpError(401, 'unauthenticated', 'Invalid username or password');
      }
      const session = createSession(deps.db, user.id, deps.now(), request.headers['user-agent'] ?? null);
      const ctx = contextForUserId(deps, user.id, session.tokenHash);
      if (!ctx) {
        destroySession(deps.db, session.token);
        limiter.fail(ticket, deps.now().getTime());
        throw new HttpError(401, 'unauthenticated', 'Invalid username or password');
      }
      limiter.succeed(ticket);
      setSessionCookie(deps, reply, session.token);
      return { me: buildMe(deps, ctx) };
    } catch (e) {
      limiter.fail(ticket, deps.now().getTime()); // no-op if already settled
      throw e;
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    destroySession(deps.db, request.cookies[SESSION_COOKIE]);
    clearSessionCookie(deps, reply);
    return { ok: true };
  });

  app.get('/api/me', async (request) => buildMe(deps, requireAuth(request)));
}
