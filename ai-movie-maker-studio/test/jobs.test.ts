/**
 * Video-job persistence tests. The same lifecycle suite runs against
 *  - FirestoreJobStore on the real Firestore emulator (+ GCS emulator for the video files), and
 *  - BlobJobStore (development store on the local disk).
 * "Restart" = a brand-new deps/app object over the same stores and the same provider-side state.
 */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client } from 'google-auth-library';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app';
import { BlobStore, GcsBlobStore, LocalDiskBlobStore } from '../server/blobStore';
import { BlobJobStore, FirestoreJobStore, JobStore } from '../server/jobStore';
import { FirestoreUsageStore } from '../server/usage';
import { FirestoreProjectStore } from '../server/projectStore';
import { advanceJob, cancelJob, startVideoJob, StartVideoInput, VideoJobDeps } from '../server/videoJobs';
import { Emulators, emulatorsAvailable, startEmulators } from './emulators';
import { createStubProvider, listen, makeTestClip, tempDir, TEST_SESSION_SECRET, testVerifier, TINY_PNG_BASE64 } from './helpers';

const missing = emulatorsAvailable();
const FRAME = { mimeType: 'image/png', base64: TINY_PNG_BASE64 };
const clip = makeTestClip(tempDir('jobclip-'), 'c.mp4', 'white');

interface Env {
  jobs: JobStore;
  blobs: BlobStore;
  stub: ReturnType<typeof createStubProvider>;
  /** A "server instance": fresh deps over the same durable stores. */
  instance: (over?: Partial<VideoJobDeps>) => VideoJobDeps;
  objects: (prefix: string) => Promise<string[]>;
}

const input = (over: Partial<StartVideoInput> = {}): StartVideoInput => ({
  uid: 'u1',
  projectId: 'p1',
  sceneId: 'S01',
  shotId: 'SH01',
  linkedImageKey: 'S01-SH01',
  idempotencyKey: 'key-0000-0001',
  prompt: 'a boat at dawn',
  startFrame: FRAME,
  aspectRatio: '16:9',
  resolution: '720p',
  durationSec: 8,
  ...over,
});

function lifecycleSuite(name: string, make: () => Promise<Env>) {
  describe(`video jobs [${name}]`, () => {
    let env: Env;
    let n = 0;
    const fresh = (over: Partial<StartVideoInput> = {}) => input({ projectId: `proj${++n}`, idempotencyKey: `key-${n}-${Math.random().toString(36).slice(2, 10)}`, ...over });
    before(async () => {
      env = await make();
    });

    it('the job record keeps Job ID, Project ID, User ID, times, status and the Scene/Shot mapping', async () => {
      const i = fresh({ sceneId: 'S03', shotId: 'SH07', linkedImageKey: 'S03-SH07' });
      const { job, started } = await startVideoJob(env.instance(), i);
      assert.equal(started, true);
      const saved = (await env.jobs.get('u1', job.id))!;
      assert.equal(saved.id, job.id);
      assert.equal(saved.uid, 'u1');
      assert.equal(saved.projectId, i.projectId);
      assert.equal(saved.sceneId, 'S03');
      assert.equal(saved.shotId, 'SH07');
      assert.equal(saved.linkedImageKey, 'S03-SH07');
      assert.equal(saved.status, 'running');
      assert.match(saved.operationName!, /^operations\/stub-/);
      assert.ok(saved.createdAt && saved.startedAt && saved.updatedAt);
      assert.equal(saved.request.promptPreview, 'a boat at dawn');
    });

    it('survives a restart: a new server instance continues the stored job to completed and saves the video', async () => {
      const i = fresh();
      const before = await startVideoJob(env.instance(), i);
      assert.equal(before.job.status, 'running');
      const restarted = env.instance(); // brand-new instance, nothing in memory
      const first = (await advanceJob(restarted, 'u1', before.job.id))!;
      assert.equal(first.status, 'running');
      const second = (await advanceJob(env.instance(), 'u1', before.job.id))!;
      assert.equal(second.status, 'completed');
      assert.ok(second.result!.key.endsWith(`${second.id}.mp4`));
      assert.equal((await env.blobs.stat(second.result!.key))!.contentType, 'video/mp4');
      assert.equal(second.error, null);
      assert.ok(second.finishedAt);
      // idempotent completion: advancing a finished job changes nothing and writes nothing new
      const again = (await advanceJob(env.instance(), 'u1', before.job.id))!;
      assert.equal(again.updatedAt, second.updatedAt);
      assert.equal((await env.objects(`users/u1/projects/${i.projectId}/videos/`)).length, 1);
    });

    it('idempotency: the same key (even 8 parallel requests) calls the paid provider exactly once', async () => {
      const i = fresh();
      const before = env.stub.calls.filter((c) => c.fn === 'startVideo').length;
      const results = await Promise.all(Array.from({ length: 8 }, () => startVideoJob(env.instance(), i)));
      assert.equal(new Set(results.map((r) => r.job.id)).size, 1);
      assert.equal(results.filter((r) => r.started).length, 1, 'only one request submitted to the provider');
      assert.equal(env.stub.calls.filter((c) => c.fn === 'startVideo').length - before, 1);
      assert.ok(results.filter((r) => !r.started).every((r) => r.reused === 'idempotent' || r.reused === 'active'));
    });

    it('a shot that already has an active job returns it, even with a different idempotency key', async () => {
      const i = fresh();
      const first = await startVideoJob(env.instance(), i);
      const before = env.stub.calls.filter((c) => c.fn === 'startVideo').length;
      const second = await startVideoJob(env.instance(), { ...i, idempotencyKey: 'another-key-0002' });
      assert.equal(second.reused, 'active');
      assert.equal(second.job.id, first.job.id);
      assert.equal(env.stub.calls.filter((c) => c.fn === 'startVideo').length, before);
    });

    it('failure keeps the error; a retry (new key) creates a new job linked by retryOf', async () => {
      const i = fresh({ prompt: 'FAIL_ONCE sunrise' });
      const first = await startVideoJob(env.instance(), i);
      await advanceJob(env.instance(), 'u1', first.job.id);
      const failed = (await advanceJob(env.instance(), 'u1', first.job.id))!;
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error!.code, 'provider_failed');
      assert.match(failed.error!.message, /stub video failure/);
      assert.equal(failed.result, null);
      assert.ok(failed.finishedAt);
      // same key again returns the SAME failed job (no accidental duplicate run)
      assert.equal((await startVideoJob(env.instance(), i)).job.id, first.job.id);
      // a deliberate retry uses a new key
      const retry = await startVideoJob(env.instance(), { ...i, idempotencyKey: 'retry-key-0003', retryOf: first.job.id });
      assert.equal(retry.started, true);
      assert.notEqual(retry.job.id, first.job.id);
      assert.equal(retry.job.retryOf, first.job.id);
      assert.equal(retry.job.sceneId, i.sceneId, 'Scene/Shot mapping carried to the retry');
      await advanceJob(env.instance(), 'u1', retry.job.id);
      assert.equal((await advanceJob(env.instance(), 'u1', retry.job.id))!.status, 'completed');
    });

    it('cancel: an active job becomes cancelled, its result is discarded, finished jobs are not changed', async () => {
      const i = fresh();
      const { job } = await startVideoJob(env.instance(), i);
      await advanceJob(env.instance(), 'u1', job.id);
      const cancelled = (await cancelJob(env.instance(), 'u1', job.id))!;
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.error!.code, 'cancelled');
      const later = (await advanceJob(env.instance(), 'u1', job.id))!;
      assert.equal(later.status, 'cancelled', 'a late provider result cannot resurrect a cancelled job');
      assert.deepEqual(await env.objects(`users/u1/projects/${i.projectId}/videos/`), [], 'no video file kept');

      const doneJob = await startVideoJob(env.instance(), fresh());
      await advanceJob(env.instance(), 'u1', doneJob.job.id);
      await advanceJob(env.instance(), 'u1', doneJob.job.id);
      const afterCancel = (await cancelJob(env.instance(), 'u1', doneJob.job.id))!;
      assert.equal(afterCancel.status, 'completed');
    });

    it('queued: a job that was created but never reached the provider fails clearly after the timeout', async () => {
      const i = fresh();
      const created = await env.jobs.createOrGet({ ...i, request: { promptHash: 'h', promptPreview: 'p', aspectRatio: null, resolution: null, durationSec: null }, retryOf: null });
      assert.equal(created.job.status, 'queued');
      assert.equal((await advanceJob(env.instance({ queuedTimeoutMs: 60_000 }), 'u1', created.job.id))!.status, 'queued', 'still waiting inside the timeout');
      const stuck = (await advanceJob(env.instance({ queuedTimeoutMs: 0 }), 'u1', created.job.id))!;
      assert.equal(stuck.status, 'failed');
      assert.equal(stuck.error!.code, 'submission_interrupted');
    });

    it('poll lease: two instances polling together call the provider once', async () => {
      const { job } = await startVideoJob(env.instance({ pollIntervalMs: 60_000 }), fresh());
      const before = env.stub.calls.filter((c) => c.fn === 'pollVideo').length;
      const [a, b] = await Promise.all([advanceJob(env.instance({ pollIntervalMs: 60_000 }), 'u1', job.id), advanceJob(env.instance({ pollIntervalMs: 60_000 }), 'u1', job.id)]);
      assert.equal(env.stub.calls.filter((c) => c.fn === 'pollVideo').length - before, 1);
      assert.equal(a!.status, 'running');
      assert.equal(b!.status, 'running');
    });

    it('transient provider errors are counted; after the limit the job fails with an error', async () => {
      const { job } = await startVideoJob(env.instance(), fresh());
      env.stub.behaviour.pollThrows = 10;
      const deps = env.instance({ maxPollErrors: 3 });
      assert.equal((await advanceJob(deps, 'u1', job.id))!.status, 'running');
      assert.equal((await advanceJob(deps, 'u1', job.id))!.status, 'running');
      const failed = (await advanceJob(deps, 'u1', job.id))!;
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error!.code, 'poll_failed');
      assert.match(failed.error!.message, /simulated provider outage/);
      env.stub.behaviour.pollThrows = 0;
    });

    it('users are separate: another user cannot read the job and sees no jobs of the project', async () => {
      const i = fresh();
      const { job } = await startVideoJob(env.instance(), i);
      assert.equal(await env.jobs.get('u2', job.id), null);
      assert.deepEqual(await env.jobs.listByProject('u2', i.projectId), []);
      assert.equal(await advanceJob(env.instance(), 'u2', job.id), null);
      assert.deepEqual((await env.jobs.listByProject('u1', i.projectId)).map((j) => j.id), [job.id]);
    });
  });
}

// ---- development store (local files) ----
lifecycleSuite('local-file store', async () => {
  const blobs = new LocalDiskBlobStore(tempDir('jobs-local-'));
  const jobs = new BlobJobStore(blobs);
  const stub = createStubProvider(clip);
  return {
    jobs,
    blobs,
    stub,
    // One store object per process (the development store is single-process by design);
    // durable state is in the files, so a "restart" still loses nothing.
    instance: (over = {}) => ({ provider: stub.provider, jobs, blobs, pollIntervalMs: 0, queuedTimeoutMs: 300_000, maxPollErrors: 5, mediaRoute: '/api/media/', ...over }),
    objects: async (prefix) => (await blobs.list(prefix)).map((o) => o.key),
  };
});

// ---- production store (Firestore + GCS emulators) ----
describe('video jobs on Firestore + GCS emulators', { skip: missing ?? false }, () => {
  let emu: Emulators;
  let storage: Storage;
  let db: Firestore;
  let blobs: GcsBlobStore;
  let stub: ReturnType<typeof createStubProvider>;
  let env: Env;
  let srv: { base: string; close: () => void };
  const cookies: Record<string, string> = {};
  const call = async (who: string, method: string, p: string, body?: unknown) => {
    const headers: Record<string, string> = { 'x-requested-with': 'mms' };
    if (cookies[who]) headers.cookie = cookies[who];
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(srv.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const makeApp = () =>
    createApp({
      provider: stub.provider,
      blobStore: blobs,
      projectStore: new FirestoreProjectStore(db, blobs),
      jobStore: new FirestoreJobStore(db),
        usageStore: new FirestoreUsageStore(db),
      videoJobs: { pollIntervalMs: 0 },
      auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: ['alice@x.com', 'bob@x.com'] },
    });

  before(async () => {
    emu = await startEmulators();
    process.env.FIRESTORE_EMULATOR_HOST = emu.firestoreHost;
    process.env.STORAGE_EMULATOR_HOST = emu.gcsEndpoint;
    const dummy = new OAuth2Client();
    dummy.setCredentials({ access_token: 'emulator', expiry_date: Date.now() + 3600_000 });
    storage = new Storage({ projectId: 'demo-jobs', authClient: dummy });
    await storage.createBucket('mms-jobs-bucket');
    blobs = new GcsBlobStore('mms-jobs-bucket', storage);
    db = new Firestore({ projectId: 'demo-jobs' });
    stub = createStubProvider(clip);
    env = {
      jobs: new FirestoreJobStore(db),
      blobs,
      stub,
      instance: (over = {}) => ({ provider: stub.provider, jobs: new FirestoreJobStore(db), blobs, pollIntervalMs: 0, queuedTimeoutMs: 300_000, maxPollErrors: 5, mediaRoute: '/api/media/', ...over }),
      objects: async (prefix) => (await storage.bucket('mms-jobs-bucket').getFiles({ prefix }))[0].map((f) => f.name),
    };
    srv = await listen(makeApp());
    for (const [who, email] of [['alice', 'alice@x.com'], ['bob', 'bob@x.com']] as const) {
      const r = await fetch(srv.base + '/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms' }, body: JSON.stringify({ credential: `test:${who}:${email}` }) });
      cookies[who] = (r.headers.get('set-cookie') || '').split(';')[0];
    }
  });
  after(() => {
    srv?.close();
    emu?.stop();
  });

  // Same lifecycle tests on Firestore
  let n = 0;
  const fresh = (over: Partial<StartVideoInput> = {}) => input({ projectId: `fp${++n}`, idempotencyKey: `fkey-${n}-${Math.random().toString(36).slice(2, 10)}`, ...over });

  it('Firestore document holds the full job record at users/<uid>/jobs/<id>', async () => {
    const i = fresh({ uid: 'alice' });
    const { job } = await startVideoJob(env.instance(), i);
    const doc = (await db.doc(`users/alice/jobs/${job.id}`).get()).data()!;
    assert.deepEqual(
      { uid: doc.uid, projectId: doc.projectId, sceneId: doc.sceneId, shotId: doc.shotId, status: doc.status, kind: doc.kind, idem: doc.idempotencyKey },
      { uid: 'alice', projectId: i.projectId, sceneId: 'S01', shotId: 'SH01', status: 'running', kind: 'video', idem: i.idempotencyKey }
    );
    assert.ok(doc.expiresAt.toDate() > new Date(), 'TTL field set');
  });

  it('restart over Firestore: stored job continues after the HTTP server is replaced', async () => {
    const start = await call('alice', 'POST', '/api/generate/shot-video', { projectId: 'proj_r', sceneId: 'S02', shotId: 'SH05', linkedImageKey: 'S02-SH05', prompt: 'restart me', startImage: `data:image/png;base64,${TINY_PNG_BASE64}`, idempotencyKey: 'http-restart-0001' });
    assert.equal(start.status, 201);
    assert.equal(start.body.status, 'running');
    const id = start.body.jobId;
    srv.close();
    srv = await listen(makeApp()); // "server restart": no memory carried over
    const s1 = await call('alice', 'GET', `/api/generate/video-status/${id}`); // new cookie jar not needed: cookie is a signed session
    assert.equal(s1.status, 200);
    const s2 = await call('alice', 'GET', `/api/generate/video-status/${id}`);
    assert.equal(s2.body.status, 'completed');
    assert.match(s2.body.videoUrl, /\/projects\/proj_r\/videos\/S02_SH05_vj_/);
    assert.equal(s2.body.sceneId, 'S02');
    assert.equal(s2.body.shotId, 'SH05');
    const listed = await call('alice', 'GET', '/api/generate/jobs?projectId=proj_r');
    assert.deepEqual(listed.body.jobs.map((j: { jobId: string; linkedImageKey: string }) => [j.jobId, j.linkedImageKey]), [[id, 'S02-SH05']]);
    assert.equal(JSON.stringify(listed.body).includes('operationName'), false, 'internal provider data is not exposed');
  });

  it('API: requires sign-in and an idempotency key; other users cannot see or cancel the job', async () => {
    const body = { projectId: 'proj_a1', sceneId: 'S01', shotId: 'SH01', prompt: 'x', startImage: `data:image/png;base64,${TINY_PNG_BASE64}` };
    assert.equal((await fetch(srv.base + '/api/generate/shot-video', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms' }, body: JSON.stringify({ ...body, idempotencyKey: 'anon-key-0001' }) })).status, 401);
    const noKey = await call('alice', 'POST', '/api/generate/shot-video', body);
    assert.equal(noKey.status, 400);
    assert.match(noKey.body.error, /idempotencyKey/);
    const ok = await call('alice', 'POST', '/api/generate/shot-video', { ...body, idempotencyKey: 'api-key-0001' });
    assert.equal(ok.status, 201);
    const dup = await call('alice', 'POST', '/api/generate/shot-video', { ...body, idempotencyKey: 'api-key-0001' });
    assert.equal(dup.status, 200);
    assert.equal(dup.body.reused, 'idempotent');
    assert.equal(dup.body.jobId, ok.body.jobId);
    assert.equal((await call('bob', 'GET', `/api/generate/video-status/${ok.body.jobId}`)).status, 404);
    assert.equal((await call('bob', 'POST', `/api/generate/video-cancel/${ok.body.jobId}`)).status, 404);
    assert.deepEqual((await call('bob', 'GET', '/api/generate/jobs?projectId=proj_a1')).body.jobs, []);
    const cancel = await call('alice', 'POST', `/api/generate/video-cancel/${ok.body.jobId}`);
    assert.equal(cancel.body.status, 'cancelled');
    assert.match(cancel.body.note, /cannot stop/);
  });

  // run the whole lifecycle suite on Firestore as well
  lifecycleOnFirestore();

  function lifecycleOnFirestore() {
    it('lifecycle suite (idempotency, failure+retry, cancel, queued timeout, lease, poll errors, separation) on Firestore', async () => {
      // Reuse the exact scenarios by running them inline against the Firestore env.
      const i = fresh();
      const results = await Promise.all(Array.from({ length: 8 }, () => startVideoJob(env.instance(), i)));
      assert.equal(results.filter((r) => r.started).length, 1, '8 parallel identical requests => 1 provider job');

      const f = fresh({ prompt: 'FAIL_ONCE tide' });
      const j1 = await startVideoJob(env.instance(), f);
      await advanceJob(env.instance(), 'u1', j1.job.id);
      assert.equal((await advanceJob(env.instance(), 'u1', j1.job.id))!.error!.code, 'provider_failed');
      const retry = await startVideoJob(env.instance(), { ...f, idempotencyKey: 'fs-retry-0001', retryOf: j1.job.id });
      assert.equal(retry.job.retryOf, j1.job.id);

      const c = await startVideoJob(env.instance(), fresh());
      assert.equal((await cancelJob(env.instance(), 'u1', c.job.id))!.status, 'cancelled');

      const q = fresh();
      const queued = await env.jobs.createOrGet({ ...q, request: { promptHash: 'h', promptPreview: 'p', aspectRatio: null, resolution: null, durationSec: null }, retryOf: null });
      assert.equal((await advanceJob(env.instance({ queuedTimeoutMs: 0 }), 'u1', queued.job.id))!.error!.code, 'submission_interrupted');

      const l = await startVideoJob(env.instance({ pollIntervalMs: 60_000 }), fresh());
      const polls = env.stub.calls.filter((x) => x.fn === 'pollVideo').length;
      await Promise.all([advanceJob(env.instance({ pollIntervalMs: 60_000 }), 'u1', l.job.id), advanceJob(env.instance({ pollIntervalMs: 60_000 }), 'u1', l.job.id)]);
      assert.equal(env.stub.calls.filter((x) => x.fn === 'pollVideo').length - polls, 1, 'poll lease works across instances');
    });
  }
});

if (missing) console.log(`# SKIPPED Firestore job tests: ${missing}`);
