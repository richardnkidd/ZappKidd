import type { Db } from './db/db';
import type { AppConfig } from './config';
import type { TaskAdapter } from './tasks/adapter';
import type { Person, SessionUser, IanaZone } from '../shared/types';

/** Everything a service needs; built once in buildApp. */
export interface Deps {
  db: Db;
  config: AppConfig;
  now: () => Date;
  taskAdapter: TaskAdapter;
}

/** The authenticated caller, resolved from the session cookie. The actor in every audit entry is `personId`. */
export interface AuthContext {
  user: SessionUser;
  personId: string;
  householdId: string;
  person: Person;
  household: { id: string; name: string; home_timezone: IanaZone; display_timezone: IanaZone; data_label: string };
  tokenHash: string;
}
