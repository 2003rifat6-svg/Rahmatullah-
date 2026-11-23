/**
 * Optional cloud features. The browser (IndexedDB) stays the main, always-working save;
 * nothing here runs unless the user signs in and presses a cloud button.
 *
 * - Sign in with Google  -> server session cookie (HttpOnly)
 * - Projects             -> Firestore (users/<uid>/projects/<id>) via /api/projects
 * - Files                -> Cloud Storage via /api/storage/* and /api/media/*
 */
import { CloudBackendSettings, MovieProject } from '../types/studio';
import { authHeaders, jsonHeaders, resolveBackendUrl } from './cloudApiInterfaces';
import { MIN_EXTERNALIZE_CHARS, mapStringsAsync } from '../utils/mediaStore';

export interface CloudUser {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface CloudProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  sizeBytes: number;
  bodyLocation: 'firestore' | 'gcs';
}

export interface CloudFile {
  key: string;
  name: string;
  kind: string;
  size: number;
  contentType: string;
  updated: string;
  url: string;
}

export type CloudResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string; cloudRevision?: number; cloudUpdatedAt?: string; signInRequired?: boolean };

const base = (cloud: CloudBackendSettings) => cloud.backendUrl.trim().replace(/\/+$/, '');

async function call<T>(cloud: CloudBackendSettings, method: string, path: string, body?: unknown): Promise<CloudResult<T>> {
  if (!base(cloud)) return { ok: false, status: 0, error: 'Backend URL is not set (Cloud Settings).' };
  try {
    const res = await fetch(`${base(cloud)}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? authHeaders(cloud) : jsonHeaders(cloud),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(data.error || `HTTP ${res.status}`),
        code: typeof data.code === 'string' ? data.code : undefined,
        cloudRevision: typeof data.cloudRevision === 'number' ? data.cloudRevision : undefined,
        cloudUpdatedAt: typeof data.cloudUpdatedAt === 'string' ? data.cloudUpdatedAt : undefined,
        signInRequired: res.status === 401,
      };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ---------- auth ----------
export const cloudAuth = {
  me: (cloud: CloudBackendSettings) => call<{ user: CloudUser | null }>(cloud, 'GET', '/api/auth/me'),
  signIn: (cloud: CloudBackendSettings, credential: string) => call<{ user: CloudUser }>(cloud, 'POST', '/api/auth/session', { credential }),
  signOut: (cloud: CloudBackendSettings) => call<{ ok: boolean }>(cloud, 'POST', '/api/auth/logout', {}),
};

let gisPromise: Promise<void> | null = null;
/** Loads Google Identity Services (accounts.google.com) only when the user opens sign-in. */
export function loadGoogleIdentity(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google Sign-In.'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

// ---------- projects (Firestore) ----------
export const cloudProjects = {
  list: (cloud: CloudBackendSettings) => call<{ projects: CloudProjectMeta[] }>(cloud, 'GET', '/api/projects'),
  get: (cloud: CloudBackendSettings, id: string) =>
    call<{ meta: CloudProjectMeta; project: MovieProject }>(cloud, 'GET', `/api/projects/${encodeURIComponent(id)}`),
  /** Creates the cloud copy. 409 (revision_conflict) if it already exists. */
  create: (cloud: CloudBackendSettings, project: MovieProject) =>
    call<{ meta: CloudProjectMeta; project: MovieProject }>(cloud, 'POST', '/api/projects', { project: stripLocalOnly(project) }),
  /**
   * Updates the cloud copy. `baseRevision` (the cloud revision this change is based on) is mandatory;
   * a different current revision returns 409 and nothing is overwritten.
   */
  update: (cloud: CloudBackendSettings, project: MovieProject, baseRevision: number) =>
    call<{ meta: CloudProjectMeta; project: MovieProject }>(cloud, 'PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
      project: stripLocalOnly(project),
      baseRevision,
    }),
  remove: (cloud: CloudBackendSettings, id: string) => call<{ deletedAt: string }>(cloud, 'DELETE', `/api/projects/${encodeURIComponent(id)}`),
};

function stripLocalOnly(p: MovieProject): MovieProject {
  const { cloudRevision: _r, cloudSyncedAt: _s, ...rest } = p;
  return rest as MovieProject;
}

// ---------- files (Cloud Storage) ----------
export const cloudFiles = {
  list: (cloud: CloudBackendSettings, projectId: string) =>
    call<{ files: CloudFile[] }>(cloud, 'GET', `/api/storage/files?projectId=${encodeURIComponent(projectId)}`),

  async upload(
    cloud: CloudBackendSettings,
    projectId: string,
    kind: 'images' | 'videos' | 'zips' | 'movies' | 'assets' | 'files',
    filename: string,
    blob: Blob,
    contentHash?: string
  ): Promise<CloudResult<{ key: string; url: string }>> {
    const type = blob.type || 'application/octet-stream';
    const prep = await call<{ key: string; url: string; headers: Record<string, string>; direct: boolean; mediaUrl: string }>(
      cloud,
      'POST',
      '/api/storage/upload-url',
      { projectId, kind, filename, contentType: type, size: blob.size, ...(contentHash ? { contentHash } : {}) }
    );
    if (!prep.ok) return prep;
    if (!prep.data.direct && blob.size > 30 * 1024 * 1024) {
      return { ok: false, status: 413, error: 'File is larger than 30 MB. Enable GCS_SIGNED_URLS on the server for big uploads.' };
    }
    const target = prep.data.direct ? prep.data.url : resolveBackendUrl(cloud, prep.data.url);
    try {
      const res = await fetch(target, {
        method: 'PUT',
        credentials: prep.data.direct ? 'omit' : 'include',
        headers: prep.data.direct ? prep.data.headers : { ...authHeaders(cloud), ...prep.data.headers },
        body: blob,
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, status: res.status, error: detail.error || `Upload failed (HTTP ${res.status}).` };
      }
      if (prep.data.direct) {
        // Direct uploads cannot be inspected on the way in; the server checks the stored file and deletes it if invalid.
        const done = await call<{ url: string }>(cloud, 'POST', '/api/storage/upload-complete', { key: prep.data.key });
        if (!done.ok) return done;
      }
      return { ok: true, data: { key: prep.data.key, url: prep.data.mediaUrl } };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Upload failed' };
    }
  },

  remove: (cloud: CloudBackendSettings, key: string) => call<{ deleted: string }>(cloud, 'DELETE', `/api/storage/files/${key}`),

  downloadUrl: (cloud: CloudBackendSettings, url: string) => `${resolveBackendUrl(cloud, url)}?download=1`,
};

/** First 24 hex chars of SHA-256: same naming the server uses for content-addressed project media. */
async function contentHash24(blob: Blob): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/**
 * Before a cloud save: uploads every image/video of the project (blob: or data: URL) to Cloud
 * Storage and replaces it by its /api/media link. The project JSON sent afterwards is small, so
 * any number of saved versions fits (a request is limited to 30 MB). Identical files are
 * uploaded once. Returns an error instead of silently dropping a file.
 */
export async function uploadProjectMedia(
  cloud: CloudBackendSettings,
  project: MovieProject
): Promise<{ ok: true; project: MovieProject; uploaded: number } | { ok: false; error: string; signInRequired?: boolean }> {
  const cache = new Map<string, string>();
  let uploaded = 0;
  let failure: { error: string; signInRequired?: boolean } | null = null;
  const result = (await mapStringsAsync(project, async (s) => {
    if (failure) return s;
    const isMedia = s.startsWith('blob:') || (s.startsWith('data:') && s.length >= MIN_EXTERNALIZE_CHARS);
    if (!isMedia) return s;
    const cached = cache.get(s);
    if (cached) return cached;
    let blob: Blob;
    try {
      blob = await (await fetch(s)).blob();
    } catch {
      failure = { error: 'A saved image/video could not be read from this browser (it may have been cleared).' };
      return s;
    }
    const type = blob.type || 'application/octet-stream';
    const ext = type.split('/')[1]?.replace('quicktime', 'mov') || 'bin';
    const up = await cloudFiles.upload(cloud, project.id, 'assets', `media.${ext}`, blob, await contentHash24(blob));
    if (!up.ok) {
      failure = { error: `Could not upload a ${type} file (${Math.round(blob.size / 1024)} KB): ${up.error}`, signInRequired: up.signInRequired };
      return s;
    }
    cache.set(s, up.data.url);
    uploaded += 1;
    return up.data.url;
  })) as MovieProject;
  return failure ? { ok: false, ...(failure as { error: string; signInRequired?: boolean }) } : { ok: true, project: result, uploaded };
}
