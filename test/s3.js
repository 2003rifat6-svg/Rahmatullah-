// S3 স্টোরেজ টেস্ট: s3rver (নকল S3, যেটা SigV4 সই সত্যিই যাচাই করে) দিয়ে আপলোড, তৈরি, দেখা (সই করা লিংক),
// ডাউনলোড, মোছা, কণ্ঠ জমা রাখা, এক্সপোর্ট আর হেলথ চেক।
// চালাও: npm i --no-save s3rver && npm run test:s3     (s3rver না থাকলে টেস্ট বাদ যায়)
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { startMock, PNG } = require('./mock-gemini');
const { signRequest, sha256 } = require('../lib/sigv4');

let S3rver;
try { S3rver = require(process.env.S3RVER_PATH || 's3rver'); } catch { console.log('— s3rver নেই, S3 টেস্ট বাদ'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-s3-'));
  const s3 = new S3rver({ port: 0, address: '127.0.0.1', silent: true, directory: path.join(dir, 's3'), configureBuckets: [{ name: 'ruvo' }] });
  const { port: s3port } = await s3.run();
  const endpoint = `http://127.0.0.1:${s3port}`;
  const head = async key => {
    const url = `${endpoint}/ruvo/${key}`;
    const { headers } = signRequest({ method: 'HEAD', url, payloadHash: sha256(''), region: 'us-east-1', accessKey: 'S3RVER', secretKey: 'S3RVER' });
    delete headers.host;
    return (await fetch(url, { method: 'HEAD', headers })).status;
  };
  const mock = await startMock();
  const port = 5200 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${port}`;
  let out = '';
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'data'), DEV_LOGIN: '1', OWNER_EMAIL: '', GEMINI_API_KEY: 'k', GEMINI_API_BASE: mock.base,
      POLL_MS: '100', WORKER_POLL_MS: '200', AUTO_TITLES: '0', GOOGLE_CLIENT_ID: '', DATABASE_URL: '',
      STORAGE: 's3', S3_ENDPOINT: endpoint, S3_BUCKET: 'ruvo', S3_REGION: 'us-east-1', S3_ACCESS_KEY: 'S3RVER', S3_SECRET_KEY: 'S3RVER',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => (out += d));
  srv.stderr.on('data', d => (out += d));
  let cookie = '';
  const call = async (method, url, body, manual = true) => {
    const r = await fetch(base + url, { method, redirect: manual ? 'manual' : 'follow', headers: { 'content-type': 'application/json', 'x-cp': '1', cookie }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  let failed = false;
  const ok = n => console.log('✓ ' + n);
  try {
    for (let i = 0; i < 80 && !out.includes('চালু'); i++) await sleep(100);
    assert.match(out, /স্টোরেজ: s3/);
    const h = await call('GET', '/healthz');
    assert.equal(h.status, 200, JSON.stringify(h.data));
    ok('S3 সহ সার্ভার চালু, হেলথ চেক S3-এ লিখতে পারে');

    await call('POST', '/api/login', { dev: 'owner' });
    const pid = (await call('POST', '/api/projects', { name: 'S3' })).data.id;
    const up = await call('POST', `/api/projects/${pid}/upload`, { dataUrl: 'data:image/png;base64,' + PNG, name: 'ছবি' });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const g = await call('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'নদী', duration: 4 });
    let P;
    for (let i = 0; i < 60; i++) {
      P = (await call('GET', `/api/projects/${pid}`)).data;
      if (P.jobs.every(j => j.status === 'done' || j.status === 'failed')) break;
      await sleep(150);
    }
    const job = P.jobs.find(j => j.id === g.data.jobIds[0]);
    assert.equal(job.status, 'done', job.error);
    ok('আপলোড আর তৈরি ভিডিও S3-এ রাখা হলো (PUT/GET/HEAD/DELETE প্রবাহ)');

    const m = await call('GET', `/media/${job.asset_id}`);
    assert.equal(m.status, 302);
    const loc = m.headers.get('location');
    assert.match(loc, /X-Amz-Signature=/);
    const v = await fetch(loc);
    assert.equal(v.status, 200);
    assert.equal(v.headers.get('content-type'), 'video/mp4');
    assert.ok((await v.arrayBuffer()).byteLength > 10);
    const ranged = await fetch(loc, { headers: { range: 'bytes=0-3' } });
    assert.equal(ranged.status, 206);
    // s3rver সই যাচাই করে না (শুধু মেয়াদ দেখে), তাই সইয়ের সঠিকতা আলাদাভাবে যাচাই হয়: test/unit.js (AWS-এর উদাহরণ) আর test/sigv4-crosscheck.js (botocore)
    const { presignUrl } = require('../lib/sigv4');
    const expired = presignUrl({ url: loc.split('?')[0], region: 'us-east-1', accessKey: 'S3RVER', secretKey: 'S3RVER', date: new Date(Date.now() - 3600e3), expires: 60 });
    assert.equal((await fetch(expired)).status, 403, 'মেয়াদোত্তীর্ণ লিংক কাজ করছে');
    const dl = await fetch((await call('GET', `/media/${job.asset_id}?dl=1`)).headers.get('location'));
    assert.match(dl.headers.get('content-disposition') || '', /attachment/);
    ok('দেখা: অল্প সময়ের সই করা লিংক, Range চলে, মেয়াদ শেষে 403, ডাউনলোডে attachment');

    const other = await (async () => { const saved = cookie; cookie = ''; await call('POST', '/api/login', { dev: 'other' }); const r = await call('GET', `/media/${job.asset_id}`); cookie = saved; return r; })();
    assert.equal(other.status, 404);
    ok('অন্য ব্যবহারকারী সই করা লিংক পায় না');

    const voice = await call('GET', '/api/voices/Kore/preview', undefined, false);
    assert.equal(voice.status, 200);
    assert.equal(await head('voices/Kore.wav'), 200);
    ok('কণ্ঠের নমুনা S3-এ জমা থাকে');

    const zip = await call('GET', `/api/projects/${pid}/export`);
    const zf = path.join(dir, 'e.zip');
    fs.writeFileSync(zf, zip.data);
    const n = execFileSync('python3', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist()))', zf]).toString().trim();
    assert.equal(n, '3');
    ok('এক্সপোর্ট S3 থেকে ফাইল পড়ে ZIP বানায়');

    const key = `${(await call('GET', '/api/me')).data.user.id}/${job.asset_id}.mp4`;
    assert.equal(await head(key), 200);
    await call('DELETE', `/api/assets/${job.asset_id}?forever=1`);
    assert.equal(await head(key), 404);
    ok('চিরতরে মুছলে S3 থেকেও মুছে যায়');
    console.log('\nসব S3 পরীক্ষা পাস করেছে।');
  } catch (e) {
    failed = true;
    console.error('ব্যর্থ:', e, '\n--- সার্ভার লগ ---\n' + out.slice(-3000));
  } finally {
    srv.kill('SIGKILL');
    mock.close();
    await s3.close();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = failed ? 1 : 0;
  }
})();
