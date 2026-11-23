import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app';
import { createGeminiProvider } from '../server/provider';
import { createStubProvider, makeTestClip, tempDir, TINY_PNG_BASE64 } from './helpers';

const PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

function listen(app: ReturnType<typeof createApp>) {
  return new Promise<{ base: string; close: () => void }>((resolve) => {
    const srv = app.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
  });
}

const post = (base: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('provider factory', () => {
  it('creates no provider (no paid API) when GEMINI_API_KEY is missing or placeholder', () => {
    assert.equal(createGeminiProvider({}), null);
    assert.equal(createGeminiProvider({ GEMINI_API_KEY: 'MY_GEMINI_API_KEY' }), null);
  });
});

describe('backend without GEMINI_API_KEY', () => {
  let srv: { base: string; close: () => void };
  before(async () => {
    srv = await listen(createApp({ provider: null, mediaDir: tempDir('media-none-') }));
  });
  after(() => srv.close());

  it('/health reports gemini not configured', async () => {
    const h = await (await fetch(srv.base + '/health')).json();
    assert.equal(h.ok, true);
    assert.equal(h.geminiConfigured, false);
  });

  it('generation endpoints answer 503, never fake output', async () => {
    for (const p of ['/api/chat', '/api/generate/shot-image', '/api/generate-character-ref', '/api/generate/shot-video']) {
      const res = await post(srv.base, p, { message: 'x', prompt: 'x', startImage: PNG_DATA_URL });
      assert.equal(res.status, 503, p);
      const body = await res.json();
      assert.match(body.error, /GEMINI_API_KEY/);
      assert.equal(body.imageUrl, undefined);
    }
  });

  it('cloud project sync is honestly reported as not implemented (501)', async () => {
    const res = await post(srv.base, '/api/projects', {});
    assert.equal(res.status, 501);
  });
});

describe('backend with a stub provider + real FFmpeg', () => {
  let srv: { base: string; close: () => void };
  let stub: ReturnType<typeof createStubProvider>;
  let mediaDir: string;

  before(async () => {
    const clipDir = tempDir('clips-');
    const clip = makeTestClip(clipDir, 'clip.mp4', 'red');
    stub = createStubProvider(clip);
    mediaDir = tempDir('media-');
    srv = await listen(createApp({ provider: stub.provider, mediaDir, accessToken: 'secret-token' }));
  });
  after(() => srv.close());

  const auth = { 'x-studio-token': 'secret-token' };

  it('rejects API calls without the studio access token', async () => {
    const res = await post(srv.base, '/api/chat', { message: 'hi' });
    assert.equal(res.status, 401);
  });

  it('chat passes the materials bundle to the model', async () => {
    const res = await post(srv.base, '/api/chat', { message: 'check my story', materialsBundle: 'BUNDLE-XYZ', history: [] }, auth);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).replyText, 'stub reply to: check my story');
    const call = stub.calls.find((c) => c.fn === 'generateText')!;
    assert.match((call.args as { system: string }).system, /BUNDLE-XYZ/);
  });

  it('shot image sends character reference images and returns a data URL', async () => {
    const res = await post(
      srv.base,
      '/api/generate/shot-image',
      {
        sceneId: 'S01',
        shotId: 'SH01',
        prompt: 'Elena on the pier',
        aspectRatio: '16:9',
        characters: [{ name: 'Elena', info: 'Name: Elena', referenceImages: [PNG_DATA_URL, PNG_DATA_URL] }],
      },
      auth
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.imageUrl.startsWith('data:image/png;base64,'));
    const call = stub.calls.filter((c) => c.fn === 'generateImage').pop()!;
    assert.equal((call.args as { refs: number }).refs, 2);
  });

  it('video job: start → running → completed, file stored and served, then FFmpeg assembles a movie', async () => {
    stub.resetPolls();
    const urls: string[] = [];
    for (const shot of ['SH01', 'SH02']) {
      stub.resetPolls();
      const start = await post(
        srv.base,
        '/api/generate/shot-video',
        { projectId: 'proj_1', sceneId: 'S01', shotId: shot, prompt: 'slow push in', startImage: PNG_DATA_URL, aspectRatio: '16:9', durationSec: 8 },
        auth
      );
      assert.equal(start.status, 200);
      const { jobId } = await start.json();
      const first = await (await fetch(`${srv.base}/api/generate/video-status/${jobId}`, { headers: auth })).json();
      assert.equal(first.status, 'running');
      await new Promise((r) => setTimeout(r, 4200));
      const second = await (await fetch(`${srv.base}/api/generate/video-status/${jobId}`, { headers: auth })).json();
      assert.equal(second.status, 'completed');
      assert.match(second.videoUrl, /^\/media\/proj_1\/S01_SH0\d_.*\.mp4$/);
      const media = await fetch(srv.base + second.videoUrl);
      assert.equal(media.status, 200);
      urls.push(second.videoUrl);
    }

    const exp = await post(
      srv.base,
      '/api/export/mp4',
      { projectId: 'proj_1', clips: urls.map((u, i) => ({ sceneId: 'S01', shotId: `SH0${i + 1}`, videoUrl: u })) },
      auth
    );
    assert.equal(exp.status, 200);
    const body = await exp.json();
    assert.equal(body.clipCount, 2);
    const outFile = path.join(mediaDir, body.downloadUrl.replace('/media/', ''));
    assert.ok(fs.existsSync(outFile));
    const duration = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile]).toString().trim()
    );
    assert.ok(duration > 1.8 && duration < 2.5, `movie duration ${duration}`);
  });

  it('export refuses clips that are not stored on this server (no SSRF / path traversal)', async () => {
    for (const videoUrl of ['https://example.com/a.mp4', '/media/../../etc/passwd']) {
      const res = await post(srv.base, '/api/export/mp4', { projectId: 'p', clips: [{ sceneId: 'S01', shotId: 'SH01', videoUrl }] }, auth);
      assert.equal(res.status, 400, videoUrl);
    }
  });

  it('unknown video job ids answer 410', async () => {
    const res = await fetch(`${srv.base}/api/generate/video-status/nope`, { headers: auth });
    assert.equal(res.status, 410);
  });
});
