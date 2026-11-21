// AWS Signature Version 4: S3-সামঞ্জস্যপূর্ণ স্টোরেজে (AWS S3, Cloudflare R2, Google Cloud Storage-এর S3 মোড,
// Backblaze B2, MinIO) অনুরোধে সই করা। কোনো বাইরের প্যাকেজ লাগে না।
'use strict';
const crypto = require('node:crypto');

const sha256 = d => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
// RFC 3986 অনুযায়ী এনকোড (S3-এর নিয়ম): A-Z a-z 0-9 - _ . ~ ছাড়া সব
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = p => p.split('/').map(enc).join('/');

function amzDates(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, day: iso.slice(0, 8) };
}
function signingKey(secret, day, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');
}
function canonicalQuery(params) {
  return Object.keys(params).sort().map(k => `${enc(k)}=${enc(String(params[k]))}`).join('&');
}

// হেডার দিয়ে সই (সাধারণ অনুরোধ)
function signRequest({ method, url, headers = {}, payloadHash, region, service = 's3', accessKey, secretKey, date = new Date() }) {
  const u = new URL(url);
  const { amzDate, day } = amzDates(date);
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  h.host = u.host;
  h['x-amz-date'] = amzDate;
  if (service === 's3') h['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(h).sort();
  const query = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  const canonical = [
    method, encPath(decodeURIComponent(u.pathname)) || '/', canonicalQuery(query),
    names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretKey, day, region, service)).update(toSign).digest('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return { headers: h, signature, canonical };
}

// সই করা লিংক (presigned URL): ব্রাউজার সরাসরি ফাইল নামাতে পারে, অল্প সময়ের জন্য
function presignUrl({ method = 'GET', url, region, service = 's3', accessKey, secretKey, date = new Date(), expires = 300, extraQuery = {} }) {
  const u = new URL(url);
  const { amzDate, day } = amzDates(date);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const query = {
    ...extraQuery,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonical = [method, encPath(decodeURIComponent(u.pathname)) || '/', canonicalQuery(query), `host:${u.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretKey, day, region, service)).update(toSign).digest('hex');
  return `${u.origin}${encPath(decodeURIComponent(u.pathname))}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

module.exports = { signRequest, presignUrl, sha256 };
