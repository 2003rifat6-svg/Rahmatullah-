'use strict';
/* English মোডে পর্দায় কোনো বাংলা লেখা বাকি থাকে কি না দেখে (ব্যবহারকারীর নিজের লেখা বাদে) */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const APP = path.join(__dirname, '..');
const BN = /[ঀ-ৱ৴-৿]/;
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-i18n-'));
  const port = 4900 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(APP, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEV_LOGIN: '1', GEMINI_API_KEY: 'k', OWNER_EMAIL: '', OWNER_PANEL_PASSWORD: 'i18n-pass' }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const browser = await chromium.launch(); const B = `http://127.0.0.1:${port}`;
  const left = new Map(); let step = 'start';
  const scan = async label => {
    const r = await page.evaluate(() => {
      const BNR = /[ঀ-ৱ৴-৿]/, out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) { const p = n.parentElement; if (!p || /SCRIPT|STYLE/.test(p.tagName) || p.closest('.notr')) continue; if (BNR.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 90)); }
      for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v && BNR.test(v)) out.push(a + ': ' + v.slice(0, 90)); }
      return out;
    });
    for (const t of r) if (!left.has(t)) left.set(t, label);
  };
  let page;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('cp_lang', 'en'); } catch (e) {} });
    page = await ctx.newPage();
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Test' : undefined));
    await page.goto(B + '/'); await page.waitForURL('**/login.html'); await page.waitForTimeout(500); await scan('login');
    await page.fill('#devName', 'Tester'); await page.click('#devGo'); await page.waitForURL(B + '/'); await page.waitForTimeout(300); await scan('splash');
    await page.waitForSelector('#splash', { state: 'detached', timeout: 6000 });
    if (await page.isVisible('.popmsg')) await page.click('[data-act="pop-ok"]');
    await page.waitForTimeout(400); await scan('home');
    for (const sel of ['[data-act="account"]', '[data-act="about"]', '[data-act="trash"]', '[data-act="help"]', '[data-act="panel"]', '[data-act="doc-home"]', '[data-act="docs"]']) {
      const el = page.locator(sel).first();
      if (await el.count() && await el.isVisible()) { step = sel; await el.click().catch(() => {}); await page.waitForTimeout(500); await scan(sel); if (await page.isVisible('.popmsg')) await page.click('[data-act="pop-ok"]').catch(() => {}); }
    }
    await page.click('#menuBtn').catch(() => {});
    const np = page.locator('[data-act="new-project"]').first();
    if (await np.count()) { await np.click().catch(() => {}); await page.waitForSelector('#composer', { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(400); await scan('project');
      for (const v of ['characters', 'timeline', 'settings', 'assistant', 'files']) { const t = page.locator(`[data-act="tab"][data-v="${v}"]`); if (await t.count()) { await t.first().click().catch(() => {}); await page.waitForTimeout(400); await scan('tab:' + v); } }
    }
    // সব বোতাম ঘুরে দেখা (ক্ষতিকর নয় এমনগুলো)
    const acts = await page.$$eval('[data-act]', els => [...new Set(els.map(e => e.dataset.act))]);
    console.log('acts:', acts.length);
  } catch (e) { console.log('ERR at', step, e.message.split('\n')[0]); }
  await browser.close(); srv.kill();
  console.log('বাকি বাংলা লেখা:', left.size);
  for (const [t, l] of left) console.log(' -', `[${l}]`, t);
  process.exit(left.size ? 1 : 0);
})();
