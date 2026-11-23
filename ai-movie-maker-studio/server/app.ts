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
import { ConflictError, NotFoundError, ProjectStore } from './projectStore';
import { InlineImage, parseDataUrl, StudioAiProvider } from './provider';

export type AuthOptions =
  | {
      mode: 'google';
      googleClientId: string;
      verifier: IdTokenVerifier;
      sessionSecret: string;
      /** If set, only these Google accounts may sign in (protects the paid API). */
      allowedEmails?: string[];
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
  auth: AuthOptions;
  staticDir?: string;
  ffmpegPath?: string;
  /** Redirect /api/media to short-lived V4 signed GCS URLs (needs signBlob permission). */
  signedUrls?: boolean;
  crossSiteCookies?: boolean;
  warnings?: string[];
}

interface VideoJob {
  id: string;
  uid: string;
  projectId: string;
  sceneId: string;
  shotId: string;
  status: 'running' | 'completed' | 'failed';
  operation: unknown;
  videoUrl?: string;
  error?: string;
  startedAt: string;
  lastPolledAt: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

const MEDIA_ROUTE = '/api/media/';
const KINDS = new Set(['images', 'videos', 'zips', 'movies', 'assets', 'files']);

function extFor(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('zip')) return 'zip';
  if (mime.includes('json')) return 'json';
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
  const app = express();
  const ffmpegPath = opts.ffmpegPath || 'ffmpeg';
  const jobs = new Map<string, VideoJob>();
  const store = opts.blobStore;
  const auth = opts.auth;

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-studio-token, x-requested-with');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  // ---------- identity ----------
  const attachUser = (req: Request, _res: Response, next: NextFunction) => {
    if (auth.mode === 'google') {
      const u = verifySession(readCookie(req, SESSION_COOKIE), auth.sessionSecret);
      if (u) req.user = u;
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

  const ownsKey = (req: Request, key: string) => isSafeKey(key) && key.startsWith(userPrefix(req.user!.uid));

  const fail = (res: Response, err: unknown, fallback: string) => {
    if (err instanceof ConflictError) return res.status(409).json({ error: err.message, cloudRevision: err.cloudRevision });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    console.error(fallback, err);
    return res.status(500).json({ error: `${fallback}: ${err instanceof Error ? err.message : 'unknown error'}` });
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
  const json = express.json({ limit: '60mb' });

  app.post('/api/auth/session', json, async (req, res) => {
    if (auth.mode !== 'google') return res.status(503).json({ error: 'Sign-in is not configured on this server.' });
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || credential.length < 10) return res.status(400).json({ error: 'credential is required.' });
    try {
      const user = await auth.verifier(credential);
      if (auth.allowedEmails?.length && !auth.allowedEmails.includes(user.email)) {
        return res.status(403).json({ error: `${user.email} is not allowed on this studio server.` });
      }
      const secure = req.secure || req.header('x-forwarded-proto') === 'https';
      res.setHeader('Set-Cookie', sessionCookie(signSession(user, auth.sessionSecret), { secure, crossSite: Boolean(opts.crossSiteCookies) }));
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
    res.setHeader('Set-Cookie', sessionCookie('', { secure: req.secure, crossSite: Boolean(opts.crossSiteCookies), clear: true }));
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
      res.setHeader('Content-Type', info.contentType);
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

  const saveMedia = async (uid: string, projectId: string, kind: string, baseName: string, bytes: Uint8Array, mime: string) => {
    const key = `${projectPrefix(uid, projectId)}${kind}/${safeSegment(baseName)}_${randomUUID().slice(0, 8)}.${extFor(mime)}`;
    await store.put(key, bytes, mime);
    return `${MEDIA_ROUTE}${key}`;
  };

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
      return res.status(400).json({ error: 'Body must be { project } with a project id.' });
    }
    if (mode === 'update' && project.id !== id) return res.status(400).json({ error: 'project.id does not match the URL.' });
    try {
      const uid = req.user!.uid;
      const clean = (await externalizeMedia(uid, id, project)) as Record<string, unknown>;
      const meta = await opts.projectStore!.save(uid, id, clean, {
        mode,
        baseRevision: typeof req.body.baseRevision === 'number' ? req.body.baseRevision : undefined,
        force: req.body.force === true,
      });
      res.status(mode === 'create' ? 201 : 200).json({ meta, project: clean, syncedAt: meta.updatedAt });
    } catch (err) {
      fail(res, err, 'Saving project failed');
    }
  };
  projectRouter.post('/', json, saveHandler('create'));
  projectRouter.put('/:id', json, saveHandler('update'));

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
          .filter((f) => !f.key.endsWith('/project.json'))
          .map((f) => ({ ...f, url: `${MEDIA_ROUTE}${f.key}`, name: path.basename(f.key), kind: f.key.split('/')[4] })),
      });
    } catch (err) {
      fail(res, err, 'Listing files failed');
    }
  });

  app.post('/api/storage/upload-url', json, async (req, res) => {
    const { projectId, kind, filename, contentType } = req.body ?? {};
    if (!projectId || !KINDS.has(String(kind))) return res.status(400).json({ error: 'projectId and a valid kind are required.' });
    const type = String(contentType || 'application/octet-stream');
    const base = safeSegment(String(filename || 'file').replace(/\.[^.]+$/, ''));
    const key = `${projectPrefix(req.user!.uid, projectId)}${kind}/${base}_${randomUUID().slice(0, 8)}.${extFor(type) === 'bin' ? safeSegment(String(filename).split('.').pop(), 'bin') : extFor(type)}`;
    try {
      if (opts.signedUrls && store.signedUploadUrl) {
        // Direct browser → GCS upload (no 32 MB Cloud Run request limit). Bucket needs CORS (deploy/cors.json).
        const url = await store.signedUploadUrl(key, type, 15 * 60);
        return res.json({ key, method: 'PUT', url, headers: { 'Content-Type': type }, direct: true, mediaUrl: `${MEDIA_ROUTE}${key}` });
      }
      res.json({ key, method: 'PUT', url: `/api/storage/upload/${key}`, headers: { 'Content-Type': type }, direct: false, mediaUrl: `${MEDIA_ROUTE}${key}` });
    } catch (err) {
      fail(res, err, 'Could not prepare upload');
    }
  });

  // Upload through the server (≤ 30 MB, Cloud Run's request limit is 32 MB).
  app.put(/^\/api\/storage\/upload\/(.+)$/, express.raw({ type: () => true, limit: '30mb' }), async (req, res) => {
    const key = decodeURIComponent(String((req.params as Record<string, string>)[0] || ''));
    if (!ownsKey(req, key)) return res.status(403).json({ error: 'You can only upload into your own projects.' });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Empty upload.' });
    try {
      await store.put(key, body, String(req.headers['content-type'] || 'application/octet-stream'));
      res.status(201).json({ key, url: `${MEDIA_ROUTE}${key}`, size: body.length });
    } catch (err) {
      fail(res, err, 'Upload failed');
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

  // ---------- AI ----------
  const collectImages = (list: unknown, max: number): InlineImage[] => {
    if (!Array.isArray(list)) return [];
    const out: InlineImage[] = [];
    for (const item of list) {
      const parsed = typeof item === 'string' ? parseDataUrl(item) : null;
      if (parsed) out.push(parsed);
      if (out.length >= max) break;
    }
    return out;
  };

  app.post('/api/chat', json, requireProvider, async (req, res) => {
    const { message, history, materialsBundle, projectTitle } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required.' });
    try {
      const sys = [
        CHAT_SYSTEM_PROMPT,
        projectTitle ? `Project title: ${projectTitle}` : '',
        typeof materialsBundle === 'string' && materialsBundle.trim()
          ? `Latest Project Materials Bundle sent by the user:\n${materialsBundle.slice(0, 60000)}`
          : 'The user has not sent a Project Materials Bundle yet.',
      ]
        .filter(Boolean)
        .join('\n\n');
      const turns = Array.isArray(history)
        ? history.filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string').slice(-12)
        : [];
      res.json({ replyText: await opts.provider!.generateText(sys, turns, message) });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Gemini chat failed.' });
    }
  });

  app.post('/api/generate-character-ref', json, requireProvider, async (req, res) => {
    const { characterInfo, slot, prompt, referenceImages } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'prompt is required.' });
    const slotText: Record<string, string> = {
      face: 'a close-up face portrait (head and shoulders), neutral expression, even studio light',
      front: 'a full-body FRONT view, standing straight, head to toe visible, plain neutral background',
      side: 'a full-body SIDE profile view, head to toe visible, plain neutral background',
      back: 'a full-body BACK view, head to toe visible, plain neutral background',
    };
    const refs = collectImages(referenceImages, 3);
    const fullPrompt = [
      `Character reference sheet image: ${slotText[String(slot)] || 'character reference'}.`,
      characterInfo ? `Character details:\n${String(characterInfo).slice(0, 4000)}` : '',
      `Instructions: ${prompt}`,
      refs.length ? 'Keep the exact same person (face, hair, body, clothing) as in the attached reference image(s).' : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const img = await opts.provider!.generateImage(fullPrompt, refs, slot === 'face' ? '1:1' : '3:4');
      res.json({ imageUrl: `data:${img.mimeType};base64,${img.base64}`, filename: `${safeSegment(slot, 'ref')}_generated.${extFor(img.mimeType)}` });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Image generation failed.' });
    }
  });

  app.post('/api/generate/shot-image', json, requireProvider, async (req, res) => {
    const { sceneId, shotId, prompt, storyContext, characters, aspectRatio } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'prompt is required.' });
    const chars = Array.isArray(characters) ? characters.slice(0, 4) : [];
    const refs: InlineImage[] = [];
    for (const c of chars) refs.push(...collectImages(c?.referenceImages, 3));
    const fullPrompt = [
      `Cinematic film still for Scene ${safeSegment(sceneId)} / Shot ${safeSegment(shotId)}.`,
      `Shot description: ${prompt}`,
      chars.length
        ? `Characters in this shot (keep their appearance identical to the attached reference images):\n${chars
            .map((c) => `- ${String(c?.info || '').slice(0, 1500)}`)
            .join('\n')}`
        : '',
      typeof storyContext === 'string' && storyContext.trim() ? `Story context (for mood and continuity only):\n${storyContext.slice(0, 3000)}` : '',
      'Photorealistic cinematic lighting, no text, no watermark, no subtitles.',
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const img = await opts.provider!.generateImage(fullPrompt, refs.slice(0, 8), aspectRatio);
      res.json({ sceneId, shotId, imageUrl: `data:${img.mimeType};base64,${img.base64}` });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Shot image generation failed.' });
    }
  });

  app.post('/api/generate/shot-video', json, requireProvider, async (req, res) => {
    const { projectId, sceneId, shotId, prompt, startImage, aspectRatio, resolution, durationSec } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'prompt is required.' });
    const frame = typeof startImage === 'string' ? parseDataUrl(startImage) : null;
    if (!frame) return res.status(400).json({ error: 'startImage (the shot image as a data URL) is required for image-to-video.' });
    try {
      const operation = await opts.provider!.startVideo({
        prompt,
        startFrame: frame,
        aspectRatio: aspectRatio === '9:16' ? '9:16' : aspectRatio === '16:9' ? '16:9' : undefined,
        resolution,
        durationSeconds: Number(durationSec) || undefined,
      });
      const job: VideoJob = {
        id: `vjob_${randomUUID()}`,
        uid: req.user!.uid,
        projectId: safeSegment(projectId, 'project'),
        sceneId: safeSegment(sceneId),
        shotId: safeSegment(shotId),
        status: 'running',
        operation,
        startedAt: new Date().toISOString(),
        lastPolledAt: 0,
      };
      jobs.set(job.id, job);
      res.json({ jobId: job.id, status: job.status });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Could not start video generation.' });
    }
  });

  app.get('/api/generate/video-status/:id', requireProvider, async (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.uid !== req.user!.uid) {
      return res.status(410).json({ error: 'Unknown video job (the server may have restarted). Generate this shot again.' });
    }
    if (job.status === 'running' && Date.now() - job.lastPolledAt > 4000) {
      job.lastPolledAt = Date.now();
      try {
        const { operation, result } = await opts.provider!.pollVideo(job.operation);
        job.operation = operation;
        if (result.done && result.ok) {
          const bytes = result.video.bytes ?? (await opts.provider!.fetchVideoUri(result.video.uri!));
          job.videoUrl = await saveMedia(job.uid, job.projectId, 'videos', `${job.sceneId}_${job.shotId}`, bytes, result.video.mimeType);
          job.status = 'completed';
        } else if (result.done && !result.ok) {
          job.status = 'failed';
          job.error = result.error;
        }
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : 'Video status check failed.';
      }
    }
    res.json({ jobId: job.id, status: job.status, videoUrl: job.videoUrl, error: job.error, startedAt: job.startedAt });
  });

  // ---------- FFmpeg movie export ----------
  app.post('/api/export/mp4', json, async (req, res) => {
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

  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/(api|health)).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  return app;
}
