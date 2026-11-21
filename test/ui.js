// Ruvo ব্রাউজার টেস্ট: নকল Gemini সার্ভার দিয়ে আসল ব্রাউজারে (ডেস্কটপ ও মোবাইল মাপে) পুরো UI চালায়।
// চালাতে লাগবে Playwright:  npm i --no-save playwright && npx playwright install chromium
// তারপর:  npm run test:ui     (স্ক্রিনশট জমা হয় test/screens ফোল্ডারে; কোনো API খরচ নেই)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { docScenario, wav } = require('./mock-gemini');

const APP = path.join(__dirname, '..');
// COLLECT=ফাইল দিলে পর্দায় আসা সব বাংলা লেখা সেই ফাইলে জমা হয় (ইংরেজি অভিধান বানানোর জন্য)
const SEEN = new Set();
const hook = async page => { if (process.env.COLLECT) { await page.exposeFunction('__seen', keys => keys.forEach(k => SEEN.add(k))); await page.addInitScript(l => { window.__CP_COLLECT = true; if (l) try { localStorage.setItem('cp_lang', 'en'); } catch (e) {} }, process.env.COLLECT_LANG || ''); } };
const OUT = path.join(__dirname, 'screens');
fs.mkdirSync(OUT, { recursive: true });

// পরীক্ষার ছবি (৩২০×১৮০ PNG) আর ভিডিও (ffmpeg থাকলে আসল ছোট mp4, না থাকলে নকল বাইট)
const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAAGyElEQVR4nO3T53JTVxSG4XURKx1ShpBQAqEmAWxjG/eqbsm2mmU6LHpJ7733HriS3FoyszVKFIydQwjss5h35vmlcrz3J7+yqecqAKdkc89VAE7Jlt4rAJySrb1XADglz/ReAeCUbOu7DMAp2d53GYBT8mzfZQBOyY6DlwA4JTsPXgLglOw6eAmAU7K7/yIAp2RP/0UATsne/osAnJLnBi4AcEqeH7gAwCl5YeACAKdk3+B5AE7J/sHzAJySA4PnATglPYfOAXBKeg+dA+CU9B06B8ApOTh0FoBT0j90FoBTMjB0FoBTMjh8BoBTcmj4DACnZGj4DACnZHjEADglIyMGwCkZHTEATsnY6GkATsn46GkATsnE6GkATsnk2CkATsnU2CkATsn02CkATsnM+EkATsns+EkATklm/CQApyQ7cQKAU5KbOAHAKclPnADglBQmjwNwSoqTxwE4JaXJ4wCckrmpYwCckvLUMQBOSWXqGACnZH76KACnZGH6KACnZHH6KACnpDpzBIBTUps5AsApqc8cAeCUNGYPA3BKmrOHATglS7OHATglrcwyAKdkObMMwCk5nFkG4JQcybYAOCVHsy0ATsmxbAuAU3I8twTAKTmRWwLglJzMLQFwSk7lmwCcktP5JgCnxPJNAE7JmUIDgFNyttAA4JScKzQAOCXni3UATsmFYh2AU3KxWAfglFwq1QA4JZdLNQBOyZVSDYBTcnWuCsApeXGuCsApeWmuCsApebm8CNyOP37vSS76ae8x8kp5EfgPbqnblaKf/94gr5YXgVtym+l2i34X7+S1ygKQ0P+Ybrfo9/JLXq8sAEncoXrbot/OKXmjsgCs7Y6m2y36Td2RN+fngTXctXrbot/XF3lrfh5YzV2uty36rR2Rt+fngZuKUm9b9Lt7Ie8sVICVItbbFn0BF+TdhQpwg+j1tkXfIf3kvYUKcIPo6bZF3yH95P3FMtAterfdoq+RcvLBYhn4S/RiV4q+SZrJh4tl4C/Rc10p+iZpJh9V54C26K2uJvoyqSUfV+eAtuihrib6Mqkln1TngE9SXG9b9H3SST6tlYBPa6Xoia4t+j7pJJ/VSsBnqQ84+j7pJJ/XSkD0PpOIvlIKyRf1IhA9ziSir5RC8mW9CESPM4noK6WQfFUvAtHjTCL6SikkXzcKQPQ4k4i+UgrJN40CED3OJKKvlELybaMARI8ziegrpZB818wD0eNMIvpKKSTfN/NA9DiTiL5SCskPzTwQPc4koq+UQvLjUg6IHmcS0VdKIflpKQdEjzOJ6CulkPy8lAOix5lE9JVSSH5pZYHocSYRfaUUkl9bWSB6nElEXymF5LdWFvgt9Q1H3yed5NpyBri2nIme6Nqi75NOcn05A1xPfcDR90kn0R7TftNh03HTadOsadG0bLpgWjNtmC6ZtkyXO1rhlUZ4d9G0YloyzZnOmE6YjpgOmvaa7jPdY7rD9BnTTaZPmj5h+qjpI6YPmT5gep+pdtxnen948aHwgUfDhzeabjbdZrrTdK/pftO+8PBR00nTWdN8+NOVcIy6afNmR22Gt6rhOmXTgmnGdMp0zHQoXPyA6fOmu0y3m24xfcp0g+ljputMHzZ9MBxs5VEfDO+uN308fP7p8N1nTXeHp7UnHeqatNCZtBqma95s0vZRuyedDTdtT9oXJt3bNenGFZN2H3W1STeFr+8Ij9rXmXSkM2mua9La6pM2/jlpNlxzvDNpTxhhdxhkSxhnQxhqfYJJ14XxN4QfYkv4UXaFpx3oTDoWfr5M+LtznUnr/zbpfLhXvjPpaGfS/WGHneHfbHPXpOtuNmn7qDdM+mTXpHvCpL2dSSdCFDdMunZQ7UmLXZMOmw6ESV/oTLr1H5MSMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAH/PemfhaS0mki8jl8AAAAASUVORK5CYII=';
let MP4 = Buffer.from('0000002066747970', 'hex').toString('base64');
try {
  const tmp = path.join(os.tmpdir(), 'ruvo-ui-sample.mp4');
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', tmp]);
  if (r.status === 0) MP4 = fs.readFileSync(tmp).toString('base64');
} catch { /* ffmpeg নেই */ }

let n = 0;
const its = new Map();
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const b = raw ? JSON.parse(raw) : {};
    const send = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/v1beta/interactions') {
      const id = 'v1_' + ++n;
      const v = b.response_format?.type === 'video';
      let done = { id, status: 'completed', steps: [{ type: 'model_output', content: [v ? { type: 'video', mime_type: 'video/mp4', data: MP4 } : { type: 'image', mime_type: 'image/png', data: IMG }] }] };
      const text = JSON.stringify(b.input || '');
      // SLOWJOB: শেষই হয় না (বাতিল পরীক্ষা), FAILJOB: Google ব্যর্থ বলে (আবার চেষ্টা পরীক্ষা)
      if (/SLOWJOB/.test(text)) done = { id, status: 'in_progress' };
      if (/FAILJOB/.test(text)) done = { id, status: 'failed', error: { message: 'mock failure' } };
      its.set(id, done);
      return send(b.background ? { id, status: 'in_progress' } : done);
    }
    if (req.method === 'GET' && req.url.startsWith('/v1beta/interactions/')) return send(its.get(decodeURIComponent(req.url.split('/').pop())));
    if (/:generateContent$/.test(req.url) && b.tools?.some(t => t.functionDeclarations)) {
      const r = docScenario(b);
      res.writeHead(r.status || 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r.status ? { error: { message: r.error } } : { candidates: [{ content: { role: 'model', parts: r.parts } }] }));
    }
    if (/:generateContent$/.test(req.url)) {
      const ep = b.generationConfig?.responseSchema;
      if (/creative assistant/.test(b.systemInstruction?.parts?.[0]?.text || '')) return send({ candidates: [{ content: { parts: [{ text: '**৩টি আইডিয়া:**\n১. নদীর ঘাটে প্রথম দেখা\n২. বাজারে ভুল বোঝাবুঝি\n\n```prompt\nRaju and Mitu meet at a misty river ghat at dawn, slow dolly in.\n```' }] } }] });
      return send({ candidates: [{ content: { parts: [{ text: ep ? JSON.stringify({ title: 'প্রথম দেখা', summary: 'রাজু আর মিতুর দেখা হয় নদীর ঘাটে।', scenes: [
        { location: 'নদীর ঘাট', action: 'রাজু নৌকা থেকে নামে', dialogue: 'রাজু: "কেমন আছো?"', characters: ['রাজু'], video_prompt: 'Raju steps off a wooden boat at a river ghat at golden hour.' },
        { location: 'বাজার', action: 'মিতু হাসে', dialogue: '', characters: ['রাজু', 'মিতু'], video_prompt: 'Mitu smiles at Raju in a busy village market.' }] }) : 'A cinematic shot of Raju walking in the rain at night.' }] } }] });
    }
    res.writeHead(404); res.end('{}');
  });
});

(async () => {
  await new Promise(r => mock.listen(0, r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-ui-'));
  const port = 4700 + Math.floor(Math.random() * 200);
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(APP, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEV_LOGIN: '1', GEMINI_API_KEY: 'k', GEMINI_API_BASE: `http://127.0.0.1:${mock.address().port}/v1beta`, POLL_MS: '200', WORKER_POLL_MS: '200', ASSET_PAGE_SIZE: '3', OWNER_EMAIL: '', OWNER_PANEL_PASSWORD: 'ui-test-panel-pass' },
    stdio: 'inherit',
  });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const B = `http://127.0.0.1:${port}`;
  let page;
  try {
    const overflow = async (label) => {
      const o = await page.evaluate(() => {
        const w = window.innerWidth;
        const bad = [...document.querySelectorAll('body *')].filter(el => {
          const r = el.getBoundingClientRect();
          if (!r.width || getComputedStyle(el).position === 'fixed') return false;
          if (el.closest('.tscroll,.tabs,.vers,.tl,.filters,.chips,#splash')) return false; // এগুলো ইচ্ছে করে পাশে স্ক্রল হয়
          return r.right > w + 1;
        }).slice(0, 3).map(el => el.tagName + '.' + el.className + '[' + (el.textContent || '').trim().slice(0, 30) + ' < ' + el.parentElement.className + ']');
        return { doc: document.documentElement.scrollWidth > w + 1, bad };
      });
      if (o.doc || o.bad.length) errors.push(`[${label}] horizontal overflow ${o.bad.join(', ')}`);
    };
    for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      page = await ctx.newPage(); await hook(page);
      let expect403 = false; // ভুল পাসওয়ার্ডের পরীক্ষায় 403 প্রত্যাশিত
      page.on('console', m => { if (m.type() === 'error' && !(expect403 && /status of 403/.test(m.text()))) errors.push(`[${vp.name}] ${m.text()}`); });
      page.on('pageerror', e => errors.push(`[${vp.name}] pageerror ${e.message} @ ${String(e.stack).split('\n').slice(1, 4).join(' / ')}`));
      page.on('dialog', d => d.accept(d.type() === 'prompt' ? (d.message().includes('ফোল্ডার') ? 'আমার সিরিজ' : d.message().includes('কালেকশন') ? 'এপিসোড ১' : d.message().includes('প্রজেক্ট') ? 'নদীর গল্প' : d.message().includes('ডকুমেন্টারির নাম') ? 'Banco Rio' : d.message().includes('বাজেট') ? '5' : d.message().includes('কোথা থেকে') ? 'নিজের ভয়েস' : '') : undefined));

      await page.goto(B + '/');
      await page.waitForURL('**/login.html');
      await page.waitForFunction(() => document.querySelector('.owner')?.naturalWidth > 0);
      await page.screenshot({ path: `${OUT}/${vp.name}-0-login.png` });
      await overflow(vp.name + ' login');
      await page.fill('#devName', 'Owner ' + vp.name);
      await page.click('#devGo');
      await page.waitForURL(B + '/');
      await page.waitForSelector('#splash');
      await page.screenshot({ path: `${OUT}/${vp.name}-0b-splash.png` });
      await page.waitForSelector('#splash', { state: 'detached', timeout: 5000 });
      // আগের ব্যবহারকারীর দেওয়া "পুরো পর্দার বার্তা" সবাই একবার দেখে
      if (await page.isVisible('.popmsg')) await page.click('[data-act="pop-ok"]');
      await page.waitForSelector('text=সব প্রজেক্ট');
      if ((await page.locator('.tools .toolbtn').count()) !== 6) errors.push(`[${vp.name}] home tools missing`);
      await page.screenshot({ path: `${OUT}/${vp.name}-0c-home-empty.png` });
      if (vp.name === 'mobile') { await page.click('#menuBtn'); }
      await page.click('[data-act="new-folder"] >> nth=0');
      await page.waitForTimeout(300);
      if (vp.name === 'mobile' && !(await page.isVisible('aside.side'))) await page.click('#menuBtn');
      await page.click('aside [data-act="new-project"]');
      await page.waitForSelector('#composer');
      // চরিত্র
      await page.click('[data-act="tab"][data-v="characters"]');
      await page.fill('#ncName', 'রাজু');
      await page.fill('#ncDesc', '২৫ বছরের ছেলে, কোঁকড়া চুল, নীল পাঞ্জাবি');
      await page.click('[data-act="new-char"]');
      await page.waitForSelector('.ccard >> nth=0');
      await page.fill('#ncName', 'মিতু');
      await page.fill('#ncDesc', 'লাল শাড়ি, লম্বা চুল');
      await page.click('[data-act="new-char"]');
      await page.waitForSelector('.ccard >> nth=1');
      // চরিত্রে চাপলে এডিটর: কণ্ঠ, স্বভাব, মুখের ছবি
      await page.click('.ccard >> nth=0');
      await page.waitForSelector('#ecVoice option[value="Charon"]', { state: 'attached' });
      await page.selectOption('#ecVoice', 'Charon');
      await page.fill('#ecInfo', 'শান্ত, ধীরে কথা বলে');
      await page.click('[data-act="gen-ref"][data-v="portrait"]');
      await page.waitForSelector('#ecRefs .ref img', { timeout: 10000 });
      if ((await page.inputValue('#ecInfo')) !== 'শান্ত, ধীরে কথা বলে') errors.push(`[${vp.name}] char info lost after gen-ref`);
      await page.screenshot({ path: `${OUT}/${vp.name}-1b-char-editor.png` });
      await page.click('[data-act="save-char"]');
      await page.waitForSelector('text=🎙️ Charon');
      await page.screenshot({ path: `${OUT}/${vp.name}-1-characters.png`, fullPage: true });
      // + শিট
      await page.click('[data-act="plus"]');
      await page.waitForSelector('.sheet');
      await page.screenshot({ path: `${OUT}/${vp.name}-1c-plus.png` });
      await page.click('.sheet [data-act="quick"][data-v="video"]');
      await page.waitForSelector('#cPrompt');
      // স্টুডিও
      await page.click('[data-act="tab"][data-v="studio"]');
      await page.fill('#cPrompt', 'বৃষ্টির রাতে @রাজু ছাতা হাতে হাঁটছে');
      // উপকরণ বাছাই প্যানেল থেকে মিতুকে যোগ
      await page.click('[data-act="pick-ings"]');
      await page.click('.modal [data-act="toggle-char"] >> nth=1');
      await page.screenshot({ path: `${OUT}/${vp.name}-2a-ingredients.png` });
      await page.click('[data-act="close-ings"]');
      await page.waitForSelector('#ings .ing');
      await page.screenshot({ path: `${OUT}/${vp.name}-2b-composer.png` });
      await page.click('[data-act="generate"]');
      await page.waitForSelector('#gal .tile', { timeout: 15000 });
      // খসড়া: পাঠানোর পর মুছে যায়; লিখলে জমা থাকে
      await page.fill('#cPrompt', 'খসড়া লেখা');
      await page.waitForTimeout(600);
      if ((await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('cp_draft_')).map(k => localStorage.getItem(k))[0])) !== 'খসড়া লেখা') errors.push(`[${vp.name}] draft not saved`);
      await page.click('[data-act="toggle-composer"].summary');
      await page.waitForSelector('#composer.open .set2');
      await page.screenshot({ path: `${OUT}/${vp.name}-2c-composer-open.png` });
      if (vp.name === 'desktop') await page.click('[data-act="toggle-composer"].summary');
      // বাতিল: শেষ না হওয়া কাজে "বাতিল" বোতাম, চলার সময় দেখায়
      await page.fill('#cPrompt', 'SLOWJOB নদীর ধারে');
      await page.click('[data-act="generate"]');
      await page.waitForSelector('[data-act="cancel-job"]');
      await page.waitForFunction(() => /[০-৯]:[০-৯]{2}/.test(document.querySelector('[data-since]')?.textContent || ''));
      await page.screenshot({ path: `${OUT}/${vp.name}-2d-job-running.png` });
      await page.click('[data-act="cancel-job"]');
      await page.waitForFunction(() => !document.querySelector('[data-act="cancel-job"]'));
      // ব্যর্থ কাজ: "আবার চেষ্টা" নতুন কাজ বানায়, ✕ সরিয়ে দেয়
      await page.fill('#cPrompt', 'FAILJOB নদীর ধারে');
      await page.click('[data-act="generate"]');
      await page.waitForSelector('[data-act="retry-job"]', { timeout: 15000 });
      const failedId = await page.getAttribute('[data-act="retry-job"]', 'data-id');
      await page.click('[data-act="retry-job"]');
      await page.waitForFunction(id => { const b = document.querySelector('[data-act="retry-job"]'); return b && b.dataset.id !== id; }, failedId, { timeout: 15000 });
      await page.screenshot({ path: `${OUT}/${vp.name}-2e-job-failed.png` });
      await page.click('[data-act="dismiss-job"]');
      await page.waitForFunction(() => !document.querySelector('.job'));
      if (vp.name === 'mobile' && !(await page.isVisible('#composer.open'))) await page.click('[data-act="toggle-composer"].summary');
      await page.click('[data-act="mode"][data-v="image"]');
      await page.fill('#cPrompt', 'নদীর ঘাটে সূর্যাস্ত');
      await page.click('[data-act="generate"]');
      await page.waitForFunction(() => document.querySelectorAll('#gal .tile').length >= 2, null, { timeout: 15000 });
      if (vp.name === 'mobile' && !(await page.isVisible('#composer.open'))) await page.click('[data-act="toggle-composer"].summary');
      await page.click('[data-act="mode"][data-v="video"]');
      if (vp.name === 'mobile' && (await page.isVisible('#composer.open'))) await page.click('[data-act="toggle-composer"].summary');
      // "আরও দেখাও": এক পাতায় ৩টি (ASSET_PAGE_SIZE=3), তাই ৪র্থ ফাইল পরের পাতায়
      for (const t of ['নৌকা', 'পাখি']) {
        await page.fill('#cPrompt', t);
        await page.click('[data-act="generate"]');
        await page.waitForFunction(() => !document.querySelector('.job'), null, { timeout: 15000 });
      }
      await page.waitForSelector('[data-act="load-more"]');
      const before = await page.locator('#gal .tile').count();
      await page.click('[data-act="load-more"]');
      await page.waitForFunction(n => document.querySelectorAll('#gal .tile').length > n, before);
      if (await page.isVisible('[data-act="load-more"]')) errors.push(`[${vp.name}] load-more still shown after last page`);
      await page.waitForFunction(() => [...document.querySelectorAll('#gal .cap')].every(c => c.textContent.trim().length > 0));
      // কালেকশন
      await page.click('[data-act="new-collection"]');
      await page.waitForSelector('[data-act="filter"][data-v^="col:"]');
      await page.click('[data-act="filter"][data-v="all"]');
      await page.screenshot({ path: `${OUT}/${vp.name}-2-studio.png`, fullPage: true });
      // ভিউয়ার (একটা ভিডিও খোলো)
      await page.click('#gal .tile:has(video) >> nth=0');
      await page.waitForSelector('.viewer');
      await page.click('[data-act="panel"][data-v="extend"]');
      await page.waitForSelector('#rxText');
      await page.screenshot({ path: `${OUT}/${vp.name}-3-viewer.png` });
      await page.click('[data-act="panel"][data-v="more"]');
      await page.waitForSelector('[data-act="clip-toggle"]');
      await page.screenshot({ path: `${OUT}/${vp.name}-3c-viewer-more.png` });
      await page.click('[data-act="clip-toggle"]');
      await page.waitForSelector('text=দৃশ্যক্রম থেকে সরাও');
      await page.click('[data-act="panel"][data-v="cols"]');
      await page.click('[data-act="col-toggle"]');
      await page.waitForSelector('[data-act="col-toggle"].on');
      await page.click('[data-act="close"]');
      // ট্র্যাশ: ছবি ফেলে দিয়ে ফেরত আনা
      await page.click('#gal .tile:has(img) >> nth=0');
      await page.waitForSelector('.viewer');
      // ছবি কাটা
      await page.click('[data-act="panel"][data-v="crop"]');
      await page.click('[data-act="crop"][data-v="1:1"]');
      await page.waitForSelector('.vers .ver >> nth=1');
      await page.click('[data-act="panel"][data-v="more"]');
      await page.click('[data-act="del-asset"]');
      await page.waitForTimeout(400);
      await page.click('[data-act="filter"][data-v="trash"]');
      await page.waitForSelector('[data-act="restore"]');
      await page.screenshot({ path: `${OUT}/${vp.name}-3b-trash.png` });
      await page.click('[data-act="restore"]');
      await page.waitForSelector('text=ট্র্যাশ খালি।');
      await page.click('[data-act="filter"][data-v="all"]');
      // দৃশ্যক্রম
      await page.click('[data-act="tab"][data-v="timeline"]');
      await page.waitForSelector('.clip');
      await page.screenshot({ path: `${OUT}/${vp.name}-4-timeline.png`, fullPage: true });
      // গল্প
      await page.click('[data-act="tab"][data-v="story"]');
      await page.fill('#stPremise', 'নদীর পাড়ের প্রেমের গল্প');
      await page.click('[data-act="write-episode"]');
      await page.waitForSelector('text=প্রথম দেখা', { timeout: 10000 });
      if (!(await page.inputValue('#stPremise')).includes('নদীর পাড়ের')) errors.push('[' + vp.name + '] premise lost');
      await page.screenshot({ path: `${OUT}/${vp.name}-5-story.png`, fullPage: true });
      await page.click('[data-act="scene-to-studio"] >> nth=0');
      await page.waitForSelector('#composer');
      const val = await page.inputValue('#cPrompt');
      if (!val.includes('Raju steps off')) errors.push(`[${vp.name}] scene-to-studio prompt missing`);
      // সহকারী
      await page.click('[data-act="tab"][data-v="assistant"]');
      await page.click('[data-act="chat-suggest"] >> nth=0');
      await page.waitForSelector('.pbox', { timeout: 10000 });
      await page.screenshot({ path: `${OUT}/${vp.name}-5b-assistant.png` });
      await page.click('[data-act="use-prompt"][data-v="video"]');
      await page.waitForSelector('#composer');
      if (!(await page.inputValue('#cPrompt')).includes('misty river ghat')) errors.push(`[${vp.name}] assistant prompt not used`);
      // হোম
      await page.click('.brand');
      await page.waitForSelector('.pcard');
      await page.screenshot({ path: `${OUT}/${vp.name}-6-home.png`, fullPage: true });
      await overflow(vp.name + ' home');
      if (process.env.COLLECT) { // শুধু সংগ্রহের সময়: আরও পর্দা খুলে দেখা
        await page.click('.pcard >> nth=0'); await page.waitForSelector('#composer');
        await page.click('[data-act="project-menu"]'); await page.waitForSelector('#pmName'); await page.click('.modal [data-act="close"]');
        await page.click('[data-act="plus"]'); await page.waitForSelector('.sheet'); await page.click('.sheet [data-act="close"]');
        await page.click('[data-act="tab"][data-v="characters"]'); await page.waitForTimeout(300);
        await page.click('.brand'); await page.waitForSelector('.pcard');
      }
      // ডকুমেন্টারি স্টুডিও: প্রশ্নের বোতাম, কপি-ব্লক, ফাইল, আপলোড
      await page.click('[data-act="plus"]');
      await page.click('.sheet [data-act="doc"]');
      await page.click('[data-act="doc-new"] >> nth=0');
      await page.waitForSelector('#docIn');
      await page.fill('#docIn', 'DOCTEST_ASK');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-act="doc-answer"]:not([disabled])', { timeout: 15000 });
      await page.screenshot({ path: `${OUT}/${vp.name}-9a-doc-ask.png` });
      await page.click('[data-act="doc-answer"] >> nth=0');
      // উত্তর পাঠানোর পর আসল জবাব আসা আর কাজ শেষ হওয়া পর্যন্ত অপেক্ষা (প্রশ্নের বোতামেও একই লেখা থাকে, তাই সেটা দেখে নয়)
      const docIdle = () => page.waitForFunction(() => { const b = document.querySelector('#docSend'); return b && !b.disabled && b.textContent === 'পাঠাও'; }, null, { timeout: 15000 });
      await page.waitForFunction(() => [...document.querySelectorAll('.msg.ai:not(.ask)')].some(m => m.textContent.includes('"answer":"S1 সিনেমাটিক"')), null, { timeout: 15000 });
      await docIdle();
      if (await page.isVisible('[data-act="doc-answer"]:not([disabled])')) errors.push(`[${vp.name}] answered question still active`);
      await page.fill('#docIn', 'DOCTEST_FILE');
      await page.click('[data-act="doc-send"]');
      await page.waitForFunction(() => document.querySelectorAll('.copyblk').length >= 2, null, { timeout: 15000 });
      await docIdle();
      if (vp.name === 'mobile') await page.click('[data-act="doc-pane"][data-v="files"]');
      await page.waitForSelector('#docFiles >> text=SCRIPT.md');
      const chooser = page.waitForEvent('filechooser');
      await page.click('#docFiles [data-act="doc-attach"]');
      await (await chooser).setFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: wav(0.3) });
      await page.waitForSelector('#docFiles >> text=voice.wav');
      await page.click('#docFiles [data-act="doc-view"] >> text=SCRIPT.md');
      await page.waitForFunction(() => document.querySelector('#dText')?.textContent.includes('Hello world'));
      await page.click('.modal [data-act="close"]');
      await page.screenshot({ path: `${OUT}/${vp.name}-9b-doc-files.png` });
      if (vp.name === 'mobile') await page.click('[data-act="doc-pane"][data-v="chat"]');
      await page.screenshot({ path: `${OUT}/${vp.name}-9c-doc-chat.png` });
      await overflow(vp.name + ' doc');
      await page.click('.brand');
      await page.waitForSelector('.pcard');
      // এক্সপোর্ট: প্রজেক্টের ZIP
      const pid = await page.getAttribute('.pcard', 'data-id');
      const zip = await page.request.get(`${B}/api/projects/${pid}/export`);
      if (zip.status() !== 200 || !(zip.headers()['content-type'] || '').includes('zip')) errors.push(`[${vp.name}] export failed ${zip.status()}`);
      // অ্যাকাউন্ট: ব্যবহার, চার্ট, টুলটিপ, টেবিল
      await page.click('header [data-act="account"]');
      await page.waitForSelector('.chart .bar');
      const bars = await page.locator('.bar').count();
      if (bars !== 14) errors.push(`[${vp.name}] chart bars ${bars}`);
      await page.locator('.bar').last().hover();
      await page.waitForSelector('.tip:not([hidden])');
      const tip = await page.textContent('.tip');
      if (!/ভিডিও/.test(tip)) errors.push(`[${vp.name}] tooltip text ${tip}`);
      await page.screenshot({ path: `${OUT}/${vp.name}-7-account.png`, fullPage: true });
      await page.click('details.tablev summary');
      await page.waitForSelector('details.tablev table');
      await overflow(vp.name + ' account');
      // অ্যাডমিন
      // প্রোফাইল: নাম আর ছবি বদলানো
      await page.waitForSelector('.profile .pf-row >> text=ইউজার আইডি');
      if (!(await page.textContent('.profile')).includes('মোট তৈরি')) errors.push(`[${vp.name}] profile stats missing`);
      const pchooser = page.waitForEvent('filechooser');
      await page.click('[data-act="pf-photo"]');
      await (await pchooser).setFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(IMG, 'base64') });
      await page.waitForSelector('.pf-avatar img[src^="/api/avatar/"]');
      if (!(await page.evaluate(() => { const i = document.querySelector('.pf-avatar img'); return i.complete && i.naturalWidth > 0; }))) await page.waitForFunction(() => document.querySelector('.pf-avatar img').naturalWidth > 0);
      await page.screenshot({ path: `${OUT}/${vp.name}-7b-profile.png`, fullPage: true });
      await page.click('[data-act="pf-photo-del"]');
      await page.waitForFunction(() => !document.querySelector('[data-act="pf-photo-del"]'));
      // সম্পর্কে
      await page.click('.pf-acts [data-act="about"]');
      await page.waitForSelector('.ab-creator img');
      await page.waitForFunction(() => document.querySelector('.ab-creator img').naturalWidth > 0);
      await page.screenshot({ path: `${OUT}/${vp.name}-7c-about.png`, fullPage: true });
      await overflow(vp.name + ' about');
      await page.click('header [data-act="account"]');
      await page.waitForSelector('.pf-acts [data-act="admin"]');
      await page.click('.pf-acts [data-act="admin"]');
      await page.waitForSelector('text=কারা ঢুকতে পারবে');
      await page.fill('#alEmail', 'friend@gmail.com');
      await page.click('[data-act="allow-add"]');
      await page.waitForSelector('text=friend@gmail.com');
      await page.screenshot({ path: `${OUT}/${vp.name}-8-admin.png`, fullPage: true });
      await overflow(vp.name + ' admin');
      // অভিযোগ: ব্যবহারকারী পাঠায় → অ্যাডমিন উত্তর দেয় → সমাধান
      const openSheet = async act => { await page.click('[data-act="plus"]'); await page.click(`.sheet [data-act="${act}"]`); };
      await openSheet('help');
      await page.waitForSelector('#cpSub');
      await page.selectOption('#cpCat', 'problem');
      await page.fill('#cpSub', 'ভিডিও আটকে আছে ' + vp.name);
      await page.fill('#cpText', 'দশ মিনিট ধরে চলছে');
      await page.click('[data-act="c-new"]');
      await page.waitForSelector('.cthread >> text=ভিডিও আটকে আছে ' + vp.name);
      await page.screenshot({ path: `${OUT}/${vp.name}-10a-help.png`, fullPage: true });
      await overflow(vp.name + ' help');
      await page.click('header [data-act="account"]');
      await page.click('.pf-acts [data-act="admin"]');
      await page.waitForSelector('.cthread >> text=ভিডিও আটকে আছে ' + vp.name);
      const th = page.locator('.cthread', { hasText: 'ভিডিও আটকে আছে ' + vp.name });
      await th.locator('summary').click();
      await th.locator('textarea').fill('দেখছি, ঠিক করে দিচ্ছি');
      await th.locator('[data-act="c-staff-reply"]').click();
      await page.waitForSelector('text=উত্তর পাঠানো হয়েছে');
      await page.locator('.cthread', { hasText: 'ভিডিও আটকে আছে ' + vp.name }).locator('[data-act="c-status"][data-v="resolved"]').click();
      await page.waitForSelector('text=অবস্থা বদলেছে');
      // মালিকের কন্ট্রোল প্যানেল: ভুল পাসওয়ার্ডে খোলে না, সঠিকটায় খোলে
      await openSheet('owner-panel');
      await page.waitForSelector('#pnPass');
      await page.screenshot({ path: `${OUT}/${vp.name}-11a-panel-locked.png` });
      await page.fill('#pnPass', 'wrong-pass');
      expect403 = true;
      await page.keyboard.press('Enter');
      await page.waitForSelector('text=পাসওয়ার্ড ঠিক হয়নি');
      await page.waitForTimeout(200);
      expect403 = false;
      if (!page.url().endsWith('/')) errors.push(`[${vp.name}] page navigated on Enter`);
      await page.fill('#pnPass', 'ui-test-panel-pass');
      await page.click('[data-act="panel-unlock"]');
      await page.waitForSelector('.utable');
      await page.fill('#pc_whatsapp', '+8801711000000');
      await page.fill('#pc_note', 'সকাল ১০টা – রাত ১০টা');
      await page.click('[data-act="pn-contact"]');
      await page.waitForSelector('text=যোগাযোগের তথ্য সেভ হয়েছে');
      await page.fill('#pnAnn', 'নতুন ফিচার এসেছে ' + vp.name);
      await page.click('[data-act="pn-ann-mode"][data-v="bar"]');
      await page.click('[data-act="pn-ann"]');
      await page.waitForSelector('#announce:not([hidden]) >> text=নতুন ফিচার এসেছে ' + vp.name);
      await page.screenshot({ path: `${OUT}/${vp.name}-11b-panel.png`, fullPage: true });
      await overflow(vp.name + ' panel');
      await page.click('#announce [data-act="ann-hide"]');
      await page.waitForSelector('#announce', { state: 'hidden' });
      await openSheet('help');
      await page.waitForSelector('.helphero .cta.wa[href^="https://wa.me/8801711000000"]');
      await page.screenshot({ path: `${OUT}/${vp.name}-10b-help-contact.png` });
      // ছবি ও লোগো বদলানো: নতুন ছবি সব জায়গায় যায়, আবার আগেরটায় ফেরা যায়
      await openSheet('owner-panel');
      await page.waitForSelector('.brandgrid');
      const ownerSrcBefore = await page.getAttribute('.bc-prev.owner img', 'src');
      let fc = page.waitForEvent('filechooser');
      await page.click('[data-act="pn-brand"][data-v="owner"]');
      await (await fc).setFiles(path.join(APP, 'public', 'icon-192.png')); // স্বচ্ছ কোণওয়ালা PNG
      await page.waitForSelector('text=নতুন ছবি সব জায়গায় বসে গেছে', { timeout: 15000 });
      const ownerSrcAfter = await page.getAttribute('.bc-prev.owner img', 'src');
      if (ownerSrcAfter === ownerSrcBefore) errors.push(`[${vp.name}] owner photo version did not change`);
      fc = page.waitForEvent('filechooser');
      await page.click('[data-act="pn-brand"][data-v="logo"]');
      await (await fc).setFiles(path.join(APP, 'public', 'brand', 'owner-face.webp'));
      await page.waitForSelector('text=নতুন ছবি সব জায়গায় বসে গেছে', { timeout: 15000 });
      await page.waitForFunction(() => /\/api\/brand\/logo\?v=[1-9]/.test(document.querySelector('header .brand img').src));
      // লেখা
      await page.fill('#tx_heroTitle', 'স্বপ্নকে ছবি বানাও ' + vp.name);
      await page.click('[data-act="pn-texts"]');
      await page.waitForSelector('text=লেখা সব জায়গায় বদলেছে');
      // হোম সাজানো: মাউসে টেনে সরানো, বোতাম দিয়ে সরানো, লুকানো, সেভ
      await page.waitForSelector('#arrGrid .arrtile');
      await page.evaluate(() => document.querySelector('#arrGrid').scrollIntoView({ block: 'center' })); // আসল ব্যবহারকারীর মতো: আগে স্ক্রল করে দেখা, তারপর টানা
      const order0 = await page.$$eval('#arrGrid .arrtile', els => els.map(e => e.dataset.id));
      const from = await page.locator('#arrGrid .arrtile').nth(0).boundingBox();
      const to = await page.locator('#arrGrid .arrtile').nth(2).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 10, from.y + 24, { steps: 3 });
      await page.mouse.move(to.x + to.width * 0.75, to.y + 20, { steps: 12 });
      await page.mouse.up();
      const order1 = await page.$$eval('#arrGrid .arrtile', els => els.map(e => e.dataset.id));
      if (order1.indexOf(order0[0]) <= 0) errors.push(`[${vp.name}] drag did not move tile: ${order1.join(',')}`);
      await page.click(`#arrGrid [data-id="${order1[1]}"] [data-act="arr-move"][data-v="-1"]`);
      const order2 = await page.$$eval('#arrGrid .arrtile', els => els.map(e => e.dataset.id));
      if (order2[0] !== order1[1]) errors.push(`[${vp.name}] arrow move failed`);
      // নির্দিষ্ট অবস্থা: কণ্ঠ লুকানো, গল্প দেখানো (আগের অবস্থা যা-ই থাকুক)
      if (!(await page.locator('#arrGrid [data-id="voice"].off').count())) await page.click('#arrGrid [data-id="voice"] [data-act="arr-hide"]');
      if (await page.locator('#arrGrid [data-id="story"].off').count()) await page.click('#arrGrid [data-id="story"] [data-act="arr-hide"]');
      await page.screenshot({ path: `${OUT}/${vp.name}-11c-arrange.png`, fullPage: true });
      await page.click('[data-act="arr-save"]');
      await page.waitForSelector('text=হোম সেভ হয়েছে');
      const saved = (await page.$$eval('#arrGrid .arrtile:not(.off)', els => els.map(e => e.dataset.id)));
      // পুরো পর্দার বার্তা
      await page.fill('#pnAnn', 'আজ নতুন ফিচার এসেছে ' + vp.name);
      await page.click('[data-act="pn-ann-mode"][data-v="popup"]');
      await page.click('[data-act="pn-ann"]');
      await page.waitForSelector('.popmsg >> text=আজ নতুন ফিচার এসেছে ' + vp.name);
      await page.screenshot({ path: `${OUT}/${vp.name}-11d-popup.png` });
      await page.click('[data-act="pop-ok"]');
      await page.waitForSelector('.popmsg', { state: 'detached' });
      await page.click('[data-act="panel-lock"]');
      await page.waitForSelector('#pnPass');
      // হোমে: সাজানো ক্রম, নতুন লেখা, নতুন ছবি
      await page.click('.brand');
      await page.waitForSelector('.tools .toolbtn');
      const homeOrder = await page.$$eval('.tools .toolbtn', els => els.map(e => e.dataset.v));
      if (homeOrder.join(',') !== saved.join(',')) errors.push(`[${vp.name}] home order ${homeOrder} != ${saved}`);
      if (homeOrder.includes('voice') || !homeOrder.includes('story')) errors.push(`[${vp.name}] hidden/shown tiles wrong`);
      if (!(await page.textContent('.hero2 h2')).includes('স্বপ্নকে ছবি বানাও')) errors.push(`[${vp.name}] hero text not applied`);
      await page.waitForFunction(() => { const i = document.querySelector('.h-owner'); return i && /\/api\/brand\/owner-sm\?v=[1-9]/.test(i.src) && i.naturalWidth > 0; });
      await page.screenshot({ path: `${OUT}/${vp.name}-11e-home-arranged.png` });
      // সব জায়গা থেকে লগআউট: এই ডিভাইসে লগইন থাকে
      await page.click('[data-act="account"] >> visible=true');
      await page.click('[data-act="logout-all"]');
      await page.waitForSelector('text=অন্য সব জায়গা থেকে লগআউট হয়েছে');
      await page.reload();
      await page.waitForSelector('text=সব প্রজেক্ট');
      await ctx.close();
    }
    // বাকি মাপ: ছোট ফোন থেকে বড় ডেস্কটপ, প্রতিটা পাতায় পাশে বেরিয়ে যাওয়া কিছু নেই তো
    for (const [w, h] of [[360, 740], [430, 932], [768, 1024], [1024, 768]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 1024, isMobile: w < 768 });
      page = await ctx.newPage(); await hook(page);
      const tag = `w${w}`;
      page.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
      page.on('pageerror', e => errors.push(`[${tag}] pageerror ${e.message}`));
      await page.goto(B + '/login.html');
      await page.fill('#devName', 'Owner desktop');
      await page.click('#devGo');
      await page.waitForSelector('#splash', { state: 'detached', timeout: 6000 });
      await page.waitForSelector('.pcard');
      if (await page.isVisible('.popmsg')) await page.click('[data-act="pop-ok"]');
      await overflow(tag + ' home');
      // হোমের টুল-বোতাম: "লেখা থেকে ছবি" চাপলে সর্বশেষ প্রজেক্টে ছবি মোডে যায়
      await page.click('.tools [data-v="image"]');
      await page.waitForSelector('[data-act="mode"][data-v="image"].on', { state: 'attached' });
      await page.click('.brand');
      await page.waitForSelector('.pcard');
      await page.screenshot({ path: `${OUT}/${tag}-home.png` });
      await page.click('.pcard');
      await page.waitForSelector('#gal .tile');
      await overflow(tag + ' studio');
      await page.screenshot({ path: `${OUT}/${tag}-studio.png` });
      // ফোনে বোতামগুলো আঙুলের জন্য যথেষ্ট বড়
      if (w < 1024) {
        const small = await page.evaluate(() => [...document.querySelectorAll('#composer button, .tabs button, header button')]
          .filter(b => b.offsetParent && b.getBoundingClientRect().height < 36).map(b => b.textContent.trim().slice(0, 20)));
        if (small.length) errors.push(`[${tag}] small touch targets: ${small.join(' | ')}`);
      }
      // ঘর আর বোতাম পর্দার ভেতরে
      const gen = await page.locator('[data-act="generate"]').boundingBox();
      if (!gen || gen.x + gen.width > w || gen.y + gen.height > h) errors.push(`[${tag}] generate button off-screen ${JSON.stringify(gen)}`);
      await page.click('header [data-act="account"]');
      await page.waitForSelector('.chart .bar');
      await overflow(tag + ' account');
      await page.click('[data-act="plus"]');
      await page.click('.sheet [data-act="doc"]');
      await page.click('.pcard[data-act="doc-open"]');
      await page.waitForSelector('.copyblk');
      await overflow(tag + ' doc');
      await page.screenshot({ path: `${OUT}/${tag}-doc.png` });
      await page.screenshot({ path: `${OUT}/${tag}-account.png`, fullPage: true });
      await ctx.close();
    }
    // অতিথি: Gmail ছাড়া ঢোকা, সব ঘুরে দেখা, খরচের কাজে সুন্দর বার্তা
    for (const [w, h, nm] of [[390, 844, 'guest-mobile'], [1440, 900, 'guest-desktop']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      page = await ctx.newPage(); await hook(page);
      page.on('console', m => { if (m.type() === 'error' && !/status of 403/.test(m.text())) errors.push(`[${nm}] ${m.text()}`); });
      page.on('pageerror', e => errors.push(`[${nm}] pageerror ${e.message}`));
      await page.goto(B + '/login.html');
      await page.waitForSelector('#guestGo:not([hidden])');
      await page.waitForSelector('#howto'); // ইনস্টলের ধাপ দেখানো আছে
      await page.screenshot({ path: `${OUT}/${nm}-0-login.png` });
      await page.click('#guestGo');
      await page.waitForURL(B + '/');
      await page.waitForSelector('.tools .toolbtn');
      await page.waitForSelector('#splash', { state: 'detached', timeout: 5000 });
      await page.waitForSelector('#guestbar:not([hidden]) >> text=অতিথি');
      if (await page.isVisible('.popmsg')) await page.click('[data-act="pop-ok"]'); // মালিকের পুরো পর্দার বার্তা অতিথিও একবার দেখে
      if (await page.isVisible('[data-act="admin"], [data-act="owner-panel"]')) errors.push(`[${nm}] guest sees admin/owner links`);
      await page.screenshot({ path: `${OUT}/${nm}-1-home.png` });
      // ঘুরে দেখা: প্রজেক্ট খোলা, সব ট্যাব
      await page.click('.tools [data-v="image"]');
      await page.waitForSelector('#composer');
      for (const t of ['characters', 'timeline', 'story', 'assistant']) { await page.click(`[data-act="tab"][data-v="${t}"]`); await page.waitForTimeout(150); }
      await page.click('[data-act="tab"][data-v="studio"]');
      // খরচের কাজ: পরিষ্কার বার্তা
      await page.fill('#cPrompt', 'নদীর ঘাট');
      await page.click('[data-act="generate"]');
      await page.waitForSelector('.toast.err >> text=Gmail দিয়ে ঢুকতে হবে');
      await page.screenshot({ path: `${OUT}/${nm}-2-blocked.png` });
      await overflow(nm + ' studio');
      // প্রোফাইল: Gmail দিয়ে ঢোকার বোতাম আছে, ছবি-বদল নেই
      await page.click('header [data-act="account"]');
      await page.waitForSelector('.profile [data-act="guest-upgrade"]');
      if (await page.isVisible('[data-act="pf-photo"]')) errors.push(`[${nm}] guest can see photo change`);
      await page.screenshot({ path: `${OUT}/${nm}-3-profile.png`, fullPage: true });
      await ctx.close();
    }
  } catch (e) {
    errors.push("FAIL " + e.message); try { await page.screenshot({ path: OUT + "/fail.png", fullPage: true }); errors.push(await page.evaluate(() => document.querySelector("#jobs")?.innerText + " / toasts: " + document.querySelector("#toasts").innerText)); } catch (x) { errors.push(String(x)); }
  } finally {
    if (process.env.COLLECT) { fs.writeFileSync(process.env.COLLECT, JSON.stringify([...SEEN].sort(), null, 1)); console.log('সংগ্রহ:', SEEN.size, 'টি লেখা'); }
    await browser.close();
    srv.kill(); mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(errors.length ? 'ব্যর্থ:\n' + errors.join('\n') : 'সব UI পরীক্ষা পাস করেছে, কনসোলে কোনো ত্রুটি নেই। স্ক্রিনশট: test/screens');
  if (errors.length) process.exitCode = 1;
})();
