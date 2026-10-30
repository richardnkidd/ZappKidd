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


/** Normalize an origin string ('http://Host:80' -> 'http://host'); null if it is not an http(s) origin. */
export function normalizeOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Host header values for the loopback addresses on a bound port. */
export function loopbackHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/**
 * Allowlists derived from the listening port, the public origin and any extra (dev) origins.
 * Hosts gate EVERY request (DNS-rebinding defence); origins gate mutating requests (CSRF).
 */
export function buildAllowlists(opts: { port?: number | undefined; publicOrigin?: string | undefined; extraOrigins?: string[] | undefined }): {
  hosts: string[];
  origins: string[];
} {
  const hosts = new Set<string>();
  const origins = new Set<string>();
  if (opts.port) {
    for (const h of loopbackHosts(opts.port)) {
      hosts.add(h);
      origins.add(`http://${h}`);
    }
  }
  for (const o of [opts.publicOrigin, ...(opts.extraOrigins ?? [])]) {
    if (!o) continue;
    const n = normalizeOrigin(o);
    if (!n) throw new Error(`Not an http(s) origin: ${o}`);
    origins.add(n);
    hosts.add(new URL(n).host.toLowerCase());
  }
  return { hosts: [...hosts], origins: [...origins] };
}

const isApiPath = (p: string): boolean => p === '/api' || p.startsWith('/api/');

/**
 * First line of defence, run before CSRF, auth and static serving on every request:
 *  - the Host header must be one of the configured hosts (loopback with the bound port, the public origin's host);
 *    anything else - including a DNS-rebound attacker name - is answered 421 and nothing else runs;
 *  - the URL path must not hide /api behind percent-encoding or dot segments, so the path-prefix checks in the
 *    later hooks can trust request.url.
 */
export function requestGuard(config: AppConfig) {
  const hosts = new Set(config.allowedHosts.map((h) => h.toLowerCase()));
  return async function guard(request: FastifyRequest): Promise<void> {
    const host = request.headers.host;
    if (typeof host !== 'string' || !hosts.has(host.toLowerCase())) {
      throw new HttpError(421, 'forbidden', 'This address is not served here');
    }
    const raw = request.url.split('?')[0] ?? '';
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      throw new HttpError(400, 'validation', 'Malformed request path');
    }
    if (isApiPath(decoded) !== isApiPath(raw) || decoded.includes('\\') || decoded.includes('\u0000')) {
      throw new HttpError(400, 'validation', 'Non-canonical request path');
    }
    if (decoded.split('/').some((seg) => seg === '.' || seg === '..')) {
      throw new HttpError(400, 'validation', 'Non-canonical request path');
    }
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for every mutating /api request:
 *  - Content-Type must be application/json (forces a CORS preflight from other origins);
 *  - an Origin header must be present and be one of the CONFIGURED origins - it is never compared with the request's
 *    own Host header, which an attacker controls. A missing Origin is accepted only when `allowMissingOrigin` is set
 *    (tests using app.inject).
 */
export function csrfGuard(config: AppConfig) {
  const origins = new Set(config.allowedOrigins);
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
    const normalized = normalizeOrigin(origin);
    if (normalized && origins.has(normalized)) return;
    throw new HttpError(403, 'forbidden', 'Requests must come from this site (Origin not allowed)');
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
        'phone',
        '*.phone',
        'email',
        '*.email',
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
