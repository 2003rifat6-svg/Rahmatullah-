'use strict';
/* ডকুমেন্টারি স্টুডিও: আলাদা চ্যাট, ফাইল আর ধাপ। app.js-এর সাধারণ জিনিস ($, esc, bn, api, toast, handlers...) ব্যবহার করে। */
const D = { list: null, info: null, pid: null, data: null, pane: 'chat', timer: null, sending: false, lastSeq: 0 };
const DOC_STEPS = [
  ['1', 'নিরাপত্তা যাচাই'], ['2', 'টপিকের প্রমাণ ও প্রতিযোগী'], ['3', 'রিসার্চ ও উৎস'], ['4', 'স্ক্রিপ্ট ও ভয়েস-টেক্সট'],
  ['4b', 'কণ্ঠ/ছবি/ক্লিপ/মিউজিক কোথা থেকে'], ['5', 'অডিও যাচাই'], ['6', 'অডিও পরিষ্কার ও সাবটাইটেল'], ['7', 'স্টাইল ও চরিত্রের শিট'],
  ['8', 'শট লিস্ট ও কন্টাক্ট শিট'], ['9', 'ভিডিও ক্লিপ ও গ্রাফিক্স'], ['10', 'জোড়া, রং, সাউন্ড, মিক্স'], ['11', 'মান যাচাই'],
  ['12', 'থাম্বনেইল'], ['13', 'YouTube প্যাকেজ ও SRT'], ['14', 'ফাইল দেওয়া'], ['15', 'শেখা নিয়ম সেভ'],
];
const STEP_ICON = { todo: '○', doing: '◐', done: '●', blocked: '⚠' };
const FILE_ICON = { image: '🖼️', video: '🎥', audio: '🎙️', text: '📄' };
const fmtSize = b => (b >= 1048576 ? bn((b / 1048576).toFixed(1)) + ' MB' : bn(Math.max(1, Math.round(b / 1024))) + ' KB');

async function openDoc(pid = null) {
  S.view = 'doc'; S.pid = null; S.P = null; clearTimeout(S.pollTimer);
  D.pid = pid; D.data = null; D.pane = 'chat'; D.lastSeq = 0;
  $('#app').classList.remove('drawer');
  render();
  await act(async () => {
    if (pid) await loadDoc(); else { const r = await api('GET', '/api/doc/projects'); D.list = r.projects; D.info = r; }
    if (S.view === 'doc') renderMain();
  });
}
async function loadDoc() {
  const pid = D.pid;
  const d = await api('GET', `/api/doc/projects/${pid}`);
  if (D.pid !== pid) return;
  const grew = !D.data || d.messages.length !== D.data.messages.length || d.project.busy !== D.data.project.busy;
  D.data = d;
  scheduleDocPoll();
  return grew;
}
function docBusy() { return D.data && (D.data.project.busy || D.data.files.some(f => f.status === 'pending')); }
function scheduleDocPoll() {
  clearTimeout(D.timer);
  if (S.view === 'doc' && D.pid && docBusy()) {
    D.timer = setTimeout(async () => {
      try { if (await loadDoc()) renderDocLive(); else renderDocFiles(); } catch { scheduleDocPoll(); }
    }, 2000);
  }
}

function renderDoc() {
  if (!D.pid) return renderDocList();
  if (!D.data) { $('#main').innerHTML = `<div class="page">${pageHead('ডকুমেন্টারি স্টুডিও')}<p class="muted">লোড হচ্ছে...</p></div>`; return; }
  const p = D.data.project;
  $('#main').innerHTML = `<div class="docwrap">
    <div class="dochead"><button class="sm ghost" data-act="doc-home" aria-label="ফিরে যাও">←</button>
      <h2 class="grow">${esc(p.name)}</h2>
      <button class="sm" data-act="doc-budget" title="বাজেট বদলাও">💰 <span class="tnum">$${p.spent_usd.toFixed(2)} / $${p.budget_usd.toFixed(2)}</span></button>
      <button class="sm" data-act="doc-voices" title="কণ্ঠের নমুনা শোনো">🎙️</button>
      <a class="btn sm" href="/api/doc/projects/${p.id}/export" download title="সব ফাইল ZIP">⬇️ ZIP</a>
      <button class="sm" data-act="doc-menu" aria-label="প্রজেক্ট মেনু">⋯</button></div>
    <div class="seg docpanes" role="tablist">${[['chat', '💬 চ্যাট'], ['files', '📁 ফাইল'], ['steps', '☑️ ধাপ']].map(([k, l]) => `<button class="${D.pane === k ? 'on' : ''}" data-act="doc-pane" data-v="${k}" role="tab" aria-selected="${D.pane === k}">${l}</button>`).join('')}</div>
    <div class="docgrid pane-${D.pane}">
      <section class="docchat card"><div class="doclog" id="docLog" aria-live="polite"></div>
        <div class="docbusy" id="docBusy"></div>
        <div class="doccomp"><button class="enh" data-act="doc-attach" title="ফাইল দাও (ছবি, অডিও, ভিডিও, লেখা)" aria-label="ফাইল দাও">📎</button>
          <textarea id="docIn" rows="2" placeholder="গল্প, স্ক্রিপ্ট বা টপিক লেখো…" title="কম্পিউটারে Enter = পাঠাও, Shift+Enter = নতুন লাইন"></textarea>
          <button class="pri" data-act="doc-send" id="docSend">পাঠাও</button></div>
        <input type="file" id="docFile" multiple hidden accept="image/*,audio/*,video/*,.txt,.md,.srt,.json,.csv"></section>
      <aside class="docside">
        <section class="card docfiles" id="docFiles"></section>
        <section class="card docsteps" id="docSteps"></section>
      </aside></div></div>`;
  renderDocLive();
  setTimeout(() => $('#docIn')?.focus(), 30);
}
function renderDocLive() { renderDocLog(); renderDocFiles(); renderDocSteps(); renderDocBusy(); }

// মডেলের লেখা: সাধারণ লেখা + "▼ কপি করুন … ▲ এখানে শেষ" ব্লক (কপি বোতামসহ)
function docText(t) {
  return String(t).split(/▼ কপি করুন[^\n]*\n([\s\S]*?)\n?▲ এখানে শেষ/g).map((part, i) => i % 2
    ? `<div class="copyblk"><div class="row"><span class="muted small grow">▼ কপি করুন</span><button class="sm" data-act="doc-copy">📋 কপি</button></div><pre>${esc(part.trim())}</pre></div>`
    : esc(part).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4} (.+)$/gm, '<b>$1</b>').replace(/\n/g, '<br>')).join('');
}
function renderDocLog() {
  const el = $('#docLog');
  if (!el) return;
  const d = D.data;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const lastAsk = [...d.messages].reverse().find(m => m.meta?.kind === 'ask');
  const html = d.messages.map(m => {
    if (m.role === 'user' || m.meta?.answer) return `<div class="msg me">${esc(m.text)}</div>`;
    if (m.role === 'model') return m.text ? `<div class="msg ai">${docText(m.text)}</div>` : '';
    if (m.role === 'tool' || m.meta?.kind === 'tools') {
      const lines = m.text.split('\n').filter(Boolean);
      return `<details class="toolrun"><summary>🔧 ${bn(lines.length)}টি কাজ: ${esc(lines.map(l => l.split(':')[0]).join(', ').slice(0, 90))}</summary>${lines.map(l => `<div class="${/✗/.test(l) ? 'err-text' : ''}">${esc(l)}</div>`).join('')}</details>`;
    }
    if (m.meta?.kind === 'ask') {
      const live = d.pendingAsk && m === lastAsk;
      return `<div class="msg ai ask"><b>❓ ${esc(m.text)}</b><div class="row" style="margin-top:8px">${(m.meta.options || []).map(o => `<button class="sm ${live ? '' : 'ghost'}" data-act="doc-answer" data-v="${esc(o)}" ${live ? '' : 'disabled'}>${esc(o)}</button>`).join('')}</div>${live ? '<p class="muted small" style="margin:6px 0 0">অথবা নিচে নিজের উত্তর লেখো</p>' : ''}</div>`;
    }
    return `<div class="docnote ${m.meta?.kind === 'error' ? 'err' : ''}">${esc(m.text)}</div>`;
  }).join('');
  el.innerHTML = html || `<div class="empty docempty"><div style="font-size:34px">🎞️</div>
    <p><b>শুরু করতে যেকোনো একটা দাও:</b></p>
    <div class="docstart">
      <button data-act="doc-suggest" data-v="একটা নতুন টপিক দাও। ইউটিউবে খুঁজে প্রমাণ দেখাও যে গত ১২ মাসে এই টপিকে ১০ লাখের বেশি ভিউ হয়েছে।">🔎 নতুন টপিক খুঁজে দাও</button>
      <button data-act="doc-suggest" data-v="আমি একটা গল্প দিচ্ছি। স্ক্রিপ্ট বানাও, আর ভয়েসও এখানে বানাও।">📝 আমার গল্প থেকে শুরু</button>
      <button data-act="doc-attach">🎙️ আমার নিজের ভয়েস/অডিও দেব</button></div>
    <p class="muted small">সে প্রতিটা ধাপ নিজে যাচাই করবে, আর শুধু তোমার সিদ্ধান্ত লাগলে জিজ্ঞেস করবে।</p></div>`;
  if (atBottom || D.lastSeq !== (d.messages.at(-1)?.seq || 0)) el.scrollTop = el.scrollHeight;
  D.lastSeq = d.messages.at(-1)?.seq || 0;
}
function renderDocBusy() {
  const el = $('#docBusy');
  if (!el) return;
  const p = D.data.project;
  const pend = D.data.files.filter(f => f.status === 'pending').length;
  el.innerHTML = p.busy ? '<span class="spin" aria-hidden="true"></span> কাজ চলছে… (ছবি/কণ্ঠ বানাতে কয়েক মিনিট লাগতে পারে, পাতা বন্ধ করলেও চলবে)'
    : pend ? `<span class="spin" aria-hidden="true"></span> ${bn(pend)}টি ভিডিও তৈরি হচ্ছে…` : '';
  const send = $('#docSend');
  if (send) { send.disabled = p.busy || D.sending; send.textContent = p.busy ? '…' : 'পাঠাও'; }
}
function renderDocFiles() {
  const el = $('#docFiles');
  if (!el) return;
  const files = D.data.files;
  const groups = {};
  for (const f of files) (groups[f.path.includes('/') ? f.path.split('/')[0] : '—'] ||= []).push(f);
  el.innerHTML = `<div class="row"><h3 class="grow" style="margin:0">📁 ফাইল <span class="muted small">${bn(files.length)}</span></h3><button class="sm" data-act="doc-attach">📎 দাও</button></div>`
    + (files.length ? Object.entries(groups).map(([g, list]) => `<h4>${esc(g)}</h4>${list.map(f => `<div class="dfile ${f.status}">
        <button class="ghost dname" data-act="doc-view" data-id="${f.id}" ${f.status !== 'ready' ? 'disabled' : ''} title="${esc(f.note || '')}">${FILE_ICON[f.kind] || '📄'} <span>${esc(f.path.split('/').slice(1).join('/') || f.path)}</span></button>
        <span class="muted small tnum">${f.status === 'pending' ? '⏳' : f.status === 'failed' ? '✗' : fmtSize(f.size)}${f.source === 'user' ? ' · তোমার' : ''}</span>
        ${f.status === 'ready' ? `<a class="btn sm ghost" href="/api/doc/files/${f.id}?dl=1" download aria-label="নামাও">⬇</a>` : ''}
        <button class="sm ghost" data-act="doc-del-file" data-id="${f.id}" aria-label="মুছো">✕</button></div>`).join('')}`).join('')
      : '<p class="muted small">এখনো কোনো ফাইল নেই। স্ক্রিপ্ট, ছবি, কণ্ঠ, ক্লিপ সব এখানে জমা হবে।</p>');
}
function renderDocSteps() {
  const el = $('#docSteps');
  if (!el) return;
  const st = D.data.project.steps || {};
  el.innerHTML = `<h3 style="margin:0 0 8px">☑️ ধাপ</h3><ol class="dsteps">${DOC_STEPS.map(([k, l]) => {
    const s = st[k] || { status: 'todo' };
    return `<li class="s-${s.status}"><span class="si" aria-hidden="true">${STEP_ICON[s.status] || '○'}</span><span class="grow"><b class="tnum">${bn(k)}</b> ${l}${s.note ? `<span class="muted small"> — ${esc(s.note)}</span>` : ''}</span></li>`;
  }).join('')}</ol>`;
}
function renderDocList() {
  const L = D.list, I = D.info;
  $('#main').innerHTML = `<div class="page">${pageHead('🎞️ ডকুমেন্টারি স্টুডিও', 'গল্প, স্ক্রিপ্ট বা অডিও দাও — রিসার্চ, স্ক্রিপ্ট, কণ্ঠ, ছবি, ক্লিপ, এডিট আর YouTube প্যাকেজ ধাপে ধাপে।')}
    <div class="row"><button class="pri" data-act="doc-new">+ নতুন ডকুমেন্টারি</button><span class="grow"></span><button data-act="doc-settings">⚙️ System Instruction ও শেখা নিয়ম</button></div>
    ${I ? `<div class="chips">${[['ffmpeg', I.ffmpeg, 'এডিট/মিক্স (ffmpeg)'], ['yt', I.youtube, 'YouTube ডেটা'], ['stt', false, 'শব্দ-ধরে সময় (Speech-to-Text)'], ['drive', false, 'Google Drive'], ['music', false, 'মিউজিক বানানো']]
      .map(([, ok, l]) => `<span class="chip cap ${ok ? 'on' : ''}">${ok ? '✓' : '✗'} ${l}</span>`).join('')}<span class="chip cap on">🧠 ${esc(I.model)}</span></div>
      <p class="muted small" style="margin:0">✗ চিহ্নিতগুলো এখনো যুক্ত নয়; সহকারী সেটা খোলাখুলি বলবে, ভান করবে না।</p>` : ''}
    ${!L ? '<p class="muted">লোড হচ্ছে...</p>' : L.length ? `<div class="grid">${L.map(p => `<div class="card pcard" data-act="doc-open" data-id="${p.id}"><div class="cover">🎞️</div>
      <div class="info"><b>${esc(p.name)}</b><div class="muted small tnum">$${p.spent_usd.toFixed(2)} / $${p.budget_usd.toFixed(2)} · ${bn(Object.values(p.steps).filter(s => s.status === 'done').length)}/১৬ ধাপ${p.busy ? ' · চলছে…' : ''}</div></div></div>`).join('')}</div>`
      : `<div class="onboard card"><h3>কীভাবে কাজ করে</h3><ol class="steps">
        <li><b>নতুন ডকুমেন্টারি বানাও</b><span class="muted small">বাজেট ঠিক করে দাও। এর বেশি খরচ হওয়ার আগে সে তোমাকে জিজ্ঞেস করবে।</span></li>
        <li><b>গল্প, স্ক্রিপ্ট, অডিও বা শুধু টপিক দাও</b><span class="muted small">📎 দিয়ে নিজের ভয়েস, ছবি, ক্লিপ, মিউজিকও দেওয়া যায়।</span></li>
        <li><b>সিদ্ধান্তের জায়গায় বোতাম চাপো</b><span class="muted small">বাকি কাজ সে নিজে করে, ফাইল ডান পাশে জমা হয়, শেষে ZIP।</span></li></ol>
        <button class="pri" data-act="doc-new">+ প্রথম ডকুমেন্টারি</button></div>`}</div>`;
}

async function docSend(text) {
  text = String(text ?? '').trim();
  if (!text) return toast('কিছু লেখো', true);
  if (D.data?.project.busy) return toast('আগের কাজ চলছে, একটু অপেক্ষা করো', true);
  D.sending = true; renderDocBusy();
  try {
    await api('POST', `/api/doc/projects/${D.pid}/chat`, { text });
    const inp = $('#docIn'); if (inp) inp.value = '';
    await loadDoc(); renderDocLive();
  } catch (e) { toast(e.message, true); } finally { D.sending = false; renderDocBusy(); }
}
async function docUpload(files) {
  let n = 0;
  for (const f of files) {
    const licence = prompt(`"${f.name}" কোথা থেকে এসেছে? (যেমন: নিজের তোলা / নিজের ভয়েস / কেনা লাইসেন্স / ফ্রি লাইসেন্স + লিংক)`, 'নিজের');
    if (licence === null) continue;
    toast(`আপলোড হচ্ছে: ${f.name}`);
    const r = await fetch(`/api/doc/projects/${D.pid}/upload?name=${encodeURIComponent(f.name)}&licence=${encodeURIComponent(licence)}`, { method: 'POST', headers: { 'x-cp': '1' }, body: f, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(`${f.name}: ${j.error || 'আপলোড হয়নি'}`, true); continue; }
    n++;
  }
  if (n) { await loadDoc(); renderDocLive(); toast(`${bn(n)}টি ফাইল যোগ হয়েছে। এখন কী করতে হবে লিখে পাঠাও।`); }
}

Object.assign(handlers, {
  'doc': () => openDoc(),
  'doc-home': () => openDoc(),
  'doc-open': t => openDoc(t.dataset.id),
  'doc-new': () => act(async () => {
    const name = prompt('ডকুমেন্টারির নাম (যেমন কেসের নাম)', 'নতুন ডকুমেন্টারি');
    if (name === null) return;
    const b = prompt('এই প্রজেক্টের বাজেট কত ডলার? এর বেশি খরচের আগে জিজ্ঞেস করবে।', '5');
    if (b === null) return;
    const { id } = await api('POST', '/api/doc/projects', { name, budgetUsd: Number(b) || 0 });
    await openDoc(id);
  }),
  'doc-pane': t => { D.pane = t.dataset.v; renderDoc(); },
  'doc-send': () => docSend($('#docIn').value),
  'doc-suggest': t => docSend(t.dataset.v),
  'doc-answer': t => docSend(t.dataset.v),
  'doc-attach': () => { const i = $('#docFile'); if (!i) return; i.value = ''; i.onchange = () => act(() => docUpload([...i.files])); i.click(); },
  'doc-copy': t => {
    const text = t.closest('.copyblk').querySelector('pre').textContent;
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('কপি হয়েছে'), () => {
      const r = document.createRange(); r.selectNodeContents(t.closest('.copyblk').querySelector('pre'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('লেখাটা বাছা হয়েছে, এখন কপি করো');
    });
  },
  'doc-budget': () => act(async () => {
    const p = D.data.project;
    const b = prompt(`বাজেট (ডলার)। এখন পর্যন্ত আনুমানিক খরচ $${p.spent_usd.toFixed(2)}।`, String(p.budget_usd));
    if (b === null) return;
    await api('PATCH', `/api/doc/projects/${p.id}`, { budgetUsd: Number(b) || 0 });
    await loadDoc(); renderDoc();
  }, 'বাজেট বদলেছে'),
  'doc-menu': () => {
    const p = D.data.project;
    openModal(`<div style="padding:18px"><div class="row"><h3 class="grow" style="margin:0">ডকুমেন্টারি</h3><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
      <label class="lab" for="dmName">নাম</label><input id="dmName" value="${esc(p.name)}">
      <div class="row" style="margin-top:14px"><button class="pri" data-act="doc-rename">সেভ</button><button data-act="doc-settings">⚙️ System Instruction</button><span class="grow"></span><button class="bad" data-act="doc-del">মুছো</button></div></div>`);
  },
  'doc-rename': () => act(async () => { await api('PATCH', `/api/doc/projects/${D.pid}`, { name: $('#dmName').value }); closeModal(); await loadDoc(); renderDoc(); }, 'সেভ হয়েছে'),
  'doc-del': () => act(async () => {
    if (!confirm('এই ডকুমেন্টারির চ্যাট আর সব ফাইল চিরতরে মুছে যাবে। নিশ্চিত?')) return;
    await api('DELETE', `/api/doc/projects/${D.pid}`); closeModal(); await openDoc();
  }),
  'doc-del-file': t => act(async () => {
    const f = D.data.files.find(x => x.id === t.dataset.id);
    if (!confirm(`${f?.path || 'ফাইল'} মুছবে?`)) return;
    await api('DELETE', `/api/doc/files/${t.dataset.id}`); await loadDoc(); renderDocFiles();
  }),
  'doc-view': t => {
    const f = D.data.files.find(x => x.id === t.dataset.id);
    if (!f) return;
    const src = `/api/doc/files/${f.id}`;
    const body = f.kind === 'image' ? `<img src="${src}" alt="" style="max-width:100%;display:block;margin:auto">`
      : f.kind === 'video' ? `<video src="${src}" controls playsinline style="width:100%;max-height:70vh;background:#000"></video>`
      : f.kind === 'audio' ? `<audio src="${src}" controls style="width:100%"></audio>` : '<pre class="dtext" id="dText">লোড হচ্ছে…</pre>';
    openModal(`<div style="padding:16px"><div class="row"><b class="grow">${FILE_ICON[f.kind] || '📄'} ${esc(f.path)}</b><a class="btn sm" href="${src}?dl=1" download>⬇ নামাও</a><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
      ${f.note ? `<p class="muted small">${esc(f.note)}</p>` : ''}<div style="margin-top:10px">${body}</div></div>`);
    if (f.kind === 'text') fetch(src, { credentials: 'same-origin' }).then(r => r.text()).then(x => { const el = $('#dText'); if (el) el.textContent = x; });
  },
  'doc-voices': async () => { await loadVoices().catch(() => {}); docVoices(); },
});
function docVoices() {
  openModal(`<div style="padding:16px"><div class="row"><h3 class="grow" style="margin:0">🎙️ কণ্ঠের নমুনা</h3><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
    <p class="muted small">চাপলে শোনা যাবে। পছন্দেরটার নাম চ্যাটে লিখে দাও, যেমন "Charon দিয়ে বানাও"।</p><audio id="dvPrev" hidden></audio>
    <div class="vgrid">${(S.voices || []).map(v => `<button class="sm" data-act="doc-voice-play" data-v="${esc(v.name)}">▶ ${esc(v.name)} <span class="muted">${v.gender === 'male' ? 'পুরুষ' : 'নারী'} · ${esc(v.bn)}</span></button>`).join('') || '<p class="muted">লোড হচ্ছে…</p>'}</div></div>`);
}
Object.assign(handlers, {
  'doc-voice-play': t => { const au = $('#dvPrev'); au.onerror = () => toast('কণ্ঠ শোনা যায়নি', true); au.src = `/api/voices/${encodeURIComponent(t.dataset.v)}/preview`; au.play().catch(() => {}); toast(`${t.dataset.v}-এর কণ্ঠ আসছে…`); },
  'doc-settings': () => act(async () => {
    const s = await api('GET', '/api/doc/settings');
    openModal(`<div style="padding:16px"><div class="row"><h3 class="grow" style="margin:0">⚙️ ডকুমেন্টারি স্টুডিওর System Instruction</h3><button class="sm ghost" data-act="close" aria-label="বন্ধ">✕</button></div>
      <p class="muted small">শুধু এই মডিউলের জন্য; অ্যাপের অন্য চ্যাটে যায় না। ${s.custom ? 'এখন তোমার নিজের লেখা চলছে।' : 'এখন মাস্টার কমান্ড (ডিফল্ট) চলছে।'}</p>
      <textarea id="dsSys" rows="14" class="mono">${esc(s.system)}</textarea>
      <label class="lab" for="dsLes">শেখা নিয়ম (LESSONS.md) — সব ডকুমেন্টারিতে মানা হয়</label><textarea id="dsLes" rows="5" class="mono">${esc(s.lessons)}</textarea>
      <div class="row" style="margin-top:12px"><button class="pri" data-act="doc-settings-save">সেভ</button><button data-act="doc-settings-reset">মাস্টার কমান্ডে ফেরাও</button></div></div>`);
  }),
  'doc-settings-save': () => act(async () => { await api('PUT', '/api/doc/settings', { system: $('#dsSys').value, lessons: $('#dsLes').value }); closeModal(); }, 'সেভ হয়েছে'),
  'doc-settings-reset': () => act(async () => { await api('PUT', '/api/doc/settings', { system: '' }); closeModal(); }, 'মাস্টার কমান্ডে ফেরানো হয়েছে'),
});
document.addEventListener('keydown', e => {
  // ফোনে Enter = নতুন লাইন (লম্বা গল্প লেখার জন্য), কম্পিউটারে Enter = পাঠাও
  if (e.target.id === 'docIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); handlers['doc-send'](); }
});
