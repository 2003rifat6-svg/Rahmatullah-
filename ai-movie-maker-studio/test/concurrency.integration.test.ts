/**
 * Revision protection and concurrency on the real Firestore + GCS emulators:
 * mandatory baseRevision, parallel saves, delete while saving, interrupted delete recovery,
 * orphan cleanup. Nothing may be overwritten silently and no file may be left half-deleted.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { emulatorsAvailable } from './emulators';
import { Client, CloudEnv, startCloudEnv } from './cloudEnv';
import { ConflictError, FirestoreProjectStore, ValidationError } from '../server/projectStore';

const missing = emulatorsAvailable();

const small = (id: string, title: string) => ({ id, title, story: { rawText: `story of ${title}` } });
const big = (id: string, title: string) => ({ id, title, story: { rawText: title.repeat(900_000) } }); // > 800 KB => stored in GCS

describe('Revision protection & concurrency (Firestore + GCS emulators)', { skip: missing ?? false }, () => {
  let env: CloudEnv;
  let srv: { base: string; close: () => void; store: FirestoreProjectStore };
  let alice: Client;
  let bob: Client;

  before(async () => {
    env = await startCloudEnv('mms-conc');
    srv = await env.serve();
    alice = new Client(srv.base);
    bob = new Client(srv.base);
    await alice.signIn('alice1', 'alice@x.com');
    await bob.signIn('bob2', 'bob@x.com');
  });
  after(() => {
    srv?.close();
    env?.stop();
  });

  const bodies = (uid: string, id: string) => env.keys(`users/${uid}/projects/${id}/_body/`);

  it('update without a valid baseRevision is rejected and changes nothing', async () => {
    assert.equal((await alice.json('POST', '/api/projects', { project: small('rev1', 'R1') })).status, 201);
    for (const bad of [undefined, 0, -1, 1.5, '1', null, NaN]) {
      const res = await alice.json('PUT', '/api/projects/rev1', { project: small('rev1', 'HACK'), ...(bad === undefined ? {} : { baseRevision: bad }) });
      assert.equal(res.status, 400, `baseRevision=${String(bad)}`);
      assert.equal(res.body.code, 'base_revision_required');
    }
    const got = await alice.json('GET', '/api/projects/rev1');
    assert.equal(got.body.project.title, 'R1');
    assert.equal(got.body.meta.revision, 1);
    // the store itself refuses too (not only the HTTP layer)
    await assert.rejects(srv.store.save('alice1', 'rev1', small('rev1', 'X'), { mode: 'update', baseRevision: undefined as unknown as number }), ValidationError);
  });

  it('a revision mismatch is a conflict that reports the cloud revision and keeps the cloud data', async () => {
    const c = await alice.json('PUT', '/api/projects/rev1', { project: small('rev1', 'LATE'), baseRevision: 5 });
    assert.equal(c.status, 409);
    assert.equal(c.body.code, 'revision_conflict');
    assert.equal(c.body.cloudRevision, 1);
    assert.ok(c.body.cloudUpdatedAt);
    assert.equal((await alice.json('GET', '/api/projects/rev1')).body.project.title, 'R1');
  });

  it('update never creates a project (404); create twice conflicts', async () => {
    assert.equal((await alice.json('PUT', '/api/projects/ghost', { project: small('ghost', 'G'), baseRevision: 1 })).status, 404);
    assert.equal((await alice.json('GET', '/api/projects/ghost')).status, 404);
    assert.equal((await alice.json('POST', '/api/projects', { project: small('rev1', 'AGAIN') })).status, 409);
  });

  it('10 parallel saves from the same base: exactly one wins, nine conflict, the stored project is the winner as a whole', async () => {
    await alice.json('POST', '/api/projects', { project: small('par1', 'start') });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => alice.json('PUT', '/api/projects/par1', { project: small('par1', `writer-${i}`), baseRevision: 1 })));
    const wins = results.filter((r) => r.status === 200);
    assert.equal(wins.length, 1, `statuses: ${results.map((r) => r.status).join(',')}`);
    assert.equal(results.filter((r) => r.status === 409).length, 9);
    const got = await alice.json('GET', '/api/projects/par1');
    assert.equal(got.body.meta.revision, 2);
    assert.equal(got.body.project.title, wins[0].body.project.title, 'the winner’s data, complete');
    assert.equal(got.body.project.story.rawText, `story of ${wins[0].body.project.title}`, 'no mix of two writers');
  });

  it('10 parallel saves of a LARGE project: one winner, one body object, no orphans, checksum valid', async () => {
    await alice.json('POST', '/api/projects', { project: big('parbig', 'a') });
    assert.equal((await bodies('alice1', 'parbig')).length, 1);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => alice.json('PUT', '/api/projects/parbig', { project: big('parbig', String.fromCharCode(98 + i)), baseRevision: 1 })));
    assert.equal(results.filter((r) => r.status === 200).length, 1, `statuses: ${results.map((r) => r.status).join(',')}`);
    assert.equal((await bodies('alice1', 'parbig')).length, 1, 'losers removed their uploaded bodies; the old body was replaced');
    const got = await alice.json('GET', '/api/projects/parbig'); // checksum verified inside
    assert.equal(got.status, 200);
    assert.equal(got.body.meta.revision, 2);
    assert.equal(got.body.project.story.rawText.length, 900_000);
    assert.equal(new Set(got.body.project.story.rawText).size, 1, 'one writer only');
  });

  it('6 parallel creates of the same id: one 201, five 409', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => alice.json('POST', '/api/projects', { project: small('cre1', `c${i}`) })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 5);
  });

  it('two devices: the stale one is refused, then explicitly rebases on the revision it was shown', async () => {
    await alice.json('POST', '/api/projects', { project: small('dev1', 'v1') });
    const a = await alice.json('PUT', '/api/projects/dev1', { project: small('dev1', 'device A'), baseRevision: 1 });
    assert.equal(a.status, 200);
    const b = await alice.json('PUT', '/api/projects/dev1', { project: small('dev1', 'device B'), baseRevision: 1 });
    assert.equal(b.status, 409);
    assert.equal((await alice.json('GET', '/api/projects/dev1')).body.project.title, 'device A', 'A is intact while B is waiting for a decision');
    const rebased = await alice.json('PUT', '/api/projects/dev1', { project: small('dev1', 'device B'), baseRevision: b.body.cloudRevision });
    assert.equal(rebased.status, 200);
    assert.equal(rebased.body.meta.revision, 3);
  });

  it('delete while saving: saves are refused during the delete, reads say not found, and nothing is left afterwards', async () => {
    await alice.json('POST', '/api/projects', { project: big('del1', 'z') });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inDelete = new Promise<void>((r) => (entered = r));
    const gated = Object.create(env.blobs);
    gated.deletePrefix = async (p: string) => {
      entered();
      await gate; // the project is already marked `deleting` and the files are not removed yet
      return env.blobs.deletePrefix(p);
    };
    const gatedSrv = await env.serve({ blobs: gated });
    const ga = new Client(gatedSrv.base);
    await ga.signIn('alice1', 'alice@x.com');
    try {
      const deleting = ga.json('DELETE', '/api/projects/del1');
      await inDelete;
      const during = await ga.json('PUT', '/api/projects/del1', { project: big('del1', 'y'), baseRevision: 1 });
      assert.equal(during.status, 409);
      assert.equal(during.body.code, 'project_deleting');
      assert.equal((await ga.json('POST', '/api/projects', { project: small('del1', 'new') })).body.code, 'project_deleting', 'cannot be re-created while deleting');
      assert.equal((await ga.json('GET', '/api/projects/del1')).status, 404);
      assert.ok(!(await ga.json('GET', '/api/projects')).body.projects.some((p: { id: string }) => p.id === 'del1'));
      assert.equal((await bodies('alice1', 'del1')).length, 1, 'the new save left no object behind');
      release();
      assert.equal((await deleting).status, 200);
    } finally {
      release();
      gatedSrv.close();
    }
    assert.equal((await alice.json('GET', '/api/projects/del1')).status, 404);
    assert.deepEqual(await env.keys('users/alice1/projects/del1/'), []);
    // after the delete finished the id can be used again, with a clean state
    const again = await alice.json('POST', '/api/projects', { project: small('del1', 'fresh') });
    assert.equal(again.status, 201);
    assert.equal(again.body.meta.revision, 1);
  });

  it('interrupted delete (file removal fails): project stays hidden and locked, delete can be resumed, nothing is half-removed silently', async () => {
    await alice.json('POST', '/api/projects', { project: big('del2', 'q') });
    let fail = true;
    const flaky = Object.create(env.blobs);
    flaky.deletePrefix = async (p: string) => {
      if (fail) throw new Error('simulated storage outage');
      return env.blobs.deletePrefix(p);
    };
    const flakySrv = await env.serve({ blobs: flaky });
    const fa = new Client(flakySrv.base);
    await fa.signIn('alice1', 'alice@x.com');
    try {
      const failed = await fa.json('DELETE', '/api/projects/del2');
      assert.equal(failed.status, 500);
      // state: marked deleting, files still there => hidden + protected, not "half visible"
      assert.equal((await fa.json('GET', '/api/projects/del2')).status, 404);
      assert.equal((await fa.json('PUT', '/api/projects/del2', { project: small('del2', 'x'), baseRevision: 1 })).body.code, 'project_deleting');
      const doc = (await env.db.doc('users/alice1/projects/del2').get()).data()!;
      assert.equal(doc.status, 'deleting');
      assert.equal((await bodies('alice1', 'del2')).length, 1);

      // recovery path 1: listing projects resumes the interrupted delete in the background
      fail = false;
      await fa.json('GET', '/api/projects');
      for (let i = 0; i < 40 && (await env.db.doc('users/alice1/projects/del2').get()).exists; i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal((await env.db.doc('users/alice1/projects/del2').get()).exists, false, 'document removed by recovery');
      assert.deepEqual(await env.keys('users/alice1/projects/del2/'), [], 'files removed by recovery');
    } finally {
      flakySrv.close();
    }
  });

  it('interrupted delete: an explicit second DELETE also completes it', async () => {
    await alice.json('POST', '/api/projects', { project: big('del3', 'w') });
    let fail = true;
    const flaky = Object.create(env.blobs);
    flaky.deletePrefix = async (p: string) => {
      if (fail) throw new Error('simulated storage outage');
      return env.blobs.deletePrefix(p);
    };
    const flakySrv = await env.serve({ blobs: flaky });
    const fa = new Client(flakySrv.base);
    await fa.signIn('alice1', 'alice@x.com');
    try {
      assert.equal((await fa.json('DELETE', '/api/projects/del3')).status, 500);
      fail = false;
      assert.equal((await fa.json('DELETE', '/api/projects/del3')).status, 200);
    } finally {
      flakySrv.close();
    }
    assert.deepEqual(await env.keys('users/alice1/projects/del3/'), []);
    assert.equal((await env.db.doc('users/alice1/projects/del3').get()).exists, false);
  });

  it('recovery never touches a project that is not being deleted (resumeOnly guard)', async () => {
    await alice.json('POST', '/api/projects', { project: small('live1', 'alive') });
    await assert.rejects(srv.store.delete('alice1', 'live1', { resumeOnly: true }), /Nothing to resume/);
    assert.equal(await srv.store.resumeDeletes('alice1', ['live1']), 1, 'counted as attempted');
    const got = await alice.json('GET', '/api/projects/live1');
    assert.equal(got.status, 200);
    assert.equal(got.body.project.title, 'alive');
    assert.equal((await env.db.doc('users/alice1/projects/live1').get()).data()!.status, 'active');
  });

  it('orphan sweeper removes unreferenced old body objects but never the current body or recent in-flight ones', async () => {
    await alice.json('POST', '/api/projects', { project: big('orph1', 'o') });
    const [current] = await bodies('alice1', 'orph1');
    await env.blobs.put('users/alice1/projects/orph1/_body/orphan-from-crash.json', Buffer.from('{}'), 'application/json');
    assert.equal(await srv.store.sweepOrphans('alice1', 'orph1'), 0, 'a fresh object might belong to a save in progress');
    assert.equal(await srv.store.sweepOrphans('alice1', 'orph1', { minAgeMs: 0 }), 1);
    assert.deepEqual(await bodies('alice1', 'orph1'), [current]);
    assert.equal((await alice.json('GET', '/api/projects/orph1')).status, 200);
  });

  it('users stay separated during concurrent activity: Bob’s parallel saves to the same id never touch Alice’s project', async () => {
    await alice.json('POST', '/api/projects', { project: small('same-id', 'alice owns') });
    await bob.json('POST', '/api/projects', { project: small('same-id', 'bob owns') });
    await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => bob.json('PUT', '/api/projects/same-id', { project: small('same-id', `bob ${i}`), baseRevision: 1 })),
      alice.json('PUT', '/api/projects/same-id', { project: small('same-id', 'alice v2'), baseRevision: 1 }),
    ]);
    assert.equal((await alice.json('GET', '/api/projects/same-id')).body.project.title, 'alice v2');
    assert.match((await bob.json('GET', '/api/projects/same-id')).body.project.title, /^bob \d$/);
    assert.equal((await alice.json('DELETE', '/api/projects/same-id')).status, 200);
    assert.equal((await bob.json('GET', '/api/projects/same-id')).status, 200, 'Alice’s delete does not affect Bob');
  });

  it('ConflictError carries the cloud revision', async () => {
    await assert.rejects(srv.store.save('alice1', 'rev1', small('rev1', 'x'), { mode: 'update', baseRevision: 9 }), (e: unknown) => e instanceof ConflictError && e.cloudRevision === 1);
  });
});

if (missing) console.log(`# SKIPPED concurrency tests: ${missing}`);
