/** Apply any pending database migrations. Usage: npm run db:migrate */
import { openDb, schemaVersion } from '../src/server/db/db';
import { dbPathFromEnv } from './_cli';

const path = dbPathFromEnv();
const db = openDb(path); // opening runs migrations
console.log(`Database ${path} is at schema version ${schemaVersion(db)}.`);
db.close();
