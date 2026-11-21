// সব API রুট: লগইন, প্রজেক্ট, চরিত্র, তৈরি, ফাইল, গল্প, সহকারী, ব্যবহারের হিসাব, অ্যাডমিন, অ্যাকাউন্ট।
// নিয়ম: প্রতিটা কোয়েরিতে ব্যবহারকারীর id মেলানো হয়, তাই একজন আরেকজনের কিছু দেখতে/বদলাতে পারে না।
'use strict';
const crypto = require('node:crypto');
const { VOICES, voiceOf } = require('./gemini');
const { decodeDataUrl, shortTitle, newId, str, EXT } = require('./assets');
const { createZip } = require('./zip');
const { createDocStudio } = require('./docstudio');
const { createControl } = require('./control');

const DAY = 864e5;
const PAGE = Math.max(1, Number(process.env.ASSET_PAGE_SIZE) || 200); // গ্যালারির এক পাতায় কয়টা ফাইল
const ASPECTS_VIDEO = ['16:9', '9:16'];
const ASPECTS_IMAGE = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const RESOLUTIONS = ['360p', '720p', '1080p'];
const VOICE_SAMPLE = 'নমস্কার! আমি তোমার গল্পের নতুন চরিত্র। চলো, একসাথে দারুণ কিছু বানাই।';
const AVATAR_STYLES = {
  real: 'a realistic cinematic film still', '3d': 'a 3D animated movie character (Pixar-like)',
  anime: 'an anime character', paint: 'a watercolor storybook illustration',
};
const EPISODE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    summary: { type: 'STRING' },
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          location: { type: 'STRING' }, action: { type: 'STRING' }, dialogue: { type: 'STRING' },
          characters: { type: 'ARRAY', items: { type: 'STRING' } }, video_prompt: { type: 'STRING' },
        },
        required: ['location', 'action', 'dialogue', 'characters', 'video_prompt'],
      },
    },
  },
  required: ['title', 'summary', 'scenes'],
};

const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
const idList = (v, max) => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, max) : []);

// নির্দিষ্ট টাইমজোনে আজকের শুরু (দৈনিক সীমা বাংলাদেশের মাঝরাতে নতুন হয়)
function tzOffsetMs(tz, d) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(d.getTime() / 1000) * 1000;
}
function startOfDay(tz, t = Date.now()) {
  const off = tzOffsetMs(tz, new Date(t));
  return t - ((t + off) % DAY + DAY) % DAY;
}
function dayKey(tz, t) {
  return new Date(t + tzOffsetMs(tz, new Date(t))).toISOString().slice(0, 10);
}

function createApp({ cfg, db, storage, gemini, assets, worker, log, secret, version }) {
  const now = () => Date.now();
  const activity = (uid, action, target = '', detail = '') =>
    db.run('INSERT INTO activity(id,uid,action,target,detail,created) VALUES(?,?,?,?,?,?)', newId(), uid || null, action, String(target).slice(0, 200), String(detail).slice(0, 500), now())
      .catch(e => log('warn', 'activity.fail', { error: e.message }));

  /* ---------------- লগইন ও সেশন ---------------- */
  const sign = v => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  const makeSession = (uid, sv) => { const v = `${uid}.${sv}.${now() + 30 * DAY}`; return v + '.' + sign(v); };
  const isOwner = email => Boolean((cfg.ownerEmail && email === cfg.ownerEmail) || (cfg.devLogin && !cfg.ownerEmail && email.endsWith('@dev.local')));
  async function canEnter(email) {
    return isOwner(email) || (await control.openSignup()) || Boolean(await db.get('SELECT 1 AS x FROM allowed WHERE email=?', email));
  }
  // প্রতিটা অনুরোধে ডেটাবেসে না গিয়ে ১৫ সেকেন্ড মনে রাখা
  const userCache = new Map();
  async function loadUser(uid) {
    const c = userCache.get(uid);
    if (c && now() - c.at < 15000) return c.u;
    const row = await db.get('SELECT * FROM users WHERE id=?', uid);
    // ব্লক করা বা অনুমতি সরানো ব্যবহারকারী আর ঢুকতে পারে না (মালিককে কখনো ব্লক করা যায় না)
    const allowed = row && (row.role === 'guest' ? await control.guestEnabled() : await canEnter(row.email));
    const u = row && !(Number(row.blocked) && !isOwner(row.email)) && allowed ? row : null;
    userCache.set(uid, { u, at: now() });
    if (userCache.size > 10000) userCache.delete(userCache.keys().next().value);
    return u;
  }
  async function readSession(req) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)cp_s=([^;]+)/);
    if (!m) return null;
    let raw;
    try { raw = decodeURIComponent(m[1]); } catch { return null; }
    const parts = raw.split('.');
    // পুরনো ধরনের কুকি (uid.exp.sig) এখনো চলে, যাতে আপডেটের পর সবাই লগআউট না হয়
    const [uid, sv, exp, sig] = parts.length === 3 ? [parts[0], '0', parts[1], parts[2]] : parts.length === 4 ? parts : [];
    if (!uid) return null;
    const signed = parts.length === 3 ? `${uid}.${exp}` : `${uid}.${sv}.${exp}`;
    const s = sign(signed);
    if (s.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig))) return null;
    if (+exp < now()) return null;
    const u = await loadUser(uid);
    if (!u || String(u.sv || 0) !== sv) return null;
    // নিজের দেওয়া নাম/ছবি থাকলে সেটা, না থাকলে Gmail-এর
    return { id: u.id, email: u.email, name: u.display_name || u.name, picture: u.photo ? `/api/avatar/${u.id}?v=${u.photo_v || 0}` : u.picture,
      googleName: u.name, customPhoto: Boolean(u.photo), created: Number(u.created) || 0, owner: isOwner(u.email), sv: u.sv || 0,
      role: control.roleOf(u), staff: ['owner', 'admin'].includes(control.roleOf(u)) };
  }
  function setCookie(res, val, maxAge) {
    const secure = cfg.publicUrl.startsWith('https://') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `cp_s=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  }
  async function verifyGoogle(credential) {
    if (!cfg.googleClientId) throw httpErr(503, 'Gmail লগইন চালু নেই (GOOGLE_CLIENT_ID সেট করো)');
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { signal: AbortSignal.timeout(10000) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || t.aud !== cfg.googleClientId || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)
      || +t.exp * 1000 < now() || String(t.email_verified) !== 'true') throw httpErr(401, 'লগইন যাচাই হয়নি');
    return { sub: t.sub, email: String(t.email).toLowerCase(), name: t.name || t.email, picture: t.picture || '' };
  }
  async function loginAs(res, g) {
    const prev = await db.get('SELECT blocked, block_reason FROM users WHERE email=?', g.email);
    if (prev && Number(prev.blocked) && !isOwner(g.email)) {
      throw httpErr(403, 'তোমার অ্যাকাউন্ট বন্ধ করা হয়েছে' + (prev.block_reason ? `: ${prev.block_reason}` : '') + '। ভুল মনে হলে মালিকের সাথে যোগাযোগ করো।');
    }
    if (!(await canEnter(g.email))) throw httpErr(403, 'এই Gmail-এর অনুমতি নেই। অ্যাপের মালিককে বলো তোমার ইমেইল যোগ করতে।');
    const uid = 'u' + crypto.createHash('sha256').update('google:' + g.sub).digest('hex').slice(0, 20);
    await db.run(`INSERT INTO users(id,email,name,picture,created,last) VALUES(?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture, last=excluded.last`,
    uid, g.email, g.name, g.picture, now(), now());
    userCache.delete(uid);
    const u = await db.get('SELECT sv FROM users WHERE id=?', uid);
    setCookie(res, makeSession(uid, u.sv || 0), 30 * 86400);
    activity(uid, 'login', g.email);
  }
  // প্রক্সির (Railway, লোড ব্যালান্সার) পেছনে আসল IP
  function clientIp(req) {
    if (cfg.trustProxy) {
      const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (f) return f;
    }
    return req.socket.remoteAddress || '?';
  }
  async function rate(key, limit, windowMs, msg) {
    if ((await db.hit(key, windowMs)) > limit) throw httpErr(429, msg);
  }
  const genRate = user => { control.blockGuest(user); return rate('gen:' + user.id, cfg.genPerMin, 60e3, 'খুব দ্রুত অনেক কিছু বানাতে বলা হয়েছে। এক মিনিট পরে আবার চেষ্টা করো।'); };
  const textRate = user => { control.blockGuest(user); return rate('txt:' + user.id, cfg.textPerMin, 60e3, 'খুব দ্রুত অনেক অনুরোধ হয়েছে। এক মিনিট পরে আবার চেষ্টা করো।'); };

  /* ---------------- সীমা ও সারি ---------------- */
  const today = () => startOfDay(cfg.dayResetTz);
  async function usedToday(uid, kind) {
    return Number((await db.get("SELECT COUNT(*) AS n FROM jobs WHERE uid=? AND kind=? AND created>=? AND status NOT IN ('failed','cancelled')", uid, kind, today())).n);
  }
  const limitBytes = () => cfg.storageLimitMb * 1024 * 1024;
  // সীমা দেখা আর কাজ যোগ একসাথে লক করে, যাতে একসাথে অনেক অনুরোধে সীমা পেরোনো না যায়
  const LANG = u => (u && u.lang === 'en' ? 'English' : 'Bengali');
  async function enqueue(user, projectId, kind, label, request, count = 1) {
    await control.maintenanceCheck(user);
    request = { ...request, lang: user.lang === 'en' ? 'en' : 'bn' };
    const ids = Array.from({ length: count }, () => newId());
    await db.tx(async q => {
      if (db.kind === 'pg') await q.get('SELECT pg_advisory_xact_lock(hashtext(?)::bigint) AS x', 'jobs:' + user.id);
      if (!user.owner) {
        const limit = kind === 'video' ? cfg.dailyVideos : cfg.dailyImages;
        const used = Number((await q.get("SELECT COUNT(*) AS n FROM jobs WHERE uid=? AND kind=? AND created>=? AND status NOT IN ('failed','cancelled')", user.id, kind, today())).n);
        if (used + count > limit) throw httpErr(429, `আজকের ${kind === 'video' ? 'ভিডিও' : 'ছবি'} বানানোর সীমা (${limit}টি) শেষ। কাল আবার চেষ্টা করো।`);
        const bytes = Number((await q.get('SELECT COALESCE(SUM(size),0) AS n FROM assets WHERE uid=?', user.id)).n);
        if (bytes >= limitBytes()) throw httpErr(413, `তোমার জায়গা (${cfg.storageLimitMb} MB) ভরে গেছে। পুরনো ফাইল মুছে ট্র্যাশ খালি করো।`);
      }
      for (const id of ids) {
        await q.run('INSERT INTO jobs(id,uid,project_id,kind,status,label,request,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',
          id, user.id, projectId, kind, 'queued', str(label, 200), JSON.stringify(request), now(), now());
      }
    });
    worker.kick();
    return ids;
  }
  async function checkUploadQuota(user, extra) {
    if (user.owner) return;
    if ((await assets.usedBytes(user.id)) + extra > limitBytes()) throw httpErr(413, `তোমার জায়গা (${cfg.storageLimitMb} MB) ভরে গেছে। পুরনো ফাইল মুছে ট্র্যাশ খালি করো।`);
  }

  /* ---------------- মালিকানা যাচাই ---------------- */
  async function ownProject(user, id) {
    const p = await db.get('SELECT * FROM projects WHERE id=? AND uid=?', id, user.id);
    if (!p) throw httpErr(404, 'প্রজেক্ট পাওয়া যায়নি');
    return p;
  }
  async function ownChar(user, id) {
    const c = await db.get('SELECT * FROM characters WHERE id=? AND uid=?', id, user.id);
    if (!c) throw httpErr(404, 'চরিত্র পাওয়া যায়নি');
    return c;
  }
  async function ownAsset(user, id) {
    const a = await db.get('SELECT * FROM assets WHERE id=? AND uid=?', id, user.id);
    if (!a) throw httpErr(404, 'ফাইল পাওয়া যায়নি');
    return a;
  }
  async function liveAsset(user, id) {
    const a = await ownAsset(user, id);
    if (a.deleted_at) throw httpErr(400, 'এই ফাইল ট্র্যাশে আছে। আগে ফেরত আনো।');
    return a;
  }
  async function ownCollection(user, id) {
    const c = await db.get('SELECT * FROM collections WHERE id=? AND uid=?', id, user.id);
    if (!c) throw httpErr(404, 'কালেকশন পাওয়া যায়নি');
    return c;
  }
  async function validFolder(user, folderId) {
    if (!folderId) return null;
    if (!(await db.get('SELECT 1 AS x FROM folders WHERE id=? AND uid=?', folderId, user.id))) throw httpErr(400, 'ফোল্ডার পাওয়া যায়নি');
    return folderId;
  }

  /* ---------------- ভিউ ---------------- */
  const assetView = a => ({ ...a, meta: parseJson(a.meta, {}), editable: Boolean(a.interaction_id), interaction_id: undefined });
  const ASSET_COLS = 'id,kind,title,prompt,mode,meta,parent_id,favorite,created,character_id,interaction_id';
  const cursorOf = list => (list.length ? { before: Number(list[list.length - 1].created), beforeId: list[list.length - 1].id } : null);
  async function projectView(p) {
    // কাজের তালিকা আগে পড়া হয়: worker ফাইল জমা করে তারপর কাজকে 'done' করে, তাই এখানে 'done' দেখা গেলে
    // পরের প্রশ্নগুলোতে তার ফাইলও নিশ্চিত পাওয়া যায় (একসাথে পড়লে PostgreSQL-এ "কাজ শেষ কিন্তু ছবি নেই" হতে পারত)
    const jobs = await db.all(`SELECT id,kind,status,label,error,asset_id,created,updated,started FROM jobs WHERE project_id=? AND status<>'cancelled'
              AND (status IN ('queued','running') OR updated>?) ORDER BY created DESC LIMIT 50`, p.id, now() - 6 * 3600e3);
    const [chars, refs, rows, colItems, cols, trash, liveVideos] = await Promise.all([
      db.all('SELECT id,name,description,voice,info,created FROM characters WHERE project_id=? ORDER BY created', p.id),
      db.all("SELECT id, character_id FROM assets WHERE project_id=? AND character_id IS NOT NULL AND kind='image' ORDER BY created", p.id),
      db.all(`SELECT ${ASSET_COLS} FROM assets WHERE project_id=? AND deleted_at IS NULL AND character_id IS NULL ORDER BY created DESC, id DESC LIMIT ?`, p.id, PAGE + 1),
      db.all(`SELECT ci.collection_id, ci.asset_id FROM collection_items ci JOIN collections c ON c.id=ci.collection_id
              JOIN assets a ON a.id=ci.asset_id WHERE c.project_id=? AND a.deleted_at IS NULL`, p.id),
      db.all('SELECT id,name FROM collections WHERE project_id=? ORDER BY created', p.id),
      db.get('SELECT COUNT(*) AS n FROM assets WHERE project_id=? AND deleted_at IS NOT NULL', p.id),
      db.all("SELECT id FROM assets WHERE project_id=? AND kind='video' AND deleted_at IS NULL", p.id),
    ]);
    const list = rows.slice(0, PAGE).map(assetView);
    const clips = parseJson(p.clips, []).filter(id => liveVideos.some(v => v.id === id));
    // দৃশ্যক্রমের ক্লিপ প্রথম পাতায় না থাকলেও পাঠানো হয়
    const missing = clips.filter(id => !list.some(a => a.id === id));
    if (missing.length) {
      const extra = await db.all(`SELECT ${ASSET_COLS} FROM assets WHERE id IN (${missing.map(() => '?').join(',')})`, ...missing);
      list.push(...extra.map(assetView));
    }
    return {
      project: { id: p.id, name: p.name, folder_id: p.folder_id, created: p.created, updated: p.updated },
      characters: chars.map(c => ({ ...c, images: refs.filter(r => r.character_id === c.id).map(r => r.id) })),
      assets: list,
      assetsMore: rows.length > PAGE,
      assetsCursor: cursorOf(rows.slice(0, PAGE)),
      jobs,
      collections: cols.map(c => ({ ...c, items: colItems.filter(i => i.collection_id === c.id).map(i => i.asset_id) })),
      trashCount: Number(trash.n),
      clips,
      story: parseJson(p.story, {}),
    };
  }

  /* ---------------- প্রম্পট ---------------- */
  async function characterRefs(user, projectId, ids, perChar, maxChars) {
    const chars = [];
    for (const cid of idList(ids, maxChars)) {
      const c = await db.get('SELECT * FROM characters WHERE id=? AND uid=? AND project_id=?', cid, user.id, projectId);
      if (!c) continue;
      const imgs = (await db.all("SELECT id FROM assets WHERE character_id=? AND kind='image' ORDER BY created", c.id)).map(a => a.id).slice(0, perChar);
      chars.push({ ...c, images: imgs });
    }
    return chars;
  }
  function composePrompt({ prompt, chars, frames, style, camera, singleShot, avoid, kind, extraRefs = 0 }) {
    const parts = [];
    if (chars.length) {
      parts.push('Characters (keep each person\'s face, body, hair and clothing exactly as in their reference images): ' +
        chars.map(c => {
          const v = kind === 'video' && voiceOf(c.voice);
          return `${c.name}${c.description ? ' — ' + c.description : ''}${c.info ? ' (personality: ' + c.info + ')' : ''}${v ? `, speaks with a ${v.gender} ${v.trait} voice` : ''}`;
        }).join('; ') + '.');
    }
    if (frames === 2) parts.push('Use the first image as the opening frame and the second image as the final frame, and animate a smooth transition between them.');
    if (frames === 1) parts.push('Use the image as the opening frame and bring it to life.');
    if (extraRefs) parts.push(`${chars.length ? 'The last ' + extraRefs + ' reference image(s)' : 'The reference image(s)'} show objects, places or styles to include in the ${kind}.`);
    parts.push(prompt);
    if (style) parts.push(`Visual style: ${style}.`);
    if (camera && kind === 'video') parts.push(`Camera: ${camera}.`);
    if (singleShot && kind === 'video') parts.push('In a single continuous shot, no scene cuts.');
    if (avoid) parts.push(`Do not include: ${avoid}.`);
    return parts.join('\n');
  }
  async function charImageSlots(c) {
    const have = Number((await db.get("SELECT COUNT(*) AS n FROM assets WHERE character_id=? AND kind='image'", c.id)).n);
    const pending = (await db.all("SELECT request FROM jobs WHERE status IN ('queued','running') AND project_id=?", c.project_id))
      .filter(j => parseJson(j.request, {}).characterId === c.id).length;
    return 3 - have - pending;
  }
  async function autoTitle({ assetId, req, characterId }) {
    if (characterId || !cfg.autoTitles || !cfg.apiKey) return;
    const text = req.displayPrompt || req.prompt;
    if (!text) return;
    try {
      const t = await gemini.textGen(`Write a short ${req.lang === 'en' ? 'English' : 'Bengali'} title (2 to 6 words) for an image or video made from this prompt. Reply with the title only, no quotes, no punctuation at the end.`, text.slice(0, 1500));
      const clean = str(t.split('\n')[0].replace(/["'“”*]/g, ''), 80);
      if (clean) await db.run('UPDATE assets SET title=? WHERE id=?', clean, assetId);
    } catch { /* শিরোনাম না পেলে প্রম্পটের প্রথম কয়েকটা শব্দই থাকে */ }
  }

  /* ---------------- রুট ---------------- */
  const routes = [];
  function route(method, pattern, handler, opts = {}) {
    routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[A-Za-z0-9_.@%+-]{1,200})') + '$'), handler, opts });
  }

  const control = createControl({ cfg, db, storage, route, httpErr, rate, activity, sign, clientIp, userCache, isOwner, log });
  route('GET', '/api/config', async () => {
    const i = await control.publicInfo();
    return { googleClientId: cfg.googleClientId, devLogin: cfg.devLogin, guest: i.guest, version, contact: i.contact, texts: i.texts, brand: i.brand };
  }, { public: true });

  route('POST', '/api/login', async ({ req, res, body }) => {
    await rate('login:' + clientIp(req), 20, 10 * 60e3, 'অনেকবার চেষ্টা হয়েছে, ১০ মিনিট পরে আবার চেষ্টা করো');
    if (body.guest === true) { await control.createGuest(req, res, setCookie, makeSession); return { ok: true, guest: true }; }
    if (body.dev && cfg.devLogin) {
      const name = str(body.dev, 40) || 'test';
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || crypto.createHash('sha1').update(name).digest('hex').slice(0, 8);
      await loginAs(res, { sub: 'dev:' + slug, email: `${slug}@dev.local`, name, picture: '' });
      return { ok: true };
    }
    await loginAs(res, await verifyGoogle(str(body.credential, 5000)));
    return { ok: true };
  }, { public: true });

  route('POST', '/api/logout', ({ res }) => { setCookie(res, '', 0); return { ok: true }; }, { public: true });

  route('GET', '/api/me', async ({ user }) => ({
    user: { id: user.id, email: user.email, name: user.name, picture: user.picture, owner: user.owner, role: user.role, staff: user.staff, googleName: user.googleName, customPhoto: user.customPhoto, joined: user.created },
    site: await control.publicInfo(),
    app: { creatorName: cfg.creatorName, creatorTitle: cfg.creatorTitle },
    models: { video: cfg.videoModel, image: cfg.imageModel, text: cfg.textModel },
    configured: Boolean(cfg.apiKey),
    limits: user.owner ? null : { video: cfg.dailyVideos, image: cfg.dailyImages },
    imageModels: cfg.imageModels.includes(cfg.imageModel) ? cfg.imageModels : [cfg.imageModel, ...cfg.imageModels],
    pricing: { videoUsdPerSec: cfg.videoUsdPerSec, imageUsd: cfg.imageUsd, usdToBdt: cfg.usdToBdt },
    usage: { video: await usedToday(user.id, 'video'), image: await usedToday(user.id, 'image') },
    storage: { used: await assets.usedBytes(user.id), limit: user.owner ? null : limitBytes() },
    version,
  }));

  /* ----- ব্যবহারের হিসাব ----- */
  route('GET', '/api/usage', async ({ user }) => {
    const since = now() - 30 * DAY;
    const rows = await db.all("SELECT kind, created, cost_usd, request FROM jobs WHERE uid=? AND status='done' AND created>=? ORDER BY created", user.id, since);
    const days = {};
    for (let i = 13; i >= 0; i--) days[dayKey(cfg.dayResetTz, now() - i * DAY)] = { videos: 0, images: 0, cost: 0 };
    const total = { videos: 0, images: 0, videoSeconds: 0, cost: 0 };
    for (const r of rows) {
      const k = dayKey(cfg.dayResetTz, r.created);
      const isV = r.kind === 'video';
      total[isV ? 'videos' : 'images']++;
      total.cost += Number(r.cost_usd) || 0;
      if (isV) total.videoSeconds += +parseJson(r.request, {}).duration || 0;
      if (days[k]) { days[k][isV ? 'videos' : 'images']++; days[k].cost += Number(r.cost_usd) || 0; }
    }
    return {
      today: { video: await usedToday(user.id, 'video'), image: await usedToday(user.id, 'image') },
      limits: user.owner ? null : { video: cfg.dailyVideos, image: cfg.dailyImages },
      last30: total,
      daily: Object.entries(days).map(([day, v]) => ({ day, ...v })),
      storage: { used: await assets.usedBytes(user.id), limit: user.owner ? null : limitBytes() },
      usdToBdt: cfg.usdToBdt,
      estimateNote: 'খরচ আনুমানিক (VIDEO_USD_PER_SEC, IMAGE_USD থেকে)। আসল বিল Google Cloud Billing-এ দেখো।',
    };
  });

  /* ----- অ্যাকাউন্ট ----- */
  /* ----- প্রোফাইল: নিজের নাম আর ছবি ----- */
  route('GET', '/api/profile', async ({ user }) => {
    const done = await db.get("SELECT COUNT(*) AS n FROM jobs WHERE uid=? AND status='done'", user.id);
    const up = await db.get("SELECT COUNT(*) AS n FROM assets WHERE uid=? AND mode IN ('upload','crop')", user.id);
    const gen = await db.get("SELECT COUNT(*) AS n FROM assets WHERE uid=? AND mode NOT IN ('upload','crop')", user.id);
    const doc = await db.get("SELECT COUNT(*) AS n FROM doc_files WHERE uid=? AND source='generated' AND status='ready'", user.id);
    const projects = await db.get('SELECT COUNT(*) AS n FROM projects WHERE uid=?', user.id);
    const docs = await db.get('SELECT COUNT(*) AS n FROM doc_projects WHERE uid=?', user.id);
    return {
      id: user.id, shortId: user.id.slice(1, 9).toUpperCase(), name: user.name, googleName: user.googleName, email: user.email, picture: user.picture,
      customPhoto: user.customPhoto, joined: user.created, owner: user.owner,
      stats: { creations: Math.max(Number(done.n), Number(gen.n)) + Number(doc.n), uploads: Number(up.n), projects: Number(projects.n), documentaries: Number(docs.n) },
    };
  });
  route('PATCH', '/api/profile', async ({ user, body }) => {
    const name = str(body.name, 60).replace(/[<>]/g, '');
    await db.run('UPDATE users SET display_name=? WHERE id=?', name || null, user.id);
    userCache.delete(user.id);
    return { ok: true };
  });
  route('POST', '/api/profile/photo', async ({ user, body }) => {
    control.blockGuest(user);
    const { mime, buf } = decodeDataUrl(body.dataUrl, httpErr, 4 * 1024 * 1024);
    const old = await db.get('SELECT photo FROM users WHERE id=?', user.id);
    const key = `avatars/${user.id}-${now().toString(36)}.${EXT[mime]}`;
    await storage.put(key, buf, mime);
    await db.run('UPDATE users SET photo=?, photo_v=? WHERE id=?', key, now(), user.id);
    if (old?.photo) await storage.remove(old.photo).catch(() => {});
    userCache.delete(user.id);
    return { ok: true };
  }, { bigBody: true });
  route('DELETE', '/api/profile/photo', async ({ user }) => {
    const old = await db.get('SELECT photo FROM users WHERE id=?', user.id);
    await db.run('UPDATE users SET photo=NULL, photo_v=NULL WHERE id=?', user.id);
    if (old?.photo) await storage.remove(old.photo).catch(() => {});
    userCache.delete(user.id);
    return { ok: true };
  });
  // প্রোফাইল ছবি: লগইন করা যে কেউ দেখতে পারে (অ্যাডমিনের তালিকায়ও দেখায়)
  route('GET', '/api/avatar/:uid', async ({ req, res, params }) => {
    const u = await db.get('SELECT photo FROM users WHERE id=?', params.uid);
    if (!u?.photo) throw httpErr(404, 'ছবি নেই');
    const ext = u.photo.split('.').pop();
    storage.send(req, res, u.photo, { mime: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/png' });
  }, { raw: true });

  route('POST', '/api/account/logout-all', async ({ res, user }) => {
    await db.run('UPDATE users SET sv=sv+1 WHERE id=?', user.id);
    userCache.delete(user.id);
    const u = await db.get('SELECT sv FROM users WHERE id=?', user.id);
    setCookie(res, makeSession(user.id, u.sv), 30 * 86400);
    activity(user.id, 'logout_all');
    return { ok: true };
  });
  route('POST', '/api/account/delete', async ({ res, user, body }) => {
    if (str(body.confirm, 200).toLowerCase() !== user.email) throw httpErr(400, 'নিশ্চিত করতে নিজের ইমেইল ঠিকঠাক লেখো');
    const files = [...await db.all('SELECT file FROM assets WHERE uid=?', user.id), ...await db.all('SELECT file FROM doc_files WHERE uid=?', user.id),
      ...await db.all('SELECT photo AS file FROM users WHERE id=? AND photo IS NOT NULL', user.id)];
    await db.tx(async q => {
      await docStudio.deleteUser(q, user.id);
      await control.deleteUser(q, user.id);
      await q.run("UPDATE jobs SET status='cancelled', worker=NULL, lease_until=NULL WHERE uid=? AND status IN ('queued','running')", user.id);
      await q.run('DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE uid=?)', user.id);
      for (const t of ['collections', 'chat', 'assets', 'characters', 'projects', 'folders', 'jobs']) await q.run(`DELETE FROM ${t} WHERE uid=?`, user.id);
      await q.run('DELETE FROM users WHERE id=?', user.id);
    });
    userCache.delete(user.id);
    for (const f of files) await storage.remove(f.file).catch(() => {});
    activity(null, 'account_delete', user.email);
    setCookie(res, '', 0);
    return { ok: true, removedFiles: files.length };
  });

  /* ----- অ্যাডমিন (শুধু মালিক) ----- */
  route('GET', '/api/admin/allowed', async () => ({
    allowed: await db.all('SELECT email, added FROM allowed ORDER BY added DESC'),
    users: await db.all('SELECT email, name, last FROM users ORDER BY last DESC LIMIT 200'),
    openSignup: await control.openSignup(),
  }), { staff: true });
  route('POST', '/api/admin/allowed', async ({ user, body }) => {
    const email = str(body.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpErr(400, 'সঠিক ইমেইল দাও');
    await db.run('INSERT INTO allowed(email, added) VALUES(?,?) ON CONFLICT(email) DO NOTHING', email, now());
    activity(user.id, 'allow_add', email);
    return { ok: true };
  }, { staff: true });
  route('GET', '/api/admin/overview', async () => {
    const since = now() - 30 * DAY;
    const [users, queue, recent, totals] = await Promise.all([
      db.all(`SELECT u.email, u.name, u.last, u.created,
          (SELECT COUNT(*) FROM jobs j WHERE j.uid=u.id AND j.status='done' AND j.kind='video' AND j.created>=?) AS videos,
          (SELECT COUNT(*) FROM jobs j WHERE j.uid=u.id AND j.status='done' AND j.kind='image' AND j.created>=?) AS images,
          (SELECT COALESCE(SUM(j.cost_usd),0) FROM jobs j WHERE j.uid=u.id AND j.created>=?) AS cost,
          (SELECT COALESCE(SUM(a.size),0) FROM assets a WHERE a.uid=u.id) AS bytes
        FROM users u WHERE u.role<>'guest' ORDER BY u.last DESC LIMIT 200`, since, since, since),
      db.all('SELECT status, COUNT(*) AS n FROM jobs WHERE created>=? GROUP BY status', since),
      db.all(`SELECT a.action, a.target, a.detail, a.created, u.email FROM activity a LEFT JOIN users u ON u.id=a.uid
              ORDER BY a.created DESC LIMIT 100`),
      db.get("SELECT COUNT(*) AS users, SUM(CASE WHEN role='guest' THEN 1 ELSE 0 END) AS guests FROM users"),
    ]);
    return {
      users: users.map(u => ({ ...u, videos: Number(u.videos), images: Number(u.images), cost: Number(u.cost), bytes: Number(u.bytes) })),
      queue: Object.fromEntries(queue.map(q => [q.status, Number(q.n)])),
      activity: recent,
      system: { users: Number(totals.users) - Number(totals.guests || 0), guests: Number(totals.guests || 0), ephemeral: Boolean(cfg.ephemeralDisk), database: db.kind, storage: storage.kind, worker: worker.workerId, version, usdToBdt: cfg.usdToBdt },
    };
  }, { staff: true });

  /* ----- লাইব্রেরি ----- */
  route('GET', '/api/library', async ({ user }) => ({
    folders: await db.all('SELECT id,name,created FROM folders WHERE uid=? ORDER BY name', user.id),
    projects: (await db.all(`SELECT p.id,p.name,p.folder_id,p.created,p.updated,
        (SELECT COUNT(*) FROM assets a WHERE a.project_id=p.id AND a.character_id IS NULL AND a.deleted_at IS NULL) AS assets,
        (SELECT COUNT(*) FROM characters c WHERE c.project_id=p.id) AS characters,
        (SELECT a.id FROM assets a WHERE a.project_id=p.id AND a.kind='image' AND a.deleted_at IS NULL ORDER BY a.created DESC LIMIT 1) AS cover
      FROM projects p WHERE p.uid=? ORDER BY p.updated DESC`, user.id)).map(p => ({ ...p, assets: Number(p.assets), characters: Number(p.characters) })),
  }));
  route('POST', '/api/folders', async ({ user, body }) => {
    const name = str(body.name, 80);
    if (!name) throw httpErr(400, 'ফোল্ডারের নাম দাও');
    const id = newId();
    await db.run('INSERT INTO folders(id,uid,name,created) VALUES(?,?,?,?)', id, user.id, name, now());
    return { id };
  });
  route('PATCH', '/api/folders/:id', async ({ user, params, body }) => {
    const name = str(body.name, 80);
    if (!name) throw httpErr(400, 'ফোল্ডারের নাম দাও');
    await db.run('UPDATE folders SET name=? WHERE id=? AND uid=?', name, params.id, user.id);
    return { ok: true };
  });
  route('DELETE', '/api/folders/:id', async ({ user, params }) => {
    await db.run('UPDATE projects SET folder_id=NULL WHERE folder_id=? AND uid=?', params.id, user.id);
    await db.run('DELETE FROM folders WHERE id=? AND uid=?', params.id, user.id);
    return { ok: true };
  });
  route('POST', '/api/projects', async ({ user, body }) => {
    if (user.role === 'guest' && Number((await db.get('SELECT COUNT(*) AS n FROM projects WHERE uid=?', user.id)).n) >= 3) throw httpErr(403, 'অতিথি সর্বোচ্চ ৩টা প্রজেক্ট বানাতে পারে। Gmail দিয়ে ঢুকলে সীমা নেই।');
    const name = str(body.name, 120) || 'নতুন প্রজেক্ট';
    const id = newId();
    await db.run('INSERT INTO projects(id,uid,folder_id,name,created,updated) VALUES(?,?,?,?,?,?)', id, user.id, await validFolder(user, body.folderId), name, now(), now());
    activity(user.id, 'project_create', id, name);
    return { id };
  });
  route('GET', '/api/projects/:id', async ({ user, params }) => projectView(await ownProject(user, params.id)));
  route('GET', '/api/projects/:id/assets', async ({ user, params, url }) => {
    const p = await ownProject(user, params.id);
    // কার্সার = শেষ ফাইলের সময় + আইডি (একই মিলিসেকেন্ডে কয়েকটা ফাইল হলেও কোনোটা বাদ পড়ে না)
    const before = +url.searchParams.get('before') || now() + 1;
    const beforeId = str(url.searchParams.get('beforeId') || '', 64) || '~';
    const rows = await db.all(`SELECT ${ASSET_COLS} FROM assets WHERE project_id=? AND deleted_at IS NULL AND character_id IS NULL
      AND (created<? OR (created=? AND id<?)) ORDER BY created DESC, id DESC LIMIT ?`, p.id, before, before, beforeId, PAGE + 1);
    return { assets: rows.slice(0, PAGE).map(assetView), more: rows.length > PAGE, cursor: cursorOf(rows.slice(0, PAGE)) };
  });
  route('PATCH', '/api/projects/:id', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    const name = 'name' in body ? str(body.name, 120) || p.name : p.name;
    const folder = 'folderId' in body ? await validFolder(user, body.folderId) : p.folder_id;
    await db.run('UPDATE projects SET name=?, folder_id=?, updated=? WHERE id=?', name, folder, now(), p.id);
    return { ok: true };
  });
  route('DELETE', '/api/projects/:id', async ({ user, params }) => {
    const p = await ownProject(user, params.id);
    const files = await db.all('SELECT file FROM assets WHERE project_id=?', p.id);
    await db.tx(async q => {
      await q.run("UPDATE jobs SET status='cancelled', error='প্রজেক্ট মুছে ফেলা হয়েছে', worker=NULL, lease_until=NULL WHERE project_id=? AND status IN ('queued','running')", p.id);
      await q.run('DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE project_id=?)', p.id);
      for (const t of ['assets', 'characters', 'collections', 'chat']) await q.run(`DELETE FROM ${t} WHERE project_id=?`, p.id);
      await q.run('DELETE FROM projects WHERE id=?', p.id);
    });
    for (const f of files) await storage.remove(f.file).catch(() => {});
    activity(user.id, 'project_delete', p.id, p.name);
    return { ok: true };
  });

  /* ----- এক্সপোর্ট: পুরো প্রজেক্ট ZIP ----- */
  route('GET', '/api/projects/:id/export', async ({ res, user, params }) => {
    const p = await ownProject(user, params.id);
    const view = await projectView(p);
    const all = await db.all('SELECT id,kind,mime,file,title,prompt,character_id,created FROM assets WHERE project_id=? AND deleted_at IS NULL ORDER BY created', p.id);
    const safe = s => String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 50) || 'file';
    const charName = Object.fromEntries(view.characters.map(c => [c.id, c.name]));
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="chitropot-${p.id}.zip"; filename*=UTF-8''${encodeURIComponent(safe(p.name))}.zip`,
      'cache-control': 'no-store',
    });
    const write = b => new Promise((resolve, reject) => { res.write(b, e => (e ? reject(e) : resolve())); });
    const zip = createZip(write);
    const manifest = { exportedAt: new Date().toISOString(), app: 'chitropot', project: view.project, story: view.story, characters: view.characters, collections: view.collections, clips: view.clips, files: [] };
    for (const a of all) {
      const name = a.character_id
        ? `characters/${safe(charName[a.character_id])}/${a.id}.${EXT[a.mime] || 'bin'}`
        : `${a.kind === 'video' ? 'videos' : 'images'}/${safe(a.title)}-${a.id}.${EXT[a.mime] || 'bin'}`;
      try {
        await zip.add(name, await storage.get(a.file), new Date(Number(a.created)));
        manifest.files.push({ id: a.id, path: name, title: a.title, prompt: a.prompt });
      } catch (e) {
        log('warn', 'export.skip', { asset: a.id, error: e.message });
      }
    }
    await zip.add('project.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    await zip.finish();
    res.end();
    activity(user.id, 'export', p.id, `${all.length} files`);
  }, { raw: true });

  /* ----- চরিত্র ----- */
  route('POST', '/api/projects/:id/characters', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    const name = str(body.name, 60);
    if (!name) throw httpErr(400, 'চরিত্রের নাম দাও');
    if (Number((await db.get('SELECT COUNT(*) AS n FROM characters WHERE project_id=?', p.id)).n) >= 30) throw httpErr(400, 'এক প্রজেক্টে ৩০টির বেশি চরিত্র রাখা যাবে না');
    const id = newId();
    await db.run('INSERT INTO characters(id,uid,project_id,name,description,created) VALUES(?,?,?,?,?,?)', id, user.id, p.id, name, str(body.description, 1500), now());
    return { id };
  });
  route('PATCH', '/api/characters/:id', async ({ user, params, body }) => {
    const c = await ownChar(user, params.id);
    if ('voice' in body && body.voice && !voiceOf(body.voice)) throw httpErr(400, 'এই কণ্ঠ পাওয়া যায়নি');
    await db.run('UPDATE characters SET name=?, description=?, voice=?, info=? WHERE id=?',
      'name' in body ? str(body.name, 60) || c.name : c.name,
      'description' in body ? str(body.description, 1500) : c.description,
      'voice' in body ? body.voice || null : c.voice,
      'info' in body ? str(body.info, 1500) : c.info, c.id);
    return { ok: true };
  });
  route('DELETE', '/api/characters/:id', async ({ user, params }) => {
    const c = await ownChar(user, params.id);
    for (const a of await db.all('SELECT * FROM assets WHERE character_id=?', c.id)) await assets.purge(a);
    await db.run('DELETE FROM characters WHERE id=?', c.id);
    return { ok: true };
  });
  route('POST', '/api/characters/:id/generate', async ({ user, params, body }) => {
    const c = await ownChar(user, params.id);
    if ((await charImageSlots(c)) <= 0) throw httpErr(400, 'একটি চরিত্রে ৩টির বেশি রেফারেন্স ছবি রাখা যাবে না। পুরনো একটি মুছে দাও।');
    await genRate(user);
    const existing = (await db.all("SELECT id FROM assets WHERE character_id=? AND kind='image' ORDER BY created LIMIT 3", c.id)).map(a => a.id);
    const extra = str(body.extra, 500);
    const view = body.view === 'body' ? 'body' : 'portrait';
    const prompt = (view === 'body'
      ? `Full-body character reference sheet of ${c.name}: front view, side view and back view standing side by side. ${c.description}\n`
      : `Character portrait reference of ${c.name}: head and shoulders, looking at the camera, clear face. ${c.description}\n`) +
      (existing.length ? 'Keep exactly the same person, face, hair and outfit as in the reference images. ' : '') +
      'Neutral plain background, soft even studio lighting. ' + extra;
    const model = cfg.imageModels.includes(body.imageModel) ? body.imageModel : undefined;
    const [jobId] = await enqueue(user, c.project_id, 'image', `${c.name}-এর রেফারেন্স ছবি`, {
      kind: 'image', mode: 'character', prompt, displayPrompt: extra || `${c.name}-এর ${view === 'body' ? 'পুরো শরীর' : 'মুখের ছবি'}`, images: existing,
      aspect: view === 'body' ? '16:9' : '3:4', characterId: c.id, model, meta: { characterName: c.name, view },
    });
    return { jobId };
  });
  route('DELETE', '/api/characters/:id/images/:assetId', async ({ user, params }) => {
    const c = await ownChar(user, params.id);
    const a = await ownAsset(user, params.assetId);
    if (a.character_id !== c.id) throw httpErr(400, 'এই ছবি এই চরিত্রের নয়');
    await assets.purge(a);
    return { ok: true };
  });

  /* ----- কণ্ঠ ----- */
  route('GET', '/api/voices', () => ({ voices: VOICES, sample: VOICE_SAMPLE }));
  const voiceBusy = new Map();
  route('GET', '/api/voices/:name/preview', async ({ req, res, user, params }) => {
    control.blockGuest(user);
    const v = voiceOf(params.name);
    if (!v) throw httpErr(404, 'কণ্ঠ পাওয়া যায়নি');
    const key = `voices/${v.name}.wav`;
    if (!(await storage.exists(key))) {
      await rate('voice:' + user.id, 30, 60e3, 'একটু পরে আবার শোনো');
      // একই কণ্ঠ একসাথে কয়েকবার চাইলেও একবারই বানানো হয়, তারপর জমা থাকে (আর খরচ হয় না)
      if (!voiceBusy.has(v.name)) {
        voiceBusy.set(v.name, (async () => {
          if (!(await db.lock('voice:' + v.name, 120e3))) {
            for (let i = 0; i < 40 && !(await storage.exists(key)); i++) await new Promise(r => setTimeout(r, 500));
            return;
          }
          try {
            if (await storage.exists(key)) return;
            await storage.put(key, await gemini.tts(v.name, VOICE_SAMPLE, 'warm and natural'), 'audio/wav');
          } finally {
            await db.unlock('voice:' + v.name);
          }
        })().finally(() => voiceBusy.delete(v.name)));
      }
      await voiceBusy.get(v.name);
      if (!(await storage.exists(key))) throw httpErr(503, 'কণ্ঠ এখনো তৈরি হচ্ছে, একটু পরে আবার চাপো');
    }
    storage.send(req, res, key, { mime: 'audio/wav' });
  }, { raw: true });

  /* ----- আপলোড ও অবতার ----- */
  route('POST', '/api/projects/:id/avatar', async ({ user, params, body }) => {
    control.blockGuest(user);
    const p = await ownProject(user, params.id);
    await genRate(user);
    const name = str(body.name, 60) || 'আমি';
    const style = AVATAR_STYLES[body.style] || AVATAR_STYLES.real;
    const { mime, buf } = decodeDataUrl(body.dataUrl, httpErr);
    await checkUploadQuota(user, buf.length);
    const photo = await assets.save({ uid: user.id, projectId: p.id, kind: 'image', mime, buf, prompt: `${name}-এর আসল ছবি`, mode: 'upload', title: `${name}-এর ছবি` });
    const cid = newId();
    await db.run('INSERT INTO characters(id,uid,project_id,name,description,created) VALUES(?,?,?,?,?,?)', cid, user.id, p.id, name, str(body.description, 1500), now());
    const [jobId] = await enqueue(user, p.id, 'image', `${name}-এর রেফারেন্স ছবি`, {
      kind: 'image', mode: 'character', characterId: cid, images: [photo], aspect: '3:4',
      prompt: `Turn the person in this photo into ${style}. Keep their face shape, skin tone, hairstyle and features recognizable. Head and shoulders, looking at the camera, neutral plain background, soft even lighting.`,
      displayPrompt: `${name}-এর অবতার`, meta: { characterName: name, view: 'portrait' },
    });
    return { characterId: cid, jobId };
  }, { bigBody: true });

  route('POST', '/api/projects/:id/upload', async ({ user, params, body }) => {
    control.blockGuest(user);
    const p = await ownProject(user, params.id);
    let characterId = null;
    if (body.characterId) {
      const c = await ownChar(user, str(body.characterId, 64));
      if (c.project_id !== p.id) throw httpErr(400, 'চরিত্র এই প্রজেক্টের নয়');
      if ((await charImageSlots(c)) <= 0) throw httpErr(400, 'একটি চরিত্রে ৩টির বেশি রেফারেন্স ছবি রাখা যাবে না');
      characterId = c.id;
    }
    const { mime, buf } = decodeDataUrl(body.dataUrl, httpErr);
    await checkUploadQuota(user, buf.length);
    const name = str(body.name, 200) || 'আপলোড';
    let parentId = null;
    let meta = {};
    if (body.parentId) {
      const parent = await liveAsset(user, str(body.parentId, 64));
      if (parent.project_id !== p.id) throw httpErr(400, 'একই প্রজেক্টের ফাইল দাও');
      parentId = parent.id;
      meta = { ...parseJson(parent.meta, {}), aspect: ASPECTS_IMAGE.includes(body.aspect) ? body.aspect : undefined };
    }
    const id = await assets.save({ uid: user.id, projectId: p.id, characterId, kind: 'image', mime, buf, prompt: name, mode: parentId ? 'crop' : 'upload', title: name.slice(0, 80), parentId, meta });
    return { id };
  }, { bigBody: true });

  route('POST', '/api/assets/:id/to-character', async ({ user, params, body }) => {
    const a = await liveAsset(user, params.id);
    const c = await ownChar(user, str(body.characterId, 64));
    if (a.kind !== 'image') throw httpErr(400, 'শুধু ছবি চরিত্রে যোগ করা যায়');
    if (c.project_id !== a.project_id) throw httpErr(400, 'একই প্রজেক্টের চরিত্র বেছে নাও');
    if ((await charImageSlots(c)) <= 0) throw httpErr(400, 'একটি চরিত্রে ৩টির বেশি রেফারেন্স ছবি রাখা যাবে না');
    const id = await assets.save({ uid: user.id, projectId: a.project_id, characterId: c.id, kind: 'image', mime: a.mime, buf: await storage.get(a.file), prompt: a.prompt, mode: 'character' });
    return { id };
  });

  /* ----- তৈরি করা ----- */
  route('POST', '/api/projects/:id/generate', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    const mode = ['video', 'frames', 'image'].includes(body.mode) ? body.mode : 'video';
    const kind = mode === 'image' ? 'image' : 'video';
    const prompt = str(body.prompt, 3000);
    if (!prompt) throw httpErr(400, 'প্রম্পট লেখো');
    const count = Math.min(Math.max(Math.round(+body.count) || 1, 1), 4);
    await genRate(user);

    let images = [];
    let chars = [];
    let frames = 0;
    if (mode === 'frames') {
      if (!body.firstFrameId) throw httpErr(400, 'শুরুর ছবি বেছে নাও');
      for (const fid of [body.firstFrameId, body.lastFrameId].filter(Boolean)) {
        const a = await liveAsset(user, str(fid, 64));
        if (a.kind !== 'image' || a.project_id !== p.id) throw httpErr(400, 'ফ্রেম হিসেবে এই প্রজেক্টের ছবিই দেওয়া যায়');
        images.push(a.id);
      }
      frames = images.length;
    } else if (mode === 'video') {
      // Omni Flash: মোট ৬টি রেফারেন্স ছবি, চরিত্রপ্রতি ৩টি, সর্বোচ্চ ২ জন চরিত্র
      chars = await characterRefs(user, p.id, body.characterIds, 3, 2);
      images = chars.flatMap(c => c.images).slice(0, 6);
    } else {
      // Nano Banana: চরিত্রের ৪টি ছবি, বাকি বস্তু/জায়গার ছবি মিলিয়ে মোট ১৪টি
      chars = await characterRefs(user, p.id, body.characterIds, 2, 4);
      images = chars.flatMap(c => c.images).slice(0, 4);
    }
    let extraRefs = 0;
    if (mode !== 'frames') {
      const room = (kind === 'video' ? 6 : 14) - images.length;
      const ings = idList(body.ingredientIds, 20);
      if (ings.length > room) throw httpErr(400, `উপকরণ খুব বেশি। এখানে আর ${room}টি ছবি দেওয়া যাবে।`);
      for (const iid of ings) {
        const a = await liveAsset(user, iid);
        if (a.kind !== 'image' || a.project_id !== p.id) throw httpErr(400, 'উপকরণ হিসেবে এই প্রজেক্টের ছবিই দেওয়া যায়');
        if (!images.includes(a.id)) { images.push(a.id); extraRefs++; }
      }
    }
    const imageModel = kind === 'image' && cfg.imageModels.includes(body.imageModel) ? body.imageModel : undefined;
    const aspect = kind === 'video' ? (ASPECTS_VIDEO.includes(body.aspect) ? body.aspect : '16:9') : (ASPECTS_IMAGE.includes(body.aspect) ? body.aspect : '1:1');
    const maxDur = frames === 2 ? 10 : 15;
    const duration = Math.min(Math.max(Math.round(+body.duration || 8), 3), maxDur);
    const resolution = RESOLUTIONS.includes(body.resolution) ? body.resolution : '720p';
    const finalPrompt = composePrompt({
      prompt, chars, frames, kind, extraRefs,
      style: str(body.style, 200), camera: str(body.camera, 200), singleShot: Boolean(body.singleShot), avoid: str(body.avoid, 300),
    });
    const request = {
      kind, mode, prompt: finalPrompt, displayPrompt: prompt, images, aspect, model: imageModel,
      duration: kind === 'video' ? duration : undefined,
      resolution: kind === 'video' ? resolution : undefined,
      meta: {
        aspect, duration: kind === 'video' ? duration : undefined, resolution: kind === 'video' ? resolution : undefined,
        characterIds: chars.map(c => c.id), characterNames: chars.map(c => c.name),
        ingredientIds: images.filter(id => !chars.some(c => c.images.includes(id))),
        camera: str(body.camera, 200), style: str(body.style, 200), model: imageModel,
      },
    };
    const jobIds = await enqueue(user, p.id, kind, prompt.slice(0, 80), request, count);
    activity(user.id, 'generate', p.id, `${kind} ×${count}`);
    return { jobIds };
  });

  route('POST', '/api/assets/:id/remix', async ({ user, params, body }) => {
    const a = await liveAsset(user, params.id);
    const action = ['extend', 'edit', 'next', 'upscale'].includes(body.action) ? body.action : 'edit';
    const text = str(body.prompt, 2000);
    const meta = parseJson(a.meta, {});
    if (a.kind === 'image' && !['edit', 'upscale'].includes(action)) throw httpErr(400, 'ছবিতে শুধু বদলানো বা বড় করা যায়');
    if (a.kind === 'video' && action === 'upscale') throw httpErr(400, 'ভিডিও বড় করা যায় না');
    await genRate(user);

    let request;
    if (action === 'next') {
      if (!text) throw httpErr(400, 'পরের দৃশ্যে কী হবে লেখো');
      const chars = await characterRefs(user, a.project_id, meta.characterIds, 3, 2);
      request = {
        kind: 'video', mode: 'next', parentId: a.id, displayPrompt: text,
        prompt: composePrompt({ prompt: 'Show the same characters in the next scene. ' + text, chars, kind: 'video', camera: meta.camera, style: meta.style }),
        images: chars.flatMap(c => c.images).slice(0, 6),
        aspect: meta.aspect || '16:9', duration: meta.duration > 15 ? 8 : meta.duration || 8, resolution: meta.resolution || '720p',
        meta: { ...meta, duration: meta.duration > 15 ? 8 : meta.duration || 8, characterIds: chars.map(c => c.id), characterNames: chars.map(c => c.name) },
      };
    } else if (a.kind === 'image') {
      if (action === 'edit' && !text) throw httpErr(400, 'কী বদলাতে চাও লেখো');
      const size = body.size === '4K' ? '4K' : '2K';
      const aspect = ASPECTS_IMAGE.includes(body.aspect) ? body.aspect : undefined;
      const prompt = action === 'upscale'
        ? 'Recreate this exact image at a higher resolution with finer detail. Keep everything identical: composition, faces, colors and text.'
        : text + ' Keep everything else the same.';
      request = {
        kind: 'image', mode: action, parentId: a.id, prompt, model: cfg.imageModels.includes(body.imageModel) ? body.imageModel : meta.model,
        previousId: a.interaction_id || undefined, images: a.interaction_id ? [] : [a.id],
        displayPrompt: action === 'upscale' ? `${size}-এ বড় করা` : text,
        aspect: aspect || (action === 'upscale' ? meta.aspect : undefined),
        imageSize: action === 'upscale' ? size : undefined,
        meta: { ...meta, aspect: aspect || meta.aspect, size: action === 'upscale' ? size : meta.size },
      };
    } else {
      if (!a.interaction_id) throw httpErr(400, 'আপলোড করা ভিডিও এভাবে বদলানো যায় না।');
      if (action === 'edit' && !text) throw httpErr(400, 'কী বদলাতে চাও লেখো');
      const duration = action === 'extend' ? Math.min(Math.max(Math.round(+body.duration || 8), 3), 10) : undefined;
      // Omni Flash: বাড়ানো ভিডিও মোট ৩০ সেকেন্ডের বেশি হতে পারে না; বদলানোর জন্য ভিডিও ১৫ সেকেন্ডের মধ্যে হতে হবে
      if (action === 'extend' && (meta.duration || 8) + duration > 30) throw httpErr(400, `ভিডিও মোট ৩০ সেকেন্ডের বেশি বাড়ানো যায় না (এখন ${meta.duration || 8} সেকেন্ড)।`);
      if (action === 'edit' && (meta.duration || 8) > 15) throw httpErr(400, '১৫ সেকেন্ডের বেশি লম্বা ভিডিও বদলানো যায় না।');
      const prompt = action === 'extend' ? 'Extend this video. ' + (text || 'The scene continues naturally.') : text + ' Keep everything else the same.';
      request = {
        kind: 'video', mode: action, parentId: a.id, previousId: a.interaction_id, prompt,
        displayPrompt: text || (action === 'extend' ? 'ভিডিও বাড়ানো' : ''), images: [],
        duration, resolution: meta.resolution || '720p',
        meta: { ...meta, duration: action === 'extend' ? (meta.duration || 8) + duration : meta.duration },
      };
    }
    const labels = { extend: 'ভিডিও বাড়ানো', edit: 'বদলানো', next: 'পরের দৃশ্য', upscale: 'বড় করা' };
    const [jobId] = await enqueue(user, a.project_id, request.kind, `${labels[action]}: ${request.displayPrompt.slice(0, 60)}`, request);
    activity(user.id, 'remix', a.id, action);
    return { jobId };
  });

  /* ----- কাজ: বাতিল, আবার চেষ্টা, সরানো ----- */
  route('POST', '/api/jobs/:id/cancel', async ({ user, params }) => {
    const j = await db.get('SELECT * FROM jobs WHERE id=? AND uid=?', params.id, user.id);
    if (!j) throw httpErr(404, 'কাজ পাওয়া যায়নি');
    if (!['queued', 'running'].includes(j.status)) throw httpErr(400, 'এই কাজ আর চলছে না');
    await db.run("UPDATE jobs SET status='cancelled', error='বাতিল করা হয়েছে', worker=NULL, lease_until=NULL, finished=?, updated=? WHERE id=? AND status IN ('queued','running')", now(), now(), j.id);
    // চলমান কাজ Google-এ পাঠানো হয়ে থাকতে পারে (আইডি জমা হওয়ার আগেই), তাই চলমান হলেই সতর্ক করা
    return { ok: true, note: j.interaction_id ? 'Google-এ পাঠানো হয়ে গিয়েছিল, তাই খরচ হয়ে থাকতে পারে।'
      : j.status === 'running' ? 'কাজটা চলছিল, Google-এ পাঠানো হয়ে থাকলে খরচ হয়ে থাকতে পারে।' : '' };
  });
  route('POST', '/api/jobs/:id/retry', async ({ user, params }) => {
    const j = await db.get('SELECT * FROM jobs WHERE id=? AND uid=?', params.id, user.id);
    if (!j) throw httpErr(404, 'কাজ পাওয়া যায়নি');
    if (!['failed', 'cancelled'].includes(j.status)) throw httpErr(400, 'শুধু ব্যর্থ বা বাতিল কাজ আবার চালানো যায়');
    await ownProject(user, j.project_id);
    const req = parseJson(j.request, {});
    for (const id of [...(req.images || []), req.parentId].filter(Boolean)) {
      if (!(await db.get('SELECT 1 AS x FROM assets WHERE id=? AND uid=? AND deleted_at IS NULL', id, user.id))) throw httpErr(400, 'এই কাজের একটা ছবি মুছে ফেলা হয়েছে, তাই আবার চালানো যাচ্ছে না');
    }
    await genRate(user);
    const [jobId] = await enqueue(user, j.project_id, j.kind, j.label, req);
    await db.run('DELETE FROM jobs WHERE id=?', j.id);
    return { jobId };
  });
  route('POST', '/api/jobs/:id/dismiss', async ({ user, params }) => {
    await db.run("DELETE FROM jobs WHERE id=? AND uid=? AND status IN ('done','failed','cancelled')", params.id, user.id);
    return { ok: true };
  });

  /* ----- ফাইল ----- */
  route('PATCH', '/api/assets/:id', async ({ user, params, body }) => {
    const a = await ownAsset(user, params.id);
    if ('favorite' in body) await db.run('UPDATE assets SET favorite=? WHERE id=?', body.favorite ? 1 : 0, a.id);
    if ('title' in body) await db.run('UPDATE assets SET title=? WHERE id=?', str(body.title, 80) || shortTitle(a.prompt), a.id);
    return { ok: true };
  });
  // প্রথমবার মুছলে ট্র্যাশে যায়; ট্র্যাশ থেকে মুছলে বা ?forever=1 দিলে স্থায়ীভাবে মুছে যায়
  route('DELETE', '/api/assets/:id', async ({ user, params, url }) => {
    const a = await ownAsset(user, params.id);
    if (a.character_id || a.deleted_at || url.searchParams.get('forever') === '1') {
      await assets.purge(a);
      activity(user.id, 'purge', a.id);
    } else {
      await db.run('UPDATE assets SET deleted_at=? WHERE id=?', now(), a.id);
    }
    return { ok: true };
  });
  route('POST', '/api/assets/:id/restore', async ({ user, params }) => {
    const a = await ownAsset(user, params.id);
    await db.run('UPDATE assets SET deleted_at=NULL WHERE id=?', a.id);
    return { ok: true };
  });
  route('GET', '/api/projects/:id/trash', async ({ user, params }) => {
    const p = await ownProject(user, params.id);
    return {
      days: cfg.trashDays,
      assets: (await db.all('SELECT id,kind,title,prompt,meta,deleted_at FROM assets WHERE project_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500', p.id))
        .map(a => ({ ...a, meta: parseJson(a.meta, {}) })),
    };
  });
  route('DELETE', '/api/projects/:id/trash', async ({ user, params }) => {
    const p = await ownProject(user, params.id);
    const list = await db.all('SELECT * FROM assets WHERE project_id=? AND deleted_at IS NOT NULL', p.id);
    for (const a of list) await assets.purge(a);
    activity(user.id, 'trash_empty', p.id, `${list.length} files`);
    return { ok: true };
  });

  /* ----- কালেকশন ----- */
  route('POST', '/api/projects/:id/collections', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    const name = str(body.name, 60);
    if (!name) throw httpErr(400, 'কালেকশনের নাম দাও');
    const id = newId();
    await db.run('INSERT INTO collections(id,uid,project_id,name,created) VALUES(?,?,?,?,?)', id, user.id, p.id, name, now());
    return { id };
  });
  route('PATCH', '/api/collections/:id', async ({ user, params, body }) => {
    const c = await ownCollection(user, params.id);
    await db.run('UPDATE collections SET name=? WHERE id=?', str(body.name, 60) || c.name, c.id);
    return { ok: true };
  });
  route('DELETE', '/api/collections/:id', async ({ user, params }) => {
    const c = await ownCollection(user, params.id);
    await db.run('DELETE FROM collection_items WHERE collection_id=?', c.id);
    await db.run('DELETE FROM collections WHERE id=?', c.id);
    return { ok: true };
  });
  route('POST', '/api/collections/:id/items', async ({ user, params, body }) => {
    const c = await ownCollection(user, params.id);
    const a = await ownAsset(user, str(body.assetId, 64));
    if (a.project_id !== c.project_id) throw httpErr(400, 'একই প্রজেক্টের ফাইল দাও');
    if (body.add === false) await db.run('DELETE FROM collection_items WHERE collection_id=? AND asset_id=?', c.id, a.id);
    else await db.run('INSERT INTO collection_items(collection_id, asset_id) VALUES(?,?) ON CONFLICT DO NOTHING', c.id, a.id);
    return { ok: true };
  });

  /* ----- দৃশ্যক্রম ----- */
  route('PUT', '/api/projects/:id/clips', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    const ids = idList(body.clips, 200);
    const live = new Set((await db.all("SELECT id FROM assets WHERE project_id=? AND kind='video' AND deleted_at IS NULL", p.id)).map(r => r.id));
    const valid = ids.filter(id => live.has(id));
    await db.run('UPDATE projects SET clips=?, updated=? WHERE id=?', JSON.stringify(valid), now(), p.id);
    return { clips: valid };
  });

  /* ----- লেখা: প্রম্পট উন্নত করা, গল্প, সহকারী ----- */
  route('POST', '/api/enhance', async ({ user, body }) => {
    const idea = str(body.prompt, 2000);
    if (!idea) throw httpErr(400, 'আগে কিছু লেখো');
    await textRate(user);
    const kind = body.kind === 'image' ? 'image' : 'video';
    let names = [];
    if (body.projectId) {
      await ownProject(user, str(body.projectId, 64));
      names = (await characterRefs(user, body.projectId, body.characterIds, 0, 4)).map(c => `${c.name}: ${c.description}`);
    }
    const system = `You turn short ideas (often in Bengali) into one rich English prompt for an AI ${kind} generator. ` +
      (kind === 'video'
        ? 'Describe subject, action, setting, lighting, mood, camera movement and sound/ambience. Keep any spoken dialogue in its original language inside quotes. '
        : 'Describe subject, composition, setting, lighting, colors and style. ') +
      'Refer to the listed characters by name; their looks come from reference images, so do not change them. Output only the prompt text, nothing else.';
    const text = await gemini.textGen(system, `Idea: ${idea}\n` + (names.length ? `Characters: ${names.join(' | ')}` : ''));
    if (!text) throw httpErr(502, 'উন্নত প্রম্পট পাওয়া যায়নি');
    return { prompt: text.slice(0, 3000) };
  });

  route('PUT', '/api/projects/:id/story', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    const story = parseJson(p.story, {});
    story.premise = str(body.premise, 3000);
    story.genre = str(body.genre, 200);
    await db.run('UPDATE projects SET story=?, updated=? WHERE id=?', JSON.stringify(story), now(), p.id);
    return { story };
  });
  route('POST', '/api/projects/:id/story/episodes', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    await textRate(user);
    if (!(await db.lock('story:' + p.id, 180e3))) throw httpErr(409, 'একটি এপিসোড এখনো লেখা হচ্ছে');
    try {
      const story = parseJson(p.story, {});
      const episodes = story.episodes || [];
      const chars = await db.all('SELECT name, description FROM characters WHERE project_id=?', p.id);
      const memory = episodes.map(e => `Episode ${e.no} "${e.title}": ${e.summary}`).join('\n') || '(this is the first episode)';
      const last = episodes[episodes.length - 1];
      const userText = [
        `Series premise: ${story.premise || '-'}`, `Genre/style: ${story.genre || '-'}`,
        'Characters (fixed looks):', chars.map(c => `- ${c.name}: ${c.description}`).join('\n') || '(none)',
        'Story so far:', memory,
        last ? 'Last episode scenes:\n' + last.scenes.map(s => `${s.no}. [${s.location}] ${s.action} | ${s.dialogue}`).join('\n') : '',
        `Write the next episode. Direction: ${str(body.direction, 500) || 'continue the story naturally'}`,
        `Rules: 6 to 10 scenes, each fits one 8-second video clip. title, summary, location, action and dialogue in ${LANG(user)}. ` +
        `characters = names (exactly as listed) of characters visible in the scene. video_prompt in English, cinematic, with camera, lighting and sound; mention characters by name; dialogue stays in ${LANG(user)} inside quotes. ` +
        'summary: 3-5 sentences so the next episode remembers what happened.',
      ].filter(Boolean).join('\n');
      const raw = await gemini.textGen(`You are a ${LANG(user)}-language drama series writer and storyboard artist. Keep continuity with earlier episodes. Reply with JSON only.`, userText, EPISODE_SCHEMA);
      const ep = parseJson(raw, null);
      if (!ep || !Array.isArray(ep.scenes) || !ep.scenes.length) throw httpErr(502, 'মডেল ঠিকমতো এপিসোড দেয়নি, আবার চেষ্টা করো');
      const current = parseJson((await db.get('SELECT story FROM projects WHERE id=?', p.id))?.story, {});
      const no = Math.max(0, ...(current.episodes || []).map(e => e.no)) + 1;
      current.episodes = [...(current.episodes || []), {
        id: newId(), no, title: str(ep.title, 200) || `এপিসোড ${no}`, summary: str(ep.summary, 1500),
        direction: str(body.direction, 500), created: now(),
        scenes: ep.scenes.slice(0, 12).map((s, i) => ({
          no: i + 1, location: str(s.location, 300), action: str(s.action, 1500), dialogue: str(s.dialogue, 1000),
          characters: (Array.isArray(s.characters) ? s.characters : []).map(x => str(x, 60)).filter(Boolean).slice(0, 6),
          video_prompt: str(s.video_prompt, 2500),
        })),
      }];
      await db.run('UPDATE projects SET story=?, updated=? WHERE id=?', JSON.stringify(current), now(), p.id);
      return { story: current };
    } finally {
      await db.unlock('story:' + p.id);
    }
  });
  route('DELETE', '/api/projects/:id/story/episodes/:eid', async ({ user, params }) => {
    const p = await ownProject(user, params.id);
    const story = parseJson(p.story, {});
    story.episodes = (story.episodes || []).filter(e => e.id !== params.eid);
    await db.run('UPDATE projects SET story=?, updated=? WHERE id=?', JSON.stringify(story), now(), p.id);
    return { story };
  });

  const chatList = pid => db.all('SELECT id,role,text,created FROM chat WHERE project_id=? ORDER BY created LIMIT 500', pid);
  route('GET', '/api/projects/:id/chat', async ({ user, params }) => ({ messages: await chatList((await ownProject(user, params.id)).id) }));
  route('DELETE', '/api/projects/:id/chat', async ({ user, params }) => {
    const p = await ownProject(user, params.id);
    await db.run('DELETE FROM chat WHERE project_id=?', p.id);
    return { messages: [] };
  });
  route('POST', '/api/projects/:id/chat', async ({ user, params, body }) => {
    const p = await ownProject(user, params.id);
    const text = str(body.text, 3000);
    if (!text) throw httpErr(400, 'কিছু লেখো');
    await textRate(user);
    if (!(await db.lock('chat:' + p.id, 120e3))) throw httpErr(409, 'আগের উত্তর এখনো আসছে');
    try {
      const story = parseJson(p.story, {});
      const chars = await db.all('SELECT name, description FROM characters WHERE project_id=?', p.id);
      const history = (await db.all('SELECT role, text FROM chat WHERE project_id=? ORDER BY created DESC LIMIT 20', p.id)).reverse();
      const system = `You are the creative assistant inside Chitropot, an AI film studio. Reply in ${LANG(user)}, friendly and concise. ` +
        'Help brainstorm ideas, develop storyboards, plan shots and write prompts. ' +
        `Whenever you give a ready-to-use generation prompt, put it alone in a fenced block that starts with \`\`\`prompt and write that prompt in English (dialogue stays in ${LANG(user)} inside quotes). ` +
        'Refer to characters by name; their looks come from reference images.\n' +
        `Project: ${p.name}. Premise: ${story.premise || '-'}. Genre: ${story.genre || '-'}.\n` +
        'Characters: ' + (chars.map(c => `${c.name} (${c.description || '-'})`).join('; ') || 'none yet');
      const contents = [...history, { role: 'user', text }].map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
      const reply = gemini.textOf(await gemini.textCall({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.9, maxOutputTokens: 4096 } }));
      if (!reply) throw httpErr(502, 'সহকারী কোনো উত্তর দেয়নি, আবার চেষ্টা করো');
      const t = now();
      await db.run('INSERT INTO chat(id,uid,project_id,role,text,created) VALUES(?,?,?,?,?,?)', newId(), user.id, p.id, 'user', text, t);
      await db.run('INSERT INTO chat(id,uid,project_id,role,text,created) VALUES(?,?,?,?,?,?)', newId(), user.id, p.id, 'model', reply.slice(0, 20000), t + 1);
      return { messages: await chatList(p.id) };
    } finally {
      await db.unlock('chat:' + p.id);
    }
  });

  /* ---------------- মিডিয়া ---------------- */
  async function handleMedia(req, res, url, assetId) {
    const user = await readSession(req);
    if (!user) return false;
    const a = await db.get('SELECT * FROM assets WHERE id=? AND uid=?', assetId, user.id);
    if (!a) return null;
    const dl = url.searchParams.has('dl') ? `chitropot-${a.id}.${EXT[a.mime] || 'bin'}` : '';
    storage.send(req, res, a.file, { mime: a.mime, downloadName: dl });
    return true;
  }

  /* ---------------- রক্ষণাবেক্ষণ (একসময়ে একটা সার্ভারই করে) ---------------- */
  async function maintenance() {
    try {
      if (await db.lock('maint:trash', 50 * 60e3)) {
        const old = await db.all('SELECT * FROM assets WHERE deleted_at IS NOT NULL AND deleted_at<? LIMIT 1000', now() - cfg.trashDays * DAY);
        for (const a of old) await assets.purge(a);
        await control.purgeGuests();
        const keep = now() - cfg.historyDays * DAY;
        await db.run("DELETE FROM jobs WHERE status IN ('done','failed','cancelled') AND updated<?", keep);
        await db.run('DELETE FROM activity WHERE created<?', keep);
        await db.run('DELETE FROM rate_limits WHERE win<?', now() - DAY);
        await db.run('DELETE FROM locks WHERE until<?', now());
        // পুরনো ফাইলের আকার (আগের ভার্সনে রাখা হতো না) পূরণ
        const noSize = await db.all('SELECT id, file FROM assets WHERE size=0 LIMIT 500');
        for (const a of noSize) {
          try { await db.run('UPDATE assets SET size=? WHERE id=?', (await storage.get(a.file)).length, a.id); } catch { /* ফাইল নেই */ }
        }
        if (old.length || noSize.length) log('info', 'maintenance', { purged: old.length, sized: noSize.length });
      }
    } catch (e) {
      log('error', 'maintenance', { error: e.message });
    }
  }

  const docStudio = createDocStudio({ cfg, db, storage, gemini, log, route, httpErr, rate, activity, checkUploadQuota, maintenanceCheck: u => control.maintenanceCheck(u) });

  return { routes, readSession, handleMedia, maintenance, autoTitle, httpErr, docStudio };
}

module.exports = { createApp, startOfDay, dayKey, tzOffsetMs };
