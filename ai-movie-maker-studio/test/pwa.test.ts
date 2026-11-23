/** PWA file checks: manifest, icons (real sizes), HTML tags, offline page, service worker rules. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const pub = (...p: string[]) => path.resolve('public', ...p);
const manifest = JSON.parse(fs.readFileSync(pub('manifest.webmanifest'), 'utf8')) as {
  name: string; short_name: string; start_url: string; scope: string; display: string; theme_color: string; background_color: string; id: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};
const png = (file: string) => {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

describe('web app manifest', () => {
  it('has the fields an installable app needs', () => {
    assert.equal(manifest.name, 'AI Movie Maker Studio');
    assert.ok(manifest.short_name.length <= 12, 'short name fits under the icon');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.id, '/');
    for (const c of [manifest.theme_color, manifest.background_color]) assert.match(c, /^#[0-9A-Fa-f]{6}$/);
  });
  it('lists 192 and 512 icons plus a maskable one, and every file exists with the declared size', () => {
    const purposes = (size: string, purpose: string) => manifest.icons.filter((i) => i.sizes === size && i.purpose === purpose);
    assert.equal(purposes('192x192', 'any').length, 1);
    assert.equal(purposes('512x512', 'any').length, 1);
    assert.equal(purposes('512x512', 'maskable').length, 1);
    for (const icon of manifest.icons) {
      const { w, h } = png(pub(icon.src.replace(/^\//, '')));
      assert.equal(`${w}x${h}`, icon.sizes, icon.src);
      assert.equal(icon.type, 'image/png');
    }
    assert.deepEqual(png(pub('icons/apple-touch-icon.png')), { w: 180, h: 180 });
  });
});

describe('index.html and offline page', () => {
  const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
  it('links the manifest, theme colour, icons and has a mobile viewport', () => {
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /<meta name="theme-color" content="#0B0D11"/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
    assert.match(html, /<link rel="icon" href="\/icons\/icon\.svg"/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /apple-mobile-web-app-capable/);
  });
  it('offline page has no script and no inline event handlers (the Content-Security-Policy forbids them)', () => {
    const off = fs.readFileSync(pub('offline.html'), 'utf8');
    assert.ok(!/<script/i.test(off));
    assert.ok(!/\son[a-z]+\s*=/i.test(off), 'no inline onclick etc.');
    assert.match(off, /<a href="\/">/);
    assert.match(off, /ইন্টারনেট/, 'Bengali text present');
  });
});

describe('service worker', () => {
  const sw = fs.readFileSync(pub('sw.js'), 'utf8');
  it('is valid JavaScript', () => {
    const r = spawnSync(process.execPath, ['--check', pub('sw.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
  it('never caches API answers, media or health; handles only same-origin GET', () => {
    assert.match(sw, /NEVER_CACHE\s*=\s*\[[^\]]*\/\^\\\/api\\\//);
    assert.match(sw, /\\\/media\\\//);
    assert.match(sw, /\\\/health/);
    assert.match(sw, /req\.method !== 'GET'\) return/);
    assert.match(sw, /url\.origin !== self\.location\.origin\) return/);
  });
  it('has the three behaviours: navigation fallback to the shell then the offline page, cache-first assets, cache cleanup', () => {
    assert.match(sw, /caches\.match\('\/offline\.html'\)/);
    assert.match(sw, /pathname\.startsWith\('\/assets\/'\)/);
    assert.match(sw, /caches\.delete\(key\)/);
    assert.match(sw, /self\.clients\.claim\(\)/);
  });
  it('is registered only in production builds', () => {
    const main = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
    assert.match(main, /import\.meta\.env\.PROD && 'serviceWorker' in navigator/);
  });
});
