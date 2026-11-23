/** Input validation for API requests. Every failure is a clear 400 message for the user. */
import { InlineImage } from './provider';
import { sniffFamily } from './uploads';

export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'bad_request'
  ) {
    super(message);
  }
}

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const IDEMPOTENCY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export const RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export const LIMITS = {
  prompt: 4000,
  characterInfo: 4000,
  storyContext: 3000,
  story: 60000,
  chatMessage: 4000,
  chatHistoryItems: 12,
  bundle: 60000,
  title: 200,
  imagesPerRequest: 12,
  imageBytes: 4 * 1024 * 1024,
  frameBytes: 8 * 1024 * 1024,
} as const;

// control characters except tab / newline / carriage return
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function text(name: string, v: unknown, max: number, opts: { required?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new RequestError(400, `${name} is required.`);
    return '';
  }
  if (typeof v !== 'string') throw new RequestError(400, `${name} must be text.`);
  const t = v.trim();
  if (opts.required && !t) throw new RequestError(400, `${name} is required.`);
  if (t.length > max) throw new RequestError(400, `${name} is too long (max ${max} characters).`, 'too_long');
  if (CONTROL.test(t)) throw new RequestError(400, `${name} contains invalid control characters.`);
  return t;
}

export function id(name: string, v: unknown, opts: { required?: boolean } = {}): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new RequestError(400, `${name} is required.`);
    return undefined;
  }
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new RequestError(400, `${name} may only contain letters, digits, _ and - (max 64).`);
  return v;
}

export function oneOf<T extends string>(name: string, v: unknown, allowed: readonly T[], opts: { required?: boolean } = {}): T | undefined {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new RequestError(400, `${name} is required.`);
    return undefined;
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new RequestError(400, `${name} must be one of: ${allowed.join(', ')}.`);
  return v as T;
}

export function intInRange(name: string, v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new RequestError(400, `${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** A data: URL holding a real PNG/JPEG/WebP (checked by file signature), within the size limit. */
export function imageDataUrl(name: string, v: unknown, maxBytes: number): InlineImage {
  if (typeof v !== 'string') throw new RequestError(400, `${name} must be an image data URL.`);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(v);
  if (!m) throw new RequestError(400, `${name} must be a PNG, JPEG or WebP image (data URL).`, 'bad_image');
  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > maxBytes) throw new RequestError(413, `${name} is too large (max ${Math.round(maxBytes / 1048576)} MB).`, 'payload_too_large');
  const bytes = Buffer.from(m[2], 'base64');
  const family = sniffFamily(bytes.subarray(0, 16));
  const expected = m[1] === 'image/png' ? 'png' : m[1] === 'image/jpeg' ? 'jpeg' : 'webp';
  if (family !== expected) throw new RequestError(415, `${name} is not a valid ${expected.toUpperCase()} image.`, 'bad_image');
  return { mimeType: m[1], base64: m[2].replace(/[\r\n]/g, '') };
}

export function imageDataUrls(name: string, v: unknown, maxCount: number, maxBytes: number): InlineImage[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new RequestError(400, `${name} must be a list of images.`);
  if (v.length > maxCount) throw new RequestError(400, `${name}: at most ${maxCount} images.`);
  return v.map((x, i) => imageDataUrl(`${name}[${i}]`, x, maxBytes));
}

export interface ChatTurnInput {
  role: 'user' | 'assistant';
  text: string;
}

export function chatHistory(v: unknown): ChatTurnInput[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new RequestError(400, 'history must be a list.');
  return v
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .slice(-LIMITS.chatHistoryItems)
    .map((h) => ({ role: h.role, text: text('history text', h.text, LIMITS.chatMessage) }));
}

export function sceneShotKey(v: unknown, fallback: string): string {
  if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v.replace(/-/g, '_').replace(/_+/g, '_'))) return v.slice(0, 40);
  return fallback;
}
