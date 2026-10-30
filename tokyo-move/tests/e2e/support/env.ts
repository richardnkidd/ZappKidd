/**
 * Shared constants for the browser (Playwright) tests. Imported by playwright.config.ts and by the specs.
 *
 * Three throw-away servers are started per run, each with its own fresh database under the OS temp folder
 * (see start-server.mjs). All of them run the FICTIONAL demo household (KADODE_MODE=local-demo).
 *
 *   main      8920  fixture task adapter (create -> readback works)         most specs
 *   snapshot  8921  read-only "snapshot" task adapter (writes are refused)  shows "Waiting to be added"
 *   safety    8922  its own database, so restore/backup can run freely      data-safety spec
 *
 * Ports 8787, 8791, 8901, 5173 and 5179 are used by other tools in this workspace; do not reuse them.
 */
export const E2E_PORTS = { main: 8920, snapshot: 8921, safety: 8922 } as const;

export type E2EServer = keyof typeof E2E_PORTS;

export function baseUrlFor(server: E2EServer): string {
  return `http://127.0.0.1:${E2E_PORTS[server]}`;
}

/** The demo household's people (fictional). */
export const ADULTS = { avery: 'Avery', jun: 'Jun' } as const;
export type AdultId = keyof typeof ADULTS;
