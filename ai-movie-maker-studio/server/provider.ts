/**
 * AI provider used by the studio backend.
 *
 * The Gemini API key is read ONLY from the server environment (GEMINI_API_KEY).
 * It is never sent to, or stored in, the browser app.
 *
 * Gemini / Veo calls are paid Google services. Nothing here runs on its own:
 * every call is triggered by an explicit user action in the app, and the
 * provider is not created at all when GEMINI_API_KEY is missing.
 */
import { GenerateVideosOperation, GoogleGenAI } from '@google/genai';

export interface InlineImage {
  mimeType: string;
  base64: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface TextOptions {
  /** Ask the model for a JSON document (responseMimeType application/json). */
  json?: boolean;
  maxOutputTokens?: number;
}

export interface VideoStartRequest {
  prompt: string;
  startFrame?: InlineImage;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
}

export type VideoPollResult =
  | { done: false }
  | { done: true; ok: true; video: { bytes?: Uint8Array; uri?: string; mimeType: string } }
  | { done: true; ok: false; error: string };

export interface StudioAiProvider {
  readonly models: { text: string; image: string; video: string };
  generateText(systemInstruction: string, history: ChatTurn[], message: string, opts?: TextOptions): Promise<string>;
  generateImage(prompt: string, references: InlineImage[], aspectRatio?: string): Promise<InlineImage>;
  /** Starts a long-running video operation. The returned name is stored in the durable job. */
  startVideo(req: VideoStartRequest): Promise<{ operationName: string }>;
  /** Looks up a stored operation by name (works after a server restart). */
  pollVideo(operationName: string): Promise<VideoPollResult>;
  /** Downloads a provider-hosted video URI (needs the server-side key). */
  fetchVideoUri(uri: string): Promise<Uint8Array>;
}

export function parseDataUrl(dataUrl: string): InlineImage | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

export function createGeminiProvider(env: NodeJS.ProcessEnv = process.env): StudioAiProvider | null {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;

  const ai = new GoogleGenAI({ apiKey });
  const models = {
    text: env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
    image: env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    video: env.GEMINI_VIDEO_MODEL || 'veo-3.0-generate-001',
  };

  return {
    models,

    async generateText(systemInstruction, history, message, opts) {
      const contents = [
        ...history.map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }],
        })),
        { role: 'user', parts: [{ text: message }] },
      ];
      const res = await ai.models.generateContent({
        model: models.text,
        contents,
        config: {
          systemInstruction,
          ...(opts?.json ? { responseMimeType: 'application/json' } : {}),
          ...(opts?.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
        },
      });
      const text = res.text?.trim();
      if (!text) throw new Error('Gemini returned an empty reply.');
      return text;
    },

    async generateImage(prompt, references, aspectRatio) {
      const parts: Array<Record<string, unknown>> = references.map((r) => ({
        inlineData: { mimeType: r.mimeType, data: r.base64 },
      }));
      parts.push({ text: prompt });
      const res = await ai.models.generateContent({
        model: models.image,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
          ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
        },
      });
      for (const cand of res.candidates ?? []) {
        for (const part of cand.content?.parts ?? []) {
          const data = part.inlineData?.data;
          if (data) {
            return { mimeType: part.inlineData?.mimeType || 'image/png', base64: data };
          }
        }
      }
      const reason = res.promptFeedback?.blockReason || res.candidates?.[0]?.finishReason;
      throw new Error(`Image model returned no image${reason ? ` (${reason})` : ''}.`);
    },

    async startVideo(req) {
      const op = await ai.models.generateVideos({
        model: models.video,
        prompt: req.prompt,
        ...(req.startFrame
          ? { image: { imageBytes: req.startFrame.base64, mimeType: req.startFrame.mimeType } }
          : {}),
        config: {
          numberOfVideos: 1,
          ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
          ...(req.resolution ? { resolution: req.resolution } : {}),
          ...(req.durationSeconds ? { durationSeconds: req.durationSeconds } : {}),
        },
      });
      if (!op.name) throw new Error('Video provider did not return an operation name.');
      return { operationName: op.name };
    },

    async pollVideo(operationName): Promise<VideoPollResult> {
      // The SDK only needs the operation name to look the operation up again.
      const handle = new GenerateVideosOperation();
      handle.name = operationName;
      const op = await ai.operations.getVideosOperation({ operation: handle });
      if (!op.done) return { done: false };
      if (op.error) {
        return { done: true, ok: false, error: String(op.error.message || JSON.stringify(op.error)) };
      }
      const vid = op.response?.generatedVideos?.[0]?.video;
      if (!vid || (!vid.videoBytes && !vid.uri)) {
        const reasons = op.response?.raiMediaFilteredReasons?.join('; ');
        return { done: true, ok: false, error: `Video model returned no video${reasons ? ` (filtered: ${reasons})` : ''}.` };
      }
      return {
        done: true,
        ok: true,
        video: {
          bytes: vid.videoBytes ? Buffer.from(vid.videoBytes, 'base64') : undefined,
          uri: vid.uri,
          mimeType: vid.mimeType || 'video/mp4',
        },
      };
    },

    async fetchVideoUri(uri) {
      const res = await fetch(uri, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) throw new Error(`Video download failed with HTTP ${res.status}.`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
