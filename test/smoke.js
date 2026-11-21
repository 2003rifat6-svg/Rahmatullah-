// Ruvo স্মোক টেস্ট: নকল Gemini সার্ভার দিয়ে পুরো প্রবাহ যাচাই করে।
// চালাও: npm test   (আসল API key লাগে না, কোনো খরচ হয় না)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FAKE_MP4 = Buffer.from('00000020667479706973736f6d0000020069736f6d69736f32617663316d703431', 'hex').toString('base64');

// ---------- নকল Gemini ----------
const calls = [];
const interactions = new Map();
let seq = 0;
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, url: req.url, body, key: req.headers['x-goog-api-key'] });
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/v1beta/interactions') {
      const id = 'v1_mock' + ++seq;
      const isVideo = body.response_format?.type === 'video';
      const isAudio = body.response_format?.type === 'audio';
      const done = {
        id, status: 'completed', model: body.model, object: 'interaction',
        steps: [{ type: 'model_output', content: [isAudio
          ? { type: 'audio', mime_type: 'audio/wav', data: Buffer.from('RIFFfakeWAVE').toString('base64') }
          : isVideo
          ? { type: 'video', mime_type: 'video/mp4', data: FAKE_MP4 }
          : { type: 'image', mime_type: 'image/png', data: PNG_1PX }] }],
      };
      if (/BLOCKME/.test(JSON.stringify(body.input))) {
        done.steps = [{ type: 'model_output', content: [{ type: 'text', text: 'Blocked by safety filter' }] }];
      }
      interactions.set(id, { done, polls: 0 });
      if (body.background) return send(200, { id, status: 'in_progress' });
      return send(200, done);
    }
    const m = /^\/v1beta\/interactions\/(.+)$/.exec(req.url);
    if (req.method === 'GET' && m) {
      const it = interactions.get(decodeURIComponent(m[1]));
      if (!it) return send(404, { error: { message: 'not found' } });
      it.polls++;
      return send(200, it.polls < 2 ? { id: it.done.id, status: 'in_progress' } : it.done);
    }
    if (req.method === 'POST' && /busy-model:generateContent$/.test(req.url)) {
      return send(503, { error: { message: 'This model is currently experiencing high demand.' } });
    }
    if (req.method === 'POST' && /:generateContent$/.test(req.url)) {
      const isEpisode = Boolean(body.generationConfig?.responseSchema);
      const text = isEpisode
        ? JSON.stringify({ title: 'প্রথম দেখা', summary: 'রাজু আর মিতুর দেখা হয়।', scenes: [
          { location: 'নদীর ঘাট', action: 'রাজু নৌকা থেকে নামে', dialogue: 'রাজু: "কেমন আছো?"', characters: ['রাজু'], video_prompt: 'Raju steps off a boat at a river ghat at sunset.' },
          { location: 'বাজার', action: 'মিতু হাসে', dialogue: '', characters: ['রাজু', 'মিতু'], video_prompt: 'Mitu smiles at Raju in a busy village market.' }] })
        : 'A cinematic shot of Raju walking in the rain at night, lightning in the distance.';
      return send(200, { candidates: [{ content: { parts: [{ text }] } }] });
    }
    send(404, { error: { message: 'unknown route ' + req.url } });
  });
});

// ---------- সহায়ক ----------
let BASE;
function client() {
  let cookie = '';
  return async function call(method, url, body, raw) {
    const r = await fetch(BASE + url, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', 'x-cp': '1', cookie, ...(raw || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitJobs(call, pid) {
  for (let i = 0; i < 100; i++) {
    const r = await call('GET', `/api/projects/${pid}`);
    if (!r.data.jobs.some(j => j.status === 'queued' || j.status === 'running')) return r.data;
    await sleep(150);
  }
  throw new Error('জব শেষ হয়নি');
}

(async () => {
  await new Promise(r => mock.listen(0, r));
  const mockBase = `http://127.0.0.1:${mock.address().port}/v1beta`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruvo-test-'));
  const port = 3900 + Math.floor(Math.random() * 90);
  BASE = `http://127.0.0.1:${port}`;
  // TEST_PG_ADMIN_URL থাকলে PostgreSQL-এ (প্রতিবার নতুন খালি ডেটাবেস), নইলে SQLite-এ
  const pgdb = process.env.TEST_PG_ADMIN_URL ? await require('./pgtemp').tempDatabase(process.env.TEST_PG_ADMIN_URL) : null;
  console.log('ডেটাবেস: ' + (pgdb ? 'PostgreSQL' : 'SQLite'));
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEV_LOGIN: '1', GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: mockBase,
      POLL_MS: '100', OWNER_EMAIL: '', DATABASE_URL: pgdb ? pgdb.url : '', TEXT_MODEL: 'busy-model', TEXT_MODEL_FALLBACKS: 'gemini-3.6-flash', GEMINI_RETRY_MS: '5', GOOGLE_CLIENT_ID: '', DAILY_VIDEO_LIMIT: '3', OPEN_SIGNUP: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', d => (log += d));
  srv.stderr.on('data', d => (log += d));
  const ok = (name) => console.log('✓ ' + name);

  try {
    for (let i = 0; i < 50 && !log.includes('চালু'); i++) await sleep(100);
    const call = client();

    // লগইন ছাড়া ঢোকা যায় না
    let r = await call('GET', '/api/me');
    assert.equal(r.status, 401);
    r = await call('GET', '/');
    assert.equal(r.status, 302);
    r = await call('POST', '/api/projects', { name: 'x' }, { 'x-cp': '' });
    assert.equal(r.status, 403);
    ok('লগইন ছাড়া আটকায়, CSRF হেডার ছাড়া আটকায়');

    r = await call('POST', '/api/login', { dev: 'Owner' });
    assert.equal(r.status, 200);
    r = await call('GET', '/api/me');
    assert.equal(r.data.user.owner, true);
    assert.equal(r.data.configured, true);
    ok('ডেভ লগইন ও মালিক');

    // ফোল্ডার আর প্রজেক্ট
    const folder = (await call('POST', '/api/folders', { name: 'সিরিজ' })).data.id;
    const pid = (await call('POST', '/api/projects', { name: 'নদীর গল্প', folderId: folder })).data.id;
    r = await call('GET', '/api/library');
    assert.equal(r.data.folders.length, 1);
    assert.equal(r.data.projects[0].folder_id, folder);
    ok('ফোল্ডার ও প্রজেক্ট');

    // চরিত্র, আপলোড, AI রেফারেন্স
    const raju = (await call('POST', `/api/projects/${pid}/characters`, { name: 'রাজু', description: '২৫ বছর, নীল পাঞ্জাবি' })).data.id;
    const mitu = (await call('POST', `/api/projects/${pid}/characters`, { name: 'মিতু', description: 'লাল শাড়ি' })).data.id;
    r = await call('POST', `/api/projects/${pid}/upload`, { dataUrl: 'data:image/png;base64,' + PNG_1PX, characterId: raju });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await call('POST', `/api/projects/${pid}/upload`, { dataUrl: 'data:text/html;base64,AAAA' });
    assert.equal(r.status, 400);
    r = await call('POST', `/api/characters/${mitu}/generate`, { extra: 'smiling' });
    assert.equal(r.status, 200);
    let P = await waitJobs(call, pid);
    assert.equal(P.characters.find(c => c.id === mitu).images.length, 1);
    assert.equal(P.characters.find(c => c.id === raju).images.length, 1);
    const charCall = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(charCall.body.model, 'gemini-nano-banana-2.1');
    assert.equal(charCall.body.response_format.type, 'image');
    assert.equal(charCall.key, 'test-key');
    ok('চরিত্র, রেফারেন্স ছবি আপলোড ও AI দিয়ে বানানো');

    // চরিত্রসহ ভিডিও
    r = await call('POST', `/api/projects/${pid}/generate`, {
      mode: 'video', prompt: 'বৃষ্টিতে হাঁটছে', characterIds: [raju, mitu], aspect: '9:16', duration: 12, resolution: '720p', camera: 'aerial drone shot', singleShot: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    P = await waitJobs(call, pid);
    const vidCall = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(vidCall.body.model, 'gemini-omni-1.2-flash');
    assert.equal(vidCall.body.background, true);
    assert.deepEqual(vidCall.body.response_format, { type: 'video', aspect_ratio: '9:16', resolution: '720p', duration: '12s' });
    assert.equal(vidCall.body.input.filter(x => x.type === 'image').length, 2);
    const txt = vidCall.body.input.find(x => x.type === 'text').text;
    assert.match(txt, /রাজু/);
    assert.match(txt, /Camera: aerial drone shot/);
    assert.match(txt, /single continuous shot/);
    assert.ok(calls.some(c => c.method === 'GET' && c.url.startsWith('/v1beta/interactions/')), 'পোল হয়নি');
    const video = P.assets.find(a => a.kind === 'video');
    assert.ok(video, 'ভিডিও সেভ হয়নি');
    assert.deepEqual(video.meta.characterNames, ['রাজু', 'মিতু']);
    assert.equal(video.editable, true);
    ok('চরিত্রসহ ভিডিও: সঠিক অনুরোধ, পোলিং, সেভ');

    // মিডিয়া, রেঞ্জ
    r = await call('GET', `/media/${video.id}`, undefined, { range: 'bytes=0-3' });
    assert.equal(r.status, 206);
    assert.equal(r.data.length, 4);
    r = await call('GET', `/media/${video.id}?dl=1`);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    ok('ভিডিও দেখা (Range) ও ডাউনলোড');

    // ভিডিও বাড়ানো, বদলানো, পরের দৃশ্য
    r = await call('POST', `/api/assets/${video.id}/remix`, { action: 'extend', prompt: 'ওরা দৌড়ায়', duration: 6 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await waitJobs(call, pid);
    let last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.ok(last.body.previous_interaction_id.startsWith('v1_mock'));
    assert.match(last.body.input, /^Extend this video/);
    assert.equal(last.body.response_format.duration, '6s');
    assert.equal(last.body.response_format.aspect_ratio, undefined);
    r = await call('POST', `/api/assets/${video.id}/remix`, { action: 'next', prompt: 'বাজারে দেখা' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(last.body.input.filter(x => x.type === 'image').length, 2);
    assert.match(last.body.input.find(x => x.type === 'text').text, /same characters in the next scene/);
    ok('ভিডিও বাড়ানো ও পরের দৃশ্য');

    // দৈনিক সীমা মালিকের জন্য নয়; ফ্রেম থেকে ভিডিও
    const img = (await call('POST', `/api/projects/${pid}/upload`, { dataUrl: 'data:image/png;base64,' + PNG_1PX })).data.id;
    r = await call('POST', `/api/projects/${pid}/generate`, { mode: 'frames', prompt: 'সূর্য ডুবে যায়', firstFrameId: img, lastFrameId: img, duration: 15 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(last.body.response_format.duration, '10s', 'শুরু-শেষ ফ্রেমে ১০ সেকেন্ডের বেশি হওয়া উচিত নয়');
    assert.match(last.body.input.find(x => x.type === 'text').text, /opening frame and the second image as the final frame/);
    ok('শুরু-শেষ ফ্রেম থেকে ভিডিও (১০ সেকেন্ড সীমা)');

    // মডেল কিছু না দিলে ব্যর্থতা দেখায়
    r = await call('POST', `/api/projects/${pid}/generate`, { mode: 'image', prompt: 'BLOCKME' });
    P = await waitJobs(call, pid);
    const failed = P.jobs.find(j => j.status === 'failed');
    assert.ok(failed && /Blocked by safety filter/.test(failed.error), JSON.stringify(P.jobs));
    ok('ব্লক হলে কারণসহ ব্যর্থতা');

    // প্রম্পট উন্নত করা ও গল্প
    r = await call('POST', '/api/enhance', { prompt: 'রাজু বৃষ্টিতে', projectId: pid, characterIds: [raju] });
    assert.match(r.data.prompt, /Raju/);
    assert.ok(calls.some(c => /busy-model:generateContent$/.test(c.url)), 'প্রধান মডেল আগে চেষ্টা হওয়া উচিত');
    assert.match(calls.filter(c => /:generateContent$/.test(c.url)).pop().url, /gemini-3\.6-flash/, 'ব্যস্ত হলে বিকল্প মডেলে যাওয়া উচিত');
    r = await call('PUT', `/api/projects/${pid}/story`, { premise: 'নদীর পাড়ের প্রেম', genre: 'ড্রামা' });
    r = await call('POST', `/api/projects/${pid}/story/episodes`, { direction: 'টুইস্ট' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.story.episodes[0].scenes.length, 2);
    assert.equal(r.data.story.premise, 'নদীর পাড়ের প্রেম');
    ok('প্রম্পট উন্নত করা ও এপিসোড লেখা');

    // দৃশ্যক্রম
    P = (await call('GET', `/api/projects/${pid}`)).data;
    const vids = P.assets.filter(a => a.kind === 'video').map(a => a.id);
    r = await call('PUT', `/api/projects/${pid}/clips`, { clips: [...vids.reverse(), img, 'nope'] });
    assert.deepEqual(r.data.clips, vids);
    ok('দৃশ্যক্রম (শুধু ভিডিও থাকে)');

    // অনুমতি: অন্য ব্যবহারকারী
    r = await call('POST', '/api/admin/allowed', { email: 'friend@gmail.com' });
    assert.equal(r.status, 200);
    const other = client();
    await other('POST', '/api/login', { dev: 'Other' });
    r = await other('GET', `/api/projects/${pid}`);
    assert.equal(r.status, 404);
    r = await other('GET', `/media/${video.id}`);
    assert.equal(r.status, 404);
    ok('অন্যের প্রজেক্ট ও ফাইল দেখা যায় না');

    // উপকরণ (যেকোনো ছবি) আর ছবির মডেল বাছাই
    r = await call('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'ঘাটে নৌকা', characterIds: [raju], ingredientIds: [img] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(last.body.input.filter(x => x.type === 'image').length, 2);
    assert.match(last.body.input.find(x => x.type === 'text').text, /objects, places or styles/);
    r = await call('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'x', ingredientIds: [img, img + 'x'] });
    assert.equal(r.status, 404);
    r = await call('POST', `/api/projects/${pid}/generate`, { mode: 'image', prompt: 'পোস্টার', imageModel: 'gemini-3-pro-image' });
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(last.body.model, 'gemini-3-pro-image');
    r = await call('POST', `/api/projects/${pid}/generate`, { mode: 'image', prompt: 'পোস্টার', imageModel: 'evil-model' });
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(last.body.model, 'gemini-nano-banana-2.1', 'অজানা মডেল নেওয়া উচিত নয়');
    ok('উপকরণ ছবি ও ছবির মডেল বাছাই');

    // স্বয়ংক্রিয় শিরোনাম ও নাম বদলানো
    P = (await call('GET', `/api/projects/${pid}`)).data;
    assert.ok(P.assets.every(a => a.title), 'সব ফাইলের শিরোনাম থাকা উচিত');
    r = await call('PATCH', `/api/assets/${video.id}`, { title: 'বৃষ্টির রাত' });
    P = (await call('GET', `/api/projects/${pid}`)).data;
    assert.equal(P.assets.find(a => a.id === video.id).title, 'বৃষ্টির রাত');
    ok('শিরোনাম');

    // কালেকশন
    const col = (await call('POST', `/api/projects/${pid}/collections`, { name: 'এপিসোড ১' })).data.id;
    await call('POST', `/api/collections/${col}/items`, { assetId: video.id });
    P = (await call('GET', `/api/projects/${pid}`)).data;
    assert.deepEqual(P.collections[0].items, [video.id]);
    await call('POST', `/api/collections/${col}/items`, { assetId: video.id, add: false });
    P = (await call('GET', `/api/projects/${pid}`)).data;
    assert.deepEqual(P.collections[0].items, []);
    ok('কালেকশন');

    // সহকারী
    r = await call('POST', `/api/projects/${pid}/chat`, { text: 'আইডিয়া দাও' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.messages.length, 2);
    const chatCall = calls.filter(c => /:generateContent$/.test(c.url)).pop();
    assert.match(chatCall.body.systemInstruction.parts[0].text, /রাজু/);
    r = await call('POST', `/api/projects/${pid}/chat`, { text: 'আরও' });
    assert.equal(calls.filter(c => /:generateContent$/.test(c.url)).pop().body.contents.length, 3);
    r = await call('DELETE', `/api/projects/${pid}/chat`);
    assert.equal(r.data.messages.length, 0);
    ok('সহকারী চ্যাট (ইতিহাস মনে রাখে)');

    // কণ্ঠ: তালিকা, শোনা (একবার বানিয়ে জমা রাখে), চরিত্রে বসানো, ভিডিওর প্রম্পটে যায়
    r = await call('GET', '/api/voices');
    assert.equal(r.data.voices.length, 30);
    r = await call('GET', '/api/voices/Kore/preview');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/wav', JSON.stringify(r.data));
    const ttsCall = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(ttsCall.body.model, 'gemini-3.8-flash-tts');
    assert.deepEqual(ttsCall.body.generation_config.speech_config, [{ voice: 'Kore' }]);
    const before = calls.length;
    r = await call('GET', '/api/voices/Kore/preview');
    assert.equal(calls.length, before, 'দ্বিতীয়বার শুনলে আবার বানানো উচিত নয়');
    r = await call('GET', '/api/voices/Nope/preview');
    assert.equal(r.status, 404);
    r = await call('PATCH', `/api/characters/${raju}`, { voice: 'Charon', info: 'শান্ত, ধীরে কথা বলে' });
    assert.equal(r.status, 200);
    r = await call('PATCH', `/api/characters/${raju}`, { voice: 'Hacker' });
    assert.equal(r.status, 400);
    r = await call('POST', `/api/projects/${pid}/generate`, { mode: 'video', prompt: 'রাজু কথা বলে', characterIds: [raju] });
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    const vt = last.body.input.find(x => x.type === 'text').text;
    assert.match(vt, /speaks with a male informative voice/);
    assert.match(vt, /personality: শান্ত/);
    ok('কণ্ঠ ও স্বভাব (শোনা, জমা রাখা, প্রম্পটে যাওয়া)');

    // চরিত্রের পুরো শরীরের রেফারেন্স ও অবতার
    r = await call('POST', `/api/characters/${raju}/generate`, { view: 'body' });
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.match(last.body.input.find(x => x.type === 'text').text, /front view, side view and back view/);
    assert.equal(last.body.response_format.aspect_ratio, '16:9');
    r = await call('POST', `/api/projects/${pid}/avatar`, { dataUrl: 'data:image/png;base64,' + PNG_1PX, name: 'আমি', style: 'anime' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    P = await waitJobs(call, pid);
    const me = P.characters.find(c => c.id === r.data.characterId);
    assert.equal(me.images.length, 1);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.match(last.body.input.find(x => x.type === 'text').text, /anime character/);
    ok('পুরো শরীরের রেফারেন্স ও নিজের ছবি থেকে অবতার');

    // ছবি কাটা (নতুন ভার্সন), বড় করা (২K), আপলোড করা ছবি বদলানো
    r = await call('POST', `/api/projects/${pid}/upload`, { dataUrl: 'data:image/png;base64,' + PNG_1PX, parentId: img, aspect: '1:1', name: 'কাটা' });
    P = (await call('GET', `/api/projects/${pid}`)).data;
    const cropped = P.assets.find(a => a.id === r.data.id);
    assert.equal(cropped.parent_id, img);
    assert.equal(cropped.meta.aspect, '1:1');
    r = await call('POST', `/api/assets/${img}/remix`, { action: 'upscale', size: '4K' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(last.body.response_format.image_size, '4K');
    assert.equal(last.body.input.filter(x => x.type === 'image').length, 1, 'আপলোড করা ছবি ইনপুট হিসেবে যাওয়া উচিত');
    r = await call('POST', `/api/assets/${img}/remix`, { action: 'edit', prompt: 'আকাশ লাল করো', aspect: '9:16' });
    await waitJobs(call, pid);
    last = calls.filter(c => c.method === 'POST' && c.url === '/v1beta/interactions').pop();
    assert.equal(last.body.response_format.aspect_ratio, '9:16');
    r = await call('POST', `/api/assets/${video.id}/remix`, { action: 'upscale' });
    assert.equal(r.status, 400);
    ok('ছবি কাটা, ২K/৪K বড় করা, আপলোড করা ছবি বদলানো');

    // অ্যাপ হিসেবে ইনস্টলের ফাইল
    r = await call('GET', '/manifest.webmanifest');
    assert.equal(r.data.display, 'standalone');
    r = await call('GET', '/sw.js');
    assert.equal(r.status, 200);
    r = await call('GET', '/icon-512.png');
    assert.equal(r.headers.get('content-type'), 'image/png');
    ok('অ্যাপ ইনস্টলের ফাইল (manifest, service worker, আইকন)');

    // ট্র্যাশ: মুছলে ট্র্যাশে, ফেরত আনা যায়, দ্বিতীয়বার মুছলে চিরতরে
    r = await call('DELETE', `/api/assets/${video.id}`);
    assert.equal(r.status, 200);
    P = (await call('GET', `/api/projects/${pid}`)).data;
    assert.ok(!P.assets.some(a => a.id === video.id));
    assert.equal(P.trashCount, 1);
    r = await call('GET', `/api/projects/${pid}/trash`);
    assert.equal(r.data.assets[0].id, video.id);
    await call('POST', `/api/assets/${video.id}/restore`);
    P = (await call('GET', `/api/projects/${pid}`)).data;
    assert.ok(P.assets.some(a => a.id === video.id));
    await call('DELETE', `/api/assets/${video.id}`);
    r = await call('DELETE', `/api/assets/${video.id}`);
    r = await call('GET', `/media/${video.id}`);
    assert.equal(r.status, 404);
    ok('ট্র্যাশ, ফেরত আনা, চিরতরে মোছা');
    r = await call('DELETE', `/api/projects/${pid}`);
    assert.equal(r.status, 200);
    assert.equal(fs.readdirSync(path.join(dataDir, 'media')).filter(d => d !== 'voices').flatMap(d => fs.readdirSync(path.join(dataDir, 'media', d))).length, 0, 'ব্যবহারকারীর ফাইল থেকে গেছে');
    ok('মুছলে ফাইলও মুছে যায়');

    console.log('\nসব পরীক্ষা পাস করেছে।');
  } catch (e) {
    console.error('\nব্যর্থ:', e);
    console.error('--- সার্ভার লগ ---\n' + log);
    process.exitCode = 1;
  } finally {
    srv.kill();
    await new Promise(r => setTimeout(r, 300));
    if (pgdb) await pgdb.drop().catch(e => console.error('ডেটাবেস মোছা যায়নি', e.message));
    mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
