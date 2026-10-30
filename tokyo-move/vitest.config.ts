import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts', 'tests/web/**/*.test.tsx'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20000,
  },
});
