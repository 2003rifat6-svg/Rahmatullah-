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

export interface IFirestoreProjectSyncService {
  createProjectMetadata(
    cloud: CloudBackendSettings,
    project: MovieProject
  ): Promise<BackendCallResult<{ syncedAt: string }>>;
  saveProjectMetadata(
    cloud: CloudBackendSettings,
    project: MovieProject
  ): Promise<BackendCallResult<{ syncedAt: string }>>;
  deleteProjectMetadata(
    cloud: CloudBackendSettings,
    projectId: string
  ): Promise<BackendCallResult<{ deletedAt: string }>>;
  listUserProjects(
    cloud: CloudBackendSettings
  ): Promise<BackendCallResult<MovieProject[]>>;
}

export interface IGcsMediaStorageService {
  uploadMediaAsset(
    cloud: CloudBackendSettings,
    projectId: string,
    pathKey: string,
    fileBlob: Blob
  ): Promise<BackendCallResult<{ gcsUri: string; signedPreviewUrl: string }>>;
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
  aspectRatio: AspectRatio;
  resolution: SupportedResolution;
  durationSec: number;
}

export interface VideoJobStatus {
  status: 'running' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

export interface IVideoGenerationService {
  startShotVideo(
    cloud: CloudBackendSettings,
    payload: ShotVideoRequest
  ): Promise<BackendCallResult<{ jobId: string }>>;
  getVideoJobStatus(
    cloud: CloudBackendSettings,
    jobId: string
  ): Promise<BackendCallResult<VideoJobStatus>>;
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

function jsonHeaders(cloud: CloudBackendSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cloud.accessToken?.trim()) h['x-studio-token'] = cloud.accessToken.trim();
  return h;
}

function authHeaders(cloud: CloudBackendSettings): Record<string, string> {
  return cloud.accessToken?.trim() ? { 'x-studio-token': cloud.accessToken.trim() } : {};
}

/** Turns a server-relative media path ("/media/...") into an absolute URL on the backend. */
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

  firestore: {
    async createProjectMetadata(cloud, project) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/projects`, {
          method: 'POST',
          headers: jsonHeaders(cloud),
          body: JSON.stringify(project),
        });
        return await handleApiResponse<{ syncedAt: string }>(
          res,
          'POST /api/projects'
        );
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'Cloud project create failed.',
        };
      }
    },

    async saveProjectMetadata(cloud, project) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(
          `${conn.baseUrl}/api/projects/${encodeURIComponent(project.id)}`,
          {
            method: 'PUT',
            headers: jsonHeaders(cloud),
            body: JSON.stringify(project),
          }
        );
        return await handleApiResponse<{ syncedAt: string }>(
          res,
          'PUT /api/projects/:id'
        );
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'Firestore sync failed.',
        };
      }
    },

    async deleteProjectMetadata(cloud, projectId) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(
          `${conn.baseUrl}/api/projects/${encodeURIComponent(projectId)}`,
          {
            method: 'DELETE',
            headers: authHeaders(cloud),
          }
        );
        return await handleApiResponse<{ deletedAt: string }>(
          res,
          'DELETE /api/projects/:id'
        );
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'Cloud project delete failed.',
        };
      }
    },

    async listUserProjects(cloud) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const res = await fetch(`${conn.baseUrl}/api/projects`, { headers: authHeaders(cloud) });
        return await handleApiResponse<MovieProject[]>(res, 'GET /api/projects');
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to list Firestore projects.',
        };
      }
    },
  } satisfies IFirestoreProjectSyncService,

  gcs: {
    async uploadMediaAsset(cloud, projectId, pathKey, fileBlob) {
      const conn = assertBackendConnected(cloud);
      if (!conn.ok) {
        return { ok: false, requiresBackendSetup: true, error: conn.error };
      }
      try {
        const form = new FormData();
        form.append('projectId', projectId);
        form.append('pathKey', pathKey);
        form.append('file', fileBlob);
        const res = await fetch(`${conn.baseUrl}/api/storage/upload`, {
          method: 'POST',
          headers: authHeaders(cloud),
          body: form,
        });
        return await handleApiResponse<{
          gcsUri: string;
          signedPreviewUrl: string;
        }>(res, 'POST /api/storage/upload');
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'GCS upload failed.',
        };
      }
    },
  } satisfies IGcsMediaStorageService,

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
        const parsed = await handleApiResponse<{ jobId?: string }>(res, 'POST /api/generate/shot-video');
        if (!parsed.ok) return { ...parsed, data: undefined };
        if (!parsed.data?.jobId) {
          return { ok: false, error: 'Video endpoint did not return a jobId.' };
        }
        return { ok: true, data: { jobId: parsed.data.jobId } };
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
        if (res.status === 410) {
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
