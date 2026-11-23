/** Shared setup for integration tests: Firestore + GCS emulators, stores, and a cookie client. */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client } from 'google-auth-library';
import assert from 'node:assert/strict';
import { AppOptions, createApp } from '../server/app';
import { BlobStore, GcsBlobStore } from '../server/blobStore';
import { FirestoreJobStore } from '../server/jobStore';
import { FirestoreUsageStore } from '../server/usage';
import { FirestoreProjectStore } from '../server/projectStore';
import { Emulators, startEmulators } from './emulators';
import { createStubProvider, listen, makeTestClip, tempDir, TEST_SESSION_SECRET, testVerifier } from './helpers';

export class Client {
  cookie = '';
  constructor(public base: string) {}
  async req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'x-requested-with': 'mms', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined && !(body instanceof Uint8Array)) h['Content-Type'] = 'application/json';
    return fetch(this.base + p, { method, headers: h, body: (body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)) as BodyInit | undefined, redirect: 'manual' });
  }
  async json(method: string, p: string, body?: unknown) {
    const res = await this.req(method, p, body);
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  }
  async signIn(uid: string, email: string) {
    const res = await this.req('POST', '/api/auth/session', { credential: `test:${uid}:${email}` });
    assert.equal(res.status, 200, `sign-in ${email}`);
    this.cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  }
}

export interface CloudEnv {
  emu: Emulators;
  storage: Storage;
  db: Firestore;
  bucket: string;
  blobs: GcsBlobStore;
  projectStore: FirestoreProjectStore;
  stub: ReturnType<typeof createStubProvider>;
  /** Starts an app over the given blob store (default: the shared one). */
  serve: (over?: Partial<AppOptions> & { blobs?: BlobStore }) => Promise<{ base: string; close: () => void; store: FirestoreProjectStore }>;
  keys: (prefix: string) => Promise<string[]>;
  stop: () => void;
}

export async function startCloudEnv(bucket: string, emails = ['alice@x.com', 'bob@x.com']): Promise<CloudEnv> {
  const emu = await startEmulators();
  process.env.FIRESTORE_EMULATOR_HOST = emu.firestoreHost;
  process.env.STORAGE_EMULATOR_HOST = emu.gcsEndpoint;
  const dummy = new OAuth2Client();
  dummy.setCredentials({ access_token: 'emulator', expiry_date: Date.now() + 3600_000 });
  const storage = new Storage({ projectId: `demo-${bucket}`, authClient: dummy });
  await storage.createBucket(bucket);
  const blobs = new GcsBlobStore(bucket, storage);
  const db = new Firestore({ projectId: `demo-${bucket}` });
  const stub = createStubProvider(makeTestClip(tempDir('envclip-'), 'c.mp4', 'gray'));
  const projectStore = new FirestoreProjectStore(db, blobs);
  return {
    emu,
    storage,
    db,
    bucket,
    blobs,
    projectStore,
    stub,
    async serve(over = {}) {
      const b = over.blobs ?? blobs;
      const store = over.projectStore ? (over.projectStore as FirestoreProjectStore) : new FirestoreProjectStore(db, b);
      const { blobs: _ignored, ...rest } = over;
      const app = createApp({
        provider: stub.provider,
        blobStore: b,
        projectStore: store,
        jobStore: new FirestoreJobStore(db),
        usageStore: new FirestoreUsageStore(db),
        videoJobs: { pollIntervalMs: 0 },
        auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: emails },
        ...rest,
      });
      const srv = await listen(app);
      return { ...srv, store };
    },
    keys: async (prefix) => (await storage.bucket(bucket).getFiles({ prefix }))[0].map((f) => f.name),
    stop: () => emu.stop(),
  };
}
