/**
 * Environment -> runtime settings, with the startup refusals that keep real data away from passwordless sign-in.
 * Kept separate from index.ts so the rules can be tested without starting a server.
 */
import { isAbsolute, join, resolve } from 'node:path';
import type { AppMode } from '../shared/types';
import type { Db } from './db/db';
import { DEMO_HOUSEHOLD_ID, devIdentitiesAllowed, isStrictMode, parseMode, truthy } from './config';
import { countEnabledDevIdentities } from './auth/users';

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
  /** KADODE_PUBLIC_ORIGIN, e.g. https://machine.tailnet.ts.net (the browser-visible address behind a proxy). */
  publicOrigin: string | null;
  trustProxy: boolean;
  logLevel: string;
  warnings: string[];
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv, cwd: string = process.cwd()): RuntimeConfig {
  // The demo is the ONLY thing the default mode may run: forgetting KADODE_MODE must never turn a real database
  // into a passwordless app.
  if (!env.KADODE_MODE && env.KADODE_DB) {
    throw new Error(
      'KADODE_MODE must be set explicitly when KADODE_DB is set (local, staging or production). ' +
        'The default local-demo mode only runs over the fictional demo database.',
    );
  }
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

  const trustProxy = truthy(env.KADODE_TRUST_PROXY);

  let publicOrigin: string | null = null;
  if (env.KADODE_PUBLIC_ORIGIN) {
    let u: URL;
    try {
      u = new URL(env.KADODE_PUBLIC_ORIGIN);
    } catch {
      throw new Error('KADODE_PUBLIC_ORIGIN must be an origin such as https://machine.tailnet.ts.net');
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
      throw new Error('KADODE_PUBLIC_ORIGIN must be a bare http(s) origin such as https://machine.tailnet.ts.net');
    }
    if (strict && u.protocol !== 'https:') {
      throw new Error(`Refusing to start in ${mode} mode: KADODE_PUBLIC_ORIGIN must be https.`);
    }
    publicOrigin = u.origin;
  }

  const lan = env.KADODE_LAN === '1';
  let host = env.HOST || '127.0.0.1';
  if (lan) {
    if (LOOPBACK.has(host)) host = '0.0.0.0';
    // Never "warning only" for the combinations that expose sign-in or credentials to the network.
    if (mode === 'local' && devIdentitiesRequested) {
      throw new Error(
        'Refusing KADODE_LAN=1 with KADODE_DEV_IDENTITIES=1 in local mode: anyone on the network could sign in as either adult without a password. ' +
          'Use password sign-in (npm run user:password), or keep the server on loopback.',
      );
    }
    if (strict && !(trustProxy && cookieSecure)) {
      throw new Error(
        `Refusing to listen on ${host} in ${mode} mode: non-loopback HTTP needs KADODE_TRUST_PROXY=1 behind a TLS-terminating proxy and secure cookies. ` +
          'Prefer listening on 127.0.0.1 and putting `tailscale serve` (or another TLS proxy) in front.',
      );
    }
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
    publicOrigin,
    trustProxy,
    logLevel: env.LOG_LEVEL ?? 'info',
    warnings,
  };
}

export function devIdentitiesActive(cfg: Pick<RuntimeConfig, 'mode' | 'devIdentitiesRequested'>): boolean {
  return devIdentitiesAllowed(cfg.mode, cfg.devIdentitiesRequested);
}

export interface HouseholdInfo {
  id: string;
  name: string;
  data_label: string;
}

export interface StartupReport {
  households: HouseholdInfo[];
  /** Households that should get development identities (never a non-demo household unless mode=local with the flag). */
  devIdentityHouseholds: string[];
}

/**
 * Checks that depend on what is in the database. Throws a plain Error (printed by index.ts) when the combination of
 * mode, flags and data would expose real data.
 */
export function startupChecks(db: Db, cfg: RuntimeConfig): StartupReport {
  const households = db.prepare('SELECT id, name, data_label FROM households ORDER BY id').all() as HouseholdInfo[];
  const strict = isStrictMode(cfg.mode);
  if (strict && countEnabledDevIdentities(db) > 0) {
    throw new Error(
      `Refusing to start in ${cfg.mode} mode: the database contains enabled development identities. ` +
        'Run `npm run user:password -- --disable-dev-identities` first.',
    );
  }
  const real = households.filter((h) => h.id !== DEMO_HOUSEHOLD_ID);
  if (cfg.mode === 'local-demo' && real.length > 0) {
    throw new Error(
      `Refusing to start in local-demo mode: this database holds ${real.length} household(s) that are not the fictional demo ` +
        `("${real.map((h) => h.data_label).join('", "')}"). local-demo allows passwordless sign-in and must never run over real data. ` +
        'Set KADODE_MODE=local (password sign-in) or point KADODE_DB at a demo database (npm run seed:demo).',
    );
  }
  const devActive = devIdentitiesActive(cfg);
  if (devActive && cfg.lan && real.length > 0) {
    throw new Error('Refusing KADODE_LAN=1 with development identities over real household data.');
  }
  const devIdentityHouseholds = devActive
    ? households.filter((h) => cfg.mode === 'local' || h.id === DEMO_HOUSEHOLD_ID).map((h) => h.id)
    : [];
  return { households, devIdentityHouseholds };
}
