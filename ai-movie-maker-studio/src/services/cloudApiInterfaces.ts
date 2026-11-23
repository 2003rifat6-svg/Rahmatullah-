import type { StoryPlan, StoryPlanMeta } from '../types/storyPlan';
import type { ServerJob } from '../utils/jobRecovery';
import {
  AspectRatio,
  CharacterRefSlotKey,
  ChatMessage,
  CloudBackendSettings,
  MovieProject,
  SupportedResolution,
} from '../types/studio';

/**
 * Phase 2 Backend Service Interfaces & HTTP Client Wrappers.
 * NOTE: All Gemini API keys, Vertex AI credentials, Firestore admin access,
 * and GCS signing keys MUST reside exclusively on the Google Cloud Run FastAPI backend.
 * Zero secrets or paid API calls live in this frontend client.
 */

export interface BackendCallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  httpStatus?: number;
  requiresBackendSetup?: boolean;
  notImplemented?: boolean;
}

export interface IAiChatAssistantService {
  readonly mode: 'phase1_local_commands' | 'phase2_cloud_gemini';
  sendProjectChatTurn(
    cloud: CloudBackendSettings,
    project: MovieProject,
    userMessage: string,
    history?: ChatMessage[]
  ): Promise<
    BackendCallResult<{
      replyText: string;
      suggestedAction?: string;
    }>
  >;
}

export interface IImageGenerationService {
  generateCharacterReference(
    cloud: CloudBackendSettings,
    payload: {
      characterInfo: string;
      slot: CharacterRefSlotKey;
      prompt: string;
      referenceImages?: string[];
    }
  ): Promise<BackendCallResult<{ imageUrl: string; filename: string }>>;

  generateShotImage(
    cloud: CloudBackendSettings,
    payload: ShotImageRequest
  ): Promise<BackendCallResult<{ imageUrl: string }>>;
}

export interface ShotImageRequest {
  projectId: string;
  sceneId: string;
  shotId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  storyContext?: string;
  characters: Array<{ name: string; info: string; referenceImages: string[] }>;
}

export interface ShotVideoRequest {
  projectId: string;
  sceneId: string;
  shotId: string;
  prompt: string;
  /** Data URL of the shot image used as the first frame (image-to-video). */
  startImage: string;
  /** Scene-Shot key of the image this video is made from (e.g. "S01-SH02"). */
  linkedImageKey: string;
  /** New for every deliberate click. The server never starts a second job for the same key. */
  idempotencyKey: string;
  /** Id of the failed job this run retries (optional). */
  retryOf?: string;
  aspectRatio: AspectRatio;
  resolution: SupportedResolution;
  durationSec: number;
}

export interface VideoJobStatus {
  jobId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  videoUrl?: string;
  error?: string;
  /** Set when the server returned an existing job instead of starting a new one. */
  reused?: 'idempotent' | 'active' | null;
}

export interface IVideoGenerationService {
  startShotVideo(
    cloud: CloudBackendSettings,
    payload: ShotVideoRequest
  ): Promise<BackendCallResult<{ jobId: string; reused?: 'idempotent' | 'active' | null }>>;
  getVideoJobStatus(
    cloud: CloudBackendSettings,
    jobId: string
  ): Promise<BackendCallResult<VideoJobStatus>>;
  cancelVideoJob(
    cloud: CloudBackendSettings,
    jobId: string
  ): Promise<BackendCallResult<VideoJobStatus>>;
  listJobs(
    cloud: CloudBackendSettings,
    projectId: string
  ): Promise<BackendCallResult<{ jobs: ServerJob[] }>>;
}

export interface IFfmpegExportService {
  requestCompleteMovieMp4(
    cloud: CloudBackendSettings,
    project: MovieProject,
    options: {
      aspectRatio: AspectRatio;
      resolution: SupportedResolution;
      clips: Array<{ sceneId: string; shotId: string; videoUrl: string }>;
    }
  ): Promise<BackendCallResult<{ jobId: string; statusUrl: string; downloadUrl?: string }>>;
}

function assertBackendConnected(
  cloud: CloudBackendSettings
): { ok: true; baseUrl: string } | { ok: false; error: string } {
  const cleanUrl = cloud.backendUrl.trim().replace(/\/+$/, '');
  if (!cleanUrl) {
    return {
      ok: false,
      error:
        'Google Cloud Run FastAPI backend URL is not configured. Configure and verify /health in Cloud Settings first.',
    };
  }
  try {
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ok: false,
        error: 'Cloud Backend URL must use http:// or https://.',
      };
    }
  } catch {
    return {
      ok: false,
      error: 'Invalid Cloud Backend URL format.',
    };
  }
  if (cloud.status !== 'connected') {
    return {
      ok: false,
      error:
        'Google Cloud Run backend is not connected or /health check has not passed yet.',
    };
  }
  return { ok: true, baseUrl: cleanUrl };
}

/** All backend calls send the session cookie (Google sign-in) and the CSRF header. */
const fetch = (input: string, init: RequestInit = {}) => globalThis.fetch(input, { credentials: 'include', ...init });

function jsonHeaders(cloud: CloudBackendSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'mms' };
  if (cloud.accessToken?.trim()) h['x-studio-token'] = cloud.accessToken.trim();
  return h;
}

export function authHeaders(cloud: CloudBackendSettings): Record<string, string> {
  const h: Record<string, string> = { 'X-Requested-With': 'mms' };
  if (cloud.accessToken?.trim()) h['x-studio-token'] = cloud.accessToken.trim();
  return h;
}

/** Turns a server-relative media path ("/media/...") into an absolute URL on the backend. */
export { jsonHeaders };

export function resolveBackendUrl(cloud: CloudBackendSettings, url: string): string {
  if (!url || /^(data:|blob:|https?:)/.test(url)) return url;
  const base = cloud.backendUrl.trim().replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function handleApiResponse<T>(
  res: Response,
  endpointLabel: string
): Promise<BackendCallResult<T>> {
  if (res.status === 503) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error || '';
    } catch {
      // ignore
    }
    return {
      ok: false,
      httpStatus: 503,
      requiresBackendSetup: true,
      error: detail || `${endpointLabel}: AI provider is not configured on the server (HTTP 503).`,
    };
  }
  if (res.status === 404 || res.status === 501) {
    return {
      ok: false,
      httpStatus: res.status,
      notImplemented: true,
      error: `Backend Not Implemented (${endpointLabel} returned HTTP ${res.status}).`,
    };
  }
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { detail?: string; error?: string };
      detail = errBody.detail || errBody.error || '';
    } catch {
      // ignore non-JSON error body
    }
    return {
      ok: false,
      httpStatus: res.status,
      error: `${endpointLabel} returned HTTP ${res.status}${detail ? `: ${detail}` : '.'}`,
    };
  }
  try {
    const data = (await res.json()) as T;
    return { ok: true, httpStatus: res.status, data };
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      error: `${endpointLabel} returned an invalid JSON response.`,
    };
  }
}

export const phase2CloudServices = {
  chat: {
    mode: 'phase2_cloud_gemini',
    async sendProjectChatTurn(cloud, project, userMessage, history = []) {
      const bundleText =
        [...project.chatMessages].reverse().find((m) => m.isMaterialBundle && m.bundleText)?.bundleText ?? '';
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/chat`, {
          method: 'POST',
          headers: jsonHeaders(cloud),
          body: JSON.stringify({
            projectId: project.id,
            projectTitle: project.title,
            message: userMessage,
            history: history.slice(-12).map((m) => ({
              role: m.role,
              text: m.text,
              timestamp: m.timestamp,
            })),
            materialsBundle: bundleText || '',
            contextSummary: {
              hasStory: Boolean(project.story.rawText.trim()),
              characterCount: project.characters.length,
              imagePromptCount: project.imagePrompts.parsedItems.length,
              videoPromptCount: project.videoPrompts.parsedItems.length,
              settings: project.productionSettings,
            },
          }),
        });
        const parsed = await handleApiResponse<{
          replyText?: string;
          suggestedAction?: string;
        }>(res, '/api/chat');
        if (!parsed.ok) {
          return {
            ok: false,
            httpStatus: parsed.httpStatus,
            notImplemented: parsed.notImplemented,
            requiresBackendSetup: parsed.requiresBackendSetup,
            error: parsed.error,
          };
        }
        if (!parsed.data?.replyText) {
          return {
            ok: false,
            error: 'Gemini chat endpoint did not return replyText.',
          };
        }
        return {
          ok: true,
          data: {
            replyText: parsed.data.replyText,
            suggestedAction: parsed.data.suggestedAction,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'Cloud chat request failed.',
        };
      }
    },
  } satisfies IAiChatAssistantService,

  story: {
    async analyze(
      cloud: CloudBackendSettings,
      payload: { story: string; style?: string; maxScenes?: number; shotsPerScene?: number }
    ): Promise<BackendCallResult<{ plan: StoryPlan; meta: StoryPlanMeta }>> {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/story/analyze`, {
          method: 'POST',
          headers: jsonHeaders(cloud),
          body: JSON.stringify(payload),
        });
        return await handleApiResponse<{ plan: StoryPlan; meta: StoryPlanMeta }>(res, 'POST /api/story/analyze');
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Story analysis request failed.' };
      }
    },
  },

  imageGen: {
    async generateCharacterReference(cloud, payload) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/generate-character-ref`, {
          method: 'POST',
          headers: jsonHeaders(cloud),
          body: JSON.stringify(payload),
        });
        const parsed = await handleApiResponse<{
          imageUrl?: string;
          filename?: string;
        }>(res, 'POST /api/generate-character-ref');
        if (!parsed.ok) {
          return {
            ok: false,
            httpStatus: parsed.httpStatus,
            notImplemented: parsed.notImplemented,
            requiresBackendSetup: parsed.requiresBackendSetup,
            error: parsed.error,
          };
        }
        if (!parsed.data?.imageUrl) {
          return {
            ok: false,
            error: 'Image generation endpoint did not return imageUrl.',
          };
        }
        return {
          ok: true,
          data: {
            imageUrl: parsed.data.imageUrl,
            filename: parsed.data.filename || `${payload.slot}_generated.png`,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Image generation request failed.',
        };
      }
    },

    async generateShotImage(cloud, payload) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/generate/shot-image`, {
          method: 'POST',
          headers: jsonHeaders(cloud),
          body: JSON.stringify(payload),
        });
        const parsed = await handleApiResponse<{ imageUrl?: string }>(
          res,
          'POST /api/generate/shot-image'
        );
        if (!parsed.ok) return { ...parsed, data: undefined };
        if (!parsed.data?.imageUrl) {
          return { ok: false, error: 'Shot image endpoint did not return imageUrl.' };
        }
        return { ok: true, data: { imageUrl: parsed.data.imageUrl } };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Shot image request failed.',
        };
      }
    },
  } satisfies IImageGenerationService,

  videoGen: {
    async startShotVideo(cloud, payload) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/generate/shot-video`, {
          method: 'POST',
          headers: jsonHeaders(cloud),
          body: JSON.stringify(payload),
        });
        const parsed = await handleApiResponse<{ jobId?: string; reused?: 'idempotent' | 'active' | null }>(res, 'POST /api/generate/shot-video');
        if (!parsed.ok) return { ...parsed, data: undefined };
        if (!parsed.data?.jobId) {
          return { ok: false, error: 'Video endpoint did not return a jobId.' };
        }
        return { ok: true, data: { jobId: parsed.data.jobId, reused: parsed.data.reused ?? null } };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to start video generation.',
        };
      }
    },

    async getVideoJobStatus(cloud, jobId) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(
          `${conn.baseUrl}/api/generate/video-status/${encodeURIComponent(jobId)}`,
          { headers: authHeaders(cloud) }
        );
        if (res.status === 410 || res.status === 404) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return {
            ok: true,
            data: { status: 'failed', error: body.error || 'Video job no longer exists on the server.' },
          };
        }
        return await handleApiResponse<VideoJobStatus>(res, 'GET /api/generate/video-status');
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Video status request failed.',
        };
      }
    },

    async listJobs(cloud, projectId) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/generate/jobs?projectId=${encodeURIComponent(projectId)}`, { headers: authHeaders(cloud) });
        return await handleApiResponse<{ jobs: ServerJob[] }>(res, 'GET /api/generate/jobs');
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Job list request failed.' };
      }
    },

    async cancelVideoJob(cloud, jobId) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/generate/video-cancel/${encodeURIComponent(jobId)}`, {
          method: 'POST',
          headers: authHeaders(cloud),
        });
        return await handleApiResponse<VideoJobStatus>(res, 'POST /api/generate/video-cancel');
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Cancel request failed.' };
      }
    },
  } satisfies IVideoGenerationService,

  ffmpeg: {
    async requestCompleteMovieMp4(cloud, project, options) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/export/mp4`, {
          method: 'POST',
          headers: jsonHeaders(cloud),
          body: JSON.stringify({
            projectId: project.id,
            options: { aspectRatio: options.aspectRatio, resolution: options.resolution },
            clips: options.clips,
          }),
        });
        return await handleApiResponse<{
          jobId: string;
          statusUrl: string;
          downloadUrl?: string;
        }>(res, 'POST /api/export/mp4');
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'FFmpeg export request failed.',
        };
      }
    },
  } satisfies IFfmpegExportService,
};
