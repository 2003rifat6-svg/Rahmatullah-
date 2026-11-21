// উন্নত টেস্ট: নিরাপত্তা, একসাথে অনেক অনুরোধ, বাতিল/আবার চেষ্টা, কোটা, অ্যাকাউন্ট, এক্সপোর্ট, পেজিনেশন,
// আর (PostgreSQL থাকলে) একাধিক সার্ভার: একই কাজ একবারই, সার্ভার মারা গেলে উদ্ধার, ধীরে বন্ধ।
// চালাও: npm run test:advanced     (একাধিক সার্ভারের অংশ: TEST_PG_ADMIN_URL=postgres://... npm run test:advanced)
// সব নকল Gemini দিয়ে; আসল API বা টাকা লাগে না।
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { startMock, PNG } = require('./mock-gemini');

const SERVER = path.join(__dirname, '..', 'server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
let passes = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('✓ ' + name); }
  catch (e) { failures++; console.log('✗ ' + name + '\n   ' + String(e.stack || e).split('\n').slice(0, 5).join('\n   ')); }
}

let portSeed = 4800 + Math.floor(Math.random() * 300);
function startServer(env) {
  const port = portSeed++;
  let out = '';
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => (out += d));
  proc.stderr.on('data', d => (out += d));
  const exited = new Promise(r => proc.on('exit', code => r(code)));
  return {
    base: `http://127.0.0.1:${port}`, proc, exited, log: () => out,
    async ready() { for (let i = 0; i < 100 && !out.includes('চালু'); i++) await sleep(100); if (!out.includes('চালু')) throw new Error('সার্ভার চালু হয়নি:\n' + out); },
  };
}
function client(base) {
  // একাধিক কুকি (সেশন cp_s + মালিকের প্যানেল cp_p) আলাদা করে মনে রাখা
  const jar = new Map();
  const c = async (method, url, body, extra = {}) => {
    const r = await fetch((c.base || base) + url, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', 'x-cp': '1', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...extra },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const sc of r.headers.getSetCookie()) {
      const [nv] = sc.split(';');
      const i = nv.indexOf('=');
      const k = nv.slice(0, i), v = nv.slice(i + 1);
      if (!v || /Max-Age=0\b/i.test(sc)) jar.delete(k); else jar.set(k, v);
    }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
  c.cookie = () => (jar.has('cp_s') ? `cp_s=${jar.get('cp_s')}` : '');
  c.setCookie = v => { const i = v.indexOf('='); if (i > 0) jar.set(v.slice(0, i), v.slice(i + 1)); };
  c.jar = jar;
  return c;
}
async function jobState(call, pid, jobId) {
  const P = (await call('GET', `/api/projects/${pid}`)).data;
  return { P, job: P.jobs.find(j => j.id === jobId) };
}
async function waitJob(call, pid, jobId, states = ['done', 'failed'], timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await jobState(call, pid, jobId);
    if (s.job && states.includes(s.job.status)) return s;
    await sleep(150);
  }
  throw new Error(`কাজ ${jobId} ${states.join('/')} অবস্থায় যায়নি`);
}
const pngBytes = n => Buffer.concat([Buffer.from(PNG, 'base64').subarray(0, 8), Buffer.alloc(n)]);
const dataUrl = buf => 'data:image/png;base64,' + buf.toString('base64');

(async () => {
  const mock = await startMock();
  const created = text => mock.calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions' && JSON.stringify(c.body.input).includes(text));
  const baseEnv = {
    DEV_LOGIN: '1', GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: mock.base, POLL_MS: '100', WORKER_POLL_MS: '200', SWEEP_MS: '500',
    JOB_LEASE_EXTRA_MS: '1000', GEMINI_RETRY_MS: '5', OWNER_EMAIL: 'owner@dev.local', OPEN_SIGNUP: '1', AUTO_TITLES: '0', GOOGLE_CLIENT_ID: '',
    DAILY_IMAGE_LIMIT: '3', GEN_RATE_PER_MIN: '200', OWNER_PANEL_PASSWORD: 'test-panel-pass-only-for-tests', TEXT_RATE_PER_MIN: '5', STORAGE_LIMIT_MB: '1', NODE_ENV: 'test', TRUST_PROXY: '0',
  };
  const pgAdmin = process.env.TEST_PG_ADMIN_URL;
  const pg1 = pgAdmin ? await require('./pgtemp').tempDatabase(pgAdmin) : null;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-adv-'));
  console.log(`ডেটাবেস: ${pg1 ? 'PostgreSQL' : 'SQLite'}`);
  const A = startServer({ ...baseEnv, DATA_DIR: dataDir, DATABASE_URL: pg1 ? pg1.url : '' });
  try {
    await A.ready();
    const owner = client(A.base);
    await owner('POST', '/api/login', { dev: 'owner' });
    const pid = (await owner('POST', '/api/projects', { name: 'পরীক্ষা' })).data.id;

    await step('নিরাপত্তা হেডার (CSP, frame) ও হেলথ চেক', async () => {
      const r = await fetch(A.base + '/login.html');
      assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      const h = await fetch(A.base + '/healthz');
      assert.equal(h.status, 200);
      assert.equal((await h.json()).ok, true);
    });

    await step('পথ-চুরি (path traversal) ও লগইন ছাড়া মিডিয়া আটকায়', async () => {
      for (const u of ['/..%2fserver.js', '/%2e%2e/server.js', '/../lib/config.js']) {
        const r = await fetch(A.base + u);
        assert.notEqual(r.status, 200, u);
        assert.ok(!(await r.text()).includes('require('), u);
      }
      assert.equal((await fetch(A.base + '/media/abc')).status, 401);
    });

    await step('SSRF: অচেনা ঠিকানার ফাইল-লিংকে API key যায় না', async () => {
      const r = await owner('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'URI_EVIL দৃশ্য', duration: 4 });
      const { job } = await waitJob(owner, pid, r.data.jobIds[0]);
      assert.equal(job.status, 'failed');
      assert.match(job.error, /অচেনা ঠিকানা/);
      assert.equal(mock.evilHits.length, 0, 'ক্ষতিকর সার্ভারে অনুরোধ গেছে');
    });

    await step('Gemini ফাইল-লিংক → রিডাইরেক্ট: স্টোরেজে key ছাড়া', async () => {
      const r = await owner('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'URI_OK দৃশ্য', duration: 4 });
      const { job } = await waitJob(owner, pid, r.data.jobIds[0]);
      assert.equal(job.status, 'done', job.error);
      assert.ok(mock.calls.some(c => c.url.startsWith('/v1beta/files/') && c.key === 'test-key'));
      assert.ok(mock.storageHits.length >= 1);
      assert.equal(mock.storageHits.at(-1).headers['x-goog-api-key'], undefined, 'রিডাইরেক্টের পর key চলে গেছে');
    });

    await step('পোলিংয়ে সাময়িক 503: কাজ ব্যর্থ হয় না', async () => {
      const r = await owner('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'FLAKY দৃশ্য', duration: 4 });
      const { job } = await waitJob(owner, pid, r.data.jobIds[0]);
      assert.equal(job.status, 'done', job.error);
    });

    let imageAsset;
    await step('মেয়াদোত্তীর্ণ Google-রেকর্ড: ছবিটাই পাঠিয়ে বদলানো', async () => {
      const g = await owner('POST', `/api/projects/${pid}/generate`, { mode: 'image', prompt: 'নদী' });
      const s = await waitJob(owner, pid, g.data.jobIds[0]);
      imageAsset = s.P.assets.find(a => a.id === s.job.asset_id);
      assert.equal(imageAsset.editable, true);
      const r = await owner('POST', `/api/assets/${imageAsset.id}/remix`, { action: 'edit', prompt: 'EXPIRE আকাশ লাল' });
      const { job } = await waitJob(owner, pid, r.data.jobId);
      assert.equal(job.status, 'done', job.error);
      const tries = created('EXPIRE');
      assert.equal(tries.length, 2);
      assert.ok(tries[0].body.previous_interaction_id);
      assert.equal(tries[1].body.previous_interaction_id, undefined);
      assert.equal(tries[1].body.input.filter(x => x.type === 'image').length, 1);
    });

    await step('ভিডিও মোট ৩০ সেকেন্ডের বেশি বাড়ানো যায় না', async () => {
      const g = await owner('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'লম্বা', duration: 15 });
      const s = await waitJob(owner, pid, g.data.jobIds[0]);
      const e1 = await owner('POST', `/api/assets/${s.job.asset_id}/remix`, { action: 'extend', duration: 10 });
      assert.equal(e1.status, 200, JSON.stringify(e1.data));
      const s2 = await waitJob(owner, pid, e1.data.jobId);
      const e2 = await owner('POST', `/api/assets/${s2.job.asset_id}/remix`, { action: 'extend', duration: 8 });
      assert.equal(e2.status, 400);
      assert.match(e2.data.error, /৩০ সেকেন্ড/);
    });

    await step('আপলোড: ছবি নয় এমন ফাইল (নাম PNG) আটকায়', async () => {
      const r = await owner('POST', `/api/projects/${pid}/upload`, { dataUrl: 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script>').toString('base64') });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /আসলে ছবি নয়/);
    });

    await step('খারাপ ডেটা: ভুল JSON, তালিকা, খুব বড় অনুরোধ', async () => {
      assert.equal((await owner('POST', '/api/projects', '{bad json')).status, 400);
      assert.equal((await owner('POST', '/api/projects', '[1,2]')).status, 400);
      assert.equal((await owner('POST', '/api/projects', JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }))).status, 413);
    });

    await step('বাতিল: চলমান ভিডিও বাতিল করলে ফাইল সেভ হয় না', async () => {
      const before = (await owner('GET', `/api/projects/${pid}`)).data.assets.length;
      const r = await owner('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'SLOW200 বাতিল', duration: 4 });
      const jid = r.data.jobIds[0];
      await waitJob(owner, pid, jid, ['running']);
      for (let i = 0; i < 40 && !created('SLOW200').length; i++) await sleep(100);
      const c = await owner('POST', `/api/jobs/${jid}/cancel`);
      assert.equal(c.status, 200);
      assert.match(c.data.note, /খরচ/);
      await sleep(1500);
      const P = (await owner('GET', `/api/projects/${pid}`)).data;
      assert.equal(P.assets.length, before);
      assert.ok(!P.jobs.some(j => j.id === jid), 'বাতিল কাজ তালিকায় দেখাচ্ছে');
    });

    await step('আবার চেষ্টা: ব্যর্থ কাজ নতুন করে সারিতে', async () => {
      const r = await owner('POST', `/api/projects/${pid}/generate`, { mode: 'image', prompt: 'BLOCKME' });
      const { job } = await waitJob(owner, pid, r.data.jobIds[0]);
      assert.equal(job.status, 'failed');
      const t = await owner('POST', `/api/jobs/${job.id}/retry`);
      assert.equal(t.status, 200);
      assert.notEqual(t.data.jobId, job.id);
      const P = (await owner('GET', `/api/projects/${pid}`)).data;
      assert.ok(!P.jobs.some(j => j.id === job.id));
      const doneJob = P.jobs.find(j => j.status === 'done');
      assert.equal((await owner('POST', `/api/jobs/${doneJob.id}/retry`)).status, 400, 'সফল কাজ আবার চালানো যায়');
    });

    const user = client(A.base);
    await user('POST', '/api/login', { dev: 'limited' });
    const upid = (await user('POST', '/api/projects', { name: 'সীমিত' })).data.id;

    await step('একসাথে ১০টি অনুরোধেও দৈনিক সীমা (৩) পেরোয় না', async () => {
      const rs = await Promise.all(Array.from({ length: 10 }, () => user('POST', `/api/projects/${upid}/generate`, { mode: 'image', prompt: 'একসাথে' })));
      const okCount = rs.filter(r => r.status === 200).length;
      assert.equal(okCount, 3, rs.map(r => r.status).join(','));
      assert.ok(rs.filter(r => r.status !== 200).every(r => r.status === 429));
    });

    await step('লেখার রেট লিমিট (মিনিটে ৫)', async () => {
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await user('POST', '/api/enhance', { prompt: 'আইডিয়া' + i })).status);
      assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
    });

    await step('স্টোরেজ কোটা (১ MB)', async () => {
      const r = await user('POST', `/api/projects/${upid}/upload`, { dataUrl: dataUrl(pngBytes(1.2 * 1024 * 1024)) });
      assert.equal(r.status, 413);
      assert.match(r.data.error, /জায়গা/);
      assert.equal((await user('POST', `/api/projects/${upid}/upload`, { dataUrl: dataUrl(pngBytes(1000)) })).status, 200);
    });

    await step('ব্যবহারের হিসাব আর অ্যাডমিন (শুধু মালিক)', async () => {
      const u = await owner('GET', '/api/usage');
      assert.equal(u.status, 200);
      assert.ok(u.data.last30.videos >= 3);
      assert.equal(u.data.daily.length, 14);
      assert.equal((await user('GET', '/api/admin/overview')).status, 403);
      const a = await owner('GET', '/api/admin/overview');
      assert.equal(a.status, 200);
      assert.ok(a.data.users.some(x => x.email === 'limited@dev.local'));
      assert.ok(a.data.activity.some(x => x.action === 'generate'));
      assert.ok(a.data.queue.done >= 1);
    });

    await step('এক্সপোর্ট: পুরো প্রজেক্ট ZIP ঠিকমতো খোলে', async () => {
      const r = await owner('GET', `/api/projects/${pid}/export`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'application/zip');
      const f = path.join(dataDir, 'export.zip');
      fs.writeFileSync(f, r.data);
      const out = execFileSync('python3', ['-I', '-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; n=z.namelist(); m=json.loads(z.read("project.json")); print(len(n), len(m["files"]), any(x.startswith("videos/") for x in n))', f]).toString().trim();
      const [n, files, hasVideos] = out.split(' ');
      assert.ok(+n >= 5);
      assert.equal(+n, +files + 1);
      assert.equal(hasVideos, 'True');
    });

    await step('পেজিনেশন: ২০৫টি ফাইল, একটাও বাদ পড়ে না', async () => {
      const ppid = (await owner('POST', '/api/projects', { name: 'অনেক ফাইল' })).data.id;
      const one = dataUrl(Buffer.from(PNG, 'base64'));
      for (let i = 0; i < 205; i += 5) {
        await Promise.all(Array.from({ length: 5 }, (_, k) => owner('POST', `/api/projects/${ppid}/upload`, { dataUrl: one, name: 'f' + (i + k) })));
      }
      const P = (await owner('GET', `/api/projects/${ppid}`)).data;
      assert.equal(P.assets.length, 200);
      assert.equal(P.assetsMore, true);
      const last = P.assets.at(-1);
      const more = (await owner('GET', `/api/projects/${ppid}/assets?before=${last.created}&beforeId=${last.id}`)).data;
      assert.equal(more.assets.length, 5);
      assert.equal(more.more, false);
      const ids = new Set([...P.assets, ...more.assets].map(a => a.id));
      assert.equal(ids.size, 205);
    });

    await step('সব ডিভাইস থেকে লগআউট: পুরনো কুকি অচল, নতুনটা চলে', async () => {
      const old = owner.cookie();
      assert.equal((await owner('POST', '/api/account/logout-all')).status, 200);
      const stale = client(A.base);
      stale.setCookie(old);
      assert.equal((await stale('GET', '/api/me')).status, 401);
      assert.equal((await owner('GET', '/api/me')).status, 200);
    });

    await step('অ্যাকাউন্ট মোছা: সব ডেটা ও ফাইল মুছে যায়', async () => {
      const d = client(A.base);
      await d('POST', '/api/login', { dev: 'deleteme' });
      const dp = (await d('POST', '/api/projects', { name: 'মুছব' })).data.id;
      await d('POST', `/api/projects/${dp}/upload`, { dataUrl: dataUrl(Buffer.from(PNG, 'base64')) });
      const me = (await d('GET', '/api/me')).data.user;
      assert.ok(fs.readdirSync(path.join(dataDir, 'media', me.id)).length > 0);
      assert.equal((await d('POST', '/api/account/delete', { confirm: 'wrong@x.y' })).status, 400);
      const old = d.cookie();
      assert.equal((await d('POST', '/api/account/delete', { confirm: 'deleteme@dev.local' })).status, 200);
      const stale = client(A.base);
      stale.setCookie(old);
      assert.equal((await stale('GET', '/api/me')).status, 401);
      assert.equal(fs.readdirSync(path.join(dataDir, 'media', me.id)).length, 0);
      const again = client(A.base);
      await again('POST', '/api/login', { dev: 'deleteme' });
      assert.equal((await again('GET', '/api/library')).data.projects.length, 0);
    });

    await step('প্রোফাইল: নিজের নাম ও ছবি, অন্যের দেখা যায়, ভুল ছবি আটকায়, অ্যাকাউন্ট মুছলে ছবিও মোছে', async () => {
      const u = client(A.base);
      await u('POST', '/api/login', { dev: 'profileuser' });
      let pf = (await u('GET', '/api/profile')).data;
      assert.equal(pf.name, 'profileuser');
      assert.match(pf.shortId, /^[0-9A-F]{8}$/);
      assert.ok(pf.joined > 0 && pf.stats && 'creations' in pf.stats);
      await u('PATCH', '/api/profile', { name: '  <b>রাজু</b> ভাই  ' });
      assert.equal((await u('GET', '/api/me')).data.user.name, 'bরাজু/b ভাই'); // < > বাদ, HTML ঢোকানো যায় না
      assert.equal((await u('POST', '/api/profile/photo', { dataUrl: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') })).status, 400);
      assert.equal((await u('POST', '/api/profile/photo', { dataUrl: dataUrl(Buffer.from(PNG, 'base64')) })).status, 200);
      const me = (await u('GET', '/api/me')).data.user;
      assert.match(me.picture, /^\/api\/avatar\/u[0-9a-f]+\?v=\d+$/);
      assert.equal(me.customPhoto, true);
      const img = await u('GET', me.picture);
      assert.equal(img.status, 200);
      const other = client(A.base);
      assert.equal((await other('GET', me.picture)).status, 401); // লগইন ছাড়া নয়
      await u('PATCH', '/api/profile', { name: '' });
      assert.equal((await u('GET', '/api/me')).data.user.name, 'profileuser'); // খালি দিলে Gmail-এর নাম
      const avatarFiles = () => fs.readdirSync(path.join(dataDir, 'media', 'avatars')).filter(f => f.startsWith(me.id));
      assert.equal(avatarFiles().length, 1);
      assert.equal((await u('POST', '/api/account/delete', { confirm: 'profileuser@dev.local' })).status, 200);
      assert.equal(avatarFiles().length, 0);
    });

    await step('মালিকের কন্ট্রোল প্যানেল: পাসওয়ার্ড + মালিকের Gmail দুটোই লাগে, ভুলে আটকায়, অ্যাপ থেকে পাসওয়ার্ড বদলানো যায় না', async () => {
      const boss = client(A.base);
      await boss('POST', '/api/login', { dev: 'owner' });
      const st = (await boss('GET', '/api/owner/status')).data;
      assert.deepEqual([st.configured, st.unlocked], [true, false]);
      assert.equal((await boss('GET', '/api/owner/users')).status, 423); // তালাবদ্ধ
      assert.equal((await boss('POST', '/api/owner/unlock', { password: 'wrong' })).status, 403);
      // অন্য ব্যবহারকারী সঠিক পাসওয়ার্ড জানলেও ঢুকতে পারে না
      const eve = client(A.base);
      await eve('POST', '/api/login', { dev: 'eve' });
      assert.equal((await eve('POST', '/api/owner/unlock', { password: 'test-panel-pass-only-for-tests' })).status, 403);
      assert.equal((await eve('GET', '/api/owner/users')).status, 403);
      // মালিকের কুকি চুরি করে প্যানেল-কুকি বানানো যায় না
      const forged = client(A.base);
      forged.setCookie(boss.cookie());
      forged.setCookie(`cp_p=${encodeURIComponent('x.0.9999999999999.fake')}`);
      assert.equal((await forged('GET', '/api/owner/users')).status, 423);
      const ok = await boss('POST', '/api/owner/unlock', { password: 'test-panel-pass-only-for-tests' });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal((await boss('GET', '/api/owner/status')).data.unlocked, true);
      assert.equal((await boss('GET', '/api/owner/users')).status, 200);
      // পাসওয়ার্ড বদলানোর কোনো রুট নেই
      for (const [m, u] of [['POST', '/api/owner/password'], ['PUT', '/api/owner/password'], ['PATCH', '/api/owner/settings']]) assert.equal((await boss(m, u, { password: 'x' })).status, 404);
      await boss('POST', '/api/owner/lock');
      assert.equal((await boss('GET', '/api/owner/users')).status, 423);
      // বারবার চেষ্টা: ১৫ মিনিটে ৫ বারের বেশি নয় (সঠিক চেষ্টাও গোনা হয়; এর আগে ১টা ভুল আর ১টা সঠিক হয়েছে)
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await boss('POST', '/api/owner/unlock', { password: 'guess' + i })).status);
      assert.deepEqual(codes, [403, 403, 403, 429]);
      assert.equal((await boss('POST', '/api/owner/unlock', { password: 'test-panel-pass-only-for-tests' })).status, 429); // সঠিক হলেও এখন অপেক্ষা
    });

    await step('ভূমিকা: অ্যাডমিন দেখাশোনা আর ছোট কাজ পারে, বড় কাজ পারে না; ব্লক, কিক, অভিযোগ, যোগাযোগ', async () => {
      // আগের পরীক্ষার ভুল চেষ্টার সীমা এড়াতে নতুন মালিক-সেশন দরকার নেই; সীমা ব্যবহারকারী+IP-তে, তাই সময় না নিয়ে নতুন সার্ভার
      const B = startServer({ ...baseEnv, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-ctl-')), DATABASE_URL: '' });
      await B.ready();
      try {
        const boss = client(B.base), mod = client(B.base), u = client(B.base);
        await boss('POST', '/api/login', { dev: 'owner' });
        await mod('POST', '/api/login', { dev: 'helper' });
        await u('POST', '/api/login', { dev: 'karim' });
        assert.equal((await mod('GET', '/api/admin/overview')).status, 403); // এখনো অ্যাডমিন নয়
        assert.equal((await boss('POST', '/api/owner/unlock', { password: 'test-panel-pass-only-for-tests' })).status, 200);
        const users = (await boss('GET', '/api/owner/users')).data.users;
        const id = e => users.find(x => x.email === e).id;
        assert.equal((await boss('POST', `/api/owner/users/${id('owner@dev.local')}/block`, {})).status, 400); // মালিককে ব্লক নয়
        assert.equal((await boss('POST', `/api/owner/users/${id('helper@dev.local')}/role`, { role: 'admin' })).status, 200);
        await sleep(50);
        assert.equal((await mod('GET', '/api/me')).data.user.role, 'admin');
        // অ্যাডমিন যা পারে
        assert.equal((await mod('GET', '/api/admin/overview')).status, 200);
        assert.equal((await mod('POST', '/api/admin/allowed', { email: 'new@gmail.com' })).status, 200);
        assert.equal((await mod('GET', '/api/staff/complaints')).status, 200);
        // অ্যাডমিন যা পারে না
        assert.equal((await mod('POST', '/api/owner/unlock', { password: 'test-panel-pass-only-for-tests' })).status, 403);
        for (const [m, url, b] of [['GET', '/api/owner/users'], ['POST', `/api/owner/users/${id('karim@dev.local')}/block`, {}], ['POST', `/api/owner/users/${id('karim@dev.local')}/kick`],
          ['POST', `/api/owner/users/${id('karim@dev.local')}/role`, { role: 'admin' }], ['PUT', '/api/owner/settings', { announcement: { text: 'hack' } }], ['DELETE', '/api/owner/allowed/new%40gmail.com']]) {
          assert.equal((await mod(m, url, b)).status, 403, url);
        }
        assert.equal((await u('GET', '/api/staff/complaints')).status, 403);
        // অভিযোগ: ব্যবহারকারী → অ্যাডমিন উত্তর → সমাধান
        const c = await u('POST', '/api/complaints', { category: 'problem', subject: 'ভিডিও আসছে না', text: 'অনেকক্ষণ ধরে আটকে আছে' });
        assert.equal(c.status, 200);
        let list = (await mod('GET', '/api/staff/complaints')).data;
        assert.equal(list.counts.open, 1);
        assert.equal(list.complaints[0].email, 'karim@dev.local');
        assert.equal(list.complaints[0].waiting, true);
        assert.equal((await mod('POST', `/api/complaints/${c.data.id}/reply`, { text: 'দেখছি, একটু অপেক্ষা করুন' })).status, 200);
        assert.equal((await mod('PATCH', `/api/staff/complaints/${c.data.id}`, { status: 'resolved' })).status, 200);
        const mine = (await u('GET', '/api/complaints')).data.complaints[0];
        assert.equal(mine.status, 'resolved');
        assert.deepEqual(mine.messages.map(m => m.staff), [false, true]);
        const other = client(B.base);
        await other('POST', '/api/login', { dev: 'other' });
        assert.equal((await other('POST', `/api/complaints/${c.data.id}/reply`, { text: 'x' })).status, 404); // অন্যের অভিযোগে নয়
        assert.equal((await u('POST', `/api/complaints/${c.data.id}/reply`, { text: 'আবার হচ্ছে' })).status, 200);
        assert.equal((await u('GET', '/api/complaints')).data.complaints[0].status, 'open'); // আবার খুলল
        // যোগাযোগের তথ্য: ভুল লিংক আটকায়, ঠিকটা সবাই (লগইন পাতাও) দেখে
        assert.equal((await boss('PUT', '/api/owner/settings', { contact: { whatsapp: '+8801711000000', facebook: 'javascript:alert(1)' } })).status, 400);
        assert.equal((await boss('PUT', '/api/owner/settings', { contact: { whatsapp: '+880 1711-000000', email: 'boss@example.com', facebook: 'https://facebook.com/chitropot', note: 'সকাল ১০টা-রাত ১০টা' } })).status, 200);
        const pub = (await client(B.base)('GET', '/api/config')).data.contact;
        assert.deepEqual(pub, { whatsapp: '+8801711000000', email: 'boss@example.com', facebook: 'https://facebook.com/chitropot', note: 'সকাল ১০টা-রাত ১০টা' });
        await boss('PUT', '/api/owner/settings', { announcement: { text: 'আজ রাতে রক্ষণাবেক্ষণ', level: 'warn' } });
        assert.equal((await u('GET', '/api/me')).data.site.announcement.text, 'আজ রাতে রক্ষণাবেক্ষণ');
        // কিক: পুরনো সেশন অচল, আবার লগইন করা যায়
        const old = u.cookie();
        assert.equal((await boss('POST', `/api/owner/users/${id('karim@dev.local')}/kick`)).status, 200);
        await sleep(50);
        const stale = client(B.base); stale.setCookie(old);
        assert.equal((await stale('GET', '/api/me')).status, 401);
        assert.equal((await u('POST', '/api/login', { dev: 'karim' })).status, 200);
        // ব্লক: সাথে সাথে বের, আবার লগইন করতে পারে না (কারণসহ), আনব্লক করলে পারে
        assert.equal((await boss('POST', `/api/owner/users/${id('karim@dev.local')}/block`, { reason: 'স্প্যাম' })).status, 200);
        await sleep(50);
        assert.equal((await u('GET', '/api/me')).status, 401);
        const denied = await client(B.base)('POST', '/api/login', { dev: 'karim' });
        assert.equal(denied.status, 403);
        assert.match(denied.data.error, /স্প্যাম/);
        await boss('POST', `/api/owner/users/${id('karim@dev.local')}/block`, { blocked: false });
        assert.equal((await client(B.base)('POST', '/api/login', { dev: 'karim' })).status, 200);
        // নতুন সদস্যের নিয়ম: শুধু অনুমতি পাওয়া
        await boss('PUT', '/api/owner/settings', { signup: 'invite' });
        assert.equal((await client(B.base)('POST', '/api/login', { dev: 'stranger' })).status, 403);
        assert.equal((await client(B.base)('POST', '/api/login', { dev: 'new' })).status, 403); // new@dev.local অনুমতিতে নেই (new@gmail.com আছে)
        // অ্যাডমিন বাদ দিলে আর পারে না
        await boss('POST', `/api/owner/users/${id('helper@dev.local')}/role`, { role: 'user' });
        await sleep(50);
        const h2 = client(B.base);
        await boss('PUT', '/api/owner/settings', { signup: 'open' });
        await h2('POST', '/api/login', { dev: 'helper' });
        assert.equal((await h2('GET', '/api/admin/overview')).status, 403);
      } finally { B.proc.kill('SIGKILL'); }
    });

    await step('ছবি-লোগো বদলানো, লেখা, হোম সাজানো, পুরো পর্দার বার্তা আর রক্ষণাবেক্ষণ', async () => {
      const C = startServer({ ...baseEnv, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-brand-')), DATABASE_URL: '' });
      await C.ready();
      try {
        const boss = client(C.base), u = client(C.base), anon = client(C.base);
        await boss('POST', '/api/login', { dev: 'owner' });
        await u('POST', '/api/login', { dev: 'karim' });
        // না বদলালে আসল ছবি (লগইন ছাড়াও, কারণ লগইন পাতায় লাগে)
        const def = await anon('GET', '/api/brand/owner');
        assert.equal(def.status, 200);
        assert.equal(def.headers.get('content-type'), 'image/webp');
        assert.deepEqual(def.data, fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'owner.webp')));
        assert.equal((await anon('GET', '/api/brand/../../etc/passwd')).status, 404);
        assert.equal((await anon('GET', '/api/brand/evil')).status, 404);
        // প্যানেল খোলা ছাড়া বদলানো যায় না; অন্য কেউ তো নয়ই
        const png = dataUrl(Buffer.from(PNG, 'base64'));
        assert.equal((await boss('PUT', '/api/owner/brand/owner', { dataUrl: png })).status, 423);
        assert.equal((await u('PUT', '/api/owner/brand/owner', { dataUrl: png })).status, 403);
        assert.equal((await boss('POST', '/api/owner/unlock', { password: 'test-panel-pass-only-for-tests' })).status, 200);
        assert.equal((await boss('PUT', '/api/owner/brand/owner', { dataUrl: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') })).status, 400);
        assert.equal((await boss('PUT', '/api/owner/brand/owner', { dataUrl: png })).status, 200);
        await boss('PUT', '/api/owner/brand-options', { framed: true });
        const now2 = await anon('GET', '/api/brand/owner');
        assert.equal(now2.headers.get('content-type'), 'image/png');
        assert.deepEqual(now2.data, Buffer.from(PNG, 'base64'));
        const cfg = (await anon('GET', '/api/config')).data;
        assert.ok(cfg.brand.v.owner > 0 && cfg.brand.framed === true);
        assert.equal((await boss('DELETE', '/api/owner/brand/owner')).status, 200);
        assert.equal((await anon('GET', '/api/brand/owner')).headers.get('content-type'), 'image/webp'); // আগেরটায় ফেরা
        // লেখা: এক জায়গায় বদলালে সবাই পায়
        await boss('PUT', '/api/owner/settings', { texts: { heroTitle: 'স্বপ্ন বানাও', tagline: 'নতুন ট্যাগলাইন', bogus: 'x' } });
        const t = (await u('GET', '/api/me')).data.site.texts;
        assert.deepEqual(t, { tagline: 'নতুন ট্যাগলাইন', heroTitle: 'স্বপ্ন বানাও' });
        assert.equal((await anon('GET', '/api/config')).data.texts.tagline, 'নতুন ট্যাগলাইন');
        // হোম সাজানো: ক্রম আর লুকানো থাকে, অচেনা বোতাম বাদ, সব লুকানো যায় না
        assert.equal((await boss('PUT', '/api/owner/settings', { layout: [{ id: 'doc', hidden: true }] })).status, 400);
        await boss('PUT', '/api/owner/settings', { layout: [{ id: 'doc' }, { id: 'evil' }, { id: 'image', label: 'ছবি বানাও' }, { id: 'video', hidden: true }] });
        const L = (await u('GET', '/api/me')).data.site.layout;
        assert.deepEqual(L.slice(0, 3), [{ id: 'doc', hidden: false }, { id: 'image', hidden: false, label: 'ছবি বানাও' }, { id: 'video', hidden: true }]);
        assert.equal(L.length, 12);
        assert.ok(L.slice(3).every(x => x.hidden));
        // পুরো পর্দার বার্তা
        await boss('PUT', '/api/owner/settings', { announcement: { text: 'নতুন ফিচার', mode: 'popup' } });
        assert.equal((await u('GET', '/api/me')).data.site.announcement.mode, 'popup');
        // রক্ষণাবেক্ষণ: সাধারণ ব্যবহারকারী বানাতে পারে না, মালিক পারে
        await boss('PUT', '/api/owner/settings', { announcement: { text: '১০ মিনিট বন্ধ', mode: 'maintenance' } });
        const up = await u('POST', '/api/projects', { name: 'x' });
        const g = await u('POST', `/api/projects/${up.data.id}/generate`, { mode: 'image', prompt: 'নদী' });
        assert.equal(g.status, 503);
        assert.match(g.data.error, /রক্ষণাবেক্ষণ চলছে: ১০ মিনিট বন্ধ/);
        const bp = await boss('POST', '/api/projects', { name: 'y' });
        assert.equal((await boss('POST', `/api/projects/${bp.data.id}/generate`, { mode: 'image', prompt: 'নদী' })).status, 200);
        await boss('PUT', '/api/owner/settings', { announcement: { text: '' } });
        assert.equal((await u('POST', `/api/projects/${up.data.id}/generate`, { mode: 'image', prompt: 'নদী' })).status, 200);
      } finally { C.proc.kill('SIGKILL'); }
    });

    await step('অতিথি প্রবেশ: Gmail ছাড়া ঘুরে দেখা, খরচের কাজ বন্ধ, অ্যাডমিন/মালিক এলাকায় নয়, মালিক চালু-বন্ধ করেন', async () => {
      const G = startServer({ ...baseEnv, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-guest-')), DATABASE_URL: '' });
      await G.ready();
      try {
        const anon = client(G.base), g = client(G.base), boss = client(G.base);
        assert.equal((await anon('GET', '/api/config')).data.guest, true); // শুরুতে চালু
        assert.equal((await g('POST', '/api/login', { guest: true })).status, 200);
        const me = (await g('GET', '/api/me')).data;
        assert.equal(me.user.role, 'guest');
        assert.equal(me.user.staff, false);
        assert.equal(me.user.owner, false);
        // ঘুরে দেখা চলে
        assert.equal((await g('GET', '/api/library')).status, 200);
        assert.equal((await g('GET', '/api/usage')).status, 200);
        assert.equal((await g('GET', '/api/voices')).status, 200);
        const p1 = await g('POST', '/api/projects', { name: 'আমার প্রথম' });
        assert.equal(p1.status, 200);
        assert.equal((await g('GET', `/api/projects/${p1.data.id}`)).status, 200);
        assert.equal((await g('POST', `/api/projects/${p1.data.id}/characters`, { name: 'রাজু', description: 'x' })).status, 200);
        assert.equal((await g('POST', '/api/complaints', { category: 'idea', subject: 'পরামর্শ', text: 'ভালো' })).status, 200);
        // খরচ বা ফাইল জমা হয় এমন কাজ বন্ধ
        const blocked = [
          ['POST', `/api/projects/${p1.data.id}/generate`, { mode: 'image', prompt: 'নদী' }],
          ['POST', '/api/enhance', { prompt: 'নদী' }],
          ['POST', `/api/projects/${p1.data.id}/upload`, { dataUrl: dataUrl(Buffer.from(PNG, 'base64')) }],
          ['POST', '/api/profile/photo', { dataUrl: dataUrl(Buffer.from(PNG, 'base64')) }],
          ['GET', '/api/voices/Kore/preview'],
          ['POST', '/api/doc/projects', { name: 'd' }, 200], // শুধু প্রজেক্ট তৈরি (খরচ নেই)
        ];
        for (const [m, u, b, ok] of blocked) assert.equal((await g(m, u, b)).status, ok || 403, `${m} ${u}`);
        const dp = (await g('POST', '/api/doc/projects', { name: 'd2' })).data.id;
        assert.equal((await g('POST', `/api/doc/projects/${dp}/chat`, { text: 'হাই' })).status, 403);
        // অ্যাডমিন বা মালিকের এলাকায় নয়
        for (const [m, u] of [['GET', '/api/admin/overview'], ['GET', '/api/staff/complaints'], ['GET', '/api/owner/users'], ['POST', '/api/owner/unlock']]) assert.equal((await g(m, u, m === 'GET' ? undefined : {})).status, 403, u);
        // ৩টার বেশি প্রজেক্ট নয়
        await g('POST', '/api/projects', { name: '২' }); await g('POST', '/api/projects', { name: '৩' });
        assert.equal((await g('POST', '/api/projects', { name: '৪' })).status, 403);
        // অন্য অতিথি আরেকজনের কিছু দেখে না
        const g2 = client(G.base);
        await g2('POST', '/api/login', { guest: true });
        assert.equal((await g2('GET', `/api/projects/${p1.data.id}`)).status, 404);
        // মালিকের তালিকায় অতিথির ভিড় নয়, কিন্তু গণনা আছে
        await boss('POST', '/api/login', { dev: 'owner' });
        await boss('POST', '/api/owner/unlock', { password: 'test-panel-pass-only-for-tests' });
        assert.ok(!(await boss('GET', '/api/owner/users')).data.users.some(u => u.email.endsWith('@guest.local')));
        const ov = (await boss('GET', '/api/admin/overview')).data;
        assert.equal(ov.system.guests, 2);
        assert.ok(!ov.users.some(u => u.email.endsWith('@guest.local')));
        // একই ডিভাইস থেকে অনেক অতিথি আটকায় (ঘণ্টায় ১২)
        const codes = [];
        for (let i = 0; i < 12; i++) codes.push((await client(G.base)('POST', '/api/login', { guest: true })).status);
        assert.ok(codes.includes(429), codes.join(','));
        // মালিক বন্ধ করলে: নতুন অতিথি ঢুকতে পারে না, চালু থাকাও বের হয়ে যায়; Gmail-ওয়ালারা ঠিক থাকে
        assert.equal((await boss('PUT', '/api/owner/settings', { guest: 'off' })).status, 200);
        assert.equal((await anon('GET', '/api/config')).data.guest, false);
        assert.equal((await client(G.base)('POST', '/api/login', { guest: true })).status, 403);
        await sleep(100);
        assert.equal((await g('GET', '/api/me')).status, 401);
        assert.equal((await boss('GET', '/api/me')).status, 200);
        assert.equal((await boss('PUT', '/api/owner/settings', { guest: 'on' })).status, 200);
        assert.ok([200, 429].includes((await client(G.base)('POST', '/api/login', { guest: true })).status)); // চালু হয়েছে (সীমা পার হলে 429)
      } finally { G.proc.kill('SIGKILL'); }
    });

    await step('আসল সার্ভারে (production) DEV_LOGIN চালু করলে সার্ভার চালু হয় না', async () => {
      const bad = startServer({ ...baseEnv, NODE_ENV: 'production', DEV_LOGIN: '1', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-bad-')), DATABASE_URL: '' });
      const code = await Promise.race([bad.exited, sleep(8000).then(() => 'running')]);
      if (code === 'running') bad.proc.kill('SIGKILL');
      assert.equal(code, 1);
      assert.match(bad.log(), /DEV_LOGIN/);
    });
  } finally {
    A.proc.kill('SIGTERM');
    await Promise.race([A.exited, sleep(5000)]);
  }

  /* ---------- একাধিক সার্ভার (শুধু PostgreSQL) ---------- */
  if (!pg1) {
    console.log('— একাধিক সার্ভারের টেস্ট বাদ: TEST_PG_ADMIN_URL দেওয়া নেই');
  } else {
    const pg2 = await require('./pgtemp').tempDatabase(pgAdmin);
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-multi-'));
    const env = { ...baseEnv, DATA_DIR: shared, DATABASE_URL: pg2.url, DAILY_IMAGE_LIMIT: '1000', STORAGE_LIMIT_MB: '1000', STORAGE: 'local' };
    const servers = [];
    const start = async extra => { const s = startServer({ ...env, ...extra }); servers.push(s); await s.ready(); return s; };
    try {
      const W1 = await start({});
      const W2 = await start({});
      const API = await start({ RUN_WORKER: '0' });
      const c = client(API.base);
      await c('POST', '/api/login', { dev: 'owner' });
      const pid = (await c('POST', '/api/projects', { name: 'বহু সার্ভার' })).data.id;

      await step('বহু সার্ভার: এক সার্ভারের লগইন অন্য সার্ভারে চলে (একই চাবি)', async () => {
        for (const s of [W1, W2]) {
          const o = client(s.base);
          o.setCookie(c.cookie());
          assert.equal((await o('GET', '/api/me')).status, 200);
        }
      });

      await step('বহু সার্ভার: রেট লিমিট সব সার্ভার মিলিয়ে', async () => {
        const u = client(API.base);
        await u('POST', '/api/login', { dev: 'ratey' });
        const codes = [];
        for (let i = 0; i < 6; i++) { u.base = [API, W1, W2][i % 3].base; codes.push((await u('POST', '/api/enhance', { prompt: 'x' + i })).status); }
        assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
      });

      await step('বহু সার্ভার: ১২টি কাজ, দুই কর্মী, প্রতিটা ঠিক একবার', async () => {
        const ids = [];
        for (let i = 0; i < 3; i++) ids.push(...(await c('POST', `/api/projects/${pid}/generate`, { mode: 'image', prompt: 'ONCE ' + i, count: 4 })).data.jobIds);
        for (const id of ids) await waitJob(c, pid, id);
        const P = (await c('GET', `/api/projects/${pid}`)).data;
        assert.equal(P.jobs.filter(j => ids.includes(j.id) && j.status === 'done').length, 12);
        assert.equal(new Set(P.jobs.filter(j => ids.includes(j.id)).map(j => j.asset_id)).size, 12);
        assert.equal(created('ONCE').length, 12, 'Google-এ একই কাজ দুবার গেছে');
        // কোন কর্মী কয়টা করল (সময়ের উপর নির্ভর করে, তাই শুধু দেখানো হয়)
        const n = l => (l.match(/job\.done/g) || []).length;
        console.log(`   কাজ ভাগ: কর্মী১=${n(W1.log())}, কর্মী২=${n(W2.log())}`);
        assert.equal(n(W1.log()) + n(W2.log()), 12, 'কর্মী সার্ভারগুলো সব কাজ করেনি');
        assert.equal(n(API.log()), 0, 'RUN_WORKER=0 সার্ভার কাজ চালিয়েছে');
      });

      await step('বহু সার্ভার: কর্মী হঠাৎ মারা গেলে (kill -9) অন্যজন কাজ শেষ করে, Google-এ আবার পাঠায় না', async () => {
        const r = await c('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'SLOW40 failover', duration: 4 });
        const jid = r.data.jobIds[0];
        for (let i = 0; i < 50 && !created('failover').length; i++) await sleep(100);
        assert.equal(created('failover').length, 1);
        W1.proc.kill('SIGKILL');
        W2.proc.kill('SIGKILL');
        await Promise.all([W1.exited, W2.exited]);
        await start({});
        const { job } = await waitJob(c, pid, jid, ['done', 'failed'], 30000);
        assert.equal(job.status, 'done', job.error);
        assert.equal(created('failover').length, 1, 'উদ্ধারের সময় Google-এ আবার পাঠানো হয়েছে');
      });

      await step('বহু সার্ভার: ধীরে বন্ধ (SIGTERM) হলে কাজ সাথে সাথে অন্যকে দেওয়া হয়', async () => {
        const W4 = servers.at(-1);
        const r = await c('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'SLOW30 graceful', duration: 4 });
        const jid = r.data.jobIds[0];
        for (let i = 0; i < 50 && !created('graceful').length; i++) await sleep(100);
        const t0 = Date.now();
        W4.proc.kill('SIGTERM');
        const code = await Promise.race([W4.exited, sleep(15000).then(() => 'stuck')]);
        assert.equal(code, 0, 'ধীরে বন্ধ হয়নি');
        assert.ok(Date.now() - t0 < 10000, 'বন্ধ হতে খুব দেরি');
        await start({});
        const { job } = await waitJob(c, pid, jid, ['done', 'failed'], 30000);
        assert.equal(job.status, 'done', job.error);
        assert.equal(created('graceful').length, 1);
      });
    } finally {
      for (const s of servers) s.proc.kill('SIGKILL');
      await sleep(300);
      await pg2.drop().catch(() => {});
    }
  }

  mock.close();
  if (pg1) await pg1.drop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\nফল: ${passes}টি পাস, ${failures}টি ব্যর্থ`);
  process.exitCode = failures ? 1 : 0;
})();
