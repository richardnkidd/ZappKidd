/**
 * Server entry point (`npm start`, `npm run dev:server`).
 *
 * Env: KADODE_MODE (local-demo|local|staging|production; may be omitted ONLY when KADODE_DB is also unset, which runs the
 * fictional demo), PORT (8787), HOST (127.0.0.1), KADODE_LAN=1 (allow 0.0.0.0; refused with dev identities over real data
 * and in staging/production without a TLS proxy), KADODE_DB, KADODE_DATA_DIR (default private/data),
 * KADODE_DEV_IDENTITIES=1 (local mode only), KADODE_COOKIE_SECURE (required in staging/production),
 * KADODE_PUBLIC_ORIGIN (https origin the browser uses behind a proxy; adds its host to the Host allowlist),
 * KADODE_ALLOWED_ORIGINS (comma list, e.g. the Vite dev origin), KADODE_TRUST_PROXY=1 (trust X-Forwarded-For from a proxy
 * on loopback, one hop), KADODE_TASK_ADAPTER (fixture|snapshot|script), KADODE_TASK_FIXTURE_FAIL.
 */
// Everything this process creates (database, WAL, backups, exports) is private to the current user.
process.umask(0o077);

import { buildApp } from './app';
import { openDb } from './db/db';
import { createDefaultTaskAdapter } from './tasks';
import { resolveRuntimeConfig, startupChecks } from './runtime';
import { ensureDevIdentities } from './auth/users';

async function main(): Promise<void> {
  const cfg = resolveRuntimeConfig(process.env);
  const db = openDb(cfg.dbPath);

  try {
    let report = startupChecks(db, cfg);
    if (cfg.mode === 'local-demo' && report.households.length === 0) {
      // First run of the demo: load the fictional household so there is something to look at.
      const { applyBundle } = await import('../import/apply');
      const { buildDemoBundle } = await import('../../fixtures/demo/bundle');
      const result = applyBundle(db, buildDemoBundle(), { actor: 'system' });
      console.log(`Seeded the fictional demo household (${result.status}).`);
      report = startupChecks(db, cfg);
    }
    if (report.households.length === 0) {
      console.warn(`No household in ${cfg.dbPath} yet. Import a plan first (npm run import) or run the demo (unset KADODE_MODE and KADODE_DB).`);
    }
    for (const id of report.devIdentityHouseholds) ensureDevIdentities(db, id);

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
      ...(cfg.publicOrigin ? { publicOrigin: cfg.publicOrigin } : {}),
      port: cfg.port,
      trustProxy: cfg.trustProxy,
    });

    for (const w of cfg.warnings) app.log.warn(w);
    await app.listen({ port: cfg.port, host: cfg.host });
    app.log.info(
      `Kadode mode=${cfg.mode} db=${cfg.dbPath} households=[${report.households.map((h) => `${h.id}: ${h.data_label}`).join('; ')}] ` +
        `listening on http://${cfg.host}:${cfg.port} (task adapter: ${taskAdapter.name})`,
    );

    const shutdown = async (signal: string): Promise<void> => {
      app.log.info(`${signal} received, shutting down`);
      await app.close();
      db.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    db.close();
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
