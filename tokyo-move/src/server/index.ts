/**
 * Server entry point (`npm start`, `npm run dev:server`).
 *
 * Env: KADODE_MODE (local-demo|local|staging|production, default local-demo), PORT (8787), HOST (127.0.0.1),
 * KADODE_LAN=1 (allow 0.0.0.0, logs a warning), KADODE_DB, KADODE_DATA_DIR (default private/data),
 * KADODE_DEV_IDENTITIES=1 (local mode only), KADODE_COOKIE_SECURE (required in staging/production),
 * KADODE_ALLOWED_ORIGINS (comma list, e.g. the Vite dev origin), KADODE_TRUST_PROXY=1,
 * KADODE_TASK_ADAPTER (fixture|snapshot|script), KADODE_TASK_FIXTURE_FAIL (create|update|complete|readback).
 */
import { buildApp } from './app';
import { openDb } from './db/db';
import { createDefaultTaskAdapter } from './tasks';
import { devIdentitiesActive, resolveRuntimeConfig } from './runtime';
import { countEnabledDevIdentities, ensureDevIdentities } from './auth/users';

async function main(): Promise<void> {
  const cfg = resolveRuntimeConfig(process.env);
  const db = openDb(cfg.dbPath);

  if ((cfg.mode === 'staging' || cfg.mode === 'production') && countEnabledDevIdentities(db) > 0) {
    db.close();
    throw new Error(
      `Refusing to start in ${cfg.mode} mode: the database contains enabled development identities. ` +
        'Run `npm run user:password -- --disable-dev-identities` first.',
    );
  }

  const households = db.prepare('SELECT id FROM households ORDER BY id').all() as { id: string }[];
  if (cfg.mode === 'local-demo' && households.length === 0) {
    // First run of the demo: load the fictional household so there is something to look at.
    const { applyBundle } = await import('../import/apply');
    const { buildDemoBundle } = await import('../../fixtures/demo/bundle');
    const result = applyBundle(db, buildDemoBundle(), { actor: 'system' });
    console.log(`Seeded the fictional demo household (${result.status}).`);
    households.push(...(db.prepare('SELECT id FROM households ORDER BY id').all() as { id: string }[]));
  }
  if (devIdentitiesActive(cfg)) {
    for (const h of households) ensureDevIdentities(db, h.id);
  }

  const taskAdapter = createDefaultTaskAdapter(cfg.mode, db, cfg.dataDir);
  const app = await buildApp({
    db,
    mode: cfg.mode,
    dataDir: cfg.dataDir,
    taskAdapter,
    logger: { level: cfg.logLevel },
    cookieSecure: cfg.cookieSecure,
    devIdentities: cfg.devIdentitiesRequested,
    allowedOrigins: cfg.allowedOrigins,
    trustProxy: cfg.trustProxy,
  });

  for (const w of cfg.warnings) app.log.warn(w);
  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`Kadode (${cfg.mode}) ready on http://${cfg.host}:${cfg.port} - task adapter: ${taskAdapter.name}`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
