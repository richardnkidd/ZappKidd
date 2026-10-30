import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiPort = Number(process.env.PORT ?? 8787);
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Network exposure of the dev server (SEC-003/SEC-004): listening beyond this computer is allowed only for the
// fictional demo, or for local mode WITHOUT development identities (password sign-in).
const lan = process.env.KADODE_LAN === '1';
const mode = process.env.KADODE_MODE ?? 'local-demo';
if (lan && mode !== 'local-demo' && process.env.KADODE_DEV_IDENTITIES === '1') {
  throw new Error(
    'Refusing KADODE_LAN=1 with development identities over real data. Use password sign-in (unset KADODE_DEV_IDENTITIES) or run the demo.',
  );
}

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  resolve: {
    alias: { '@shared': here('./src/shared') },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: lan ? '0.0.0.0' : '127.0.0.1',
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    fs: {
      // Serve only what the app needs; never the private/ folder, databases or secrets (SEC-004).
      strict: true,
      allow: [here('./src/web'), here('./src/shared'), here('./node_modules')],
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/private/**', '**/*.db', '**/*.db-*', '**/.git/**'],
    },
  },
  // assetsInlineLimit 0: fonts/images ship as files so the strict CSP (font-src 'self') never meets data: URLs.
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
});
