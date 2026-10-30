/** Server-side sessions. The cookie holds a random 32-byte token; the database stores only its SHA-256. */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db';

export const SESSION_COOKIE = 'kadode_session';
/** A session dies this long after it was created, however busy it is. */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** ...and this long after it was last used. */
export const SESSION_IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Kept for callers that want the longest possible lifetime. */
export const SESSION_TTL_MS = SESSION_ABSOLUTE_TTL_MS;
const TOUCH_INTERVAL_MS = 60 * 1000;

function expiryFor(createdAtMs: number, nowMs: number): number {
  return Math.min(nowMs + SESSION_IDLE_TTL_MS, createdAtMs + SESSION_ABSOLUTE_TTL_MS);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface CreatedSession {
  token: string;
  tokenHash: string;
  expiresAt: string;
}

export function createSession(db: Db, userId: string, now: Date, userAgent: string | null): CreatedSession {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(expiryFor(now.getTime(), now.getTime())).toISOString();
  db.prepare(
    'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(tokenHash, userId, now.toISOString(), expiresAt, now.toISOString(), userAgent?.slice(0, 300) ?? null);
  // Opportunistic cleanup of expired rows.
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  return { token, tokenHash, expiresAt };
}

export interface LiveSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  /** true when the expiry was extended on this request and the cookie should be re-issued */
  slid: boolean;
  /** seconds until the session ends (for the cookie Max-Age) */
  maxAgeSeconds: number;
}

/**
 * Look up a session by raw token. Valid while BOTH the idle window (sliding) and the absolute lifetime (from creation)
 * have not passed; touches last_seen_at / expires_at at most once a minute.
 */
export function lookupSession(db: Db, token: string, now: Date): LiveSession | null {
  if (!token || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(tokenHash) as
    | { id_hash: string; user_id: string; created_at: string; expires_at: string; last_seen_at: string }
    | undefined;
  if (!row) return null;
  const nowMs = now.getTime();
  const createdMs = new Date(row.created_at).getTime();
  if (new Date(row.expires_at).getTime() <= nowMs || createdMs + SESSION_ABSOLUTE_TTL_MS <= nowMs) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(tokenHash);
    return null;
  }
  let slid = false;
  let expiresMs = new Date(row.expires_at).getTime();
  if (nowMs - new Date(row.last_seen_at).getTime() >= TOUCH_INTERVAL_MS) {
    expiresMs = expiryFor(createdMs, nowMs);
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(
      now.toISOString(),
      new Date(expiresMs).toISOString(),
      tokenHash,
    );
    slid = true;
  }
  return {
    tokenHash,
    userId: row.user_id,
    expiresAt: new Date(expiresMs).toISOString(),
    slid,
    maxAgeSeconds: Math.max(1, Math.floor((expiresMs - nowMs) / 1000)),
  };
}

export function destroyAllSessions(db: Db): number {
  return db.prepare('DELETE FROM sessions').run().changes;
}

export function destroySession(db: Db, token: string | undefined): void {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashToken(token));
}
