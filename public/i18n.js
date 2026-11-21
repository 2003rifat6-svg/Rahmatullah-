'use strict';
/* ভাষা: বাংলা / English।
   English বাছলে পর্দায় আসা প্রতিটা বাংলা লেখা (HTML, বোতাম, বার্তা, সার্ভারের ত্রুটি) অভিধান থেকে নিজে থেকে ইংরেজি হয়ে যায়।
   অভিধান: /i18n-en.js — [বাংলা লেখা, English] জোড়ার তালিকা। বাংলার ভেতরের সংখ্যা {n}, ব্যবহারকারীর নিজের লেখা {*}; English-এ {0}, {1}... */
(function () {
  var lang = 'bn';
  try { lang = localStorage.getItem('cp_lang') === 'en' ? 'en' : 'bn'; } catch (e) { /* স্টোরেজ বন্ধ */ }
  var I = window.I18N = { lang: lang, locale: lang === 'en' ? 'en-US' : 'bn-BD', missing: [] };
  document.documentElement.lang = lang;

  var HAS_BN = /[ঀ-ৱ৴-৿]/;
  var NUM = /[0-9০-৯]+(?:\.[0-9০-৯]+)?/g;
  var BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  var ascii = function (s) { return s.replace(/[০-৯]/g, function (d) { return BN_DIGITS.indexOf(d); }); };

  I.t = function (bn, en) { return lang === 'en' ? en : bn; };
  I.set = function (l) {
    try { localStorage.setItem('cp_lang', l === 'en' ? 'en' : 'bn'); } catch (e) { /* কিছু না */ }
    document.cookie = 'cp_lang=' + (l === 'en' ? 'en' : 'bn') + '; Path=/; Max-Age=31536000; SameSite=Lax';
    location.reload();
  };
  try { document.cookie = 'cp_lang=' + lang + '; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) { /* কিছু না */ }

  /* ---------- উৎসাহের লাইন (শুরুর পর্দা) ---------- */
  var QUOTES = [
    ['প্রতিটি মহান গল্প শুরু হয় একটি ছোট কল্পনা থেকে।', 'Every great story begins with a single idea.'],
    ['তোমার কল্পনার কোনো সীমা নেই।', 'Your imagination has no limits.'],
    ['আজ যা ভাবছ, কাল তা-ই দেখাবে পর্দায়।', 'What you imagine today, you can show on screen tomorrow.'],
    ['সৃষ্টি করো। ছড়িয়ে দাও। অনুপ্রাণিত করো।', 'Create. Share. Inspire.'],
    ['ছোট শুরু থেকেই বড় কাজ জন্ম নেয়।', 'Big things start from small beginnings.'],
    ['সাহস করে শুরু করো, বাকিটা আমরা সামলাব।', 'Start boldly. We will handle the rest.']
  ];
  I.quote = function () { var q = QUOTES[Math.floor(Math.random() * QUOTES.length)]; return lang === 'en' ? q[1] : q[0]; };
  I.greet = function (name) {
    var h = new Date().getHours();
    var bn = h < 5 ? 'শুভ রাত্রি 🌙' : h < 12 ? 'শুভ সকাল ☀️' : h < 16 ? 'শুভ দুপুর 🌤️' : h < 19 ? 'শুভ বিকেল 🌇' : 'শুভ সন্ধ্যা 🌆';
    var en = h < 5 ? 'Good night 🌙' : h < 12 ? 'Good morning ☀️' : h < 16 ? 'Good afternoon 🌤️' : h < 19 ? 'Good evening 🌇' : 'Good evening 🌆';
    return (lang === 'en' ? en : bn).replace(/^(.+?) (\S+)$/, function (_, w, e) { return w + ', ' + name + ' ' + e; });
  };

  /* ---------- অভিধান ---------- */
  var EXACT = Object.create(null), WILD = [];
  I.load = function (list) {
    for (var k = 0; k < list.length; k++) {
      var bn = list[k][0], en = list[k][1];
      if (bn.indexOf('{*}') < 0) { EXACT[bn] = en; continue; }
      // {*} আছে: রেজেক্স, গ্রুপের ক্রম অনুযায়ী English-এর {0},{1}
      var re = bn.split(/(\{\*\}|\{n\})/).map(function (part) {
        return part === '{*}' ? '(.+?)' : part === '{n}' ? '([0-9০-৯]+(?:\\.[0-9০-৯]+)?)' : part.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
      }).join('');
      WILD.push([new RegExp('^' + re + '$'), en, bn.replace(/\{\*\}|\{n\}/g, '').length]);
      WILD.sort(function (a, b) { return b[2] - a[2]; }); // সবচেয়ে নির্দিষ্ট প্যাটার্ন আগে
    }
  };
  var fill = function (tpl, vals) { return tpl.replace(/\{(\d+)\}/g, function (_, i) { return vals[+i] === undefined ? '' : vals[+i]; }); };
  var tokenize = function (s) { var vals = []; var key = s.replace(NUM, function (m) { vals.push(ascii(m)); return '{n}'; }); return { key: key, vals: vals }; };

  I.tr = function (s) {
    if (lang !== 'en' || typeof s !== 'string' || !HAS_BN.test(s)) return s;
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
    var out = lookup(core);
    if (out === null) {
      // "ক। খ।" ধরনের একাধিক বাক্য: আলাদা আলাদা অনুবাদ করে জোড়া
      var parts = core.split(/(?<=[।!?])\s+/);
      if (parts.length > 1) {
        var all = parts.map(lookup);
        if (all.every(function (x) { return x !== null; })) out = all.join(' ');
      }
    }
    if (out === null) { if (I.missing.indexOf(core) < 0 && I.missing.length < 400) I.missing.push(core); return s; }
    return lead + out + trail;
  };
  function lookup(core) {
    var tk = tokenize(core);
    var hit = EXACT[tk.key];
    if (hit !== undefined) return fill(hit, tk.vals);
    hit = EXACT[core];
    if (hit !== undefined) return hit;
    for (var i = 0; i < WILD.length; i++) {
      var m = WILD[i][0].exec(core);
      if (m) return fill(WILD[i][1], m.slice(1).map(ascii));
    }
    return null;
  }

  /* ---------- পর্দার সব লেখা বদলানো ---------- */
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var collect = typeof window.__seen === 'function' || window.__CP_COLLECT;
  var seenBatch = [];
  function note(s) { var k = tokenize(s.trim()).key; if (seenBatch.indexOf(k) < 0) seenBatch.push(k); }
  function flushSeen() { if (seenBatch.length && typeof window.__seen === 'function') { window.__seen(seenBatch.splice(0)); } }
  function textNode(n) {
    var v = n.nodeValue;
    if (!v || !HAS_BN.test(v)) return;
    if (lang !== 'en') { if (collect) note(v); return; }
    var o = I.tr(v);
    if (o !== v) n.nodeValue = o;
    else if (collect) note(v); // English মোডে সংগ্রহ = অনুবাদ বাকি থাকা লেখা
  }
  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v && HAS_BN.test(v)) {
        if (lang === 'en') { var o = I.tr(v); if (o !== v) el.setAttribute(a, o); else if (collect) note(v); }
        else if (collect) note(v);
      }
    }
  }
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, PRE: 1, CODE: 1 };
  function walk(n) {
    if (n.nodeType === 3) return textNode(n);
    if (n.nodeType !== 1 || (n.classList && n.classList.contains('notr'))) return;
    attrs(n); // textarea-র placeholder-ও
    if (SKIP[n.tagName]) return;
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  I.walk = walk;

  var obs = null;
  function start() {
    if (lang !== 'en' && !collect) return;
    walk(document.documentElement);
    if (collect) flushSeen();
    obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
        else if (m.type === 'characterData') { if (m.target.parentNode && !SKIP[m.target.parentNode.tagName]) textNode(m.target); }
        else if (m.type === 'attributes') attrs(m.target);
      }
      if (collect) flushSeen();
    });
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // ডায়ালগের লেখাও
  var nativeAlert = window.alert, nativeConfirm = window.confirm, nativePrompt = window.prompt;
  window.alert = function (m) { return nativeAlert.call(window, I.tr(String(m))); };
  window.confirm = function (m) { return nativeConfirm.call(window, I.tr(String(m))); };
  window.prompt = function (m, d) { return nativePrompt.call(window, I.tr(String(m)), d === undefined ? d : I.tr(String(d))); };

  // শুরুর পর্দার উৎসাহের লাইন
  function splashQuote() { var q = document.getElementById('spTag'); if (q) q.textContent = I.quote(); }
  // deferred স্ক্রিপ্টগুলো (অভিধানসহ) চলার পরেই শুরু
  if (document.readyState === 'complete') { splashQuote(); start(); }
  else document.addEventListener('DOMContentLoaded', function () { splashQuote(); start(); });
  I.start = start;
})();
