if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
(function () {
  var err = document.getElementById('err');
  function show(t) { err.textContent = t; err.hidden = false; }
  function login(body) {
    fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cp': '1' }, body: JSON.stringify(body), credentials: 'same-origin' })
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
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
    contact(c.contact);
    // মালিকের দেওয়া লেখা আর ছবি (প্যানেল থেকে বদলানো)
    var t = c.texts || {}, b = c.brand || {}, v = b.v || {};
    if (t.tagline) document.getElementById('tag').textContent = t.tagline;
    if (t.loginLine) { var p = document.createElement('p'); p.className = 'line'; p.textContent = t.loginLine; document.getElementById('tag').after(p); }
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
    if (!c.googleClientId) { if (!c.devLogin) show('Gmail লগইন এখনো চালু হয়নি। অ্যাপের মালিককে জানাও।'); return; }
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
