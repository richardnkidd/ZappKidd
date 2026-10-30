import type { FastifyRequest } from 'fastify';
import type { Deps, AuthContext } from '../context';
import type { IanaZone } from '../../shared/types';
import { unauthenticated } from '../http/errors';
import { listPeople, findUserById, type UserRow } from './users';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook for authenticated /api requests; null otherwise. */
    auth: AuthContext | null;
  }
}

/**
 * Build the caller's context from a user row, or null if that user may not act in the current mode:
 * disabled users never can; development identities can only act where dev identities are enabled.
 */
export function buildAuthContext(deps: Deps, user: UserRow | undefined, tokenHash: string): AuthContext | null {
  if (!user || user.disabled === 1) return null;
  if (user.is_dev_identity === 1 && !deps.config.devIdentitiesEnabled) return null;
  const household = deps.db
    .prepare('SELECT id, name, home_timezone, display_timezone, data_label FROM households WHERE id = ?')
    .get(user.household_id) as
    | { id: string; name: string; home_timezone: IanaZone; display_timezone: IanaZone; data_label: string }
    | undefined;
  if (!household) return null;
  const person = listPeople(deps.db, user.household_id).find((p) => p.id === user.person_id && p.kind === 'adult');
  if (!person) return null;
  return {
    user: { user_id: user.id, username: user.username, person_id: person.id, household_id: user.household_id },
    personId: person.id,
    householdId: user.household_id,
    person,
    household,
    tokenHash,
  };
}

export function contextForUserId(deps: Deps, userId: string, tokenHash: string): AuthContext | null {
  return buildAuthContext(deps, findUserById(deps.db, userId), tokenHash);
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthenticated();
  return request.auth;
}
