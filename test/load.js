// লোড টেস্ট: একটা সার্ভারে একসাথে অনেক অনুরোধ (প্রজেক্ট খোলা, লাইব্রেরি, me) পাঠিয়ে কত অনুরোধ/সেকেন্ড আর কত দ্রুত উত্তর।
// এটা লাখো ব্যবহারকারীর প্রমাণ নয়: শুধু এক মেশিনে এক সার্ভারের ক্ষমতা মাপে, যাতে কতগুলো সার্ভার লাগবে আন্দাজ করা যায়।
// চালাও: npm run test:load      (PostgreSQL: TEST_PG_ADMIN_URL=postgres://... npm run test:load)
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMock, PNG } = require('./mock-gemini');

const CONC = +process.env.LOAD_CONCURRENCY || 50;
const SECONDS = +process.env.LOAD_SECONDS || 10;
const USERS = +process.env.LOAD_USERS || 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

(async () => {
  const mock = await startMock();
  const pg = process.env.TEST_PG_ADMIN_URL ? await require('./pgtemp').tempDatabase(process.env.TEST_PG_ADMIN_URL) : null;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-load-'));
  const port = 5600 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${port}`;
  let out = '';
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEV_LOGIN: '1', OWNER_EMAIL: '', GEMINI_API_KEY: 'k', GEMINI_API_BASE: mock.base, AUTO_TITLES: '0', GOOGLE_CLIENT_ID: '', DATABASE_URL: pg ? pg.url : '', DB_POOL_SIZE: '20' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => (out += d));
  srv.stderr.on('data', d => (out += d));
  try {
    for (let i = 0; i < 80 && !out.includes('চালু'); i++) await sleep(100);
    // প্রস্তুতি: অনেক ব্যবহারকারী, প্রত্যেকের প্রজেক্টে ৫০টি ফাইল আর ৩টি চরিত্র
    const users = [];
    for (let u = 0; u < USERS; u++) {
      let cookie = '';
      const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cp': '1' }, body: JSON.stringify({ dev: 'load' + u }) });
      cookie = r.headers.get('set-cookie').split(';')[0];
      const h = { 'content-type': 'application/json', 'x-cp': '1', cookie };
      const pid = (await (await fetch(base + '/api/projects', { method: 'POST', headers: h, body: JSON.stringify({ name: 'লোড' }) })).json()).id;
      await Promise.all(Array.from({ length: 50 }, (_, i) => fetch(base + `/api/projects/${pid}/upload`, { method: 'POST', headers: h, body: JSON.stringify({ dataUrl: 'data:image/png;base64,' + PNG, name: 'f' + i }) })));
      for (let c = 0; c < 3; c++) await fetch(base + `/api/projects/${pid}/characters`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'চ' + c, description: 'x' }) });
      users.push({ h, pid });
    }
    const paths = u => [`/api/projects/${u.pid}`, '/api/library', '/api/me'];
    const lat = [];
    let ok = 0;
    let errors = 0;
    const end = Date.now() + SECONDS * 1000;
    await Promise.all(Array.from({ length: CONC }, async (_, w) => {
      let i = w;
      while (Date.now() < end) {
        const u = users[i % users.length];
        const p = paths(u)[i % 3];
        i++;
        const t = performance.now();
        try {
          const r = await fetch(base + p, { headers: { ...u.h, 'accept-encoding': 'gzip' } });
          await r.arrayBuffer();
          if (r.ok) ok++; else errors++;
        } catch { errors++; }
        lat.push(performance.now() - t);
      }
    }));
    lat.sort((a, b) => a - b);
    const rps = (ok / SECONDS).toFixed(0);
    console.log(`ডেটাবেস: ${pg ? 'PostgreSQL' : 'SQLite'} | একসাথে ${CONC}টি সংযোগ, ${SECONDS} সেকেন্ড, ${USERS} জন ব্যবহারকারী (প্রত্যেকের ৫০ ফাইল)`);
    console.log(`সফল: ${ok}, ত্রুটি: ${errors}, অনুরোধ/সেকেন্ড: ${rps}`);
    console.log(`উত্তরের সময় (ms): p50=${pct(lat, 0.5).toFixed(1)} p95=${pct(lat, 0.95).toFixed(1)} p99=${pct(lat, 0.99).toFixed(1)} সর্বোচ্চ=${lat.at(-1).toFixed(1)}`);
    console.log(`মেশিন: ${os.cpus().length} CPU, Node ${process.version}`);
    if (errors) process.exitCode = 1;
  } finally {
    srv.kill('SIGKILL');
    mock.close();
    await sleep(300);
    if (pg) await pg.drop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
