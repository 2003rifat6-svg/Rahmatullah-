/**
 * AI Movie Maker Studio — backend API (Express).
 *
 * Auth        POST /api/auth/session · GET /api/auth/me · POST /api/auth/logout
 * Projects    GET/POST /api/projects · GET/PUT/DELETE /api/projects/:id      (Firestore)
 * Files       GET /api/storage/files · POST /api/storage/upload-url ·
 *             PUT /api/storage/upload/<key> · DELETE /api/storage/files/<key> (GCS)
 *             GET /api/media/<key>  (download / stream, owner only)
 * AI          POST /api/chat · /api/generate-character-ref · /api/generate/shot-image ·
 *             /api/generate/shot-video · GET /api/generate/video-status/:id
 * Export      POST /api/export/mp4 (FFmpeg; temp files deleted, result saved to storage)
 *
 * Every data path is derived from the signed-in user's uid: users/<uid>/projects/<id>/...
 * No endpoint returns placeholder media.
 */
import express, { NextFunction, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  IdTokenVerifier,
  readCookie,
  requireCsrfHeader,
  SESSION_COOKIE,
  sessionCookie,
  SessionUser,
  signSession,
  verifySession,
} from './auth';
import { BlobStore, isSafeKey, projectPrefix, safeSegment, userPrefix } from './blobStore';
import { ConflictError, IntegrityError, NotFoundError, ProjectDeletingError, ProjectStore, ValidationError } from './projectStore';
import { JobStore, publicJob } from './jobStore';
import { JobQueue } from './queue';
import { advanceJob, cancelJob, startVideoJob, VideoJobDeps } from './videoJobs';
import { logError, safeErrorMessage } from './redact';
import { analyzeStory, PipelineError } from './storyPipeline';
import { corsMiddleware, originGuard, securityHeaders } from './security';
import { checkDeclared, checkFile, UPLOAD_KINDS, UPLOAD_RULES, UploadKind, MIME_FAMILIES } from './uploads';
import { limitsFor, QuotaConfig, quotaConfigFromEnv, QuotaError, QuotaGroup, UsageStore } from './usage';
import * as v from './validators';
import { LIMITS, RequestError } from './validators';
import { InlineImage, parseDataUrl, StudioAiProvider } from './provider';

export type AuthOptions =
  | {
      mode: 'google';
      googleClientId: string;
      verifier: IdTokenVerifier;
      sessionSecret: string;
      /** If set, only these Google accounts may sign in (protects the paid API). */
      /** Required, non-empty: only these Google accounts may use the server. */
      allowedEmails: string[];
    }
  | {
      /** Local development only: single user "local", optional shared token for /api. */
      mode: 'none';
      accessToken?: string;
    };

export interface AppOptions {
  provider: StudioAiProvider | null;
  blobStore: BlobStore;
  projectStore: ProjectStore | null;
  /** Durable video-job storage (Firestore in production, local files in development). */
  jobStore: JobStore;
  /** Durable rate-limit / quota counters (Firestore in production, local files in development). */
  usageStore: UsageStore;
  /** Quota numbers (default: environment / built-in defaults). */
  quotas?: QuotaConfig;
  /** Background queue adapter (default: inline = browser polling drives progress). */
  queue?: JobQueue;
  /** Optional tuning (tests use small values). */
  videoJobs?: { pollIntervalMs?: number; queuedTimeoutMs?: number; maxPollErrors?: number };
  auth: AuthOptions;
  staticDir?: string;
  ffmpegPath?: string;
  /** Redirect /api/media to short-lived V4 signed GCS URLs (needs signBlob permission). */
  signedUrls?: boolean;
  /** Exact origins allowed to call the API from another website (default: none, same-origin only). */
  corsOrigins?: string[];
  /** Production hardening: session cookie is always Secure, HSTS and upgrade-insecure-requests are sent. */
  production?: boolean;
  warnings?: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

const MEDIA_ROUTE = '/api/media/';

function extFor(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('zip')) return 'zip';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('json')) return 'json';
  if (mime.includes('text/plain')) return 'txt';
  return 'bin';
}

export function checkFfmpeg(ffmpegPath = 'ffmpeg'): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(ffmpegPath, ['-version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-4000);
    });
    p.on('error', (err) => resolve({ ok: false, stderr: err.message }));
    p.on('exit', (code) => resolve({ ok: code === 0, stderr }));
  });
}

/** Extracts the storage key from "/api/media/<key>" (absolute or relative URL). */
export function mediaKeyFromUrl(url: string): string | null {
  let p = '';
  try {
    p = new URL(String(url || ''), 'http://local').pathname;
  } catch {
    return null;
  }
  if (!p.startsWith(MEDIA_ROUTE)) return null;
  const key = decodeURIComponent(p.slice(MEDIA_ROUTE.length));
  return isSafeKey(key) ? key : null;
}

const CHAT_SYSTEM_PROMPT = `You are the production assistant inside "AI Movie Maker Studio", a mobile app for making AI short films.
The user prepares Story, Characters (with Face / Front / Side / Back reference images), Image Prompts and Video Prompts (each identified by Scene ID and Shot ID), and Production Settings.
When a "Project Materials Bundle" is provided, treat it as the single source of truth: check story/character/prompt consistency, point out missing or mismatched Scene/Shot IDs, and suggest concrete prompt improvements.
Never claim that an image or video has been generated — generation only happens when the user presses the Generate buttons in the app.
Reply in the user's language (Bengali or English). Be concise and practical.`;

export function createApp(opts: AppOptions) {
  if (opts.auth.mode === 'google' && !opts.auth.allowedEmails.length) {
    throw new Error('ALLOWED_EMAILS must list at least one Google account (refusing to run open to every Google user).');
  }
  const app = express();
  const ffmpegPath = opts.ffmpegPath || 'ffmpeg';
  const store = opts.blobStore;
  const auth = opts.auth;

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const corsOrigins = opts.corsOrigins ?? [];
  const production = opts.production ?? false;
  app.use(securityHeaders({ production, corsOrigins }));
  app.use(corsMiddleware(corsOrigins));
  app.use('/api', originGuard(corsOrigins));
  // API answers are never cached (the media route below sets its own private cache header).
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ---------- identity ----------
  const attachUser = (req: Request, _res: Response, next: NextFunction) => {
    if (auth.mode === 'google') {
      const u = verifySession(readCookie(req, SESSION_COOKIE), auth.sessionSecret);
      // Checked on every request: removing an email from ALLOWED_EMAILS ends its existing sessions.
      if (u && auth.allowedEmails.includes(u.email)) req.user = u;
    } else {
      req.user = { uid: 'local', email: '' };
    }
    next();
  };
  app.use(attachUser);

  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    if (auth.mode === 'none') {
      if (auth.accessToken && req.header('x-studio-token') !== auth.accessToken) {
        return res.status(401).json({ error: 'Missing or wrong studio access token (set it in Cloud Settings).' });
      }
      return next();
    }
    if (!req.user) return res.status(401).json({ error: 'Please sign in with Google.', signInRequired: true });
    next();
  };

  const requireProjects = (_req: Request, res: Response, next: NextFunction) => {
    if (auth.mode !== 'google') {
      return res.status(503).json({ error: 'Cloud sync needs sign-in. Set GOOGLE_OAUTH_CLIENT_ID and SESSION_SECRET on the server.', notConfigured: true });
    }
    if (!opts.projectStore) {
      return res.status(503).json({ error: 'Firestore is not configured on this server (FIRESTORE_ENABLED / GOOGLE_CLOUD_PROJECT).', notConfigured: true });
    }
    next();
  };

  const requireProvider = (_req: Request, res: Response, next: NextFunction) => {
    if (opts.provider) return next();
    res.status(503).json({
      error: 'GEMINI_API_KEY is not set on the server. AI generation is disabled until the server owner adds a key (it is a paid Google API).',
      notConfigured: true,
    });
  };

  /** Internal folders (_body: project bodies, _jobs: dev job files) are never reachable through the file API. */
  const INTERNAL_KEY = /\/(_body|_jobs)\//;
  const ownsKey = (req: Request, key: string) => isSafeKey(key) && key.startsWith(userPrefix(req.user!.uid)) && !INTERNAL_KEY.test(key);

  const fail = (res: Response, err: unknown, fallback: string) => {
    if (err instanceof ConflictError) return res.status(409).json({ error: err.message, code: 'revision_conflict', cloudRevision: err.cloudRevision, cloudUpdatedAt: err.cloudUpdatedAt });
    if (err instanceof ProjectDeletingError) return res.status(409).json({ error: err.message, code: 'project_deleting' });
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, code: 'bad_request' });
    if (err instanceof IntegrityError) return res.status(500).json({ error: err.message, code: 'integrity_error' });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message, code: 'not_found' });
    logError(fallback, err);
    return res.status(500).json({ error: `${fallback}: ${safeErrorMessage(err)}` });
  };

  // ---------- health ----------
  app.get('/health', async (_req, res) => {
    res.json({
      ok: true,
      service: 'ai-movie-maker-studio-backend',
      geminiConfigured: Boolean(opts.provider),
      models: opts.provider?.models ?? null,
      ffmpegAvailable: await checkFfmpeg(ffmpegPath),
      authMode: auth.mode,
      googleClientId: auth.mode === 'google' ? auth.googleClientId : null,
      accessTokenRequired: auth.mode === 'none' && Boolean(auth.accessToken),
      cloudSync: Boolean(opts.projectStore) && auth.mode === 'google',
      storage: store.kind,
      warnings: opts.warnings ?? [],
    });
  });

  // ---------- auth ----------
  // Request size limits are set per route group (a chat message never needs 60 MB).
  const parser = (limit: string) => express.json({ limit });
  const jsonTiny = parser('64kb');
  const jsonChat = parser('800kb');
  const jsonStory = parser('400kb');
  const jsonRef = parser('20mb');
  const jsonShotImage = parser('40mb');
  const jsonVideo = parser('12mb');
  const jsonProject = parser('30mb'); // Cloud Run accepts at most 32 MB per request
  const quotas = opts.quotas ?? quotaConfigFromEnv();

  /** Reserves one unit of a quota group. Throws QuotaError (-> 429) when a limit is used up. */
  const reserve = async (req: Request, group: QuotaGroup, projectId?: string) => {
    const r = await opts.usageStore.consume(req.user!.uid, limitsFor(quotas, group, projectId));
    if (!r.allowed) throw new QuotaError(r);
  };

  /** One place that turns any AI/validation/quota failure into the right HTTP answer. */
  const aiFail = (res: Response, err: unknown, fallback: string) => {
    if (err instanceof RequestError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof QuotaError) {
      res.setHeader('Retry-After', String(err.detail.retryAfterSec));
      return res.status(429).json({
        error: err.message,
        code: 'quota_exceeded',
        limit: err.detail.limit,
        window: err.detail.key,
        resetAt: err.detail.resetAt,
        retryAfterSec: err.detail.retryAfterSec,
      });
    }
    logError(fallback, err);
    return res.status(502).json({ error: `${fallback}: ${safeErrorMessage(err)}` });
  };

  // Sign-in is the only endpoint reachable without a session: cap attempts per address
  // (per instance, supplementary protection only — the real quotas above are durable).
  const signInHits = new Map<string, { n: number; reset: number }>();
  const signInLimiter = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    const e = signInHits.get(ip);
    if (!e || e.reset < now) signInHits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++e.n > 30) {
      res.setHeader('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a minute.', code: 'rate_limited' });
    }
    if (signInHits.size > 5000) for (const [k, x] of signInHits) if (x.reset < now) signInHits.delete(k);
    next();
  };

  app.post('/api/auth/session', signInLimiter, jsonTiny, async (req, res) => {
    if (auth.mode !== 'google') return res.status(503).json({ error: 'Sign-in is not configured on this server.' });
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || credential.length < 10) return res.status(400).json({ error: 'credential is required.' });
    try {
      const user = await auth.verifier(credential);
      if (!auth.allowedEmails.includes(user.email)) {
        return res.status(403).json({ error: `${user.email} is not allowed on this studio server.` });
      }
      const secure = production || req.secure || req.header('x-forwarded-proto') === 'https';
      res.setHeader('Set-Cookie', sessionCookie(signSession(user, auth.sessionSecret), { secure, crossSite: corsOrigins.length > 0 }));
      res.json({ user });
    } catch (err) {
      res.status(401).json({ error: `Google sign-in failed: ${err instanceof Error ? err.message : 'invalid token'}` });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    if (auth.mode !== 'google') return res.json({ user: null, authMode: 'none' });
    if (!req.user) return res.status(401).json({ error: 'Not signed in.', signInRequired: true });
    res.json({ user: req.user });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', sessionCookie('', { secure: production || req.secure, crossSite: corsOrigins.length > 0, clear: true }));
    res.json({ ok: true });
  });

  // ---------- media download (GET, owner only; works in <img>/<video> via cookie) ----------
  // In local dev mode (no sign-in) <img>/<video> cannot send the x-studio-token header,
  // so media GETs are allowed for the single "local" user. With Google sign-in the
  // session cookie is always required.
  const requireMediaUser = (req: Request, res: Response, next: NextFunction) =>
    auth.mode === 'none' ? next() : requireUser(req, res, next);

  app.get(/^\/api\/media\/(.+)$/, requireMediaUser, async (req, res) => {
    const key = decodeURIComponent(String((req.params as Record<string, string>)[0] || ''));
    if (!ownsKey(req, key)) return res.status(404).json({ error: 'File not found.' });
    try {
      const info = await store.stat(key);
      if (!info) return res.status(404).json({ error: 'File not found.' });
      if (opts.signedUrls && store.signedReadUrl && req.query.inline !== '1') {
        return res.redirect(302, await store.signedReadUrl(key, 15 * 60));
      }
      // Only known-safe types are served inline; anything else is a download, never rendered by the browser.
      const inline = Object.prototype.hasOwnProperty.call(MIME_FAMILIES, info.contentType) && info.contentType !== 'text/plain' && info.contentType !== 'application/json';
      res.setHeader('Content-Type', inline ? info.contentType : 'application/octet-stream');
      if (!inline) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (m && info.size > 0) {
        const start = m[1] ? Number(m[1]) : Math.max(0, info.size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) {
          res.setHeader('Content-Range', `bytes */${info.size}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        await pipeline(store.read(key, { start, end }), res);
        return;
      }
      res.setHeader('Content-Length', String(info.size));
      await pipeline(store.read(key), res);
    } catch (err) {
      if (!res.headersSent) fail(res, err, 'Download failed');
      else res.destroy();
    }
  });

  // Everything else under /api: signed-in user + CSRF header (cookie auth).
  app.use('/api', requireUser);
  if (auth.mode === 'google') app.use('/api', requireCsrfHeader);

  /** Moves every large data: URL inside the project JSON into storage (Firestore docs max 1 MiB). */
  const externalizeMedia = async (uid: string, projectId: string, value: unknown): Promise<unknown> => {
    if (typeof value === 'string') {
      if (value.length > 2048 && value.startsWith('data:')) {
        const parsed = parseDataUrl(value);
        if (!parsed) return value;
        const bytes = Buffer.from(parsed.base64, 'base64');
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
        const key = `${projectPrefix(uid, projectId)}assets/${hash}.${extFor(parsed.mimeType)}`;
        if (!(await store.stat(key))) await store.put(key, bytes, parsed.mimeType);
        return `${MEDIA_ROUTE}${key}`;
      }
      return value;
    }
    if (Array.isArray(value)) {
      const out = [];
      for (const v of value) out.push(await externalizeMedia(uid, projectId, v));
      return out;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = await externalizeMedia(uid, projectId, v);
      return out;
    }
    return value;
  };

  // ---------- projects (Firestore) ----------
  const projectRouter = express.Router();
  projectRouter.use(requireProjects);

  projectRouter.get('/', async (req, res) => {
    try {
      res.json({ projects: await opts.projectStore!.list(req.user!.uid) });
    } catch (err) {
      fail(res, err, 'Listing projects failed');
    }
  });

  const saveHandler = (mode: 'create' | 'update') => async (req: Request, res: Response) => {
    const project = req.body?.project;
    const id = mode === 'create' ? project?.id : req.params.id;
    if (!project || typeof project !== 'object' || typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'Body must be { project } with a project id.', code: 'bad_request' });
    }
    if (mode === 'update') {
      if (project.id !== id) return res.status(400).json({ error: 'project.id does not match the URL.', code: 'bad_request' });
      const base = req.body?.baseRevision;
      if (!Number.isInteger(base) || base < 1) {
        return res.status(400).json({
          error: 'baseRevision is required for updates: the cloud revision your change is based on. Load the project (or save it for the first time with POST) first.',
          code: 'base_revision_required',
        });
      }
    }
    try {
      const uid = req.user!.uid;
      await opts.projectStore!.assertWritable(uid, id);
      const clean = (await externalizeMedia(uid, id, project)) as Record<string, unknown>;
      const meta = await opts.projectStore!.save(uid, id, clean, mode === 'create' ? { mode } : { mode, baseRevision: req.body.baseRevision });
      res.status(mode === 'create' ? 201 : 200).json({ meta, project: clean, syncedAt: meta.updatedAt });
    } catch (err) {
      fail(res, err, 'Saving project failed');
    }
  };
  projectRouter.post('/', jsonProject, saveHandler('create'));
  projectRouter.put('/:id', jsonProject, saveHandler('update'));

  projectRouter.get('/:id', async (req, res) => {
    try {
      const { meta, project } = await opts.projectStore!.get(req.user!.uid, String(req.params.id));
      res.json({ meta, project });
    } catch (err) {
      fail(res, err, 'Loading project failed');
    }
  });

  projectRouter.delete('/:id', async (req, res) => {
    try {
      await opts.projectStore!.delete(req.user!.uid, String(req.params.id));
      res.json({ deletedAt: new Date().toISOString() });
    } catch (err) {
      fail(res, err, 'Deleting project failed');
    }
  });
  app.use('/api/projects', projectRouter);

  // ---------- files (GCS) ----------
  app.get('/api/storage/files', async (req, res) => {
    const projectId = String(req.query.projectId || '');
    if (!projectId) return res.status(400).json({ error: 'projectId is required.' });
    try {
      const files = await store.list(projectPrefix(req.user!.uid, projectId));
      res.json({
        files: files
          .filter((f) => !f.key.includes('/_body/') && !f.key.endsWith('/project.json'))
          .map((f) => ({ ...f, url: `${MEDIA_ROUTE}${f.key}`, name: path.basename(f.key), kind: f.key.split('/')[4] })),
      });
    } catch (err) {
      fail(res, err, 'Listing files failed');
    }
  });

  app.post('/api/storage/upload-url', jsonTiny, async (req, res) => {
    try {
      const projectId = v.id('projectId', req.body?.projectId, { required: true })!;
      const kind = v.oneOf('kind', req.body?.kind, UPLOAD_KINDS, { required: true })!;
      const size = v.intInRange('size', req.body?.size, 1, UPLOAD_RULES[kind].maxBytes);
      const filename = v.text('filename', req.body?.filename, 120);
      const declared = checkDeclared(kind, String(req.body?.contentType || ''), size);
      if (!declared.ok) throw new RequestError(declared.status, declared.error, declared.status === 413 ? 'payload_too_large' : 'unsupported_type');
      const hash = typeof req.body?.contentHash === 'string' && /^[0-9a-f]{24}$/.test(req.body.contentHash) ? req.body.contentHash : null;
      // The extension comes from the verified type, never from the user's file name.
      const ext = extFor(declared.mime);
      const base = safeSegment(filename.replace(/\.[^.]+$/, ''), 'file');
      const key =
        kind === 'assets' && hash
          ? `${projectPrefix(req.user!.uid, projectId)}assets/${hash}.${ext}` // content-addressed: re-uploading the same bytes is harmless
          : `${projectPrefix(req.user!.uid, projectId)}${kind}/${base}_${randomUUID().slice(0, 8)}.${ext}`;
      if (opts.signedUrls && store.signedUploadUrl) {
        // Direct browser -> GCS upload (no 32 MB Cloud Run limit). The URL only accepts this type and size range;
        // the file is checked again by /api/storage/upload-complete. Bucket needs CORS (deploy/cors.json).
        const url = await store.signedUploadUrl(key, declared.mime, 15 * 60, UPLOAD_RULES[kind].maxBytes);
        return res.json({
          key,
          method: 'PUT',
          url,
          headers: { 'Content-Type': declared.mime, 'x-goog-content-length-range': `0,${UPLOAD_RULES[kind].maxBytes}` },
          direct: true,
          mediaUrl: `${MEDIA_ROUTE}${key}`,
          maxBytes: UPLOAD_RULES[kind].maxBytes,
        });
      }
      res.json({ key, method: 'PUT', url: `/api/storage/upload/${key}`, headers: { 'Content-Type': declared.mime }, direct: false, mediaUrl: `${MEDIA_ROUTE}${key}`, maxBytes: UPLOAD_RULES[kind].maxBytes });
    } catch (err) {
      if (err instanceof RequestError) return res.status(err.status).json({ error: err.message, code: err.code });
      fail(res, err, 'Could not prepare upload');
    }
  });

  /** Folder name (images, videos, ...) of a user storage key: users/<uid>/projects/<id>/<kind>/<file>. */
  const kindOfKey = (key: string): UploadKind | null => {
    const k = key.split('/')[4];
    return (UPLOAD_KINDS as string[]).includes(k) ? (k as UploadKind) : null;
  };

  // Upload through the server (≤ 30 MB, Cloud Run's request limit is 32 MB). Type, size and file signature are checked.
  app.put(/^\/api\/storage\/upload\/(.+)$/, express.raw({ type: () => true, limit: '30mb' }), async (req, res) => {
    const key = decodeURIComponent(String((req.params as Record<string, string>)[0] || ''));
    if (!ownsKey(req, key)) return res.status(403).json({ error: 'You can only upload into your own projects.' });
    const kind = kindOfKey(key);
    if (!kind) return res.status(400).json({ error: 'Upload path must be users/<you>/projects/<id>/<images|videos|zips|movies|assets|files>/<file>.' });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Empty upload.' });
    const check = checkFile(kind, String(req.headers['content-type'] || ''), body.subarray(0, 16), body.length);
    if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.status === 413 ? 'payload_too_large' : 'unsupported_type' });
    try {
      await store.put(key, body, check.mime);
      res.status(201).json({ key, url: `${MEDIA_ROUTE}${key}`, size: body.length });
    } catch (err) {
      fail(res, err, 'Upload failed');
    }
  });

  // After a direct (signed-URL) upload the browser calls this; invalid files are deleted again.
  app.post('/api/storage/upload-complete', jsonTiny, async (req, res) => {
    try {
      const key = v.text('key', req.body?.key, 512, { required: true });
      if (!ownsKey(req, key)) return res.status(404).json({ error: 'File not found.' });
      const kind = kindOfKey(key);
      const info = await store.stat(key);
      if (!kind || !info) return res.status(404).json({ error: 'File not found.' });
      const chunks: Buffer[] = [];
      for await (const c of store.read(key, { start: 0, end: 15 })) chunks.push(Buffer.from(c as Buffer));
      const check = checkFile(kind, info.contentType, Buffer.concat(chunks), info.size);
      if (!check.ok) {
        await store.delete(key);
        return res.status(check.status).json({ error: check.error, code: 'rejected_and_deleted' });
      }
      res.json({ key, url: `${MEDIA_ROUTE}${key}`, size: info.size, contentType: check.mime });
    } catch (err) {
      if (err instanceof RequestError) return res.status(err.status).json({ error: err.message, code: err.code });
      fail(res, err, 'Could not verify the upload');
    }
  });

  app.delete(/^\/api\/storage\/files\/(.+)$/, async (req, res) => {
    const key = decodeURIComponent(String((req.params as Record<string, string>)[0] || ''));
    if (!ownsKey(req, key)) return res.status(404).json({ error: 'File not found.' });
    try {
      if (!(await store.stat(key))) return res.status(404).json({ error: 'File not found.' });
      await store.delete(key);
      res.json({ deleted: key });
    } catch (err) {
      fail(res, err, 'Delete failed');
    }
  });

  // ---------- AI (validate -> quota -> provider) ----------
  app.post('/api/chat', jsonChat, requireProvider, async (req, res) => {
    try {
      const message = v.text('message', req.body?.message, LIMITS.chatMessage, { required: true });
      const projectTitle = v.text('projectTitle', req.body?.projectTitle, LIMITS.title);
      const bundle = v.text('materialsBundle', req.body?.materialsBundle, LIMITS.bundle);
      const history = v.chatHistory(req.body?.history);
      await reserve(req, 'chat');
      const sys = [
        CHAT_SYSTEM_PROMPT,
        projectTitle ? `Project title: ${projectTitle}` : '',
        bundle ? `Latest Project Materials Bundle sent by the user:\n${bundle}` : 'The user has not sent a Project Materials Bundle yet.',
      ]
        .filter(Boolean)
        .join('\n\n');
      res.json({ replyText: await opts.provider!.generateText(sys, history, message) });
    } catch (err) {
      aiFail(res, err, 'Gemini chat failed');
    }
  });

  app.post('/api/generate-character-ref', jsonRef, requireProvider, async (req, res) => {
    try {
      const prompt = v.text('prompt', req.body?.prompt, LIMITS.prompt, { required: true });
      const characterInfo = v.text('characterInfo', req.body?.characterInfo, LIMITS.characterInfo);
      const slot = v.oneOf('slot', req.body?.slot, ['face', 'front', 'side', 'back'] as const, { required: true })!;
      const projectId = v.id('projectId', req.body?.projectId);
      const refs = v.imageDataUrls('referenceImages', req.body?.referenceImages, 3, LIMITS.imageBytes);
      const slotText: Record<string, string> = {
        face: 'a close-up face portrait (head and shoulders), neutral expression, even studio light',
        front: 'a full-body FRONT view, standing straight, head to toe visible, plain neutral background',
        side: 'a full-body SIDE profile view, head to toe visible, plain neutral background',
        back: 'a full-body BACK view, head to toe visible, plain neutral background',
      };
      const fullPrompt = [
        `Character reference sheet image: ${slotText[slot]}.`,
        characterInfo ? `Character details:\n${characterInfo}` : '',
        `Instructions: ${prompt}`,
        refs.length ? 'Keep the exact same person (face, hair, body, clothing) as in the attached reference image(s).' : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      await reserve(req, 'image', projectId);
      const img = await opts.provider!.generateImage(fullPrompt, refs, slot === 'face' ? '1:1' : '3:4');
      res.json({ imageUrl: `data:${img.mimeType};base64,${img.base64}`, filename: `${slot}_generated.${extFor(img.mimeType)}` });
    } catch (err) {
      aiFail(res, err, 'Image generation failed');
    }
  });

  app.post('/api/generate/shot-image', jsonShotImage, requireProvider, async (req, res) => {
    try {
      const sceneId = v.id('sceneId', req.body?.sceneId, { required: true })!;
      const shotId = v.id('shotId', req.body?.shotId, { required: true })!;
      const projectId = v.id('projectId', req.body?.projectId);
      const prompt = v.text('prompt', req.body?.prompt, LIMITS.prompt, { required: true });
      const storyContext = v.text('storyContext', req.body?.storyContext, LIMITS.storyContext);
      const aspectRatio = v.oneOf('aspectRatio', req.body?.aspectRatio, v.ASPECT_RATIOS);
      const rawChars = req.body?.characters;
      if (rawChars !== undefined && (!Array.isArray(rawChars) || rawChars.length > 4)) throw new RequestError(400, 'characters must be a list of at most 4.');
      const chars = (rawChars ?? []).map((c: Record<string, unknown>, i: number) => ({
        info: v.text(`characters[${i}].info`, c?.info, 1500),
        refs: v.imageDataUrls(`characters[${i}].referenceImages`, c?.referenceImages, 3, LIMITS.imageBytes),
      }));
      const refs: InlineImage[] = chars.flatMap((c: { refs: InlineImage[] }) => c.refs);
      if (refs.length > LIMITS.imagesPerRequest) throw new RequestError(400, `At most ${LIMITS.imagesPerRequest} reference images per request.`);
      const fullPrompt = [
        `Cinematic film still for Scene ${sceneId} / Shot ${shotId}.`,
        `Shot description: ${prompt}`,
        chars.length
          ? `Characters in this shot (keep their appearance identical to the attached reference images):\n${chars.map((c: { info: string }) => `- ${c.info}`).join('\n')}`
          : '',
        storyContext ? `Story context (for mood and continuity only):\n${storyContext}` : '',
        'Photorealistic cinematic lighting, no text, no watermark, no subtitles.',
      ]
        .filter(Boolean)
        .join('\n\n');
      await reserve(req, 'image', projectId);
      const img = await opts.provider!.generateImage(fullPrompt, refs.slice(0, 8), aspectRatio);
      res.json({ sceneId, shotId, imageUrl: `data:${img.mimeType};base64,${img.base64}` });
    } catch (err) {
      aiFail(res, err, 'Shot image generation failed');
    }
  });

  // ---------- story analysis (text only; never starts image/video generation) ----------
  app.post('/api/story/analyze', jsonStory, requireProvider, async (req, res) => {
    try {
      const story = v.text('story', req.body?.story, LIMITS.story, { required: true });
      if (story.length < 40) throw new RequestError(400, 'The story is too short to analyze (at least 40 characters).', 'story_too_short');
      const style = v.text('style', req.body?.style, 300);
      const maxScenes = v.intInRange('maxScenes', req.body?.maxScenes, 1, 12);
      const shotsPerScene = v.intInRange('shotsPerScene', req.body?.shotsPerScene, 1, 8);
      await reserve(req, 'story');
      res.json(await analyzeStory(opts.provider!, story, { style, maxScenes, shotsPerScene }));
    } catch (err) {
      if (err instanceof PipelineError) {
        return res.status(422).json({
          error: `${err.message} Step: ${err.stage}. ${err.problems.slice(0, 3).join(' ')}`.trim(),
          code: 'story_analysis_invalid',
          stage: err.stage,
          problems: err.problems,
        });
      }
      aiFail(res, err, 'Story analysis failed');
    }
  });

  // ---------- video jobs (durable: Firestore) ----------
  const jobDeps = (): VideoJobDeps => ({
    provider: opts.provider!,
    jobs: opts.jobStore,
    blobs: store,
    pollIntervalMs: opts.videoJobs?.pollIntervalMs ?? 4000,
    queuedTimeoutMs: opts.videoJobs?.queuedTimeoutMs ?? 5 * 60_000,
    maxPollErrors: opts.videoJobs?.maxPollErrors ?? 5,
    mediaRoute: MEDIA_ROUTE,
    queue: opts.queue,
  });

  app.post('/api/generate/shot-video', jsonVideo, requireProvider, async (req, res) => {
    try {
      const b = req.body ?? {};
      const projectId = v.id('projectId', b.projectId, { required: true })!;
      const sceneId = v.id('sceneId', b.sceneId, { required: true })!;
      const shotId = v.id('shotId', b.shotId, { required: true })!;
      const prompt = v.text('prompt', b.prompt, LIMITS.prompt, { required: true });
      if (typeof b.idempotencyKey !== 'string' || !v.IDEMPOTENCY_RE.test(b.idempotencyKey)) {
        throw new RequestError(400, 'idempotencyKey is required (8-128 characters). The same key never starts a second job.', 'idempotency_key_required');
      }
      const frame = v.imageDataUrl('startImage', b.startImage, LIMITS.frameBytes);
      const aspectRatio = v.oneOf('aspectRatio', b.aspectRatio, v.ASPECT_RATIOS);
      const resolution = v.oneOf('resolution', b.resolution, v.RESOLUTIONS);
      const durationSec = v.intInRange('durationSec', b.durationSec, 1, 30);
      const retryOf = v.id('retryOf', b.retryOf);
      const out = await startVideoJob(jobDeps(), {
        uid: req.user!.uid,
        projectId,
        sceneId,
        shotId,
        linkedImageKey: v.sceneShotKey(b.linkedImageKey, `${sceneId}-${shotId}`),
        idempotencyKey: b.idempotencyKey,
        prompt,
        startFrame: frame,
        aspectRatio: aspectRatio === '9:16' || aspectRatio === '16:9' ? aspectRatio : undefined, // Veo supports only these
        resolution,
        durationSec,
        retryOf: retryOf ?? null,
        // Only a NEW job costs quota; a reused/duplicate request is free.
        reserve: () => reserve(req, 'video', projectId),
      });
      if (out.job.status === 'failed' && !out.reused) {
        return res.status(502).json({ ...publicJob(out.job), error: out.job.error?.message || 'Could not start video generation.' });
      }
      res.status(out.started ? 201 : 200).json({ ...publicJob(out.job), reused: out.reused ?? null });
    } catch (err) {
      aiFail(res, err, 'Could not start video generation');
    }
  });

  app.get('/api/generate/video-status/:id', requireProvider, async (req, res) => {
    try {
      const job = await advanceJob(jobDeps(), req.user!.uid, String(req.params.id));
      if (!job) return res.status(404).json({ error: 'Unknown video job. Generate this shot again.' });
      res.json(publicJob(job));
    } catch (err) {
      logError('video-status failed', err);
      res.status(500).json({ error: `Could not read the video job: ${safeErrorMessage(err)}` });
    }
  });

  app.post('/api/generate/video-cancel/:id', requireProvider, async (req, res) => {
    try {
      const jobBefore = await opts.jobStore.get(req.user!.uid, String(req.params.id));
      if (!jobBefore) return res.status(404).json({ error: 'Unknown video job.' });
      const job = await cancelJob(jobDeps(), req.user!.uid, jobBefore.id);
      res.json({ ...publicJob(job ?? jobBefore), note: 'The video provider cannot stop a request it already accepted; its result is discarded.' });
    } catch (err) {
      logError('video-cancel failed', err);
      res.status(500).json({ error: `Could not cancel: ${safeErrorMessage(err)}` });
    }
  });

  app.get('/api/generate/jobs', async (req, res) => {
    const projectId = String(req.query.projectId || '');
    if (!v.ID_RE.test(projectId)) return res.status(400).json({ error: 'projectId is required.' });
    try {
      res.json({ jobs: (await opts.jobStore.listByProject(req.user!.uid, projectId)).map(publicJob) });
    } catch (err) {
      logError('list jobs failed', err);
      res.status(500).json({ error: `Could not list jobs: ${safeErrorMessage(err)}` });
    }
  });

  // ---------- FFmpeg movie export ----------
  app.post('/api/export/mp4', jsonTiny, async (req, res) => {
    const { projectId, clips } = req.body ?? {};
    if (!projectId || !Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ error: 'projectId and clips[] (ordered by Scene/Shot) are required.' });
    }
    if (!(await checkFfmpeg(ffmpegPath))) return res.status(501).json({ error: 'FFmpeg is not installed on this server.' });
    const keys: string[] = [];
    for (const clip of clips) {
      const key = mediaKeyFromUrl(String(clip?.videoUrl || ''));
      if (!key || !ownsKey(req, key)) {
        return res.status(400).json({ error: `Clip ${clip?.sceneId}-${clip?.shotId} is not stored in your studio storage, so it cannot be assembled.` });
      }
      keys.push(key);
    }
    // Temporary work folder only; always removed. The result is saved to storage (GCS).
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mms-export-'));
    try {
      const files: string[] = [];
      for (const [i, key] of keys.entries()) {
        if (!(await store.stat(key))) return res.status(400).json({ error: `Clip file ${key} was not found in storage.` });
        const f = path.join(work, `clip_${String(i).padStart(3, '0')}${path.extname(key) || '.mp4'}`);
        await pipeline(store.read(key), fs.createWriteStream(f));
        files.push(f);
      }
      const listFile = path.join(work, 'list.txt');
      const outFile = path.join(work, 'movie.mp4');
      fs.writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      let result = await runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile]);
      if (!result.ok) {
        result = await runFfmpeg(ffmpegPath, [
          '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outFile,
        ]);
      }
      if (!result.ok) return res.status(500).json({ error: `FFmpeg failed: ${result.stderr.split('\n').slice(-3).join(' ')}` });
      const key = `${projectPrefix(req.user!.uid, projectId)}movies/movie_${randomUUID().slice(0, 8)}.mp4`;
      await store.putStream(key, fs.createReadStream(outFile), 'video/mp4');
      res.json({ jobId: path.basename(key, '.mp4'), statusUrl: '', downloadUrl: `${MEDIA_ROUTE}${key}`, clipCount: files.length });
    } catch (err) {
      fail(res, err, 'Movie export failed');
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

  // Body-parser / unexpected errors: always JSON, never a stack trace.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large for this operation.', code: 'payload_too_large' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'bad_json' });
    if (err instanceof RequestError) return res.status(err.status).json({ error: err.message, code: err.code });
    logError('Unhandled request error', err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    app.use(
      express.static(opts.staticDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
          // the service worker and the app shell must always be re-checked; hashed /assets files are immutable
          if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('offline.html')) res.setHeader('Cache-Control', 'no-cache');
          else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          if (filePath.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
        },
      })
    );
    app.get(/^(?!\/(api|health)).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  return app;
}
