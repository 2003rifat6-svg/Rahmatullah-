import {
  CharacterCard,
  CharacterRefSlot,
  CloudBackendSettings,
  MovieProject,
  OutputSectionState,
  ParsedPromptEntry,
  PromptSectionData,
  StorageStatus,
} from '../types/studio';
import { DEFAULT_CLOUD_SETTINGS } from '../services/studioBackend';
import { createDefaultProductionSettings } from '../data/sampleProject';
import { externalizeMedia, MEDIA_STORE, rehydrateMedia } from './mediaStore';

function normalizeOutputSection(sec: OutputSectionState | undefined): OutputSectionState {
  return { ...(sec || {}), locked: Boolean(sec?.locked) };
}

/** A shot that was "generating" when the page closed cannot still be running in this tab. */
function normalizePromptItem(item: ParsedPromptEntry, kind: 'image' | 'video'): ParsedPromptEntry {
  const candidates =
    item.candidates ??
    (item.generatedUrl && item.assetSource
      ? [
          {
            id: `${item.id}_c0`,
            url: item.generatedUrl,
            source: item.assetSource,
            createdAt: new Date().toISOString(),
            fromPrompt: item.promptText,
          },
        ]
      : []);
  const next: ParsedPromptEntry = {
    ...item,
    candidates,
    selectedCandidateId: item.selectedCandidateId ?? candidates[0]?.id,
  };
  if (next.status === 'generating' && !(kind === 'video' && next.backendJobId)) {
    next.status = next.generatedUrl ? 'completed' : 'failed';
    next.errorMessage = 'Generation was interrupted (page closed or reloaded). Press Generate again.';
  }
  return next;
}

function normalizePromptSection(sec: PromptSectionData | undefined, kind: 'image' | 'video'): PromptSectionData {
  const base = sec || { rawText: '', locked: false, parsedItems: [] };
  return {
    ...base,
    locked: Boolean(base.locked),
    parsedItems: Array.isArray(base.parsedItems)
      ? base.parsedItems.map((i) => normalizePromptItem(i, kind))
      : [],
  };
}

const DB_NAME = 'ai_movie_maker_studio_db_v4';
const STORE_NAME = 'studio_state';
const STATE_KEY = 'projects_payload_v4';
const LOCAL_FALLBACK_KEY = 'ai_movie_maker_studio_fallback_v4';

export interface PersistedStudioState {
  activeProjectId: string;
  projects: MovieProject[];
  cloudSettings: CloudBackendSettings;
  savedAt: string;
}

export interface LoadStudioResult {
  state: PersistedStudioState | null;
  error?: string;
  /** Saved files referenced by a project but missing from the media store. */
  missingMedia?: number;
  engine: 'indexeddb' | 'localstorage' | 'none';
}

function normalizeSlot(
  slot:
    | Partial<CharacterRefSlot>
    | {
        url?: string;
        filename?: string;
        source?: CharacterRefSlot['source'];
        uploadedAt?: string;
        prompt?: string;
        imageUrl?: string;
        savedAt?: string;
        locked?: boolean;
        lockedAt?: string;
      }
    | undefined,
  fallbackPrompt = ''
): CharacterRefSlot {
  if (!slot) return { prompt: fallbackPrompt, locked: false };
  const imageUrl = slot.imageUrl ?? (slot as { url?: string }).url;
  return {
    prompt: slot.prompt ?? fallbackPrompt,
    imageUrl,
    filename: slot.filename,
    source: slot.source,
    uploadedAt: slot.uploadedAt,
    savedAt: slot.savedAt,
    locked: Boolean(slot.locked),
    lockedAt: slot.lockedAt,
  };
}

function normalizeCharacterCard(raw: CharacterCard): CharacterCard {
  const legacy = raw as CharacterCard & {
    facePrompt?: string;
    bodyPrompt?: string;
  };
  return {
    ...raw,
    references: {
      face: normalizeSlot(raw.references?.face, legacy.facePrompt || ''),
      front: normalizeSlot(raw.references?.front, legacy.bodyPrompt || ''),
      side: normalizeSlot(raw.references?.side, legacy.bodyPrompt || ''),
      back: normalizeSlot(raw.references?.back, legacy.bodyPrompt || ''),
    },
    locked: Boolean(raw.locked),
  };
}

export function normalizeProject(proj: MovieProject): MovieProject {
  return {
    ...proj,
    characters: Array.isArray(proj.characters)
      ? proj.characters.map(normalizeCharacterCard)
      : [],
    imagePrompts: normalizePromptSection(proj.imagePrompts, 'image'),
    videoPrompts: normalizePromptSection(proj.videoPrompts, 'video'),
    productionSettings: {
      ...createDefaultProductionSettings(),
      ...(proj.productionSettings || {}),
      locked: Boolean(proj.productionSettings?.locked),
    },
    generatedImagesSection: normalizeOutputSection(proj.generatedImagesSection),
    generatedVideosSection: normalizeOutputSection(proj.generatedVideosSection),
  };
}

export function openStudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }
    // v2 adds the `media` store (large images/videos kept apart from project metadata).
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function loadStudioState(): Promise<LoadStudioResult> {
  const errors: string[] = [];

  try {
    const db = await openStudioDb();
    const result = await new Promise<PersistedStudioState | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(STATE_KEY);
        req.onsuccess = () =>
          resolve(req.result as PersistedStudioState | undefined);
        req.onerror = () =>
          reject(req.error ?? new Error('IndexedDB read error.'));
      }
    );
    if (result && Array.isArray(result.projects) && result.projects.length > 0) {
      const { state: rehydrated, missing } = await rehydrateMedia(db, result);
      return {
        state: {
          ...rehydrated,
          projects: rehydrated.projects.map(normalizeProject),
          cloudSettings: rehydrated.cloudSettings ?? DEFAULT_CLOUD_SETTINGS,
        },
        engine: 'indexeddb',
        missingMedia: missing.length,
      };
    }
  } catch (err) {
    errors.push(
      err instanceof Error ? `IndexedDB: ${err.message}` : 'IndexedDB read failed'
    );
  }

  try {
    const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
    if (raw) {
      let parsed = JSON.parse(raw) as PersistedStudioState;
      let missingMedia = 0;
      if (raw.includes('idb://')) {
        try {
          const r = await rehydrateMedia(await openStudioDb(), parsed);
          parsed = r.state;
          missingMedia = r.missing.length;
        } catch {
          missingMedia = -1;
        }
      }
      if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
        return {
          state: {
            ...parsed,
            projects: parsed.projects.map(normalizeProject),
            cloudSettings: parsed.cloudSettings ?? DEFAULT_CLOUD_SETTINGS,
          },
          engine: 'localstorage',
          missingMedia: Math.max(0, missingMedia),
        };
      }
    }
  } catch (err) {
    errors.push(
      err instanceof Error
        ? `localStorage: ${err.message}`
        : 'localStorage read failed'
    );
  }

  return {
    state: null,
    engine: 'none',
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  };
}

let saving = false;
let waiting: Array<{ state: PersistedStudioState; resolve: (s: StorageStatus) => void }> = [];

/**
 * Saves are queued and coalesced: only the newest waiting state is written, and writes never
 * overlap (an older state can no longer overwrite a newer one).
 */
export function saveStudioState(state: PersistedStudioState): Promise<StorageStatus> {
  return new Promise((resolve) => {
    waiting.push({ state, resolve });
    if (!saving) void drainSaves();
  });
}

async function drainSaves() {
  saving = true;
  try {
    while (waiting.length > 0) {
      const batch = waiting;
      waiting = [];
      const status = await writeStudioState(batch[batch.length - 1].state);
      for (const b of batch) b.resolve(status);
    }
  } finally {
    saving = false;
  }
}

async function writeStudioState(
  liveState: PersistedStudioState
): Promise<StorageStatus> {
  let idbOk = false;
  let idbError: string | undefined;
  let lsOk = false;
  let lsError: string | undefined;
  let state = liveState;

  try {
    const db = await openStudioDb();
    // Large media goes to its own store; the project record keeps small references only.
    try {
      state = (await externalizeMedia(db, liveState)).persisted;
    } catch (mediaErr) {
      state = liveState;
      idbError = mediaErr instanceof Error ? `media: ${mediaErr.message}` : 'media store write failed';
      throw mediaErr;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(state, STATE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('IndexedDB write failed.'));
      tx.onabort = () =>
        reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
    });
    idbOk = true;
  } catch (err) {
    idbError =
      err instanceof Error ? err.message : 'IndexedDB storage write failed';
  }

  try {
    localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(state));
    lsOk = true;
  } catch (err) {
    lsError =
      err instanceof Error
        ? err.message
        : 'localStorage quota exceeded (~5MB browser limit)';
  }

  if (idbOk) {
    return {
      ok: true,
      engine: 'indexeddb',
      lastSavedAt: liveState.savedAt,
      quotaWarning: !lsOk
        ? `Saved in IndexedDB, but the small localStorage backup could not be written (${lsError}). Your data is safe in IndexedDB.`
        : undefined,
    };
  }

  if (lsOk) {
    return {
      ok: true,
      engine: 'localstorage',
      lastSavedAt: liveState.savedAt,
      quotaWarning: idbError
        ? `Saved to localStorage (~5MB limit) because IndexedDB failed: ${idbError}.`
        : undefined,
    };
  }

  return {
    ok: false,
    engine: 'none',
    error: `Save failed! Browser storage could not persist your changes (IndexedDB: ${
      idbError || 'unavailable'
    }; localStorage: ${lsError || 'unavailable'}). Free browser storage space or export your project ZIP.`,
  };
}

export async function readAndOptimizeImageFile(
  file: File,
  maxDimension = 1024
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** iPhone/iPad app opened from the Home Screen: a plain download link does not work there, the share sheet does. */
function isIosStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && Boolean(nav.standalone);
}

export function triggerDownload(blob: Blob, filename: string): void {
  if (isIosStandalone() && typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      void navigator.share({ files: [file], title: filename }).catch(() => undefined);
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'application/json'
): void {
  const blob = new Blob([content], { type: mimeType });
  triggerDownload(blob, filename);
}

/** Reads any image URL (data:, same-origin path, blob:) into a data URL so the backend can use it. */
export async function urlToDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
