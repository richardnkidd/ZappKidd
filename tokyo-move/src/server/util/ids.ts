import { randomBytes, randomUUID } from 'node:crypto';

/** Short random uppercase hex token, e.g. 'A1B2C3D4E5'. Used for keys of app-created records. */
export function shortToken(bytes = 5): string {
  return randomBytes(bytes).toString('hex').toUpperCase();
}

export function newAuditId(): string {
  return randomUUID();
}

export function newTaskLinkId(): string {
  return `task-${randomUUID()}`;
}

export function newJournalId(): string {
  return randomUUID();
}
