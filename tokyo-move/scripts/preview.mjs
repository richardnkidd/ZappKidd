// `npm run preview` — one command for the local preview on this computer.
//   Installs dependencies if needed, imports the plan from ./private/source-package the first time, builds the web app
//   if the build is missing or older than the code, starts Kadode at http://127.0.0.1:8787 and opens the browser.
//   Flags: --demo (fictional demo household), --reimport (import again; the same files change nothing),
//          --source <dir> (import from another folder), --no-open (don't open a browser).
// Plain Node with no dependencies, so it can run before `npm ci`. Real data stays loopback-only: this script never
// sets KADODE_LAN, KADODE_DB or HOST, and removes them if they are set.
process.umask(0o077);
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const demo = flag('demo');
const port = Number(process.env.PORT ?? 8787);
const url = `http://127.0.0.1:${port}`;
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const bin = (name) => join(root, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);
const p = (...parts) => join(root, ...parts);

function say(line = '') {
  console.log(line ? `[kadode] ${line}` : '');
}
function fail(lines) {
  console.error('');
  for (const l of [].concat(lines)) console.error(`[kadode] ${l}`);
  console.error('');
  process.exit(1);
}
function run(cmd, cmdArgs, extraEnv = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv }, shell: isWin });
  if (r.status !== 0) fail(`\`${[cmd, ...cmdArgs].join(' ')}\` failed (exit ${r.status ?? r.signal}). The lines above say why.`);
}
function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
function newestUnder(path) {
  let newest = mtime(path);
  if (!existsSync(path) || !statSync(path).isDirectory()) return newest;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    newest = Math.max(newest, newestUnder(join(path, entry.name)));
  }
  return newest;
}
function portIsFree(n) {
  return new Promise((done) => {
    const s = createServer();
    s.once('error', () => done(false));
    s.listen(n, '127.0.0.1', () => s.close(() => done(true)));
  });
}

// 1. Node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 11)) {
  fail([
    `Kadode needs Node 22 (this is Node ${process.versions.node}).`,
    'On a Mac: brew install node@22   then follow the note brew prints to put it on your PATH, and run this again.',
  ]);
}

// 2. Dependencies (again whenever package-lock.json is newer than the last install)
const installed = p('node_modules', '.package-lock.json');
if (!existsSync(bin('tsx')) || !existsSync(bin('vite')) || mtime(p('package-lock.json')) > mtime(installed)) {
  say('Installing dependencies (first run only, about a minute)…');
  run(npm, ['ci', '--no-audit', '--no-fund']);
}

// 3. Data
const dbFile = p('private', 'data', 'kadode.db');
// npm runs scripts from the project folder; a relative --source means relative to where the command was typed.
const sourceDir = value('source') ? resolve(process.env.INIT_CWD ?? process.cwd(), value('source')) : p('private', 'source-package');
if (!demo) {
  if (!existsSync(p('private', 'corrections'))) {
    fail([
      'The private bundle is not unzipped here, so there is no real plan to show.',
      `Unzip kadode-private-bundle-….zip inside ${root}`,
      '(its files land in a folder called private/), then run this again.',
      'Just looking around? npm run preview -- --demo shows a fictional household.',
    ]);
  }
  if (!existsSync(dbFile) || flag('reimport')) {
    if (!existsSync(sourceDir)) {
      fail([
        `No source package at ${sourceDir}.`,
        'Unzip the newest private bundle here (it includes private/source-package/), or point at the folder:',
        '  npm run preview -- --source "/path/to/the Revision 2 package"',
      ]);
    }
    say(existsSync(dbFile) ? 'Importing again (the same files change nothing)…' : 'Importing your plan (first run only)…');
    run(bin('tsx'), ['scripts/import.ts', '--source', sourceDir]);
  }
}

// 4. Build (only when missing or older than the code)
const built = p('dist', 'web', 'index.html');
const codeChanged = Math.max(
  newestUnder(p('src', 'web')),
  newestUnder(p('src', 'shared')),
  mtime(p('vite.config.ts')),
  mtime(p('package-lock.json')),
);
if (codeChanged > mtime(built)) {
  say('Building the app…');
  run(bin('vite'), ['build', '--logLevel', 'warn']);
}

// 5. Start
if (!(await portIsFree(port))) {
  fail([
    `Port ${port} is already in use — Kadode is probably still running in another Terminal window.`,
    `Open ${url} in your browser, or close that window (Ctrl-C) and run this again.`,
    'To run a second copy on purpose: PORT=8788 npm run preview',
  ]);
}
const env = { ...process.env, PORT: String(port) };
for (const k of ['KADODE_LAN', 'KADODE_DB', 'HOST', 'KADODE_DATA_DIR', 'KADODE_DEV_IDENTITIES', 'KADODE_MODE']) delete env[k];
if (!demo) Object.assign(env, { KADODE_MODE: 'local', KADODE_DEV_IDENTITIES: '1' });

say(demo ? 'Starting the demo (fictional household)…' : 'Starting Kadode with your plan (this computer only)…');
const server = spawn(bin('tsx'), ['src/server/index.ts'], { cwd: root, env, stdio: 'inherit', shell: isWin });

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (server.exitCode === null) server.kill(sig);
  });
}
server.on('exit', (code, signal) => {
  if (!stopping && code !== 0) console.error(`[kadode] The server stopped (${signal ?? code}). The lines above say why.`);
  process.exit(stopping ? 0 : (code ?? 1));
});

// 6. Open the browser once the server answers
for (let i = 0; i < 60 && server.exitCode === null; i++) {
  try {
    const res = await fetch(`${url}/api/health`);
    if (res.ok) {
      say('');
      say(`Kadode is running at ${url}  —  pick ${demo ? 'Avery or Jun' : 'a person'} to sign in.`);
      say('Leave this window open while you use it. Press Ctrl-C here (or close the window) to stop.');
      say('');
      if (!flag('no-open')) {
        const opener = process.platform === 'darwin' ? 'open' : isWin ? 'explorer' : 'xdg-open';
        spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
      }
      break;
    }
  } catch {
    // not listening yet
  }
  await new Promise((r) => setTimeout(r, 500));
}
