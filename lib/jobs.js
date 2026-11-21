// কাজের সারি (ছবি/ভিডিও তৈরি): ডেটাবেসে থাকে, তাই একাধিক সার্ভার একসাথে চালালেও একটা কাজ একজনই করে।
// লিজ: কাজ নেওয়া সার্ভার নিয়মিত "আমি বেঁচে আছি" জানায়। বন্ধ হয়ে গেলে লিজ শেষে অন্য সার্ভার কাজটা তুলে নেয়।
'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
const { isFinished, FAILED } = require('./gemini');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const CREATE_LEASE = 15 * 60e3;   // Google-এ পাঠানোর সময় (ছবি সরাসরি তৈরি হতে ১২ মিনিট পর্যন্ত লাগতে পারে)
const MAX_ATTEMPTS = 6;
const TRANSIENT = new Set([0, 429, 500, 502, 503]);

function createWorker({ cfg, db, gemini, assets, log, onDone = () => {} }) {
  const workerId = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const active = new Map();
  let stopping = false;
  let ticking = false;
  let timers = [];
  const now = () => Date.now();

  async function buildBody(req, uid) {
    const images = [];
    for (const id of req.images || []) images.push(await assets.readB64(id, uid));
    const input = images.length ? [...images, { type: 'text', text: req.prompt }] : req.prompt;
    const body = { model: req.kind === 'video' ? cfg.videoModel : req.model || cfg.imageModel, input, store: true };
    if (req.previousId) body.previous_interaction_id = req.previousId;
    if (req.kind === 'video') {
      const rf = { type: 'video' };
      if (req.aspect && !req.previousId) rf.aspect_ratio = req.aspect;
      if (req.resolution) rf.resolution = req.resolution;
      if (req.duration) rf.duration = `${req.duration}s`;
      body.response_format = rf;
    } else {
      body.response_format = { type: 'image', image_size: req.imageSize || '1K' };
      if (req.aspect) body.response_format.aspect_ratio = req.aspect;
    }
    return body;
  }

  async function runJob(jid) {
    const job = await db.get('SELECT * FROM jobs WHERE id=?', jid);
    if (!job || job.status !== 'running' || job.worker !== workerId) return;
    const req = parseJson(job.request, {});
    const heartbeat = ms => db.run('UPDATE jobs SET lease_until=?, updated=? WHERE id=? AND worker=?', now() + ms, now(), jid, workerId);
    const stillMine = async () => {
      const r = await db.get('SELECT status, worker FROM jobs WHERE id=?', jid);
      return Boolean(r && r.status === 'running' && r.worker === workerId);
    };
    try {
      if (job.attempts > MAX_ATTEMPTS) throw new Error('অনেকবার চেষ্টা করেও শেষ হয়নি');
      let it;
      if (job.interaction_id) {
        it = { id: job.interaction_id, status: 'in_progress' }; // আগে পাঠানো হয়েছিল: শুধু অবস্থা দেখা
      } else {
        await heartbeat(CREATE_LEASE);
        try {
          it = await gemini.createInteraction(await buildBody(req, job.uid), req.kind === 'video');
        } catch (e) {
          // ছবির আগের Google-রেকর্ড মেয়াদোত্তীর্ণ (ফ্রি টিয়ারে ১ দিন, পেইডে ৫৫ দিন): ছবিটাই পাঠিয়ে আবার চেষ্টা
          if (req.kind === 'image' && req.previousId && req.parentId && [400, 404].includes(e.apiStatus)) {
            log('warn', 'job.previous_expired', { job: jid });
            it = await gemini.createInteraction(await buildBody({ ...req, previousId: undefined, images: [req.parentId] }, job.uid), false);
          } else throw e;
        }
        if (!(await stillMine())) return; // এর মধ্যে বাতিল হয়েছে
        // Google কাজ নিয়েছে: এখন থেকে ছোট লিজ, যাতে এই সার্ভার বন্ধ হলে অন্যজন দ্রুত তুলে নিতে পারে
        if (it.id) await db.run('UPDATE jobs SET interaction_id=?, lease_until=?, updated=? WHERE id=?', it.id, now() + cfg.pollMs * 3 + cfg.leaseExtraMs, now(), jid);
      }
      const deadline = (job.started || now()) + 25 * 60e3;
      while (!isFinished(it)) {
        if (now() > deadline) throw new Error('২৫ মিনিটেও তৈরি শেষ হয়নি');
        if (!it.id) throw new Error('Gemini কোনো কাজের আইডি দেয়নি');
        await sleep(cfg.pollMs);
        if (stopping || !(await stillMine())) return;
        await heartbeat(cfg.pollMs * 3 + cfg.leaseExtraMs);
        try {
          it = await gemini.getInteraction(it.id);
        } catch (e) {
          // নেট বা Google-এর সাময়িক সমস্যা: কাজ ব্যর্থ না ধরে পরের বার আবার দেখা
          if (TRANSIENT.has(e.apiStatus) && !e.freeTier) { log('warn', 'job.poll_retry', { job: jid, status: e.apiStatus }); continue; }
          throw e;
        }
      }
      if (FAILED.has(it.status)) {
        const why = it.error?.message || gemini.outputText(it);
        throw new Error('তৈরি ব্যর্থ হয়েছে' + (why ? ': ' + why : ''));
      }
      const block = gemini.outputBlocks(it).filter(b => b.type === req.kind).pop();
      if (!block) {
        const why = gemini.outputText(it);
        throw new Error(`মডেল কোনো ${req.kind === 'video' ? 'ভিডিও' : 'ছবি'} দেয়নি` + (why ? ': ' + why : '। প্রম্পট বদলে আবার চেষ্টা করো।'));
      }
      const buf = await gemini.mediaBytes(block);
      const mime = req.kind === 'video' ? 'video/mp4' : ['image/png', 'image/jpeg', 'image/webp'].includes(block.mime_type) ? block.mime_type : 'image/png';
      if (!(await stillMine())) return;
      if (!(await db.get('SELECT 1 AS x FROM projects WHERE id=?', job.project_id))) throw new Error('প্রজেক্ট মুছে ফেলা হয়েছে');
      let characterId = req.characterId || null;
      if (characterId && !(await db.get('SELECT 1 AS x FROM characters WHERE id=?', characterId))) characterId = null;
      const assetId = await assets.save({
        uid: job.uid, projectId: job.project_id, characterId, kind: req.kind, mime, buf,
        prompt: req.displayPrompt || req.prompt, mode: req.mode, meta: req.meta || {},
        interactionId: it.id || null, parentId: req.parentId || null,
      });
      const cost = req.kind === 'video' ? (+req.duration || 8) * cfg.videoUsdPerSec : cfg.imageUsd;
      await db.run("UPDATE jobs SET status='done', asset_id=?, error=NULL, finished=?, cost_usd=?, lease_until=NULL, updated=? WHERE id=?",
        assetId, now(), cost, now(), jid);
      log('info', 'job.done', { job: jid, kind: req.kind, ms: now() - (job.started || now()) });
      onDone({ assetId, req, characterId });
    } catch (e) {
      log('warn', 'job.failed', { job: jid, error: String(e.message || e).slice(0, 300) });
      if (await stillMine().catch(() => false)) {
        await db.run("UPDATE jobs SET status='failed', error=?, finished=?, lease_until=NULL, updated=? WHERE id=?",
          String(e.message || e).slice(0, 600), now(), now(), jid).catch(() => {});
      }
    }
  }

  async function tick() {
    if (!cfg.runWorker || stopping || ticking) return; // RUN_WORKER=0: এই সার্ভার শুধু API, কাজ চালায় না
    ticking = true;
    try {
      while (!stopping && active.size < cfg.workerConcurrency) {
        const jid = await db.claimJob(workerId, cfg.maxRunning, CREATE_LEASE);
        if (!jid) break;
        const p = runJob(jid).catch(e => log('error', 'job.crash', { job: jid, error: e.message })).finally(() => { active.delete(jid); kick(); });
        active.set(jid, p);
      }
    } catch (e) {
      log('error', 'worker.tick', { error: e.message });
    } finally {
      ticking = false;
    }
  }
  function kick() { if (!stopping) setImmediate(tick); }

  // বন্ধ হয়ে যাওয়া সার্ভারের কাজ উদ্ধার, পুরনো ইতিহাস পরিষ্কার
  async function sweep() {
    const t = now();
    try {
      await db.run("UPDATE jobs SET status='queued', worker=NULL, lease_until=NULL, updated=? WHERE status='running' AND interaction_id IS NOT NULL AND (lease_until IS NULL OR lease_until<?)", t, t);
      await db.run("UPDATE jobs SET status='failed', error=?, lease_until=NULL, finished=?, updated=? WHERE status='running' AND interaction_id IS NULL AND (lease_until IS NULL OR lease_until<?)",
        'সার্ভার মাঝপথে বন্ধ হয়েছিল। "আবার চেষ্টা" চাপো।', t, t, t);
      kick();
    } catch (e) {
      log('error', 'worker.sweep', { error: e.message });
    }
  }

  return {
    workerId,
    kick,
    buildBody,
    start() {
      if (!cfg.runWorker) return;
      timers.push(setInterval(tick, cfg.workerPollMs));
      timers.push(setInterval(sweep, cfg.sweepMs));
      timers.forEach(t => t.unref());
      sweep();
    },
    sweep,
    activeCount: () => active.size,
    // ধীরে বন্ধ: নতুন কাজ নেওয়া বন্ধ, চলমান কাজ শেষ হওয়ার অপেক্ষা, যেগুলো Google-এ চলছে সেগুলো অন্য সার্ভারের জন্য ছেড়ে দেওয়া
    async stop(waitMs = 20000) {
      stopping = true;
      timers.forEach(clearInterval);
      timers = [];
      await Promise.race([Promise.allSettled([...active.values()]), sleep(waitMs)]);
      await db.run("UPDATE jobs SET status='queued', worker=NULL, lease_until=NULL, updated=? WHERE worker=? AND status='running' AND interaction_id IS NOT NULL", now(), workerId).catch(() => {});
    },
  };
}

module.exports = { createWorker };
