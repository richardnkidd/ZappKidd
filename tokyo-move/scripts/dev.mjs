// Start the API (tsx watch) and the web dev server (vite) together. Ctrl-C stops both.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
for (const name of ['tsx', 'vite']) {
  if (!existsSync(bin(name))) {
    console.error(`Missing ${name}. Run \`npm install\` first.`);
    process.exit(1);
  }
}

const webPort = 5173;
const env = {
  ...process.env,
  // The browser talks to the Vite origin; the API must accept it as a same-site origin.
  KADODE_ALLOWED_ORIGINS: [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`, process.env.KADODE_ALLOWED_ORIGINS]
    .filter(Boolean)
    .join(','),
};

const children = [
  { name: 'api', child: spawn(bin('tsx'), ['watch', 'src/server/index.ts'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' }) },
  { name: 'web', child: spawn(bin('vite'), [], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' }) },
];

let stopping = false;
function stop(signal, code) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) if (child.exitCode === null) child.kill(signal);
  setTimeout(() => process.exit(code), 1500).unref();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(sig, 0));
for (const { name, child } of children) {
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[dev] ${name} exited (${signal ?? code}); stopping the other process.`);
      stop('SIGTERM', code ?? 1);
    }
  });
}
