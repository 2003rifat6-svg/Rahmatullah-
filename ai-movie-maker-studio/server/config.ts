/**
 * Builds the server options from environment variables (see .env.example / README).
 * Fails closed: on Cloud Run the server will not start without sign-in and a GCS bucket.
 */
import { Firestore } from '@google-cloud/firestore';
import path from 'node:path';
import type { AppOptions } from './app';
import { googleIdTokenVerifier } from './auth';
import { BlobStore, GcsBlobStore, LocalDiskBlobStore } from './blobStore';
import { FirestoreProjectStore } from './projectStore';
import { BlobJobStore, FirestoreJobStore, JobStore } from './jobStore';
import { InlineJobQueue, SUPPORTED_QUEUES } from './queue';
import { BlobUsageStore, FirestoreUsageStore, quotaConfigFromEnv, UsageStore } from './usage';
import { createGeminiProvider } from './provider';
import { parseAllowedEmails, validateOAuthClientId } from './shared/config-rules.mjs';
import { parseCorsOrigins } from './security';

export class ConfigError extends Error {}

export function buildOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): AppOptions {
  const onCloudRun = Boolean(env.K_SERVICE);
  const warnings: string[] = [];

  // Storage
  let blobStore: BlobStore;
  if (env.GCS_BUCKET) {
    blobStore = new GcsBlobStore(env.GCS_BUCKET);
  } else if (onCloudRun) {
    throw new ConfigError('GCS_BUCKET is required on Cloud Run (its disk is temporary; files must go to Cloud Storage).');
  } else {
    blobStore = new LocalDiskBlobStore(path.resolve(env.MEDIA_DIR || 'server-data/media'));
    warnings.push('Files are stored on the local disk (development mode). Set GCS_BUCKET for Cloud Storage.');
  }

  // Auth
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  let auth: AppOptions['auth'];
  if (clientId) {
    const secret = env.SESSION_SECRET || '';
    if (secret.length < 32) throw new ConfigError('SESSION_SECRET must be at least 32 characters when sign-in is enabled.');
    // Same rules as the deployment script (server/shared/config-rules.mjs).
    const idErrors = validateOAuthClientId(clientId);
    if (idErrors.length) throw new ConfigError(idErrors.join(' ').replace('OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'));
    const parsed = parseAllowedEmails(env.ALLOWED_EMAILS);
    if (parsed.errors.length) throw new ConfigError(`${parsed.errors.join(' ')} Refusing to start open to every Google user.`);
    const allowedEmails = parsed.emails;
    auth = {
      mode: 'google',
      googleClientId: clientId,
      verifier: googleIdTokenVerifier(clientId),
      sessionSecret: secret,
      allowedEmails,
    };
  } else if (onCloudRun) {
    throw new ConfigError('GOOGLE_OAUTH_CLIENT_ID and SESSION_SECRET are required on Cloud Run (user data must be protected).');
  } else {
    auth = { mode: 'none', accessToken: env.STUDIO_ACCESS_TOKEN || undefined };
    warnings.push('Sign-in is off (local development). Cloud sync is disabled until GOOGLE_OAUTH_CLIENT_ID is set.');
  }

  // Firestore (uses Application Default Credentials; FIRESTORE_EMULATOR_HOST for tests)
  const firestoreOn = env.FIRESTORE_ENABLED === 'true' || Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (onCloudRun && !firestoreOn) {
    // Video jobs, quotas and cloud projects must be durable: Cloud Run's disk and memory are not.
    throw new ConfigError('FIRESTORE_ENABLED=true is required on Cloud Run (durable video jobs and usage limits are stored in Firestore).');
  }
  const db = firestoreOn
    ? new Firestore({
        projectId: env.GOOGLE_CLOUD_PROJECT || undefined,
        databaseId: env.FIRESTORE_DATABASE_ID || undefined,
        ignoreUndefinedProperties: true,
      })
    : null;
  const projectStore = db ? new FirestoreProjectStore(db, blobStore) : null;
  const jobStore: JobStore = db ? new FirestoreJobStore(db) : new BlobJobStore(blobStore);
  if (!projectStore) warnings.push('Firestore is off (FIRESTORE_ENABLED not true): cloud project sync is disabled and video jobs are kept in local files (single instance, development only).');

  // Rate limits / quotas are durable too (Firestore, or local files in development) — never memory only.
  const usageStore: UsageStore = db ? new FirestoreUsageStore(db) : new BlobUsageStore(blobStore);
  let quotas;
  try {
    quotas = quotaConfigFromEnv(env);
  } catch (err) {
    throw new ConfigError(err instanceof Error ? err.message : 'Invalid QUOTA_* value.');
  }

  const queueName = (env.JOB_QUEUE || 'inline').trim();
  if (!(SUPPORTED_QUEUES as readonly string[]).includes(queueName)) {
    throw new ConfigError(`JOB_QUEUE="${queueName}" is not implemented. Supported: ${SUPPORTED_QUEUES.join(', ')}. See server/queue.ts to add a Cloud Tasks / Pub/Sub adapter.`);
  }

  const cors = parseCorsOrigins(env.CORS_ORIGINS ?? env.CORS_ORIGIN);
  if (cors.errors.length) throw new ConfigError(cors.errors.join(' '));

  const provider = createGeminiProvider(env);
  if (auth.mode === 'none' && provider && !auth.accessToken) {
    // A paid API key must never sit behind an open endpoint, not even in development.
    throw new ConfigError('GEMINI_API_KEY is set but sign-in is off and STUDIO_ACCESS_TOKEN is empty. Set STUDIO_ACCESS_TOKEN (or configure Google sign-in) so only you can use the paid API.');
  }

  return {
    provider,
    blobStore,
    projectStore,
    jobStore,
    usageStore,
    quotas,
    queue: new InlineJobQueue(),
    auth,
    staticDir: path.resolve('dist'),
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    signedUrls: env.GCS_SIGNED_URLS === 'true' && blobStore.kind === 'gcs',
    corsOrigins: cors.origins,
    production: onCloudRun || env.NODE_ENV === 'production',
    warnings,
  };
}
