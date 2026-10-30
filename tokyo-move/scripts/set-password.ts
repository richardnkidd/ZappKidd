/**
 * Set a user's password (read from stdin without echo).
 * Usage:
 *   npm run user:password -- --username <name>
 *   npm run user:password -- --username <name> --create --person <person_id> [--household <id>]
 *   npm run user:password -- --disable-dev-identities
 * Piped input is also accepted:  printf '%s' "$PW" | npm run user:password -- --username <name>
 */
import { createInterface } from 'node:readline';
import { openDb } from '../src/server/db/db';
import { MIN_PASSWORD_LENGTH } from '../src/server/auth/password';
import { createUser, disableAllDevIdentities, findUserByUsername, setUserPassword } from '../src/server/auth/users';
import { dbPathFromEnv, flagString, parseArgs } from './_cli';

const { flags } = parseArgs(process.argv.slice(2));

function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: stdin });
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
      rl.once('close', () => resolve(''));
    });
  }
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const db = openDb(dbPathFromEnv());
try {
  if (flags.has('disable-dev-identities')) {
    console.log(`Disabled ${disableAllDevIdentities(db)} development identit(ies).`);
  } else {
    const username = flagString(flags, 'username');
    if (!username) {
      console.error('Usage: npm run user:password -- --username <name> [--create --person <person_id> [--household <id>]]');
      process.exit(2);
    }
    let user = findUserByUsername(db, username);
    if (!user) {
      const person = flagString(flags, 'person');
      if (!flags.has('create') || !person) {
        console.error(`No user named "${username}". Add --create --person <person_id> to create one.`);
        process.exit(1);
      }
      const households = db.prepare('SELECT id FROM households ORDER BY id').all() as { id: string }[];
      const householdId = flagString(flags, 'household') ?? households[0]?.id;
      if (!householdId || (!flagString(flags, 'household') && households.length > 1)) {
        console.error('Could not choose a household; pass --household <id>.');
        process.exit(1);
      }
      user = createUser(db, { householdId, personId: person, username });
      console.log(`Created user "${username}" for ${person}.`);
    }
    const password = await readSecret('New password: ');
    if (process.stdin.isTTY) {
      const again = await readSecret('Repeat password: ');
      if (again !== password) {
        console.error('Passwords did not match. Nothing changed.');
        process.exit(1);
      }
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters. Nothing changed.`);
      process.exit(1);
    }
    await setUserPassword(db, user.id, password);
    console.log(`Password updated for "${username}". Existing sessions for that user were ended.`);
  }
} finally {
  db.close();
}
