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

export type CloudResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; cloudRevision?: number; signInRequired?: boolean };

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
        cloudRevision: typeof data.cloudRevision === 'number' ? data.cloudRevision : undefined,
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
  /** Creates or updates. Without force, a newer cloud copy returns status 409. */
  save: (cloud: CloudBackendSettings, project: MovieProject, opts: { force?: boolean } = {}) => {
    const clean = stripLocalOnly(project);
    return project.cloudRevision === undefined && !opts.force
      ? call<{ meta: CloudProjectMeta; project: MovieProject }>(cloud, 'POST', '/api/projects', { project: clean })
      : call<{ meta: CloudProjectMeta; project: MovieProject }>(cloud, 'PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          project: clean,
          baseRevision: project.cloudRevision,
          force: Boolean(opts.force),
        });
  },
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
    kind: 'images' | 'videos' | 'zips' | 'movies' | 'files',
    filename: string,
    blob: Blob
  ): Promise<CloudResult<{ key: string; url: string }>> {
    const type = blob.type || 'application/octet-stream';
    const prep = await call<{ key: string; url: string; headers: Record<string, string>; direct: boolean; mediaUrl: string }>(
      cloud,
      'POST',
      '/api/storage/upload-url',
      { projectId, kind, filename, contentType: type, size: blob.size }
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
      if (!res.ok) return { ok: false, status: res.status, error: `Upload failed (HTTP ${res.status}).` };
      return { ok: true, data: { key: prep.data.key, url: prep.data.mediaUrl } };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Upload failed' };
    }
  },

  remove: (cloud: CloudBackendSettings, key: string) => call<{ deleted: string }>(cloud, 'DELETE', `/api/storage/files/${key}`),

  downloadUrl: (cloud: CloudBackendSettings, url: string) => `${resolveBackendUrl(cloud, url)}?download=1`,
};
