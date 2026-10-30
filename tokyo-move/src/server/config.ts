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
  /** Extra allowed browser origins (e.g. the Vite dev server origin). Same-host origins are always allowed. */
  allowedOrigins: string[];
  /** TEST ONLY: accept mutating requests that carry no Origin header (app.inject). Refused in staging/production. */
  allowMissingOrigin: boolean;
  /** Trust X-Forwarded-* headers (reverse proxy). */
  trustProxy: boolean;
}
