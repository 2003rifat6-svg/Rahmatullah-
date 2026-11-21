// সেটিংস: সব আসে Environment Variables বা .env থেকে। কোডে কোনো গোপন চাবি নেই।
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(file) {
  try {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) return;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  } catch { /* .env না থাকলে Environment Variables থেকেই নেবে */ }
}

function list(v, def) { return (v ?? def).split(',').map(x => x.trim()).filter(Boolean); }

// হোস্টিং সাইট নিজেই অ্যাপের ঠিকানা জানায়: হাতে PUBLIC_URL বসানোর ঝামেলা আর ভুল এড়াতে সেখান থেকে নেওয়া
function hostedUrl(E) {
  if (E.RENDER_EXTERNAL_URL) return E.RENDER_EXTERNAL_URL;                                   // Render
  if (E.RAILWAY_PUBLIC_DOMAIN) return 'https://' + E.RAILWAY_PUBLIC_DOMAIN;                  // Railway
  if (E.FLY_APP_NAME) return `https://${E.FLY_APP_NAME}.fly.dev`;                            // Fly.io
  if (E.KOYEB_PUBLIC_DOMAIN) return 'https://' + E.KOYEB_PUBLIC_DOMAIN;                      // Koyeb
  return '';
}
const onHost = E => Boolean(E.RENDER || E.RAILWAY_ENVIRONMENT || E.RAILWAY_PUBLIC_DOMAIN || E.FLY_APP_NAME || E.KOYEB_PUBLIC_DOMAIN || E.K_SERVICE);

// /data কি আলাদা স্থায়ী ডিস্ক, নাকি কন্টেইনারের অস্থায়ী জায়গা? অস্থায়ী হলে প্রতিবার আপডেটে সব ডেটা মুছে যায়
function ephemeralDisk(dir) {
  try {
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    return fs.statSync(dir).dev === fs.statSync(path.parse(path.resolve(dir)).root).dev;
  } catch { return false; }
}

function loadConfig(root) {
  loadDotEnv(path.join(root, '.env'));
  const E = process.env;
  const dataDir = E.DATA_DIR || path.join(root, 'data');
  const cfg = {
    env: E.NODE_ENV || 'development',
    port: +E.PORT || 3200,
    publicUrl: (E.PUBLIC_URL || hostedUrl(E)).replace(/\/+$/, ''),
    dataDir,
    ownerEmail: (E.OWNER_EMAIL || '').trim().toLowerCase(),
    openSignup: E.OPEN_SIGNUP === '1',
    googleClientId: (E.GOOGLE_CLIENT_ID || '').trim(),
    devLogin: E.DEV_LOGIN === '1',
    sessionSecret: E.SESSION_SECRET || '',
    // Render/Railway/Fly লোড ব্যালান্সারের পেছনে থাকে: নিজে থেকে চালু (TRUST_PROXY=0 দিলে বন্ধ)
    trustProxy: E.TRUST_PROXY === '1' || (E.TRUST_PROXY !== '0' && onHost(E)),

    // Gemini
    apiKey: (E.GEMINI_API_KEY || '').trim(),
    apiBase: (E.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
    videoModel: (E.VIDEO_MODEL || 'gemini-omni-1.2-flash').trim(),
    imageModel: (E.IMAGE_MODEL || 'gemini-nano-banana-2.1').trim(),
    imageModels: list(E.IMAGE_MODELS, 'gemini-nano-banana-2.1,gemini-3.1-flash-lite-image,gemini-3-pro-image'),
    textModel: (E.TEXT_MODEL || 'gemini-3.8-flash').trim(),
    textFallbacks: list(E.TEXT_MODEL_FALLBACKS, 'gemini-3.6-flash,gemini-3.5-flash-lite'),
    ttsModel: (E.TTS_MODEL || 'gemini-3.8-flash-tts').trim(),
    retryMs: +E.GEMINI_RETRY_MS || 2000,
    autoTitles: E.AUTO_TITLES !== '0',

    // সীমা ও খরচ
    dailyVideos: +E.DAILY_VIDEO_LIMIT || 10,
    dailyImages: +E.DAILY_IMAGE_LIMIT || 40,
    storageLimitMb: +E.STORAGE_LIMIT_MB || 2048,
    genPerMin: +E.GEN_RATE_PER_MIN || 20,
    textPerMin: +E.TEXT_RATE_PER_MIN || 20,
    dayResetTz: E.DAY_RESET_TZ || 'Asia/Dhaka',
    videoUsdPerSec: E.VIDEO_USD_PER_SEC === undefined ? 0.07 : +E.VIDEO_USD_PER_SEC,
    imageUsd: +E.IMAGE_USD || 0,
    usdToBdt: +E.USD_TO_BDT || 124,
    trashDays: +E.TRASH_DAYS || 30,
    historyDays: +E.HISTORY_DAYS || 90,

    // কাজের সারি
    maxRunning: +E.MAX_RUNNING_JOBS || 2,
    pollMs: +E.POLL_MS || 8000,
    runWorker: E.RUN_WORKER !== '0',
    workerConcurrency: +E.WORKER_CONCURRENCY || 4,
    workerPollMs: +E.WORKER_POLL_MS || 2000,
    leaseExtraMs: +E.JOB_LEASE_EXTRA_MS || 60e3, // পোলিংয়ের সময় লিজ: pollMs×৩ + এটা
    sweepMs: +E.SWEEP_MS || 30e3,                // বন্ধ সার্ভারের কাজ খোঁজার বিরতি

    // মালিকের কন্ট্রোল প্যানেলের পাসওয়ার্ড: শুধু সার্ভারের গোপন সেটিংয়ে (কোডে/GitHub-এ নয়)
    panelPassword: E.OWNER_PANEL_PASSWORD || '',
    panelPasswordHash: E.OWNER_PANEL_PASSWORD_HASH || '',
    // অ্যাপের পরিচয় ("চিত্রপট সম্পর্কে" পাতা)
    creatorName: E.CREATOR_NAME || 'Rk™ Dragon',
    creatorTitle: E.CREATOR_TITLE || 'চেয়ারম্যান',
    // ডকুমেন্টারি স্টুডিও
    docModel: (E.DOC_MODEL || 'gemini-3.5-flash').trim(),
    docFallbacks: list(E.DOC_MODEL_FALLBACKS, 'gemini-3.8-flash,gemini-3.5-flash-lite'),
    docBudgetUsd: E.DOC_BUDGET_USD === undefined ? 5 : +E.DOC_BUDGET_USD || 0,
    docUploadMb: +E.DOC_UPLOAD_MB || 300,
    ttsUsdPer1k: +E.TTS_USD_PER_1K_CHARS || 0,
    youtubeKey: E.YOUTUBE_API_KEY || '',
    youtubeBase: E.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3',
    // ডেটাবেস ও ফাইল
    databaseUrl: E.DATABASE_URL || '',
    dbPool: +E.DB_POOL_SIZE || 10,
    storage: E.STORAGE === 's3' ? 's3' : 'local',
    mediaDir: path.join(dataDir, 'media'),
    s3: {
      endpoint: E.S3_ENDPOINT || '',
      region: E.S3_REGION || 'auto',
      bucket: E.S3_BUCKET || '',
      accessKey: E.S3_ACCESS_KEY || '',
      secretKey: E.S3_SECRET_KEY || '',
      pathStyle: E.S3_PATH_STYLE !== '0',
      presignSeconds: +E.S3_LINK_SECONDS || 300,
    },
  };
  cfg.production = cfg.env === 'production' || cfg.publicUrl.startsWith('https://');
  // শুধু লোকাল ডিস্ক + SQLite হলে এটা দরকারি (PostgreSQL/S3 হলে ডেটা অন্য জায়গায়)
  cfg.ephemeralDisk = cfg.production && !cfg.databaseUrl && cfg.storage === 'local' && ephemeralDisk(cfg.dataDir);
  cfg.mediaOrigin = cfg.storage === 's3' && cfg.s3.endpoint ? new URL(cfg.s3.endpoint).origin : '';
  return cfg;
}

// চালু করার আগে বিপজ্জনক সেটিং ধরা
function checkConfig(cfg) {
  const errors = [];
  const warnings = [];
  if (cfg.devLogin && cfg.production) errors.push('DEV_LOGIN=1 আসল সার্ভারে (production/https) চালু করা যাবে না: যে কেউ Gmail ছাড়া মালিক হয়ে ঢুকতে পারবে।');
  if (cfg.databaseUrl && cfg.storage === 'local') warnings.push('DATABASE_URL আছে কিন্তু STORAGE=local: একাধিক সার্ভার চালালে ফাইল সব সার্ভারে পাওয়া যাবে না। STORAGE=s3 দাও।');
  if (!cfg.apiKey) warnings.push('GEMINI_API_KEY নেই, কিছু তৈরি করা যাবে না।');
  if (!cfg.googleClientId) warnings.push('GOOGLE_CLIENT_ID নেই, Gmail লগইন বন্ধ।' + (cfg.devLogin ? ' (DEV_LOGIN চালু)' : ''));
  if (!cfg.ownerEmail && !cfg.devLogin) warnings.push('OWNER_EMAIL নেই, কেউ ঢুকতে পারবে না।');
  if (!cfg.panelPassword && !cfg.panelPasswordHash) warnings.push('OWNER_PANEL_PASSWORD নেই, মালিকের কন্ট্রোল প্যানেল খোলা যাবে না।');
  else if (cfg.panelPassword && cfg.panelPassword.length < 12) warnings.push('কন্ট্রোল প্যানেলের পাসওয়ার্ড ছোট (১২ অক্ষরের কম)। আরও লম্বা পাসওয়ার্ড নিরাপদ।');
  if (cfg.ephemeralDisk) warnings.push('⚠️ ডেটার জায়গা (' + cfg.dataDir + ') স্থায়ী ডিস্ক নয়! প্রতিবার আপডেট বা রিস্টার্টে সব অ্যাকাউন্ট, ছবি ও ভিডিও মুছে যাবে। হোস্টে একটা Disk/Volume যোগ করো (Mount path ' + cfg.dataDir + ')।');
  if (cfg.production && !cfg.publicUrl) warnings.push('PUBLIC_URL নেই: লগইন কুকি নিরাপদ হবে না। হোস্টের দেওয়া https ঠিকানা PUBLIC_URL-এ বসাও।');
  if (cfg.production && !cfg.trustProxy) warnings.push('TRUST_PROXY=1 দাও যদি অ্যাপ Railway/লোড ব্যালান্সারের পেছনে থাকে, নইলে সবার IP একই দেখাবে।');
  return { errors, warnings };
}

module.exports = { loadConfig, checkConfig };
