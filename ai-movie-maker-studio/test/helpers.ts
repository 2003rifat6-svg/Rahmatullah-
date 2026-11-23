/**
 * TEST-ONLY helpers. The stub provider below is never used by the real server
 * (server/index.ts always uses the Gemini provider or none at all).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { createApp } from '../server/app';
import type { StudioAiProvider } from '../server/provider';

// 1x1 PNG
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function makeTestClip(dir: string, name: string, color: string): string {
  const file = path.join(dir, name);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:d=1:r=24`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file,
  ]);
  return file;
}

export function createStubProvider(clipFile: string) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  let polls = 0;
  const provider: StudioAiProvider = {
    models: { text: 'stub-text', image: 'stub-image', video: 'stub-video' },
    async generateText(system, history, message) {
      calls.push({ fn: 'generateText', args: { system, history, message } });
      return `stub reply to: ${message}`;
    },
    async generateImage(prompt, references, aspectRatio) {
      calls.push({ fn: 'generateImage', args: { prompt, refs: references.length, aspectRatio } });
      return { mimeType: 'image/png', base64: TINY_PNG_BASE64 };
    },
    async startVideo(req) {
      calls.push({ fn: 'startVideo', args: { prompt: req.prompt, hasFrame: Boolean(req.startFrame) } });
      return { name: 'op-1' };
    },
    async pollVideo(op) {
      polls += 1;
      if (polls < 2) return { operation: op, result: { done: false } };
      return {
        operation: op,
        result: { done: true, ok: true, video: { bytes: fs.readFileSync(clipFile), mimeType: 'video/mp4' } },
      };
    },
    async fetchVideoUri() {
      throw new Error('not used');
    },
  };
  return { provider, calls, resetPolls: () => (polls = 0) };
}

export function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * TEST-ONLY Google ID token verifier: credential "test:<uid>:<email>".
 * The real server always uses googleIdTokenVerifier (server/auth.ts).
 */
export const testVerifier = async (credential: string) => {
  const [prefix, uid, email] = credential.split(':');
  if (prefix !== 'test' || !uid || !email) throw new Error('bad test credential');
  return { uid, email };
};

export const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef-xyz';

export function listen(app: ReturnType<typeof createApp>) {
  return new Promise<{ base: string; close: () => void }>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
  });
}

