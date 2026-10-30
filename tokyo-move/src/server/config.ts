/**
 * Runtime configuration and mode rules. Pure functions so they can be unit-tested and reused by index.ts.
 */
import type { AppMode } from '../shared/types';

export const APP_MODES: readonly AppMode[] = ['local-demo', 'local', 'staging', 'production'];

export function parseMode(value: string | undefined): AppMode {
  if (value === undefined || value === '') return 'local-demo';
  if ((APP_MODES as readonly string[]).includes(value)) return value as AppMode;
  throw new Error(`KADODE_MODE must be one of ${APP_MODES.join(', ')} (got "${value}")`);
}

/** The only household id the fictional demo uses (fixtures/demo/bundle.ts keeps this in sync; a test asserts it). */
export const DEMO_HOUSEHOLD_ID = 'demo-household';

export function isStrictMode(mode: AppMode): boolean {
  return mode === 'staging' || mode === 'production';
}

/** Development identities may exist/sign in only in local-demo, or in local with the explicit flag. */
export function devIdentitiesAllowed(mode: AppMode, flag: boolean): boolean {
  if (mode === 'local-demo') return true;
  if (mode === 'local') return flag;
  return false;
}

export function truthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';
}

export interface AppConfig {
  mode: AppMode;
  dataDir: string;
  /** Set the Secure attribute on the session cookie. Always true in staging/production. */
  cookieSecure: boolean;
  /** Whether development identities may sign in (see devIdentitiesAllowed). */
  devIdentitiesEnabled: boolean;
  /**
   * Host header values (lowercase, with port) this server answers to: loopback with the bound port, the public host
   * from KADODE_PUBLIC_ORIGIN, and the hosts of any extra allowed origins. Anything else gets 421 (DNS-rebinding guard).
   */
  allowedHosts: string[];
  /** Browser origins allowed on mutating requests (normalized). Origin is compared with THIS list, never with the Host header. */
  allowedOrigins: string[];
  /** TEST ONLY: accept mutating requests that carry no Origin header (app.inject). Refused in staging/production. */
  allowMissingOrigin: boolean;
  /** Trust X-Forwarded-For from a reverse proxy on loopback (exactly one hop). */
  trustProxy: boolean;
}
