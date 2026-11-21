'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const media = id => `/media/${encodeURIComponent(id)}`;
// বাংলা অঙ্ক: ইংরেজি 8 আর বাংলা ৪ দেখতে একরকম, তাই সব সংখ্যা বাংলায় দেখানো হয়
const bn = x => (I18N.lang === 'en' ? String(x ?? '') : String(x ?? '').replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]));
const tr = s => I18N.tr(s); // JS-এ জোড়া লাগানো লেখার টুকরো অনুবাদ

const S = { me: null, lib: { folders: [], projects: [] }, pid: null, P: null, tab: 'studio', filter: 'all', q: '', open: {}, pollTimer: null, writing: false, trash: null, chat: null, chatBusy: false, chatPrompts: [], pickerOpen: false, view: null, pages: 1, cursor: null, admin: null, usage: null };
const freshComposer = () => ({ mode: 'video', prompt: '', chars: [], ings: [], first: null, last: null, aspect: '16:9', imgAspect: '1:1', duration: 8, resolution: '720p', camera: '', style: '', avoid: '', singleShot: false, count: 1, busy: false, expanded: false, imageModel: '' });
const IMAGE_MODEL_LABEL = { 'gemini-nano-banana-2.1': 'Nano Banana 2.1 (ভালো ও দ্রুত)', 'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite (সবচেয়ে সস্তা)', 'gemini-3-pro-image': 'Nano Banana Pro (সেরা মান)' };
const MODE_LABEL = { video: 'ভিডিও', frames: 'ফ্রেম→ভিডিও', image: 'ছবি' };
const CHAR_PRESETS = [
  ['রহস্যময় সাধু', 'বয়স্ক সাধু, লম্বা সাদা দাড়ি, গেরুয়া পোশাক, গভীর চোখ, হাতে জপমালা'],
  ['শহুরে পেশাজীবী', '৩০ বছরের নারী, কাঁধ পর্যন্ত কালো চুল, ধূসর ব্লেজার, পাতলা চশমা, আত্মবিশ্বাসী হাসি'],
  ['গ্রামের সরল ছেলে', '১৮ বছরের ছেলে, রোদে পোড়া ত্বক, চেক লুঙ্গি আর কাঁধে গামছা, খালি পা, সরল হাসি'],
  ['ঠান্ডা মাথার খলনায়ক', '৪৫ বছরের পুরুষ, কালো লম্বা কোট, গালে পুরনো কাটা দাগ, পরিপাটি পেছনে আঁচড়ানো চুল, ঠান্ডা চাহনি'],
  ['কল্পরাজ্যের রানি', 'রুপালি লম্বা চুল, মাথায় তারার মতো মুকুট, ঝলমলে নীল গাউন, শান্ত গম্ভীর মুখ'],
  ['রোবট সহকারী', 'মানুষের আকারের রোবট, সাদা-কমলা ধাতব শরীর, গোল মাথা, নীল আলোর চোখ, বন্ধুসুলভ ভঙ্গি'],
];
let C = freshComposer();

const CAMERAS = [
  ['', 'মডেল নিজে ঠিক করুক'], ['static locked-off shot', 'স্থির ক্যামেরা'], ['slow dolly in toward the subject', 'ধীরে কাছে যাওয়া'],
  ['slow dolly out away from the subject', 'ধীরে দূরে সরা'], ['smooth pan from left to right', 'বাঁ থেকে ডানে প্যান'], ['tilt up revealing the scene', 'নিচ থেকে উপরে'],
  ['slow orbit around the subject', 'চারপাশে ঘোরা'], ['aerial drone shot', 'ড্রোন শট'], ['handheld documentary style', 'হাতে ধরা ক্যামেরা'],
  ['tracking shot following the subject', 'পেছনে পেছনে চলা'], ['close-up on the face', 'মুখের ক্লোজ-আপ'], ['wide establishing shot', 'ওয়াইড শট'],
];
const STYLES = ['cinematic realistic film look', 'Pixar-like 3D animation', 'anime', 'watercolor illustration', 'black and white film noir', 'vintage 1990s Bengali film', 'claymation stop-motion'];

/* ---------- সাধারণ ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-cp': '1', 'x-lang': I18N.lang },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('লগইন লাগবে'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'কিছু একটা ভুল হয়েছে');
  return data;
}
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  const box = $('#toasts');
  box.appendChild(t);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => t.remove(), isErr ? 6000 : 2500);
}
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); }
}
function openModal(html, cls = '') { $('#modal').innerHTML = `<div class="modal" data-act="modal-bg"><div class="box ${cls}">${html}</div></div>`; }
function closeModal() { $('#modal').innerHTML = ''; S.pickerOpen = false; S.charEdit = null; }
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem('cp_theme', t) : localStorage.removeItem('cp_theme'); } catch { /* ব্রাউজার স্টোরেজ বন্ধ */ }
}
try { const t = localStorage.getItem('cp_theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* কিছু না */ }

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('ফাইল পড়া যায়নি'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('এটা ছবি মনে হচ্ছে না'));
      img.onload = () => {
        const max = 2048;
        if (img.width <= max && img.height <= max && file.size < 4e6) return resolve(fr.result);
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.9));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function squarePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('এটা ছবি মনে হচ্ছে না'));
    img.onload = () => {
      const side = Math.min(img.width, img.height), out = Math.min(512, side);
      const cv = document.createElement('canvas');
      cv.width = cv.height = out;
      const g = cv.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', 0.92));
    };
    img.src = URL.createObjectURL(file);
  });
}
function pickAnyImage() {
  return new Promise(resolve => {
    const inp = $('#fileIn');
    inp.value = '';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
function pickFile() {
  return new Promise(resolve => {
    const inp = $('#fileIn');
    inp.value = '';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
async function uploadImage(characterId) {
  const f = await pickFile();
  if (!f) return null;
  const dataUrl = await fileToDataUrl(f);
  return api('POST', `/api/projects/${S.pid}/upload`, { dataUrl, characterId, name: f.name });
}

// প্রম্পটের খসড়া প্রজেক্ট অনুযায়ী এই ব্রাউজারে জমা থাকে (পাতা বন্ধ হলেও হারায় না)
const draftKey = () => 'cp_draft_' + S.pid;
let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  const pid = S.pid, text = C.prompt;
  draftTimer = setTimeout(() => { try { text ? localStorage.setItem('cp_draft_' + pid, text) : localStorage.removeItem('cp_draft_' + pid); } catch { /* স্টোরেজ বন্ধ */ } }, 400);
}
function loadDraft() { try { return localStorage.getItem(draftKey()) || ''; } catch { return ''; } }
function clearDraft() { clearTimeout(draftTimer); try { localStorage.removeItem(draftKey()); } catch { /* কিছু না */ } }
// কত সময় ধরে চলছে: ১:০৫
function elapsed(since) {
  const s = Math.max(0, Math.floor((Date.now() - Number(since)) / 1000));
  return bn(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
}
setInterval(() => { document.querySelectorAll('[data-since]').forEach(el => { el.textContent = elapsed(el.dataset.since); }); }, 1000);
const fmtBytes = b => { const mb = Number(b) / 1048576; return mb >= 1024 ? bn((mb / 1024).toFixed(1)) + ' GB' : bn(mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB'; };
const fmtTime = t => new Date(Number(t)).toLocaleString(I18N.locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const taka = usd => '৳' + bn(Math.round(Number(usd) * (S.me?.pricing?.usdToBdt || 124)));
// অন্য ট্যাবে থাকলে কাজ শেষের খবর ব্রাউজার নোটিফিকেশনে
function notify(body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: '/icon-192.png', tag: 'ruvo-job' };
  try { new Notification('Ruvo', opts); } catch {
    navigator.serviceWorker?.ready.then(r => r.showNotification('Ruvo', opts)).catch(() => {});
  }
}

// মালিকের সাথে সরাসরি যোগাযোগ (কল টু অ্যাকশন): মালিক কন্ট্রোল প্যানেল থেকে যা বসান
function contactButtons(c, text = 'Ruvo অ্যাপ থেকে যোগাযোগ করছি') {
  if (!c) return '';
  const b = [];
  if (c.whatsapp) b.push(`<a class="cta wa" href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 WhatsApp</a>`);
  if (c.phone) b.push(`<a class="cta call" href="tel:${esc(c.phone)}">📞 কল করো</a>`);
  if (c.email) b.push(`<a class="cta mail" href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Ruvo')}">✉️ ইমেইল</a>`);
  if (c.facebook) b.push(`<a class="cta fb" href="${esc(c.facebook)}" target="_blank" rel="noopener">📘 Facebook</a>`);
  if (c.telegram) b.push(`<a class="cta tg" href="${esc(c.telegram)}" target="_blank" rel="noopener">✈️ Telegram</a>`);
  if (c.youtube) b.push(`<a class="cta yt" href="${esc(c.youtube)}" target="_blank" rel="noopener">▶️ YouTube</a>`);
  return b.length ? `<div class="ctas">${b.join('')}</div>${c.note ? `<p class="muted small" style="margin:8px 0 0">🕘 ${esc(c.note)}</p>` : ''}` : '';
}
const voiceDesc = v => (I18N.lang === 'en' ? v.trait : v.bn);
const ROLE_LABEL = { owner: '👑 মালিক', admin: '🛡️ অ্যাডমিন', user: 'সদস্য' };
// মালিকের দেওয়া ছবি/লোগো/লেখা: এক জায়গা থেকে বদলালে সব জায়গায়
const site = () => S.me?.site || {};
const brandUrl = slot => `/api/brand/${slot}?v=${site().brand?.v?.[slot] || 0}`;
const framed = () => (site().brand?.framed ? ' framed' : '');
const TEXT_DEFAULT = {
  tagline: I18N.t('ভাবো। বানাও। অনুপ্রাণিত করো।', 'Imagine. Create. Inspire.'),
  heroTitle: I18N.t('কল্পনাকে বাস্তবে রূপ দাও', 'Turn your imagination into reality'),
  heroButton: I18N.t('শুরু করো', 'Start creating'),
  loginLine: '',
  aboutText: I18N.t('ছবি, ভিডিও, কণ্ঠ আর গল্প — এক স্টুডিওতে। প্রতিটা দৃশ্যে চরিত্র থাকে একই।', 'Images, video, voice and stories in one studio, with characters that stay consistent in every scene.'),
  aboutTag: I18N.t('বড় স্বপ্ন দেখো, আরও বেশি বানাও', 'Dream big. Create more.'),
  creatorName: '', creatorTitle: '',
};
// মালিকের নিজের লেখা: বাংলায় লিখলে key, English-এ লিখলে key_en; না থাকলে ডিফল্ট
const txt = k => (I18N.lang === 'en' ? site().texts?.[k + '_en'] : site().texts?.[k]) || TEXT_DEFAULT[k] || '';
// হোমের সব বোতাম (মালিক সাজান): আইকন, নাম, রং
const TOOL_DEF = {
  image: ['🖼️', 'লেখা থেকে ছবি', 't-violet'], video: ['🎥', 'লেখা থেকে ভিডিও', 't-blue'], edit: ['✨', 'ছবি এডিট', 't-pink'],
  char: ['🧑', 'চরিত্র', 't-green'], doc: ['🎞️', 'ডকুমেন্টারি', 't-gold'], voice: ['🎙️', 'কণ্ঠ ও TTS', 't-cyan'],
  upload: ['⬆️', 'ছবি আপলোড', 't-blue'], story: ['📖', 'গল্প লেখো', 't-violet'], assistant: ['💬', 'সহকারী', 't-pink'],
  timeline: ['🎬', 'দৃশ্যক্রম', 't-gold'], avatar: ['🤳', 'আমার অবতার', 't-green'], help: ['🆘', 'সাহায্য', 't-cyan'],
};
const DEFAULT_LAYOUT = Object.keys(TOOL_DEF).map((id, i) => ({ id, hidden: i >= 6 }));
const currentLayout = () => (site().layout?.length ? site().layout : DEFAULT_LAYOUT).filter(t => TOOL_DEF[t.id]);
// পুরো পর্দার বার্তা: প্রতিটা নতুন বার্তা একবার
function showPopup(a) {
  let seen = '';
  try { seen = localStorage.getItem('cp_pop_seen') || ''; } catch { /* কিছু না */ }
  if (seen === String(a.at) || $('#modal').innerHTML) return;
  openModal(`<div class="popmsg ${a.level === 'warn' ? 'warn' : ''}"><div class="pm-icon" aria-hidden="true">${a.level === 'warn' ? '⚠️' : '📢'}</div>
    <h2>${a.level === 'warn' ? 'জরুরি বার্তা' : 'বার্তা'}</h2><p>${esc(a.text).replace(/\n/g, '<br>')}</p>
    <button class="pri" data-act="pop-ok" data-v="${esc(String(a.at))}">ঠিক আছে</button></div>`, 'popbox');
}
// রক্ষণাবেক্ষণ: সাধারণ ব্যবহারকারীর পুরো পর্দা ঢাকা (মালিক/অ্যাডমিন কাজ চালিয়ে যান)
function renderMaintenance(a) {
  let el = $('#maint');
  const on = a && a.mode === 'maintenance' && !S.me.user.staff;
  if (!on) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'maint'; el.className = 'maint'; document.body.appendChild(el); }
  el.innerHTML = `<div class="mt-box"><img src="${brandUrl('logo')}" alt=""><h2>রক্ষণাবেক্ষণ চলছে</h2><p>${esc(a.text).replace(/\n/g, '<br>')}</p>
    ${contactButtons(site().contact)}<button data-act="maint-retry">আবার দেখো</button></div>`;
}
function renderAnnounce() {
  const el = $('#announce');
  if (!el) return;
  const a = S.me?.site?.announcement;
  let hidden = '';
  try { hidden = localStorage.getItem('cp_ann_hide') || ''; } catch { /* কিছু না */ }
  renderMaintenance(a);
  if (a && a.mode === 'popup') { showPopup(a); el.hidden = true; return; }
  if (a && a.mode === 'maintenance' && !S.me.user.staff) { el.hidden = true; return; }
  if (!a || hidden === String(a.at)) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.className = 'announce ' + (a.level === 'warn' ? 'warn' : '');
  el.innerHTML = `<span aria-hidden="true">${a.level === 'warn' ? '⚠️' : '📢'}</span><span class="grow">${esc(a.text)}</span><button class="sm ghost" data-act="ann-hide" data-v="${esc(String(a.at))}" aria-label="লুকাও">✕</button>`;
}

/* ---------- ডেটা লোড ---------- */
async function loadLib() { S.lib = await api('GET', '/api/library'); }
async function loadProject() {
  if (!S.pid) { S.P = null; return; }
  const pid = S.pid;
  const P = await api('GET', `/api/projects/${pid}`);
  S.cursor = P.assetsCursor;
  // "আরও দেখাও" দিয়ে যতগুলো পাতা খোলা হয়েছিল, রিফ্রেশেও ততগুলো আনা হয় (নতুন ফাইল এলে পুরনোগুলো হারায় না)
  for (let i = 1; i < S.pages && P.assetsMore && S.cursor; i++) await morePage(P, pid);
  if (pid === S.pid) S.P = P;
}
async function morePage(P, pid) {
  const r = await api('GET', `/api/projects/${pid}/assets?before=${S.cursor.before}&beforeId=${encodeURIComponent(S.cursor.beforeId)}`);
  const have = new Set(P.assets.map(a => a.id));
  P.assets.push(...r.assets.filter(a => !have.has(a.id)));
  P.assetsMore = r.more; S.cursor = r.cursor;
}
function busyJobs() { return S.P ? S.P.jobs.filter(j => j.status === 'queued' || j.status === 'running') : []; }
function schedulePoll() {
  clearTimeout(S.pollTimer);
  if (busyJobs().length || S.writing) S.pollTimer = setTimeout(poll, 5000);
}
async function poll() {
  if (!S.pid) return;
  const before = new Set(busyJobs().map(j => j.id));
  try { await loadProject(); } catch { /* পরের বার আবার চেষ্টা */ }
  const done = S.P ? S.P.jobs.filter(j => before.has(j.id) && j.status !== 'queued' && j.status !== 'running') : [];
  for (const j of done) {
    const msg = j.status === 'done' ? `তৈরি হয়েছে: ${j.label}` : `ব্যর্থ: ${j.error || j.label}`;
    toast(msg, j.status !== 'done');
    notify(msg);
  }
  if (done.length) loadLib().then(renderSide).catch(() => {});
  renderLive();
  schedulePoll();
}

/* ---------- রেন্ডার: কাঠামো ---------- */
function render() {
  renderTop();
  renderSide();
  renderMain();
}
// হেডার আর শুরুর পর্দার লোগো/ছবি/লেখা মালিকের দেওয়াটায়
function applyBrand() {
  const lb = $('#langBtn');
  if (lb) lb.textContent = '🌐 ' + (I18N.lang === 'en' ? 'বাং' : 'EN');
  const logo = document.querySelector('.brand img');
  if (logo && S.me) logo.src = brandUrl('logo');
  const sp = $('#splash .sp-owner');
  if (sp && S.me) { sp.src = brandUrl('owner-sm'); sp.classList.toggle('framed', Boolean(site().brand?.framed)); }
  const tag = $('#spTag');
  if (tag && S.me) tag.textContent = txt('tagline');
}
function renderGuestBar() {
  const el = $('#guestbar');
  if (!el) return;
  const g = S.me?.user?.role === 'guest';
  el.hidden = !g;
  el.innerHTML = g ? `<span aria-hidden="true">👀</span><span class="grow">অতিথি হিসেবে ঘুরে দেখছ। বানাতে Gmail দিয়ে ঢোকো।</span><button class="sm gold" data-act="guest-upgrade">Gmail দিয়ে ঢোকো</button>` : '';
}
function renderTop() {
  applyBrand();
  renderGuestBar();
  renderAnnounce();
  const me = S.me?.user;
  $('#avatar').innerHTML = me?.picture ? `<img src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">` : esc((me?.name || '?').slice(0, 1));
  const p = S.P?.project;
  const folder = p && S.lib.folders.find(f => f.id === p.folder_id);
  $('#crumb').textContent = p ? `${folder ? folder.name + ' / ' : ''}${p.name}` : '';
}
function renderSide() {
  const { folders, projects } = S.lib;
  const item = p => `<button class="navitem ${p.id === S.pid ? 'on' : ''}" data-act="open-project" data-id="${p.id}">🎬 <span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span><span class="cnt">${bn(p.assets)}</span></button>`;
  let html = `<div class="row" style="margin-bottom:6px"><button class="pri grow" data-act="new-project">+ নতুন প্রজেক্ট</button><button data-act="new-folder" title="নতুন ফোল্ডার">📁+</button></div>
    <button class="navitem ${!S.pid && !S.view ? 'on' : ''}" data-act="home">🏠 সব প্রজেক্ট</button>
    <button class="navitem ${S.view === 'account' ? 'on' : ''}" data-act="account">👤 অ্যাকাউন্ট ও ব্যবহার</button>
    <button class="navitem ${S.view === 'doc' ? 'on' : ''}" data-act="doc">🎞️ ডকুমেন্টারি স্টুডিও</button>
    <button class="navitem ${S.view === 'help' ? 'on' : ''}" data-act="help">💬 সাহায্য ও যোগাযোগ</button>
    <button class="navitem ${S.view === 'about' ? 'on' : ''}" data-act="about">ℹ️ Ruvo সম্পর্কে</button>
    ${S.me?.user?.staff ? `<button class="navitem ${S.view === 'admin' ? 'on' : ''}" data-act="admin">🛡️ অ্যাডমিন</button>` : ''}
    ${S.me?.user?.owner ? `<button class="navitem ${S.view === 'panel' ? 'on' : ''}" data-act="owner-panel">🔐 মালিকের কন্ট্রোল</button>` : ''}<h4>ফোল্ডার</h4>`;
  if (!folders.length) html += '<p class="muted small" style="margin:0 8px">কোনো ফোল্ডার নেই</p>';
  for (const f of folders) {
    const inside = projects.filter(p => p.folder_id === f.id);
    const open = S.open[f.id] ?? true;
    html += `<button class="navitem" data-act="toggle-folder" data-id="${f.id}">${open ? '▾' : '▸'} 📁 <span class="grow">${esc(f.name)}</span><span class="cnt">${bn(inside.length)}</span></button>`;
    if (open) html += `<div class="folder-projects">${inside.map(item).join('') || '<p class="muted small" style="margin:4px 8px">খালি</p>'}</div>`;
  }
  const loose = projects.filter(p => !p.folder_id);
  html += `<h4>ফোল্ডার ছাড়া</h4>${loose.map(item).join('') || '<p class="muted small" style="margin:0 8px">নেই</p>'}`;
  $('#side').innerHTML = html;
}
function renderMain() {
  document.body.dataset.view = S.view || (S.pid ? 'project' : 'home');
  if (S.view === 'account') return renderAccount();
  if (S.view === 'admin') return renderAdmin();
  if (S.view === 'about' || S.view === 'help' || S.view === 'panel' || !S.view) applyBrand();
  if (S.view === 'doc') return renderDoc();
  if (S.view === 'about') return renderAbout();
  if (S.view === 'help') return renderHelp();
  if (S.view === 'panel') return renderPanel();
  if (!S.pid || !S.P) return renderHome();
  const t = S.tab;
  const tabs = [['studio', '🎥 তৈরি'], ['characters', '🧑 চরিত্র'], ['timeline', '🎞️ দৃশ্যক্রম'], ['story', '📖 গল্প'], ['assistant', '💬 সহকারী']];
  $('#main').innerHTML = `
    <div class="row" style="margin-bottom:10px"><h2 class="grow" style="margin:0">${esc(S.P.project.name)}</h2>
      <a class="btn sm" href="/api/projects/${S.P.project.id}/export" download title="সব ফাইল একটা ZIP-এ">⬇️ ZIP</a>
      <button class="sm" data-act="project-menu">⋯ প্রজেক্ট</button></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${t === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</nav>
    <div id="tabBody"></div>`;
  ({ studio: renderStudio, characters: renderCharacters, timeline: renderTimeline, story: renderStory, assistant: renderAssistant })[t]();
}
// জব শেষ হলে শুধু যে অংশ বদলায় সেটুকু আঁকা, যাতে লেখার ঘরের লেখা না মুছে যায়
function renderLive() {
  if (!S.P) return;
  if (S.tab === 'studio') { renderJobs(); renderFilters(); renderGallery(); renderComposerChars(); renderFrames(); }
  if (S.tab === 'characters' || S.charEdit) renderCharGrid();
  if (S.tab === 'timeline') renderTimeline();
}

/* ---------- হোম ---------- */
function installCard() {
  let hide = '';
  try { hide = localStorage.getItem('cp_inst_hide') || ''; } catch { /* কিছু না */ }
  if (hide || matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
  return `<div class="installcard"><img src="${brandUrl('icon-192')}" alt=""><div class="grow"><b>📲 ফোনে অ্যাপ ইনস্টল করো</b></div>
    <button class="gold sm" data-act="install">ইনস্টল</button><button class="sm ghost" data-act="inst-hide" aria-label="লুকাও">✕</button></div>`;
}
function heroHtml() {
  const me = S.me.user;
  const first = esc(String(me.name || '').split(/\s+/)[0] || 'বন্ধু');
  // মালিক নিজের ছবি দেখেন; অন্যরা দেখেন লোগোর আভা
  const art = me.owner ? `<img class="h-owner${framed()}" src="${brandUrl('owner-sm')}" alt="" loading="eager">` : `<img class="h-logo" src="${brandUrl('logo')}" alt="">`;
  return `<section class="hero2">
    <div class="h-text"><p class="hi">${esc(I18N.greet(first))}</p><h2>${esc(txt('heroTitle'))}</h2>
      <button class="gold h-go" data-act="tool" data-v="video">${esc(txt('heroButton'))} ›</button></div>
    <div class="h-art" aria-hidden="true"><div class="h-ring"></div>${art}</div>
  </section>
  ${installCard()}
  <div class="tools">${currentLayout().filter(t => !t.hidden).map(t => { const [i, l, c] = TOOL_DEF[t.id]; return `<button class="toolbtn ${c}" data-act="tool" data-v="${t.id}"><span class="ti">${i}</span>${esc(t.label || l)}</button>`; }).join('')}</div>`;
}
// টুলে চাপলে: সর্বশেষ প্রজেক্ট খোলে (না থাকলে একটা বানায়), তারপর সেই কাজের জায়গায় নিয়ে যায়
async function ensureProject() {
  if (S.pid && S.P) return;
  let id = S.lib.projects[0]?.id;
  if (!id) { id = (await api('POST', '/api/projects', { name: 'আমার প্রথম প্রজেক্ট' })).id; await loadLib(); }
  await openProject(id);
}

function renderHome() {
  const { folders, projects } = S.lib;
  const card = p => `<div class="card pcard" data-act="open-project" data-id="${p.id}">
      <div class="cover">${p.cover ? `<img src="${media(p.cover)}" alt="" loading="lazy">` : '🎬'}</div>
      <div class="info"><b>${esc(p.name)}</b><div class="muted small">${bn(p.assets)}টি ফাইল · ${bn(p.characters)} চরিত্র</div></div></div>`;
  let html = heroHtml() + `<div class="row" style="margin:22px 0 14px"><h2 class="grow" style="margin:0">সব প্রজেক্ট</h2>
    <button data-act="new-folder">📁 নতুন ফোল্ডার</button><button class="pri" data-act="new-project">+ নতুন প্রজেক্ট</button></div>`;
  if (!S.me.configured) html += `<div class="card" style="border-color:var(--bad);margin-bottom:14px">সার্ভারে GEMINI_API_KEY বসানো নেই। ভিডিও বা ছবি বানানো যাবে না।</div>`;
  if (!projects.length) {
    html += `<div class="onboard card"><h3>তিন ধাপে প্রথম ভিডিও</h3>
      <ol class="steps">
        <li><b>প্রজেক্ট বানাও</b></li>
        <li><b>চরিত্র যোগ করো</b></li>
        <li><b>লিখে বানাও</b></li>
      </ol>
      <button class="pri" data-act="new-project">+ প্রথম প্রজেক্ট বানাও</button></div>`;
  }
  for (const f of folders) {
    const inside = projects.filter(p => p.folder_id === f.id);
    html += `<div class="row" style="margin:18px 0 8px"><h3 class="grow" style="margin:0">📁 ${esc(f.name)}</h3>
      <button class="sm" data-act="rename-folder" data-id="${f.id}">নাম বদলাও</button><button class="sm bad" data-act="del-folder" data-id="${f.id}">মুছো</button></div>
      <div class="grid">${inside.map(card).join('') || '<p class="muted small">খালি</p>'}</div>`;
  }
  const loose = projects.filter(p => !p.folder_id);
  if (loose.length) html += `<h3 style="margin:18px 0 8px">ফোল্ডার ছাড়া</h3><div class="grid">${loose.map(card).join('')}</div>`;
  $('#main').innerHTML = html;
}

/* ---------- স্টুডিও ---------- */
function renderStudio() {
  $('#tabBody').innerHTML = `<div class="studio">
    <section class="galwrap"><div id="jobs"></div>
      <input id="gSearch" data-g="q" placeholder="🔍 খোঁজো: শিরোনাম বা প্রম্পট" value="${esc(S.q)}" style="margin-bottom:8px">
      <div class="filters" id="filters"></div>
      <div id="gal"></div></section>
    <section class="composer card ${C.expanded ? 'open' : ''}" id="composer" aria-label="তৈরির ঘর"></section></div>`;
  renderComposer();
  renderJobs();
  renderFilters();
  renderGallery();
}
function renderFilters() {
  const el = $('#filters');
  if (!el) return;
  const col = S.P.collections.find(c => S.filter === 'col:' + c.id);
  el.innerHTML = [['all', 'সব'], ['video', 'ভিডিও'], ['image', 'ছবি'], ['fav', '★ পছন্দ'], ['upload', '⬆️ আপলোড']]
    .map(([k, l]) => `<button class="sm ${S.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')
    + S.P.collections.map(c => `<button class="sm ${S.filter === 'col:' + c.id ? 'on' : ''}" data-act="filter" data-v="col:${c.id}">📁 ${esc(c.name)} <span class="muted">${bn(c.items.length)}</span></button>`).join('')
    + `<button class="sm ghost" data-act="new-collection">+ কালেকশন</button>`
    + `<button class="sm ${S.filter === 'trash' ? 'on' : ''}" data-act="filter" data-v="trash">🗑 ট্র্যাশ${S.P.trashCount ? ' ' + bn(S.P.trashCount) : ''}</button>`
    + (col ? `<span class="grow"></span><button class="sm ghost" data-act="col-rename" data-id="${col.id}">✏️ নাম</button><button class="sm ghost bad" data-act="col-del" data-id="${col.id}">কালেকশন মুছো</button>` : '');
}
function summaryText() {
  const vid = C.mode !== 'image';
  return [MODE_LABEL[C.mode], vid ? C.resolution : '', vid ? bn(C.duration) + ' সে.' : '', bn(vid ? C.aspect : C.imgAspect), '×' + bn(C.count)].filter(Boolean).join(' · ');
}
function costLine() {
  const pr = S.me.pricing || {};
  const usd = C.mode === 'image' ? (pr.imageUsd || 0) * C.count : (pr.videoUsdPerSec || 0) * C.duration * C.count;
  if (!usd) return '';
  return `আনুমানিক খরচ ~৳${bn(Math.round(usd * (pr.usdToBdt || 124)))} ($${usd.toFixed(2)})`;
}
function renderComposer() {
  const el = $('#composer');
  if (!el) return;
  const m = C.mode;
  const vid = m !== 'image';
  const maxDur = m === 'frames' && C.last ? 10 : 15;
  if (C.duration > maxDur) C.duration = maxDur;
  el.classList.toggle('open', C.expanded);
  el.innerHTML = `
    <div class="adv advtop"><div class="row"><b class="grow">সেটিং</b><button class="sm ghost" data-act="toggle-composer" aria-label="সেটিং বন্ধ করো">✕</button></div></div>
    ${m === 'frames' ? '<div class="frames" id="frames" style="margin-bottom:8px"></div>' : '<div class="ings" id="ings"></div>'}
    <textarea id="cPrompt" data-c="prompt" rows="3" aria-label="${m === 'frames' ? 'ছবি থেকে কী ঘটবে' : 'কী বানাতে চাও'} (চরিত্রের নাম @ দিয়ে লেখো)" placeholder="${m === 'image' ? 'যেমন: গ্রামের নদীর ঘাটে সূর্যাস্ত, নৌকায় @রাজু বসে আছে' : 'যেমন: বৃষ্টির রাতে @রাজু আর @মিতু ছাতা হাতে হাঁটছে, দূরে বাজ পড়ে'}">${esc(C.prompt)}</textarea>
    <div class="adv">
      ${m === 'frames' ? '' : `<label class="lab">চরিত্র ${m === 'video' ? '(সর্বোচ্চ ২ জন)' : '(সর্বোচ্চ ৪ জন)'}</label><div class="chips" id="cchips"></div>`}
      <div class="set2">
        <div><label class="lab">আকার</label><select data-c="${vid ? 'aspect' : 'imgAspect'}">${(vid ? [['16:9', '১৬:৯ চওড়া'], ['9:16', '৯:১৬ লম্বা (রিলস)']] : [['1:1', '১:১ বর্গ'], ['16:9', '১৬:৯'], ['9:16', '৯:১৬'], ['4:3', '৪:৩'], ['3:4', '৩:৪']]).map(([v, l]) => `<option value="${v}" ${(vid ? C.aspect : C.imgAspect) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label class="lab">কয়টা</label><select data-c="count">${[1, 2, 3, 4].map(n => `<option value="${n}" ${C.count == n ? 'selected' : ''}>${bn(n)}টি</option>`).join('')}</select></div>
      </div>
      ${vid ? `<label class="lab">দৈর্ঘ্য: <b id="durLab">${bn(C.duration)}</b> সেকেন্ড</label>
        <input type="range" min="3" max="${maxDur}" step="1" value="${C.duration}" data-c="duration" style="padding:0">
        <div class="set2"><div><label class="lab">মান</label><select data-c="resolution">${[['360p', '360p (দ্রুত, সস্তা)'], ['720p', '720p'], ['1080p', '1080p']].map(([v, l]) => `<option value="${v}" ${C.resolution === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label class="lab">ক্যামেরা</label><select data-c="camera">${CAMERAS.map(([v, l]) => `<option value="${esc(v)}" ${C.camera === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>`
      : `<label class="lab">ছবির মডেল</label><select data-c="imageModel">${S.me.imageModels.map(v => `<option value="${esc(v)}" ${C.imageModel === v ? 'selected' : ''}>${esc(IMAGE_MODEL_LABEL[v] || v)}</option>`).join('')}</select>`}
      <details class="more"><summary>আরও সেটিং</summary>
        <label class="lab">স্টাইল</label><input data-c="style" list="styleList" value="${esc(C.style)}" placeholder="যেমন: cinematic realistic film look">
        <datalist id="styleList">${STYLES.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <label class="lab">যা চাই না</label><input data-c="avoid" value="${esc(C.avoid)}" placeholder="যেমন: লেখা, বাড়তি মানুষ">
        ${vid ? `<label class="row" style="margin-top:10px"><input type="checkbox" data-c="singleShot" ${C.singleShot ? 'checked' : ''} style="width:auto"> এক টানা শট, মাঝে কাট নেই</label>` : ''}
      </details>
    </div>
    <p class="muted small adv" style="margin:10px 0 0">${[costLine(), usageLine()].filter(Boolean).join(' · ')}</p>
    <div class="cfoot">
      <div class="seg" role="group" aria-label="কী বানাবে">${[['video', '🎥', 'ভিডিও'], ['frames', '🖼️→🎥', 'ফ্রেম'], ['image', '🖼️', 'ছবি']].map(([k, i, l]) => `<button class="${m === k ? 'on' : ''}" data-act="mode" data-v="${k}" aria-pressed="${m === k}">${i} ${l}</button>`).join('')}</div>
      <button class="sm summary" data-act="toggle-composer" aria-expanded="${C.expanded}" title="সেটিং">${C.expanded ? '▾' : '⚙️'} ${summaryText()}</button>
      <button class="enh" data-act="enhance" ${C.busy ? 'disabled' : ''} title="প্রম্পট উন্নত করো: বাংলা আইডিয়াকে বিস্তারিত ইংরেজি প্রম্পটে বদলায়" aria-label="প্রম্পট উন্নত করো">✨</button>
      <button class="pri gen" data-act="generate" ${C.busy ? 'disabled' : ''}>${C.busy ? 'পাঠানো হচ্ছে...' : m === 'image' ? 'ছবি বানাও' : 'ভিডিও বানাও'}</button></div>`;
  renderComposerChars();
  renderFrames();
}
function usageLine() {
  const u = S.me.usage, l = S.me.limits;
  if (!l) return `আজ বানানো: ${bn(u.video)}টি ভিডিও, ${bn(u.image)}টি ছবি`;
  return `আজকের সীমা: ভিডিও ${bn(u.video)}/${bn(l.video)}, ছবি ${bn(u.image)}/${bn(l.image)}`;
}
// ভিডিওতে সব মিলিয়ে ৬টি, ছবিতে ১৪টি রেফারেন্স ছবি যায়
function refCount(chars, ings) {
  const per = C.mode === 'image' ? 2 : 3;
  return chars.reduce((s, id) => s + Math.min(per, S.P.characters.find(c => c.id === id)?.images.length || 0), 0) + ings.length;
}
function renderComposerChars() {
  const chars = S.P.characters;
  C.chars = C.chars.filter(id => chars.some(c => c.id === id));
  C.ings = C.ings.filter(id => S.P.assets.some(a => a.id === id && a.kind === 'image'));
  const el = $('#cchips');
  if (el) {
    el.innerHTML = chars.length
      ? chars.map(c => `<span class="chip ${C.chars.includes(c.id) ? 'on' : ''}" data-act="toggle-char" data-id="${c.id}" title="${c.images.length ? bn(c.images.length) + 'টি রেফারেন্স ছবি' : 'রেফারেন্স ছবি নেই'}">
          <span class="th">${c.images[0] ? `<img src="${media(c.images[0])}" alt="">` : '🧑'}</span>${esc(c.name)}${c.images.length ? '' : ' ⚠️'}</span>`).join('')
      : '<span class="muted small">এখনো চরিত্র নেই। "চরিত্র" ট্যাবে বানাও।</span>';
  }
  const ing = $('#ings');
  if (ing) {
    const sel = [
      ...C.chars.map(id => {
        const c = chars.find(x => x.id === id);
        return `<span class="ing">${c.images[0] ? `<img src="${media(c.images[0])}" alt="">` : '🧑'}<b>${esc(c.name)}</b><button class="x" data-act="toggle-char" data-id="${id}" aria-label="সরাও">✕</button></span>`;
      }),
      ...C.ings.map(id => {
        const a = S.P.assets.find(x => x.id === id);
        return `<span class="ing"><img src="${media(id)}" alt=""><b>${esc(a?.title || 'ছবি')}</b><button class="x" data-act="toggle-ing" data-id="${id}" aria-label="সরাও">✕</button></span>`;
      }),
    ];
    ing.innerHTML = sel.join('') + `<button class="sm ing-add" data-act="pick-ings">+ উপকরণ${sel.length ? ` (${bn(refCount(C.chars, C.ings))}/${bn(C.mode === 'image' ? 14 : 6)})` : ''}</button>`;
  }
}
function openIngPicker() {
  S.pickerOpen = true;
  const imgs = S.P.assets.filter(a => a.kind === 'image' && !a.character_id);
  openModal(`<div class="row" style="padding:14px 14px 0"><h3 class="grow" style="margin:0">উপকরণ বেছে নাও</h3>
      <button class="sm" data-act="upload-ing">⬆️ আপলোড</button><button class="sm pri" data-act="close-ings">হয়ে গেছে</button></div>
    <p class="muted small" style="margin:6px 14px 0">${bn(refCount(C.chars, C.ings))}/${bn(C.mode === 'image' ? 14 : 6)}</p>
    <h4 style="margin:12px 14px 6px">চরিত্র</h4>
    <div class="chips" style="padding:0 14px">${S.P.characters.map(c => `<span class="chip ${C.chars.includes(c.id) ? 'on' : ''}" data-act="toggle-char" data-id="${c.id}"><span class="th">${c.images[0] ? `<img src="${media(c.images[0])}" alt="">` : '🧑'}</span>${esc(c.name)}</span>`).join('') || '<span class="muted small">চরিত্র নেই</span>'}</div>
    <h4 style="margin:12px 14px 0">ছবি</h4>
    <div class="picker">${imgs.map(a => `<div class="tile ${C.ings.includes(a.id) ? 'sel' : ''}" data-act="toggle-ing" data-id="${a.id}"><img src="${media(a.id)}" alt="" loading="lazy">${C.ings.includes(a.id) ? '<span class="badge">✓</span>' : ''}<div class="cap">${esc(a.title || a.prompt)}</div></div>`).join('') || '<p class="muted">এই প্রজেক্টে কোনো ছবি নেই। আপলোড করো বা "ছবি" মোডে বানাও।</p>'}</div>`);
}
function renderFrames() {
  const el = $('#frames');
  if (!el) return;
  const slot = (key, label) => {
    const id = C[key];
    const ok = id && S.P.assets.some(a => a.id === id);
    if (!ok) C[key] = null;
    return `<div class="slot" data-act="pick-frame" data-v="${key}">${ok ? `<img src="${media(id)}" alt=""><button class="sm x" data-act="clear-frame" data-v="${key}">✕</button>` : label}</div>`;
  };
  el.innerHTML = slot('first', '➕ শুরুর ছবি<br><span class="small">(দরকারি)</span>') + slot('last', '➕ শেষের ছবি<br><span class="small">(ঐচ্ছিক)</span>');
}
function renderJobs() {
  const el = $('#jobs');
  if (!el) return;
  const jobs = S.P.jobs.filter(j => j.status !== 'done');
  el.innerHTML = jobs.map(j => j.status === 'failed'
    ? `<div class="job failed" role="status"><span aria-hidden="true">⚠️</span><div class="grow"><b>${esc(j.label)}</b><div class="small err-text">${esc(j.error)}</div></div>
        <button class="sm" data-act="retry-job" data-id="${j.id}">↻ আবার চেষ্টা</button><button class="sm ghost" data-act="dismiss-job" data-id="${j.id}" aria-label="সরাও">✕</button></div>`
    : `<div class="job" role="status"><span class="spin" aria-hidden="true"></span><div class="grow"><b>${esc(j.label)}</b><div class="muted small">${j.status === 'queued' ? 'সারিতে অপেক্ষা করছে' : j.kind === 'video' ? 'ভিডিও তৈরি হচ্ছে, কয়েক মিনিট লাগতে পারে' : 'ছবি তৈরি হচ্ছে'} · <span class="tnum" data-since="${j.started || j.created}">${elapsed(j.started || j.created)}</span></div></div>
        <button class="sm ghost" data-act="cancel-job" data-id="${j.id}">বাতিল</button></div>`).join('');
}
function tileHtml(a) {
  const portrait = (a.meta?.aspect === '9:16' || a.meta?.aspect === '3:4');
  const badge = a.kind === 'video' ? `🎥 ${a.meta?.duration ? bn(a.meta.duration) + ' সে.' : ''}` : '🖼️';
  const body = a.kind === 'video'
    ? `<video src="${media(a.id)}#t=0.1" preload="metadata" muted playsinline loop></video>`
    : `<img src="${media(a.id)}" alt="" loading="lazy">`;
  return `<div class="tile ${portrait ? 'portrait' : ''}" data-act="view" data-id="${a.id}">${body}<span class="badge">${badge}</span>${a.favorite ? '<span class="fav">★</span>' : ''}<div class="cap">${esc(a.title || a.prompt)}</div></div>`;
}
function renderGallery() {
  const el = $('#gal');
  if (!el) return;
  if (S.filter === 'trash') return renderTrash(el);
  let list = S.P.assets.filter(a => !a.character_id);
  if (S.filter === 'video') list = list.filter(a => a.kind === 'video');
  if (S.filter === 'image') list = list.filter(a => a.kind === 'image');
  if (S.filter === 'fav') list = list.filter(a => a.favorite);
  if (S.filter === 'upload') list = list.filter(a => a.mode === 'upload' || a.mode === 'crop');
  if (S.filter.startsWith('col:')) {
    const c = S.P.collections.find(x => 'col:' + x.id === S.filter);
    list = c ? list.filter(a => c.items.includes(a.id)) : [];
  }
  const qq = S.q.trim().toLowerCase();
  if (qq) list = list.filter(a => `${a.title || ''} ${a.prompt || ''}`.toLowerCase().includes(qq));
  const more = S.P.assetsMore ? `<div class="more-row"><button data-act="load-more">আরও পুরনো ফাইল দেখাও</button></div>` : '';
  el.innerHTML = list.length ? `<div class="gal">${list.map(tileHtml).join('')}</div>${more}`
    : (qq || S.filter !== 'all') ? '<div class="empty">কিছু পাওয়া যায়নি।</div>' + more
    : `<div class="empty"><div style="font-size:36px">✨</div><p>নিচের ঘরে লিখে শুরু করো</p></div>`;
}
async function loadTrash() {
  try { S.trash = await api('GET', `/api/projects/${S.pid}/trash`); } catch (e) { toast(e.message, true); S.trash = { days: 30, assets: [] }; }
  renderGallery();
}
function renderTrash(el) {
  if (!S.trash) { el.innerHTML = '<p class="muted">লোড হচ্ছে...</p>'; loadTrash(); return; }
  const list = S.trash.assets;
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted small grow">ট্র্যাশের ফাইল ${bn(S.trash.days)} দিন পর নিজে থেকেই স্থায়ীভাবে মুছে যায়।</span>
      ${list.length ? '<button class="sm bad" data-act="empty-trash">ট্র্যাশ খালি করো</button>' : ''}</div>`
    + (list.length ? `<div class="gal">${list.map(a => `<div class="tile" style="cursor:default">
        ${a.kind === 'video' ? `<video src="${media(a.id)}#t=0.1" preload="metadata" muted playsinline></video>` : `<img src="${media(a.id)}" alt="" loading="lazy">`}
        <div class="tact"><button class="sm" data-act="restore" data-id="${a.id}">↺ ফেরত</button><button class="sm bad" data-act="purge" data-id="${a.id}">চিরতরে মুছো</button></div>
        <div class="cap">${esc(a.title || a.prompt)}</div></div>`).join('')}</div>` : '<div class="empty">ট্র্যাশ খালি।</div>');
}

/* ---------- ভিউয়ার (একটা ফাইল খুললে) ---------- */
// একটা ফাইলের সব ভার্সন: মূল ফাইল আর তা থেকে বদলানো/বাড়ানো সব
function family(a) {
  const byId = new Map(S.P.assets.map(x => [x.id, x]));
  let root = a;
  const seen = new Set();
  while (root.parent_id && byId.has(root.parent_id) && !seen.has(root.id)) { seen.add(root.id); root = byId.get(root.parent_id); }
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const x of S.P.assets) if (x.parent_id === out[i].id && !out.includes(x)) out.push(x);
  return out.sort((x, y) => x.created - y.created);
}
function viewAsset(id, panel = '') {
  const a = S.P.assets.find(x => x.id === id);
  if (!a) return closeModal();
  S.viewPanel = panel;
  const fam = family(a);
  const m = a.meta || {};
  const isV = a.kind === 'video';
  const info = [m.aspect && bn(m.aspect), m.duration && bn(m.duration) + ' সেকেন্ড', m.resolution, m.size, m.characterNames?.length && 'চরিত্র: ' + m.characterNames.join(', ')].filter(Boolean).join(' · ');
  const inClips = S.P.clips.includes(a.id);
  const btn = (act, icon, label, extra = '') => `<button class="sm" data-act="${act}" data-id="${a.id}" ${extra}>${icon} ${label}</button>`;
  let form = '';
  if (panel === 'extend') form = `<label class="lab">এরপর কী ঘটবে (ফাঁকা রাখলে স্বাভাবিকভাবে চলবে)</label><textarea id="rxText" rows="3"></textarea>
    <label class="lab">কত সেকেন্ড বাড়বে</label><select id="rxDur">${[4, 6, 8, 10].map(n => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${bn(n)} সেকেন্ড</option>`).join('')}</select>
    <button class="pri" style="margin-top:8px" data-act="remix" data-v="extend" data-id="${a.id}">➡️ বাড়াও</button>`;
  if (panel === 'edit') form = `<label class="lab">কী বদলাতে চাও (ছোট করে লেখো, যেমন: "আলো আরও নাটকীয় করো")</label><textarea id="rxText" rows="3"></textarea>
    ${isV ? '' : `<label class="lab">আকার</label><select id="rxAspect"><option value="">মূল আকার</option>${['16:9', '4:3', '1:1', '3:4', '9:16'].map(v => `<option value="${v}">${bn(v)}</option>`).join('')}</select>`}
    <button class="pri" style="margin-top:8px" data-act="remix" data-v="edit" data-id="${a.id}">✏️ বদলাও</button>`;
  if (panel === 'next') form = `<label class="lab">পরের দৃশ্যে কী হবে (একই চরিত্র থাকবে)</label><textarea id="rxText" rows="3"></textarea>
    <button class="pri" style="margin-top:8px" data-act="remix" data-v="next" data-id="${a.id}">⏭️ পরের দৃশ্য বানাও</button>`;
  if (panel === 'crop') form = `<label class="lab">কোন আকারে কাটবে (মাঝখান থেকে)। মূল ছবি থেকে যায়, কাটা ছবি নতুন ভার্সন হয়।</label>
    <div class="actions">${['16:9', '4:3', '1:1', '3:4', '9:16'].map(v => `<button class="sm" data-act="crop" data-id="${a.id}" data-v="${v}">${bn(v)}</button>`).join('')}</div>`;
  if (panel === 'upscale') form = `<label class="lab">বড় করা মানে AI দিয়ে বেশি রেজোলিউশনে নতুন করে বানানো, তাই একটা ছবি বানানোর খরচ হয়।</label>
    <div class="actions"><button class="sm pri" data-act="remix" data-v="upscale" data-size="2K" data-id="${a.id}">২K</button><button class="sm" data-act="remix" data-v="upscale" data-size="4K" data-id="${a.id}">৪K</button></div>`;
  if (panel === 'tochar') form = `<label class="lab">কোন চরিত্রের রেফারেন্সে যোগ হবে</label>
    <div class="actions">${S.P.characters.map(c => `<button class="sm" data-act="to-char" data-id="${a.id}" data-v="${c.id}" ${c.images.length >= 3 ? 'disabled' : ''}>${esc(c.name)} (${bn(c.images.length)}/৩)</button>`).join('') || '<span class="muted small">আগে চরিত্র বানাও</span>'}</div>`;
  if (panel === 'cols') form = `<label class="lab">কোন কালেকশনে রাখবে</label>
    <div class="actions">${S.P.collections.map(c => `<button class="sm ${c.items.includes(a.id) ? 'on' : ''}" data-act="col-toggle" data-id="${a.id}" data-v="${c.id}">📁 ${esc(c.name)}${c.items.includes(a.id) ? ' ✓' : ''}</button>`).join('')}<button class="sm ghost" data-act="new-collection">+ নতুন কালেকশন</button></div>`;
  if (panel === 'more') form = `<div class="actions">
      ${btn('fav', a.favorite ? '★' : '☆', 'পছন্দ')}
      <a href="${media(a.id)}?dl=1" download><button class="sm">⬇️ ডাউনলোড</button></a>
      ${btn('share', '📤', 'শেয়ার')}
      ${btn('reuse', '↺', 'প্রম্পট আবার')}
      ${btn('panel', '📁', 'কালেকশন', 'data-v="cols"')}
      ${isV ? btn('clip-toggle', '🎞️', inClips ? 'দৃশ্যক্রম থেকে সরাও' : 'দৃশ্যক্রমে যোগ')
            : btn('as-frame', '⏹', 'শেষের ফ্রেম করো', 'data-v="last"') + btn('panel', '🧑', 'চরিত্রে যোগ', 'data-v="tochar"') + btn('panel', '🔍', '২K/৪K বড় করো', 'data-v="upscale"')}
      ${btn('rename-asset', '✏️', 'নাম বদলাও')}
      ${btn('del-asset', '🗑', 'ট্র্যাশে ফেলো', 'class="sm bad"').replace('class="sm" ', '')}
    </div>`;
  openModal(`<div class="viewer">
    <div class="media">${isV ? `<video src="${media(a.id)}" controls autoplay playsinline loop></video>` : `<img src="${media(a.id)}" alt="">`}</div>
    <div class="side2">
      <div class="row" style="flex-wrap:nowrap"><b class="grow">${isV ? '🎥' : '🖼️'} ${esc(a.title || (isV ? 'ভিডিও' : 'ছবি'))}</b><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
      ${fam.length > 1 ? `<div><div class="muted small" style="margin-bottom:4px">ভার্সন (${bn(fam.length)}টি)</div><div class="vers">${fam.map((x, i) => `<button class="ver ${x.id === a.id ? 'on' : ''}" data-act="view" data-id="${x.id}" title="${esc(x.title)}">${x.kind === 'video' ? `<video src="${media(x.id)}#t=0.1" preload="metadata" muted playsinline></video>` : `<img src="${media(x.id)}" alt="">`}<span>${bn(i + 1)}</span></button>`).join('')}</div></div>` : ''}
      <details class="pinfo"><summary>ⓘ প্রম্পট ও তথ্য</summary><div class="prompt-box" style="margin-top:6px">${esc(a.prompt) || '<span class="muted">প্রম্পট নেই</span>'}</div>${info ? `<div class="muted small" style="margin-top:4px">${esc(info)}</div>` : ''}</details>
      <div class="mainacts">
        ${isV ? `<button data-act="panel" data-v="extend" data-id="${a.id}" ${a.editable ? '' : 'disabled'}><span>➡️</span>বাড়াও</button>
                 <button data-act="panel" data-v="edit" data-id="${a.id}" ${a.editable ? '' : 'disabled'}><span>✏️</span>বদলাও</button>
                 <button data-act="panel" data-v="next" data-id="${a.id}"><span>⏭️</span>পরের দৃশ্য</button>`
              : `<button data-act="as-frame" data-v="first" data-id="${a.id}"><span>🎥</span>ভিডিও বানাও</button>
                 <button data-act="panel" data-v="edit" data-id="${a.id}"><span>✏️</span>বদলাও</button>
                 <button data-act="panel" data-v="crop" data-id="${a.id}"><span>✂️</span>কাটো</button>`}
      </div>
      <button class="sm ${panel === 'more' ? 'on' : ''}" data-act="panel" data-v="${panel === 'more' ? '' : 'more'}" data-id="${a.id}" style="width:100%">${panel === 'more' ? '▴ কম দেখাও' : '⋯ আরও (পছন্দ, ডাউনলোড, শেয়ার, কালেকশন, ট্র্যাশ...)'}</button>
      ${form ? `<div class="card" style="padding:10px">${form}</div>` : ''}
    </div></div>`);
  if (form && $('#rxText')) setTimeout(() => $('#rxText')?.focus(), 50);
}

/* ---------- চরিত্র ---------- */
function renderCharacters() {
  $('#tabBody').innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:6px"><h3 class="grow" style="margin:0">নতুন চরিত্র</h3><button class="sm" data-act="avatar">🤳 আমার ছবি থেকে অবতার</button></div>
      <div class="chips" style="margin:0 0 10px">${CHAR_PRESETS.map(([n], i) => `<span class="chip" data-act="preset" data-v="${i}" style="padding:5px 12px">✨ ${esc(n)}</span>`).join('')}</div>
      <div class="row"><input id="ncName" placeholder="নাম, যেমন: রাজু" style="max-width:220px"><input id="ncDesc" class="grow" placeholder="চেহারা, যেমন: ২৫ বছরের ছেলে, কোঁকড়া চুল, নীল পাঞ্জাবি, হালকা দাড়ি"><button class="pri" data-act="new-char">যোগ করো</button></div>
    </div>
    <div id="cgrid"></div>`;
  renderCharGrid();
}
function pendingRefs(c) {
  return S.P.jobs.filter(j => (j.status === 'queued' || j.status === 'running') && j.label === `${c.name}-এর রেফারেন্স ছবি`).length;
}
function renderCharGrid() {
  const el = $('#cgrid');
  if (el) {
    el.innerHTML = S.P.characters.length ? `<div class="cgrid2">${S.P.characters.map(c => {
      const v = c.voice && S.voices?.find(x => x.name === c.voice);
      const busy = pendingRefs(c);
      return `<div class="card ccard" data-act="edit-char" data-id="${c.id}">
        <div class="cimg">${c.images[0] ? `<img src="${media(c.images[0])}" alt="" loading="lazy">` : busy ? '<span class="spin"></span>' : '🧑'}
          <span class="badge">${bn(c.images.length)}/৩${busy ? ' ⏳' : ''}</span></div>
        <div class="cinfo"><b>${esc(c.name)}</b><div class="muted small">${c.voice ? `🎙️ ${esc(c.voice)}${v ? ' · ' + esc(voiceDesc(v)) : ''}` : 'কণ্ঠ বাছা হয়নি'}</div></div>
      </div>`;
    }).join('')}</div>` : '<div class="empty">এখনো কোনো চরিত্র নেই।</div>';
  }
  if (S.charEdit) renderCharRefs();
}
async function loadVoices() {
  if (!S.voices) S.voices = (await api('GET', '/api/voices')).voices;
  return S.voices;
}
function renderCharRefs() {
  const el = $('#ecRefs');
  const c = S.P.characters.find(x => x.id === S.charEdit);
  if (!el || !c) return;
  const busy = pendingRefs(c);
  const slots = c.images.map(id => `<div class="ref"><img src="${media(id)}" alt=""><button class="sm x" data-act="del-ref" data-id="${c.id}" data-v="${id}" title="মুছো" aria-label="মুছো">✕</button></div>`);
  for (let i = 0; i < busy && slots.length < 3; i++) slots.push('<div class="ref busy"><span class="spin"></span></div>');
  while (slots.length < 3) slots.push('<div class="ref">খালি</div>');
  const full = c.images.length + busy >= 3;
  el.innerHTML = `<div class="refs">${slots.join('')}</div>
    <div class="actions"><button class="sm" data-act="gen-ref" data-v="portrait" data-id="${c.id}" ${full ? 'disabled' : ''}>✨ মুখের ছবি</button>
      <button class="sm" data-act="gen-ref" data-v="body" data-id="${c.id}" ${full ? 'disabled' : ''}>🧍 পুরো শরীর</button>
      <button class="sm" data-act="upload-ref" data-id="${c.id}" ${full ? 'disabled' : ''}>⬆️ আপলোড</button>
      <button class="sm" data-act="ref-from-project" data-id="${c.id}" ${full ? 'disabled' : ''}>📁 প্রজেক্ট থেকে</button></div>`;
}
async function openCharEditor(id) {
  const c = S.P.characters.find(x => x.id === id);
  if (!c) return;
  S.charEdit = id;
  const voices = await loadVoices().catch(() => []);
  const opt = g => voices.filter(v => v.gender === g).map(v => `<option value="${v.name}" ${c.voice === v.name ? 'selected' : ''}>${v.name} — ${voiceDesc(v)}</option>`).join('');
  openModal(`<div class="ced" style="padding:16px">
    <div class="row" style="flex-wrap:nowrap"><input id="ecName" class="title-input grow" value="${esc(c.name)}" aria-label="চরিত্রের নাম"><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
    <label class="lab">রেফারেন্স ছবি (৩টি পর্যন্ত, ভিডিওতে এগুলো দেখে চেহারা এক থাকে)</label>
    <div id="ecRefs"></div>
    <label class="lab" for="ecDesc">চেহারা</label><textarea id="ecDesc" rows="3" placeholder="যেমন: ২৫ বছরের ছেলে, কোঁকড়া চুল, নীল পাঞ্জাবি">${esc(c.description)}</textarea>
    <label class="lab" for="ecInfo">স্বভাব ও আচরণ (ঐচ্ছিক)</label><textarea id="ecInfo" rows="2" placeholder="যেমন: শান্ত, ধীরে কথা বলে, রাগলে চুপ হয়ে যায়">${esc(c.info)}</textarea>
    <label class="lab" for="ecVoice">কণ্ঠ</label>
    <div class="row" style="flex-wrap:nowrap"><select id="ecVoice" class="grow"><option value="">কোনো কণ্ঠ বাছা নেই</option><optgroup label="নারী">${opt('female')}</optgroup><optgroup label="পুরুষ">${opt('male')}</optgroup></select>
      <button class="sm" data-act="voice-play">▶ শোনো</button></div>
    <audio id="vPrev" preload="none"></audio>
    <div class="row" style="margin-top:14px"><button class="pri" data-act="save-char" data-id="${c.id}">সেভ</button><span class="grow"></span><button class="sm bad" data-act="del-char" data-id="${c.id}">🗑 চরিত্র মুছো</button></div>
  </div>`);
  renderCharRefs();
}
function charFields() {
  return { name: $('#ecName').value, description: $('#ecDesc').value, info: $('#ecInfo').value, voice: $('#ecVoice').value };
}
// এডিটরের ভেতর অন্য কাজ করার আগে লেখাগুলো সেভ করে নাও, যাতে হারিয়ে না যায়
async function saveCharSilently(id) {
  if (S.charEdit === id && $('#ecName')) await api('PATCH', `/api/characters/${id}`, charFields());
}

/* ---------- দৃশ্যক্রম ---------- */
function renderTimeline() {
  const body = $('#tabBody');
  if (!body) return;
  const clips = S.P.clips.map(id => S.P.assets.find(a => a.id === id)).filter(Boolean);
  const total = clips.reduce((s, a) => s + (+a.meta?.duration || 0), 0);
  const rest = S.P.assets.filter(a => a.kind === 'video' && !S.P.clips.includes(a.id));
  body.innerHTML = `
    <div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">দৃশ্যক্রম · ${bn(clips.length)}টি ক্লিপ · প্রায় ${bn(total)} সেকেন্ড</h3>
      <button class="pri" data-act="play-all" ${clips.length ? '' : 'disabled'}>▶ পুরোটা চালাও</button></div>
    ${clips.length ? `<div class="tl">${clips.map((a, i) => `<div class="clip">
        <video src="${media(a.id)}#t=0.1" preload="metadata" muted playsinline data-act="view" data-id="${a.id}"></video>
        <div class="ctl"><span class="no">${bn(i + 1)}</span>
          <button class="sm ghost" data-act="clip-move" data-id="${a.id}" data-v="-1" ${i ? '' : 'disabled'} aria-label="আগে">◀</button>
          <button class="sm ghost" data-act="clip-move" data-id="${a.id}" data-v="1" ${i < clips.length - 1 ? '' : 'disabled'} aria-label="পরে">▶</button>
          <button class="sm ghost bad" data-act="clip-toggle" data-id="${a.id}" aria-label="সরাও">✕</button></div></div>`).join('')}</div>`
      : '<div class="empty">দৃশ্যক্রম খালি। নিচের ভিডিওগুলো থেকে যোগ করো।</div>'}
    <h3 style="margin-top:18px">যোগ করার মতো ভিডিও</h3>
    ${rest.length ? `<div class="gal">${rest.map(a => `<div class="tile" data-act="clip-toggle" data-id="${a.id}"><video src="${media(a.id)}#t=0.1" preload="metadata" muted playsinline></video><span class="badge">+ যোগ করো</span><div class="cap">${esc(a.prompt)}</div></div>`).join('')}</div>`
      : '<p class="muted small">আর কোনো ভিডিও নেই।</p>'}`;
}
async function saveClips(clips) {
  const r = await api('PUT', `/api/projects/${S.pid}/clips`, { clips });
  S.P.clips = r.clips;
}
function playAll() {
  const clips = S.P.clips.slice();
  if (!clips.length) return;
  let i = 0;
  openModal(`<div style="background:#000;position:relative"><video id="seqV" controls autoplay playsinline style="width:100%;max-height:80vh;display:block"></video></div>
    <div class="row" style="padding:10px 14px"><b class="grow" id="seqL"></b><button class="sm" data-act="close">বন্ধ</button></div>`);
  const v = $('#seqV');
  const load = () => { v.src = media(clips[i]); $('#seqL').textContent = `ক্লিপ ${bn(i + 1)} / ${bn(clips.length)}`; v.play().catch(() => {}); };
  v.onended = () => { if (++i < clips.length) load(); };
  load();
}

/* ---------- গল্প ---------- */
function renderStory() {
  const st = S.P.story || {};
  const eps = (st.episodes || []).slice().reverse();
  $('#tabBody').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <h3>সিরিজের মূল গল্প</h3>
      <label class="lab">ধরন</label><input id="stGenre" value="${esc(st.genre)}" placeholder="যেমন: পারিবারিক ড্রামা, রহস্য, কমেডি">
      <label class="lab">মূল কাহিনি</label><textarea id="stPremise" rows="3" placeholder="কী নিয়ে সিরিজ, মূল দ্বন্দ্ব কী">${esc(st.premise)}</textarea>
      <button style="margin-top:8px" data-act="save-story">সেভ</button>
    </div>
    <div class="card" style="margin-bottom:14px">
      <h3>নতুন এপিসোড</h3>
      <textarea id="stDir" rows="2" placeholder="নির্দেশনা (ঐচ্ছিক): বড় টুইস্ট দাও, শেষে ক্লিফহ্যাঙ্গার"></textarea>
      <button class="pri" style="margin-top:8px" data-act="write-episode" ${S.writing ? 'disabled' : ''}>${S.writing ? 'লেখা হচ্ছে... (১ মিনিট পর্যন্ত)' : '📖 এপিসোড লেখো'}</button>
    </div>
    ${eps.map(e => `<div class="card" style="margin-bottom:12px">
      <div class="row"><h3 class="grow" style="margin:0">এপিসোড ${bn(e.no)}: ${esc(e.title)}</h3><button class="sm bad" data-act="del-episode" data-id="${e.id}">মুছো</button></div>
      <p class="muted small">${esc(e.summary)}</p>
      ${e.scenes.map(s => `<div class="scene"><span class="n">${bn(s.no)}</span><div>
        <div><b>${esc(s.location)}</b> — ${esc(s.action)}</div>
        ${s.dialogue ? `<div class="small">💬 ${esc(s.dialogue)}</div>` : ''}
        ${s.characters?.length ? `<div class="muted small">চরিত্র: ${esc(s.characters.join(', '))}</div>` : ''}
        <pre>${esc(s.video_prompt)}</pre>
        <button class="sm" data-act="scene-to-studio" data-id="${e.id}" data-v="${s.no}">🎥 এই দৃশ্য বানাও</button></div></div>`).join('')}
    </div>`).join('') || '<div class="empty">এখনো কোনো এপিসোড নেই।</div>'}`;
}

/* ---------- সহকারী ---------- */
const SUGGEST = ['আমার গল্পের জন্য ৩টা নতুন আইডিয়া দাও', 'এই চরিত্রগুলো নিয়ে ৫ শটের স্টোরিবোর্ড বানাও', 'একটা কনসেপ্ট আর্টের প্রম্পট লিখে দাও', 'কীভাবে শুরু করব?'];
function renderAssistant() {
  $('#tabBody').innerHTML = `<div class="card">
    <div class="row" style="margin-bottom:8px"><h3 class="grow" style="margin:0">💬 সহকারী</h3><button class="sm" data-act="chat-clear">নতুন আলাপ</button></div>
    <div id="chatLog" class="chatlog"></div>
    <div class="row" style="margin-top:10px;align-items:flex-end;flex-wrap:nowrap"><textarea id="chatIn" class="grow" rows="2" placeholder="যেমন: এই চরিত্রগুলো নিয়ে একটা ৫ শটের স্টোরিবোর্ড বানাও"></textarea>
      <button class="pri" data-act="chat-send" ${S.chatBusy ? 'disabled' : ''}>${S.chatBusy ? '...' : 'পাঠাও'}</button></div></div>`;
  renderChatLog();
  if (!S.chat) loadChat();
}
async function loadChat() {
  try { S.chat = (await api('GET', `/api/projects/${S.pid}/chat`)).messages; } catch (e) { toast(e.message, true); S.chat = []; }
  renderChatLog();
}
// সহকারীর ```prompt ব্লকগুলো আলাদা বাক্সে, সাথে "ব্যবহার করো" বোতাম
function mdLite(text) {
  return String(text).split(/```(?:prompt)?[ \t]*\n?([\s\S]*?)```/g).map((part, i) => {
    if (i % 2) {
      S.chatPrompts.push(part.trim());
      const k = S.chatPrompts.length - 1;
      return `<div class="pbox"><pre>${esc(part.trim())}</pre><div class="row"><button class="sm" data-act="use-prompt" data-v="video" data-id="${k}">🎥 ভিডিওতে ব্যবহার</button><button class="sm" data-act="use-prompt" data-v="image" data-id="${k}">🖼️ ছবিতে ব্যবহার</button></div></div>`;
    }
    return esc(part).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  }).join('');
}
function renderChatLog() {
  const el = $('#chatLog');
  if (!el) return;
  S.chatPrompts = [];
  const msgs = S.chat || [];
  el.innerHTML = msgs.length
    ? msgs.map(m => `<div class="msg ${m.role === 'user' ? 'me' : 'ai'}">${mdLite(m.text)}</div>`).join('') + (S.chatBusy ? '<div class="msg ai"><span class="spin"></span></div>' : '')
    : `<p class="muted">আইডিয়া, স্টোরিবোর্ড বা প্রম্পট নিয়ে জিজ্ঞেস করো</p>
       <div class="chips">${SUGGEST.map(x => `<span class="chip" data-act="chat-suggest" data-v="${esc(x)}" style="padding:5px 12px">${esc(x)}</span>`).join('')}</div>`;
  el.scrollTop = el.scrollHeight;
}
async function sendChat(text) {
  text = text.trim();
  if (!text || S.chatBusy) return;
  S.chatBusy = true;
  S.chat = [...(S.chat || []), { role: 'user', text }];
  renderAssistant();
  try {
    S.chat = (await api('POST', `/api/projects/${S.pid}/chat`, { text })).messages;
  } catch (e) {
    toast(e.message, true);
    S.chat = S.chat.slice(0, -1);
    if ($('#chatIn')) $('#chatIn').value = text;
  } finally {
    S.chatBusy = false;
    if (S.tab === 'assistant') { const keep = $('#chatIn')?.value || ''; renderAssistant(); $('#chatIn').value = keep; }
  }
}

/* ---------- সেটিংস ---------- */
/* ---------- অ্যাকাউন্ট: ব্যবহার, খরচ, জায়গা, নিরাপত্তা ---------- */
function pageHead(title, sub = '') {
  return `<div class="pagehead"><button class="sm ghost" data-act="home" aria-label="ফিরে যাও">←</button><div class="grow"><h2>${title}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}</div></div>`;
}
async function openAccount() {
  S.view = 'account'; S.pid = null; S.P = null; clearTimeout(S.pollTimer);
  $('#app').classList.remove('drawer');
  render();
  await act(async () => { [S.usage, S.me, S.profile] = await Promise.all([api('GET', '/api/usage'), api('GET', '/api/me'), api('GET', '/api/profile')]); renderTop(); if (S.view === 'account') renderMain(); });
}
// ১৪ দিনের তৈরির সংখ্যা: একটাই সিরিজ, তাই লেজেন্ড নেই; শিরোনামই নাম বলে। মাউস/ফোকাসে টুলটিপ, নিচে টেবিল।
function usageChart(daily) {
  const tot = d => d.videos + d.images;
  const max = Math.max(1, ...daily.map(tot));
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const label = d => new Date(d.day + 'T00:00:00').toLocaleDateString(I18N.locale, { day: 'numeric', month: 'short' });
  const bars = daily.map((d, i) => {
    const n = tot(d);
    const h = n ? Math.max(3, (n / top) * 100) : 0;
    const tip = `${label(d)}: ${bn(n)}টি (ভিডিও ${bn(d.videos)}, ছবি ${bn(d.images)})${d.cost ? ' · ' + taka(d.cost) : ''}`;
    return `<button class="bar" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><span style="height:${h}%"></span>${i === 0 || i === daily.length - 1 || i === Math.floor(daily.length / 2) ? `<i>${esc(label(d))}</i>` : ''}</button>`;
  }).join('');
  return `<figure class="chart" aria-label="গত ১৪ দিনে প্রতিদিন কয়টা ভিডিও ও ছবি তৈরি হয়েছে">
      <div class="plot"><span class="ytop tnum">${bn(top)}</span><span class="grid1"></span><div class="bars">${bars}</div><div class="tip" role="tooltip" hidden></div></div>
    </figure>
    <details class="tablev"><summary>টেবিল হিসেবে দেখো</summary><div class="tscroll"><table><thead><tr><th>দিন</th><th>ভিডিও</th><th>ছবি</th><th>আনুমানিক খরচ</th></tr></thead>
      <tbody>${daily.slice().reverse().map(d => `<tr><td>${esc(label(d))}</td><td class="tnum">${bn(d.videos)}</td><td class="tnum">${bn(d.images)}</td><td class="tnum">${d.cost ? taka(d.cost) : '—'}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function renderAccount() {
  const me = S.me.user, u = S.usage;
  const theme = document.documentElement.dataset.theme || 'dark';
  const notif = !('Notification' in window) ? 'এই ব্রাউজারে নোটিফিকেশন নেই' : Notification.permission === 'granted' ? 'চালু আছে' : Notification.permission === 'denied' ? 'ব্রাউজারে বন্ধ করা আছে (সাইট সেটিং থেকে চালু করো)' : '';
  let usage = '<p class="muted">লোড হচ্ছে...</p>';
  if (u) {
    const st = u.storage, pct = st.limit ? Math.min(100, Math.round(st.used / st.limit * 100)) : 0;
    const lim = u.limits;
    usage = `<div class="tiles">
        <div class="tile2"><span class="muted small">ভিডিও (৩০ দিন)</span><b class="tnum">${bn(u.last30.videos)}</b><span class="muted small tnum">${bn(Math.round(u.last30.videoSeconds))} সেকেন্ড</span></div>
        <div class="tile2"><span class="muted small">ছবি (৩০ দিন)</span><b class="tnum">${bn(u.last30.images)}</b></div>
        <div class="tile2"><span class="muted small">আনুমানিক খরচ (৩০ দিন)</span><b class="tnum">${taka(u.last30.cost)}</b><span class="muted small tnum">$${u.last30.cost.toFixed(2)}</span></div>
        <div class="tile2"><span class="muted small">আজ</span><b class="tnum">${bn(u.today.video)}${lim ? '/' + bn(lim.video) : ''} <small>ভিডিও</small></b><span class="muted small tnum">${bn(u.today.image)}${lim ? '/' + bn(lim.image) : ''} ছবি</span></div>
      </div>
      <h4>গত ১৪ দিনে প্রতিদিন কয়টা তৈরি হয়েছে</h4>${usageChart(u.daily)}
      <p class="muted small">${esc(u.estimateNote)}</p>
      <h4>জায়গা</h4>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="ব্যবহৃত জায়গা"><span style="width:${st.limit ? pct : 0}%"></span></div>
      <p class="small tnum">${fmtBytes(st.used)} ব্যবহার হয়েছে${st.limit ? ` · সীমা ${fmtBytes(st.limit)} (${bn(pct)}%)` : ' · মালিকের কোনো সীমা নেই'}</p>`;
  }
  $('#main').innerHTML = `<div class="page">${pageHead('আমার অ্যাকাউন্ট')}
    ${profileCard()}
    <section class="card"><h3>ব্যবহার ও খরচ</h3>${usage}</section>
    <section class="card"><h3>অ্যাপ</h3>
      <div class="setrow"><span class="grow">ফোনে বা কম্পিউটারে অ্যাপ হিসেবে</span><button data-act="install">📲 ইনস্টল</button></div>
      <div class="setrow"><span class="grow">🌐 ভাষা · Language</span><div class="seg seg-sm notr" role="group" aria-label="Language">${[['bn', 'বাংলা'], ['en', 'English']].map(([v, l]) => `<button class="${I18N.lang === v ? 'on' : ''}" data-act="set-lang" data-v="${v}" aria-pressed="${I18N.lang === v}">${l}</button>`).join('')}</div></div>
      <div class="setrow"><span class="grow">থিম</span><div class="seg seg-sm" role="group" aria-label="থিম">${[['dark', 'ফ্যান্টাসি (গাঢ়)'], ['light', 'আলো'], ['auto', 'ডিভাইস']].map(([v, l]) => `<button class="${theme === v ? 'on' : ''}" data-act="set-theme" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`).join('')}</div></div>
      <div class="setrow"><span class="grow">নোটিফিকেশন</span>${notif ? `<span class="muted small">${notif}</span>` : '<button data-act="notify-on">চালু করো</button>'}</div>
    </section>
    <section class="card"><h3>নিরাপত্তা</h3>
      <div class="setrow"><span class="grow">এই ডিভাইস থেকে বের হও</span><button data-act="logout">লগআউট</button></div>
      <div class="setrow"><span class="grow">সব ডিভাইস থেকে বের হও</span><button data-act="logout-all">সব জায়গা থেকে লগআউট</button></div>
    </section>
    <section class="card danger"><h3>অ্যাকাউন্ট মুছে ফেলা</h3>
      <p class="small">তোমার সব প্রজেক্ট, ভিডিও, ছবি, চরিত্র আর গল্প চিরতরে মুছে যাবে। ফেরত আনা যাবে না। আগে প্রজেক্টের ⬇️ ZIP দিয়ে ফাইল নামিয়ে রাখো।</p>
      <label class="lab" for="delConfirm">নিশ্চিত করতে নিজের ইমেইল লেখো</label>
      <div class="row"><input id="delConfirm" class="grow" autocomplete="off" placeholder="${esc(me.email)}"><button class="bad" data-act="account-delete">চিরতরে মুছে ফেলো</button></div>
    </section></div>`;
}

function profileCard() {
  const me = S.me.user, pf = S.profile;
  const joined = pf?.joined ? new Date(pf.joined).toLocaleDateString(I18N.locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const row = (icon, k, v) => `<div class="pf-row"><span aria-hidden="true">${icon}</span><span class="muted">${k}</span><b class="tnum">${v}</b></div>`;
  return `<section class="card profile ${me.owner ? 'own' : ''}">
    <div class="pf-cover" aria-hidden="true"></div>
    <div class="pf-head">
      <div class="pf-avatar">${me.owner ? '<span class="pf-crown" aria-hidden="true">👑</span>' : ''}
        ${me.picture ? `<img src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="pf-init">${esc((me.name || '?').slice(0, 1))}</span>`}
        ${me.role === 'guest' ? '' : '<button class="pf-cam" data-act="pf-photo" aria-label="প্রোফাইল ছবি বদলাও" title="প্রোফাইল ছবি বদলাও">📷</button>'}</div>
      <h2 class="pf-name">${esc(me.name)}</h2>
      <span class="pill ${me.owner ? 'gold' : me.role === 'admin' ? 'adm' : ''}">${ROLE_LABEL[me.role] || 'সদস্য'}</span>
      <p class="muted small" style="margin:4px 0 0">${esc(me.email)}</p>
    </div>
    <div class="pf-list">
      ${row('🪪', 'ইউজার আইডি', pf ? esc(pf.shortId) : '…')}
      ${row('📅', 'যোগ দিয়েছে', esc(joined))}
      ${row('⭐', 'মোট তৈরি', pf ? bn(pf.stats.creations) : '…')}
      ${row('📁', 'প্রজেক্ট', pf ? bn(pf.stats.projects) + (pf.stats.documentaries ? ` · ডকুমেন্টারি ${bn(pf.stats.documentaries)}` : '') : '…')}
    </div>
    ${me.role === 'guest' ? '<div class="pf-acts"><button class="gold" data-act="guest-upgrade">🔐 Gmail দিয়ে ঢোকো</button></div>' : ''}
    <div class="pf-acts"><button data-act="pf-name">✏️ নাম বদলাও</button>
      ${me.customPhoto ? '<button data-act="pf-photo-del">Gmail-এর ছবিতে ফেরো</button>' : ''}
      <button data-act="switch-account">🔁 অ্যাকাউন্ট বদলাও</button>
      <button data-act="help">💬 সাহায্য ও যোগাযোগ</button>
      <button data-act="about">ℹ️ Ruvo সম্পর্কে</button>
      ${me.staff ? '<button data-act="admin">🛡️ অ্যাডমিন</button>' : ''}
      ${me.owner ? '<button class="gold" data-act="owner-panel">🔐 মালিকের কন্ট্রোল</button>' : ''}</div>
    <p class="muted small" style="margin:10px 0 0">মডেল: ভিডিও ${esc(S.me.models.video)} · ছবি ${esc(S.me.models.image)} · লেখা ${esc(S.me.models.text)}</p>
  </section>`;
}

/* ---------- Ruvo সম্পর্কে ---------- */
function renderAbout() {
  const a = { creatorName: txt('creatorName') || S.me.app?.creatorName, creatorTitle: txt('creatorTitle') || S.me.app?.creatorTitle };
  $('#main').innerHTML = `<div class="page about">${pageHead('Ruvo সম্পর্কে')}
    <section class="card ab-hero"><img class="ab-logo" src="${brandUrl('logo')}" alt="Ruvo লোগো">
      <h1 class="ab-title">Ruvo</h1><p class="ab-sub">AI ক্রিয়েটিভ স্টুডিও</p>
      <p>${esc(txt('aboutText'))}</p></section>
    <section class="card ab-creator">
      <div class="ab-photo"><img src="${brandUrl('art')}" alt="${esc(a.creatorName || '')}" loading="lazy"></div>
      <div class="ab-text"><p class="ab-by">তৈরি ও উন্নয়ন</p>
        <span class="pill gold big">👑 ${esc(a.creatorName || '')}</span>
        ${a.creatorTitle ? `<p class="muted" style="margin:6px 0 0">${esc(a.creatorTitle)}</p>` : ''}
        <p class="ab-tag">${esc(txt('aboutTag'))}</p>
        ${contactButtons(S.me.site?.contact) ? `<p class="ab-by" style="margin-top:10px">সরাসরি যোগাযোগ</p>${contactButtons(S.me.site.contact)}` : ''}</div>
    </section>
    <p class="muted small" style="text-align:center">সংস্করণ ${esc(S.me.version || '')} · © ${bn(new Date().getFullYear())} Ruvo</p>
  </div>`;
}

/* ---------- সাহায্য ও যোগাযোগ ---------- */
const CAT_LABEL = { problem: '🛠️ সমস্যা', account: '👤 অ্যাকাউন্ট', billing: '💳 খরচ/বিল', idea: '💡 পরামর্শ', other: '📝 অন্যান্য' };
const STATUS_LABEL = { open: '🟡 খোলা', working: '🔵 দেখা হচ্ছে', resolved: '🟢 সমাধান হয়েছে' };
async function openHelp() {
  S.view = 'help'; S.pid = null; S.P = null; clearTimeout(S.pollTimer);
  $('#app').classList.remove('drawer');
  render();
  await act(async () => { const [r, me] = await Promise.all([api('GET', '/api/complaints'), api('GET', '/api/me')]); S.myComplaints = r.complaints; S.me = me; if (S.view === 'help') renderMain(); });
}
function threadHtml(c, replyAct) {
  return `<details class="cthread" ${S.openThread === c.id ? 'open' : ''}><summary><span class="grow"><b>${esc(c.subject)}</b><span class="muted small"> · ${CAT_LABEL[c.category] || ''}${c.email ? ' · ' + esc(c.name || '') + ' &lt;' + esc(c.email) + '&gt;' : ''}</span></span>
      <span class="st st-${c.status}">${STATUS_LABEL[c.status]}</span>${c.waiting ? '<span class="pill gold">উত্তর দরকার</span>' : ''}</summary>
    <div class="cmsgs">${c.messages.map(m => `<div class="msg ${m.staff ? 'ai' : 'me'}"><div class="small muted">${m.staff ? '🛡️ Ruvo টিম' : c.email ? '👤 ব্যবহারকারী' : 'তুমি'} · ${esc(fmtTime(m.created))}</div>${esc(m.text).replace(/\n/g, '<br>')}</div>`).join('')}</div>
    <div class="row creply"><textarea class="grow" rows="2" id="rp_${c.id}" placeholder="উত্তর লেখো…" aria-label="উত্তর"></textarea><button class="pri" data-act="${replyAct}" data-id="${c.id}">পাঠাও</button></div>
    ${c.email ? `<div class="row" style="margin-top:8px"><span class="muted small grow">অবস্থা বদলাও:</span>${Object.entries(STATUS_LABEL).map(([k, l]) => `<button class="sm ${c.status === k ? 'on' : ''}" data-act="c-status" data-id="${c.id}" data-v="${k}">${l}</button>`).join('')}</div>` : ''}
  </details>`;
}
function renderHelp() {
  const c = S.me.site?.contact;
  const list = S.myComplaints;
  $('#main').innerHTML = `<div class="page">${pageHead('💬 সাহায্য ও যোগাযোগ')}
    <section class="card helphero"><div class="hh-text"><h3>সরাসরি মালিকের সাথে যোগাযোগ</h3>
      ${contactButtons(c) || ''}</div>
      <img class="hh-owner${framed()}" src="${brandUrl('owner-sm')}" alt="" aria-hidden="true"></section>
    <section class="card"><h3>অভিযোগ বা সমস্যা জানাও</h3>
      <div class="set2"><div><label class="lab" for="cpCat">ধরন</label><select id="cpCat">${Object.entries(CAT_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div><label class="lab" for="cpSub">বিষয়</label><input id="cpSub" maxlength="120" placeholder="যেমন: ভিডিও তৈরি আটকে আছে"></div></div>
      <label class="lab" for="cpText">বিস্তারিত</label><textarea id="cpText" rows="4" maxlength="4000" placeholder="কী হয়েছে, কখন হয়েছে, কোন প্রজেক্টে — যত পারো লেখো"></textarea>
      <div class="row" style="margin-top:10px"><span class="grow"></span><button class="pri" data-act="c-new">পাঠাও</button></div></section>
    <section class="card"><h3>আমার অভিযোগ</h3>${!list ? '<p class="muted">লোড হচ্ছে...</p>' : list.length ? list.map(x => threadHtml(x, 'c-reply')).join('') : '<p class="muted small">এখনো কিছু পাঠাওনি।</p>'}</section>
  </div>`;
}

/* ---------- মালিকের কন্ট্রোল প্যানেল ---------- */
async function openPanel() {
  S.view = 'panel'; S.pid = null; S.P = null; clearTimeout(S.pollTimer);
  $('#app').classList.remove('drawer');
  S.panel = null; S.arrange = null;
  render();
  await act(async () => {
    const st = await api('GET', '/api/owner/status');
    S.panel = { status: st };
    if (st.unlocked) {
      const [u, set, al, ov] = await Promise.all([api('GET', '/api/owner/users'), api('GET', '/api/owner/settings'), api('GET', '/api/admin/allowed'), api('GET', '/api/admin/overview')]);
      Object.assign(S.panel, { users: u.users, settings: set, allowed: al, overview: ov });
    }
    if (S.view === 'panel') renderMain();
  });
}
function renderPanel() {
  const P = S.panel;
  const head = pageHead('🔐 মালিকের কন্ট্রোল', 'শুধু তুমি। ভেতরে সব নিয়ন্ত্রণ।');
  if (!P) { $('#main').innerHTML = `<div class="page">${head}<p class="muted">লোড হচ্ছে...</p></div>`; return; }
  if (!P.status.unlocked) {
    $('#main').innerHTML = `<div class="page">${head}<section class="card lockcard"><div class="lockicon" aria-hidden="true">🔐</div>
      ${P.status.configured ? `<h3>কন্ট্রোল প্যানেল তালাবদ্ধ</h3>
        <form class="row" data-form="unlock" autocomplete="on"><input type="text" name="username" value="${esc(S.me.user.email)}" autocomplete="username" hidden>
          <input id="pnPass" type="password" class="grow" autocomplete="current-password" placeholder="পাসওয়ার্ড" aria-label="পাসওয়ার্ড" maxlength="200">
          <button class="gold" data-act="panel-unlock">খোলো</button></form>
`
      : `<h3>পাসওয়ার্ড বসানো নেই</h3><p class="muted small"><code>OWNER_PANEL_PASSWORD</code> বসাও</p>`}
      </section></div>`;
    setTimeout(() => $('#pnPass')?.focus(), 30);
    return;
  }
  const mins = Math.max(0, Math.round((P.status.until - Date.now()) / 60000));
  const users = P.users || [], set = P.settings || {}, c = set.contact || {}, al = P.allowed || { allowed: [] }, ov = P.overview;
  const qq = (S.panelQ || '').toLowerCase();
  const shown = users.filter(u => !qq || `${u.email} ${u.name}`.toLowerCase().includes(qq));
  const counts = { all: users.length, admin: users.filter(u => u.role === 'admin').length, blocked: users.filter(u => u.blocked).length };
  const field = (k, l, ph, type = 'text') => `<div><label class="lab" for="pc_${k}">${l}</label><input id="pc_${k}" type="${type}" value="${esc(c[k] || '')}" placeholder="${ph}"></div>`;
  $('#main').innerHTML = `<div class="page wide">${head}
    ${ov?.system?.ephemeral ? '<section class="card danger"><h3>⚠️ ডেটা স্থায়ী ডিস্কে নেই</h3><p class="small">প্রতিবার আপডেট বা রিস্টার্টে সব অ্যাকাউন্ট, ছবি ও ভিডিও মুছে যাবে। হোস্টিংয়ে Disk/Volume যোগ করো (Mount path <code>/data</code>)।</p></section>' : ''}
    <section class="card pnbar"><span class="grow">🔓 প্যানেল খোলা · আর ${bn(mins)} মিনিট পর নিজে থেকে বন্ধ হবে</span><button data-act="panel-lock">🔒 এখনই বন্ধ করো</button></section>
    <section class="card"><h3>👥 ব্যবহারকারী <span class="muted small">মোট ${bn(counts.all)} · অ্যাডমিন ${bn(counts.admin)} · ব্লক ${bn(counts.blocked)}</span></h3>
      <input id="pnQ" data-g="pnq" placeholder="🔍 নাম বা ইমেইল দিয়ে খোঁজো" value="${esc(S.panelQ || '')}" style="margin-bottom:10px">
      <div class="tscroll"><table class="utable"><thead><tr><th>ব্যবহারকারী</th><th>ভূমিকা</th><th>শেষ দেখা</th><th>কাজ</th></tr></thead><tbody>
      ${shown.map(u => `<tr class="${u.blocked ? 'blk' : ''}"><td><div class="uc">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="ui">${esc((u.name || '?').slice(0, 1))}</span>`}
          <div><b>${esc(u.name || '')}</b><div class="muted small">${esc(u.email)}</div>${u.blocked ? `<div class="small err-text">⛔ ব্লক${u.reason ? ': ' + esc(u.reason) : ''}</div>` : ''}</div></div></td>
        <td><span class="pill ${u.role === 'owner' ? 'gold' : u.role === 'admin' ? 'adm' : ''}">${ROLE_LABEL[u.role]}</span></td>
        <td class="small">${u.last ? esc(fmtTime(u.last)) : '—'}</td>
        <td>${u.role === 'owner' ? '<span class="muted small">—</span>' : `<div class="uacts">
          ${u.role === 'admin' ? `<button class="sm" data-act="pn-role" data-id="${u.id}" data-v="user">অ্যাডমিন বাদ</button>` : `<button class="sm" data-act="pn-role" data-id="${u.id}" data-v="admin">🛡️ অ্যাডমিন বানাও</button>`}
          <button class="sm" data-act="pn-kick" data-id="${u.id}" title="সব ডিভাইস থেকে বের করে দাও">👢 কিক</button>
          ${u.blocked ? `<button class="sm" data-act="pn-unblock" data-id="${u.id}">✅ আনব্লক</button>` : `<button class="sm bad" data-act="pn-block" data-id="${u.id}">⛔ ব্লক</button>`}</div>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">কেউ নেই</td></tr>'}
      </tbody></table></div>
</section>
    <section class="card"><h3>🚪 কারা ঢুকতে পারবে</h3>
      <div class="setrow"><span class="grow">👀 অতিথি প্রবেশ</span><div class="seg seg-sm" role="group" aria-label="অতিথি প্রবেশ">${[['on', 'চালু'], ['off', 'বন্ধ']].map(([v, l]) => `<button class="${set.guest === v ? 'on' : ''}" data-act="pn-guest" data-v="${v}" aria-pressed="${set.guest === v}">${l}</button>`).join('')}</div></div>
      <div class="setrow"><span class="grow">নতুন সদস্য</span><div class="seg seg-sm" role="group" aria-label="নতুন সদস্য">${[['invite', 'শুধু অনুমতি পাওয়া'], ['open', 'যে কেউ (Gmail)']].map(([v, l]) => `<button class="${set.signup === v ? 'on' : ''}" data-act="pn-signup" data-v="${v}" aria-pressed="${set.signup === v}">${l}</button>`).join('')}</div></div>
      <div class="row" style="margin:8px 0"><input id="alEmail" class="grow" type="email" placeholder="gmail ঠিকানা" aria-label="নতুন ইমেইল"><button class="pri" data-act="allow-add">অনুমতি দাও</button></div>
      ${(al.allowed || []).map(x => `<div class="setrow"><span class="grow">${esc(x.email)}</span><button class="sm bad" data-act="allow-del" data-v="${esc(x.email)}">সরাও</button></div>`).join('') || '<p class="muted small">তালিকা খালি</p>'}</section>
    <section class="card"><h3>📞 যোগাযোগের তথ্য (সবাই দেখবে, লগইন পাতাতেও)</h3>
      <div class="set2">${field('whatsapp', 'WhatsApp নম্বর', '+8801XXXXXXXXX', 'tel')}${field('phone', 'ফোন নম্বর', '+8801XXXXXXXXX', 'tel')}
        ${field('email', 'ইমেইল', 'you@gmail.com', 'email')}${field('facebook', 'Facebook পেজ/প্রোফাইল', 'https://facebook.com/...', 'url')}
        ${field('telegram', 'Telegram', 'https://t.me/...', 'url')}${field('youtube', 'YouTube চ্যানেল', 'https://youtube.com/@...', 'url')}</div>
      ${field('note', 'ছোট নোট (যেমন কখন পাওয়া যাবে)', 'সকাল ১০টা – রাত ১০টা')}
      <div class="row" style="margin-top:10px"><span class="grow muted small">খালি ঘর দেখাবে না।</span><button class="pri" data-act="pn-contact">সেভ</button></div></section>
    <section class="card"><h3>📢 সবার জন্য বার্তা</h3>
      <textarea id="pnAnn" rows="3" maxlength="600" placeholder="যেমন: আজ রাত ১২টায় ১০ মিনিট রক্ষণাবেক্ষণ চলবে">${esc(set.announcement?.text || '')}</textarea>
      <div class="seg annmodes" role="group" aria-label="কীভাবে দেখাবে">${[['bar', '➖ ওপরে ফিতা'], ['popup', '🪟 পুরো পর্দায় বার্তা'], ['maintenance', '🛠️ রক্ষণাবেক্ষণ (কাজ বন্ধ)']]
        .map(([v, l]) => `<button class="${(set.announcement?.mode || 'bar') === v ? 'on' : ''}" data-act="pn-ann-mode" data-v="${v}" aria-pressed="${(set.announcement?.mode || 'bar') === v}">${l}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><label class="row small"><input type="checkbox" id="pnWarn" style="width:auto" ${set.announcement?.level === 'warn' ? 'checked' : ''}> জরুরি (হলুদ)</label><span class="grow"></span>
        <button data-act="pn-ann-clear">মুছে দাও</button><button class="pri" data-act="pn-ann">দেখাও</button></div></section>
    ${brandSection(set)}
    ${textsSection(set)}
    ${layoutSection()}
    ${ov ? `<section class="card"><h3>📜 সব কাজকর্মের লগ</h3><div class="tscroll"><table><thead><tr><th>সময়</th><th>কে</th><th>কী</th><th>বিস্তারিত</th></tr></thead>
      <tbody>${ov.activity.map(a => `<tr class="${/fail|block|kick/.test(a.action) ? 'blk' : ''}"><td class="small">${esc(fmtTime(a.created))}</td><td class="small">${esc(a.email || '—')}</td><td>${esc(ACTION_LABEL[a.action] || a.action)}</td><td class="small muted">${esc(a.target || '')} ${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
  </div>`;
}

/* ---------- প্যানেল: ছবি ও লোগো ---------- */
const BRAND_GROUPS = [
  ['owner', '🧑 আমার ছবি', 'শুরুর পর্দা, লগইন, হোম', 'owner-sm'],
  ['art', '🖼️ ডিজাইন করা ছবি', 'সম্পর্কে পাতা', 'art'],
  ['logo', '✨ লোগো', 'হেডার, ফোনের আইকন', 'logo'],
];
function brandSection(set) {
  const b = set.brand || {};
  return `<section class="card"><h3>🖼️ ছবি ও লোগো</h3>
    <div class="brandgrid">${BRAND_GROUPS.map(([k, title, where, prev]) => `<div class="brandcard">
      <div class="bc-prev ${k}"><img src="${brandUrl(prev)}" alt="" class="${k === 'owner' && b.framed ? 'framed' : ''}"></div>
      <b>${title}</b><span class="muted small">${where}</span>
      <div class="row"><button class="pri sm" data-act="pn-brand" data-v="${k}">⬆️ বদলাও</button>${b[k === 'owner' ? 'owner' : k] ? `<button class="sm" data-act="pn-brand-reset" data-v="${k}">↺ আগেরটায় ফেরো</button>` : ''}</div>
      ${k === 'owner' ? `<label class="row small"><input type="checkbox" id="pnFramed" style="width:auto" data-act="pn-framed" ${b.framed ? 'checked' : ''}> গোল ফ্রেমে দেখাও</label>` : ''}</div>`).join('')}</div>
</section>`;
}
const loadImg = file => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('এটা ছবি মনে হচ্ছে না'));
  img.src = URL.createObjectURL(file);
});
// ক্যানভাসে আঁকা: শুধু মাপ বদল (উচ্চ মানের), কোনো ফিল্টার নয়
function drawTo(img, w, h, sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight, bg = null, pad = 0) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.drawImage(img, sx, sy, sw, sh, pad, pad, w - 2 * pad, h - 2 * pad);
  return cv;
}
function encode(cv, type = 'image/webp', q = 0.93) {
  const d = cv.toDataURL(type, q);
  return d.startsWith('data:' + type) ? d : cv.toDataURL('image/png'); // পুরনো Safari WEBP বানাতে পারে না
}
// স্বচ্ছতা আছে কি না, আর ছবির আসল অংশের সীমা (চারপাশের খালি স্বচ্ছ জায়গা বাদ)
function alphaInfo(img) {
  const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const d = drawTo(img, w, h).getContext('2d').getImageData(0, 0, w, h).data;
  let clear = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = d[(y * w + x) * 4 + 3];
    if (a < 240) clear++;
    if (a > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const has = clear / (w * h) > 0.02;
  return { has, box: has && x1 > x0 ? [x0 / k, y0 / k, (x1 - x0 + 1) / k, (y1 - y0 + 1) / k] : [0, 0, img.naturalWidth, img.naturalHeight] };
}
async function processBrand(kind, file) {
  const img = await loadImg(file);
  const out = {};
  if (kind === 'owner') {
    const { has, box } = alphaInfo(img);
    const [sx, sy, sw, sh] = box;
    const fit = (maxW, maxH) => { const k = Math.min(1, maxW / sw, maxH / sh); return [Math.round(sw * k), Math.round(sh * k)]; };
    const [w1, h1] = fit(1000, 1400), [w2, h2] = fit(480, 900);
    out.owner = encode(drawTo(img, w1, h1, sx, sy, sw, sh));
    out['owner-sm'] = encode(drawTo(img, w2, h2, sx, sy, sw, sh));
    out.framed = !has;
  } else if (kind === 'art') {
    const k = Math.min(1, 900 / img.naturalWidth, 1600 / img.naturalHeight);
    out.art = encode(drawTo(img, Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k)), 'image/webp', 0.91);
  } else {
    const side = Math.min(img.naturalWidth, img.naturalHeight), sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
    const sq = (n, bg, pad) => drawTo(img, n, n, sx, sy, side, side, bg, pad).toDataURL('image/png');
    Object.assign(out, { logo: sq(512), 'icon-512': sq(512), 'icon-192': sq(192), apple: sq(180, '#06040e'), maskable: sq(512, '#06040e', 46), favicon: sq(64) });
  }
  URL.revokeObjectURL(img.src);
  return out;
}

/* ---------- প্যানেল: লেখা ---------- */
const TEXT_LABEL = {
  tagline: ['ট্যাগলাইন (শুরুর পর্দা, লগইন)', 80], heroTitle: ['হোমের বড় লেখা', 80], heroButton: ['হোমের বোতাম', 30],
  loginLine: ['লগইন পাতার ছোট বার্তা', 140], creatorName: ['নির্মাতার নাম', 60], creatorTitle: ['নির্মাতার পদ', 60],
  aboutTag: ['সম্পর্কে: স্লোগান', 80], aboutText: ['সম্পর্কে: বর্ণনা', 600],
};
function textsSection(set) {
  const t = set.texts || {};
  const sfx = I18N.lang === 'en' ? '_en' : ''; // যে ভাষা চালু, সেই ভাষার লেখাই বদলানো হয়
  return `<section class="card"><h3>✍️ অ্যাপের লেখা <span class="pill notr">${I18N.lang === 'en' ? 'English' : 'বাংলা'}</span></h3>
    <div class="set2">${Object.entries(TEXT_LABEL).map(([k, [l, max]]) => `<div ${k === 'aboutText' ? 'style="grid-column:1/-1"' : ''}><label class="lab" for="tx_${k}">${l}</label>
      ${k === 'aboutText' ? `<textarea id="tx_${k}" rows="3" maxlength="${max}" placeholder="${esc(TEXT_DEFAULT[k])}">${esc(t[k + sfx] || '')}</textarea>` : `<input id="tx_${k}" maxlength="${max}" value="${esc(t[k + sfx] || '')}" placeholder="${esc(TEXT_DEFAULT[k] || S.me.app?.[k] || '')}">`}</div>`).join('')}</div>
    <div class="row" style="margin-top:10px"><span class="grow"></span><button class="pri" data-act="pn-texts">সেভ</button></div></section>`;
}

/* ---------- প্যানেল: হোম সাজানো (ফোনের হোম স্ক্রিনের মতো টেনে সরানো) ---------- */
function layoutSection() {
  if (!S.arrange) S.arrange = currentLayout().map(t => ({ ...t }));
  const L = S.arrange;
  return `<section class="card"><h3>🏠 হোম সাজাও</h3>
    <p class="muted small" style="margin:0 0 10px">চেপে ধরে টানো · 👁 দেখাও/লুকাও · ✏️ নাম</p>
    <div class="arrgrid" id="arrGrid">${L.map((t, i) => { const [ic, l, c] = TOOL_DEF[t.id]; return `<div class="arrtile toolbtn ${c} ${t.hidden ? 'off' : ''}" data-id="${t.id}" tabindex="0" aria-label="${esc(t.label || l)}${t.hidden ? ' (লুকানো)' : ''}, ${bn(i + 1)} নম্বর">
      <span class="ti">${ic}</span><span class="al">${esc(t.label || l)}</span>
      <div class="arracts"><button class="sm ghost" data-act="arr-move" data-id="${t.id}" data-v="-1" aria-label="আগে নাও">◀</button>
        <button class="sm ghost" data-act="arr-hide" data-id="${t.id}" aria-label="${t.hidden ? 'দেখাও' : 'লুকাও'}">${t.hidden ? '🚫' : '👁'}</button>
        <button class="sm ghost" data-act="arr-rename" data-id="${t.id}" aria-label="নাম বদলাও">✏️</button>
        <button class="sm ghost" data-act="arr-move" data-id="${t.id}" data-v="1" aria-label="পরে নাও">▶</button></div></div>`; }).join('')}</div>
    <div class="row" style="margin-top:10px"><span class="muted small grow">দেখানো ${bn(L.filter(t => !t.hidden).length)}টি · লুকানো ${bn(L.filter(t => t.hidden).length)}টি</span>
      <button data-act="arr-reset">↺ আগের মতো</button><button class="pri" data-act="arr-save">সেভ</button></div></section>`;
}
function rerenderArrange() {
  const sec = $('#arrGrid')?.closest('section');
  if (!sec) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = layoutSection();
  sec.replaceWith(tmp.firstElementChild);
}
// টেনে সরানো: মাউসে সাথে সাথে, আঙুলে একটু চেপে ধরলে (ফোনের হোম স্ক্রিনের মতো)
(function setupArrangeDrag() {
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const tile = e.target.closest?.('.arrtile');
    if (!tile || e.target.closest('button') || e.button > 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const begin = () => {
      const r = tile.getBoundingClientRect();
      drag = { tile, dx: start.x - r.left, dy: start.y - r.top, id: e.pointerId };
      tile.classList.add('dragging');
      tile.setPointerCapture?.(e.pointerId);
      navigator.vibrate?.(15);
    };
    if (e.pointerType === 'mouse') { drag = { pending: true, tile, start, begin, id: e.pointerId }; return; }
    const timer = setTimeout(begin, 260);
    drag = { pending: true, tile, start, timer, id: e.pointerId };
  });
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.pending) {
      const moved = Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y);
      if (drag.begin && moved > 6) drag.begin();
      else if (drag.timer && moved > 10) { clearTimeout(drag.timer); drag = null; } // আঙুল সরালে স্ক্রল, টানা নয়
      return;
    }
    e.preventDefault();
    const t = drag.tile;
    t.style.transform = '';
    const under = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.classList?.contains('arrtile') && el !== t);
    if (under) {
      const tiles = [...t.parentNode.children];
      t.parentNode.insertBefore(t, tiles.indexOf(under) > tiles.indexOf(t) ? under.nextSibling : under);
    }
    const r = t.getBoundingClientRect();
    t.style.transform = `translate(${e.clientX - drag.dx - r.left}px, ${e.clientY - drag.dy - r.top}px) scale(1.06)`;
  }, { passive: false });
  const end = e => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    clearTimeout(drag.timer);
    if (!drag.pending) {
      const t = drag.tile;
      t.classList.remove('dragging');
      t.style.transform = '';
      const order = [...t.parentNode.children].map(el => el.dataset.id);
      S.arrange.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      rerenderArrange();
    }
    drag = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();

/* ---------- অ্যাডমিন (শুধু মালিক) ---------- */
async function openAdmin() {
  S.view = 'admin'; S.pid = null; S.P = null; clearTimeout(S.pollTimer);
  $('#app').classList.remove('drawer');
  render();
  await act(async () => {
    [S.admin, S.allowed, S.staffC, S.staffJobs] = await Promise.all([api('GET', '/api/admin/overview'), api('GET', '/api/admin/allowed'), api('GET', '/api/staff/complaints'), api('GET', '/api/staff/jobs')]);
    if (S.view === 'admin') renderMain();
  });
}
const ACTION_LABEL = { panel_unlock: '🔓 প্যানেল খোলা', panel_fail: '⚠️ প্যানেলে ভুল পাসওয়ার্ড', panel_lock: '🔒 প্যানেল বন্ধ', admin_add: 'অ্যাডমিন বানানো', admin_remove: 'অ্যাডমিন বাদ',
  user_block: '⛔ ব্লক', user_unblock: 'আনব্লক', user_kick: '👢 কিক', settings_contact: 'যোগাযোগের তথ্য', settings_announce: 'ঘোষণা', settings_signup: 'সদস্যের নিয়ম',
  complaint_new: 'নতুন অভিযোগ', complaint_reply: 'অভিযোগের উত্তর', complaint_status: 'অভিযোগের অবস্থা', staff_cancel_job: 'কাজ বাতিল (অ্যাডমিন)', login: 'লগইন', logout_all: 'সব জায়গা থেকে লগআউট', account_delete: 'অ্যাকাউন্ট মুছেছে', allow_add: 'অনুমতি যোগ', allow_remove: 'অনুমতি সরানো', project_create: 'প্রজেক্ট', generate: 'তৈরি', remix: 'বদল', project_delete: 'প্রজেক্ট মুছেছে', purge: 'ফাইল চিরতরে মুছেছে', trash_empty: 'ট্র্যাশ খালি', export: 'এক্সপোর্ট' };
function renderAdmin() {
  const A = S.admin, al = S.allowed;
  if (!A) { $('#main').innerHTML = `<div class="page">${pageHead('অ্যাডমিন')}<p class="muted">লোড হচ্ছে...</p></div>`; return; }
  const q = A.queue, sys = A.system;
  const k = (label, v, sub = '') => `<div class="tile2"><span class="muted small">${label}</span><b class="tnum">${v}</b>${sub ? `<span class="muted small">${sub}</span>` : ''}</div>`;
  const diskWarn = sys.ephemeral ? '<section class="card danger"><h3>⚠️ ডেটা স্থায়ী ডিস্কে নেই</h3><p class="small">এখন অ্যাপ অস্থায়ী জায়গায় ডেটা রাখছে। <b>প্রতিবার আপডেট বা রিস্টার্টে সব অ্যাকাউন্ট, ছবি ও ভিডিও মুছে যাবে।</b> হোস্টিংয়ে একটা Disk/Volume যোগ করো (Mount path <code>/data</code>)।</p></section>' : '';
  $('#main').innerHTML = `<div class="page wide">${pageHead('অ্যাডমিন', `সংস্করণ ${esc(sys.version)} · ডেটাবেস ${esc(sys.database)} · স্টোরেজ ${esc(sys.storage)}`)}
    ${diskWarn}
    <section class="card"><h3>সিস্টেম (গত ৩০ দিন)</h3><div class="tiles">
      ${k('ব্যবহারকারী', bn(sys.users), sys.guests ? `আর অতিথি ${bn(sys.guests)}` : '')}
      ${k('সারিতে / চলছে', `${bn(q.queued || 0)} / ${bn(q.running || 0)}`, 'এখনকার কাজ')}
      ${k('সফল', bn(q.done || 0))}
      ${k('ব্যর্থ / বাতিল', `${bn(q.failed || 0)} / ${bn(q.cancelled || 0)}`)}
      ${k('আনুমানিক মোট খরচ', taka(A.users.reduce((s, u) => s + u.cost, 0)))}
    </div><p class="muted small">এই সার্ভার: ${esc(sys.worker)}</p></section>
    <section class="card"><h3>ব্যবহারকারী</h3><div class="tscroll"><table>
      <thead><tr><th>ইমেইল</th><th>শেষ দেখা</th><th>ভিডিও</th><th>ছবি</th><th>খরচ</th><th>জায়গা</th></tr></thead>
      <tbody>${A.users.map(u => `<tr><td><b>${esc(u.name || '')}</b><div class="muted small">${esc(u.email)}</div></td><td class="small">${u.last ? esc(fmtTime(u.last)) : '—'}</td>
        <td class="tnum">${bn(u.videos)}</td><td class="tnum">${bn(u.images)}</td><td class="tnum">${taka(u.cost)}</td><td class="tnum">${fmtBytes(u.bytes)}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="card"><h3>কারা ঢুকতে পারবে</h3>
      <div class="row"><input id="alEmail" class="grow" type="email" placeholder="gmail ঠিকানা" aria-label="নতুন ইমেইল"><button class="pri" data-act="allow-add">যোগ করো</button></div>
      ${(al?.allowed || []).map(x => `<div class="setrow"><span class="grow">${esc(x.email)}</span></div>`).join('') || '<p class="muted small">কেউ যোগ করা নেই</p>'}
    </section>
    <section class="card"><h3>📨 অভিযোগ <span class="muted small">খোলা ${bn(S.staffC?.counts?.open || 0)} · দেখা হচ্ছে ${bn(S.staffC?.counts?.working || 0)} · সমাধান ${bn(S.staffC?.counts?.resolved || 0)}</span></h3>
      ${(S.staffC?.complaints || []).map(x => threadHtml(x, 'c-staff-reply')).join('') || '<p class="muted small">কোনো অভিযোগ নেই 🎉</p>'}</section>
    <section class="card"><h3>⏳ এখন চলমান/আটকে থাকা কাজ</h3>
      ${(S.staffJobs?.jobs || []).map(j => `<div class="setrow"><span class="grow"><b>${esc(j.label || j.kind)}</b><span class="muted small"> · ${esc(j.email || '')} · ${j.status === 'queued' ? 'সারিতে' : 'চলছে'} · <span class="tnum" data-since="${j.started || j.created}">${elapsed(j.started || j.created)}</span></span></span>
        <button class="sm bad" data-act="staff-cancel" data-id="${j.id}">বাতিল</button></div>`).join('') || '<p class="muted small">এখন কিছু চলছে না।</p>'}</section>
    <section class="card"><h3>সাম্প্রতিক কাজকর্ম</h3><div class="tscroll"><table>
      <thead><tr><th>সময়</th><th>কে</th><th>কী</th><th>বিস্তারিত</th></tr></thead>
      <tbody>${A.activity.map(a => `<tr><td class="small">${esc(fmtTime(a.created))}</td><td class="small">${esc(a.email || '—')}</td><td>${esc(ACTION_LABEL[a.action] || a.action)}</td><td class="small muted">${esc(a.detail || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">এখনো কিছু নেই</td></tr>'}</tbody></table></div></section>
  </div>`;
}

/* ---------- ইভেন্ট ---------- */
document.addEventListener('input', e => {
  if (e.target.dataset?.g === 'q') { S.q = e.target.value; renderGallery(); return; }
  if (e.target.dataset?.g === 'pnq') { S.panelQ = e.target.value; const pos = e.target.selectionStart; renderPanel(); const i = $('#pnQ'); i.focus(); i.setSelectionRange(pos, pos); return; }
  const k = e.target.dataset?.c;
  if (!k) return;
  const t = e.target;
  C[k] = t.type === 'checkbox' ? t.checked : t.type === 'range' || k === 'count' ? +t.value : t.value;
  if (k === 'prompt') saveDraft();
  if (k === 'duration') $('#durLab').textContent = bn(t.value);
});
document.addEventListener('change', e => {
  const k = e.target.dataset?.c;
  if (k && e.target.tagName === 'SELECT') C[k] = k === 'count' ? +e.target.value : e.target.value;
});
function showTip(bar) {
  const plot = bar.closest('.plot'), tip = plot?.querySelector('.tip');
  if (!tip) return;
  tip.textContent = bar.dataset.tip;
  tip.hidden = false;
  const pr = plot.getBoundingClientRect(), br = bar.getBoundingClientRect();
  const x = Math.min(Math.max(br.left - pr.left + br.width / 2, 70), pr.width - 70);
  tip.style.left = x + 'px';
}
function hideTip(bar) { const tip = bar.closest('.plot')?.querySelector('.tip'); if (tip) tip.hidden = true; }
document.addEventListener('focusin', e => { const b = e.target.closest?.('.bar'); if (b) showTip(b); });
document.addEventListener('focusout', e => { const b = e.target.closest?.('.bar'); if (b) hideTip(b); });
document.addEventListener('mouseover', e => {
  const bar = e.target.closest('.bar');
  if (bar) showTip(bar);
  const v = e.target.closest('.tile video');
  if (v && v.paused) v.play().catch(() => {});
});
document.addEventListener('mouseout', e => {
  const bar = e.target.closest('.bar');
  if (bar) hideTip(bar);
  const v = e.target.closest('.tile video');
  if (v && !v.paused) v.pause();
});

async function openProject(id) {
  S.pid = id; S.view = null;
  S.tab = 'studio';
  S.filter = 'all'; S.q = ''; S.trash = null; S.chat = null; S.pages = 1; S.cursor = null;
  C = { ...freshComposer(), aspect: C.aspect, resolution: C.resolution, duration: C.duration, imageModel: C.imageModel };
  C.prompt = loadDraft();
  $('#app').classList.remove('drawer');
  await act(async () => { await loadProject(); render(); schedulePoll(); });
}
function goHome() {
  S.pid = null; S.P = null; S.view = null;
  clearTimeout(S.pollTimer);
  $('#app').classList.remove('drawer');
  render();
}
function mentionIds(text) {
  const out = [];
  const norm = s => s.replace(/\s+/g, '').toLowerCase();
  for (const m of text.matchAll(/@([^\s@,।.!?]+)/g)) {
    const c = S.P.characters.find(x => norm(x.name) === norm(m[1]) || norm(x.name.split(/\s+/)[0]) === norm(m[1]));
    if (c && !out.includes(c.id)) out.push(c.id);
  }
  return out;
}

const handlers = {
  'lang': () => I18N.set(I18N.lang === 'en' ? 'bn' : 'en'),
  'set-lang': t => { if (t.dataset.v !== I18N.lang) I18N.set(t.dataset.v); },
  'help': () => openHelp(),
  'inst-hide': () => { try { localStorage.setItem('cp_inst_hide', '1'); } catch { /* কিছু না */ } renderMain(); },
  'guest-upgrade': () => act(async () => { await api('POST', '/api/logout'); location.href = '/login.html?switch=1'; }),
  'pn-guest': t => act(async () => { await api('PUT', '/api/owner/settings', { guest: t.dataset.v }); await openPanel(); }, 'সেভ হয়েছে'),
  'owner-panel': () => openPanel(),
  'ann-hide': t => { try { localStorage.setItem('cp_ann_hide', t.dataset.v); } catch { /* কিছু না */ } renderAnnounce(); },
  'switch-account': () => act(async () => {
    if (!confirm('এই অ্যাকাউন্ট থেকে বের হয়ে অন্য Gmail দিয়ে ঢুকবে?')) return;
    await api('POST', '/api/logout');
    location.href = '/login.html?switch=1';
  }),
  'c-new': () => act(async () => {
    await api('POST', '/api/complaints', { category: $('#cpCat').value, subject: $('#cpSub').value, text: $('#cpText').value });
    await openHelp();
  }, 'পাঠানো হয়েছে'),
  'c-reply': t => act(async () => { S.openThread = t.dataset.id; await api('POST', `/api/complaints/${t.dataset.id}/reply`, { text: $('#rp_' + t.dataset.id).value }); await openHelp(); }, 'পাঠানো হয়েছে'),
  'c-staff-reply': t => act(async () => { S.openThread = t.dataset.id; await api('POST', `/api/complaints/${t.dataset.id}/reply`, { text: $('#rp_' + t.dataset.id).value }); await openAdmin(); }, 'উত্তর পাঠানো হয়েছে'),
  'c-status': t => act(async () => { S.openThread = t.dataset.id; await api('PATCH', `/api/staff/complaints/${t.dataset.id}`, { status: t.dataset.v }); await openAdmin(); }, 'অবস্থা বদলেছে'),
  'staff-cancel': t => act(async () => { if (!confirm('এই কাজ বাতিল করবে?')) return; await api('POST', `/api/staff/jobs/${t.dataset.id}/cancel`); await openAdmin(); }, 'বাতিল হয়েছে'),
  'panel-unlock': () => act(async () => {
    const pw = $('#pnPass').value;
    $('#pnPass').value = '';
    if (!pw) throw new Error('পাসওয়ার্ড দাও');
    await api('POST', '/api/owner/unlock', { password: pw });
    await openPanel();
  }, 'কন্ট্রোল প্যানেল খুলেছে'),
  'panel-lock': () => act(async () => { await api('POST', '/api/owner/lock'); await openPanel(); }, 'বন্ধ হয়েছে'),
  'pn-role': t => act(async () => { await api('POST', `/api/owner/users/${t.dataset.id}/role`, { role: t.dataset.v }); await openPanel(); }, 'ভূমিকা বদলেছে'),
  'pn-kick': t => act(async () => {
    if (!confirm('এই ব্যবহারকারীকে সব ডিভাইস থেকে বের করে দেবে? (আবার লগইন করতে পারবে)')) return;
    await api('POST', `/api/owner/users/${t.dataset.id}/kick`); await openPanel();
  }, 'বের করে দেওয়া হয়েছে'),
  'pn-block': t => act(async () => {
    const reason = prompt('কেন ব্লক করছ? (ব্যবহারকারী লগইন করতে গেলে এটা দেখবে)', '');
    if (reason === null) return;
    await api('POST', `/api/owner/users/${t.dataset.id}/block`, { reason }); await openPanel();
  }, 'ব্লক করা হয়েছে'),
  'pn-unblock': t => act(async () => { await api('POST', `/api/owner/users/${t.dataset.id}/block`, { blocked: false }); await openPanel(); }, 'আনব্লক হয়েছে'),
  'pn-signup': t => act(async () => { await api('PUT', '/api/owner/settings', { signup: t.dataset.v }); await openPanel(); }, 'সেভ হয়েছে'),
  'pn-contact': () => act(async () => {
    const contact = {};
    for (const k of ['whatsapp', 'phone', 'email', 'facebook', 'telegram', 'youtube', 'note']) contact[k] = $('#pc_' + k).value.trim();
    await api('PUT', '/api/owner/settings', { contact });
    S.me = await api('GET', '/api/me'); await openPanel();
  }, 'যোগাযোগের তথ্য সেভ হয়েছে'),
  'pn-ann-mode': t => {
    S.annMode = t.dataset.v;
    t.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === t); b.setAttribute('aria-pressed', b === t); });
  },
  'pop-ok': t => { try { localStorage.setItem('cp_pop_seen', t.dataset.v); } catch { /* কিছু না */ } closeModal(); },
  'maint-retry': () => act(async () => { S.me = await api('GET', '/api/me'); renderTop(); }),
  'pn-brand': t => act(async () => {
    const kind = t.dataset.v;
    const f = await pickAnyImage();
    if (!f) return;
    toast('ছবি তৈরি হচ্ছে…');
    const out = await processBrand(kind, f);
    if (kind === 'owner' && out.framed && !confirm('এই ছবিতে ব্যাকগ্রাউন্ড আছে (স্বচ্ছ নয়), তাই গোল ফ্রেমে বসবে। ব্যাকগ্রাউন্ড ছাড়া (স্বচ্ছ PNG) ছবি দিলে বেশি সুন্দর হয়। এটাই বসাবে?')) return;
    for (const [slot, dataUrl] of Object.entries(out)) if (slot !== 'framed') await api('PUT', `/api/owner/brand/${slot}`, { dataUrl });
    if (kind === 'owner') await api('PUT', '/api/owner/brand-options', { framed: out.framed });
    S.me = await api('GET', '/api/me'); renderTop(); await openPanel();
  }, 'নতুন ছবি সব জায়গায় বসে গেছে'),
  'pn-brand-reset': t => act(async () => {
    const slots = { owner: ['owner', 'owner-sm'], art: ['art'], logo: ['logo', 'icon-512', 'icon-192', 'apple', 'maskable', 'favicon'] }[t.dataset.v];
    if (!confirm('আগের (আসল) ছবিতে ফিরবে?')) return;
    for (const slot of slots) await api('DELETE', `/api/owner/brand/${slot}`);
    if (t.dataset.v === 'owner') await api('PUT', '/api/owner/brand-options', { framed: false });
    S.me = await api('GET', '/api/me'); renderTop(); await openPanel();
  }, 'আগের ছবিতে ফেরানো হয়েছে'),
  'pn-framed': t => act(async () => { await api('PUT', '/api/owner/brand-options', { framed: t.checked }); S.me = await api('GET', '/api/me'); renderTop(); await openPanel(); }),
  'pn-texts': () => act(async () => {
    const texts = { ...(S.panel?.settings?.texts || {}) }; // অন্য ভাষার লেখা অক্ষত থাকে
    const sfx = I18N.lang === 'en' ? '_en' : '';
    for (const k of Object.keys(TEXT_LABEL)) { const v = $('#tx_' + k).value.trim(); if (v) texts[k + sfx] = v; else delete texts[k + sfx]; }
    await api('PUT', '/api/owner/settings', { texts });
    S.me = await api('GET', '/api/me'); renderTop(); await openPanel();
  }, 'লেখা সব জায়গায় বদলেছে'),
  'arr-move': t => {
    const i = S.arrange.findIndex(x => x.id === t.dataset.id), j = i + Number(t.dataset.v);
    if (j < 0 || j >= S.arrange.length) return;
    [S.arrange[i], S.arrange[j]] = [S.arrange[j], S.arrange[i]];
    rerenderArrange();
    $(`#arrGrid [data-id="${t.dataset.id}"] [data-act="arr-move"][data-v="${t.dataset.v}"]`)?.focus();
  },
  'arr-hide': t => { const x = S.arrange.find(y => y.id === t.dataset.id); x.hidden = !x.hidden; rerenderArrange(); },
  'arr-rename': t => {
    const x = S.arrange.find(y => y.id === t.dataset.id);
    const n = prompt('বোতামের নাম (খালি রাখলে আসল নাম)', x.label || TOOL_DEF[x.id][1]);
    if (n === null) return;
    x.label = n.trim() && n.trim() !== TOOL_DEF[x.id][1] ? n.trim().slice(0, 24) : undefined;
    rerenderArrange();
  },
  'arr-reset': () => { S.arrange = DEFAULT_LAYOUT.map(t => ({ ...t })); rerenderArrange(); },
  'arr-save': () => act(async () => {
    await api('PUT', '/api/owner/settings', { layout: S.arrange.map(({ id, hidden, label }) => ({ id, hidden, label })) });
    S.me = await api('GET', '/api/me'); S.arrange = null; await openPanel();
  }, 'হোম সেভ হয়েছে'),
  'pn-ann': () => act(async () => {
    await api('PUT', '/api/owner/settings', { announcement: { text: $('#pnAnn').value, level: $('#pnWarn').checked ? 'warn' : 'info', mode: S.annMode || S.panel?.settings?.announcement?.mode || 'bar' } });
    try { localStorage.removeItem('cp_ann_hide'); localStorage.removeItem('cp_pop_seen'); } catch { /* কিছু না */ }
    S.me = await api('GET', '/api/me'); renderTop(); await openPanel();
  }, 'ঘোষণা দেওয়া হয়েছে'),
  'pn-ann-clear': () => act(async () => { await api('PUT', '/api/owner/settings', { announcement: { text: '' } }); S.me = await api('GET', '/api/me'); renderTop(); await openPanel(); }, 'ঘোষণা মুছেছে'),
  'tool': t => act(async () => {
    const k = t.dataset.v;
    if (k === 'doc') return openDoc();
    if (k === 'help') return openHelp();
    if (k === 'voice') { await loadVoices().catch(() => {}); return docVoices(); }
    await ensureProject();
    if (k === 'image' || k === 'video') { S.tab = 'studio'; C.mode = k; renderMain(); setTimeout(() => $('#cPrompt')?.focus(), 50); return; }
    if (k === 'char') { S.tab = 'characters'; renderMain(); setTimeout(() => $('#ncName')?.focus(), 50); return; }
    if (k === 'story' || k === 'assistant' || k === 'timeline') { S.tab = k; renderMain(); return; }
    if (k === 'upload') return handlers['quick-upload']();
    if (k === 'avatar') return handlers.avatar();
    if (k === 'edit') {
      S.tab = 'studio'; renderMain();
      const r = await uploadImage(null);
      if (!r) return toast('একটা ছবি বাছো');
      await loadProject(); renderLive(); viewAsset(r.id);
      toast('✏️ বদলাও, কাটা বা বড় করা বেছে নাও');
    }
  }),
  'about': () => { S.view = 'about'; S.pid = null; S.P = null; clearTimeout(S.pollTimer); $('#app').classList.remove('drawer'); render(); },
  'pf-name': () => act(async () => {
    const n = prompt('প্রোফাইলে কোন নাম দেখাবে? (খালি রাখলে Gmail-এর নাম)', S.me.user.name);
    if (n === null) return;
    await api('PATCH', '/api/profile', { name: n });
    await openAccount();
  }, 'নাম বদলেছে'),
  'pf-photo': () => act(async () => {
    const f = await pickFile();
    if (!f) return;
    const dataUrl = await squarePhoto(f);
    await api('POST', '/api/profile/photo', { dataUrl });
    await openAccount();
  }, 'প্রোফাইল ছবি বদলেছে'),
  'pf-photo-del': () => act(async () => { await api('DELETE', '/api/profile/photo'); await openAccount(); }, 'Gmail-এর ছবিতে ফেরানো হয়েছে'),
  'drawer': () => $('#app').classList.toggle('drawer'),
  'home': goHome,
  'theme': () => {
    const t = document.documentElement.dataset.theme;
    const cur = t === 'light' || (t === 'auto' && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    setTheme(cur === 'dark' ? 'light' : 'dark');
  },
  'set-theme': t => { setTheme(t.dataset.v === 'dark' ? null : t.dataset.v); if (S.view === 'account') renderMain(); },
  'settings': openAccount,
  'account': openAccount,
  'admin': openAdmin,
  'notify-on': async () => {
    const r = await Notification.requestPermission().catch(() => 'denied');
    toast(r === 'granted' ? 'নোটিফিকেশন চালু হয়েছে' : 'নোটিফিকেশনের অনুমতি দেওয়া হয়নি', r !== 'granted');
    renderMain();
  },
  'logout-all': () => act(async () => {
    if (!confirm('সব ফোন আর কম্পিউটার থেকে লগআউট হবে (এটা বাদে)। নিশ্চিত?')) return;
    await api('POST', '/api/account/logout-all');
  }, 'অন্য সব জায়গা থেকে লগআউট হয়েছে'),
  'account-delete': () => act(async () => {
    const email = $('#delConfirm').value.trim();
    if (email.toLowerCase() !== S.me.user.email) throw new Error('নিজের ইমেইল ঠিকঠাক লেখো');
    if (!confirm('সব কিছু চিরতরে মুছে যাবে। মুছবে?')) return;
    await api('POST', '/api/account/delete', { confirm: email });
    location.href = '/login.html';
  }),
  'cancel-job': t => act(async () => {
    const r = await api('POST', `/api/jobs/${t.dataset.id}/cancel`);
    S.P.jobs = S.P.jobs.filter(j => j.id !== t.dataset.id);
    renderJobs();
    toast(r.note || 'বাতিল হয়েছে');
  }),
  'retry-job': t => act(async () => {
    await api('POST', `/api/jobs/${t.dataset.id}/retry`);
    await loadProject(); renderLive(); schedulePoll();
  }, 'আবার চেষ্টা শুরু হয়েছে'),
  'load-more': t => act(async () => {
    if (!S.cursor) return;
    t.disabled = true; t.textContent = 'আনা হচ্ছে...';
    await morePage(S.P, S.pid);
    S.pages++;
    renderGallery();
  }),
  'export': () => { location.href = `/api/projects/${S.pid}/export`; toast('ZIP নামছে'); },
  'close': closeModal,
  'modal-bg': (t, e) => { if (e.target === t) closeModal(); },
  'logout': () => act(async () => { await api('POST', '/api/logout'); location.href = '/login.html'; }),
  'allow-add': () => act(async () => {
    await api('POST', '/api/admin/allowed', { email: $('#alEmail').value });
    await (S.view === 'panel' ? openPanel() : openAdmin());
  }, 'যোগ হয়েছে'),
  'allow-del': t => act(async () => { await api('DELETE', `/api/owner/allowed/${encodeURIComponent(t.dataset.v)}`); await openPanel(); }),

  'new-project': () => act(async () => {
    const name = prompt('প্রজেক্টের নাম', 'নতুন প্রজেক্ট');
    if (name === null) return;
    const folderId = S.P?.project.folder_id || null;
    const r = await api('POST', '/api/projects', { name, folderId });
    await loadLib();
    await openProject(r.id);
  }),
  'new-folder': () => act(async () => {
    const name = prompt('ফোল্ডারের নাম');
    if (!name) return;
    await api('POST', '/api/folders', { name });
    await loadLib(); render();
  }),
  'rename-folder': t => act(async () => {
    const f = S.lib.folders.find(x => x.id === t.dataset.id);
    const name = prompt('নতুন নাম', f?.name || '');
    if (!name) return;
    await api('PATCH', `/api/folders/${t.dataset.id}`, { name });
    await loadLib(); render();
  }),
  'del-folder': t => act(async () => {
    if (!confirm('ফোল্ডার মুছবে? ভেতরের প্রজেক্টগুলো মুছবে না, "ফোল্ডার ছাড়া"-তে চলে যাবে।')) return;
    await api('DELETE', `/api/folders/${t.dataset.id}`);
    await loadLib(); render();
  }),
  'toggle-folder': t => { S.open[t.dataset.id] = !(S.open[t.dataset.id] ?? true); renderSide(); },
  'open-project': t => openProject(t.dataset.id),
  'project-menu': () => {
    const p = S.P.project;
    openModal(`<div style="padding:18px"><div class="row"><h3 class="grow" style="margin:0">প্রজেক্ট</h3><button class="sm ghost" data-act="close">✕</button></div>
      <label class="lab">নাম</label><input id="pmName" value="${esc(p.name)}">
      <label class="lab">ফোল্ডার</label><select id="pmFolder"><option value="">ফোল্ডার ছাড়া</option>${S.lib.folders.map(f => `<option value="${f.id}" ${f.id === p.folder_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      <div class="row" style="margin-top:14px"><button class="pri" data-act="project-save">সেভ</button><span class="grow"></span><button class="bad" data-act="project-del">প্রজেক্ট মুছো</button></div></div>`);
  },
  'project-save': () => act(async () => {
    await api('PATCH', `/api/projects/${S.pid}`, { name: $('#pmName').value, folderId: $('#pmFolder').value || null });
    closeModal();
    await Promise.all([loadLib(), loadProject()]);
    render();
  }, 'সেভ হয়েছে'),
  'project-del': () => act(async () => {
    if (!confirm('পুরো প্রজেক্ট, সব ভিডিও, ছবি আর চরিত্র মুছে যাবে। নিশ্চিত?')) return;
    await api('DELETE', `/api/projects/${S.pid}`);
    closeModal();
    await loadLib();
    goHome();
  }),
  'tab': t => { S.tab = t.dataset.v; renderMain(); },
  'filter': t => { S.filter = t.dataset.v; if (S.filter === 'trash') S.trash = null; renderFilters(); renderGallery(); },
  'toggle-composer': () => { C.expanded = !C.expanded; renderComposer(); },
  'pick-ings': openIngPicker,
  'close-ings': () => { closeModal(); renderComposerChars(); },
  'toggle-ing': t => {
    const id = t.dataset.id;
    if (C.ings.includes(id)) C.ings = C.ings.filter(x => x !== id);
    else if (refCount(C.chars, [...C.ings, id]) > (C.mode === 'image' ? 14 : 6)) return toast(`আর জায়গা নেই: ${C.mode === 'image' ? 'ছবিতে ১৪টি' : 'ভিডিওতে ৬টি'} রেফারেন্স ছবি পর্যন্ত যায়`, true);
    else C.ings.push(id);
    if (S.pickerOpen) openIngPicker(); else renderComposerChars();
  },
  'upload-ing': () => act(async () => {
    const r = await uploadImage(null);
    if (!r) return;
    await loadProject();
    if (refCount(C.chars, [...C.ings, r.id]) <= (C.mode === 'image' ? 14 : 6)) C.ings.push(r.id);
    openIngPicker();
  }, 'ছবি যোগ হয়েছে'),
  'new-collection': () => act(async () => {
    const name = prompt('কালেকশনের নাম, যেমন: এপিসোড ১ এর শট');
    if (!name) return;
    const r = await api('POST', `/api/projects/${S.pid}/collections`, { name });
    await loadProject();
    S.filter = 'col:' + r.id;
    if ($('#modal').innerHTML) { closeModal(); }
    S.tab = 'studio'; renderMain();
  }),
  'col-rename': t => act(async () => {
    const c = S.P.collections.find(x => x.id === t.dataset.id);
    const name = prompt('নতুন নাম', c?.name || '');
    if (!name) return;
    await api('PATCH', `/api/collections/${t.dataset.id}`, { name });
    await loadProject(); renderFilters();
  }),
  'col-del': t => act(async () => {
    if (!confirm('কালেকশন মুছবে? ভেতরের ফাইলগুলো মুছবে না।')) return;
    await api('DELETE', `/api/collections/${t.dataset.id}`);
    S.filter = 'all';
    await loadProject(); renderFilters(); renderGallery();
  }),
  'col-toggle': t => act(async () => {
    const c = S.P.collections.find(x => x.id === t.dataset.v);
    await api('POST', `/api/collections/${c.id}/items`, { assetId: t.dataset.id, add: !c.items.includes(t.dataset.id) });
    await loadProject(); viewAsset(t.dataset.id, S.viewPanel); renderFilters(); renderGallery();
  }),
  'rename-asset': t => act(async () => {
    const a = S.P.assets.find(x => x.id === t.dataset.id);
    const title = prompt('নতুন নাম', a?.title || '');
    if (title === null) return;
    await api('PATCH', `/api/assets/${a.id}`, { title });
    await loadProject(); viewAsset(a.id); renderLive();
  }),
  'restore': t => act(async () => {
    await api('POST', `/api/assets/${t.dataset.id}/restore`);
    S.trash = null; await loadProject(); renderFilters(); renderGallery();
  }, 'ফেরত আনা হয়েছে'),
  'purge': t => act(async () => {
    if (!confirm('চিরতরে মুছে যাবে, আর ফেরত আনা যাবে না। নিশ্চিত?')) return;
    await api('DELETE', `/api/assets/${t.dataset.id}?forever=1`);
    S.trash = null; await loadProject(); renderFilters(); renderGallery();
  }),
  'empty-trash': () => act(async () => {
    if (!confirm('ট্র্যাশের সব ফাইল চিরতরে মুছে যাবে। নিশ্চিত?')) return;
    await api('DELETE', `/api/projects/${S.pid}/trash`);
    S.trash = null; await loadProject(); renderFilters(); renderGallery();
  }),
  'preset': t => {
    const [n, d] = CHAR_PRESETS[+t.dataset.v];
    if (!$('#ncName').value.trim()) $('#ncName').value = n;
    $('#ncDesc').value = d;
    $('#ncDesc').focus();
  },
  'ref-from-project': t => {
    const imgs = S.P.assets.filter(a => a.kind === 'image' && !a.character_id);
    openModal(`<div class="row" style="padding:14px 14px 0"><h3 class="grow" style="margin:0">রেফারেন্স ছবি বেছে নাও</h3><button class="sm ghost" data-act="close">✕</button></div>
      <div class="picker">${imgs.map(a => `<div class="tile" data-act="ref-pick" data-id="${a.id}" data-v="${t.dataset.id}"><img src="${media(a.id)}" alt="" loading="lazy"><div class="cap">${esc(a.title || a.prompt)}</div></div>`).join('') || '<p class="muted">এই প্রজেক্টে কোনো ছবি নেই।</p>'}</div>`);
  },
  'ref-pick': t => act(async () => {
    await api('POST', `/api/assets/${t.dataset.id}/to-character`, { characterId: t.dataset.v });
    closeModal(); await loadProject(); renderCharGrid();
  }, 'চরিত্রের রেফারেন্সে যোগ হয়েছে'),
  'chat-send': () => sendChat($('#chatIn').value),
  'chat-suggest': t => sendChat(t.dataset.v),
  'chat-clear': () => act(async () => { S.chat = (await api('DELETE', `/api/projects/${S.pid}/chat`)).messages; renderChatLog(); }),
  'use-prompt': t => {
    C.prompt = S.chatPrompts[+t.dataset.id] || '';
    C.mode = t.dataset.v === 'image' ? 'image' : 'video';
    S.tab = 'studio'; renderMain();
    toast('প্রম্পট বসানো হয়েছে');
  },

  'mode': t => {
    C.mode = t.dataset.v;
    if (C.mode === 'frames' && C.last) C.duration = Math.min(C.duration, 10);
    renderComposer();
  },
  'toggle-char': t => {
    const id = t.dataset.id;
    const max = C.mode === 'image' ? 4 : 2;
    if (C.chars.includes(id)) C.chars = C.chars.filter(x => x !== id);
    else if (C.chars.length >= max) return toast(`সর্বোচ্চ ${bn(max)} জন চরিত্র বাছা যায়`, true);
    else if (refCount([...C.chars, id], C.ings) > (C.mode === 'image' ? 14 : 6)) return toast('রেফারেন্সের জায়গা নেই', true);
    else C.chars.push(id);
    if (S.pickerOpen) openIngPicker(); else renderComposerChars();
  },
  'pick-frame': (t, e) => {
    if (e.target.closest('[data-act="clear-frame"]')) return;
    const key = t.dataset.v;
    const imgs = S.P.assets.filter(a => a.kind === 'image');
    openModal(`<div class="row" style="padding:14px 14px 0"><h3 class="grow" style="margin:0">${key === 'first' ? 'শুরুর' : 'শেষের'} ছবি বেছে নাও</h3>
        <button class="sm pri" data-act="upload-frame" data-v="${key}">⬆️ আপলোড</button><button class="sm ghost" data-act="close">✕</button></div>
      <div class="picker">${imgs.map(a => `<div class="tile" data-act="set-frame" data-v="${key}" data-id="${a.id}"><img src="${media(a.id)}" alt="" loading="lazy"></div>`).join('') || '<p class="muted">এই প্রজেক্টে কোনো ছবি নেই। আপলোড করো বা "ছবি" মোডে বানাও।</p>'}</div>`);
  },
  'set-frame': t => { C[t.dataset.v] = t.dataset.id; closeModal(); renderComposer(); },
  'clear-frame': t => { C[t.dataset.v] = null; renderComposer(); },
  'upload-frame': t => act(async () => {
    const r = await uploadImage(null);
    if (!r) return;
    await loadProject();
    C[t.dataset.v] = r.id;
    closeModal();
    renderStudio();
  }),
  'enhance': () => act(async () => {
    if (!C.prompt.trim()) throw new Error('আগে কিছু লেখো');
    C.busy = true; renderComposer();
    try {
      const chars = [...new Set([...C.chars, ...mentionIds(C.prompt)])];
      const r = await api('POST', '/api/enhance', { prompt: C.prompt, kind: C.mode === 'image' ? 'image' : 'video', projectId: S.pid, characterIds: chars });
      C.prompt = r.prompt;
    } finally { C.busy = false; renderComposer(); }
  }, 'প্রম্পট উন্নত হয়েছে'),
  'generate': () => act(async () => {
    if (!C.prompt.trim()) throw new Error('কী বানাতে চাও লেখো');
    if (C.mode === 'frames' && !C.first) throw new Error('শুরুর ছবি বেছে নাও');
    const max = C.mode === 'image' ? 4 : 2;
    const chars = [...new Set([...C.chars, ...mentionIds(C.prompt)])].slice(0, max);
    const noRefs = chars.map(id => S.P.characters.find(c => c.id === id)).filter(c => c && !c.images.length);
    if (noRefs.length && !confirm(`${noRefs.map(c => c.name).join(', ')}-এর কোনো রেফারেন্স ছবি নেই, তাই চেহারা এক থাকবে না। তবুও বানাবে?`)) return;
    C.busy = true; renderComposer();
    try {
      await api('POST', `/api/projects/${S.pid}/generate`, {
        mode: C.mode, prompt: C.prompt, characterIds: C.mode === 'frames' ? [] : chars,
        ingredientIds: C.mode === 'frames' ? [] : C.ings, imageModel: C.imageModel,
        firstFrameId: C.first, lastFrameId: C.last,
        aspect: C.mode === 'image' ? C.imgAspect : C.aspect, duration: C.duration, resolution: C.resolution,
        camera: C.camera, style: C.style, avoid: C.avoid, singleShot: C.singleShot, count: C.count,
      });
      clearDraft();
      // ফোনে সেটিং খোলা থাকলে নিচের কাজের কার্ড ঢাকা পড়ে: পাঠানোর পর বন্ধ, যাতে কাজ আর "বাতিল" দেখা যায়
      if (matchMedia('(max-width:860px)').matches) C.expanded = false;
      S.me = await api('GET', '/api/me');
      await loadProject();
    } finally { C.busy = false; renderComposer(); renderLive(); schedulePoll(); }
  }, 'কাজ শুরু হয়েছে। তৈরি হলে এখানে দেখাবে।'),
  'dismiss-job': t => act(async () => { await api('POST', `/api/jobs/${t.dataset.id}/dismiss`); S.P.jobs = S.P.jobs.filter(j => j.id !== t.dataset.id); renderJobs(); }),

  'view': t => viewAsset(t.dataset.id),
  'share': t => act(async () => {
    const a = S.P.assets.find(x => x.id === t.dataset.id);
    const blob = await (await fetch(media(a.id), { credentials: 'same-origin' })).blob();
    const ext = a.kind === 'video' ? 'mp4' : (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const file = new File([blob], `ruvo-${a.id}.${ext}`, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: a.title || 'Ruvo' }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    } else {
      location.href = media(a.id) + '?dl=1';
      toast('ডাউনলোড হচ্ছে');
    }
  }),
  'crop': t => act(async () => {
    const a = S.P.assets.find(x => x.id === t.dataset.id);
    const [w, h] = t.dataset.v.split(':').map(Number);
    const img = new Image();
    img.src = media(a.id);
    await img.decode();
    let cw = img.naturalWidth, ch = Math.round(cw * h / w);
    if (ch > img.naturalHeight) { ch = img.naturalHeight; cw = Math.round(ch * w / h); }
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    cv.getContext('2d').drawImage(img, (img.naturalWidth - cw) / 2, (img.naturalHeight - ch) / 2, cw, ch, 0, 0, cw, ch);
    const dataUrl = cw * ch > 2e6 ? cv.toDataURL('image/jpeg', 0.92) : cv.toDataURL('image/png');
    const r = await api('POST', `/api/projects/${S.pid}/upload`, { dataUrl, parentId: a.id, aspect: t.dataset.v, name: `${a.title || 'ছবি'} (${bn(t.dataset.v)})` });
    await loadProject(); renderLive(); viewAsset(r.id);
  }, 'কাটা ছবি নতুন ভার্সন হিসেবে রাখা হয়েছে'),
  'plus': () => {
    const inP = Boolean(S.P);
    const it = (a, icon, label, v = '') => `<button class="pitem" data-act="${a}" ${v ? `data-v="${v}"` : ''}><span>${icon}</span>${label}</button>`;
    openModal(`<div class="sheet"><div class="row"><b class="grow">কী করতে চাও?</b><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
      ${inP ? `<h4>এই প্রজেক্টে (${esc(S.P.project.name)})</h4><div class="pgrid">
        ${it('quick', '🎥', 'ভিডিও', 'video')}${it('quick', '🖼️', 'ছবি', 'image')}${it('quick', '🎞️', 'ফ্রেম থেকে ভিডিও', 'frames')}
        ${it('goto', '🧑', 'নতুন চরিত্র', 'characters')}${it('avatar', '🤳', 'আমার অবতার')}${it('quick-upload', '⬆️', 'ছবি আপলোড')}
        ${it('new-collection', '📁', 'কালেকশন')}${it('goto', '📖', 'এপিসোড লেখো', 'story')}${it('goto', '💬', 'সহকারী', 'assistant')}
        ${it('goto', '🎬', 'দৃশ্যক্রম', 'timeline')}${it('filter-go', '🗑', 'ট্র্যাশ', 'trash')}${it('export', '⬇️', 'সব ফাইল ZIP')}${it('project-menu', '⋯', 'প্রজেক্ট সেটিং')}</div>` : ''}
      <h4>সাধারণ</h4><div class="pgrid">${it('doc', '🎞️', 'ডকুমেন্টারি স্টুডিও')}${it('new-project', '➕', 'নতুন প্রজেক্ট')}${it('new-folder', '📂', 'নতুন ফোল্ডার')}${it('home', '🏠', 'সব প্রজেক্ট')}
        ${it('account', '👤', 'অ্যাকাউন্ট ও ব্যবহার')}${S.me.user.staff ? it('admin', '🛡️', 'অ্যাডমিন') : ''}${it('install', '📲', 'অ্যাপ ইনস্টল')}${it('theme', '🌓', 'থিম বদলাও')}${it('about', 'ℹ️', 'সম্পর্কে')}${it('help', '💬', 'সাহায্য ও যোগাযোগ')}${it('switch-account', '🔁', 'অ্যাকাউন্ট বদলাও')}${S.me.user.owner ? it('owner-panel', '🔐', 'মালিকের কন্ট্রোল') : ''}</div></div>`, 'sheetbox');
  },
  'quick': t => {
    S.tab = 'studio'; C.mode = t.dataset.v;
    renderMain();
    setTimeout(() => $('#cPrompt')?.focus(), 50);
  },
  'goto': t => {
    S.tab = t.dataset.v; renderMain();
    if (t.dataset.v === 'characters') setTimeout(() => $('#ncName')?.focus(), 50);
  },
  'filter-go': t => { S.tab = 'studio'; S.filter = t.dataset.v; S.trash = null; renderMain(); },
  'quick-upload': () => act(async () => {
    const r = await uploadImage(null);
    if (!r) return;
    await loadProject();
    S.tab = 'studio'; renderMain();
  }, 'ছবি যোগ হয়েছে'),
  'install': async () => {
    if (S.installEvt) {
      S.installEvt.prompt();
      const r = await S.installEvt.userChoice.catch(() => ({}));
      S.installEvt = null;
      if (r.outcome === 'accepted') toast('ইনস্টল হচ্ছে');
      return;
    }
    if (matchMedia('(display-mode: standalone)').matches) return toast('অ্যাপ হিসেবেই খোলা আছে');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openModal(`<div style="padding:18px"><div class="row"><h3 class="grow" style="margin:0">📲 অ্যাপ হিসেবে ইনস্টল</h3><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
      ${ios ? '<p>Safari-তে নিচের <b>শেয়ার ⬆️</b> বোতাম চাপো, তারপর <b>Add to Home Screen</b>।</p>'
            : '<p>Chrome-এর উপরে ডানে <b>⋮</b> মেনু চাপো, তারপর <b>Install app</b> বা <b>Add to Home screen</b>।</p>'}
      <p class="muted small">ইনস্টলের পর Ruvo আলাদা অ্যাপের মতো খোলে, ব্রাউজারের ঠিকানার ঘর থাকে না, আর ডেস্কটপ মোড লাগে না।</p></div>`);
  },
  'panel': t => viewAsset(t.dataset.id, t.dataset.v),
  'fav': t => act(async () => {
    const a = S.P.assets.find(x => x.id === t.dataset.id);
    await api('PATCH', `/api/assets/${a.id}`, { favorite: !a.favorite });
    a.favorite = a.favorite ? 0 : 1;
    viewAsset(a.id, S.viewPanel); renderLive();
  }),
  'reuse': t => {
    const a = S.P.assets.find(x => x.id === t.dataset.id);
    C.prompt = a.prompt || '';
    C.mode = a.kind === 'image' ? 'image' : 'video';
    if (a.meta?.characterIds) C.chars = a.meta.characterIds.slice();
    C.ings = (a.meta?.ingredientIds || []).slice();
    closeModal(); S.tab = 'studio'; renderMain();
  },
  'remix': t => act(async () => {
    const text = $('#rxText')?.value || '';
    const duration = $('#rxDur') ? +$('#rxDur').value : undefined;
    await api('POST', `/api/assets/${t.dataset.id}/remix`, { action: t.dataset.v, prompt: text, duration, aspect: $('#rxAspect')?.value || undefined, size: t.dataset.size, imageModel: C.imageModel });
    closeModal();
    S.me = await api('GET', '/api/me');
    await loadProject(); renderMain(); schedulePoll();
  }, 'কাজ শুরু হয়েছে'),
  'as-frame': t => { C.mode = 'frames'; C[t.dataset.v] = t.dataset.id; closeModal(); S.tab = 'studio'; renderMain(); },
  'to-char': t => act(async () => {
    await api('POST', `/api/assets/${t.dataset.id}/to-character`, { characterId: t.dataset.v });
    await loadProject(); viewAsset(t.dataset.id);
  }, 'চরিত্রের রেফারেন্সে যোগ হয়েছে'),
  'del-asset': t => act(async () => {
    await api('DELETE', `/api/assets/${t.dataset.id}`);
    closeModal();
    S.trash = null;
    await loadProject(); renderLive(); loadLib().then(renderSide);
  }, 'ট্র্যাশে ফেলা হয়েছে। চাইলে ট্র্যাশ থেকে ফেরত আনা যাবে।'),
  'clip-toggle': t => act(async () => {
    const id = t.dataset.id;
    const clips = S.P.clips.includes(id) ? S.P.clips.filter(x => x !== id) : [...S.P.clips, id];
    await saveClips(clips);
    if ($('#modal').innerHTML) viewAsset(id, S.viewPanel);
    if (S.tab === 'timeline') renderTimeline();
  }),
  'clip-move': t => act(async () => {
    const clips = S.P.clips.slice();
    const i = clips.indexOf(t.dataset.id);
    const j = i + +t.dataset.v;
    if (i < 0 || j < 0 || j >= clips.length) return;
    [clips[i], clips[j]] = [clips[j], clips[i]];
    await saveClips(clips);
    renderTimeline();
  }),
  'play-all': playAll,

  'new-char': () => act(async () => {
    const name = $('#ncName').value.trim();
    if (!name) throw new Error('চরিত্রের নাম দাও');
    await api('POST', `/api/projects/${S.pid}/characters`, { name, description: $('#ncDesc').value });
    await loadProject(); renderCharacters();
  }, 'চরিত্র যোগ হয়েছে'),
  'edit-char': t => act(() => openCharEditor(t.dataset.id)),
  'save-char': t => act(async () => {
    await api('PATCH', `/api/characters/${t.dataset.id}`, charFields());
    closeModal(); await loadProject(); if (S.tab === 'characters') renderCharacters(); else renderLive();
  }, 'সেভ হয়েছে'),
  'del-char': t => act(async () => {
    if (!confirm('চরিত্র আর তার রেফারেন্স ছবি মুছে যাবে। নিশ্চিত?')) return;
    await api('DELETE', `/api/characters/${t.dataset.id}`);
    closeModal(); await loadProject(); renderCharacters();
  }),
  'upload-ref': t => act(async () => {
    await saveCharSilently(t.dataset.id);
    const r = await uploadImage(t.dataset.id);
    if (!r) return;
    await loadProject(); renderCharGrid();
  }, 'ছবি যোগ হয়েছে'),
  'gen-ref': t => act(async () => {
    await saveCharSilently(t.dataset.id);
    await api('POST', `/api/characters/${t.dataset.id}/generate`, { view: t.dataset.v || 'portrait', imageModel: C.imageModel });
    S.me = await api('GET', '/api/me');
    await loadProject(); renderCharGrid(); schedulePoll();
  }, 'ছবি তৈরি শুরু হয়েছে, তৈরি হলে এখানে দেখাবে'),
  'del-ref': t => act(async () => {
    await saveCharSilently(t.dataset.id);
    await api('DELETE', `/api/characters/${t.dataset.id}/images/${t.dataset.v}`);
    await loadProject(); renderCharGrid();
  }),
  'voice-play': () => {
    const v = $('#ecVoice').value;
    if (!v) return toast('আগে একটা কণ্ঠ বাছো', true);
    const au = $('#vPrev');
    au.onerror = () => toast('কণ্ঠ শোনা যায়নি', true);
    au.src = `/api/voices/${encodeURIComponent(v)}/preview`;
    au.play().catch(() => {});
    toast(`${v}-এর কণ্ঠ আসছে...`);
  },
  'avatar': () => {
    openModal(`<div style="padding:16px"><div class="row"><h3 class="grow" style="margin:0">🤳 আমার ছবি থেকে অবতার</h3><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
      <p class="muted small">নিজের একটা পরিষ্কার মুখের ছবি দাও। AI সেই চেহারা রেখে বাছাই করা স্টাইলে চরিত্র বানাবে।</p>
      <label class="lab" for="avName">চরিত্রের নাম</label><input id="avName" value="${esc(S.me.user.name.split(' ')[0] || 'আমি')}">
      <label class="lab" for="avStyle">স্টাইল</label><select id="avStyle"><option value="real">বাস্তব, সিনেমার মতো</option><option value="3d">৩D অ্যানিমেশন</option><option value="anime">অ্যানিমে</option><option value="paint">জলরঙের ছবি</option></select>
      <button class="pri" style="margin-top:12px;width:100%" data-act="avatar-go">📷 ছবি বেছে নাও ও বানাও</button></div>`);
  },
  'avatar-go': () => act(async () => {
    const name = $('#avName').value, style = $('#avStyle').value;
    const f = await pickFile();
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    const r = await api('POST', `/api/projects/${S.pid}/avatar`, { dataUrl, name, style });
    closeModal();
    S.me = await api('GET', '/api/me');
    await loadProject();
    S.tab = 'characters'; renderMain(); schedulePoll();
    openCharEditor(r.characterId);
  }, 'অবতার তৈরি শুরু হয়েছে'),

  'save-story': () => act(async () => {
    const r = await api('PUT', `/api/projects/${S.pid}/story`, { genre: $('#stGenre').value, premise: $('#stPremise').value });
    S.P.story = { ...S.P.story, ...r.story };
  }, 'সেভ হয়েছে'),
  'write-episode': () => act(async () => {
    // ঘরগুলো আবার আঁকার আগেই লেখা পড়ে নাও, নইলে মুছে যাবে
    const direction = $('#stDir').value;
    const settings = { genre: $('#stGenre').value, premise: $('#stPremise').value };
    S.P.story = { ...S.P.story, ...settings };
    S.writing = true; renderStory();
    try {
      await api('PUT', `/api/projects/${S.pid}/story`, settings);
      const r = await api('POST', `/api/projects/${S.pid}/story/episodes`, { direction });
      S.P.story = r.story;
    } finally { S.writing = false; if (S.tab === 'story') renderStory(); }
  }, 'নতুন এপিসোড লেখা হয়েছে'),
  'del-episode': t => act(async () => {
    if (!confirm('এপিসোড মুছবে?')) return;
    const r = await api('DELETE', `/api/projects/${S.pid}/story/episodes/${t.dataset.id}`);
    S.P.story = r.story; renderStory();
  }),
  'scene-to-studio': t => {
    const ep = S.P.story.episodes.find(e => e.id === t.dataset.id);
    const sc = ep?.scenes.find(s => s.no === +t.dataset.v);
    if (!sc) return;
    C.mode = 'video';
    C.prompt = sc.video_prompt;
    const norm = s => s.replace(/\s+/g, '').toLowerCase();
    C.chars = S.P.characters.filter(c => (sc.characters || []).some(n => norm(n) === norm(c.name))).map(c => c.id).slice(0, 2);
    S.tab = 'studio'; renderMain();
    toast('দৃশ্যের প্রম্পট বসানো হয়েছে');
  },
};

document.addEventListener('submit', e => e.preventDefault());
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = handlers[t.dataset.act];
  if (!fn) return;
  if (t.dataset.act !== 'modal-bg') e.preventDefault();
  if (t.closest('.sheet') && t.dataset.act !== 'close') closeModal();
  fn(t, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal').innerHTML) closeModal();
  if (e.key === 'Enter' && e.target.id === 'pnPass') { e.preventDefault(); handlers['panel-unlock'](); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'cPrompt') handlers.generate();
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chatIn') { e.preventDefault(); handlers['chat-send'](); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });

const splashStart = Date.now();
function hideSplash() {
  const el = $('#splash');
  if (!el) return;
  let first = true;
  try { first = !sessionStorage.getItem('cp_splash'); sessionStorage.setItem('cp_splash', '1'); } catch { /* স্টোরেজ বন্ধ */ }
  const wait = first ? Math.max(0, 2000 - (Date.now() - splashStart)) : 0;
  setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 450); }, wait);
}
(async function init() {
  try {
    S.me = await api('GET', '/api/me');
    C.imageModel = S.me.models.image;
    await loadLib();
    render();
  } catch (e) {
    $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  } finally { hideSplash(); }
})();
