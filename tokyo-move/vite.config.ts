import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.KADODE_LAN === '1' ? '0.0.0.0' : '127.0.0.1',
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false },
});
