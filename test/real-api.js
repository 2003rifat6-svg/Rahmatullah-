// আসল Gemini API-তে ছোট যাচাই (খরচ খুব কম: একটা লেখা, একটা কণ্ঠ, একটা ছবির চেষ্টা)।
// ভিডিও এখানে চালানো হয় না, কারণ সেটা টাকা খরচ করে; চালাতে চাইলে REAL_VIDEO=1 দাও।
// চালাও:  GEMINI_API_KEY=... node test/real-api.js      (কী কোনো ফাইলে লেখা হয় না)
'use strict';
const path = require('node:path');
const { loadConfig } = require('../lib/config');
const { createGemini, isFinished } = require('../lib/gemini');

(async () => {
  if (!process.env.GEMINI_API_KEY) { console.log('— GEMINI_API_KEY নেই, আসল API পরীক্ষা বাদ'); return; }
  const cfg = loadConfig(path.join(__dirname, '..'));
  const g = createGemini(cfg);
  const out = [];
  const step = async (name, fn) => {
    const t = Date.now();
    try { out.push(['✓', name, await fn(), Date.now() - t]); } catch (e) { out.push(['✗', name, `${e.apiStatus || ''} ${e.message}`.trim().slice(0, 200), Date.now() - t]); }
  };
  await step('লেখা (textGen)', async () => (await g.textGen('Reply in one short sentence.', 'Say hello in Bengali.')).slice(0, 80));
  await step('কণ্ঠ (TTS)', async () => { const r = await g.tts('Kore', 'নমস্কার, চিত্রপটে স্বাগতম।', 'warm'); return `${r.length || r.data?.length || 0} বাইট`; });
  await step('ছবি', async () => {
    const it = await g.createInteraction({ model: cfg.imageModel, input: 'A small red boat on a calm river, watercolor', store: false, response_format: { type: 'image', image_size: '1K', aspect_ratio: '1:1' } }, false);
    const b = g.outputBlocks(it).find(x => x.type === 'image');
    if (!b) throw new Error('ছবি আসেনি: ' + g.outputText(it));
    return `${(await g.mediaBytes(b)).length} বাইট`;
  });
  if (process.env.REAL_VIDEO === '1') {
    await step('ভিডিও (৪ সে., 360p)', async () => {
      let it = await g.createInteraction({ model: cfg.videoModel, input: 'A paper boat floating on a puddle', store: true, response_format: { type: 'video', aspect_ratio: '16:9', resolution: '360p', duration: '4s' } }, true);
      const end = Date.now() + 15 * 60e3;
      while (!isFinished(it) && Date.now() < end) { await new Promise(r => setTimeout(r, 10000)); it = await g.getInteraction(it.id); }
      const b = g.outputBlocks(it).find(x => x.type === 'video');
      if (!b) throw new Error(`অবস্থা ${it.status}: ${g.outputText(it)}`);
      return `${(await g.mediaBytes(b)).length} বাইট`;
    });
  }
  for (const [ok, name, info, ms] of out) console.log(`${ok} ${name} (${ms} ms): ${info}`);
})();
