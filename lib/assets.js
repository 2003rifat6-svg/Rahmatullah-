// ছবি/ভিডিও ফাইল: স্টোরেজে রাখা, ডেটাবেসে লেখা, মোছা, আর আপলোড করা ছবি সত্যিই ছবি কি না যাচাই।
'use strict';
const crypto = require('node:crypto');

const EXT = { 'video/mp4': 'mp4', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/wav': 'wav' };
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const shortTitle = t => str(String(t || '').replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' '), 60) || 'শিরোনামহীন';

// ফাইলের প্রথম কয়েকটা বাইট দেখে আসল ধরন (ব্রাউজারের বলা ধরনে বিশ্বাস না করে)
function sniffImage(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
function decodeDataUrl(dataUrl, httpErr, maxBytes = 8 * 1024 * 1024) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw httpErr(400, 'শুধু PNG, JPG বা WEBP ছবি দেওয়া যাবে');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw httpErr(413, 'ছবি ৮ MB-এর বেশি হতে পারবে না');
  const real = sniffImage(buf);
  if (!real) throw httpErr(400, 'ফাইলটা আসলে ছবি নয় (PNG, JPG বা WEBP হতে হবে)');
  return { mime: real, buf };
}

function createAssets({ db, storage }) {
  const now = () => Date.now();
  return {
    async save({ uid, projectId, characterId = null, kind, mime, buf, prompt = '', mode = '', meta = {}, interactionId = null, parentId = null, title = null }) {
      const id = newId();
      const file = `${uid}/${id}.${EXT[mime] || 'bin'}`;
      await storage.put(file, buf, mime);
      try {
        await db.run(`INSERT INTO assets(id,uid,project_id,character_id,kind,mime,file,prompt,mode,meta,interaction_id,parent_id,created,title,size)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, uid, projectId, characterId, kind, mime, file, prompt, mode, JSON.stringify(meta), interactionId, parentId, now(), title || shortTitle(prompt), buf.length);
      } catch (e) {
        await storage.remove(file).catch(() => {}); // ডেটাবেসে না উঠলে ফাইলও রাখা হয় না
        throw e;
      }
      await db.run('UPDATE projects SET updated=? WHERE id=?', now(), projectId);
      return id;
    },
    // স্থায়ীভাবে মোছা: আগে ডেটাবেস, তারপর ফাইল (ফাইল মোছা ব্যর্থ হলেও ব্যবহারকারী আর দেখতে পায় না)
    async purge(a) {
      await db.run('DELETE FROM collection_items WHERE asset_id=?', a.id);
      await db.run('DELETE FROM assets WHERE id=?', a.id);
      await storage.remove(a.file).catch(() => {});
    },
    async readB64(assetId, uid) {
      const a = await db.get('SELECT * FROM assets WHERE id=? AND uid=?', assetId, uid);
      if (!a || a.kind !== 'image') throw new Error('রেফারেন্স ছবি পাওয়া যায়নি');
      return { type: 'image', data: (await storage.get(a.file)).toString('base64'), mime_type: a.mime };
    },
    async usedBytes(uid) {
      // স্টুডিওর ফাইল + ডকুমেন্টারি স্টুডিওর ফাইল, দুটো মিলিয়ে জায়গার সীমা
      const a = await db.get('SELECT COALESCE(SUM(size),0) AS n FROM assets WHERE uid=?', uid);
      const d = await db.get('SELECT COALESCE(SUM(size),0) AS n FROM doc_files WHERE uid=?', uid);
      return Number(a.n) + Number(d.n);
    },
  };
}

module.exports = { createAssets, sniffImage, decodeDataUrl, shortTitle, newId, str, EXT };
