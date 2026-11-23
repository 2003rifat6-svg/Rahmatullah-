/**
 * INTEGRATION tests: real @google-cloud/firestore + @google-cloud/storage clients against
 * the official Firestore emulator and fake-gcs-server. Covers sign-in, user isolation,
 * project CRUD + conflicts, media externalisation to GCS, file upload/list/download/delete,
 * video → GCS, and FFmpeg export from GCS clips back into GCS.
 */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client } from 'google-auth-library';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app';
import { GcsBlobStore } from '../server/blobStore';
import { FirestoreJobStore } from '../server/jobStore';
import { FirestoreUsageStore } from '../server/usage';
import { FirestoreProjectStore } from '../server/projectStore';
import { Emulators, emulatorsAvailable, startEmulators } from './emulators';
import { createStubProvider, listen, makeTestClip, tempDir, TEST_SESSION_SECRET, testVerifier, TINY_PNG_BASE64 } from './helpers';

const missing = emulatorsAvailable();
const BUCKET = 'mms-test-bucket';
const PNG = `data:image/png;base64,${TINY_PNG_BASE64}`;
const mp4Bytes = fs.readFileSync(makeTestClip(tempDir('upl-'), 'u.mp4', 'red')); // a real MP4 (uploads are checked by file signature)
const BIG_PNG = `data:image/png;base64,${Buffer.alloc(6000, 7).toString('base64')}`;

class Client {
  cookie = '';
  constructor(private base: string) {}
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'x-requested-with': 'mms', ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined && !(body instanceof Uint8Array)) headers['Content-Type'] = 'application/json';
    const res = await fetch(this.base + p, {
      method,
      headers,
      body: (body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)) as BodyInit | undefined,
      redirect: 'manual',
    });
    return res;
  }
  async json(method: string, p: string, body?: unknown) {
    const res = await this.req(method, p, body);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  async signIn(uid: string, email: string) {
    const res = await this.req('POST', '/api/auth/session', { credential: `test:${uid}:${email}` });
    assert.equal(res.status, 200);
    this.cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    assert.match(this.cookie, /^mms_session=/);
  }
}

function project(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, title, story: { rawText: 'Once upon a time', locked: false }, characters: [], ...extra };
}

describe('Google Cloud integration (Firestore + GCS emulators)', { skip: missing ?? false }, () => {
  let emu: Emulators;
  let srv: { base: string; close: () => void };
  let storage: Storage;
  let stub: ReturnType<typeof createStubProvider>;
  let alice: Client;
  let bob: Client;
  let anon: Client;

  before(async () => {
    emu = await startEmulators();
    process.env.FIRESTORE_EMULATOR_HOST = emu.firestoreHost;
    process.env.STORAGE_EMULATOR_HOST = emu.gcsEndpoint;
    // Emulator ignores auth; a dummy token stops the client from looking for real Google credentials.
    const dummyAuth = new OAuth2Client();
    dummyAuth.setCredentials({ access_token: 'emulator', expiry_date: Date.now() + 3600_000 });
    storage = new Storage({ projectId: 'demo-mms', authClient: dummyAuth });
    await storage.createBucket(BUCKET);
    const blobStore = new GcsBlobStore(BUCKET, storage);
    const db = new Firestore({ projectId: 'demo-mms' });
    stub = createStubProvider(makeTestClip(tempDir('clips-'), 'clip.mp4', 'green'));
    srv = await listen(
      createApp({
        provider: stub.provider,
        blobStore,
        projectStore: new FirestoreProjectStore(db, blobStore),
        jobStore: new FirestoreJobStore(db),
        usageStore: new FirestoreUsageStore(db),
        videoJobs: { pollIntervalMs: 0 },
        auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: ['alice@x.com', 'bob@x.com'] },
      })
    );
    alice = new Client(srv.base);
    bob = new Client(srv.base);
    anon = new Client(srv.base);
    await alice.signIn('alice1', 'alice@x.com');
    await bob.signIn('bob2', 'bob@x.com');
  });

  after(() => {
    srv?.close();
    emu?.stop();
  });

  const gcsKeys = async (prefix: string) => (await storage.bucket(BUCKET).getFiles({ prefix }))[0].map((f) => f.name);

  it('auth: anonymous requests are rejected; non-allowed emails cannot sign in; CSRF header required', async () => {
    assert.equal((await anon.json('GET', '/api/projects')).status, 401);
    assert.equal((await anon.json('GET', '/api/auth/me')).status, 401);
    assert.equal((await anon.json('POST', '/api/auth/session', { credential: 'test:eve:eve@x.com' })).status, 403);
    assert.equal((await anon.json('POST', '/api/auth/session', { credential: 'garbage-token-xxxxxxxxxxxxxxx' })).status, 401);
    const noCsrf = await fetch(srv.base + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ project: project('p0', 'x') }),
    });
    assert.equal(noCsrf.status, 403);
    assert.equal((await alice.json('GET', '/api/auth/me')).body.user.email, 'alice@x.com');
  });

  it('projects: create → list → get → update (revision) → conflict 409 → explicit replace on the current revision', async () => {
    const created = await alice.json('POST', '/api/projects', { project: project('proj_a', 'Alice Movie') });
    assert.equal(created.status, 201);
    assert.equal(created.body.meta.revision, 1);
    assert.equal((await alice.json('POST', '/api/projects', { project: project('proj_a', 'dup') })).status, 409);

    const list = await alice.json('GET', '/api/projects');
    assert.deepEqual(list.body.projects.map((p: { id: string }) => p.id), ['proj_a']);

    const upd = await alice.json('PUT', '/api/projects/proj_a', { project: project('proj_a', 'Alice Movie v2'), baseRevision: 1 });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.meta.revision, 2);

    const stale = await alice.json('PUT', '/api/projects/proj_a', { project: project('proj_a', 'stale'), baseRevision: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.cloudRevision, 2);

    // "Overwrite" = the user confirmed, then the update is based on the revision the conflict reported (no blind force).
    const forced = await alice.json('PUT', '/api/projects/proj_a', { project: project('proj_a', 'forced'), baseRevision: stale.body.cloudRevision });
    assert.equal(forced.body.meta.revision, 3);
    const got = await alice.json('GET', '/api/projects/proj_a');
    assert.equal(got.body.project.title, 'forced');

    // Stored in Firestore exactly under users/<uid>/projects/<id>
    const doc = await new Firestore({ projectId: 'demo-mms' }).doc('users/alice1/projects/proj_a').get();
    assert.equal(doc.data()?.ownerUid, 'alice1');
    assert.equal(doc.data()?.revision, 3);
  });

  it('isolation: Bob cannot list, read, update, delete or download Alice’s data', async () => {
    assert.deepEqual((await bob.json('GET', '/api/projects')).body.projects, []);
    assert.equal((await bob.json('GET', '/api/projects/proj_a')).status, 404);
    assert.equal((await bob.json('DELETE', '/api/projects/proj_a')).status, 404);
    // Bob "updating" proj_a only creates his own separate copy, Alice's stays untouched
    // An update can never create: Bob has no proj_a of his own, so it is refused (404); creating is a separate POST.
    assert.equal((await bob.json('PUT', '/api/projects/proj_a', { project: project('proj_a', 'bob update'), baseRevision: 1 })).status, 404);
    await bob.json('POST', '/api/projects', { project: project('proj_a', 'bob copy') });
    assert.equal((await alice.json('GET', '/api/projects/proj_a')).body.project.title, 'forced');
    assert.equal((await bob.json('GET', '/api/projects/proj_a')).body.project.title, 'bob copy');
  });

  it('media in a project is moved to GCS (not into Firestore) and served only to the owner', async () => {
    const p = project('proj_media', 'Media', {
      characters: [{ id: 'c1', references: { face: { imageUrl: BIG_PNG } } }],
      imagePrompts: { parsedItems: [{ id: 'i1', generatedUrl: BIG_PNG, candidates: [{ url: BIG_PNG }] }] },
      small: PNG,
    });
    const res = await alice.json('POST', '/api/projects', { project: p });
    assert.equal(res.status, 201);
    const url: string = res.body.project.characters[0].references.face.imageUrl;
    assert.match(url, /^\/api\/media\/users\/alice1\/projects\/proj_media\/assets\/[0-9a-f]{24}\.png$/);
    assert.equal(res.body.project.imagePrompts.parsedItems[0].generatedUrl, url, 'identical images are stored once');
    assert.equal(res.body.project.small, PNG, 'tiny data URLs stay inline');
    assert.equal((await gcsKeys('users/alice1/projects/proj_media/assets/')).length, 1);
    const fsDoc = await new Firestore({ projectId: 'demo-mms' }).doc('users/alice1/projects/proj_media').get();
    assert.ok(!String(fsDoc.data()?.body).includes(BIG_PNG.slice(30, 80)));

    const own = await alice.req('GET', url);
    assert.equal(own.status, 200);
    assert.equal(Buffer.from(await own.arrayBuffer()).length, 6000);
    assert.equal((await bob.req('GET', url)).status, 404);
    assert.equal((await anon.req('GET', url)).status, 401);
  });

  it('large project body (> 800 KB) is stored in GCS and loads back intact', async () => {
    const big = project('proj_big', 'Big', { story: { rawText: 'ক'.repeat(400_000), locked: false } });
    const res = await alice.json('POST', '/api/projects', { project: big });
    assert.equal(res.body.meta.bodyLocation, 'gcs');
    const bodies = await gcsKeys('users/alice1/projects/proj_big/_body/');
    assert.equal(bodies.length, 1, 'exactly one body object for the project');
    assert.match(bodies[0], /\/_body\/[0-9a-f-]{36}\.json$/);
    const back = await alice.json('GET', '/api/projects/proj_big');
    assert.equal(back.body.project.story.rawText.length, 400_000);
  });

  it('files: upload (image, video, ZIP) → list → download with Range → delete; others blocked', async () => {
    const uploaded: string[] = [];
    for (const [kind, filename, type, bytes] of [
      ['images', 'shot.png', 'image/png', Buffer.from(TINY_PNG_BASE64, 'base64')],
      ['videos', 'clip.mp4', 'video/mp4', mp4Bytes],
      ['zips', 'Movie_Videos.zip', 'application/zip', Buffer.from('PK\u0003\u0004 test zip')],
    ] as const) {
      const prep = await alice.json('POST', '/api/storage/upload-url', { projectId: 'proj_a', kind, filename, contentType: type });
      assert.equal(prep.status, 200);
      assert.equal(prep.body.direct, false);
      const put = await alice.req('PUT', prep.body.url, new Uint8Array(bytes), { 'Content-Type': type });
      assert.equal(put.status, 201);
      uploaded.push(prep.body.key);
    }
    const list = await alice.json('GET', '/api/storage/files?projectId=proj_a');
    assert.deepEqual(list.body.files.map((f: { kind: string }) => f.kind).sort(), ['images', 'videos', 'zips']);

    const ranged = await alice.req('GET', `/api/media/${uploaded[1]}`, undefined, { Range: 'bytes=10-19' });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 10-19/${mp4Bytes.length}`);

    // Bob cannot upload into, list, or delete Alice's files
    assert.equal((await bob.req('PUT', `/api/storage/upload/${uploaded[0]}`, new Uint8Array([1]), { 'Content-Type': 'image/png' })).status, 403);
    assert.deepEqual((await bob.json('GET', '/api/storage/files?projectId=proj_a')).body.files.filter((f: { key: string }) => f.key.includes('alice1')), []);
    assert.equal((await bob.json('DELETE', `/api/storage/files/${uploaded[2]}`)).status, 404);

    assert.equal((await alice.json('DELETE', `/api/storage/files/${uploaded[2]}`)).status, 200);
    assert.equal((await gcsKeys(uploaded[2])).length, 0);
  });

  it('video generation result goes to GCS; FFmpeg movie is built from GCS clips and saved to GCS', async () => {
    const urls: string[] = [];
    for (const shot of ['SH01', 'SH02']) {
      const start = await alice.json('POST', '/api/generate/shot-video', { projectId: 'proj_a', sceneId: 'S01', shotId: shot, prompt: 'pan', startImage: PNG, idempotencyKey: `int-${shot}-00001` });
      assert.equal(start.status, 201);
      const id = start.body.jobId;
      assert.equal((await bob.json('GET', `/api/generate/video-status/${id}`)).status, 404, 'other users cannot see the job');
      await alice.json('GET', `/api/generate/video-status/${id}`);
      const done = await alice.json('GET', `/api/generate/video-status/${id}`);
      assert.equal(done.body.status, 'completed');
      urls.push(done.body.videoUrl);
    }
    assert.equal((await gcsKeys('users/alice1/projects/proj_a/videos/S01_')).length, 2);
    assert.equal((await bob.json('POST', '/api/export/mp4', { projectId: 'proj_a', clips: urls.map((videoUrl) => ({ videoUrl })) })).status, 400);
    const exp = await alice.json('POST', '/api/export/mp4', { projectId: 'proj_a', clips: urls.map((videoUrl) => ({ videoUrl })) });
    assert.equal(exp.status, 200, JSON.stringify(exp.body));
    assert.match(exp.body.downloadUrl, /^\/api\/media\/users\/alice1\/projects\/proj_a\/movies\/movie_.*\.mp4$/);
    const movie = await alice.req('GET', exp.body.downloadUrl);
    assert.equal(movie.status, 200);
    assert.ok((await movie.arrayBuffer()).byteLength > 1000);
  });

  it('delete project removes the Firestore doc and every GCS object of that project', async () => {
    assert.ok((await gcsKeys('users/alice1/projects/proj_a/')).length > 0);
    assert.equal((await alice.json('DELETE', '/api/projects/proj_a')).status, 200);
    assert.equal((await alice.json('GET', '/api/projects/proj_a')).status, 404);
    assert.deepEqual(await gcsKeys('users/alice1/projects/proj_a/'), []);
    assert.equal((await bob.json('GET', '/api/projects/proj_a')).body.project.title, 'bob copy', "Bob's own copy is untouched");
  });

  it('logout clears the session cookie', async () => {
    const res = await alice.req('POST', '/api/auth/logout', {});
    assert.match(res.headers.get('set-cookie') || '', /Max-Age=0/);
  });
});

if (missing) console.log(`# SKIPPED cloud integration tests: ${missing}`);
