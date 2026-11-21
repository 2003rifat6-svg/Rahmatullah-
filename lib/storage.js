// ফাইল রাখার জায়গা: লোকাল ডিস্ক (একটা সার্ভার) বা S3-সামঞ্জস্যপূর্ণ অবজেক্ট স্টোরেজ (অনেক সার্ভার, CDN)।
// key দেখতে এমন: media/<uid>/<id>.mp4, voices/Kore.wav
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { signRequest, presignUrl, sha256 } = require('./sigv4');

function safeKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) || key.includes('..')) throw new Error('অবৈধ ফাইল-key');
  return key;
}

/* ---------------- লোকাল ডিস্ক ---------------- */
function localStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const full = key => path.join(dir, safeKey(key));
  return {
    kind: 'local',
    async put(key, buf) {
      const f = full(key);
      await fs.promises.mkdir(path.dirname(f), { recursive: true });
      const tmp = f + '.tmp-' + process.pid;
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, f); // অর্ধেক লেখা ফাইল কখনো দেখা যায় না
    },
    async get(key) { return fs.promises.readFile(full(key)); },
    async remove(key) { await fs.promises.rm(full(key), { force: true }); },
    async exists(key) { try { await fs.promises.access(full(key)); return true; } catch { return false; } },
    // ব্রাউজারে পাঠানো (ভিডিওর জন্য Range সমর্থন)
    send(req, res, key, { mime, downloadName }) {
      const f = full(key);
      fs.stat(f, (err, st) => {
        if (err) { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }); return res.end('{"error":"ফাইল নেই"}'); }
        const headers = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400' };
        if (downloadName) headers['content-disposition'] = `attachment; filename="${downloadName}"`;
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (m && (m[1] || m[2])) {
          let start = m[1] ? +m[1] : st.size - +m[2];
          const end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
          if (start < 0) start = 0;
          if (start >= st.size || start > end) {
            res.writeHead(416, { 'content-range': `bytes */${st.size}` });
            return res.end();
          }
          res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
          fs.createReadStream(f, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { ...headers, 'content-length': st.size });
          fs.createReadStream(f).pipe(res);
        }
      });
    },
    async ping() { await fs.promises.access(dir, fs.constants.W_OK); return true; },
  };
}

/* ---------------- S3-সামঞ্জস্যপূর্ণ ---------------- */
function s3Storage({ endpoint, region, bucket, accessKey, secretKey, pathStyle = true, presignSeconds = 300 }) {
  if (!endpoint || !bucket || !accessKey || !secretKey) throw new Error('S3 স্টোরেজের জন্য S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY লাগবে');
  const base = endpoint.replace(/\/+$/, '');
  const objUrl = key => pathStyle
    ? `${base}/${bucket}/${safeKey(key)}`
    : `${base.replace('://', `://${bucket}.`)}/${safeKey(key)}`;
  const cred = { region, accessKey, secretKey };
  async function call(method, key, body, extraHeaders = {}) {
    const url = objUrl(key);
    const payloadHash = body ? sha256(body) : sha256('');
    const { headers } = signRequest({ method, url, headers: extraHeaders, payloadHash, ...cred });
    delete headers.host;
    const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(120000) });
    return r;
  }
  return {
    kind: 's3',
    async put(key, buf, mime) {
      const r = await call('PUT', key, buf, { 'content-type': mime || 'application/octet-stream' });
      if (!r.ok) throw new Error(`S3-এ ফাইল রাখা যায়নি (${r.status})`);
    },
    async get(key) {
      const r = await call('GET', key);
      if (!r.ok) throw new Error(`S3 থেকে ফাইল আনা যায়নি (${r.status})`);
      return Buffer.from(await r.arrayBuffer());
    },
    async remove(key) {
      const r = await call('DELETE', key);
      if (!r.ok && r.status !== 404) throw new Error(`S3-এ ফাইল মোছা যায়নি (${r.status})`);
    },
    async exists(key) { return (await call('HEAD', key)).ok; },
    // ব্রাউজারকে অল্প সময়ের সই করা লিংকে পাঠানো: ফাইল সরাসরি স্টোরেজ/CDN থেকে যায়, সার্ভারের ব্যান্ডউইথ লাগে না
    send(req, res, key, { mime, downloadName }) {
      const extraQuery = { 'response-content-type': mime };
      if (downloadName) extraQuery['response-content-disposition'] = `attachment; filename="${downloadName}"`;
      const url = presignUrl({ url: objUrl(key), expires: presignSeconds, extraQuery, ...cred });
      res.writeHead(302, { location: url, 'cache-control': 'private, no-store' });
      res.end();
    },
    async ping() {
      const probe = 'health/ping.txt';
      await this.put(probe, Buffer.from('ok'), 'text/plain');
      return true;
    },
  };
}

function createStorage(cfg) {
  if (cfg.storage === 's3') return s3Storage(cfg.s3);
  return localStorage(cfg.mediaDir);
}

module.exports = { createStorage, safeKey };
