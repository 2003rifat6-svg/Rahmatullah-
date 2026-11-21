// ডকুমেন্টারি স্টুডিও: আলাদা মডিউল। নিজের চ্যাট, নিজের System Instruction, নিজের প্রজেক্ট, ফাইল আর শেখা নিয়ম (LESSONS)।
// অ্যাপের অন্য চ্যাট/প্রজেক্টের সাথে কিছুই ভাগ করে না: আলাদা টেবিল (doc_*), আলাদা স্টোরেজ ফোল্ডার (doc/<uid>/<project>/...)।
//
// কাজের ধরন: ব্যবহারকারী বার্তা পাঠালে সার্ভারে একটা "টার্ন" চলে। মডেল (Gemini, function calling) টুল ডাকে,
// সার্ভার টুল চালিয়ে ফল ফেরত দেয়, যতক্ষণ না মডেল উত্তর লেখে বা ব্যবহারকারীর সিদ্ধান্ত চায়।
// ব্রাউজার বার্তাগুলো একটু পরপর এনে দেখায়।
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { VOICES, voiceOf, isFinished, FAILED } = require('./gemini');
const { newId, str, sniffImage } = require('./assets');
const { toPcm, joinPcm, runRecipe, ffmpegAvailable, RECIPES } = require('./media');
const { createZip } = require('./zip');

const DEFAULT_SYSTEM = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', 'prompts', 'documentary.txt'), 'utf8'); } catch { return 'You are Documentary Studio. Reply in simple Bengali.'; }
})();
const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const MAX_TOOL_ROUNDS = 16;
const TURN_LEASE = 20 * 60e3;
const TEXT_EXT = { md: 'text/markdown', txt: 'text/plain', json: 'application/json', srt: 'application/x-subrip', csv: 'text/csv' };
const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/flac': 'flac', ...Object.fromEntries(Object.entries(TEXT_EXT).map(([e, m]) => [m, e])) };
const kindOf = mime => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'text');

// ফাইলের পথ: work/SCRIPT.md, stills/shot01.png ... (ফোল্ডার ভাঙা "..", অদ্ভুত অক্ষর নিষেধ)
function cleanPath(p) {
  const s = String(p || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
  if (!s || s.length > 160 || s.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9 _.()\-/]*$/.test(s) || s.endsWith('/')) return null;
  return s.replace(/\/+/g, '/');
}

// আপলোড করা ফাইলের আসল ধরন (প্রথম বাইট দেখে)
function sniffMedia(buf, name = '') {
  const img = sniffImage(buf);
  if (img) return img;
  const a = s => buf.toString('ascii', 0, s);
  if (buf.length > 12 && a(4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buf.length > 3 && (a(3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return 'audio/mpeg';
  if (buf.length > 4 && a(4) === 'OggS') return 'audio/ogg';
  if (buf.length > 4 && a(4) === 'fLaC') return 'audio/flac';
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (/^M4A|^M4B/.test(brand)) return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase();
  if (TEXT_EXT[ext] && !buf.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return TEXT_EXT[ext]; } catch { return null; }
  }
  return null;
}

/* ---------------- নিরাপদ ওয়েব-পড়া (SSRF ঠেকানো) ---------------- */
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (v4) return isPrivateIp(v4[1]);
    return l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('64:ff9b:') || l.startsWith('2001:db8');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
// সংযোগের মুহূর্তেই ঠিকানা যাচাই, তাই DNS বদলে ধোঁকা দেওয়া যায় না
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, list) => {
    if (err) return cb(err);
    const bad = list.find(x => isPrivateIp(x.address));
    if (bad || !list.length) return cb(Object.assign(new Error(`ভেতরের/ব্যক্তিগত ঠিকানায় যাওয়া নিষেধ (${host})`), { code: 'EPRIVATE' }));
    if (opts && opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}
function fetchPublic(url, { maxBytes = 2 * 1024 * 1024, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('ঠিকানা ঠিক নেই')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('শুধু http/https'));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new Error(`ভেতরের/ব্যক্তিগত ঠিকানায় যাওয়া নিষেধ (${u.hostname})`));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { lookup: safeLookup, timeout: 20000, headers: { 'user-agent': 'ChitropotDocStudio/1.0', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new Error('অনেকবার রিডাইরেক্ট'));
        return resolve(fetchPublic(new URL(res.headers.location, u).toString(), { maxBytes, redirects: redirects - 1 }));
      }
      const chunks = [];
      let size = 0;
      res.on('data', c => { size += c.length; if (size > maxBytes) { req.destroy(); } else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: Buffer.concat(chunks), url: u.toString(), truncated: size > maxBytes }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('সময়মতো উত্তর আসেনি')));
    req.on('error', reject);
  });
}
function htmlToText(html) {
  return html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

/* ---------------- টুলের বর্ণনা (মডেলকে দেওয়া হয়) ---------------- */
const S = (type, description, extra = {}) => ({ type, description, ...extra });
const TOOLS = [
  ['web_search', 'Search the web with Google Search grounding. Returns an answer and source URLs.', { query: S('string', 'search query') }, ['query']],
  ['web_fetch', 'Fetch a public web page and return its text (first 20,000 characters).', { url: S('string', 'http(s) URL') }, ['url']],
  ['yt_search', 'Search YouTube videos (YouTube Data API v3). Returns id, title, channel, views, published date, duration.', {
    query: S('string', 'search query'), published_after: S('string', 'ISO date, e.g. 2025-11-21T00:00:00Z'),
    order: S('string', 'relevance | viewCount | date', { enum: ['relevance', 'viewCount', 'date'] }), max: S('integer', '1-25'),
  }, ['query']],
  ['yt_video', 'Get details of YouTube videos: title, description, tags, statistics, thumbnail URL.', { ids: S('array', 'video ids', { items: { type: 'string' } }) }, ['ids']],
  ['yt_channel', 'Get a YouTube channel: statistics, country, description.', { id: S('string', 'channel id') }, ['id']],
  ['yt_comments', 'Get top comments of a YouTube video.', { video_id: S('string', 'video id'), n: S('integer', '1-50') }, ['video_id']],
  ['image_generate', 'Generate images (16:9 by default) with optional reference images from the project. Costs money.', {
    prompt: S('string', 'English image prompt'), path: S('string', 'output path without extension, e.g. stills/shot012'),
    ref_files: S('array', 'project image paths used as references (character/location sheets)', { items: { type: 'string' } }),
    aspect: S('string', '16:9 | 9:16 | 1:1 | 4:3 | 3:4', { enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] }), n: S('integer', '1-4'),
    size: S('string', '1K | 2K | 4K', { enum: ['1K', '2K', '4K'] }),
  }, ['prompt', 'path']],
  ['image_edit', 'Edit an existing project image with an instruction. Costs money.', {
    file: S('string', 'project image path'), prompt: S('string', 'edit instruction in English'), path: S('string', 'output path without extension'),
  }, ['file', 'prompt', 'path']],
  ['video_generate', 'Start an image-to-video or text-to-video clip (runs in the background, a few minutes). Costs money per second.', {
    prompt: S('string', 'English motion + camera prompt'), image_file: S('string', 'optional start frame (project image path)'),
    seconds: S('integer', '3-15'), aspect: S('string', '16:9 | 9:16', { enum: ['16:9', '9:16'] }),
    resolution: S('string', '360p | 720p | 1080p', { enum: ['360p', '720p', '1080p'] }), path: S('string', 'output path without extension, e.g. clips/shot012'),
  }, ['prompt', 'path']],
  ['tts_voices', 'List the available narration voices (name, gender, character). The user can hear samples in the app.', { gender: S('string', 'male | female | any', { enum: ['male', 'female', 'any'] }) }, []],
  ['tts', 'Make narration audio. Long text is split by paragraph (blank line) and joined with natural pauses. Write numbers as words and hard names phonetically.', {
    text: S('string', 'narration text'), voice: S('string', 'voice name from tts_voices'), style: S('string', 'delivery style in English, e.g. "deep, calm, authoritative documentary narrator"'),
    pause_ms: S('integer', 'pause between paragraphs, 300-1500'), path: S('string', 'output path, e.g. audio/NARRATION.wav or audio/sample_Charon.wav'),
  }, ['text', 'voice', 'path']],
  ['media_job', 'Run a deterministic ffmpeg recipe. Recipes: audio_probe{input}, audio_clean{input}, clip_fit{input,seconds}, grade{input,style:S1|S2|S3|S4}, mix{voice,music?,music_db?}, assemble{clips[],audio?,lead_in?}, small_copy{input}, qc{input}. Inputs are project file paths.', {
    recipe: S('string', 'recipe name', { enum: Object.keys(RECIPES) }), params: S('object', 'recipe parameters (file inputs are project paths)'), output: S('string', 'output path for the produced file'),
  }, ['recipe', 'params']],
  ['file_read', 'Read a text file of this project (or metadata of a media file).', { path: S('string', 'project path') }, ['path']],
  ['file_write', 'Write a text file (.md .txt .json .srt .csv) into this project. Overwrites.', { path: S('string', 'project path'), content: S('string', 'file content') }, ['path', 'content']],
  ['file_list', 'List files of this project, optionally inside one folder.', { folder: S('string', 'folder, e.g. work') }, []],
  ['ask_user', 'Ask the user a decision question with options (shown as buttons). Your turn ends; the answer comes back as the result.', {
    question: S('string', "question in the user's language (see app context)"), options: S('array', "2-6 short options in the user's language", { items: { type: 'string' } }),
  }, ['question', 'options']],
  ['set_step', 'Update the progress checklist shown to the user (steps 1-15 of the run order, 4b allowed).', {
    step: S('string', 'step number, e.g. "3" or "4b"'), status: S('string', 'todo | doing | done | blocked', { enum: ['todo', 'doing', 'done', 'blocked'] }), note: S('string', "short note in the user's language"),
  }, ['step', 'status']],
  ['save_lesson', 'Save a rule to LESSONS.md (module-wide memory, used in every project).', { text: S('string', 'the rule') }, ['text']],
];
const DECLS = TOOLS.map(([name, description, properties, required]) => ({ name, description, parameters: { type: 'object', properties, required } }));
const TOOL_LABEL = {
  web_search: '🔎 ওয়েবে খোঁজা', web_fetch: '🌐 পাতা পড়া', yt_search: '▶️ YouTube খোঁজা', yt_video: '▶️ ভিডিওর তথ্য', yt_channel: '▶️ চ্যানেলের তথ্য', yt_comments: '💬 কমেন্ট পড়া',
  image_generate: '🖼️ ছবি বানানো', image_edit: '🖼️ ছবি বদলানো', video_generate: '🎥 ভিডিও শুরু', tts_voices: '🎙️ কণ্ঠের তালিকা', tts: '🎙️ কণ্ঠ বানানো',
  media_job: '🎛️ এডিট/প্রসেস', file_read: '📄 ফাইল পড়া', file_write: '📝 ফাইল লেখা', file_list: '📁 ফাইলের তালিকা', ask_user: '❓ প্রশ্ন', set_step: '☑️ ধাপ', save_lesson: '🧠 নিয়ম সেভ',
};

function createDocStudio({ cfg, db, storage, gemini, log, route, httpErr, rate, activity, checkUploadQuota, maintenanceCheck = async () => {} }) {
  const now = () => Date.now();
  const busy = new Set(); // এই সার্ভারে চলমান টার্ন

  /* ---------------- ডেটা ---------------- */
  async function ownDoc(user, id) {
    const p = await db.get('SELECT * FROM doc_projects WHERE id=? AND uid=?', id, user.id);
    if (!p) throw httpErr(404, 'প্রজেক্ট পাওয়া যায়নি');
    p.state = parseJson(p.state, {});
    return p;
  }
  const saveState = (p) => db.run('UPDATE doc_projects SET state=?, updated=? WHERE id=?', JSON.stringify(p.state), now(), p.id);
  async function settings(uid) {
    const s = await db.get('SELECT system, lessons FROM doc_settings WHERE uid=?', uid);
    return { system: s?.system || '', lessons: s?.lessons || '' };
  }
  async function nextSeq(pid) { return Number((await db.get('SELECT COALESCE(MAX(seq),0) AS n FROM doc_messages WHERE project_id=?', pid)).n) + 1; }
  async function addMsg(p, role, parts, display = '', meta = {}) {
    const id = newId();
    await db.run('INSERT INTO doc_messages(id,project_id,uid,seq,role,parts,display,meta,created) VALUES(?,?,?,?,?,?,?,?,?)',
      id, p.id, p.uid, await nextSeq(p.id), role, JSON.stringify(parts), String(display).slice(0, 60000), JSON.stringify(meta), now());
    await db.run('UPDATE doc_projects SET updated=? WHERE id=?', now(), p.id);
    return id;
  }
  const fileByPath = (p, fp) => db.get('SELECT * FROM doc_files WHERE project_id=? AND path=?', p.id, fp);
  async function putFile(p, fp, buf, mime, { source = 'generated', note = '', cost = 0, status = 'ready', interactionId = null } = {}) {
    const old = await fileByPath(p, fp);
    const id = newId();
    const key = `doc/${p.uid}/${p.id}/${id}.${EXT_OF[mime] || 'bin'}`;
    if (buf) await storage.put(key, buf, mime);
    await db.run(`INSERT INTO doc_files(id,project_id,uid,path,mime,kind,file,size,source,note,status,interaction_id,cost_usd,created,updated)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, p.id, p.uid, fp, mime, kindOf(mime), key, buf ? buf.length : 0, source, String(note).slice(0, 500), status, interactionId, cost, now(), now());
    if (old) { await db.run('DELETE FROM doc_files WHERE id=?', old.id); await storage.remove(old.file).catch(() => {}); }
    return id;
  }
  async function readFile(p, fp) {
    const f = await fileByPath(p, fp);
    if (!f) throw new Error(`ফাইল নেই: ${fp}`);
    if (f.status !== 'ready') throw new Error(`ফাইল এখনো তৈরি হচ্ছে: ${fp}`);
    return { f, buf: await storage.get(f.file) };
  }
  async function spend(p, usd) {
    if (!usd) return;
    await db.run('UPDATE doc_projects SET spent_usd=spent_usd+?, updated=? WHERE id=?', usd, now(), p.id);
    p.spent_usd = Number(p.spent_usd) + usd;
  }
  // খরচের আগে বাজেট দেখা: বাজেটের বেশি হলে চালানো হয় না, মডেল ব্যবহারকারীকে জিজ্ঞেস করে
  function budgetCheck(p, usd) {
    const left = Number(p.budget_usd) - Number(p.spent_usd);
    if (usd > 0 && usd > left + 1e-9) {
      return { error: 'over_budget', cost_usd: +usd.toFixed(3), budget_left_usd: +left.toFixed(3),
        instruction: 'Do NOT retry. Tell the user in Bengali the cost and the remaining budget, and ask them to raise the project budget (the 💰 button) if they agree.' };
    }
    return null;
  }
  async function dailyCheck(user, kind, n) {
    if (user.owner) return null;
    const limit = kind === 'video' ? cfg.dailyVideos : cfg.dailyImages;
    const since = now() - 24 * 3600e3;
    const used = Number((await db.get("SELECT COUNT(*) AS n FROM doc_files WHERE uid=? AND kind=? AND source='generated' AND created>=? AND status<>'failed'", user.id, kind, since)).n)
      + Number((await db.get("SELECT COUNT(*) AS n FROM jobs WHERE uid=? AND kind=? AND created>=? AND status NOT IN ('failed','cancelled')", user.id, kind, since)).n);
    return used + n > limit ? { error: 'daily_limit', message: `আজকের ${kind === 'video' ? 'ভিডিও' : 'ছবি'} সীমা (${limit}টি) শেষ।` } : null;
  }

  /* ---------------- YouTube ---------------- */
  async function yt(pathname, params) {
    if (!cfg.youtubeKey) return { error: 'not_configured', message: 'YouTube Data API key (YOUTUBE_API_KEY) সার্ভারে বসানো নেই, তাই YouTube থেকে প্রমাণ আনা যাচ্ছে না।' };
    const u = new URL(cfg.youtubeBase.replace(/\/+$/, '') + pathname);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    u.searchParams.set('key', cfg.youtubeKey);
    const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: 'youtube_' + r.status, message: String(j?.error?.message || 'YouTube ত্রুটি').slice(0, 300) };
    return j;
  }
  const isoDur = d => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; };
  async function ytVideos(ids) {
    const j = await yt('/videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(0, 50).join(','), maxResults: 50 });
    if (j.error) return j;
    return {
      videos: (j.items || []).map(v => ({
        id: v.id, title: v.snippet?.title, channel: v.snippet?.channelTitle, channel_id: v.snippet?.channelId, published: v.snippet?.publishedAt,
        views: Number(v.statistics?.viewCount || 0), likes: Number(v.statistics?.likeCount || 0), comments: Number(v.statistics?.commentCount || 0),
        duration_s: isoDur(v.contentDetails?.duration), tags: v.snippet?.tags || [], description: String(v.snippet?.description || '').slice(0, 1500),
        thumbnail: v.snippet?.thumbnails?.maxres?.url || v.snippet?.thumbnails?.high?.url,
      })),
    };
  }

  /* ---------------- টুল চালানো ---------------- */
  async function interactionMedia(it, type) {
    const blocks = gemini.outputBlocks(it).filter(b => b.type === type);
    return Promise.all(blocks.map(async b => ({ buf: await gemini.mediaBytes(b), mime: b.mime_type })));
  }
  const TOOLS_IMPL = {
    async web_search(p, a) {
      const q = str(a.query, 500);
      if (!q) return { error: 'empty query' };
      const j = await gemini.textCall({ contents: [{ role: 'user', parts: [{ text: q }] }], tools: [{ google_search: {} }] }, 90000);
      const c = j.candidates?.[0] || {};
      const chunks = c.groundingMetadata?.groundingChunks || [];
      return { answer: gemini.textOf(j).slice(0, 6000), sources: chunks.map(ch => ch.web).filter(Boolean).slice(0, 15).map(w => ({ title: w.title, url: w.uri })), queries: c.groundingMetadata?.webSearchQueries || [] };
    },
    async web_fetch(p, a) {
      const r = await fetchPublic(str(a.url, 2000));
      const text = /html/i.test(r.type) ? htmlToText(r.body.toString('utf8')) : /text|json|xml/i.test(r.type) ? r.body.toString('utf8') : '';
      if (!text) return { status: r.status, url: r.url, error: `লেখা নয় (${r.type || 'অজানা ধরন'})` };
      return { status: r.status, url: r.url, text: text.slice(0, 20000), truncated: r.truncated || text.length > 20000 };
    },
    async yt_search(p, a) {
      const j = await yt('/search', { part: 'snippet', type: 'video', q: str(a.query, 300), order: a.order || 'relevance', publishedAfter: a.published_after || undefined, maxResults: Math.min(25, Math.max(1, +a.max || 10)) });
      if (j.error) return j;
      const ids = (j.items || []).map(i => i.id?.videoId).filter(Boolean);
      return ids.length ? ytVideos(ids) : { videos: [] };
    },
    async yt_video(p, a) { return ytVideos((Array.isArray(a.ids) ? a.ids : [a.ids]).map(x => str(x, 20)).filter(Boolean)); },
    async yt_channel(p, a) {
      const j = await yt('/channels', { part: 'snippet,statistics', id: str(a.id, 40) });
      if (j.error) return j;
      return { channels: (j.items || []).map(c => ({ id: c.id, title: c.snippet?.title, country: c.snippet?.country || null, created: c.snippet?.publishedAt, subscribers: Number(c.statistics?.subscriberCount || 0), views: Number(c.statistics?.viewCount || 0), videos: Number(c.statistics?.videoCount || 0), description: String(c.snippet?.description || '').slice(0, 800) })) };
    },
    async yt_comments(p, a) {
      const j = await yt('/commentThreads', { part: 'snippet', videoId: str(a.video_id, 20), order: 'relevance', maxResults: Math.min(50, Math.max(1, +a.n || 20)), textFormat: 'plainText' });
      if (j.error) return j;
      return { comments: (j.items || []).map(c => ({ text: String(c.snippet?.topLevelComment?.snippet?.textDisplay || '').slice(0, 500), likes: c.snippet?.topLevelComment?.snippet?.likeCount || 0, replies: c.snippet?.totalReplyCount || 0 })) };
    },
    async image_generate(p, a, user) {
      const n = Math.min(4, Math.max(1, +a.n || 1));
      const base = cleanPath(a.path);
      if (!base) return { error: 'path ঠিক নেই' };
      const cost = cfg.imageUsd * n;
      const stop = budgetCheck(p, cost) || await dailyCheck(user, 'image', n);
      if (stop) return stop;
      await checkUploadQuota(user, 0);
      const refs = [];
      for (const rp of (Array.isArray(a.ref_files) ? a.ref_files : []).slice(0, 14)) {
        const { f, buf } = await readFile(p, cleanPath(rp) || '-');
        if (f.kind !== 'image') return { error: `${rp} ছবি নয়` };
        refs.push({ type: 'image', data: buf.toString('base64'), mime_type: f.mime });
      }
      const made = [];
      for (let i = 0; i < n; i++) {
        const prompt = str(a.prompt, 6000);
        const it = await gemini.createInteraction({ model: cfg.imageModel, input: refs.length ? [...refs, { type: 'text', text: prompt }] : prompt, store: false,
          response_format: { type: 'image', image_size: ['1K', '2K', '4K'].includes(a.size) ? a.size : '1K', aspect_ratio: a.aspect || '16:9' } }, false);
        const [img] = await interactionMedia(it, 'image');
        if (!img) return { error: 'model returned no image', model_text: gemini.outputText(it), made };
        const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(img.mime) ? img.mime : 'image/png';
        const fp = `${base}${n > 1 ? '_' + (i + 1) : ''}.${EXT_OF[mime]}`;
        await putFile(p, fp, img.buf, mime, { note: prompt.slice(0, 300), cost: cfg.imageUsd });
        await spend(p, cfg.imageUsd);
        made.push(fp);
      }
      return { files: made, cost_usd: cost, cost_note: cfg.imageUsd ? 'estimate from IMAGE_USD' : 'IMAGE_USD not set, cost unknown' };
    },
    async image_edit(p, a, user) {
      const base = cleanPath(a.path);
      if (!base) return { error: 'path ঠিক নেই' };
      const stop = budgetCheck(p, cfg.imageUsd) || await dailyCheck(user, 'image', 1);
      if (stop) return stop;
      const { f, buf } = await readFile(p, cleanPath(a.file) || '-');
      if (f.kind !== 'image') return { error: 'file ছবি নয়' };
      const it = await gemini.createInteraction({ model: cfg.imageModel, input: [{ type: 'image', data: buf.toString('base64'), mime_type: f.mime }, { type: 'text', text: str(a.prompt, 4000) }], store: false, response_format: { type: 'image', image_size: '1K' } }, false);
      const [img] = await interactionMedia(it, 'image');
      if (!img) return { error: 'model returned no image', model_text: gemini.outputText(it) };
      const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(img.mime) ? img.mime : 'image/png';
      const fp = `${base}.${EXT_OF[mime]}`;
      await putFile(p, fp, img.buf, mime, { note: 'edit: ' + str(a.prompt, 280), cost: cfg.imageUsd });
      await spend(p, cfg.imageUsd);
      return { file: fp, cost_usd: cfg.imageUsd };
    },
    async video_generate(p, a, user) {
      const base = cleanPath(a.path);
      if (!base) return { error: 'path ঠিক নেই' };
      const seconds = Math.min(15, Math.max(3, Math.round(+a.seconds || 8)));
      const cost = seconds * cfg.videoUsdPerSec;
      const stop = budgetCheck(p, cost) || await dailyCheck(user, 'video', 1);
      if (stop) return stop;
      await checkUploadQuota(user, 0);
      const input = [];
      if (a.image_file) {
        const { f, buf } = await readFile(p, cleanPath(a.image_file) || '-');
        if (f.kind !== 'image') return { error: 'image_file ছবি নয়' };
        input.push({ type: 'image', data: buf.toString('base64'), mime_type: f.mime });
      }
      const prompt = str(a.prompt, 4000);
      const body = { model: cfg.videoModel, input: input.length ? [...input, { type: 'text', text: prompt }] : prompt, store: true,
        response_format: { type: 'video', aspect_ratio: a.aspect === '9:16' ? '9:16' : '16:9', resolution: ['360p', '720p', '1080p'].includes(a.resolution) ? a.resolution : '720p', duration: `${seconds}s` } };
      const it = await gemini.createInteraction(body, true);
      const fp = `${base}.mp4`;
      if (isFinished(it)) {
        const [v] = await interactionMedia(it, 'video');
        if (!v) return { error: 'model returned no video', model_text: gemini.outputText(it) };
        await putFile(p, fp, v.buf, 'video/mp4', { note: prompt.slice(0, 300), cost });
        await spend(p, cost);
        return { file: fp, status: 'ready', cost_usd: cost };
      }
      await putFile(p, fp, null, 'video/mp4', { note: prompt.slice(0, 300), cost, status: 'pending', interactionId: it.id });
      await spend(p, cost);
      return { file: fp, status: 'pending', cost_usd: cost, note: 'Generating in the background (usually 1-5 minutes). Check later with file_list; do not start it again.' };
    },
    async tts_voices(p, a) {
      const g = a.gender === 'male' || a.gender === 'female' ? a.gender : null;
      return { voices: VOICES.filter(v => !g || v.gender === g).map(v => ({ name: v.name, gender: v.gender, character: v.trait })), note: 'The user can play a sample of each voice in the app (🎙️ button).' };
    },
    async tts(p, a, user) {
      const v = voiceOf(str(a.voice, 40));
      if (!v) return { error: 'unknown voice; call tts_voices' };
      const fp = cleanPath(a.path);
      if (!fp || !/\.wav$/i.test(fp)) return { error: 'path must end with .wav' };
      const text = str(a.text, 60000);
      if (!text) return { error: 'empty text' };
      const cost = cfg.ttsUsdPer1k * text.length / 1000;
      const stop = budgetCheck(p, cost);
      if (stop) return stop;
      // অনুচ্ছেদে ভাগ; বড় অনুচ্ছেদ বাক্যে ভেঙে ~১৫০০ অক্ষরের টুকরো
      const chunks = [];
      for (const para of text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)) {
        if (para.length <= 1500) { chunks.push(para); continue; }
        let cur = '';
        for (const s of para.split(/(?<=[.!?।])\s+/)) { if ((cur + ' ' + s).length > 1500 && cur) { chunks.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s; }
        if (cur) chunks.push(cur);
      }
      if (chunks.length > 80) return { error: 'text too long (max ~80 paragraphs per call); split it into parts' };
      const style = str(a.style, 300) || 'calm, clear documentary narrator';
      const pcm = [];
      for (const c of chunks) {
        const it = await gemini.call('POST', '/interactions', {
          model: cfg.ttsModel, store: false,
          input: [{ type: 'user_input', content: [{ type: 'text', text: c, annotations: [{ type: 'speech_metadata', style }] }] }],
          response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: v.name }] },
        }, 180000);
        const block = gemini.outputBlocks(it).filter(b => b.type === 'audio').pop();
        if (!block) return { error: 'no audio returned', done_parts: pcm.length };
        pcm.push(toPcm(await gemini.mediaBytes(block, 50 * 1024 * 1024), block.mime_type));
      }
      const pause = Math.min(1500, Math.max(300, +a.pause_ms || 700));
      const { buf, seconds } = joinPcm(pcm, pcm.map(() => pause));
      await checkUploadQuota(user, buf.length);
      await putFile(p, fp, buf, 'audio/wav', { note: `voice ${v.name}; ${chunks.length} parts`, cost });
      await spend(p, cost);
      return { file: fp, seconds: +seconds.toFixed(2), parts: chunks.length, voice: v.name, cost_usd: cost, cost_note: cfg.ttsUsdPer1k ? 'estimate' : 'TTS_USD_PER_1K_CHARS not set, cost unknown' };
    },
    async media_job(p, a, user) {
      if (!(await ffmpegAvailable())) return { error: 'not_configured', message: 'এই সার্ভারে ffmpeg নেই।' };
      const params = a.params && typeof a.params === 'object' ? { ...a.params } : {};
      const FILE_KEYS = ['input', 'voice', 'music', 'audio', 'clips'];
      const inputs = {};
      for (const k of FILE_KEYS) {
        if (params[k] === undefined) continue;
        const list = Array.isArray(params[k]) ? params[k] : [params[k]];
        const loaded = [];
        for (const fp of list) {
          const { f, buf } = await readFile(p, cleanPath(fp) || '-');
          loaded.push({ buf, ext: '.' + (EXT_OF[f.mime] || 'bin') });
        }
        inputs[k] = Array.isArray(params[k]) ? loaded : loaded[0];
        delete params[k];
      }
      const r = await runRecipe(a.recipe, inputs, params);
      let out = null;
      if (r.buf) {
        const ext = EXT_OF[r.mime];
        out = cleanPath(a.output) || `work/${a.recipe}_${Date.now().toString(36)}.${ext}`;
        if (!out.endsWith('.' + ext)) out = out.replace(/\.[a-z0-9]+$/i, '') + '.' + ext;
        await checkUploadQuota(user, r.buf.length);
        await putFile(p, out, r.buf, r.mime, { note: `media_job ${a.recipe}` });
      }
      return { recipe: a.recipe, output: out, report: r.report };
    },
    async file_read(p, a) {
      const fp = cleanPath(a.path);
      const f = fp && await fileByPath(p, fp);
      if (!f) return { error: 'file not found' };
      if (f.kind !== 'text') return { path: f.path, mime: f.mime, size: Number(f.size), status: f.status, source: f.source, note: f.note };
      const t = (await storage.get(f.file)).toString('utf8');
      return { path: f.path, content: t.slice(0, 200000), truncated: t.length > 200000 };
    },
    async file_write(p, a, user) {
      const fp = cleanPath(a.path);
      const ext = (/\.([a-z0-9]+)$/i.exec(fp || '') || [])[1]?.toLowerCase();
      if (!fp || !TEXT_EXT[ext]) return { error: 'path must be a project path ending in .md .txt .json .srt or .csv' };
      const buf = Buffer.from(String(a.content ?? ''), 'utf8');
      if (buf.length > 2 * 1024 * 1024) return { error: 'file too large (max 2 MB)' };
      await checkUploadQuota(user, buf.length);
      await putFile(p, fp, buf, TEXT_EXT[ext], { source: 'model' });
      return { ok: true, path: fp, chars: String(a.content ?? '').length };
    },
    async file_list(p, a) {
      const folder = a.folder ? cleanPath(String(a.folder).replace(/\/+$/, '')) : '';
      const rows = await db.all('SELECT path,mime,size,status,source,note,cost_usd FROM doc_files WHERE project_id=? ORDER BY path', p.id);
      return { files: rows.filter(r => !folder || r.path.startsWith(folder + '/')).map(r => ({ path: r.path, type: r.mime, size: Number(r.size), status: r.status, source: r.source, note: r.note || undefined })) };
    },
    async set_step(p, a) {
      const step = str(String(a.step ?? ''), 6);
      if (!/^\d{1,2}b?$/.test(step)) return { error: 'step must be like "3" or "4b"' };
      p.state.steps = { ...(p.state.steps || {}), [step]: { status: ['todo', 'doing', 'done', 'blocked'].includes(a.status) ? a.status : 'todo', note: str(a.note, 200) } };
      await saveState(p);
      return { ok: true };
    },
    async save_lesson(p, a) {
      const text = str(a.text, 1000);
      if (!text) return { error: 'empty' };
      const s = await settings(p.uid);
      const lessons = (s.lessons ? s.lessons.trimEnd() + '\n' : '') + `- ${text}`;
      await db.run('INSERT INTO doc_settings(uid,system,lessons,updated) VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET lessons=excluded.lessons, updated=excluded.updated', p.uid, s.system, lessons.slice(-50000), now());
      return { ok: true, saved: text };
    },
  };
  // মডেলের দেওয়া আর্গুমেন্ট নিয়ে টুল চালানো; ভুল হলে ত্রুটি ফেরত (মডেল ঠিক করে আবার চেষ্টা করতে পারে)
  async function runTool(p, user, call) {
    const fn = TOOLS_IMPL[call.name];
    if (!fn) return { error: `unknown tool ${call.name}` };
    try {
      return await fn(p, call.args || {}, user);
    } catch (e) {
      log('warn', 'doc.tool_fail', { tool: call.name, error: String(e.message).slice(0, 300) });
      return { error: String(e.message || e).slice(0, 800) };
    }
  }
  const brief = (name, args, res) => {
    const what = args?.path || args?.file || args?.query || args?.url || args?.recipe || (args?.step ? `ধাপ ${args.step}: ${args.status}` : '') || '';
    const bad = res?.error ? ` ✗ ${String(res.message || res.error).slice(0, 160)}` : res?.status === 'pending' ? ' ⏳' : ' ✓';
    const cost = res?.cost_usd ? ` · $${Number(res.cost_usd).toFixed(2)}` : '';
    return `${TOOL_LABEL[name] || name}${what ? ': ' + String(what).slice(0, 80) : ''}${bad}${cost}`;
  };

  /* ---------------- মডেলের সাথে কথা ---------------- */
  async function systemText(p) {
    const s = await settings(p.uid);
    const files = await db.all('SELECT path,mime,status,source FROM doc_files WHERE project_id=? ORDER BY path LIMIT 400', p.id);
    const unavailable = [
      'stt_words (speech-to-text with word timestamps: Cloud Speech-to-Text is not connected) — for audio intake use media_job audio_probe and say plainly that the word-by-word check could not be done',
      'music_generate (no music model connected) — offer: user uploads licensed music, or no music',
      'drive_upload / gallery_export (Google Drive is not connected) — files are delivered in the app\'s Files panel and as a ZIP (⬇️)',
      'overlay text/graphics rendering (no fonts/overlay recipe yet) — deliver graphics as generated images instead',
    ];
    if (!cfg.youtubeKey) unavailable.push('yt_* tools return not_configured (YOUTUBE_API_KEY missing) — say so; topic proof cannot be verified');
    if (!(await ffmpegAvailable())) unavailable.push('media_job (ffmpeg missing on this server)');
    const english = p.state.lang === 'en';
    return [
      (s.system || DEFAULT_SYSTEM).trim(),
      '════ APP CONTEXT (added by the app, always true) ════',
      `Today: ${new Date().toISOString().slice(0, 10)}. Project: "${p.name}". Budget: $${Number(p.budget_usd).toFixed(2)}, spent so far (estimate): $${Number(p.spent_usd).toFixed(2)}.`,
      english ? 'The user has set the app to ENGLISH: this overrides the "reply in Bengali" rule. Write every reply, question, option, note and file caption in simple English. Keep the copy-block markers exactly as written (▼ কপি করুন ... ▲ এখানে শেষ) so the app can show them.' : '',
      'Tools are function calls; every paid tool returns cost_usd. Never invent tool results, file contents, view counts or sources.',
      'The user uploads files with the 📎 button; uploaded files appear under uploads/ with source "user".',
      `NOT available in this app version — never pretend otherwise:\n- ${unavailable.join('\n- ')}`,
      `Project files (${files.length}): ${files.map(f => `${f.path}${f.status !== 'ready' ? ' [' + f.status + ']' : ''}${f.source === 'user' ? ' [user]' : ''}`).join(', ') || 'none yet'}`,
      `Progress: ${Object.entries(p.state.steps || {}).map(([k, v]) => `${k}=${v.status}`).join(', ') || 'not started'}`,
      `LESSONS.md:\n${s.lessons || '(empty)'}`,
    ].join('\n\n');
  }
  // ইতিহাস → Gemini contents। মডেলের অংশ যেমন এসেছিল তেমনই ফেরত যায় (thoughtSignature সহ, নইলে Gemini 3 ভুল ধরে)।
  async function contents(p) {
    const rows = await db.all("SELECT role, parts FROM doc_messages WHERE project_id=? AND role IN ('user','model','tool') ORDER BY seq DESC LIMIT 120", p.id);
    rows.reverse();
    // শুরু হবে ব্যবহারকারীর লেখা দিয়ে (মাঝখানের টুল-উত্তর দিয়ে নয়)
    while (rows.length && rows[0].role !== 'user') rows.shift();
    const out = [];
    for (const r of rows) {
      const role = r.role === 'model' ? 'model' : 'user';
      const parts = parseJson(r.parts, []);
      if (!parts.length) continue;
      const last = out[out.length - 1];
      if (last && last.role === role) last.parts.push(...parts); else out.push({ role, parts: [...parts] });
    }
    return out;
  }
  const models = () => [cfg.docModel, ...cfg.docFallbacks.filter(m => m !== cfg.docModel)];
  async function callModel(p, model) {
    return gemini.call('POST', `/models/${encodeURIComponent(model)}:generateContent`, {
      systemInstruction: { parts: [{ text: await systemText(p) }] },
      contents: await contents(p),
      tools: [{ functionDeclarations: DECLS }],
      generationConfig: { maxOutputTokens: 16384 },
    }, 180000, 2);
  }

  // একটা টার্ন: মডেল → টুল → মডেল ... যতক্ষণ না লেখা উত্তর আসে বা প্রশ্ন জিজ্ঞেস করা হয়
  async function runTurn(pid, user) {
    let model = null;
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const p = await ownDoc(user, pid);
        let j;
        if (model) j = await callModel(p, model);
        else {
          let lastErr;
          for (const m of models()) {
            try { j = await callModel(p, m); model = m; break; } catch (e) {
              lastErr = e;
              if (![0, 404, 429, 500, 503].includes(e.apiStatus)) throw e;
            }
          }
          if (!j) throw lastErr;
        }
        const cand = j.candidates?.[0];
        const parts = (cand?.content?.parts || []).filter(x => x && typeof x === 'object');
        if (!parts.length) {
          const why = cand?.finishReason || j.promptFeedback?.blockReason || 'empty';
          await addMsg(p, 'note', [], `মডেল কোনো উত্তর দেয়নি (${why})। আবার লিখে চেষ্টা করো।`, { kind: 'error' });
          return;
        }
        const text = parts.filter(x => x.text && !x.thought).map(x => x.text).join('').trim();
        const calls = parts.filter(x => x.functionCall).map(x => x.functionCall);
        await addMsg(p, 'model', parts, text, { model });
        if (!calls.length) return;

        // প্রশ্ন থাকলে: বাকি টুল চালানো হয়, উত্তরগুলো জমা থাকে; ব্যবহারকারী বোতাম চাপলে একসাথে পাঠানো হয়
        const responses = [];
        const notes = [];
        let ask = null;
        for (const c of calls) {
          if (c.name === 'ask_user') {
            const opts = (Array.isArray(c.args?.options) ? c.args.options : []).map(o => str(String(o), 120)).filter(Boolean).slice(0, 6);
            ask = { id: c.id || null, question: str(c.args?.question, 1000), options: opts };
            continue;
          }
          const res = await runTool(p, user, c);
          responses.push({ functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.name, response: trimResult(res) } });
          notes.push(brief(c.name, c.args, res));
        }
        if (ask) {
          p.state.pending = { responses, ask };
          await saveState(p);
          if (notes.length) await addMsg(p, 'note', [], notes.join('\n'), { kind: 'tools' });
          await addMsg(p, 'note', [], ask.question, { kind: 'ask', options: ask.options });
          return;
        }
        await addMsg(p, 'tool', responses, notes.join('\n'), { kind: 'tools' });
      }
      const p = await ownDoc(user, pid);
      await addMsg(p, 'note', [], 'অনেকগুলো ধাপ একটানা হয়ে গেছে। চালিয়ে যেতে "চালিয়ে যাও" লেখো।', { kind: 'info' });
    } catch (e) {
      log('warn', 'doc.turn_fail', { project: pid, error: String(e.message).slice(0, 300) });
      const p = await ownDoc(user, pid).catch(() => null);
      if (p) await addMsg(p, 'note', [], `সমস্যা হয়েছে: ${e.message}`, { kind: 'error' }).catch(() => {});
    }
  }
  function trimResult(r) {
    const s = JSON.stringify(r ?? {});
    if (s.length <= 40000) return r && typeof r === 'object' && !Array.isArray(r) ? r : { result: r };
    return { truncated: true, json: s.slice(0, 40000) };
  }
  async function startTurn(p, user, userParts, display) {
    if (busy.has(p.id) || !(await db.lock('doc:' + p.id, TURN_LEASE))) throw httpErr(409, 'আগের কাজ এখনো চলছে, একটু অপেক্ষা করো।');
    busy.add(p.id);
    try {
      await db.run('UPDATE doc_projects SET busy_until=? WHERE id=?', now() + TURN_LEASE, p.id);
      if (userParts) await addMsg(p, userParts.role, userParts.parts, display, userParts.meta || {});
    } catch (e) { busy.delete(p.id); await db.unlock('doc:' + p.id); throw e; }
    runTurn(p.id, user).finally(async () => {
      busy.delete(p.id);
      await db.run('UPDATE doc_projects SET busy_until=NULL WHERE id=?', p.id).catch(() => {});
      await db.unlock('doc:' + p.id).catch(() => {});
    });
  }

  /* ---------------- পেছনে ভিডিও শেষ হওয়ার খোঁজ ---------------- */
  async function pollVideos() {
    if (!cfg.runWorker) return;
    try {
      const rows = await db.all("SELECT * FROM doc_files WHERE status='pending' AND interaction_id IS NOT NULL ORDER BY updated LIMIT 10");
      for (const f of rows) {
        if (!(await db.lock('docvid:' + f.id, 120e3))) continue;
        try {
          const p = await db.get('SELECT * FROM doc_projects WHERE id=?', f.project_id);
          if (!p) { await db.run('DELETE FROM doc_files WHERE id=?', f.id); continue; }
          let it;
          try { it = await gemini.getInteraction(f.interaction_id); } catch (e) {
            if ([0, 429, 500, 502, 503].includes(e.apiStatus)) continue;
            throw e;
          }
          const late = now() - Number(f.created) > 25 * 60e3;
          if (!isFinished(it) && !late) { await db.run('UPDATE doc_files SET updated=? WHERE id=?', now(), f.id); continue; }
          const block = isFinished(it) && !FAILED.has(it.status) ? gemini.outputBlocks(it).filter(b => b.type === 'video').pop() : null;
          const p2 = { ...p, state: parseJson(p.state, {}) };
          // আগে চ্যাটের বার্তা, তারপর ফাইলের অবস্থা: কেউ "তৈরি" দেখলে বার্তাটাও নিশ্চিত আগে থেকে থাকে
          if (!block) {
            await addMsg(p2, 'note', [], `🎥 ভিডিও তৈরি ব্যর্থ: ${f.path}`, { kind: 'error' });
            await db.run("UPDATE doc_files SET status='failed', note=?, updated=? WHERE id=?", ('failed: ' + (it.error?.message || gemini.outputText(it) || (late ? 'timeout' : it.status))).slice(0, 500), now(), f.id);
            continue;
          }
          const buf = await gemini.mediaBytes(block);
          await storage.put(f.file, buf, 'video/mp4');
          await addMsg(p2, 'note', [], `🎥 ভিডিও তৈরি হয়েছে: ${f.path}`, { kind: 'info' });
          await db.run("UPDATE doc_files SET status='ready', size=?, updated=? WHERE id=?", buf.length, now(), f.id);
        } catch (e) {
          log('warn', 'doc.video_poll', { file: f.id, error: e.message });
        } finally { await db.unlock('docvid:' + f.id).catch(() => {}); }
      }
    } catch (e) { log('error', 'doc.video_poll', { error: e.message }); }
  }
  let pollTimer = null;
  function start() { if (cfg.runWorker && !pollTimer) { pollTimer = setInterval(pollVideos, Math.max(1000, cfg.workerPollMs * 2)); pollTimer.unref(); } }

  /* ---------------- রুট ---------------- */
  const projectOut = p => ({ id: p.id, name: p.name, budget_usd: Number(p.budget_usd), spent_usd: Number(p.spent_usd), steps: (typeof p.state === 'string' ? parseJson(p.state, {}) : p.state).steps || {}, busy: Boolean(p.busy_until && Number(p.busy_until) > now()), created: p.created, updated: p.updated });
  const fileOut = f => ({ id: f.id, path: f.path, mime: f.mime, kind: f.kind, size: Number(f.size), status: f.status, source: f.source, note: f.note, cost_usd: Number(f.cost_usd), updated: f.updated });

  route('GET', '/api/doc/projects', async ({ user }) => ({
    projects: (await db.all('SELECT * FROM doc_projects WHERE uid=? ORDER BY updated DESC', user.id)).map(projectOut),
    ffmpeg: await ffmpegAvailable(), youtube: Boolean(cfg.youtubeKey), model: cfg.docModel,
  }));
  route('POST', '/api/doc/projects', async ({ user, body }) => {
    const id = newId();
    const budget = Math.max(0, Math.min(10000, Number(body.budgetUsd) || cfg.docBudgetUsd));
    await db.run('INSERT INTO doc_projects(id,uid,name,budget_usd,spent_usd,state,created,updated) VALUES(?,?,?,?,?,?,?,?)', id, user.id, str(body.name, 120) || 'নতুন ডকুমেন্টারি', budget, 0, '{}', now(), now());
    activity(user.id, 'doc_project', id);
    return { id };
  });
  route('GET', '/api/doc/projects/:id', async ({ user, params, url }) => {
    const p = await ownDoc(user, params.id);
    const after = Number(url.searchParams.get('after')) || 0;
    const msgs = await db.all('SELECT id,seq,role,display,meta,created FROM doc_messages WHERE project_id=? AND seq>? ORDER BY seq DESC LIMIT 300', p.id, after);
    msgs.reverse();
    const files = await db.all('SELECT * FROM doc_files WHERE project_id=? ORDER BY path', p.id);
    return {
      project: projectOut(p), pendingAsk: p.state.pending?.ask || null,
      messages: msgs.filter(m => m.display || m.role === 'note').map(m => ({ id: m.id, seq: Number(m.seq), role: m.role, text: m.display, meta: parseJson(m.meta, {}), created: m.created })),
      files: files.map(fileOut),
    };
  });
  route('PATCH', '/api/doc/projects/:id', async ({ user, params, body }) => {
    const p = await ownDoc(user, params.id);
    const name = 'name' in body ? str(body.name, 120) || p.name : p.name;
    const budget = 'budgetUsd' in body ? Math.max(0, Math.min(10000, Number(body.budgetUsd) || 0)) : Number(p.budget_usd);
    await db.run('UPDATE doc_projects SET name=?, budget_usd=?, updated=? WHERE id=?', name, budget, now(), p.id);
    return { ok: true };
  });
  route('DELETE', '/api/doc/projects/:id', async ({ user, params }) => {
    const p = await ownDoc(user, params.id);
    if (busy.has(p.id) || (p.busy_until && Number(p.busy_until) > now())) throw httpErr(409, 'কাজ চলার সময় মোছা যাবে না');
    const files = await db.all('SELECT file FROM doc_files WHERE project_id=?', p.id);
    await db.tx(async q => {
      for (const t of ['doc_files', 'doc_messages']) await q.run(`DELETE FROM ${t} WHERE project_id=?`, p.id);
      await q.run('DELETE FROM doc_projects WHERE id=?', p.id);
    });
    for (const f of files) await storage.remove(f.file).catch(() => {});
    return { ok: true };
  });
  route('POST', '/api/doc/projects/:id/chat', async ({ user, params, body }) => {
    const p = await ownDoc(user, params.id);
    await maintenanceCheck(user);
    await rate('doc:' + user.id, cfg.textPerMin, 60e3, 'খুব দ্রুত অনেক বার্তা হয়েছে। এক মিনিট পরে আবার চেষ্টা করো।');
    const text = str(body.text, 20000);
    if (p.state.lang !== user.lang) { p.state.lang = user.lang === 'en' ? 'en' : 'bn'; await saveState(p); }
    // নতুন আপলোড করা ফাইলের খবর বার্তার সাথে যায়
    const fresh = await db.all("SELECT id,path,mime,size,note FROM doc_files WHERE project_id=? AND source='user' AND announced=0", p.id);
    const upNote = fresh.length ? `\n\n[Uploaded by the user: ${fresh.map(f => `${f.path} (${f.mime}, ${Math.round(f.size / 1024)} KB${f.note ? ', ' + f.note : ''})`).join('; ')}]` : '';
    if (p.state.pending) {
      // আগের প্রশ্নের উত্তর: বোতাম বা লেখা
      const answer = text || '(no answer)';
      const { responses, ask } = p.state.pending;
      const parts = [...responses, { functionResponse: { ...(ask.id ? { id: ask.id } : {}), name: 'ask_user', response: { answer: answer + upNote } } }];
      delete p.state.pending;
      await saveState(p);
      await startTurn(p, user, { role: 'tool', parts, meta: { answer: true } }, answer);
    } else {
      if (!text && !fresh.length) throw httpErr(400, 'কিছু লেখো');
      await startTurn(p, user, { role: 'user', parts: [{ text: (text || 'I uploaded files.') + upNote }] }, text || '📎 ফাইল দিয়েছি');
    }
    if (fresh.length) await db.run(`UPDATE doc_files SET announced=1 WHERE id IN (${fresh.map(() => '?').join(',')})`, ...fresh.map(f => f.id));
    return { ok: true };
  });
  // ফাইল আপলোড: কাঁচা বাইট (গ্যালারি/ফোন থেকে), আসল ধরন যাচাই করে uploads/-এ রাখা
  route('POST', '/api/doc/projects/:id/upload', async ({ user, params, body, url }) => {
    if (user.role === 'guest') throw httpErr(403, 'অতিথি হিসেবে সব দেখা যায়, কিন্তু এটা করতে Gmail দিয়ে ঢুকতে হবে।');
    const p = await ownDoc(user, params.id);
    const buf = body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw httpErr(400, 'ফাইল খালি');
    const name = str(url.searchParams.get('name') || 'file', 120);
    const mime = sniffMedia(buf, name);
    if (!mime) throw httpErr(415, 'এই ধরনের ফাইল নেওয়া যায় না। ছবি (PNG/JPG/WEBP), অডিও (WAV/MP3/M4A/OGG/FLAC), ভিডিও (MP4/MOV/WEBM) বা লেখা (.txt .md .srt .json .csv) দাও।');
    await checkUploadQuota(user, buf.length);
    const stem = (name.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9 _()-]+/g, '').trim().replace(/\s+/g, '_') || 'file').slice(0, 60);
    let fp = `uploads/${stem}.${EXT_OF[mime]}`;
    for (let i = 2; await fileByPath(p, fp); i++) fp = `uploads/${stem}_${i}.${EXT_OF[mime]}`;
    const licence = str(url.searchParams.get('licence') || '', 200);
    const id = await putFile(p, fp, buf, mime, { source: 'user', note: licence ? 'licence: ' + licence : '' });
    return { id, path: fp, mime, size: buf.length };
  }, { upload: cfg.docUploadMb * 1024 * 1024 });
  route('GET', '/api/doc/files/:id', async ({ req, res, user, params, url }) => {
    const f = await db.get('SELECT * FROM doc_files WHERE id=? AND uid=?', params.id, user.id);
    if (!f || f.status !== 'ready') throw httpErr(404, 'ফাইল পাওয়া যায়নি');
    const dl = url.searchParams.get('dl') === '1' ? path.basename(f.path) : undefined;
    // লেখা ফাইল ব্রাউজারে HTML হিসেবে চলবে না: সবসময় text/plain
    storage.send(req, res, f.file, { mime: f.kind === 'text' ? 'text/plain; charset=utf-8' : f.mime, downloadName: dl });
  }, { raw: true });
  route('DELETE', '/api/doc/files/:id', async ({ user, params }) => {
    const f = await db.get('SELECT * FROM doc_files WHERE id=? AND uid=?', params.id, user.id);
    if (!f) throw httpErr(404, 'ফাইল পাওয়া যায়নি');
    await db.run('DELETE FROM doc_files WHERE id=?', f.id);
    await storage.remove(f.file).catch(() => {});
    return { ok: true };
  });
  route('GET', '/api/doc/projects/:id/export', async ({ res, user, params }) => {
    const p = await ownDoc(user, params.id);
    const files = await db.all("SELECT * FROM doc_files WHERE project_id=? AND status='ready' ORDER BY path", p.id);
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="documentary-${p.id}.zip"`, 'cache-control': 'no-store' });
    const zip = createZip(b => new Promise((resolve, reject) => { res.write(b, e => (e ? reject(e) : resolve())); }));
    for (const f of files) {
      try { await zip.add(f.path, await storage.get(f.file), new Date(Number(f.updated))); } catch (e) { log('warn', 'doc.export_skip', { file: f.id, error: e.message }); }
    }
    const s = await settings(user.id);
    await zip.add('LESSONS.md', Buffer.from(s.lessons || ''));
    await zip.finish();
    res.end();
  }, { raw: true });
  route('GET', '/api/doc/settings', async ({ user }) => {
    const s = await settings(user.id);
    return { system: s.system || DEFAULT_SYSTEM, custom: Boolean(s.system), lessons: s.lessons };
  });
  route('PUT', '/api/doc/settings', async ({ user, body }) => {
    const cur = await settings(user.id);
    const system = 'system' in body ? (str(body.system, 200000) === DEFAULT_SYSTEM.trim() ? '' : str(body.system, 200000)) : cur.system;
    const lessons = 'lessons' in body ? str(body.lessons, 50000) : cur.lessons;
    await db.run('INSERT INTO doc_settings(uid,system,lessons,updated) VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET system=excluded.system, lessons=excluded.lessons, updated=excluded.updated', user.id, system, lessons, now());
    return { ok: true };
  });

  // অ্যাকাউন্ট মুছলে এই মডিউলের সবকিছু
  async function deleteUser(q, uid) {
    for (const t of ['doc_files', 'doc_messages', 'doc_projects', 'doc_settings']) await q.run(`DELETE FROM ${t} WHERE uid=?`, uid);
  }
  return { start, pollVideos, deleteUser };
}

module.exports = { createDocStudio, cleanPath, sniffMedia, isPrivateIp, fetchPublic, DECLS, DEFAULT_SYSTEM };
