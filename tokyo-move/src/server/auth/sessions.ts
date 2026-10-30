/** Server-side sessions. The cookie holds a random 32-byte token; the database stores only its SHA-256. */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db';

export const SESSION_COOKIE = 'kadode_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

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
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
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
}

/** Look up a session by raw token; applies expiry and slides last_seen_at / expires_at. */
export function lookupSession(db: Db, token: string, now: Date): LiveSession | null {
  if (!token || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(tokenHash) as
    | { id_hash: string; user_id: string; expires_at: string; last_seen_at: string }
    | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(tokenHash);
    return null;
  }
  let slid = false;
  let expiresAt = row.expires_at;
  if (now.getTime() - new Date(row.last_seen_at).getTime() >= TOUCH_INTERVAL_MS) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(
      now.toISOString(),
      expiresAt,
      tokenHash,
    );
    slid = true;
  }
  return { tokenHash, userId: row.user_id, expiresAt, slid };
}

export function destroySession(db: Db, token: string | undefined): void {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashToken(token));
}
