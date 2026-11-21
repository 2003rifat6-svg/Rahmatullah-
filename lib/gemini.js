// Google Gemini API: লেখা (generateContent), আর ছবি/ভিডিও/কণ্ঠ (Interactions API)।
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function apiError(status, message, extra = {}) { const e = new Error(message); e.status = status; Object.assign(e, extra); return e; }

// Gemini TTS-এর ৩০টি তৈরি কণ্ঠ: নাম, নারী/পুরুষ, বৈশিষ্ট্য (ইংরেজি, প্রম্পটে যায়), বাংলা বর্ণনা
const VOICES = [
  ['Zephyr', 'female', 'bright', 'উজ্জ্বল'], ['Puck', 'male', 'upbeat', 'প্রাণবন্ত'], ['Charon', 'male', 'informative', 'স্পষ্ট, ভারী'],
  ['Kore', 'female', 'firm', 'দৃঢ়'], ['Fenrir', 'male', 'excitable', 'উত্তেজিত, তরুণ'], ['Leda', 'female', 'youthful', 'তরুণী'],
  ['Orus', 'male', 'firm', 'দৃঢ়'], ['Aoede', 'female', 'breezy', 'ঝরঝরে'], ['Callirrhoe', 'female', 'easy-going', 'সহজ-স্বাভাবিক'],
  ['Autonoe', 'female', 'bright', 'উজ্জ্বল'], ['Enceladus', 'male', 'breathy', 'নরম, ফিসফিসে'], ['Iapetus', 'male', 'clear', 'পরিষ্কার'],
  ['Umbriel', 'male', 'easy-going', 'সহজ-স্বাভাবিক'], ['Algieba', 'male', 'smooth', 'মসৃণ'], ['Despina', 'female', 'smooth', 'মসৃণ'],
  ['Erinome', 'female', 'clear', 'পরিষ্কার'], ['Algenib', 'male', 'gravelly', 'খসখসে, ভারী'], ['Rasalgethi', 'male', 'informative', 'স্পষ্ট'],
  ['Laomedeia', 'female', 'upbeat', 'প্রাণবন্ত'], ['Achernar', 'female', 'soft', 'কোমল, উঁচু'], ['Alnilam', 'male', 'firm', 'দৃঢ়, নিচু'],
  ['Schedar', 'male', 'even', 'শান্ত, সমান'], ['Gacrux', 'female', 'mature', 'পরিণত'], ['Pulcherrima', 'female', 'forward', 'আত্মবিশ্বাসী'],
  ['Achird', 'male', 'friendly', 'বন্ধুসুলভ'], ['Zubenelgenubi', 'male', 'casual', 'ঘরোয়া'], ['Vindemiatrix', 'female', 'gentle', 'মৃদু'],
  ['Sadachbia', 'male', 'lively', 'চঞ্চল'], ['Sadaltager', 'male', 'knowledgeable', 'জ্ঞানী'], ['Sulafat', 'female', 'warm', 'উষ্ণ'],
].map(([name, gender, trait, bn]) => ({ name, gender, trait, bn }));
const voiceOf = n => VOICES.find(v => v.name === n);

const RETRY_STATUS = new Set([429, 500, 503]);
// interaction-এর শেষ অবস্থা। Google নতুন নাম দিলেও অজানা অবস্থায় আটকে না থেকে সময়সীমায় শেষ হয়।
const FAILED = new Set(['failed', 'cancelled', 'canceled', 'incomplete', 'expired']);
const isFinished = it => it.status === 'completed' || FAILED.has(it.status) || (!it.status && Array.isArray(it.steps));

function createGemini(cfg) {
  const apiHost = new URL(cfg.apiBase).host;

  async function call(method, urlPath, body, timeoutMs = 120000, tries = 3) {
    if (!cfg.apiKey) throw apiError(503, 'GEMINI_API_KEY সেট করা নেই');
    for (let attempt = 1; ; attempt++) {
      let r;
      try {
        r = await fetch(cfg.apiBase + urlPath, {
          method,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (attempt < tries && method === 'GET') { await sleep(cfg.retryMs * attempt); continue; }
        throw apiError(502, 'Gemini-তে সংযোগ হয়নি' + (e.name === 'TimeoutError' ? ' (সময়মতো উত্তর আসেনি, Google-এর সার্ভার ব্যস্ত থাকতে পারে)' : ': ' + (e.message || 'অজানা')), { apiStatus: 0 });
      }
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      const msg = String(j?.error?.message || '');
      // ফ্রি টিয়ারে এই মডেলের সীমা ০: আবার চেষ্টা করে লাভ নেই, বিলিং চালু করতে হবে
      const freeTier = r.status === 429 && /free tier|limit: 0/i.test(msg);
      if (RETRY_STATUS.has(r.status) && !freeTier && attempt < tries) { await sleep(cfg.retryMs * attempt * attempt); continue; }
      const why = freeTier
        ? 'এই API key ফ্রি টিয়ারে আছে, তাই এই মডেল চলবে না। AI Studio-তে key-এর প্রজেক্টে বিলিং চালু করো (তোমার Google Cloud ক্রেডিট থাকা বিলিং অ্যাকাউন্ট যুক্ত করো)।'
        : r.status === 503 ? 'Google-এর সার্ভারে এখন ভিড়, একটু পরে আবার চেষ্টা করো।'
        : r.status === 429 ? 'এখন অনেক অনুরোধ হয়ে গেছে, একটু পরে চেষ্টা করো।'
        : r.status === 400 && /api key/i.test(msg) ? 'API key ঠিক নেই। GEMINI_API_KEY আবার দেখো।'
        : '';
      throw apiError(502, why ? `${why} (Gemini ${r.status})` : `Gemini ত্রুটি ${r.status}: ${msg || 'অজানা'}`, { apiStatus: r.status, apiMessage: msg, freeTier });
    }
  }

  // লেখার মডেল: প্রধানটা ব্যস্ত/বন্ধ/টাইমআউট হলে পরেরটা
  async function textCall(body, timeoutMs = 45000) {
    const models = [cfg.textModel, ...cfg.textFallbacks.filter(m => m !== cfg.textModel)];
    let lastErr;
    for (const m of models) {
      try {
        return await call('POST', `/models/${encodeURIComponent(m)}:generateContent`, body, timeoutMs, 2);
      } catch (e) {
        lastErr = e;
        if (![0, 404, 429, 500, 503].includes(e.apiStatus) || e.freeTier) throw e;
      }
    }
    throw lastErr;
  }
  const textOf = j => (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  async function textGen(system, user, schema) {
    const j = await textCall({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.85, maxOutputTokens: 8192, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
    });
    return textOf(j);
  }

  // Interactions API: ভিডিও (background), ছবি ও কণ্ঠ (সরাসরি)
  async function createInteraction(body, background) {
    if (background) {
      try {
        return await call('POST', '/interactions', { ...body, background: true }, 120000);
      } catch (e) {
        if (e.apiStatus !== 400 || !/background/i.test(e.apiMessage || '')) throw e; // background না নিলে সাধারণ মোডে
      }
    }
    return call('POST', '/interactions', body, 12 * 60e3);
  }
  const getInteraction = id => call('GET', '/interactions/' + encodeURIComponent(id), null, 120000);

  function outputBlocks(it) {
    const out = [];
    for (const s of it.steps || []) if (s.type === 'model_output') out.push(...(s.content || []));
    return out;
  }
  const outputText = it => outputBlocks(it).filter(b => b.type === 'text').map(b => b.text || '').join(' ').trim().slice(0, 400);

  // ফলাফলের ফাইল: সরাসরি base64, বা Google-এর ফাইল-লিংক থেকে নামানো।
  // নিরাপত্তা: API key শুধু Gemini-র নিজের ঠিকানাতেই পাঠানো হয়; অন্য ঠিকানায় রিডাইরেক্ট হলে key ছাড়া।
  async function mediaBytes(block, maxBytes = 512 * 1024 * 1024) {
    if (block.data) return Buffer.from(block.data, 'base64');
    if (!block.uri) throw new Error('ফলাফলে কোনো ফাইল নেই');
    let u;
    try { u = new URL(block.uri); } catch { throw new Error('ফলাফলের ফাইল-লিংক ঠিক নেই'); }
    if (u.host !== apiHost || !['https:', 'http:'].includes(u.protocol)) throw new Error(`অচেনা ঠিকানা থেকে ফাইল নামানো হবে না: ${u.host}`);
    for (let i = 0; i < 20; i++) {
      let r = await fetch(u, { headers: { 'x-goog-api-key': cfg.apiKey }, redirect: 'manual', signal: AbortSignal.timeout(120000) });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        r = await fetch(new URL(r.headers.get('location'), u), { redirect: 'follow', signal: AbortSignal.timeout(120000) });
      }
      if (r.ok) {
        const len = +r.headers.get('content-length') || 0;
        if (len > maxBytes) throw new Error('ফাইল খুব বড়');
        return Buffer.from(await r.arrayBuffer());
      }
      await sleep(5000); // ফাইল তৈরি শেষ হতে সময় লাগতে পারে
    }
    throw new Error('তৈরি ফাইল নামানো যায়নি');
  }

  async function tts(voice, text, style) {
    const it = await call('POST', '/interactions', {
      model: cfg.ttsModel, store: false,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }, 120000);
    const block = outputBlocks(it).filter(b => b.type === 'audio').pop();
    if (!block) throw apiError(502, 'কণ্ঠের নমুনা পাওয়া যায়নি');
    return mediaBytes(block, 20 * 1024 * 1024);
  }

  return { call, textCall, textOf, textGen, createInteraction, getInteraction, outputBlocks, outputText, mediaBytes, tts };
}

module.exports = { createGemini, VOICES, voiceOf, isFinished, FAILED };
