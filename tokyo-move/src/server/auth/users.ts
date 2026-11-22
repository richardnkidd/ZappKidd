/** User rows, development identities and password management. */
import type { Db } from '../db/db';
import type { Person, PersonKind } from '../../shared/types';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password';

export interface UserRow {
  id: string;
  household_id: string;
  person_id: string;
  username: string;
  password_hash: string | null;
  is_dev_identity: number;
  disabled: number;
  created_at: string;
}

export interface DevIdentity {
  user_id: string;
  username: string;
  person_id: string;
  household_id: string;
  display_name: string;
}

/**
 * Create (idempotently) one development user per adult person of the household: username `dev-<person_id>`
 * (`dev-<household_id>-<person_id>` if that name is taken by another household), `is_dev_identity = 1`,
 * no password. Returns the identities that now exist for this household.
 */
export function ensureDevIdentities(db: Db, householdId: string, now: () => Date = () => new Date()): DevIdentity[] {
  const adults = db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? AND kind = 'adult' ORDER BY id")
    .all(householdId) as { id: string; display_name: string }[];
  const insert = db.prepare(
    `INSERT INTO users (id, household_id, person_id, username, password_hash, is_dev_identity, disabled, created_at)
     VALUES (?, ?, ?, ?, NULL, 1, 0, ?)`,
  );
  const tx = db.transaction(() => {
    for (const adult of adults) {
      const userId = `dev:${householdId}:${adult.id}`;
      const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
      if (existing) continue;
      let username = `dev-${adult.id}`;
      const taken = db.prepare('SELECT household_id FROM users WHERE username = ?').get(username) as
        | { household_id: string }
        | undefined;
      if (taken && taken.household_id !== householdId) username = `dev-${householdId}-${adult.id}`;
      else if (taken) continue; // same household already has a user with this name; leave it alone
      insert.run(userId, householdId, adult.id, username, now().toISOString());
    }
  });
  tx();
  return listDevIdentities(db, householdId);
}

export function listDevIdentities(db: Db, householdId?: string): DevIdentity[] {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.username, u.person_id, u.household_id, p.display_name
         FROM users u JOIN people p ON p.household_id = u.household_id AND p.id = u.person_id
        WHERE u.is_dev_identity = 1 AND u.disabled = 0 AND p.kind = 'adult'
          ${householdId ? 'AND u.household_id = ?' : ''}
        ORDER BY u.household_id, p.id`,
    )
    .all(...(householdId ? [householdId] : [])) as DevIdentity[];
  return rows;
}

export function countEnabledDevIdentities(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_dev_identity = 1 AND disabled = 0').get() as { n: number };
  return row.n;
}

export function disableAllDevIdentities(db: Db): number {
  return db.prepare('UPDATE users SET disabled = 1 WHERE is_dev_identity = 1 AND disabled = 0').run().changes;
}

export function findUserByUsername(db: Db, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as UserRow | undefined;
}

export function findUserById(db: Db, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export async function setUserPassword(db: Db, userId: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const hash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, disabled = 0 WHERE id = ?').run(hash, userId);
  // A password change ends every existing session of that user.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Create a real (non-development) login for an existing adult person. */
export function createUser(
  db: Db,
  input: { householdId: string; personId: string; username: string; id?: string },
  now: () => Date = () => new Date(),
): UserRow {
  const person = db
    .prepare('SELECT kind FROM people WHERE household_id = ? AND id = ?')
    .get(input.householdId, input.personId) as { kind: PersonKind } | undefined;
  if (!person) throw new Error('No such person in that household');
  if (person.kind !== 'adult') throw new Error('Only adults can have a login');
  if (!/^[a-z0-9][a-z0-9._-]{1,40}$/i.test(input.username)) throw new Error('Username must be 2-41 letters, digits, . _ -');
  const id = input.id ?? `user:${input.householdId}:${input.personId}`;
  db.prepare(
    `INSERT INTO users (id, household_id, person_id, username, password_hash, is_dev_identity, disabled, created_at)
     VALUES (?, ?, ?, ?, NULL, 0, 0, ?)`,
  ).run(id, input.householdId, input.personId, input.username, now().toISOString());
  return findUserById(db, id) as UserRow;
}

export function listPeople(db: Db, householdId: string): Person[] {
  const rows = db
    .prepare('SELECT * FROM people WHERE household_id = ? ORDER BY CASE kind WHEN \'adult\' THEN 0 ELSE 1 END, id')
    .all(householdId) as {
    id: string;
    household_id: string;
    display_name: string;
    kind: PersonKind;
    aliases: string;
    descriptor: string | null;
    anchors: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    household_id: r.household_id,
    display_name: r.display_name,
    kind: r.kind,
    aliases: safeParse(r.aliases, [] as string[]),
    descriptor: r.descriptor,
    anchors: safeParse(r.anchors, {} as Person['anchors']),
  }));
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
