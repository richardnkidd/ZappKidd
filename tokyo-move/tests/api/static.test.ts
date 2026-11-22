import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, loginAs, makeHarness, type Harness } from './helpers';

const open: Harness[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function webRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kadode-web-'));
  dirs.push(root);
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><body><div id="root">SPA shell</div></body></html>');
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log("hi")');
  return root;
}

describe('serving the built web app', () => {
  it('serves index.html, hashed assets with long caching, and falls back to the SPA for client routes', async () => {
    const h = await makeHarness({ webRoot: webRoot() });
    open.push(h);
    const c = new Client(h.app);
    const html = { accept: 'text/html' };
    const root = await h.app.inject({ method: 'GET', url: '/', headers: { host: 'kadode.test', ...html } });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('SPA shell');
    expect(root.headers['content-security-policy']).toContain("default-src 'self'");
    expect(root.headers['cache-control']).toBe('no-cache');
    const route = await h.app.inject({ method: 'GET', url: '/plan/week-3?x=1', headers: { host: 'kadode.test', ...html } });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('SPA shell');
    const asset = await h.app.inject({ method: 'GET', url: '/assets/app-abc123.js', headers: { host: 'kadode.test' } });
    expect(asset.statusCode).toBe(200);
    expect(String(asset.headers['content-type'])).toContain('javascript');
    expect(asset.headers['cache-control']).toContain('immutable');
    const missing = await h.app.inject({ method: 'GET', url: '/assets/missing.png', headers: { host: 'kadode.test', accept: 'image/png' } });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/json');
    // Unauthenticated API requests are still refused; authenticated unknown API paths are JSON 404s, never the SPA.
    expect((await c.get('/api/snapshot')).status).toBe(401);
    const authed = await loginAs(h, 'avery');
    const nope = await h.app.inject({ method: 'GET', url: '/api/nope', headers: { host: 'kadode.test', accept: 'text/html', cookie: authed.cookie! } });
    expect(nope.statusCode).toBe(404);
    expect(nope.json().error).toBe('not_found');
    const post = await h.app.inject({ method: 'POST', url: '/plan', headers: { host: 'kadode.test', 'content-type': 'application/json' }, payload: '{}' });
    expect(post.statusCode).toBe(404);
  });

  it('does not serve static files when the build is absent', async () => {
    const h = await makeHarness({ webRoot: join(tmpdir(), 'kadode-does-not-exist') });
    open.push(h);
    const res = await h.app.inject({ method: 'GET', url: '/', headers: { host: 'kadode.test', accept: 'text/html' } });
    expect(res.statusCode).toBe(404);
  });
});
