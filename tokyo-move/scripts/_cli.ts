/** Shared helpers for the command-line scripts (not an entry point). */
import { isAbsolute, join, resolve } from 'node:path';
import type { AuthContext, Deps } from '../src/server/context';
import type { Db } from '../src/server/db/db';
import { listPeople } from '../src/server/auth/users';
import { parseMode } from '../src/server/config';
import { SnapshotTaskAdapter } from '../src/server/tasks';

export function parseArgs(argv: string[]): { flags: Map<string, string | true>; positional: string[] } {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else if (argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith('--')) {
        flags.set(a.slice(2), argv[i + 1] as string);
        i += 1;
      } else flags.set(a.slice(2), true);
    } else positional.push(a);
  }
  return { flags, positional };
}

export function flagString(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

export function dataDirFromEnv(cwd = process.cwd()): string {
  const d = process.env.KADODE_DATA_DIR || join('private', 'data');
  return isAbsolute(d) ? d : resolve(cwd, d);
}

/** Same default as the server: demo mode uses its own database file. */
export function dbPathFromEnv(cwd = process.cwd()): string {
  const mode = parseMode(process.env.KADODE_MODE);
  const dataDir = dataDirFromEnv(cwd);
  const p = process.env.KADODE_DB || join(dataDir, mode === 'local-demo' ? 'kadode-demo.db' : 'kadode.db');
  return isAbsolute(p) ? p : resolve(cwd, p);
}

/** A service-layer context for CLI use: acts as one person (or as nobody, seeing household records only). */
export function cliContext(db: Db, householdId: string, personId: string | null): { deps: Deps; ctx: AuthContext } {
  const people = listPeople(db, householdId);
  const household = db
    .prepare('SELECT id, name, home_timezone, display_timezone, data_label FROM households WHERE id = ?')
    .get(householdId) as AuthContext['household'] | undefined;
  if (!household) throw new Error(`No such household: ${householdId}`);
  const person = people.find((p) => p.id === personId) ?? people.find((p) => p.kind === 'adult');
  if (!person) throw new Error('Household has no adult people');
  const actor = personId ? person.id : '__cli__'; // no person => only household-visible records
  const deps: Deps = {
    db,
    config: {
      mode: parseMode(process.env.KADODE_MODE),
      dataDir: dataDirFromEnv(),
      cookieSecure: false,
      devIdentitiesEnabled: false,
      allowedOrigins: [],
      allowMissingOrigin: false,
      trustProxy: false,
    },
    now: () => new Date(),
    taskAdapter: new SnapshotTaskAdapter(db),
  };
  const ctx: AuthContext = {
    user: { user_id: 'cli', username: 'cli', person_id: actor, household_id: householdId },
    personId: actor,
    householdId,
    person,
    household,
    tokenHash: 'cli',
  };
  return { deps, ctx };
}
