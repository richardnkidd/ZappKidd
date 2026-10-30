import type { Db } from '../db/db';
import { parseJson } from '../util/json';

export function getSetting<T>(db: Db, householdId: string, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE household_id = ? AND key = ?').get(householdId, key) as
    | { value: string }
    | undefined;
  return row ? parseJson<T>(row.value, fallback) : fallback;
}

export function setSetting(db: Db, householdId: string, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (household_id, key, value) VALUES (?, ?, ?) ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value',
  ).run(householdId, key, JSON.stringify(value));
}
