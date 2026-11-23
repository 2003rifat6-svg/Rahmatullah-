/**
 * AI Movie Maker Studio — backend API (Express).
 *
 * Endpoints (all JSON):
 *   GET  /health                         -> backend + Gemini + FFmpeg status
 *   POST /api/chat                       -> Main Chat reply (Gemini text model)
 *   POST /api/generate-character-ref     -> one character reference image
 *   POST /api/generate/shot-image        -> one shot image (uses character refs)
 *   POST /api/generate/shot-video        -> starts one image-to-video job (Veo)
 *   GET  /api/generate/video-status/:id  -> real status of that job
 *   POST /api/export/mp4                 -> FFmpeg concat of generated clips
 *   /api/projects*, /api/storage/upload  -> 501 (cloud sync not implemented)
 *
 * No endpoint ever returns placeholder media. If GEMINI_API_KEY is missing the
 * generation endpoints answer 503 with a clear message.
 */
import express, { NextFunction, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { InlineImage, parseDataUrl, StudioAiProvider } from './provider';

export interface AppOptions {
  provider: StudioAiProvider | null;
  mediaDir: string;
  staticDir?: string;
  accessToken?: string;
  ffmpegPath?: string;
}

interface VideoJob {
  id: string;
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

const SAFE = (s: unknown, fallback = 'x') =>
  String(s ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || fallback;

function extFor(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('mp4')) return 'mp4';
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

const CHAT_SYSTEM_PROMPT = `You are the production assistant inside "AI Movie Maker Studio", a mobile app for making AI short films.
The user prepares Story, Characters (with Face / Front / Side / Back reference images), Image Prompts and Video Prompts (each identified by Scene ID and Shot ID), and Production Settings.
When a "Project Materials Bundle" is provided, treat it as the single source of truth: check story/character/prompt consistency, point out missing or mismatched Scene/Shot IDs, and suggest concrete prompt improvements.
Never claim that an image or video has been generated — generation only happens when the user presses the Generate buttons in the app.
Reply in the user's language (Bengali or English). Be concise and practical.`;

export function createApp(opts: AppOptions) {
  const app = express();
  const ffmpegPath = opts.ffmpegPath || 'ffmpeg';
  const jobs = new Map<string, VideoJob>();
  fs.mkdirSync(opts.mediaDir, { recursive: true });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '60mb' }));

  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-studio-token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    if (!opts.accessToken) return next();
    if (req.header('x-studio-token') === opts.accessToken) return next();
    res.status(401).json({ error: 'Missing or wrong studio access token (set it in Cloud Settings).' });
  };

  const requireProvider = (_req: Request, res: Response, next: NextFunction) => {
    if (opts.provider) return next();
    res.status(503).json({
      error:
        'GEMINI_API_KEY is not set on the server. AI generation is disabled until the server owner adds a key (it is a paid Google API).',
      notConfigured: true,
    });
  };

  const saveMedia = (projectId: string, baseName: string, bytes: Uint8Array, mime: string) => {
    const dir = path.join(opts.mediaDir, SAFE(projectId, 'project'));
    fs.mkdirSync(dir, { recursive: true });
    const file = `${SAFE(baseName)}_${randomUUID().slice(0, 8)}.${extFor(mime)}`;
    fs.writeFileSync(path.join(dir, file), bytes);
    return `/media/${SAFE(projectId, 'project')}/${file}`;
  };

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

  app.get('/health', async (_req, res) => {
    res.json({
      ok: true,
      service: 'ai-movie-maker-studio-backend',
      geminiConfigured: Boolean(opts.provider),
      models: opts.provider?.models ?? null,
      ffmpegAvailable: await checkFfmpeg(ffmpegPath),
      accessTokenRequired: Boolean(opts.accessToken),
    });
  });

  app.use('/media', express.static(opts.mediaDir, { fallthrough: false, maxAge: '1h' }));

  app.use('/api', requireToken);

  app.post('/api/chat', requireProvider, async (req, res) => {
    const { message, history, materialsBundle, projectTitle } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required.' });
    }
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
        ? history
            .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
            .slice(-12)
        : [];
      const replyText = await opts.provider!.generateText(sys, turns, message);
      res.json({ replyText });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Gemini chat failed.' });
    }
  });

  app.post('/api/generate-character-ref', requireProvider, async (req, res) => {
    const { characterInfo, slot, prompt, referenceImages } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required.' });
    }
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
      res.json({
        imageUrl: `data:${img.mimeType};base64,${img.base64}`,
        filename: `${SAFE(slot, 'ref')}_generated.${extFor(img.mimeType)}`,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Image generation failed.' });
    }
  });

  app.post('/api/generate/shot-image', requireProvider, async (req, res) => {
    const { sceneId, shotId, prompt, storyContext, characters, aspectRatio } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required.' });
    }
    const chars = Array.isArray(characters) ? characters.slice(0, 4) : [];
    const refs: InlineImage[] = [];
    for (const c of chars) refs.push(...collectImages(c?.referenceImages, 3));
    const fullPrompt = [
      `Cinematic film still for Scene ${SAFE(sceneId)} / Shot ${SAFE(shotId)}.`,
      `Shot description: ${prompt}`,
      chars.length
        ? `Characters in this shot (keep their appearance identical to the attached reference images):\n${chars
            .map((c) => `- ${String(c?.info || '').slice(0, 1500)}`)
            .join('\n')}`
        : '',
      typeof storyContext === 'string' && storyContext.trim()
        ? `Story context (for mood and continuity only):\n${storyContext.slice(0, 3000)}`
        : '',
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

  app.post('/api/generate/shot-video', requireProvider, async (req, res) => {
    const { projectId, sceneId, shotId, prompt, startImage, aspectRatio, resolution, durationSec } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required.' });
    }
    const frame = typeof startImage === 'string' ? parseDataUrl(startImage) : null;
    if (!frame) {
      return res.status(400).json({ error: 'startImage (the shot image as a data URL) is required for image-to-video.' });
    }
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
        projectId: SAFE(projectId, 'project'),
        sceneId: SAFE(sceneId),
        shotId: SAFE(shotId),
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
    if (!job) {
      return res.status(410).json({ error: 'Unknown video job (the server may have restarted). Generate this shot again.' });
    }
    if (job.status === 'running' && Date.now() - job.lastPolledAt > 4000) {
      job.lastPolledAt = Date.now();
      try {
        const { operation, result } = await opts.provider!.pollVideo(job.operation);
        job.operation = operation;
        if (result.done && result.ok) {
          const bytes = result.video.bytes ?? (await opts.provider!.fetchVideoUri(result.video.uri!));
          job.videoUrl = saveMedia(job.projectId, `${job.sceneId}_${job.shotId}`, bytes, result.video.mimeType);
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

  app.post('/api/export/mp4', async (req, res) => {
    const { projectId, clips } = req.body ?? {};
    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ error: 'clips[] is required (ordered by Scene/Shot).' });
    }
    if (!(await checkFfmpeg(ffmpegPath))) {
      return res.status(501).json({ error: 'FFmpeg is not installed on this server.' });
    }
    const files: string[] = [];
    for (const clip of clips) {
      let p = '';
      try {
        p = new URL(String(clip?.videoUrl || ''), 'http://local').pathname;
      } catch {
        p = '';
      }
      if (!p.startsWith('/media/')) {
        return res.status(400).json({
          error: `Clip ${clip?.sceneId}-${clip?.shotId} is not stored on this server, so it cannot be assembled.`,
        });
      }
      const abs = path.resolve(opts.mediaDir, decodeURIComponent(p.slice('/media/'.length)));
      if (!abs.startsWith(path.resolve(opts.mediaDir) + path.sep) || !fs.existsSync(abs)) {
        return res.status(400).json({ error: `Clip file for ${clip?.sceneId}-${clip?.shotId} was not found on the server.` });
      }
      files.push(abs);
    }
    const dir = path.join(opts.mediaDir, SAFE(projectId, 'project'));
    fs.mkdirSync(dir, { recursive: true });
    const id = randomUUID().slice(0, 8);
    const listFile = path.join(dir, `concat_${id}.txt`);
    const outName = `movie_${id}.mp4`;
    const outFile = path.join(dir, outName);
    fs.writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    let result = await runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile]);
    if (!result.ok) {
      // Clips with different encodings: re-encode video and audio.
      result = await runFfmpeg(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', outFile,
      ]);
    }
    fs.rmSync(listFile, { force: true });
    if (!result.ok) {
      return res.status(500).json({ error: `FFmpeg failed: ${result.stderr.split('\n').slice(-3).join(' ')}` });
    }
    res.json({ jobId: id, statusUrl: '', downloadUrl: `/media/${SAFE(projectId, 'project')}/${outName}`, clipCount: files.length });
  });

  const notImplemented = (_req: Request, res: Response) =>
    res.status(501).json({ error: 'Cloud project sync / storage is not implemented on this backend. Projects are saved in the browser.' });
  app.all('/api/projects', notImplemented);
  app.all('/api/projects/:id', notImplemented);
  app.all('/api/storage/upload', notImplemented);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/(api|media|health)).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  return app;
}
