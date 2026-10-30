/** Security plumbing: helmet CSP, same-origin/JSON enforcement for mutating requests, logging redaction. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import type { AppConfig } from '../config';
import { HttpError } from './errors';

export const BODY_LIMIT_BYTES = 256 * 1024;

export async function registerHelmet(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.cookieSecure ? { maxAge: 15_552_000, includeSubDomains: false } : false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    xFrameOptions: { action: 'deny' },
    hidePoweredBy: true,
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.removeHeader('X-Powered-By');
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Does `origin` name the same host (and effective port) the request was addressed to? */
export function originMatchesHost(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    const o = new URL(origin);
    if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
    const h = new URL(`${o.protocol}//${host}`);
    return h.host === o.host;
  } catch {
    return false;
  }
}

/**
 * CSRF defence for every mutating /api request:
 *  - Content-Type must be application/json (forces a CORS preflight from other origins);
 *  - an Origin header must be present and match the request host (or an explicitly allowed origin).
 *    A missing Origin is accepted only when `allowMissingOrigin` is set (tests using app.inject).
 */
export function csrfGuard(config: AppConfig) {
  return async function guard(request: FastifyRequest): Promise<void> {
    if (SAFE_METHODS.has(request.method)) return;
    if (!request.url.startsWith('/api/') && request.url !== '/api') return;

    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json\s*(;.*)?$/i.test(contentType)) {
      throw new HttpError(403, 'forbidden', 'Requests must use Content-Type: application/json');
    }
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site') throw new HttpError(403, 'forbidden', 'Cross-site requests are not allowed');

    const origin = request.headers.origin;
    if (origin === undefined || origin === '') {
      if (config.allowMissingOrigin) return;
      throw new HttpError(403, 'forbidden', 'Requests must come from this site (Origin header missing)');
    }
    if (config.allowedOrigins.includes(origin)) return;
    if (originMatchesHost(origin, request.host)) return;
    throw new HttpError(403, 'forbidden', 'Requests must come from this site (Origin mismatch)');
  };
}

/** Pino options: never log bodies, cookies, authorization, query strings or set-cookie. */
export function loggerOptions(opts: { level?: string; stream?: NodeJS.WritableStream }) {
  return {
    level: opts.level ?? 'info',
    ...(opts.stream ? { stream: opts.stream } : {}),
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        'req.body',
        'body',
        'password',
        '*.password',
        'token',
        '*.token',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req(req: FastifyRequest) {
        return { method: req.method, url: req.url.split('?')[0], remoteAddress: req.ip };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
      err(err: Error & { code?: string; statusCode?: number }) {
        return { type: err.name, code: err.code, statusCode: err.statusCode, message: err.message, stack: err.stack ?? '' };
      },
    },
  };
}
