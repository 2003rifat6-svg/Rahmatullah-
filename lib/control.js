// নিয়ন্ত্রণ: ভূমিকা (মালিক / অ্যাডমিন / ব্যবহারকারী), মালিকের তালাবদ্ধ কন্ট্রোল প্যানেল, ব্লক, কিক,
// অভিযোগ, যোগাযোগের তথ্য (কল টু অ্যাকশন), ঘোষণা আর নতুন সদস্যের নিয়ম।
//
// নিরাপত্তার নিয়ম:
// - কন্ট্রোল প্যানেলে ঢুকতে দুটো জিনিস একসাথে লাগে: মালিকের Gmail দিয়ে লগইন + প্যানেলের পাসওয়ার্ড।
// - পাসওয়ার্ড শুধু সার্ভারের গোপন সেটিংয়ে থাকে (OWNER_PANEL_PASSWORD বা OWNER_PANEL_PASSWORD_HASH)।
//   কোডে, GitHub-এ বা ডেটাবেসে থাকে না, আর অ্যাপের ভেতর থেকে বদলানোর কোনো রাস্তা নেই।
// - ভুল পাসওয়ার্ডে বারবার চেষ্টা আটকায় (১৫ মিনিটে ৫ বার), প্রতিটা চেষ্টা লগে থাকে।
// - প্যানেল খোলা থাকে ৩০ মিনিট, তারপর নিজে থেকে বন্ধ। "সব জায়গা থেকে লগআউট" হলে সাথে সাথে বন্ধ।
// - অ্যাডমিন শুধু দেখাশোনা আর ছোট কাজ করতে পারে: অভিযোগের উত্তর, নতুন ইমেইলকে অনুমতি, আটকে থাকা কাজ বাতিল।
//   ব্লক, কিক, অ্যাডমিন বানানো, সেটিং বদলানো, অনুমতি সরানো — এগুলো শুধু মালিক, প্যানেল খুলে।
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { newId, str, decodeDataUrl, EXT } = require('./assets');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PANEL_TTL = 30 * 60e3;
const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// পাসওয়ার্ড যাচাইয়ের তথ্য: হ্যাশ দিলে সেটা, সাদা পাসওয়ার্ড দিলে চালুর সময় মেমরিতে হ্যাশ (কোথাও লেখা হয় না)
function panelVerifier(cfg) {
  if (cfg.panelPasswordHash) {
    const [kind, salt, hash] = cfg.panelPasswordHash.split('$');
    if (kind !== 'scrypt' || !salt || !hash) throw new Error('OWNER_PANEL_PASSWORD_HASH-এর ফরম্যাট ঠিক নেই (scrypt$salt$hash)');
    return { salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
  }
  if (cfg.panelPassword) {
    const salt = crypto.randomBytes(16);
    return { salt, hash: crypto.scryptSync(cfg.panelPassword, salt, 32) };
  }
  return null;
}
function hashPanelPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 32).toString('base64')}`;
}

const CONTACT_FIELDS = {
  whatsapp: v => (v.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').match(/^\+?\d{8,15}$/) ? v.replace(/[^\d+]/g, '') : null),
  phone: v => (v.replace(/[^\d+]/g, '').match(/^\+?\d{6,15}$/) ? v.replace(/[^\d+]/g, '') : null),
  email: v => (/^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(v) ? v : null),
  facebook: v => (/^https:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com|m\.me)\/[^\s<>"']+$/i.test(v) ? v : null),
  telegram: v => (/^https:\/\/t\.me\/[A-Za-z0-9_]{3,64}$/.test(v) ? v : null),
  youtube: v => (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^\s<>"']+$/i.test(v) ? v : null),
};
// ব্র্যান্ডের ছবি: মালিক বদলালে সব জায়গায় (শুরুর পর্দা, লগইন, হোম, সাহায্য, সম্পর্কে, ফোনের আইকন) নিজে থেকে যায়।
// না বদলালে public/-এর আসল ফাইল।
const BRAND_SLOTS = {
  owner: 'brand/owner.webp', 'owner-sm': 'brand/owner-sm.webp', art: 'brand/owner-art.webp',
  logo: 'logo.png', 'icon-512': 'icon-512.png', 'icon-192': 'icon-192.png', apple: 'apple-touch-icon.png', maskable: 'icon-maskable-512.png', favicon: 'favicon.png',
};
const STATIC_MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
// অ্যাপের লেখা: মালিক এক জায়গা থেকে বদলালে সব জায়গায়
const TEXT_FIELDS = { tagline: 80, heroTitle: 80, heroButton: 30, loginLine: 140, aboutText: 600, aboutTag: 80, creatorName: 60, creatorTitle: 60 };
for (const k of Object.keys(TEXT_FIELDS)) TEXT_FIELDS[k + '_en'] = TEXT_FIELDS[k]; // English সংস্করণও আলাদা রাখা যায়
// হোমের বোতাম: মালিক সাজান (ক্রম, লুকানো, নাম)
const TOOL_IDS = ['image', 'video', 'edit', 'char', 'doc', 'voice', 'upload', 'story', 'assistant', 'timeline', 'avatar', 'help'];
const ANNOUNCE_MODES = ['bar', 'popup', 'maintenance'];
const CATEGORIES = ['problem', 'account', 'billing', 'idea', 'other'];
const STATUSES = ['open', 'working', 'resolved'];

function createControl({ cfg, db, storage, route, httpErr, rate, activity, sign, clientIp, userCache, isOwner, log }) {
  const now = () => Date.now();
  let verifier = null;
  try { verifier = panelVerifier(cfg); } catch (e) { log('error', 'panel.config', { error: e.message }); }

  /* ---------------- সেটিং (সব সার্ভার মিলিয়ে, অল্প সময়ের ক্যাশ) ---------------- */
  const cache = new Map();
  async function getSetting(key, def) {
    const c = cache.get(key);
    if (c && now() - c.at < 10000) return c.v;
    const r = await db.get('SELECT value FROM settings WHERE key=?', 'ctl:' + key);
    const v = r ? parseJson(r.value, def) : def;
    cache.set(key, { v, at: now() });
    return v;
  }
  async function setSetting(key, v) {
    await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'ctl:' + key, JSON.stringify(v));
    cache.delete(key);
  }
  const contact = () => getSetting('contact', {});
  const brand = () => getSetting('brand', {});
  const texts = () => getSetting('texts', {});
  const layout = () => getSetting('layout', null);
  // রক্ষণাবেক্ষণ চললে মালিক আর অ্যাডমিন ছাড়া কেউ নতুন কিছু বানাতে পারে না
  async function maintenanceCheck(user) {
    blockGuest(user);
    const a = await announcement();
    if (a?.mode === 'maintenance' && !user.staff) throw httpErr(503, `রক্ষণাবেক্ষণ চলছে: ${a.text}`);
  }
  const announcement = () => getSetting('announce', null);
  // নতুন সদস্য: 'open' = যে কেউ Gmail দিয়ে, 'invite' = শুধু অনুমতি পাওয়া; না বসালে .env-এর OPEN_SIGNUP
  async function openSignup() {
    const m = await getSetting('signup', '');
    return m === 'open' ? true : m === 'invite' ? false : cfg.openSignup;
  }

  /* ---------------- ভূমিকা ---------------- */
  const roleOf = u => (isOwner(u.email) ? 'owner' : u.role === 'admin' ? 'admin' : u.role === 'guest' ? 'guest' : 'user');
  // অতিথি প্রবেশ: Gmail ছাড়া ঘুরে দেখা। মালিক প্যানেল থেকে চালু/বন্ধ করেন (শুরুতে চালু)
  const guestEnabled = async () => (await getSetting('guest', 'on')) !== 'off';
  const GUEST_MSG = 'অতিথি হিসেবে সব দেখা যায়, কিন্তু এটা করতে Gmail দিয়ে ঢুকতে হবে।';
  // টাকা খরচ হয় বা ফাইল জমা হয় এমন কাজ অতিথির জন্য বন্ধ
  const blockGuest = u => { if (u && u.role === 'guest') throw httpErr(403, GUEST_MSG); };
  // ৭ দিনের পুরনো অতিথি আর তাদের কাজ মুছে ফেলা (ফাইল নেই, শুধু ডেটাবেসের সারি)
  async function purgeGuests() {
    const old = await db.all("SELECT id FROM users WHERE role='guest' AND created<? LIMIT 300", now() - 7 * 864e5);
    for (const g of old) {
      await db.tx(async q => {
        await q.run('DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE uid=?)', g.id);
        for (const t of ['collections', 'chat', 'characters', 'projects', 'folders', 'jobs', 'doc_messages', 'doc_files', 'doc_projects']) await q.run(`DELETE FROM ${t} WHERE uid=?`, g.id);
        await q.run('DELETE FROM complaint_msgs WHERE complaint_id IN (SELECT id FROM complaints WHERE uid=?)', g.id);
        await q.run('DELETE FROM complaints WHERE uid=?', g.id);
        await q.run('DELETE FROM users WHERE id=? AND role=?', g.id, 'guest');
      });
    }
    return old.length;
  }
  async function createGuest(req, res, setCookieFn, makeSessionFn) {
    if (!(await guestEnabled())) throw httpErr(403, 'অতিথি প্রবেশ এখন বন্ধ। Gmail দিয়ে ঢোকো।');
    await rate('guest:' + clientIp(req), 12, 60 * 60e3, 'এই ডিভাইস থেকে অনেক অতিথি তৈরি হয়েছে। এক ঘণ্টা পরে চেষ্টা করো।');
    const id = 'g' + crypto.randomBytes(10).toString('hex');
    await db.run("INSERT INTO users(id,email,name,picture,created,last,role) VALUES(?,?,?,?,?,?,'guest')", id, `${id}@guest.local`, 'অতিথি', '', now(), now());
    setCookieFn(res, makeSessionFn(id, 0), 7 * 86400);
    activity(id, 'guest_login', clientIp(req));
  }

  /* ---------------- প্যানেলের তালা ---------------- */
  const panelCookie = (res, val, maxAge) => {
    const secure = cfg.publicUrl.startsWith('https://') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `cp_p=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
  };
  function panelState(req, user) {
    if (!user || !user.owner) return null;
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)cp_p=([^;]+)/);
    if (!m) return null;
    let raw;
    try { raw = decodeURIComponent(m[1]); } catch { return null; }
    const [uid, sv, exp, sig] = raw.split('.');
    if (!sig || uid !== user.id || String(user.sv) !== sv || +exp < now()) return null;
    const s = sign(`panel|${uid}.${sv}.${exp}`);
    if (s.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig))) return null;
    return { until: +exp };
  }
  function requirePanel(req, user) {
    if (!user.owner) throw httpErr(403, 'শুধু মালিক এটা করতে পারবে');
    if (!panelState(req, user)) throw httpErr(423, 'কন্ট্রোল প্যানেল তালাবদ্ধ। আগে পাসওয়ার্ড দিয়ে খোলো।');
  }

  route('GET', '/api/owner/status', ({ req, user }) => {
    const st = panelState(req, user);
    return { configured: Boolean(verifier), unlocked: Boolean(st), until: st?.until || null };
  }, { owner: true });
  route('POST', '/api/owner/unlock', async ({ req, res, user, body }) => {
    if (!verifier) throw httpErr(503, 'কন্ট্রোল প্যানেলের পাসওয়ার্ড সার্ভারে বসানো নেই (OWNER_PANEL_PASSWORD)।');
    await rate('panel:' + user.id, 5, 15 * 60e3, 'অনেকবার ভুল হয়েছে। ১৫ মিনিট পরে আবার চেষ্টা করো।');
    await rate('panelip:' + clientIp(req), 10, 15 * 60e3, 'অনেকবার ভুল হয়েছে। ১৫ মিনিট পরে আবার চেষ্টা করো।');
    const pw = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const got = await new Promise((resolve, reject) => crypto.scrypt(pw, verifier.salt, 32, (e, k) => (e ? reject(e) : resolve(k))));
    if (!crypto.timingSafeEqual(got, verifier.hash)) {
      activity(user.id, 'panel_fail', clientIp(req));
      throw httpErr(403, 'পাসওয়ার্ড ঠিক হয়নি'); // 401 নয়: 401 মানে লগইন শেষ, অ্যাপ তখন লগইন পাতায় পাঠায়
    }
    const exp = now() + PANEL_TTL;
    const v = `${user.id}.${user.sv}.${exp}`;
    panelCookie(res, `${v}.${sign('panel|' + v)}`, PANEL_TTL / 1000);
    activity(user.id, 'panel_unlock', clientIp(req));
    return { ok: true, until: exp };
  }, { owner: true });
  route('POST', '/api/owner/lock', ({ res, user }) => { panelCookie(res, '', 0); activity(user.id, 'panel_lock'); return { ok: true }; }, { owner: true });

  /* ---------------- মালিক: ব্যবহারকারী ---------------- */
  route('GET', '/api/owner/users', async ({ req, user, url }) => {
    requirePanel(req, user);
    const q = str(url.searchParams.get('q') || '', 100).toLowerCase();
    const rows = await db.all(`SELECT id,email,name,display_name,picture,photo,photo_v,role,blocked,block_reason,created,last FROM users
      WHERE role<>'guest' ${q ? "AND (LOWER(email) LIKE ? OR LOWER(COALESCE(display_name,name,'')) LIKE ?)" : ''} ORDER BY last DESC LIMIT 500`, ...(q ? [`%${q}%`, `%${q}%`] : []));
    return {
      users: rows.map(u => ({
        id: u.id, email: u.email, name: u.display_name || u.name, picture: u.photo ? `/api/avatar/${u.id}?v=${u.photo_v || 0}` : u.picture,
        role: roleOf(u), blocked: Boolean(Number(u.blocked)), reason: u.block_reason || '', created: Number(u.created) || 0, last: Number(u.last) || 0,
      })),
    };
  }, { owner: true });
  async function target(id) {
    const u = await db.get('SELECT * FROM users WHERE id=?', id);
    if (!u) throw httpErr(404, 'ব্যবহারকারী পাওয়া যায়নি');
    if (isOwner(u.email)) throw httpErr(400, 'মালিকের ওপর এটা করা যায় না');
    return u;
  }
  route('POST', '/api/owner/users/:id/role', async ({ req, user, params, body }) => {
    requirePanel(req, user);
    const u = await target(params.id);
    const role = body.role === 'admin' ? 'admin' : 'user';
    await db.run('UPDATE users SET role=? WHERE id=?', role, u.id);
    userCache.delete(u.id);
    activity(user.id, role === 'admin' ? 'admin_add' : 'admin_remove', u.email);
    return { ok: true, role };
  }, { owner: true });
  route('POST', '/api/owner/users/:id/block', async ({ req, user, params, body }) => {
    requirePanel(req, user);
    const u = await target(params.id);
    const blocked = body.blocked !== false;
    const reason = blocked ? str(body.reason, 300) : '';
    // ব্লক করলে সাথে সাথে সব জায়গা থেকে বের করে দেওয়া হয়, আর চলমান কাজ বাতিল
    await db.run('UPDATE users SET blocked=?, block_reason=?, sv=sv+? WHERE id=?', blocked ? 1 : 0, reason || null, blocked ? 1 : 0, u.id);
    if (blocked) await db.run("UPDATE jobs SET status='cancelled', error='অ্যাকাউন্ট ব্লক করা হয়েছে', worker=NULL, lease_until=NULL WHERE uid=? AND status IN ('queued','running')", u.id);
    userCache.delete(u.id);
    activity(user.id, blocked ? 'user_block' : 'user_unblock', u.email, reason);
    return { ok: true, blocked };
  }, { owner: true });
  // কিক: সব ডিভাইস থেকে বের করে দেওয়া (আবার লগইন করতে পারবে; চিরতরে আটকাতে ব্লক)
  route('POST', '/api/owner/users/:id/kick', async ({ req, user, params }) => {
    requirePanel(req, user);
    const u = await target(params.id);
    await db.run('UPDATE users SET sv=sv+1 WHERE id=?', u.id);
    userCache.delete(u.id);
    activity(user.id, 'user_kick', u.email);
    return { ok: true };
  }, { owner: true });

  /* ---------------- মালিক: অ্যাপের সেটিং ---------------- */
  route('GET', '/api/owner/settings', async ({ req, user }) => {
    requirePanel(req, user);
    const m = await getSetting('signup', '');
    return { contact: await contact(), announcement: await announcement(), signup: m || (cfg.openSignup ? 'open' : 'invite'), signupFromEnv: !m, guest: (await guestEnabled()) ? 'on' : 'off',
      texts: await texts(), layout: await layout(), brand: await brand() };
  }, { owner: true });
  route('PUT', '/api/owner/settings', async ({ req, user, body }) => {
    requirePanel(req, user);
    if (body.contact && typeof body.contact === 'object') {
      const out = {};
      const bad = [];
      for (const [k, check] of Object.entries(CONTACT_FIELDS)) {
        const v = str(body.contact[k], 200);
        if (!v) continue;
        const ok = check(v);
        if (ok) out[k] = ok; else bad.push(k);
      }
      if (bad.length) throw httpErr(400, `এগুলো ঠিক নেই: ${bad.join(', ')} (WhatsApp/ফোন শুধু নম্বর, Facebook/Telegram/YouTube পুরো https লিংক)`);
      const note = str(body.contact.note, 300);
      if (note) out.note = note;
      await setSetting('contact', out);
      activity(user.id, 'settings_contact');
    }
    if (body.texts && typeof body.texts === 'object') {
      const out = {};
      for (const [k, max] of Object.entries(TEXT_FIELDS)) { const v = str(body.texts[k], max); if (v) out[k] = v; }
      await setSetting('texts', out);
      activity(user.id, 'settings_texts');
    }
    if (body.guest === 'on' || body.guest === 'off') {
      await setSetting('guest', body.guest);
      userCache.clear(); // বন্ধ করলে চালু থাকা অতিথিও সাথে সাথে বের হয়ে যায়
      activity(user.id, 'settings_guest', body.guest);
    }
    if ('layout' in body) {
      if (body.layout === null) await setSetting('layout', null);
      else {
        if (!Array.isArray(body.layout)) throw httpErr(400, 'সাজানোর তালিকা ঠিক নেই');
        const seen = new Set();
        const out = [];
        for (const t of body.layout) {
          if (!t || !TOOL_IDS.includes(t.id) || seen.has(t.id)) continue;
          seen.add(t.id);
          out.push({ id: t.id, hidden: Boolean(t.hidden), ...(str(t.label, 24) ? { label: str(t.label, 24) } : {}) });
        }
        for (const id of TOOL_IDS) if (!seen.has(id)) out.push({ id, hidden: true }); // নতুন/বাদ পড়া বোতাম লুকানো অবস্থায় শেষে
        if (!out.some(t => !t.hidden)) throw httpErr(400, 'অন্তত একটা বোতাম দেখাতে হবে');
        await setSetting('layout', out);
      }
      activity(user.id, 'settings_layout');
    }
    if ('announcement' in body) {
      const text = str(body.announcement?.text, 600);
      const mode = ANNOUNCE_MODES.includes(body.announcement?.mode) ? body.announcement.mode : 'bar';
      await setSetting('announce', text ? { text, level: body.announcement.level === 'warn' ? 'warn' : 'info', mode, at: now() } : null);
      activity(user.id, 'settings_announce', text.slice(0, 80));
    }
    if (body.signup === 'open' || body.signup === 'invite') {
      await setSetting('signup', body.signup);
      userCache.clear();
      activity(user.id, 'settings_signup', body.signup);
    }
    return { ok: true };
  }, { owner: true });
  /* ---------------- ব্র্যান্ডের ছবি ---------------- */
  // ছবি ছোট-বড় করা মালিকের ব্রাউজারেই হয় (কোনো ফিল্টার নেই); সার্ভার শুধু আসল ধরন যাচাই করে জমা রাখে
  route('PUT', '/api/owner/brand/:slot', async ({ req, user, params, body }) => {
    requirePanel(req, user);
    if (!BRAND_SLOTS[params.slot]) throw httpErr(404, 'অজানা জায়গা');
    const { mime, buf } = decodeDataUrl(body.dataUrl, httpErr, 8 * 1024 * 1024);
    const b = { ...(await brand()) };
    const key = `brand/${params.slot}-${now().toString(36)}.${EXT[mime]}`;
    await storage.put(key, buf, mime);
    const old = b[params.slot]?.key;
    b[params.slot] = { key, mime, v: now() };
    await setSetting('brand', b);
    if (old) await storage.remove(old).catch(() => {});
    activity(user.id, 'brand_change', params.slot);
    return { ok: true, v: b[params.slot].v };
  }, { owner: true, bigBody: true });
  route('DELETE', '/api/owner/brand/:slot', async ({ req, user, params }) => {
    requirePanel(req, user);
    if (!BRAND_SLOTS[params.slot]) throw httpErr(404, 'অজানা জায়গা');
    const b = { ...(await brand()) };
    const old = b[params.slot]?.key;
    delete b[params.slot];
    await setSetting('brand', b);
    if (old) await storage.remove(old).catch(() => {});
    activity(user.id, 'brand_reset', params.slot);
    return { ok: true };
  }, { owner: true });
  // ব্যাকগ্রাউন্ডসহ ছবি হলে গোল ফ্রেমে দেখানো
  route('PUT', '/api/owner/brand-options', async ({ req, user, body }) => {
    requirePanel(req, user);
    await setSetting('brand', { ...(await brand()), framed: Boolean(body.framed) });
    return { ok: true };
  }, { owner: true });
  // সবার জন্য (লগইন পাতাসহ): মালিকের দেওয়া ছবি, না থাকলে আসলটা
  const staticCache = new Map();
  route('GET', '/api/brand/:slot', async ({ req, res, params }) => {
    const file = BRAND_SLOTS[params.slot];
    if (!file) throw httpErr(404, 'পাওয়া যায়নি');
    const o = (await brand())[params.slot];
    let buf, mime, etag;
    if (o) {
      try { buf = await storage.get(o.key); mime = o.mime; etag = `"b${o.v}"`; } catch { /* ফাইল না পেলে আসলটা */ }
    }
    if (!buf) {
      if (!staticCache.has(file)) staticCache.set(file, await fs.promises.readFile(path.join(PUBLIC_DIR, file)));
      buf = staticCache.get(file); mime = STATIC_MIME[path.extname(file)]; etag = `"s${buf.length}"`;
    }
    const headers = { 'content-type': mime, etag, 'cache-control': 'public, max-age=60', 'content-length': buf.length };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    res.end(buf);
  }, { public: true, raw: true });

  route('DELETE', '/api/owner/allowed/:email', async ({ req, user, params }) => {
    requirePanel(req, user);
    const email = decodeURIComponent(params.email).toLowerCase();
    await db.run('DELETE FROM allowed WHERE email=?', email);
    userCache.clear();
    activity(user.id, 'allow_remove', email);
    return { ok: true };
  }, { owner: true });

  /* ---------------- অ্যাডমিন (মালিকসহ): ছোট কাজ ---------------- */
  route('GET', '/api/staff/jobs', async () => ({
    jobs: (await db.all(`SELECT j.id,j.kind,j.status,j.label,j.created,j.started,u.email FROM jobs j LEFT JOIN users u ON u.id=j.uid
      WHERE j.status IN ('queued','running') ORDER BY j.created LIMIT 200`)).map(j => ({ ...j, created: Number(j.created), started: Number(j.started) || null })),
  }), { staff: true });
  route('POST', '/api/staff/jobs/:id/cancel', async ({ user, params }) => {
    const j = await db.get('SELECT j.*, u.email FROM jobs j LEFT JOIN users u ON u.id=j.uid WHERE j.id=?', params.id);
    if (!j || !['queued', 'running'].includes(j.status)) throw httpErr(404, 'চলমান কাজ পাওয়া যায়নি');
    await db.run("UPDATE jobs SET status='cancelled', error='অ্যাডমিন বাতিল করেছেন', worker=NULL, lease_until=NULL, finished=?, updated=? WHERE id=? AND status IN ('queued','running')", now(), now(), j.id);
    activity(user.id, 'staff_cancel_job', j.email, j.label);
    return { ok: true };
  }, { staff: true });

  /* ---------------- অভিযোগ ও সাহায্য ---------------- */
  async function thread(c) {
    const msgs = await db.all('SELECT id,by_staff,text,created FROM complaint_msgs WHERE complaint_id=? ORDER BY created, id', c.id);
    return { id: c.id, category: c.category, subject: c.subject, status: c.status, created: Number(c.created), updated: Number(c.updated),
      messages: msgs.map(m => ({ id: m.id, staff: Boolean(Number(m.by_staff)), text: m.text, created: Number(m.created) })) };
  }
  route('POST', '/api/complaints', async ({ user, body }) => {
    await rate('complaint:' + user.id, 6, 60 * 60e3, 'এক ঘণ্টায় অনেক অভিযোগ হয়েছে। পরে আবার চেষ্টা করো।');
    const subject = str(body.subject, 120), text = str(body.text, 4000);
    if (!subject || !text) throw httpErr(400, 'বিষয় আর বিস্তারিত দুটোই লেখো');
    const category = CATEGORIES.includes(body.category) ? body.category : 'other';
    const id = newId();
    await db.tx(async q => {
      await q.run('INSERT INTO complaints(id,uid,category,subject,status,created,updated,last_by) VALUES(?,?,?,?,?,?,?,?)', id, user.id, category, subject, 'open', now(), now(), 'user');
      await q.run('INSERT INTO complaint_msgs(id,complaint_id,uid,by_staff,text,created) VALUES(?,?,?,?,?,?)', newId(), id, user.id, 0, text, now());
    });
    activity(user.id, 'complaint_new', id, subject);
    return { id };
  });
  route('GET', '/api/complaints', async ({ user }) => {
    const rows = await db.all('SELECT * FROM complaints WHERE uid=? ORDER BY updated DESC LIMIT 50', user.id);
    return { complaints: await Promise.all(rows.map(thread)) };
  });
  route('POST', '/api/complaints/:id/reply', async ({ user, params, body }) => {
    const c = await db.get('SELECT * FROM complaints WHERE id=?', params.id);
    const staff = user.role === 'owner' || user.role === 'admin';
    if (!c || (c.uid !== user.id && !staff)) throw httpErr(404, 'অভিযোগ পাওয়া যায়নি');
    await rate('complaint_reply:' + user.id, 60, 60 * 60e3, 'অনেক উত্তর হয়েছে, একটু পরে আবার চেষ্টা করো।');
    const text = str(body.text, 4000);
    if (!text) throw httpErr(400, 'কিছু লেখো');
    const byStaff = staff && c.uid !== user.id;
    await db.run('INSERT INTO complaint_msgs(id,complaint_id,uid,by_staff,text,created) VALUES(?,?,?,?,?,?)', newId(), c.id, user.id, byStaff ? 1 : 0, text, now());
    // ব্যবহারকারী আবার লিখলে সমাধান হওয়া অভিযোগ আবার খোলে
    const status = byStaff ? (c.status === 'open' ? 'working' : c.status) : c.status === 'resolved' ? 'open' : c.status;
    await db.run('UPDATE complaints SET updated=?, last_by=?, status=? WHERE id=?', now(), byStaff ? 'staff' : 'user', status, c.id);
    if (byStaff) activity(user.id, 'complaint_reply', c.id);
    return { ok: true };
  });
  route('GET', '/api/staff/complaints', async ({ url }) => {
    const st = url.searchParams.get('status');
    const rows = await db.all(`SELECT c.*, u.email, COALESCE(u.display_name,u.name) AS uname FROM complaints c LEFT JOIN users u ON u.id=c.uid
      ${STATUSES.includes(st) ? 'WHERE c.status=?' : ''} ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'working' THEN 1 ELSE 2 END, c.updated DESC LIMIT 200`, ...(STATUSES.includes(st) ? [st] : []));
    const counts = Object.fromEntries((await db.all('SELECT status, COUNT(*) AS n FROM complaints GROUP BY status')).map(r => [r.status, Number(r.n)]));
    return { counts, complaints: await Promise.all(rows.map(async c => ({ ...(await thread(c)), email: c.email, name: c.uname, waiting: c.last_by === 'user' && c.status !== 'resolved' }))) };
  }, { staff: true });
  route('PATCH', '/api/staff/complaints/:id', async ({ user, params, body }) => {
    if (!STATUSES.includes(body.status)) throw httpErr(400, 'অবস্থা ঠিক নেই');
    const r = await db.run('UPDATE complaints SET status=?, updated=? WHERE id=?', body.status, now(), params.id);
    if (!r.changes) throw httpErr(404, 'অভিযোগ পাওয়া যায়নি');
    activity(user.id, 'complaint_status', params.id, body.status);
    return { ok: true };
  }, { staff: true });

  // সবার জন্য: যোগাযোগের তথ্য আর ঘোষণা (লগইন পাতাতেও যোগাযোগ দেখায়, যাতে আটকে যাওয়া মানুষ মালিককে পায়)
  async function publicInfo() {
    const b = await brand();
    return {
      guest: await guestEnabled(),
      contact: await contact(), announcement: await announcement(), texts: await texts(), layout: await layout(),
      brand: { framed: Boolean(b.framed), v: Object.fromEntries(Object.keys(BRAND_SLOTS).map(k => [k, b[k]?.v || 0])) },
    };
  }

  async function deleteUser(q, uid) {
    await q.run('DELETE FROM complaint_msgs WHERE complaint_id IN (SELECT id FROM complaints WHERE uid=?)', uid);
    await q.run('DELETE FROM complaints WHERE uid=?', uid);
  }

  return { roleOf, openSignup, publicInfo, panelState, deleteUser, maintenanceCheck, guestEnabled, blockGuest, purgeGuests, createGuest };
}

module.exports = { createControl, hashPanelPassword, panelVerifier, CONTACT_FIELDS, TOOL_IDS, BRAND_SLOTS };
