/**
 * Browser tests (Playwright + the preinstalled Chromium).
 *
 *   npm run build        # not needed: the first web server below builds dist/web (set E2E_SKIP_BUILD=1 to skip)
 *   npm run test:e2e     # all projects
 *   npx playwright test --project=phone tests/e2e/plan.spec.ts
 *
 * Every run starts three fresh throw-away servers (fictional demo household, temp databases): see
 * tests/e2e/support/env.ts. Set E2E_REUSE_SERVER=1 to attach to servers you started yourself on the same ports.
 */
import { defineConfig } from '@playwright/test';
import { baseUrlFor, E2E_PORTS } from './tests/e2e/support/env';

const launcher = 'node tests/e2e/support/start-server.mjs';
const reuseExistingServer = process.env.E2E_REUSE_SERVER === '1';

const phone = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  outputDir: './test-results',
  // Specs share one server per database, so they are written to be independent of each other and of order, but they
  // are not run in parallel with themselves: one worker keeps the timing honest on a small machine.
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: baseUrlFor('main'),
    browserName: 'chromium',
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, ...phone } },
    { name: 'small-phone', use: { viewport: { width: 320, height: 640 }, ...phone } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      name: 'main',
      command: `${launcher} main ${E2E_PORTS.main} --build`,
      url: `${baseUrlFor('main')}/api/health`,
      reuseExistingServer,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'snapshot',
      command: `${launcher} snapshot ${E2E_PORTS.snapshot} --adapter snapshot`,
      url: `${baseUrlFor('snapshot')}/api/health`,
      reuseExistingServer,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'safety',
      command: `${launcher} safety ${E2E_PORTS.safety}`,
      url: `${baseUrlFor('safety')}/api/health`,
      reuseExistingServer,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
