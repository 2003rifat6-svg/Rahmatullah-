/**
 * Rate limit / quota tests. The same counter rules run on the Firestore store (emulator) and on the
 * local-file store; API tests then prove 429s, separate limits, durability across a "restart",
 * and that invalid/duplicate requests do not use quota.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BlobStore, LocalDiskBlobStore } from '../server/blobStore';
import { BlobUsageStore, FirestoreUsageStore, LimitSpec, limitsFor, quotaConfigFromEnv, QuotaConfig, UsageStore } from '../server/usage';
import { Client, CloudEnv, startCloudEnv } from './cloudEnv';
import { emulatorsAvailable } from './emulators';
import { tempDir, TINY_PNG_BASE64 } from './helpers';

const missing = emulatorsAvailable();
const PNG = `data:image/png;base64,${TINY_PNG_BASE64}`;

const MIN: LimitSpec = { key: 'video:min', max: 100, windowSec: 60, label: 'video generations per minute' };
const DAY2: LimitSpec = { key: 'video:day', max: 2, windowSec: 86400, label: 'video generations per day' };

function counterSuite(name: string, make: () => Promise<{ store: UsageStore; again: () => UsageStore }>) {
  describe(`usage counters [${name}]`, () => {
    let ctx: Awaited<ReturnType<typeof make>>;
    let n = 0;
    const user = () => `cu${++n}${Math.random().toString(36).slice(2, 6)}`;
    before(async () => {
      ctx = await make();
    });

    it('allows up to the limit, then rejects with label, limit, retry time and reset time', async () => {
      const u = user();
      const spec: LimitSpec = { key: 'chat:min', max: 3, windowSec: 60, label: 'AI chat messages per minute' };
      const t = Date.UTC(2026, 0, 1, 10, 0, 20);
      for (let i = 0; i < 3; i++) assert.equal((await ctx.store.consume(u, [spec], t)).allowed, true);
      const r = await ctx.store.consume(u, [spec], t);
      assert.equal(r.allowed, false);
      if (r.allowed) return;
      assert.equal(r.limit, 3);
      assert.equal(r.label, 'AI chat messages per minute');
      assert.equal(r.retryAfterSec, 40, 'window ends at 10:01:00');
      assert.equal(r.resetAt, '2026-01-01T10:01:00.000Z');
      assert.equal(await ctx.store.read(u, spec, t), 3, 'a rejected request does not count');
    });

    it('a new window starts a fresh count', async () => {
      const u = user();
      const spec: LimitSpec = { key: 'x:min', max: 1, windowSec: 60, label: 'x' };
      const t = Date.UTC(2026, 0, 1, 10, 0, 20);
      assert.equal((await ctx.store.consume(u, [spec], t)).allowed, true);
      assert.equal((await ctx.store.consume(u, [spec], t + 10_000)).allowed, false);
      assert.equal((await ctx.store.consume(u, [spec], t + 60_000)).allowed, true);
    });

    it('all-or-nothing: when one limit is full, no other counter is increased', async () => {
      const u = user();
      const t = Date.UTC(2026, 0, 1, 12, 0, 0);
      assert.equal((await ctx.store.consume(u, [MIN, DAY2], t)).allowed, true);
      assert.equal((await ctx.store.consume(u, [MIN, DAY2], t)).allowed, true);
      const denied = await ctx.store.consume(u, [MIN, DAY2], t);
      assert.equal(denied.allowed, false);
      assert.equal(await ctx.store.read(u, MIN, t), 2, 'minute counter was not touched by the rejected request');
      assert.equal(await ctx.store.read(u, DAY2, t), 2);
    });

    it('survives a restart: a new store object over the same storage sees the same counts', async () => {
      const u = user();
      const spec: LimitSpec = { key: 'persist:day', max: 2, windowSec: 86400, label: 'persisted' };
      await ctx.store.consume(u, [spec]);
      await ctx.store.consume(u, [spec]);
      const afterRestart = ctx.again();
      assert.equal((await afterRestart.consume(u, [spec])).allowed, false, 'quota state was not lost');
      assert.equal(await afterRestart.read(u, spec), 2);
    });

    it('parallel requests cannot exceed the limit (20 at once, limit 5 => exactly 5 pass)', async () => {
      const u = user();
      const spec: LimitSpec = { key: 'par:min', max: 5, windowSec: 60, label: 'p' };
      const results = await Promise.all(Array.from({ length: 20 }, () => ctx.store.consume(u, [spec])));
      assert.equal(results.filter((r) => r.allowed).length, 5);
    });

    it('users have separate counters', async () => {
      const [a, b] = [user(), user()];
      const spec: LimitSpec = { key: 'sep:min', max: 1, windowSec: 60, label: 's' };
      assert.equal((await ctx.store.consume(a, [spec])).allowed, true);
      assert.equal((await ctx.store.consume(a, [spec])).allowed, false);
      assert.equal((await ctx.store.consume(b, [spec])).allowed, true);
    });
  });
}

counterSuite('local-file store', async () => {
  const blobs: BlobStore = new LocalDiskBlobStore(tempDir('usage-'));
  const store = new BlobUsageStore(blobs);
  return { store, again: () => new BlobUsageStore(blobs) };
});

describe('quota configuration', () => {
  it('has separate, sensible defaults for chat, image, video and story', () => {
    const c = quotaConfigFromEnv({});
    assert.ok(c.video.perDay < c.image.perDay, 'video (Veo) is limited much harder than images');
    const keys = (g: 'chat' | 'image' | 'video' | 'story') => limitsFor(c, g, 'p1').map((s) => s.key);
    assert.deepEqual(keys('chat'), ['chat:min', 'chat:day']);
    assert.deepEqual(keys('video'), ['video:min', 'video:day', 'project:p1:video:day']);
    assert.deepEqual(keys('image'), ['image:min', 'image:day', 'project:p1:image:day']);
    assert.equal(new Set([...keys('chat'), ...keys('image'), ...keys('video'), ...keys('story')]).size, 2 + 3 + 3 + 2, 'no shared counters between endpoint groups');
  });
  it('can be set from the environment; invalid values are refused', () => {
    assert.equal(quotaConfigFromEnv({ QUOTA_VIDEO_PER_DAY: '7' }).video.perDay, 7);
    for (const bad of ['0', '-3', 'abc', '2.5']) assert.throws(() => quotaConfigFromEnv({ QUOTA_VIDEO_PER_DAY: bad }), /QUOTA_VIDEO_PER_DAY/);
  });
});

describe('rate limits through the API (Firestore emulator)', { skip: missing ?? false }, () => {
  let env: CloudEnv;
  let srv: Awaited<ReturnType<CloudEnv['serve']>>;
  let alice: Client;
  let bob: Client;
  let anon: Client;
  const quotas: QuotaConfig = {
    chat: { perMin: 3, perDay: 1000 },
    image: { perMin: 50, perDay: 1000 },
    video: { perMin: 2, perDay: 1000 },
    story: { perMin: 3, perDay: 1000 },
    project: { imagePerDay: 2, videoPerDay: 1000 },
  };
  const shotImg = (projectId: string, shot = 'SH01') => ({ projectId, sceneId: 'S01', shotId: shot, prompt: 'a boat', aspectRatio: '16:9' });
  const video = (projectId: string, shot: string, key: string) => ({ projectId, sceneId: 'S01', shotId: shot, prompt: 'push in', startImage: PNG, idempotencyKey: key });

  before(async () => {
    // Per-minute windows are aligned to the clock: start early in a minute so no test straddles a boundary.
    const msIntoMinute = Date.now() % 60_000;
    if (msIntoMinute > 25_000) await new Promise((r) => setTimeout(r, 60_000 - msIntoMinute + 200));
    env = await startCloudEnv('mms-rate');
    srv = await env.serve({ quotas });
    alice = new Client(srv.base);
    bob = new Client(srv.base);
    anon = new Client(srv.base);
    await alice.signIn('alice1', 'alice@x.com');
    await bob.signIn('bob2', 'bob@x.com');
  });
  after(() => {
    srv?.close();
    env?.stop();
  });

  counterSuite('Firestore store', async () => ({
    store: new FirestoreUsageStore(env.db),
    again: () => new FirestoreUsageStore(env.db),
  }));

  it('AI requests without sign-in get 401 and use no quota', async () => {
    for (const [p, body] of [['/api/chat', { message: 'hi' }], ['/api/generate/shot-image', shotImg('p0')], ['/api/generate/shot-video', video('p0', 'SH01', 'anon-key-0001')]] as const) {
      assert.equal((await anon.json('POST', p, body)).status, 401, p);
    }
    assert.equal(await new FirestoreUsageStore(env.db).read('anon', limitsFor(quotas, 'chat')[0]), 0);
  });

  it('chat: the 4th message in a minute gets HTTP 429 with Retry-After and a clear bilingual message', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await alice.json('POST', '/api/chat', { message: `hello ${i}` })).status, 200);
    const r = await alice.json('POST', '/api/chat', { message: 'one too many' });
    assert.equal(r.status, 429);
    assert.equal(r.body.code, 'quota_exceeded');
    assert.equal(r.body.limit, 3);
    assert.match(r.body.error, /Limit reached: 3 AI chat messages per minute/);
    assert.match(r.body.error, /সীমা শেষ/);
    assert.ok(Number(r.headers.get('retry-after')) >= 1 && Number(r.headers.get('retry-after')) <= 60);
    assert.ok(r.body.resetAt);
    const providerCalls = env.stub.calls.filter((c) => c.fn === 'generateText').length;
    await alice.json('POST', '/api/chat', { message: 'still blocked' });
    assert.equal(env.stub.calls.filter((c) => c.fn === 'generateText').length, providerCalls, 'the provider is NOT called once the limit is reached');
  });

  it('limits are separate per endpoint group: chat is blocked, images and videos still work', async () => {
    assert.equal((await alice.json('POST', '/api/generate/shot-image', shotImg('sepP'))).status, 200);
    assert.equal((await alice.json('POST', '/api/generate/shot-video', video('sepP', 'SH01', 'sep-video-0001'))).status, 201);
  });

  it('another user is not limited by Alice’s usage', async () => {
    assert.equal((await bob.json('POST', '/api/chat', { message: 'hi from bob' })).status, 200);
  });

  it('per-project limit: the 3rd image of one project in a day is refused, another project is fine', async () => {
    assert.equal((await alice.json('POST', '/api/generate/shot-image', shotImg('projLim', 'SH01'))).status, 200);
    assert.equal((await alice.json('POST', '/api/generate/shot-image', shotImg('projLim', 'SH02'))).status, 200);
    const third = await alice.json('POST', '/api/generate/shot-image', shotImg('projLim', 'SH03'));
    assert.equal(third.status, 429);
    assert.match(third.body.error, /for this project/);
    assert.equal((await alice.json('POST', '/api/generate/shot-image', shotImg('otherProj', 'SH01'))).status, 200);
  });

  it('video: Veo has its own tighter limit; duplicates are free; a refused job releases the shot', async () => {
    const start = await bob.json('POST', '/api/generate/shot-video', video('vq', 'SH01', 'vq-key-00001'));
    assert.equal(start.status, 201);
    const dup = await bob.json('POST', '/api/generate/shot-video', video('vq', 'SH01', 'vq-key-00001'));
    assert.equal(dup.status, 200);
    assert.equal(dup.body.reused, 'idempotent');
    assert.equal((await bob.json('POST', '/api/generate/shot-video', video('vq', 'SH02', 'vq-key-00002'))).status, 201);
    assert.equal(await new FirestoreUsageStore(env.db).read('bob2', limitsFor(quotas, 'video')[0]), 2, 'only the two real jobs used quota');
    const refused = await bob.json('POST', '/api/generate/shot-video', video('vq', 'SH03', 'vq-key-00003'));
    assert.equal(refused.status, 429);
    assert.match(refused.body.error, /video generations per minute/);
    const jobs = (await bob.json('GET', '/api/generate/jobs?projectId=vq')).body.jobs as Array<{ shotId: string; status: string; errorCode: string }>;
    const j3 = jobs.find((j) => j.shotId === 'SH03')!;
    assert.equal(j3.status, 'failed');
    assert.equal(j3.errorCode, 'quota_exceeded');
    assert.equal(env.stub.calls.filter((c) => c.fn === 'startVideo' && (c.args as { prompt: string }).prompt === 'push in').length >= 2, true);
  });

  it('quota state survives a server restart (durable): a new app instance still refuses', async () => {
    srv.close();
    srv = await env.serve({ quotas });
    const fresh = new Client(srv.base);
    fresh.cookie = alice.cookie;
    const r = await fresh.json('POST', '/api/chat', { message: 'after restart' });
    assert.equal(r.status, 429, 'Alice already used her 3 messages this minute');
    alice = fresh;
    bob.base = srv.base;
    anon.base = srv.base;
  });

  it('invalid requests are rejected with 400 and do NOT use quota', async () => {
    const read = () => new FirestoreUsageStore(env.db).read('bob2', limitsFor(quotas, 'chat')[0]);
    const before = await read();
    for (const body of [{}, { message: '' }, { message: 'x'.repeat(4001) }, { message: 'ok', history: 'nope' }, { message: 'a\u0000b' }]) {
      const r = await bob.json('POST', '/api/chat', body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal(await read(), before);
  });

  it('size limits: oversized bodies are 413, bad/oversized/fake images are refused before any paid call', async () => {
    const calls = () => env.stub.calls.filter((c) => c.fn === 'generateImage' || c.fn === 'generateText').length;
    const before = calls();
    // chat body limit (800 KB)
    const huge = await bob.req('POST', '/api/chat', { message: 'x', history: [{ role: 'user', text: 'y'.repeat(900_000) }] });
    assert.equal(huge.status, 413);
    assert.equal(((await huge.json()) as { code: string }).code, 'payload_too_large');
    // a text file pretending to be a PNG
    const fake = await bob.json('POST', '/api/generate/shot-image', { ...shotImg('szP'), characters: [{ info: 'x', referenceImages: [`data:image/png;base64,${Buffer.from('<html>not an image</html>').toString('base64')}`] }] });
    assert.equal(fake.status, 415);
    // too large single image (> 4 MB)
    const big = Buffer.concat([Buffer.from(TINY_PNG_BASE64, 'base64'), Buffer.alloc(5 * 1024 * 1024)]);
    const tooBig = await bob.json('POST', '/api/generate/shot-image', { ...shotImg('szP'), characters: [{ info: 'x', referenceImages: [`data:image/png;base64,${big.toString('base64')}`] }] });
    assert.equal(tooBig.status, 413);
    // too many characters / bad enum / bad ids
    assert.equal((await bob.json('POST', '/api/generate/shot-image', { ...shotImg('szP'), characters: Array(5).fill({ info: 'x' }) })).status, 400);
    assert.equal((await bob.json('POST', '/api/generate/shot-image', { ...shotImg('szP'), aspectRatio: '99:1' })).status, 400);
    assert.equal((await bob.json('POST', '/api/generate/shot-image', { ...shotImg('../evil') })).status, 400);
    assert.equal((await bob.json('POST', '/api/generate-character-ref', { prompt: 'p', slot: 'head' })).status, 400);
    assert.equal(calls(), before, 'no provider call for any rejected request');
    // malformed JSON
    const bad = await fetch(srv.base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms', cookie: bob.cookie }, body: '{"message": ' });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { code: string }).code, 'bad_json');
  });

  it('sign-in attempts are limited per address (429 after 30 in a minute)', async () => {
    const results: number[] = [];
    for (let i = 0; i < 34; i++) results.push((await anon.req('POST', '/api/auth/session', { credential: 'garbage-credential' })).status);
    assert.ok(results.includes(429), `statuses: ${[...new Set(results)].join(',')}`);
    assert.equal(results.filter((s) => s === 401).length <= 30, true);
  });
});

if (missing) console.log(`# SKIPPED Firestore rate-limit tests: ${missing}`);
