if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
(function () {
  var err = document.getElementById('err');
  function show(t) { err.textContent = t; err.hidden = false; }
  function login(body) {
    fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cp': '1', 'x-lang': I.lang }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; location.replace('/'); }); })
      .catch(function (j) { show((j && j.error) || 'লগইন হয়নি। আবার চেষ্টা করো।'); });
  }
  // যোগাযোগের বোতাম: লেখা DOM দিয়ে বসানো (HTML হিসেবে নয়), লিংক শুধু https/tel/mailto
  function contact(c) {
    if (!c) return;
    var box = document.getElementById('ctas'), n = 0;
    function add(href, label, cls) {
      if (!/^(https:\/\/|tel:|mailto:)/.test(href)) return;
      var a = document.createElement('a');
      a.href = href; a.textContent = label; a.className = 'cta ' + cls;
      if (href.indexOf('https:') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
      box.appendChild(a); n++;
    }
    if (c.whatsapp) add('https://wa.me/' + c.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent('চিত্রপটে ঢুকতে সাহায্য দরকার'), '💬 WhatsApp', 'wa');
    if (c.phone) add('tel:' + c.phone, '📞 কল', 'call');
    if (c.email) add('mailto:' + c.email + '?subject=' + encodeURIComponent('চিত্রপট'), '✉️ ইমেইল', 'mail');
    if (c.facebook) add(c.facebook, '📘 Facebook', 'fb');
    if (c.telegram) add(c.telegram, '✈️ Telegram', 'tg');
    if (n) document.getElementById('contact').hidden = false;
  }
  var switching = /[?&]switch=1/.test(location.search);
  var I = window.I18N || { lang: 'bn', t: function (b) { return b; } };
  // ভাষা বদল (বাংলা ⇄ English)
  var lb = document.getElementById('langBtn');
  lb.textContent = '🌐 ' + (I.lang === 'en' ? 'বাংলা' : 'English');
  lb.onclick = function () { I.set(I.lang === 'en' ? 'bn' : 'en'); };
  // ইনস্টল: ব্রাউজার সুযোগ দিলে এক চাপে, নইলে ধাপগুলো দেখানো
  var installEvt = null, standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  var ib = document.getElementById('installBtn'), how = document.getElementById('howto');
  if (standalone) how.hidden = true;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (!standalone) { ib.hidden = false; how.hidden = true; } });
  ib.onclick = function () { if (installEvt) { installEvt.prompt(); installEvt.userChoice.then(function () { installEvt = null; ib.hidden = true; }); } };
  window.addEventListener('appinstalled', function () { ib.hidden = true; how.hidden = true; });
  document.getElementById('guestGo').onclick = function () { login({ guest: true }); };
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
    contact(c.contact);
    if (c.guest) document.getElementById('guestGo').hidden = false;
    // মালিকের দেওয়া লেখা আর ছবি (প্যানেল থেকে বদলানো)
    var t = c.texts || {}, b = c.brand || {}, v = b.v || {};
    var tg = I.lang === 'en' ? t.tagline_en : t.tagline;
    document.getElementById('tag').textContent = tg || I.t('ভাবো। বানাও। অনুপ্রাণিত করো।', 'Imagine. Create. Inspire.');
    var ll = I.lang === 'en' ? t.loginLine_en : t.loginLine;
    if (ll) { var p = document.createElement('p'); p.className = 'line'; p.textContent = ll; document.getElementById('tag').after(p); }
    var ow = document.querySelector('.owner');
    if (ow) { ow.src = '/api/brand/owner?v=' + (v.owner || 0); if (b.framed) ow.classList.add('framed'); }
    var lg = document.querySelector('.brand img');
    if (lg) lg.src = '/api/brand/logo?v=' + (v.logo || 0);
    if (c.devLogin) {
      document.getElementById('dev').hidden = false;
      document.getElementById('devGo').onclick = function () {
        var n = document.getElementById('devName').value.trim();
        if (n) login({ dev: n });
      };
    }
    if (!c.googleClientId) { if (!c.devLogin && !c.guest) show('Gmail লগইন এখনো চালু হয়নি। অ্যাপের মালিককে জানাও।'); return; }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: c.googleClientId, callback: function (r) { login({ credential: r.credential }); }, ux_mode: 'popup', auto_select: false });
      // অ্যাকাউন্ট বদলাতে এলে আগের অ্যাকাউন্টে নিজে থেকে না ঢুকে বাছতে দেওয়া
      if (switching) google.accounts.id.disableAutoSelect();
      google.accounts.id.renderButton(document.getElementById('g'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(380, document.getElementById('g').clientWidth || 320), locale: 'bn' });
    };
    s.onerror = function () { show('Google-এর লগইন খোলা যায়নি। নেট দেখে আবার চেষ্টা করো।'); };
    document.head.appendChild(s);
  }, function () { show('সার্ভারে পৌঁছানো যায়নি।'); });
})();
