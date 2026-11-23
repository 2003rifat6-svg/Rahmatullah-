/**
 * Backend UNIT tests (no Google Cloud needed): auth primitives, config fail-closed rules,
 * key safety, local-dev mode, AI endpoints with a stub provider, FFmpeg export.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp, mediaKeyFromUrl } from '../server/app';
import { readCookie, sessionCookie, signSession, verifySession } from '../server/auth';
import { isSafeKey, LocalDiskBlobStore, projectPrefix } from '../server/blobStore';
import { BlobJobStore } from '../server/jobStore';
import { BlobUsageStore } from '../server/usage';
import { buildOptionsFromEnv, ConfigError } from '../server/config';
import { createGeminiProvider } from '../server/provider';
import { createStubProvider, listen, makeTestClip, tempDir, TINY_PNG_BASE64 } from './helpers';

const PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

const post = (base: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('auth primitives', () => {
  const secret = 'x'.repeat(40);
  it('signed session round-trips, rejects tampering, wrong secret and expiry', () => {
    const tok = signSession({ uid: 'u1', email: 'a@b.c' }, secret, 1000);
    assert.equal(verifySession(tok, secret, 2000)?.uid, 'u1');
    const [p, s] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'u2', email: 'x', exp: 9e15 })).toString('base64url');
    assert.equal(verifySession(`${forged}.${s}`, secret, 2000), null);
    assert.equal(verifySession(`${p}.${s}x`, secret, 2000), null);
    assert.equal(verifySession(tok, 'y'.repeat(40), 2000), null);
    assert.equal(verifySession(tok, secret, 1000 + 8 * 86400_000), null);
  });

  it('cookie is HttpOnly + SameSite=Lax, Secure on https', () => {
    const c = sessionCookie('v', { secure: true, crossSite: false });
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Secure/);
    assert.equal(readCookie({ headers: { cookie: 'a=1; mms_session=abc%3D' } } as never, 'mms_session'), 'abc=');
  });
});

describe('storage keys', () => {
  it('only safe user-scoped keys are accepted', () => {
    assert.equal(isSafeKey('users/1/projects/p/videos/a.mp4'), true);
    for (const bad of ['../x', 'users/1/../2/a', '/abs', 'users/1/a b', 'users\\1', '']) assert.equal(isSafeKey(bad), false, bad);
    assert.equal(projectPrefix('1', '../evil'), 'users/1/projects/_evil/');
    assert.equal(mediaKeyFromUrl('https://x.run.app/api/media/users/1/projects/p/a.mp4'), 'users/1/projects/p/a.mp4');
    assert.equal(mediaKeyFromUrl('/api/media/users/1/..%2F..%2Fetc'), null);
    assert.equal(mediaKeyFromUrl('https://evil.com/a.mp4'), null);
  });
});

describe('config fails closed', () => {
  it('no paid provider without GEMINI_API_KEY', () => {
    assert.equal(createGeminiProvider({}), null);
    assert.equal(createGeminiProvider({ GEMINI_API_KEY: 'MY_GEMINI_API_KEY' }), null);
  });
  it('Cloud Run requires GCS_BUCKET and sign-in', () => {
    assert.throws(() => buildOptionsFromEnv({ K_SERVICE: 'svc' }), ConfigError);
    assert.throws(() => buildOptionsFromEnv({ K_SERVICE: 'svc', GCS_BUCKET: 'b' }), /GOOGLE_OAUTH_CLIENT_ID/);
    assert.throws(() => buildOptionsFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'id', SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  });
  it('sign-in without ALLOWED_EMAILS is refused (no open server)', () => {
    const base = { GOOGLE_OAUTH_CLIENT_ID: 'test-client-123.apps.googleusercontent.com', SESSION_SECRET: 'z'.repeat(40) };
    assert.throws(() => buildOptionsFromEnv({ ...base }), /ALLOWED_EMAILS is empty/);
    assert.throws(() => buildOptionsFromEnv({ ...base, ALLOWED_EMAILS: ' , ' }), /only commas\/spaces/);
  });
  it('full Cloud Run config builds GCS + Firestore + Google sign-in', () => {
    const o = buildOptionsFromEnv({
      K_SERVICE: 'svc',
      GCS_BUCKET: 'my-bucket',
      GOOGLE_OAUTH_CLIENT_ID: 'test-client-123.apps.googleusercontent.com',
      SESSION_SECRET: 'z'.repeat(40),
      FIRESTORE_ENABLED: 'true',
      GOOGLE_CLOUD_PROJECT: 'demo',
      ALLOWED_EMAILS: 'Me@Example.com',
    });
    assert.equal(o.blobStore.kind, 'gcs');
    assert.ok(o.projectStore);
    assert.equal(o.auth.mode, 'google');
    assert.deepEqual(o.auth.mode === 'google' && o.auth.allowedEmails, ['me@example.com']);
  });
});

function devBlobs() {
  return new LocalDiskBlobStore(tempDir('m-'));
}

describe('local dev mode (no sign-in, local disk)', () => {
  let srv: { base: string; close: () => void };
  before(async () => {
    srv = await listen(createApp({ provider: null, blobStore: devBlobs(), projectStore: null, jobStore: new BlobJobStore(devBlobs()), usageStore: new BlobUsageStore(devBlobs()), auth: { mode: 'none' } }));
  });
  after(() => srv.close());

  it('/health reports local mode honestly', async () => {
    const h = await (await fetch(srv.base + '/health')).json();
    assert.equal(h.geminiConfigured, false);
    assert.equal(h.authMode, 'none');
    assert.equal(h.cloudSync, false);
    assert.equal(h.storage, 'local-disk');
  });

  it('generation endpoints answer 503, never fake output', async () => {
    for (const p of ['/api/chat', '/api/generate/shot-image', '/api/generate-character-ref', '/api/generate/shot-video']) {
      const res = await post(srv.base, p, { message: 'x', prompt: 'x', startImage: PNG_DATA_URL });
      assert.equal(res.status, 503, p);
      assert.match((await res.json()).error, /GEMINI_API_KEY/);
    }
  });

  it('cloud project sync refuses without sign-in (503)', async () => {
    const res = await fetch(srv.base + '/api/projects');
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /sign-in/i);
  });
});

describe('AI + FFmpeg with stub provider (local disk storage)', () => {
  let srv: { base: string; close: () => void };
  let stub: ReturnType<typeof createStubProvider>;
  let mediaDir: string;
  const auth = { 'x-studio-token': 'secret-token' };

  before(async () => {
    stub = createStubProvider(makeTestClip(tempDir('clips-'), 'clip.mp4', 'red'));
    mediaDir = tempDir('media-');
    srv = await listen(
      createApp({
        provider: stub.provider,
        blobStore: new LocalDiskBlobStore(mediaDir),
        projectStore: null,
        jobStore: new BlobJobStore(new LocalDiskBlobStore(mediaDir)),
        usageStore: new BlobUsageStore(new LocalDiskBlobStore(mediaDir)),
        videoJobs: { pollIntervalMs: 0 },
        auth: { mode: 'none', accessToken: 'secret-token' },
      })
    );
  });
  after(() => srv.close());

  it('rejects API calls without the studio access token', async () => {
    assert.equal((await post(srv.base, '/api/chat', { message: 'hi' })).status, 401);
  });

  it('chat passes the materials bundle to the model', async () => {
    const res = await post(srv.base, '/api/chat', { message: 'check my story', materialsBundle: 'BUNDLE-XYZ', history: [] }, auth);
    assert.equal((await res.json()).replyText, 'stub reply to: check my story');
    assert.match((stub.calls.find((c) => c.fn === 'generateText')!.args as { system: string }).system, /BUNDLE-XYZ/);
  });

  it('shot image sends character references and returns a data URL', async () => {
    const res = await post(
      srv.base,
      '/api/generate/shot-image',
      { sceneId: 'S01', shotId: 'SH01', prompt: 'Elena', characters: [{ info: 'Elena', referenceImages: [PNG_DATA_URL, PNG_DATA_URL] }] },
      auth
    );
    assert.ok((await res.json()).imageUrl.startsWith('data:image/png;base64,'));
    assert.equal((stub.calls.filter((c) => c.fn === 'generateImage').pop()!.args as { refs: number }).refs, 2);
  });

  it('video job → stored file → FFmpeg movie; temp work files removed', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('mms-export-')).length;
    const urls: string[] = [];
    for (const shot of ['SH01', 'SH02']) {
      const start = await post(
        srv.base,
        '/api/generate/shot-video',
        { projectId: 'proj_1', sceneId: 'S01', shotId: shot, prompt: 'push in', startImage: PNG_DATA_URL, idempotencyKey: `idem-${shot}-0001` },
        auth
      );
      assert.equal(start.status, 201);
      const { jobId } = await start.json();
      assert.equal((await (await fetch(`${srv.base}/api/generate/video-status/${jobId}`, { headers: auth })).json()).status, 'running');
      const done = await (await fetch(`${srv.base}/api/generate/video-status/${jobId}`, { headers: auth })).json();
      assert.equal(done.status, 'completed');
      assert.match(done.videoUrl, /^\/api\/media\/users\/local\/projects\/proj_1\/videos\/S01_SH0\d_vj_[0-9a-f]{32}\.mp4$/);
      urls.push(done.videoUrl);
    }
    const media = await fetch(srv.base + urls[0], { headers: { Range: 'bytes=0-9' } });
    assert.equal(media.status, 206);
    assert.equal((await media.arrayBuffer()).byteLength, 10);

    const exp = await post(srv.base, '/api/export/mp4', { projectId: 'proj_1', clips: urls.map((videoUrl) => ({ videoUrl })) }, auth);
    const body = await exp.json();
    assert.equal(exp.status, 200, JSON.stringify(body));
    const outFile = path.join(mediaDir, body.downloadUrl.replace('/api/media/', ''));
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile]).toString());
    assert.ok(dur > 1.8 && dur < 2.5, `duration ${dur}`);
    assert.equal(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('mms-export-')).length, before);
  });

  it('export refuses clips outside the user storage (no SSRF / traversal)', async () => {
    for (const videoUrl of ['https://example.com/a.mp4', '/api/media/users/other/projects/p/videos/a.mp4', '/media/../../etc/passwd']) {
      const res = await post(srv.base, '/api/export/mp4', { projectId: 'p', clips: [{ videoUrl }] }, auth);
      assert.equal(res.status, 400, videoUrl);
    }
  });

  it('unknown video job ids answer 404', async () => {
    assert.equal((await fetch(`${srv.base}/api/generate/video-status/nope`, { headers: auth })).status, 404);
  });
});
