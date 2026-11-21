// ডকুমেন্টারি স্টুডিওর পরীক্ষা (নকল Gemini, খরচ নেই): টুল ডাকা, thoughtSignature ফেরত, প্রশ্ন-উত্তর, ফাইল, ছবি, ভিডিও,
// কণ্ঠ + ffmpeg রেসিপি, বাজেট, YouTube, ওয়েব-খোঁজা, SSRF, পথ-ভাঙা, আপলোডের ধরন, অন্য ব্যবহারকারী থেকে আলাদা, মুছে ফেলা।
// চালাও: npm run test:doc   (PostgreSQL-এ: TEST_PG_ADMIN_URL=... npm run test:doc)
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { startMock, PNG, wav } = require('./mock-gemini');
const { cleanPath, sniffMedia, isPrivateIp } = require('../lib/docstudio');
const { parseWav, joinPcm, toPcm } = require('../lib/media');

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let failed = 0, passed = 0;
  const ok = n => { passed++; console.log('✓ ' + n); };
  const check = async (name, fn) => { try { await fn(); ok(name); } catch (e) { failed++; console.error('✗ ' + name + '\n  ', e.message); } };

  // ---- সার্ভার ছাড়া ছোট পরীক্ষা ----
  await check('পথ যাচাই: .. আর অদ্ভুত পথ বাদ', () => {
    assert.equal(cleanPath('work/SCRIPT.md'), 'work/SCRIPT.md');
    for (const bad of ['../x', 'a/../../b', '/etc/passwd', '', 'a\\..\\b', 'x;rm -rf', 'work/']) assert.equal(cleanPath(bad), bad === '/etc/passwd' ? 'etc/passwd' : null, bad);
  });
  await check('আপলোডের আসল ধরন চেনা', () => {
    assert.equal(sniffMedia(Buffer.from(PNG, 'base64')), 'image/png');
    assert.equal(sniffMedia(wav()), 'audio/wav');
    assert.equal(sniffMedia(Buffer.from('ID3\x03\x00rest')), 'audio/mpeg');
    assert.equal(sniffMedia(Buffer.from('0000001866747970697366', 'hex').length ? Buffer.from('000000186674797069736f6d0000020069736f6d', 'hex') : null), 'video/mp4');
    assert.equal(sniffMedia(Buffer.from('MZ\x90\x00 exe'), 'a.exe'), null);
    assert.equal(sniffMedia(Buffer.from('hello'), 'a.md'), 'text/markdown');
    assert.equal(sniffMedia(Buffer.from('<script>'), 'a.html'), null);
  });
  await check('ব্যক্তিগত IP চেনা (SSRF)', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.20.0.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.ok(isPrivateIp(ip), ip);
    for (const ip of ['8.8.8.8', '142.250.1.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  });
  await check('WAV জোড়া: অংশ + বিরতি = সঠিক দৈর্ঘ্য', () => {
    const a = toPcm(wav(0.5)), b = toPcm(wav(0.25));
    const { buf, seconds } = joinPcm([a, b], [700]);
    assert.ok(Math.abs(seconds - 1.45) < 0.01, String(seconds));
    const w = parseWav(buf);
    assert.equal(w.rate, 24000);
    assert.equal(w.data.length, Math.round(1.45 * 24000) * 2);
    const l16 = Buffer.alloc(4); l16.writeInt16BE(1000, 0);
    assert.equal(toPcm(l16, 'audio/L16;codec=pcm;rate=24000').data.readInt16LE(0), 1000);
  });

  // ---- সার্ভারসহ ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-doc-'));
  const mock = await startMock();
  const pgdb = process.env.TEST_PG_ADMIN_URL ? await require('./pgtemp').tempDatabase(process.env.TEST_PG_ADMIN_URL) : null;
  const port = 5600 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${port}`;
  let out = '';
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'data'), DEV_LOGIN: '1', OWNER_EMAIL: 'owner@dev.local', OPEN_SIGNUP: '1',
      GEMINI_API_KEY: 'k', GEMINI_API_BASE: mock.base, POLL_MS: '100', WORKER_POLL_MS: '150', AUTO_TITLES: '0', GOOGLE_CLIENT_ID: '',
      DATABASE_URL: pgdb ? pgdb.url : '', YOUTUBE_API_KEY: 'ytk', YOUTUBE_API_BASE: mock.ytBase, IMAGE_USD: '0.04', VIDEO_USD_PER_SEC: '0.07',
      DOC_BUDGET_USD: '1', GEMINI_RETRY_MS: '5', DOC_UPLOAD_MB: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => (out += d));
  srv.stderr.on('data', d => (out += d));
  const jar = {};
  const call = async (who, method, url, body, raw) => {
    const headers = { 'x-cp': '1', cookie: jar[who] || '' };
    if (!raw) headers['content-type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: raw || (body && JSON.stringify(body)) });
    const sc = r.headers.get('set-cookie');
    if (sc) jar[who] = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  // টার্ন শেষ হওয়া পর্যন্ত অপেক্ষা
  const settle = async (who, pid, ms = 20000) => {
    for (let t = 0; t < ms; t += 150) {
      const r = await call(who, 'GET', `/api/doc/projects/${pid}`);
      if (!r.data.project.busy && !r.data.files.some(f => f.status === 'pending')) return r.data;
      await sleep(150);
    }
    throw new Error('টার্ন শেষ হয়নি');
  };
  const say = async (who, pid, text) => {
    const r = await call(who, 'POST', `/api/doc/projects/${pid}/chat`, { text });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return settle(who, pid);
  };
  const lastModel = d => [...d.messages].reverse().find(m => m.role === 'model')?.text || '';
  try {
    for (let i = 0; i < 80 && !out.includes('চালু'); i++) await sleep(100);
    await call('owner', 'POST', '/api/login', { dev: 'owner' });
    await call('other', 'POST', '/api/login', { dev: 'other' });
    const pid = (await call('owner', 'POST', '/api/doc/projects', { name: 'Banco Rio' })).data.id;

    await check('ডিফল্ট System Instruction = মাস্টার কমান্ড (Part B)', async () => {
      const s = (await call('owner', 'GET', '/api/doc/settings')).data;
      assert.match(s.system, /DOCUMENTARY STUDIO — SYSTEM INSTRUCTION/);
      assert.equal(s.custom, false);
    });
    await check('টুল ডাকা: ফাইল লেখা → তালিকা → উত্তর, thoughtSignature ফেরত যায়', async () => {
      const d = await say('owner', pid, 'DOCTEST_FILE');
      const t = lastModel(d);
      assert.match(t, /^DONE/, t);
      assert.match(t, /work\/SCRIPT\.md/);
      assert.ok(d.files.some(f => f.path === 'work/SCRIPT.md' && f.source === 'model'));
      assert.ok(d.messages.some(m => m.role === 'tool' && /📝 ফাইল লেখা: work\/SCRIPT.md ✓/.test(m.text)));
      const calls = mock.calls.filter(c => /:generateContent/.test(c.url) && c.body.tools?.[0]?.functionDeclarations);
      assert.ok(calls.length >= 3);
      assert.match(calls[0].body.systemInstruction.parts[0].text, /APP CONTEXT/);
      const f = d.files.find(x => x.path === 'work/SCRIPT.md');
      const got = await call('owner', 'GET', `/api/doc/files/${f.id}`);
      assert.match(got.headers.get('content-type'), /text\/plain/);
      assert.equal(got.data.toString(), '# Script\n\nHello world.');
    });
    await check('ask_user: প্রশ্ন + বোতাম, উত্তর দিলে চালু থাকে; ধাপের তালিকা হালনাগাদ', async () => {
      let d = await say('owner', pid, 'DOCTEST_ASK');
      assert.deepEqual(d.pendingAsk.options, ['S1 সিনেমাটিক', 'S3 থ্রিডি']);
      assert.equal(d.project.steps['1'].status, 'doing');
      d = await say('owner', pid, 'S3 থ্রিডি');
      assert.equal(d.pendingAsk, null);
      const t = lastModel(d);
      assert.match(t, /"answer":"S3 থ্রিডি"/, t);
      assert.match(t, /"name":"set_step"/); // একই সাথে ডাকা অন্য টুলের উত্তরও গেছে
    });
    await check('ছবি বানানো ও বদলানো, খরচ হিসাব হয়', async () => {
      const d = await say('owner', pid, 'DOCTEST_IMG');
      assert.ok(d.files.some(f => f.path === 'stills/shot01.png' && f.kind === 'image'));
      assert.ok(d.files.some(f => f.path === 'stills/shot01b.png'));
      assert.ok(Math.abs(d.project.spent_usd - 0.08) < 1e-6, String(d.project.spent_usd));
      const img = mock.calls.filter(c => c.url === '/v1beta/interactions' && c.body.response_format?.type === 'image').pop();
      assert.equal(img.body.input[0].type, 'image'); // বদলানোর সময় আগের ছবি পাঠানো হয়
    });
    await check('বাজেটের বেশি হলে ভিডিও শুরুই হয় না', async () => {
      const before = mock.calls.filter(c => c.body?.response_format?.type === 'video').length;
      const d = await say('owner', pid, 'DOCTEST_BUDGET');
      assert.match(lastModel(d), /over_budget/);
      assert.equal(mock.calls.filter(c => c.body?.response_format?.type === 'video').length, before);
      assert.ok(!d.files.some(f => f.path === 'clips/big.mp4'));
    });
    await check('ছবি থেকে ভিডিও: পেছনে তৈরি হয়ে ফাইল আসে', async () => {
      await call('owner', 'PATCH', `/api/doc/projects/${pid}`, { budgetUsd: 5 });
      const d = await say('owner', pid, 'DOCTEST_VIDEO');
      const v = d.files.find(f => f.path === 'clips/v.mp4');
      assert.equal(v.status, 'ready');
      assert.ok(v.size > 10);
      assert.ok(d.messages.some(m => /ভিডিও তৈরি হয়েছে: clips\/v.mp4/.test(m.text)));
      const req = mock.calls.filter(c => c.body?.response_format?.type === 'video').pop().body;
      assert.equal(req.response_format.duration, '4s');
      assert.equal(req.input[0].type, 'image');
    });
    await check('কণ্ঠ: অনুচ্ছেদে ভাগ করে জোড়া, তারপর ffmpeg দিয়ে মাপা ও পরিষ্কার', async () => {
      const d = await say('owner', pid, 'DOCTEST_TTS');
      const n = d.files.find(f => f.path === 'audio/NARRATION.wav');
      assert.ok(n, JSON.stringify(d.files.map(f => f.path)));
      const t = lastModel(d);
      assert.match(t, /audio_clean/);
      assert.match(t, /"after":\{"lufs":-1[3-5]/, t.slice(0, 600));
      assert.ok(d.files.some(f => f.path === 'audio/NARRATION_CLEAN.wav'));
      const wavBuf = (await call('owner', 'GET', `/api/doc/files/${n.id}`)).data;
      const w = parseWav(wavBuf);
      assert.ok(Math.abs(w.data.length / 2 / w.rate - 1.9) < 0.02, String(w.data.length / 2 / w.rate)); // ০.৬ + ০.৭ বিরতি + ০.৬
    });
    await check('ওয়েব খোঁজা (Google Search grounding) উৎসসহ', async () => {
      const t = lastModel(await say('owner', pid, 'DOCTEST_SEARCH'));
      assert.match(t, /January 13, 2006/);
      assert.match(t, /example\.org/);
    });
    await check('YouTube: খুঁজে ভিউসহ ফল (key সার্ভার থেকে যায়)', async () => {
      const t = lastModel(await say('owner', pid, 'DOCTEST_YT'));
      assert.match(t, /"views":1500000/);
      assert.ok(mock.ytHits.some(h => h.includes('/videos') && h.includes('statistics')));
    });
    await check('SSRF: ভেতরের ঠিকানা পড়া যায় না', async () => {
      for (const u of ['http://127.0.0.1:' + port + '/healthz', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:' + port + '/', 'file:///etc/passwd']) {
        const t = lastModel(await say('owner', pid, 'DOCTEST_FETCH ' + u));
        assert.match(t, /নিষেধ|শুধু http/, u + ' → ' + t.slice(0, 200));
      }
    });
    await check('পথ-ভাঙা আর ভুল ধরনের ফাইল লেখা আটকায়', async () => {
      const d = await say('owner', pid, 'DOCTEST_TRAVERSAL');
      const t = lastModel(d);
      assert.equal((t.match(/"error"/g) || []).length, 3, t);
      assert.ok(!d.files.some(f => /evil|run\.sh/.test(f.path)));
    });
    await check('অনেক ধাপ হলে টার্ন থামে', async () => {
      const d = await say('owner', pid, 'DOCTEST_LOOP');
      assert.ok(d.messages.some(m => /চালিয়ে যাও/.test(m.text)));
    });
    await check('আপলোড: অডিও নেয়, exe নেয় না, সীমার বেশি নেয় না; পরের বার্তায় মডেল খবর পায়', async () => {
      const up = await call('owner', 'POST', `/api/doc/projects/${pid}/upload?name=${encodeURIComponent('আমার voice.wav')}&licence=own`, null, wav(0.3));
      assert.equal(up.status, 200, JSON.stringify(up.data));
      assert.match(up.data.path, /^uploads\/voice\.wav$/);
      const bad = await call('owner', 'POST', `/api/doc/projects/${pid}/upload?name=a.exe`, null, Buffer.from('MZ\x90\x00 exe'));
      assert.equal(bad.status, 415);
      const big = await call('owner', 'POST', `/api/doc/projects/${pid}/upload?name=b.wav`, null, Buffer.concat([wav(0.1), Buffer.alloc(3 * 1024 * 1024)]));
      assert.equal(big.status, 413);
      await say('owner', pid, 'এই অডিওটা দেখো');
      const last = mock.calls.filter(c => c.body?.tools?.[0]?.functionDeclarations).pop();
      const userText = last.body.contents.filter(c => c.role === 'user').pop().parts.map(p => p.text || '').join(' ');
      assert.match(userText, /uploads\/voice\.wav \(audio\/wav/);
      assert.match(userText, /licence: own/);
    });
    await check('একসাথে দুটো বার্তা: দ্বিতীয়টা 409', async () => {
      const a = call('owner', 'POST', `/api/doc/projects/${pid}/chat`, { text: 'DOCTEST_IMG' });
      const b = call('owner', 'POST', `/api/doc/projects/${pid}/chat`, { text: 'DOCTEST_IMG' });
      const s = [(await a).status, (await b).status].sort();
      assert.deepEqual(s, [200, 409]);
      await settle('owner', pid);
    });
    await check('অন্য ব্যবহারকারী কিছুই দেখে না', async () => {
      const d = await call('owner', 'GET', `/api/doc/projects/${pid}`);
      const f = d.data.files[0];
      assert.equal((await call('other', 'GET', `/api/doc/projects/${pid}`)).status, 404);
      assert.equal((await call('other', 'GET', `/api/doc/files/${f.id}`)).status, 404);
      assert.equal((await call('other', 'POST', `/api/doc/projects/${pid}/chat`, { text: 'hi' })).status, 404);
      assert.equal((await call('other', 'GET', '/api/doc/projects')).data.projects.length, 0);
    });
    await check('আলাদা মডিউল: স্টুডিওর প্রজেক্ট/চ্যাটে কিছু যায় না', async () => {
      const lib = (await call('owner', 'GET', '/api/library')).data;
      assert.equal(lib.projects.length, 0);
    });
    await check('নিজের System Instruction আর LESSONS', async () => {
      await call('owner', 'PUT', '/api/doc/settings', { system: 'CUSTOM SYS', lessons: '- rule one' });
      await say('owner', pid, 'হ্যালো');
      const last = mock.calls.filter(c => c.body?.tools?.[0]?.functionDeclarations).pop();
      assert.match(last.body.systemInstruction.parts[0].text, /^CUSTOM SYS/);
      assert.match(last.body.systemInstruction.parts[0].text, /- rule one/);
      await call('owner', 'PUT', '/api/doc/settings', { system: '' });
      assert.equal((await call('owner', 'GET', '/api/doc/settings')).data.custom, false);
    });
    await check('ZIP এক্সপোর্টে প্রজেক্টের সব ফাইল', async () => {
      const z = await call('owner', 'GET', `/api/doc/projects/${pid}/export`);
      const zf = path.join(dir, 'd.zip');
      fs.writeFileSync(zf, z.data);
      const names = execFileSync('python3', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("\\n".join(z.namelist()))', zf]).toString();
      for (const n of ['work/SCRIPT.md', 'stills/shot01.png', 'clips/v.mp4', 'audio/NARRATION.wav', 'uploads/voice.wav', 'LESSONS.md']) assert.ok(names.includes(n), n);
    });
    await check('প্রজেক্ট মুছলে ফাইলও মুছে যায়', async () => {
      const files = (await call('owner', 'GET', `/api/doc/projects/${pid}`)).data.files;
      assert.equal((await call('owner', 'DELETE', `/api/doc/projects/${pid}`)).status, 200);
      assert.equal((await call('owner', 'GET', `/api/doc/files/${files[0].id}`)).status, 404);
      const left = fs.readdirSync(path.join(dir, 'data', 'media'), { recursive: true }).filter(f => String(f).startsWith('doc/') && /\.\w+$/.test(f));
      assert.deepEqual(left, []);
    });
    console.log(`\nফল: ${passed}টি পাস, ${failed}টি ব্যর্থ`);
  } catch (e) {
    failed++;
    console.error('ব্যর্থ:', e, '\n--- সার্ভার লগ ---\n' + out.slice(-3000));
  } finally {
    srv.kill('SIGKILL');
    mock.close();
    if (pgdb) await pgdb.drop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    if (failed) console.error('--- সার্ভার লগ (শেষ অংশ) ---\n' + out.split('\n').filter(l => /error|warn|fail/i.test(l)).slice(-15).join('\n'));
    process.exitCode = failed ? 1 : 0;
  }
})();
