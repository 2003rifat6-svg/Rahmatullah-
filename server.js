// চিত্রপট — চরিত্র ঠিক রেখে AI ভিডিও আর ছবি বানানোর স্টুডিও
// এই ফাইল শুধু সার্ভার চালু করে: সেটিং, ডেটাবেস, স্টোরেজ, কাজের সারি, HTTP, নিরাপত্তা হেডার, বন্ধ করা।
// আসল কাজ lib/ ফোল্ডারে: app.js (রুট), jobs.js (সারি), gemini.js, db.js, storage.js, assets.js।
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { loadConfig, checkConfig } = require('./lib/config');
const { openDb } = require('./lib/db');
const { createStorage } = require('./lib/storage');
const { createGemini } = require('./lib/gemini');
const { createAssets } = require('./lib/assets');
const { createWorker } = require('./lib/jobs');
const { createApp } = require('./lib/app');

const gzip = promisify(zlib.gzip);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const cfg = loadConfig(ROOT);

// লগ: এক লাইনে JSON (Railway/Cloud লগে খোঁজা সহজ)
function log(level, msg, extra = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === 'error' ? console.error : console.log)(line);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest']);

function computeVersion() {
  const h = crypto.createHash('sha1');
  // ভেতরের ফোল্ডারসহ (যেমন public/brand) সব ফাইল
  for (const f of fs.readdirSync(PUBLIC_DIR, { recursive: true }).map(String).sort()) {
    const full = path.join(PUBLIC_DIR, f);
    if (fs.statSync(full).isFile()) h.update(f).update(fs.readFileSync(full));
  }
  return h.digest('hex').slice(0, 10);
}

async function main() {
  const { errors, warnings } = checkConfig(cfg);
  for (const e of errors) log('error', 'config', { error: e });
  if (errors.length) process.exit(1);

  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = await openDb({ url: cfg.databaseUrl, sqliteFile: path.join(cfg.dataDir, 'chitropot.db'), poolSize: cfg.dbPool });
  // সেশনের চাবি ডেটাবেসে থাকে, তাই সব সার্ভার একই চাবি পায় (আগের ভার্সনের ফাইল থাকলে সেটাই, যাতে কেউ লগআউট না হয়)
  let secret = cfg.sessionSecret;
  if (!secret) {
    let legacy = '';
    try { legacy = fs.readFileSync(path.join(cfg.dataDir, '.session-secret'), 'utf8').trim(); } catch { /* নেই */ }
    secret = await db.setting('session_secret', () => legacy || crypto.randomBytes(32).toString('hex'));
  }
  const storage = createStorage(cfg);
  const gemini = createGemini(cfg);
  const assets = createAssets({ db, storage });
  let app = null;
  const worker = createWorker({ cfg, db, gemini, assets, log, onDone: x => app && app.autoTitle(x) });
  const version = computeVersion();
  app = createApp({ cfg, db, storage, gemini, assets, worker, log, secret, version });

  /* ---------- স্ট্যাটিক ফাইল (মেমরিতে, gzip সহ) ---------- */
  const staticCache = new Map();
  async function loadStatic(name) {
    if (staticCache.has(name)) return staticCache.get(name);
    const file = path.resolve(PUBLIC_DIR, name);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return null;
    let buf;
    try { buf = await fs.promises.readFile(file); } catch { return null; }
    const ext = path.extname(file);
    if (ext === '.html') buf = Buffer.from(buf.toString('utf8').replaceAll('__V__', version));
    const entry = { buf, type: MIME[ext] || 'application/octet-stream', ext, etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"' };
    if (COMPRESS.has(ext)) entry.gz = await gzip(buf);
    staticCache.set(name, entry);
    return entry;
  }
  const mediaOrigin = cfg.mediaOrigin ? ' ' + cfg.mediaOrigin : '';
  const CSP = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://*.googleusercontent.com${mediaOrigin}`,
    `media-src 'self' blob:${mediaOrigin}`,
    `connect-src 'self' https://accounts.google.com/gsi/${mediaOrigin}`,
    'frame-src https://accounts.google.com/gsi/',
    "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');

  async function serveStatic(req, res, name, url) {
    const s = await loadStatic(name);
    if (!s) return sendJson(req, res, 404, { error: 'পাওয়া যায়নি' });
    const headers = { 'content-type': s.type, etag: s.etag, vary: 'accept-encoding' };
    headers['cache-control'] = url.searchParams.has('v') && s.ext !== '.html' ? 'public, max-age=31536000, immutable' : 'no-cache';
    if (s.ext === '.html') headers['content-security-policy'] = CSP;
    if (name === 'sw.js') headers['service-worker-allowed'] = '/';
    if (req.headers['if-none-match'] === s.etag) { res.writeHead(304, headers); return res.end(); }
    const useGz = s.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (useGz) headers['content-encoding'] = 'gzip';
    const body = useGz ? s.gz : s.buf;
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function sendJson(req, res, status, obj) {
    if (res.headersSent) return;
    let body = Buffer.from(JSON.stringify(obj));
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = await gzip(body);
      headers['content-encoding'] = 'gzip';
      headers.vary = 'accept-encoding';
    }
    headers['content-length'] = body.length;
    res.writeHead(status, headers);
    res.end(body);
  }
  // অনুরোধের ডেটা পড়া। সীমার বেশি হলে বাকিটা ফেলে দিয়ে পরিষ্কার 413 উত্তর (খুব বিশাল হলে সংযোগ কাটা)
  // কাঁচা ফাইল (অডিও/ভিডিও আপলোড): JSON নয়, সরাসরি বাইট
  function readRaw(req, limit) {
    return new Promise((resolve, reject) => {
      if (+req.headers['content-length'] > limit) { req.resume(); req.on('end', () => {}); return reject(app.httpErr(413, `ফাইল ${Math.round(limit / 1048576)} MB-এর বেশি হতে পারবে না`)); }
      let size = 0;
      const chunks = [];
      req.on('data', c => { size += c.length; if (size > limit) req.destroy(); else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
      req.on('close', () => { if (size > limit) reject(app.httpErr(413, 'ফাইল খুব বড়')); });
    });
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      if (+req.headers['content-length'] > 64 * 1024 * 1024) { req.destroy(); return reject(app.httpErr(413, 'ডেটা খুব বড়')); }
      let size = 0;
      let tooLarge = false;
      const chunks = [];
      req.on('data', c => {
        size += c.length;
        if (size > limit) { tooLarge = true; chunks.length = 0; if (size > 64 * 1024 * 1024) req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        if (tooLarge) return reject(app.httpErr(413, 'ডেটা খুব বড়'));
        if (!chunks.length) return resolve({});
        let o;
        try { o = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { o = undefined; }
        if (!o || typeof o !== 'object' || Array.isArray(o)) return reject(app.httpErr(400, 'ডেটার ফরম্যাট ঠিক নেই'));
        resolve(o);
      });
      req.on('error', reject);
    });
  }

  /* ---------- হেলথ চেক ---------- */
  let shuttingDown = false;
  let storageOk = { at: 0, ok: true };
  async function health(req, res) {
    const out = { ok: !shuttingDown, version, database: db.kind, storage: storage.kind, worker: cfg.runWorker, activeJobs: worker.activeCount(), uptime: Math.round(process.uptime()) };
    try { await db.ping(); } catch (e) { out.ok = false; out.databaseError = e.message; }
    if (Date.now() - storageOk.at > 60e3) {
      storageOk = { at: Date.now(), ok: await storage.ping().then(() => true, e => { log('error', 'storage.ping', { error: e.message }); return false; }) };
    }
    if (!storageOk.ok) { out.ok = false; out.storageError = 'স্টোরেজে লেখা যাচ্ছে না'; }
    return sendJson(req, res, out.ok ? 200 : 503, out);
  }

  /* ---------- অনুরোধ সামলানো ---------- */
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (cfg.publicUrl.startsWith('https://')) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');

    if (p === '/healthz' || p === '/readyz') return health(req, res);

    if (p.startsWith('/media/')) {
      const id = p.slice(7);
      if (!/^[A-Za-z0-9]{1,64}$/.test(id)) return sendJson(req, res, 404, { error: 'ফাইল পাওয়া যায়নি' });
      const r = await app.handleMedia(req, res, url, id);
      if (r === false) return sendJson(req, res, 401, { error: 'আগে লগইন করো' });
      if (r === null) return sendJson(req, res, 404, { error: 'ফাইল পাওয়া যায়নি' });
      return;
    }

    if (!p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { error: 'অনুমতি নেই' });
      if (p === '/' || p === '/index.html') {
        if (!(await app.readSession(req))) { res.writeHead(302, { location: '/login.html' }); return res.end(); }
        return serveStatic(req, res, 'index.html', url);
      }
      let name;
      try { name = decodeURIComponent(p).replace(/^\/+/, ''); } catch { return sendJson(req, res, 400, { error: 'ভুল ঠিকানা' }); }
      return serveStatic(req, res, name, url);
    }

    const r = app.routes.find(x => x.method === req.method && x.re.test(p));
    if (!r) return sendJson(req, res, 404, { error: 'রুট পাওয়া যায়নি' });
    // CSRF: অন্য সাইট থেকে এই হেডার পাঠানো যায় না
    if (req.method !== 'GET' && req.headers['x-cp'] !== '1') return sendJson(req, res, 403, { error: 'অনুরোধ যাচাই হয়নি' });
    const user = await app.readSession(req);
    if (user) user.lang = req.headers['x-lang'] === 'en' ? 'en' : 'bn'; // AI উত্তর কোন ভাষায় হবে
    if (!r.opts.public && !user) return sendJson(req, res, 401, { error: 'আগে লগইন করো' });
    if (r.opts.owner && !user.owner) return sendJson(req, res, 403, { error: 'শুধু মালিক এটা করতে পারবে' });
    if (r.opts.staff && !user.staff) return sendJson(req, res, 403, { error: 'শুধু মালিক বা অ্যাডমিন এটা করতে পারবে' });
    const body = req.method === 'GET' || req.method === 'DELETE' ? {}
      : r.opts.upload ? await readRaw(req, r.opts.upload)
      : await readBody(req, r.opts.bigBody ? 12 * 1024 * 1024 : 1024 * 1024);
    const params = { ...(p.match(r.re).groups || {}) };
    const out = await r.handler({ req, res, user, params, body, url });
    // raw রুট (ফাইল/ZIP) নিজেই উত্তর লেখে
    if (!r.opts.raw && !res.headersSent) await sendJson(req, res, 200, out ?? { ok: true });
  }

  const server = http.createServer((req, res) => {
    const started = Date.now();
    handle(req, res).catch(err => {
      const status = err.status || 500;
      if (status >= 500) log('error', 'request.fail', { path: req.url.split('?')[0], status, error: err.message, stack: status === 500 ? String(err.stack).slice(0, 800) : undefined });
      if (res.headersSent) return res.destroy();
      sendJson(req, res, status, { error: status === 500 ? 'সার্ভারে সমস্যা হয়েছে' : err.message }).catch(() => res.destroy());
    }).finally(() => {
      const ms = Date.now() - started;
      if (ms > 2000 && !req.url.startsWith('/media/') && !req.url.includes('/export')) log('warn', 'request.slow', { path: req.url.split('?')[0], ms });
    });
  });
  server.requestTimeout = 30 * 60e3; // বড় প্রজেক্ট এক্সপোর্টে সময় লাগতে পারে
  server.keepAliveTimeout = 65e3;

  server.listen(cfg.port, () => {
    console.log(`চিত্রপট চালু: http://localhost:${cfg.port}`);
    console.log(`মডেল — ভিডিও: ${cfg.videoModel}, ছবি: ${cfg.imageModel}, লেখা: ${cfg.textModel} | ডেটাবেস: ${db.kind} | স্টোরেজ: ${storage.kind} | কর্মী: ${cfg.runWorker ? worker.workerId : 'বন্ধ'}`);
    // শুরুর চেকলিস্ট: ডিপ্লয়ের লগ দেখেই বোঝা যায় কী বাকি
    const ok = (v, yes, no) => (v ? `✓ ${yes}` : `✗ ${no}`);
    console.log([
      '── চালুর চেকলিস্ট ──',
      ok(cfg.apiKey, 'Gemini key আছে', 'GEMINI_API_KEY নেই (ছবি/ভিডিও/লেখা বানানো যাবে না)'),
      ok(cfg.googleClientId || cfg.devLogin, 'Gmail লগইন চালু', 'GOOGLE_CLIENT_ID নেই (লগইন হবে না)'),
      ok(cfg.ownerEmail || cfg.devLogin, `মালিক: ${cfg.ownerEmail || 'dev'}`, 'OWNER_EMAIL নেই (কেউ মালিক হতে পারবে না)'),
      ok(cfg.panelPassword || cfg.panelPasswordHash, 'কন্ট্রোল প্যানেলের পাসওয়ার্ড আছে', 'OWNER_PANEL_PASSWORD নেই (কন্ট্রোল প্যানেল খুলবে না)'),
      ok(cfg.publicUrl, `ঠিকানা: ${cfg.publicUrl}`, 'PUBLIC_URL নেই'),
      ok(!cfg.ephemeralDisk, `ডেটা রাখার জায়গা: ${db.kind === 'pg' ? 'PostgreSQL' : cfg.dataDir} (স্থায়ী)`, 'ডেটা স্থায়ী ডিস্কে নয়, আপডেটে মুছে যাবে!'),
    ].join('\n'));
    for (const w of warnings) console.log('সতর্কতা: ' + w);
    worker.start();
    app.docStudio.start();
    app.maintenance();
    setInterval(() => app.maintenance(), 60 * 60e3).unref();
  });

  // ধীরে বন্ধ: নতুন অনুরোধ বন্ধ, চলমান কাজ গুছিয়ে রাখা, তারপর বের হওয়া
  async function shutdown(sig) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown', { signal: sig });
    server.close();
    setTimeout(() => process.exit(1), 30e3).unref();
    await worker.stop(20e3);
    await db.close().catch(() => {});
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', e => log('error', 'unhandledRejection', { error: String(e && e.message || e) }));
main().catch(e => {
  log('error', 'startup', { error: e.message, stack: String(e.stack).slice(0, 800) });
  process.exit(1);
});
