// Start one throw-away Kadode server for the browser tests.
//
//   node tests/e2e/support/start-server.mjs <name> <port> [--build] [--adapter snapshot|fixture]
//
// - Creates a fresh temp folder (database + data dir) every time, so every run starts from the fictional demo seed.
// - With --build it first runs `npm run build` (the server serves dist/web). Set E2E_SKIP_BUILD=1 to reuse dist/web.
// - Runs the real entry point (src/server/index.ts) in KADODE_MODE=local-demo. Nothing here touches private/.
// - On SIGTERM/SIGINT it stops the server and deletes the temp folder.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [name, port, ...rest] = process.argv.slice(2);
if (!name || !port) {
  console.error('Usage: start-server.mjs <name> <port> [--build] [--adapter snapshot|fixture]');
  process.exit(2);
}
const flag = (f) => rest.includes(f);
const adapterIdx = rest.indexOf('--adapter');
const adapter = adapterIdx >= 0 ? rest[adapterIdx + 1] : undefined;

const dir = join(tmpdir(), 'kadode-e2e', `${name}-${port}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

if (flag('--build') && process.env.E2E_SKIP_BUILD !== '1') {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('npm run build failed; the browser tests need dist/web.');
    process.exit(build.status ?? 1);
  }
}
if (!existsSync(join(root, 'dist', 'web', 'index.html'))) {
  console.error('dist/web/index.html is missing. Run `npm run build` first.');
  process.exit(1);
}

const tsx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const env = {
  ...process.env,
  KADODE_MODE: 'local-demo',
  PORT: String(port),
  HOST: '127.0.0.1',
  KADODE_DB: join(dir, 'kadode-demo.db'),
  KADODE_DATA_DIR: dir,
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
};
// Never inherit settings that could point the test server at anything but the throw-away demo.
for (const k of ['KADODE_LAN', 'KADODE_DEV_IDENTITIES', 'KADODE_COOKIE_SECURE', 'KADODE_ALLOWED_ORIGINS', 'KADODE_TRUST_PROXY', 'KADODE_TASK_SCRIPT', 'KADODE_TASK_LIVE_WRITES', 'KADODE_TASK_FIXTURE_FAIL']) {
  delete env[k];
}
if (adapter) env.KADODE_TASK_ADAPTER = adapter;
else delete env.KADODE_TASK_ADAPTER;

const child = spawn(tsx, ['src/server/index.ts'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill('SIGTERM');
  const finish = () => {
    rmSync(dir, { recursive: true, force: true });
    process.exit(code);
  };
  child.once('exit', finish);
  setTimeout(finish, 3000).unref();
  if (child.exitCode !== null) finish();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(0));
child.on('exit', (code, signal) => {
  if (!stopping) {
    console.error(`[e2e:${name}] server exited (${signal ?? code})`);
    stop(code ?? 1);
  }
});
