/**
 * Environment -> runtime settings, with the startup refusals for staging/production.
 * Kept separate from index.ts so the rules can be tested without starting a server.
 */
import { isAbsolute, join, resolve } from 'node:path';
import type { AppMode } from '../shared/types';
import { devIdentitiesAllowed, isStrictMode, parseMode, truthy } from './config';

export interface RuntimeConfig {
  mode: AppMode;
  port: number;
  host: string;
  lan: boolean;
  dbPath: string;
  dataDir: string;
  cookieSecure: boolean;
  devIdentitiesRequested: boolean;
  allowedOrigins: string[];
  trustProxy: boolean;
  logLevel: string;
  warnings: string[];
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv, cwd: string = process.cwd()): RuntimeConfig {
  const mode = parseMode(env.KADODE_MODE);
  const strict = isStrictMode(mode);
  const warnings: string[] = [];

  const absolute = (p: string) => (isAbsolute(p) ? p : resolve(cwd, p));
  const dataDir = absolute(env.KADODE_DATA_DIR || join('private', 'data'));
  // The demo must never share a file with real data.
  const dbPath = absolute(env.KADODE_DB || join(dataDir, mode === 'local-demo' ? 'kadode-demo.db' : 'kadode.db'));

  const devIdentitiesRequested = truthy(env.KADODE_DEV_IDENTITIES);
  if (strict && devIdentitiesRequested) {
    throw new Error(`Refusing to start in ${mode} mode: KADODE_DEV_IDENTITIES is set. Development identities are never allowed here.`);
  }
  const cookieSecure = truthy(env.KADODE_COOKIE_SECURE);
  if (strict && !cookieSecure) {
    throw new Error(`Refusing to start in ${mode} mode: KADODE_COOKIE_SECURE must be true (serve over HTTPS).`);
  }

  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number between 1 and 65535');

  const lan = env.KADODE_LAN === '1';
  let host = env.HOST || '127.0.0.1';
  if (lan) {
    if (LOOPBACK.has(host)) host = '0.0.0.0';
    warnings.push(`KADODE_LAN=1: listening on ${host}. Anyone on your network can reach this app. Use only on a network you trust.`);
  } else if (!LOOPBACK.has(host)) {
    throw new Error(`Refusing to listen on ${host}: set KADODE_LAN=1 to allow non-loopback binding.`);
  }

  const allowedOrigins = (env.KADODE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    mode,
    port,
    host,
    lan,
    dbPath,
    dataDir,
    cookieSecure,
    devIdentitiesRequested,
    allowedOrigins,
    trustProxy: truthy(env.KADODE_TRUST_PROXY),
    logLevel: env.LOG_LEVEL ?? 'info',
    warnings,
  };
}

export function devIdentitiesActive(cfg: Pick<RuntimeConfig, 'mode' | 'devIdentitiesRequested'>): boolean {
  return devIdentitiesAllowed(cfg.mode, cfg.devIdentitiesRequested);
}
