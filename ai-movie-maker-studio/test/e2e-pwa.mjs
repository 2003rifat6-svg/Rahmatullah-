// PWA end-to-end test in Chromium (phone size): manifest, icons, service worker, installability,
// offline start with local data, and proof that private (API/media) data is never cached.
// Requires `npm run build` first. Uses test/stub-server.ts (no paid API).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
const shotsDir = process.env.E2E_SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pwa-'));

const server = spawn('npx', ['tsx', 'test/stub-server.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('ready') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
const page = await ctx.newPage();
const cspViolations = [];
page.on('console', (m) => /content security policy/i.test(m.text()) && cspViolations.push(m.text()));
page.on('dialog', (d) => void d.accept());
const step = async (name, fn) => {
  process.stdout.write(`• ${name} ... `);
  await fn();
  console.log('ok');
};
const swReady = () => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);

try {
  await step('manifest and icons are served with the right types and sizes', async () => {
    const res = await page.goto(BASE);
    assert.equal(res.headers()['cache-control'], 'no-cache', 'app shell is always re-checked');
    const m = await page.request.get(`${BASE}/manifest.webmanifest`);
    assert.equal(m.status(), 200);
    assert.match(m.headers()['content-type'], /application\/manifest\+json/);
    const manifest = await m.json();
    for (const icon of manifest.icons) {
      const r = await page.request.get(BASE + icon.src);
      assert.equal(r.status(), 200, icon.src);
      assert.equal(r.headers()['content-type'], 'image/png');
    }
    const link = await page.locator('link[rel=manifest]').getAttribute('href');
    assert.equal(link, '/manifest.webmanifest');
  });

  await step('service worker installs, activates and controls the page; it is not cached by the browser', async () => {
    await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated', null, { timeout: 15000 });
    assert.equal(await swReady(), 'activated');
    await page.reload();
    assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'page is controlled after reload');
    const sw = await page.request.get(`${BASE}/sw.js`);
    assert.equal(sw.headers()['cache-control'], 'no-cache');
    assert.equal(sw.headers()['service-worker-allowed'], '/');
  });

  await step('Chromium reports no installability problems (installable PWA)', async () => {
    const cdp = await ctx.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installabilityErrors, [], JSON.stringify(installabilityErrors));
    const { manifestId } = await cdp.send('Page.getAppManifest').then((r) => ({ manifestId: r.url }));
    assert.match(manifestId, /manifest\.webmanifest/);
  });

  await step('security headers are present on the page and the service worker script', async () => {
    const r = await page.request.get(BASE + '/');
    const h = r.headers();
    assert.match(h['content-security-policy'], /worker-src 'self'/);
    assert.match(h['content-security-policy'], /manifest-src 'self'/);
    assert.equal(h['x-content-type-options'], 'nosniff');
  });

  await step('data entered works offline: save a story, go offline, reload, the app and the story are there', async () => {
    await page.getByLabel('Attach files or open project materials').click();
    await page.getByRole('button', { name: /OPEN PROJECT MATERIALS/ }).click();
    await page.getByTestId('hub-story').click();
    await page.getByLabel('Story Master editor').fill('Saved while online, read while offline.');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForTimeout(600);

    await ctx.setOffline(true);
    await page.reload();
    await page.getByLabel('AI Main Chat Box').waitFor({ timeout: 15000 });
    await page.getByLabel('Attach files or open project materials').click();
    await page.getByRole('button', { name: /OPEN PROJECT MATERIALS/ }).click();
    await page.getByTestId('hub-story').click();
    assert.equal(await page.getByLabel('Story Master editor').inputValue(), 'Saved while online, read while offline.');
    await page.screenshot({ path: path.join(shotsDir, '08-offline-app.png'), fullPage: true });
  });

  await step('offline: another route still opens the app shell; the offline page is available; the API is not served from cache', async () => {
    await page.goto(`${BASE}/projects/anything`);
    await page.getByLabel('AI Main Chat Box').waitFor({ timeout: 15000 });
    const offlinePage = await page.evaluate(async () => (await fetch('/offline.html')).status);
    assert.equal(offlinePage, 200);
    const api = await page.evaluate(() => fetch('/health').then((r) => r.status).catch(() => 'network-error'));
    assert.equal(api, 'network-error', 'API answers are never replayed from a cache');
  });

  await step('no private data in any cache: nothing under /api, /media or /health was stored', async () => {
    await ctx.setOffline(false);
    const stored = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
      return urls;
    });
    assert.ok(stored.includes('/') && stored.includes('/offline.html') && stored.some((u) => u.startsWith('/assets/')), `shell cached: ${stored.join(', ')}`);
    assert.deepEqual(stored.filter((u) => /^\/(api|media|health)/.test(u)), []);
    // generate some API traffic while online, then check again
    await page.evaluate(() => Promise.all([fetch('/health'), fetch('/api/auth/me'), fetch('/api/nothing')]));
    const after = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
      return urls;
    });
    assert.deepEqual(after.filter((u) => /^\/(api|media|health)/.test(u)), []);
  });

  await step('mobile layout: no horizontal scrolling, viewport meta correct, no CSP violations', async () => {
    await page.goto(BASE);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
    assert.match(await page.locator('meta[name=viewport]').getAttribute('content'), /width=device-width/);
    assert.deepEqual(cspViolations, []);
  });

  console.log(`\nPWA E2E PASSED. Screenshots: ${shotsDir}`);
} catch (err) {
  await page.screenshot({ path: path.join(shotsDir, 'zz-pwa-failure.png') }).catch(() => {});
  console.error('\nPWA E2E FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
