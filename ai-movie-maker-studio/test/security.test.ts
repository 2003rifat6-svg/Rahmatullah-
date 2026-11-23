/**
 * Security tests: headers/CSP, CORS, origin check, cookies, token verification, identity,
 * upload & input validation, secret redaction, configuration rules.
 * Runs without Google Cloud (local stores + stub provider).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app';
import { googleIdTokenVerifier } from '../server/auth';
import { LocalDiskBlobStore } from '../server/blobStore';
import { buildOptionsFromEnv, ConfigError } from '../server/config';
import { BlobJobStore } from '../server/jobStore';
import { redactSecrets, safeErrorMessage } from '../server/redact';
import { contentSecurityPolicy, parseCorsOrigins } from '../server/security';
import { sniffFamily } from '../server/uploads';
import { BlobUsageStore } from '../server/usage';
import { createStubProvider, listen, makeTestClip, tempDir, TEST_SESSION_SECRET, testVerifier, TINY_PNG_BASE64 } from './helpers';

const PNG_BYTES = Buffer.from(TINY_PNG_BASE64, 'base64');
const PNG_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;
const FAKE_KEY = 'AIzaSyD-FAKE_KEY_0123456789_abcdefghijklmnop';

interface Ctx {
  base: string;
  close: () => void;
  blobs: LocalDiskBlobStore;
  jobs: BlobJobStore;
  stub: ReturnType<typeof createStubProvider>;
  staticDir: string;
}

async function serve(over: Record<string, unknown> = {}): Promise<Ctx> {
  const blobs = new LocalDiskBlobStore(tempDir('sec-'));
  const jobs = new BlobJobStore(blobs);
  const stub = createStubProvider(makeTestClip(tempDir('secclip-'), 'c.mp4', 'black'));
  const staticDir = tempDir('static-');
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>');
  const srv = await listen(
    createApp({
      provider: stub.provider,
      blobStore: blobs,
      projectStore: null,
      jobStore: jobs,
      usageStore: new BlobUsageStore(blobs),
      videoJobs: { pollIntervalMs: 0 },
      staticDir,
      auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: ['alice@x.com', 'bob@x.com'] },
      ...over,
    } as Parameters<typeof createApp>[0])
  );
  return { ...srv, blobs, jobs, stub, staticDir };
}

async function signIn(base: string, uid = 'alice1', email = 'alice@x.com', extra: Record<string, string> = {}) {
  const res = await fetch(base + '/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms', ...extra }, body: JSON.stringify({ credential: `test:${uid}:${email}` }) });
  return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0], setCookie: res.headers.get('set-cookie') || '' };
}
const api = (base: string, cookie: string) => (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, {
    method,
    headers: { 'x-requested-with': 'mms', cookie, ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: (body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)) as BodyInit | undefined,
  });

describe('secret redaction', () => {
  it('removes API keys, tokens, JWTs, bearer values, keys in URLs and session cookies', () => {
    const samples = [
      `request failed for key ${FAKE_KEY}`,
      'Authorization: Bearer ya29.a0AfH6SMBx1234567890abcdefghijkl',
      'x-goog-api-key: supersecretvalue123',
      'GET https://x.googleapis.com/v1/models?key=AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&alt=json',
      'token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwx',
      'cookie: mms_session=abc.def.ghi; other=1',
      'https://storage.googleapis.com/b/o?X-Goog-Signature=deadbeef0123&X-Goog-Credential=svc%40x',
    ];
    for (const s of samples) {
      const r = redactSecrets(s);
      assert.ok(r.includes('[REDACTED'), `not redacted: ${s}`);
      for (const secret of [FAKE_KEY, 'ya29.a0AfH6', 'supersecretvalue123', 'abc.def.ghi', 'deadbeef0123', 'eyJzdWIiOiIx']) assert.ok(!r.includes(secret), `${secret} leaked in: ${r}`);
    }
    assert.equal(redactSecrets('plain harmless text'), 'plain harmless text');
    assert.ok(safeErrorMessage(new Error(`boom ${FAKE_KEY} ${'x'.repeat(1000)}`)).length <= 400);
  });
});

describe('security headers and CSP', () => {
  let ctx: Ctx;
  before(async () => {
    ctx = await serve();
  });
  after(() => ctx.close());

  const must: Record<string, RegExp> = {
    'x-content-type-options': /^nosniff$/,
    'x-frame-options': /^DENY$/,
    'referrer-policy': /^no-referrer$/,
    'permissions-policy': /camera=\(\).*microphone=\(\).*geolocation=\(\)/,
    'cross-origin-opener-policy': /same-origin-allow-popups/,
    'cross-origin-resource-policy': /same-origin/,
    'content-security-policy': /default-src 'self'/,
  };
  for (const route of ['/health', '/', '/api/nonexistent', '/some/spa/route']) {
    it(`every response has the security headers: ${route}`, async () => {
      const res = await fetch(ctx.base + route);
      for (const [h, re] of Object.entries(must)) assert.match(res.headers.get(h) || '', re, `${route} ${h}`);
      assert.equal(res.headers.get('x-powered-by'), null);
    });
  }

  it('CSP is strict: no unsafe-eval, no inline scripts, no wildcard script source, framing and plugins denied', () => {
    const csp = contentSecurityPolicy({ production: true });
    const dir = (name: string) => csp.split('; ').find((d) => d.startsWith(name + ' '))!;
    assert.ok(!csp.includes('unsafe-eval'));
    assert.ok(!dir('script-src').includes('unsafe-inline') && !dir('script-src').includes('*'));
    assert.equal(dir('script-src'), "script-src 'self' https://accounts.google.com/gsi/client");
    assert.equal(dir('object-src'), "object-src 'none'");
    assert.equal(dir('frame-ancestors'), "frame-ancestors 'none'");
    assert.equal(dir('base-uri'), "base-uri 'self'");
    assert.match(dir('connect-src'), /blob: data:/, 'the app must be able to read its own stored files');
    assert.ok(!dir('connect-src').includes('http:') && !/\*/.test(dir('connect-src')), 'no plain-http or wildcard connections');
    assert.ok(csp.includes('upgrade-insecure-requests'));
    assert.ok(!contentSecurityPolicy({ production: false }).includes('upgrade-insecure-requests'));
    assert.ok(!/(^|\s)\*(\s|;|$)/.test(csp), 'no bare wildcard source');
  });

  it('API answers are not cacheable; HSTS only on https (or production)', async () => {
    const api1 = await fetch(ctx.base + '/api/nonexistent');
    assert.equal(api1.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(ctx.base + '/health')).headers.get('strict-transport-security'), null);
    const https = await fetch(ctx.base + '/health', { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(https.headers.get('strict-transport-security') || '', /max-age=31536000/);
    const prod = await serve({ production: true });
    try {
      assert.match((await fetch(prod.base + '/health')).headers.get('strict-transport-security') || '', /max-age/);
    } finally {
      prod.close();
    }
  });
});

describe('CORS and origin check', () => {
  let ctx: Ctx;
  let cookie = '';
  const ALLOWED = 'https://app.example.com';
  before(async () => {
    ctx = await serve({ corsOrigins: [ALLOWED] });
    cookie = (await signIn(ctx.base)).cookie;
  });
  after(() => ctx.close());

  it('only the configured origin gets CORS headers (exact match, with credentials)', async () => {
    const ok = await fetch(ctx.base + '/health', { headers: { Origin: ALLOWED } });
    assert.equal(ok.headers.get('access-control-allow-origin'), ALLOWED);
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    assert.match(ok.headers.get('vary') || '', /Origin/i);
    for (const evil of ['https://evil.example.com', 'https://app.example.com.evil.com', 'http://app.example.com', 'null']) {
      const r = await fetch(ctx.base + '/health', { headers: { Origin: evil } });
      assert.equal(r.headers.get('access-control-allow-origin'), null, evil);
    }
  });

  it('preflight: allowed origin => 204 with methods/headers; other origins => 403 without CORS headers', async () => {
    const pre = await fetch(ctx.base + '/api/chat', { method: 'OPTIONS', headers: { Origin: ALLOWED, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods') || '', /POST/);
    const bad = await fetch(ctx.base + '/api/chat', { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });

  it('state-changing requests from another website are refused even with a valid cookie (CSRF)', async () => {
    const call = api(ctx.base, cookie);
    const evil = await call('POST', '/api/chat', { message: 'hi' }, { Origin: 'https://evil.example.com' });
    assert.equal(evil.status, 403);
    assert.equal(((await evil.json()) as { code: string }).code, 'bad_origin');
    assert.notEqual((await call('POST', '/api/chat', { message: 'hi' }, { Origin: ALLOWED })).status, 403, 'configured origin is fine');
    const host = new URL(ctx.base).host;
    assert.notEqual((await call('POST', '/api/chat', { message: 'hi' }, { Origin: `http://${host}` })).status, 403, 'same origin is fine');
    // login CSRF: sign-in from another site is refused too
    const login = await fetch(ctx.base + '/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com', 'x-requested-with': 'mms' }, body: JSON.stringify({ credential: 'test:alice1:alice@x.com' }) });
    assert.equal(login.status, 403);
  });

  it('the X-Requested-With header is also required for cookie-authenticated writes', async () => {
    const r = await fetch(ctx.base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ message: 'hi' }) });
    assert.equal(r.status, 403);
  });

  it('without CORS configuration no origin is allowed and preflights are refused', async () => {
    const plain = await serve();
    try {
      const r = await fetch(plain.base + '/health', { headers: { Origin: ALLOWED } });
      assert.equal(r.headers.get('access-control-allow-origin'), null);
      assert.equal((await fetch(plain.base + '/api/chat', { method: 'OPTIONS', headers: { Origin: ALLOWED } })).status, 403);
    } finally {
      plain.close();
    }
  });

  it('CORS_ORIGINS accepts only exact origins', () => {
    assert.deepEqual(parseCorsOrigins('https://a.example.com, https://b.example.com:8443/').origins, ['https://a.example.com', 'https://b.example.com:8443']);
    for (const bad of ['*', 'https://*.example.com', 'http://evil.com', 'https://a.com/path', 'ftp://x.com', 'a.com', 'https://a.com?x=1']) {
      assert.ok(parseCorsOrigins(bad).errors.length > 0, bad);
    }
    assert.deepEqual(parseCorsOrigins('http://localhost:3000').origins, ['http://localhost:3000']);
  });
});

describe('session cookie and identity', () => {
  it('cookie is HttpOnly, SameSite=Lax and Secure in production (even over plain http); SameSite=None;Secure with CORS', async () => {
    const prod = await serve({ production: true });
    try {
      const { setCookie } = await signIn(prod.base);
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);
      assert.match(setCookie, /Secure/);
      assert.match(setCookie, /Path=\//);
      assert.match(setCookie, /Max-Age=\d+/);
    } finally {
      prod.close();
    }
    const cross = await serve({ corsOrigins: ['https://app.example.com'] });
    try {
      const { setCookie } = await signIn(cross.base);
      assert.match(setCookie, /SameSite=None/);
      assert.match(setCookie, /Secure/);
    } finally {
      cross.close();
    }
  });

  let ctx: Ctx;
  before(async () => {
    ctx = await serve();
  });
  after(() => ctx.close());

  it('a tampered or foreign cookie is not a session; a sign-in with an invalid Google token is refused', async () => {
    const { cookie } = await signIn(ctx.base);
    const [name, value] = cookie.split('=');
    for (const forged of [`${name}=${value.slice(0, -2)}xx`, `${name}=${Buffer.from(JSON.stringify({ uid: 'victim', email: 'alice@x.com', exp: 9e15 })).toString('base64url')}.AAAA`, `${name}=garbage`]) {
      const r = await fetch(ctx.base + '/api/auth/me', { headers: { cookie: forged } });
      assert.equal(r.status, 401);
    }
    const bad = await fetch(ctx.base + '/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms' }, body: JSON.stringify({ credential: 'not-a-real-google-token' }) });
    assert.equal(bad.status, 401);
    assert.equal((await fetch(ctx.base + '/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms' }, body: JSON.stringify({}) })).status, 400);
  });

  it('the real Google verifier rejects tokens that are not signed by Google', async () => {
    const verify = googleIdTokenVerifier('x.apps.googleusercontent.com');
    await assert.rejects(verify('garbage'));
    await assert.rejects(verify('aaa.bbb.ccc'));
  });

  it('the user id comes only from the verified session, never from the request', async () => {
    const { cookie } = await signIn(ctx.base, 'alice1', 'alice@x.com');
    const call = api(ctx.base, cookie);
    const res = await call(
      'POST',
      '/api/generate/shot-video',
      { uid: 'victim', userId: 'victim', ownerUid: 'victim', projectId: 'pid1', sceneId: 'S01', shotId: 'SH01', prompt: 'x', startImage: PNG_URL, idempotencyKey: 'ident-key-0001' },
      { 'x-uid': 'victim', 'x-user-id': 'victim' }
    );
    assert.equal(res.status, 201);
    const { jobId } = (await res.json()) as { jobId: string };
    assert.equal((await ctx.jobs.get('alice1', jobId))?.uid, 'alice1');
    assert.equal(await ctx.jobs.get('victim', jobId), null);
    // upload paths also come from the session, a foreign uid in the path is refused
    const up = await call('PUT', '/api/storage/upload/users/victim/projects/p/images/a.png', new Uint8Array(PNG_BYTES), { 'Content-Type': 'image/png' });
    assert.equal(up.status, 403);
  });

  it('every AI, storage, job and export endpoint requires sign-in', async () => {
    const anon = (m: string, p: string, body?: unknown) => fetch(ctx.base + p, { method: m, headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms' }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const [m, p, b] of [
      ['POST', '/api/chat', { message: 'x' }],
      ['POST', '/api/generate-character-ref', { prompt: 'x', slot: 'face' }],
      ['POST', '/api/generate/shot-image', {}],
      ['POST', '/api/generate/shot-video', {}],
      ['GET', '/api/generate/video-status/abc', undefined],
      ['POST', '/api/generate/video-cancel/abc', undefined],
      ['GET', '/api/generate/jobs?projectId=p', undefined],
      ['POST', '/api/export/mp4', {}],
      ['GET', '/api/storage/files?projectId=p', undefined],
      ['POST', '/api/storage/upload-url', {}],
      ['POST', '/api/storage/upload-complete', {}],
      ['DELETE', '/api/storage/files/users/x/projects/p/images/a.png', undefined],
      ['GET', '/api/media/users/x/projects/p/images/a.png', undefined],
      ['GET', '/api/projects', undefined],
    ] as const) {
      assert.equal((await anon(m, p, b)).status, 401, `${m} ${p}`);
    }
  });
});

describe('upload validation and safe serving', () => {
  let ctx: Ctx;
  let call: ReturnType<typeof api>;
  const base = 'users/alice1/projects/pu';
  before(async () => {
    ctx = await serve();
    call = api(ctx.base, (await signIn(ctx.base)).cookie);
  });
  after(() => ctx.close());

  const put = (key: string, body: Uint8Array | Buffer, type: string) => call('PUT', `/api/storage/upload/${key}`, new Uint8Array(body), { 'Content-Type': type });
  const code = async (r: Response) => ((await r.json()) as { code?: string; error?: string }).code;

  it('upload-url: unknown folder, disallowed type, oversize and bad project id are refused', async () => {
    const ask = (b: Record<string, unknown>) => call('POST', '/api/storage/upload-url', { projectId: 'pu', kind: 'images', filename: 'a.png', contentType: 'image/png', size: 100, ...b });
    assert.equal((await ask({})).status, 200);
    assert.equal((await ask({ kind: 'evil' })).status, 400);
    assert.equal((await ask({ contentType: 'image/svg+xml' })).status, 415);
    assert.equal((await ask({ contentType: 'text/html' })).status, 415);
    assert.equal((await ask({ contentType: 'video/mp4' })).status, 415, 'a video does not belong in images');
    assert.equal((await ask({ size: 16 * 1024 * 1024 })).status, 400, 'size above the folder limit');
    assert.equal((await ask({ projectId: '../x' })).status, 400);
    assert.equal((await ask({ projectId: undefined })).status, 400);
    const good = (await (await ask({ filename: '../../etc/passwd.exe' })).json()) as { key: string };
    assert.match(good.key, /^users\/alice1\/projects\/pu\/images\/[A-Za-z0-9_]+_[0-9a-f]{8}\.png$/, 'no path parts, no .exe: extension comes from the verified type');
    assert.ok(!good.key.includes('..') && !good.key.includes('.exe') && good.key.split('/').length === 6);
  });

  it('PUT accepts a real PNG and stores it with the verified type', async () => {
    const r = await put(`${base}/images/ok.png`, PNG_BYTES, 'image/png');
    assert.equal(r.status, 201);
    assert.equal((await ctx.blobs.stat(`${base}/images/ok.png`))!.contentType, 'image/png');
  });

  it('PUT refuses content that does not match its declared type, markup, SVG, wrong folder, empty and oversize files', async () => {
    const cases: Array<[string, Buffer, string, number]> = [
      ['images/fake.png', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png', 415],
      ['images/svg.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/svg+xml', 415],
      ['images/svg-as-png.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png', 415],
      ['images/mp4-as-png.png', fs.readFileSync(makeTestClip(tempDir('u-'), 'a.mp4', 'red')), 'image/png', 415],
      ['videos/png-as-mp4.mp4', PNG_BYTES, 'video/mp4', 415],
      ['zips/notzip.zip', Buffer.from('hello'), 'application/zip', 415],
      ['files/page.txt', Buffer.from('<!DOCTYPE html><html></html>'), 'text/plain', 415],
      ['files/exe.bin', Buffer.from('MZ\u0090\u0000\u0003'), 'application/octet-stream', 415],
      ['images/empty.png', Buffer.alloc(0), 'image/png', 400],
      ['evil/a.png', PNG_BYTES, 'image/png', 400],
      ['images/huge.png', Buffer.concat([PNG_BYTES, Buffer.alloc(16 * 1024 * 1024)]), 'image/png', 413],
    ];
    for (const [rel, body, type, status] of cases) {
      const r = await put(`${base}/${rel}`, body, type);
      assert.equal(r.status, status, rel);
      assert.equal(await ctx.blobs.stat(`${base}/${rel}`), null, `${rel} was not stored`);
    }
    // plain text is fine in "files"
    assert.equal((await put(`${base}/files/notes.txt`, Buffer.from('line one\nline two'), 'text/plain')).status, 201);
    assert.equal((await put(`${base}/files/data.json`, Buffer.from('{"a":1}'), 'application/json')).status, 201);
  });

  it('upload-complete (after a direct upload) verifies the stored file and deletes invalid ones', async () => {
    await ctx.blobs.put(`${base}/images/direct-bad.png`, Buffer.from('<html>evil</html>'), 'image/png');
    await ctx.blobs.put(`${base}/images/direct-good.png`, PNG_BYTES, 'image/png');
    const bad = await call('POST', '/api/storage/upload-complete', { key: `${base}/images/direct-bad.png` });
    assert.equal(bad.status, 415);
    assert.equal(await code(bad), 'rejected_and_deleted');
    assert.equal(await ctx.blobs.stat(`${base}/images/direct-bad.png`), null, 'the invalid file was deleted');
    assert.equal((await call('POST', '/api/storage/upload-complete', { key: `${base}/images/direct-good.png` })).status, 200);
    assert.equal((await call('POST', '/api/storage/upload-complete', { key: 'users/victim/projects/p/images/a.png' })).status, 404);
  });

  it('files are served safely: images inline, everything else only as a download, always nosniff', async () => {
    const img = await call('GET', `/api/media/${base}/images/ok.png`);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    await ctx.blobs.put(`${base}/files/danger.html`, Buffer.from('<script>alert(1)</script>'), 'text/html');
    const html = await call('GET', `/api/media/${base}/files/danger.html`);
    assert.equal(html.headers.get('content-type'), 'application/octet-stream');
    assert.match(html.headers.get('content-disposition') || '', /attachment/);
    const txt = await call('GET', `/api/media/${base}/files/notes.txt`);
    assert.match(txt.headers.get('content-disposition') || '', /attachment/, 'text is also never rendered inline');
  });

  it('internal folders (_body, _jobs, _usage) are unreachable through the file API', async () => {
    await ctx.blobs.put(`${base}/_body/secret.json`, Buffer.from('{}'), 'application/json');
    assert.equal((await call('GET', `/api/media/${base}/_body/secret.json`)).status, 404);
    assert.equal((await call('DELETE', `/api/storage/files/${base}/_body/secret.json`)).status, 404);
    assert.equal((await put(`${base}/_body/x.png`, PNG_BYTES, 'image/png')).status, 403);
    const files = (await (await call('GET', `/api/storage/files?projectId=pu`)).json()) as { files: Array<{ key: string }> };
    assert.ok(!files.files.some((f) => f.key.includes('/_body/')));
  });

  it('file signature detection: known formats, markup is never "text"', () => {
    assert.equal(sniffFamily(PNG_BYTES), 'png');
    assert.equal(sniffFamily(Buffer.from('ffd8ffe000104a464946', 'hex')), 'jpeg');
    assert.equal(sniffFamily(Buffer.from('PK\u0003\u0004rest')), 'zip');
    assert.equal(sniffFamily(Buffer.from('%PDF-1.7')), 'pdf');
    assert.equal(sniffFamily(Buffer.from('plain words')), 'text');
    for (const markup of ['<html>', '  <!DOCTYPE html>', '<svg>', '<script>', '<?xml version="1.0"?>']) assert.equal(sniffFamily(Buffer.from(markup)), null, markup);
    assert.equal(sniffFamily(Buffer.from([0, 1, 2, 3])), null);
  });
});

describe('input validation', () => {
  let ctx: Ctx;
  let call: ReturnType<typeof api>;
  before(async () => {
    ctx = await serve();
    call = api(ctx.base, (await signIn(ctx.base)).cookie);
  });
  after(() => ctx.close());

  it('prompts and metadata: wrong types, control characters, too long, bad ids/enums => 400 (no provider call)', async () => {
    const calls = () => ctx.stub.calls.length;
    const before = calls();
    const bads: Array<[string, unknown]> = [
      ['/api/chat', { message: 123 }],
      ['/api/chat', { message: 'bell\u0007char' }],
      ['/api/chat', { message: 'ok', projectTitle: 'x'.repeat(201) }],
      ['/api/chat', { message: 'ok', materialsBundle: 'x'.repeat(60_001) }],
      ['/api/generate-character-ref', { prompt: 'p', slot: 'face', characterInfo: 'x'.repeat(4001) }],
      ['/api/generate/shot-image', { sceneId: 'S 01', shotId: 'SH01', prompt: 'p' }],
      ['/api/generate/shot-image', { sceneId: 'S01', shotId: 'SH01', prompt: 'p', aspectRatio: '5:4' }],
      ['/api/generate/shot-video', { projectId: 'p', sceneId: 'S01', shotId: 'SH01', prompt: 'p', startImage: PNG_URL, idempotencyKey: 'short' }],
      ['/api/generate/shot-video', { projectId: 'p', sceneId: 'S01', shotId: 'SH01', prompt: 'p', startImage: 'http://evil/x.png', idempotencyKey: 'long-enough-key' }],
      ['/api/generate/shot-video', { projectId: 'p', sceneId: 'S01', shotId: 'SH01', prompt: 'p', startImage: PNG_URL, idempotencyKey: 'long-enough-key', durationSec: 9999 }],
      ['/api/generate/shot-video', { projectId: 'p', sceneId: 'S01', shotId: 'SH01', prompt: 'p', startImage: PNG_URL, idempotencyKey: 'long-enough-key', resolution: '8k' }],
      ['/api/export/mp4', { projectId: 'p', clips: [] }],
    ];
    for (const [p, body] of bads) {
      const r = await call('POST', p, body);
      assert.ok([400, 413, 415].includes(r.status), `${p} ${JSON.stringify(body).slice(0, 50)} -> ${r.status}`);
    }
    assert.equal(calls(), before, 'nothing reached the AI provider');
  });
});

describe('secrets never appear in logs or error responses', () => {
  it('a provider error that contains an API key is redacted in the response AND in the server log', async () => {
    const ctx = await serve();
    const logged: string[] = [];
    const orig = { error: console.error, warn: console.warn, log: console.log };
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    console.warn = console.error;
    console.log = console.error;
    try {
      const { cookie } = await signIn(ctx.base);
      ctx.stub.provider.generateText = async () => {
        throw new Error(`upstream 403 for https://generativelanguage.googleapis.com/v1/models?key=${FAKE_KEY} (x-goog-api-key: ${FAKE_KEY})`);
      };
      ctx.stub.provider.generateImage = ctx.stub.provider.generateText as never;
      const call = api(ctx.base, cookie);
      const chat = await call('POST', '/api/chat', { message: 'hello' });
      assert.equal(chat.status, 502);
      const chatBody = await chat.text();
      assert.ok(!chatBody.includes(FAKE_KEY) && chatBody.includes('[REDACTED'), chatBody);
      const img = await call('POST', '/api/generate/shot-image', { sceneId: 'S01', shotId: 'SH01', prompt: 'p' });
      assert.ok(!(await img.text()).includes(FAKE_KEY));
      assert.ok(logged.length > 0, 'errors are logged');
      const all = logged.join('\n');
      assert.ok(!all.includes(FAKE_KEY), 'no API key in the log');
      assert.ok(!all.includes(cookie.split('=')[1]), 'no session cookie in the log');
      assert.ok(!all.includes(TEST_SESSION_SECRET), 'no session secret in the log');
    } finally {
      Object.assign(console, orig);
      ctx.close();
    }
  });
});

describe('configuration safety rules', () => {
  const sign = { GOOGLE_OAUTH_CLIENT_ID: 'test-client-123.apps.googleusercontent.com', SESSION_SECRET: 'z'.repeat(40), ALLOWED_EMAILS: 'me@x.com' };
  it('Cloud Run mode is always production (Secure cookie, HSTS) and needs Firestore, bucket and sign-in', () => {
    const o = buildOptionsFromEnv({ ...sign, K_SERVICE: 'svc', GCS_BUCKET: 'b', FIRESTORE_ENABLED: 'true' });
    assert.equal(o.production, true);
    assert.throws(() => buildOptionsFromEnv({ ...sign, K_SERVICE: 'svc', GCS_BUCKET: 'b' }), /FIRESTORE_ENABLED=true is required on Cloud Run/);
  });
  it('a real Gemini key is never allowed behind an open (no sign-in, no token) endpoint', () => {
    assert.throws(() => buildOptionsFromEnv({ GEMINI_API_KEY: FAKE_KEY }), /STUDIO_ACCESS_TOKEN/);
    assert.equal(buildOptionsFromEnv({ GEMINI_API_KEY: FAKE_KEY, STUDIO_ACCESS_TOKEN: 'a-long-token' }).provider !== null, true);
    assert.equal(buildOptionsFromEnv({}).provider, null);
  });
  it('CORS_ORIGINS, JOB_QUEUE and QUOTA_* values are validated at start-up', () => {
    assert.throws(() => buildOptionsFromEnv({ CORS_ORIGINS: '*' }), ConfigError);
    assert.throws(() => buildOptionsFromEnv({ JOB_QUEUE: 'cloud-tasks' }), /not implemented/);
    assert.throws(() => buildOptionsFromEnv({ QUOTA_VIDEO_PER_DAY: '0' }), /QUOTA_VIDEO_PER_DAY/);
    assert.deepEqual(buildOptionsFromEnv({ CORS_ORIGINS: 'https://app.example.com' }).corsOrigins, ['https://app.example.com']);
  });
});
