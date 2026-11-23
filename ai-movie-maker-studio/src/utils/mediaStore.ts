/**
 * Separate storage for large media (images / videos) in IndexedDB.
 *
 * Project JSON keeps only small metadata plus references like "idb://<id>".
 * - On save: big `data:` URLs (and blob URLs created by this module) are written once to the
 *   `media` object store (de-duplicated by content hash) and replaced by references in the
 *   persisted copy. The live in-memory state is not changed.
 * - On load: references are turned back into `blob:` URLs, so every existing component
 *   (<img>, <video>, fetch, ZIP export) keeps working unchanged.
 * - Nothing is ever deleted automatically. Files are removed only when the user runs
 *   "Clean unused local files" (see cleanUnusedMedia).
 */

export const MEDIA_STORE = 'media';
export const MEDIA_REF_PREFIX = 'idb://';
/** Only strings at least this long are moved out of the project JSON. */
export const MIN_EXTERNALIZE_CHARS = 4096;

export interface MediaRecord {
  id: string;
  mime: string;
  bytes: ArrayBuffer;
  size: number;
  createdAt: string;
}

const dataUrlToId = new Map<string, string>();
const blobUrlToId = new Map<string, string>();
const idToBlobUrl = new Map<string, string>();

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    return { mime: m[1], bytes: base64ToBytes(m[2]) };
  } catch {
    return null;
  }
}

async function contentId(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  }
  // Non-secure context (http on a LAN address): no crypto.subtle. A random id is still correct,
  // only identical files are then stored twice.
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Writes bytes once (same content => same id). Returns the id. */
async function putMedia(db: IDBDatabase, mime: string, bytes: Uint8Array): Promise<string> {
  const id = await contentId(bytes);
  const existing = await req(db.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).getKey(id));
  if (existing === undefined) {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    tx.objectStore(MEDIA_STORE).put({ id, mime, bytes: copy, size: bytes.byteLength, createdAt: new Date().toISOString() } satisfies MediaRecord);
    await txDone(tx);
  }
  return id;
}

export async function mapStringsAsync(value: unknown, fn: (s: string) => Promise<string>): Promise<unknown> {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) out.push(await mapStringsAsync(v, fn));
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await mapStringsAsync(v, fn);
    return out;
  }
  return value;
}

export interface ExternalizeResult<T> {
  persisted: T;
  /** Number of media files newly written in this call. */
  stored: number;
  /** Number of references that point to media already stored. */
  referenced: Set<string>;
}

/** Returns a copy of `state` where large media is replaced by idb:// references. */
export async function externalizeMedia<T>(db: IDBDatabase, state: T): Promise<ExternalizeResult<T>> {
  const referenced = new Set<string>();
  let stored = 0;
  const persisted = (await mapStringsAsync(state, async (s) => {
    if (s.startsWith(MEDIA_REF_PREFIX)) {
      referenced.add(s.slice(MEDIA_REF_PREFIX.length));
      return s;
    }
    if (s.startsWith('data:') && s.length >= MIN_EXTERNALIZE_CHARS) {
      let id = dataUrlToId.get(s);
      if (!id) {
        const parsed = parseDataUrl(s);
        if (!parsed) return s;
        id = await putMedia(db, parsed.mime, parsed.bytes);
        dataUrlToId.set(s, id);
        stored += 1;
      }
      referenced.add(id);
      return MEDIA_REF_PREFIX + id;
    }
    if (s.startsWith('blob:')) {
      const id = blobUrlToId.get(s);
      if (id) {
        referenced.add(id);
        return MEDIA_REF_PREFIX + id;
      }
    }
    return s;
  })) as T;
  return { persisted, stored, referenced };
}

export interface RehydrateResult<T> {
  state: T;
  /** References whose file was not found in the media store. */
  missing: string[];
}

/** Turns idb:// references back into blob: URLs. */
export async function rehydrateMedia<T>(db: IDBDatabase, state: T): Promise<RehydrateResult<T>> {
  const missing: string[] = [];
  const state2 = (await mapStringsAsync(state, async (s) => {
    if (!s.startsWith(MEDIA_REF_PREFIX)) return s;
    const id = s.slice(MEDIA_REF_PREFIX.length);
    const cached = idToBlobUrl.get(id);
    if (cached) return cached;
    const rec = (await req(db.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).get(id))) as MediaRecord | undefined;
    if (!rec) {
      missing.push(id);
      return '';
    }
    const url = URL.createObjectURL(new Blob([rec.bytes], { type: rec.mime }));
    idToBlobUrl.set(id, url);
    blobUrlToId.set(url, id);
    return url;
  })) as T;
  return { state: state2, missing };
}

export interface MediaReport {
  count: number;
  bytes: number;
  unusedCount: number;
  unusedBytes: number;
}

async function allRecordsMeta(db: IDBDatabase): Promise<Array<{ id: string; size: number }>> {
  const out: Array<{ id: string; size: number }> = [];
  const tx = db.transaction(MEDIA_STORE, 'readonly');
  await new Promise<void>((resolve, reject) => {
    const cur = tx.objectStore(MEDIA_STORE).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve();
      out.push({ id: String(c.key), size: Number((c.value as MediaRecord).size || 0) });
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
  return out;
}

/** Which stored files are referenced by `state`, and how much space the unused ones take. */
export async function mediaReport<T>(db: IDBDatabase, state: T): Promise<MediaReport> {
  const { referenced } = await externalizeMedia(db, state);
  const all = await allRecordsMeta(db);
  const unused = all.filter((r) => !referenced.has(r.id));
  return {
    count: all.length,
    bytes: all.reduce((n, r) => n + r.size, 0),
    unusedCount: unused.length,
    unusedBytes: unused.reduce((n, r) => n + r.size, 0),
  };
}

/** Deletes stored files that no project references. Must only be called after the user confirmed. */
export async function cleanUnusedMedia<T>(db: IDBDatabase, state: T): Promise<{ deleted: number; freedBytes: number }> {
  const { referenced } = await externalizeMedia(db, state);
  const unused = (await allRecordsMeta(db)).filter((r) => !referenced.has(r.id));
  if (unused.length === 0) return { deleted: 0, freedBytes: 0 };
  const tx = db.transaction(MEDIA_STORE, 'readwrite');
  for (const r of unused) {
    tx.objectStore(MEDIA_STORE).delete(r.id);
    const url = idToBlobUrl.get(r.id);
    if (url) {
      URL.revokeObjectURL(url);
      idToBlobUrl.delete(r.id);
      blobUrlToId.delete(url);
    }
  }
  await txDone(tx);
  return { deleted: unused.length, freedBytes: unused.reduce((n, r) => n + r.size, 0) };
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  ratio: number;
  persisted?: boolean;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || !est.quota) return null;
    const usage = est.usage ?? 0;
    let persisted: boolean | undefined;
    try {
      persisted = await navigator.storage.persisted?.();
    } catch {
      persisted = undefined;
    }
    return { usage, quota: est.quota, ratio: usage / est.quota, persisted };
  } catch {
    return null;
  }
}

/** Asks the browser not to evict this site's data under storage pressure (no prompt in most browsers). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(n / 1024))} KB`;
}

/** Test helper: forget in-memory caches (simulates a page reload). */
export function _resetMediaCachesForTests() {
  dataUrlToId.clear();
  blobUrlToId.clear();
  idToBlobUrl.clear();
}
