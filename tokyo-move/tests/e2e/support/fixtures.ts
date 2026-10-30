/**
 * Fixtures and helpers shared by the browser specs. Everything is written against roles, labels and visible text
 * (never CSS classes), so ongoing visual work on the screens does not break the tests.
 */
import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { ADULTS, baseUrlFor, type AdultId, type E2EServer } from './env';

/** A tiny JSON client with a session cookie and the same-origin header the server requires on writes. */
export class Api {
  constructor(
    readonly ctx: APIRequestContext,
    readonly origin: string,
  ) {}

  private headers() {
    return { Origin: this.origin };
  }

  async get<T = any>(path: string): Promise<T> {
    const res = await this.ctx.get(path);
    expect(res.status(), `GET ${path}`).toBe(200);
    return (await res.json()) as T;
  }

  /** Raw response, for tests that expect a refusal. */
  async raw(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, data?: unknown) {
    return this.ctx.fetch(path, { method, headers: this.headers(), ...(data === undefined ? {} : { data }) });
  }

  async send<T = any>(method: 'POST' | 'PATCH' | 'PUT', path: string, data: unknown, expected: number | number[] = [200, 201]): Promise<T> {
    const res = await this.raw(method, path, data);
    const ok = Array.isArray(expected) ? expected : [expected];
    expect(ok, `${method} ${path} -> ${res.status()} ${await res.text()}`).toContain(res.status());
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  post = <T = any>(path: string, data: unknown = {}, expected?: number | number[]) => this.send<T>('POST', path, data, expected);
  patch = <T = any>(path: string, data: unknown, expected?: number | number[]) => this.send<T>('PATCH', path, data, expected);

  snapshot() {
    return this.get('/api/snapshot');
  }

  /** The record as the server has it now (full row with version). */
  async record(id: string) {
    const body = await this.get(`/api/records/${encodeURIComponent(id)}`);
    return body.record;
  }

  dispose() {
    return this.ctx.dispose();
  }
}

export interface E2EFixtures {
  /** Sign this page's browser context in as a demo adult (through the API, fast) and open `path`. */
  signIn: (page: Page, who: AdultId, path?: string) => Promise<void>;
  /** A fresh browser context + page (own cookies and storage), already signed in as `who`. */
  openAs: (who: AdultId, path?: string) => Promise<{ context: BrowserContext; page: Page }>;
  /** An API client signed in as `who` on the main (or another) test server. Disposed after the test. */
  api: (who: AdultId, server?: E2EServer) => Promise<Api>;
}

async function devLogin(request: APIRequestContext, origin: string, who: AdultId): Promise<void> {
  const res = await request.post('/api/auth/dev-login', { data: { person_id: who }, headers: { Origin: origin } });
  expect(res.status(), `dev-login as ${who}: ${await res.text()}`).toBe(200);
}

export const test = base.extend<E2EFixtures>({
  signIn: async ({ baseURL }, use) => {
    await use(async (page, who, path = '/') => {
      const origin = new URL(baseURL!).origin;
      await devLogin(page.context().request, origin, who);
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    });
  },

  openAs: async ({ browser, baseURL }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async (who, path = '/') => {
      const context = await newContext(browser, testInfo, baseURL!);
      contexts.push(context);
      const origin = new URL(baseURL!).origin;
      await devLogin(context.request, origin, who);
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      return { context, page };
    });
    await Promise.all(contexts.map((c) => c.close()));
  },

  api: async ({ playwright, baseURL }, use) => {
    const made: Api[] = [];
    await use(async (who, server = undefined) => {
      const url = server ? baseUrlFor(server) : baseURL!;
      const origin = new URL(url).origin;
      const ctx = await playwright.request.newContext({ baseURL: url });
      await devLogin(ctx, origin, who);
      const client = new Api(ctx, origin);
      made.push(client);
      return client;
    });
    await Promise.all(made.map((a) => a.dispose()));
  },
});

export { expect };

/** A new isolated browser context with the same viewport/device settings as the running project. */
export async function newContext(browser: Browser, testInfo: TestInfo, baseURL: string, extra: Parameters<Browser['newContext']>[0] = {}) {
  const u = testInfo.project.use;
  return browser.newContext({
    baseURL,
    viewport: u.viewport ?? { width: 1280, height: 800 },
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    deviceScaleFactor: u.deviceScaleFactor,
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    ...extra,
  });
}

/* ------------------------------------------------------------------ small page helpers */

/** Wait until no "Loading" skeleton is on screen. */
export async function loaded(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
}

/** Open a record page directly and wait for its heading. */
export async function openRecord(page: Page, id: string, heading?: RegExp | string): Promise<void> {
  await page.goto(`/r/${encodeURIComponent(id)}`);
  await expect(page.getByRole('heading', { level: 1, ...(heading ? { name: heading } : {}) })).toBeVisible();
  await loaded(page);
}

/** Today's date (YYYY-MM-DD) in an IANA zone, computed independently of the app. */
export function todayInZone(zone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Calendar-day arithmetic on YYYY-MM-DD strings (UTC maths, so it never depends on the computer's time zone). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** "Thu, Nov 12" - how the app writes a date-only value in lists and dialogs. */
export function weekdayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Unique-enough text for records a test creates, so reruns and other projects never collide. */
export function unique(label: string, testInfo: TestInfo): string {
  return `${label} [${testInfo.project.name} ${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}]`;
}

/** The display name for an adult id. */
export const nameOf = (who: AdultId): string => ADULTS[who];

/** Open the account dialog (the button in the header that shows the person's name). */
export async function openAccount(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${name}\\b.*Account and display time zone`) }).click();
  const dialog = page.getByRole('dialog', { name: 'You' });
  await expect(dialog).toBeVisible();
  return dialog;
}
