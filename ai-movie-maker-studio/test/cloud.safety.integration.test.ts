/**
 * SAFETY integration tests on the real Firestore + GCS emulators:
 *  - large-project revision conflicts never damage the stored copy
 *  - a failed commit leaves the current copy intact and no orphan objects
 *  - stored data is checksummed and tampering is detected
 *  - two users cannot read, change, delete or download each other's data
 *  - removing an email from ALLOWED_EMAILS ends its access immediately
 */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client } from 'google-auth-library';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app';
import { GcsBlobStore } from '../server/blobStore';
import { FirestoreJobStore } from '../server/jobStore';
import { FirestoreUsageStore } from '../server/usage';
import { FirestoreProjectStore, IntegrityError } from '../server/projectStore';
import { Emulators, emulatorsAvailable, startEmulators } from './emulators';
import { createStubProvider, listen, makeTestClip, tempDir, TEST_SESSION_SECRET, testVerifier } from './helpers';

const missing = emulatorsAvailable();
const BUCKET = 'mms-safety-bucket';

const big = (title: string, marker: string) => ({
  id: 'big1',
  title,
  story: { rawText: marker.repeat(900_000), locked: false },
  characters: [],
});

class Client {
  cookie = '';
  constructor(private base: string) {}
  async req(method: string, p: string, body?: unknown) {
    const headers: Record<string, string> = { 'x-requested-with': 'mms' };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(this.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  }
  async json(method: string, p: string, body?: unknown) {
    const res = await this.req(method, p, body);
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> };
  }
  async signIn(uid: string, email: string) {
    const res = await this.req('POST', '/api/auth/session', { credential: `test:${uid}:${email}` });
    assert.equal(res.status, 200);
    this.cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  }
}

describe('Cloud safety (Firestore + GCS emulators)', { skip: missing ?? false }, () => {
  let emu: Emulators;
  let storage: Storage;
  let db: Firestore;
  let store: FirestoreProjectStore;
  let blobs: GcsBlobStore;
  let srv: { base: string; close: () => void };
  let alice: Client;
  let bob: Client;
  let failNextCommit = false;

  before(async () => {
    emu = await startEmulators();
    process.env.FIRESTORE_EMULATOR_HOST = emu.firestoreHost;
    process.env.STORAGE_EMULATOR_HOST = emu.gcsEndpoint;
    const dummy = new OAuth2Client();
    dummy.setCredentials({ access_token: 'emulator', expiry_date: Date.now() + 3600_000 });
    storage = new Storage({ projectId: 'demo-safety', authClient: dummy });
    await storage.createBucket(BUCKET);
    blobs = new GcsBlobStore(BUCKET, storage);
    db = new Firestore({ projectId: 'demo-safety' });
    // Wrapper that can fail the commit on demand (simulates a crash/timeout at the commit point).
    const flaky = {
      collection: (n: string) => db.collection(n),
      runTransaction: (fn: Parameters<Firestore['runTransaction']>[0]) => {
        if (failNextCommit) {
          failNextCommit = false;
          return Promise.reject(new Error('simulated commit failure'));
        }
        return db.runTransaction(fn);
      },
    };
    store = new FirestoreProjectStore(flaky as unknown as Firestore, blobs);
    const stub = createStubProvider(makeTestClip(tempDir('clips-'), 'c.mp4', 'black'));
    srv = await listen(
      createApp({
        provider: stub.provider,
        blobStore: blobs,
        projectStore: store,
        jobStore: new FirestoreJobStore(db),
        usageStore: new FirestoreUsageStore(db),
        videoJobs: { pollIntervalMs: 0 },
        auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: ['alice@x.com', 'bob@x.com'] },
      })
    );
    alice = new Client(srv.base);
    bob = new Client(srv.base);
    await alice.signIn('alice1', 'alice@x.com');
    await bob.signIn('bob2', 'bob@x.com');
  });

  after(() => {
    srv?.close();
    emu?.stop();
  });

  const bodies = async (uid: string, id: string) => (await storage.bucket(BUCKET).getFiles({ prefix: `users/${uid}/projects/${id}/_body/` }))[0];
  const bodyText = async (uid: string, id: string) => {
    const files = await bodies(uid, id);
    assert.equal(files.length, 1, `expected exactly one body object, found ${files.length}`);
    return (await files[0].download())[0].toString('utf8');
  };

  it('large project: a revision conflict is rejected and the stored copy is byte-for-byte unchanged', async () => {
    const created = await alice.json('POST', '/api/projects', { project: big('V1', 'A') });
    assert.equal(created.status, 201);
    const before = await bodyText('alice1', 'big1');

    const stale = await alice.json('PUT', '/api/projects/big1', { project: big('STALE', 'B'), baseRevision: 4 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.cloudRevision, 1);

    const wrongBase = await alice.json('PUT', '/api/projects/big1', { project: big('WRONG', 'C'), baseRevision: 7 });
    assert.equal(wrongBase.status, 409);

    assert.equal(await bodyText('alice1', 'big1'), before, 'old body object was not modified');
    const got = await alice.json('GET', '/api/projects/big1');
    assert.equal(got.body.project.title, 'V1');
    assert.equal(got.body.meta.revision, 1);
    assert.equal(got.body.project.story.rawText.length, 900_000);
  });

  it('large project: a successful update replaces the body and deletes the old object', async () => {
    const upd = await alice.json('PUT', '/api/projects/big1', { project: big('V2', 'D'), baseRevision: 1 });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.meta.revision, 2);
    assert.match(await bodyText('alice1', 'big1'), /"rawText":"D{900000}"/, 'the new body is the stored one');
    assert.equal((await bodies('alice1', 'big1')).length, 1, 'the old object was deleted');
  });

  it('failed commit: the current copy stays intact and the uploaded orphan is removed', async () => {
    const current = await bodyText('alice1', 'big1');
    failNextCommit = true;
    await assert.rejects(store.save('alice1', 'big1', big('FAILED', 'E') as unknown as Record<string, unknown>, { mode: 'update', baseRevision: 2 }), /simulated commit failure/);
    assert.equal(await bodyText('alice1', 'big1'), current, 'stored body unchanged and no orphan object left behind');
    const got = await store.get('alice1', 'big1');
    assert.equal(got.meta.revision, 2);
    assert.equal(got.project.title, 'V2');
  });

  it('a body modified outside the server is refused (checksum), never silently returned', async () => {
    const [file] = await bodies('alice1', 'big1');
    await file.save(JSON.stringify({ id: 'big1', title: 'TAMPERED', story: { rawText: 'x' } }), { contentType: 'application/json', resumable: false });
    await assert.rejects(store.get('alice1', 'big1'), IntegrityError);
    const res = await alice.json('GET', '/api/projects/big1');
    assert.equal(res.status, 500);
    assert.match(res.body.error, /checksum/);
    // Restore a good copy (saving never reads the old body, so this works on a damaged object).
    const fixed = await alice.json('PUT', '/api/projects/big1', { project: big('V2', 'D'), baseRevision: 2 });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.meta.revision, 3);
  });

  it('small project: conflict and failed commit also leave the document unchanged', async () => {
    await alice.json('POST', '/api/projects', { project: { id: 'small1', title: 'S1', story: { rawText: 'one' } } });
    const conflict = await alice.json('PUT', '/api/projects/small1', { project: { id: 'small1', title: 'S2' }, baseRevision: 9 });
    assert.equal(conflict.status, 409);
    failNextCommit = true;
    await assert.rejects(store.save('alice1', 'small1', { id: 'small1', title: 'S3' }, { mode: 'update', baseRevision: 1 }), /simulated/);
    const got = await alice.json('GET', '/api/projects/small1');
    assert.equal(got.body.project.title, 'S1');
    assert.equal(got.body.meta.revision, 1);
  });

  it('two users: Bob cannot read, change, delete, or download Alice’s large project or its body', async () => {
    const [aliceBody] = await bodies('alice1', 'big1');
    const bodyKey = aliceBody.name;
    assert.equal((await bob.json('GET', '/api/projects/big1')).status, 404);
    assert.equal((await bob.json('DELETE', '/api/projects/big1')).status, 404);
    assert.equal((await bob.req('GET', `/api/media/${bodyKey}`)).status, 404, 'body object is not downloadable by others');
    assert.equal((await bob.req('PUT', `/api/storage/upload/${bodyKey}`, new Uint8Array([1]))).status, 403);
    assert.equal((await bob.json('DELETE', `/api/storage/files/${bodyKey}`)).status, 404);
    const list = await bob.json('GET', '/api/projects');
    assert.ok(!list.body.projects.some((p: { id: string }) => p.id === 'big1' || p.id === 'small1'));
    // Bob can still see his own, separate data
    await bob.json('POST', '/api/projects', { project: { id: 'big1', title: 'Bob own' } });
    assert.equal((await alice.json('GET', '/api/projects/big1')).body.project.title, 'V2', 'Alice unaffected by Bob');
    assert.match(await bodyText('alice1', 'big1'), /"title":"V2"/, 'Alice’s stored body is untouched by Bob');
  });

  it('owner field cannot be forged: ownerUid comes from the session', async () => {
    await alice.json('POST', '/api/projects', { project: { id: 'forge1', title: 'F', ownerUid: 'bob2' } });
    const doc = await db.doc('users/alice1/projects/forge1').get();
    assert.equal(doc.data()?.ownerUid, 'alice1');
    assert.equal((await bob.json('GET', '/api/projects/forge1')).status, 404);
  });

  it('ALLOWED_EMAILS: removing an account ends its existing session immediately; empty list refuses to start', async () => {
    const restricted = await listen(
      createApp({
        provider: null,
        blobStore: blobs,
        projectStore: store,
        jobStore: new FirestoreJobStore(db),
        usageStore: new FirestoreUsageStore(db),
        videoJobs: { pollIntervalMs: 0 },
        auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: ['bob@x.com'] },
      })
    );
    try {
      const res = await fetch(restricted.base + '/api/projects', { headers: { cookie: alice.cookie, 'x-requested-with': 'mms' } });
      assert.equal(res.status, 401, 'Alice’s old cookie no longer works');
      const bobRes = await fetch(restricted.base + '/api/projects', { headers: { cookie: bob.cookie, 'x-requested-with': 'mms' } });
      assert.equal(bobRes.status, 200);
    } finally {
      restricted.close();
    }
    assert.throws(
      () =>
        createApp({
          provider: null,
          blobStore: blobs,
          projectStore: store,
          jobStore: new FirestoreJobStore(db),
        usageStore: new FirestoreUsageStore(db),
          videoJobs: { pollIntervalMs: 0 },
          auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: [] },
        }),
      /ALLOWED_EMAILS/
    );
  });

  it('deleting a large project removes its body object too', async () => {
    assert.equal((await alice.json('DELETE', '/api/projects/big1')).status, 200);
    assert.equal((await storage.bucket(BUCKET).getFiles({ prefix: 'users/alice1/projects/big1/' }))[0].length, 0);
  });
});

if (missing) console.log(`# SKIPPED cloud safety tests: ${missing}`);
