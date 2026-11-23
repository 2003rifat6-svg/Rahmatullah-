/**
 * TEST-ONLY server for the end-to-end UI test: the real Express app + the built
 * frontend, with a stub AI provider so no paid API is called.
 * STUB_CLOUD=1 additionally runs the real Firestore + GCS emulators and Google-sign-in
 * mode with a test token verifier (test:<uid>:<email>).
 */
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client } from 'google-auth-library';
import path from 'node:path';
import { AppOptions, createApp } from '../server/app';
import { GcsBlobStore, LocalDiskBlobStore } from '../server/blobStore';
import { BlobJobStore, FirestoreJobStore } from '../server/jobStore';
import { BlobUsageStore, FirestoreUsageStore } from '../server/usage';
import { FirestoreProjectStore } from '../server/projectStore';
import { startEmulators } from './emulators';
import { createStoryMock } from './storyMock';
import { createStubProvider, makeTestClip, tempDir, TEST_SESSION_SECRET, testVerifier } from './helpers';

const dir = tempDir('e2e-');
const { provider } = createStubProvider(makeTestClip(dir, 'clip.mp4', 'blue'));
const localBlobs = new LocalDiskBlobStore(path.join(dir, 'media'));
// Story-analysis stages are answered by the scripted story mock, everything else by the stub provider.
const storyMock = createStoryMock();
const stubText = provider.generateText.bind(provider);
provider.generateText = (system, history, message, o) => (system.includes('[[STAGE:') || message.startsWith('[[STAGE:') ? storyMock.provider.generateText(system, history, message, o) : stubText(system, history, message, o));
let opts: AppOptions = {
  provider,
  blobStore: localBlobs,
  projectStore: null,
  jobStore: new BlobJobStore(localBlobs),
  usageStore: new BlobUsageStore(localBlobs),
  videoJobs: { pollIntervalMs: 0 },
  auth: { mode: 'none' },
  staticDir: path.resolve('dist'),
};

if (process.env.STUB_CLOUD) {
  const emu = await startEmulators();
  process.on('exit', emu.stop);
  process.on('SIGTERM', () => process.exit(0));
  process.env.FIRESTORE_EMULATOR_HOST = emu.firestoreHost;
  process.env.STORAGE_EMULATOR_HOST = emu.gcsEndpoint;
  const dummy = new OAuth2Client();
  dummy.setCredentials({ access_token: 'emulator', expiry_date: Date.now() + 36e5 });
  const storage = new Storage({ projectId: 'demo-mms', authClient: dummy });
  await storage.createBucket('mms-e2e');
  const blobStore = new GcsBlobStore('mms-e2e', storage);
  opts = {
    ...opts,
    blobStore,
    projectStore: new FirestoreProjectStore(new Firestore({ projectId: 'demo-mms' }), blobStore),
    jobStore: new FirestoreJobStore(new Firestore({ projectId: 'demo-mms' })),
    usageStore: new FirestoreUsageStore(new Firestore({ projectId: 'demo-mms' })),
    auth: { mode: 'google', googleClientId: 'test-client-id', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: ['alice@x.com', 'bob@x.com'] },
  };
}

const port = Number(process.env.PORT || 8799);
createApp(opts).listen(port, () => console.log(`stub server ready on ${port}`));
