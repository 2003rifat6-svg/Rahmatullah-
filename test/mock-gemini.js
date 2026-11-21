// নকল Gemini সার্ভার (পরীক্ষার জন্য)। প্রম্পটে বিশেষ শব্দ দিলে কঠিন পরিস্থিতি তৈরি করে:
//   SLOW<n>   — ভিডিও n বার পোল পর্যন্ত চলতেই থাকে
//   FLAKY     — প্রথম ২ বার পোলে 503
//   URI_EVIL  — ফলাফলের ফাইল-লিংক অন্য (ক্ষতিকর) সার্ভারের
//   URI_OK    — ফলাফল Gemini-র ফাইল-লিংকে, যেটা অন্য স্টোরেজে রিডাইরেক্ট করে
//   EXPIRE    — previous_interaction_id দিলে 404 (Google-এর রেকর্ড মেয়াদোত্তীর্ণ)
//   BLOCKME   — মডেল ছবি/ভিডিও না দিয়ে শুধু লেখা দেয়
'use strict';
const http = require('node:http');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MP4 = Buffer.from('00000020667479706973736f6d0000020069736f6d69736f32617663316d703431', 'hex').toString('base64');

// আসল WAV (24 kHz, মোনো, 16-বিট, ০.৬ সে. সুর) — ffmpeg দিয়ে মাপা যায়
function wav(seconds = 0.6, freq = 440) {
  const rate = 24000, n = Math.round(rate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// ডকুমেন্টারি স্টুডিওর পরীক্ষা: শেষ ব্যবহারকারী-লেখায় DOCTEST_<নাম> থাকলে নির্দিষ্ট ধাপে টুল ডাকে।
// আসল API-র মতো: প্রতিটা functionCall-এ thoughtSignature থাকে, আর সেটা ফেরত না পাঠালে 400।
function docScenario(body) {
  const contents = body.contents || [];
  for (const c of contents) {
    if (c.role !== 'model') continue;
    for (const p of c.parts || []) if (p.functionCall && !p.thoughtSignature) return { status: 400, error: 'Function call is missing a thought_signature in functionCall parts.' };
  }
  let lastText = -1;
  // ব্যবহারকারীর সর্বশেষ লেখা (টুল-উত্তর নয়) থেকেই পরিস্থিতি ঠিক হয়
  contents.forEach((c, i) => { if (c.role === 'user' && (c.parts || []).some(p => typeof p.text === 'string')) lastText = i; });
  const text = lastText >= 0 ? contents[lastText].parts.map(p => p.text || '').join(' ') : '';
  const rounds = contents.slice(lastText + 1).filter(c => c.role === 'model').length;
  const lastResp = (() => {
    const c = contents[contents.length - 1];
    const fr = (c?.parts || []).filter(p => p.functionResponse).map(p => p.functionResponse);
    return fr.length ? fr : null;
  })();
  const name = (/DOCTEST_([A-Z]+)/.exec(text) || [])[1];
  const arg = (/DOCTEST_[A-Z]+\s+(\S+)/.exec(text) || [])[1];
  const plans = {
    FILE: [[['file_write', { path: 'work/SCRIPT.md', content: '# Script\n\nHello world.' }]], [['file_list', {}]]],
    ASK: [[['set_step', { step: '1', status: 'doing', note: 'নিরাপত্তা যাচাই' }], ['ask_user', { question: 'কোন স্টাইল চাও?', options: ['S1 সিনেমাটিক', 'S3 থ্রিডি'] }]]],
    IMG: [[['image_generate', { prompt: 'A bank at night', path: 'stills/shot01', aspect: '16:9' }]], [['image_edit', { file: 'stills/shot01.png', prompt: 'warmer light', path: 'stills/shot01b' }]]],
    FETCH: [[['web_fetch', { url: arg }]]],
    BUDGET: [[['video_generate', { prompt: 'slow push-in', path: 'clips/big', seconds: 15 }]]],
    VIDEO: [[['image_generate', { prompt: 'A vault door', path: 'stills/v' }]], [['video_generate', { prompt: 'door opens slowly', image_file: 'stills/v.png', seconds: 4, path: 'clips/v' }]]],
    TTS: [[['tts', { text: 'Para one is here.\n\nPara two follows.', voice: 'Charon', style: 'calm', path: 'audio/NARRATION.wav' }]],
      [['media_job', { recipe: 'audio_probe', params: { input: 'audio/NARRATION.wav' } }]],
      [['media_job', { recipe: 'audio_clean', params: { input: 'audio/NARRATION.wav' }, output: 'audio/NARRATION_CLEAN.wav' }]]],
    SEARCH: [[['web_search', { query: 'Banco Rio robbery 2006' }]]],
    YT: [[['yt_search', { query: 'bank heist documentary', order: 'viewCount' }]]],
    TRAVERSAL: [[['file_write', { path: '../../etc/evil.md', content: 'x' }], ['file_read', { path: '../x' }], ['file_write', { path: 'work/run.sh', content: 'x' }]]],
    LOOP: Array.from({ length: 40 }, () => [['file_list', {}]]),
  };
  const plan = plans[name];
  if (!plan) return { parts: [{ text: 'ঠিক আছে। ' + (lastResp ? 'DONE ' + JSON.stringify(lastResp).slice(0, 3000) : 'কী করতে চাও?') }] };
  if (rounds >= plan.length) return { parts: [{ text: 'DONE ' + JSON.stringify(lastResp).slice(0, 3000) + '\n\n▼ কপি করুন\nThey Faked a Hostage Crisis\n▲ এখানে শেষ' }] };
  return { parts: plan[rounds].map(([n, a], i) => ({ functionCall: { name: n, args: a, id: `call_${rounds}_${i}` }, thoughtSignature: `sig-${rounds}-${i}` })) };
}

function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

async function startMock() {
  const calls = [];
  const evilHits = [];
  const storageHits = [];
  const its = new Map();
  let seq = 0;

  const evil = http.createServer((req, res) => { evilHits.push({ url: req.url, headers: req.headers }); res.end('stolen'); });
  const evilPort = await listen(evil);
  const store = http.createServer((req, res) => { storageHits.push({ url: req.url, headers: req.headers }); res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(Buffer.from(MP4, 'base64')); });
  const storePort = await listen(store);
  const ytHits = [];
  const yt = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    ytHits.push(u.pathname + u.search);
    const send = o => { res.writeHead(u.searchParams.get('key') === 'ytk' ? 200 : 403, { 'content-type': 'application/json' }); res.end(JSON.stringify(u.searchParams.get('key') === 'ytk' ? o : { error: { message: 'bad key' } })); };
    if (u.pathname.endsWith('/search')) return send({ items: [{ id: { videoId: 'vid1' } }, { id: { videoId: 'vid2' } }] });
    if (u.pathname.endsWith('/videos')) return send({ items: u.searchParams.get('id').split(',').map((id, i) => ({ id, snippet: { title: 'Heist ' + id, channelTitle: 'Chan', channelId: 'ch1', publishedAt: '2026-05-01T00:00:00Z', tags: ['heist'] }, statistics: { viewCount: String(1500000 - i * 1000000) }, contentDetails: { duration: 'PT10M30S' } })) });
    if (u.pathname.endsWith('/channels')) return send({ items: [{ id: 'ch1', snippet: { title: 'Chan', country: 'US' }, statistics: { subscriberCount: '1000' } }] });
    if (u.pathname.endsWith('/commentThreads')) return send({ items: [{ snippet: { topLevelComment: { snippet: { textDisplay: 'who is here after the movie', likeCount: 5 } }, totalReplyCount: 1 } }] });
    res.writeHead(404); res.end('{}');
  });
  const ytPort = await listen(yt);

  let base = '';
  const mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method, url: req.url, body, key: req.headers['x-goog-api-key'] });
      const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      const text = JSON.stringify(body?.input || '');

      if (req.method === 'POST' && req.url === '/v1beta/interactions') {
        if (/EXPIRE/.test(text) && body.previous_interaction_id) return send(404, { error: { message: 'Interaction not found' } });
        const id = 'v1_m' + ++seq;
        const type = body.response_format?.type;
        let block = type === 'audio' ? { type: 'audio', mime_type: 'audio/wav', data: wav().toString('base64') }
          : type === 'video' ? { type: 'video', mime_type: 'video/mp4', data: MP4 }
          : { type: 'image', mime_type: 'image/png', data: PNG };
        if (/URI_EVIL/.test(text)) block = { type: 'video', mime_type: 'video/mp4', uri: `http://127.0.0.1:${evilPort}/steal` };
        if (/URI_OK/.test(text)) block = { type: 'video', mime_type: 'video/mp4', uri: `${base}/files/f${seq}:download?alt=media` };
        const done = { id, status: 'completed', steps: [{ type: 'model_output', content: [block] }] };
        if (/BLOCKME/.test(text)) done.steps = [{ type: 'model_output', content: [{ type: 'text', text: 'Blocked by safety filter' }] }];
        const slow = /SLOW(\d+)/.exec(text);
        its.set(id, { done, polls: 0, needed: slow ? +slow[1] : 1, flaky: /FLAKY/.test(text) ? 2 : 0 });
        if (body.background) return send(200, { id, status: 'in_progress' });
        return send(200, done);
      }
      const g = /^\/v1beta\/interactions\/(.+)$/.exec(req.url);
      if (req.method === 'GET' && g) {
        const it = its.get(decodeURIComponent(g[1]));
        if (!it) return send(404, { error: { message: 'not found' } });
        if (it.flaky > 0) { it.flaky--; return send(503, { error: { message: 'high demand' } }); }
        it.polls++;
        return send(200, it.polls < it.needed ? { id: it.done.id, status: 'in_progress' } : it.done);
      }
      if (req.method === 'GET' && /^\/v1beta\/files\//.test(req.url)) {
        res.writeHead(302, { location: `http://127.0.0.1:${storePort}/obj${req.url.replace(/\W+/g, '_')}` });
        return res.end();
      }
      if (req.method === 'POST' && /:generateContent$/.test(req.url) && body.tools?.some(t => t.google_search)) {
        return send(200, { candidates: [{ content: { parts: [{ text: 'The robbery happened on January 13, 2006.' }] },
          groundingMetadata: { webSearchQueries: ['banco rio robbery'], groundingChunks: [{ web: { uri: 'https://example.org/a', title: 'example.org' } }] } }] });
      }
      if (req.method === 'POST' && /:generateContent$/.test(req.url) && body.tools?.some(t => t.functionDeclarations)) {
        const r = docScenario(body);
        if (r.status) return send(r.status, { error: { message: r.error } });
        return send(200, { candidates: [{ content: { role: 'model', parts: r.parts }, finishReason: 'STOP' }] });
      }
      if (req.method === 'POST' && /:generateContent$/.test(req.url)) {
        const schema = Boolean(body.generationConfig?.responseSchema);
        const t = schema
          ? JSON.stringify({ title: 'প্রথম দেখা', summary: 'দেখা হয়।', scenes: [{ location: 'ঘাট', action: 'নামে', dialogue: '', characters: [], video_prompt: 'A boat.' }] })
          : 'A cinematic shot.';
        return send(200, { candidates: [{ content: { parts: [{ text: t }] } }] });
      }
      send(404, { error: { message: 'unknown ' + req.url } });
    });
  });
  const port = await listen(mock);
  base = `http://127.0.0.1:${port}/v1beta`;
  return {
    base, calls, evilHits, storageHits, ytHits, ytBase: `http://127.0.0.1:${ytPort}/youtube/v3`,
    close() { mock.close(); evil.close(); store.close(); yt.close(); },
  };
}

module.exports = { startMock, PNG, wav, docScenario };
