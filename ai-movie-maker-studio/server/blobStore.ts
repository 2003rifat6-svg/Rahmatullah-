/**
 * File storage for images, videos, ZIPs and large project bodies.
 *
 * - GcsBlobStore: Google Cloud Storage (production / Cloud Run). Nothing important is
 *   kept on the container disk; temporary files (FFmpeg) are deleted right after use.
 * - LocalDiskBlobStore: ONLY for local development. The server refuses to use it on
 *   Cloud Run (see config.ts), because Cloud Run's disk is temporary (in-memory).
 *
 * Every key has the form  users/<uid>/projects/<projectId>/<kind>/<file>
 * and access is checked against the signed-in user's uid in app.ts.
 */
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface BlobInfo {
  key: string;
  size: number;
  contentType: string;
  updated: string;
}

export interface BlobStore {
  readonly kind: 'gcs' | 'local-disk';
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<void>;
  putStream(key: string, stream: Readable, contentType: string): Promise<void>;
  stat(key: string): Promise<BlobInfo | null>;
  read(key: string, range?: { start: number; end: number }): Readable;
  readBuffer(key: string): Promise<Buffer>;
  list(prefix: string): Promise<BlobInfo[]>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  /** V4 signed URLs (GCS only, needs iam.serviceAccounts.signBlob on Cloud Run). */
  signedReadUrl?(key: string, expiresInSec: number): Promise<string>;
  signedUploadUrl?(key: string, contentType: string, expiresInSec: number, maxBytes?: number): Promise<string>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Rejects anything that could escape the user's folder. */
export function isSafeKey(key: string): boolean {
  if (!key || key.length > 512 || key.startsWith('/') || key.includes('\\')) return false;
  return key.split('/').every((seg) => SAFE_SEGMENT.test(seg) && seg !== '.' && seg !== '..');
}

export function safeSegment(s: unknown, fallback = 'x'): string {
  return String(s ?? '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || fallback;
}

export function userPrefix(uid: string) {
  return `users/${safeSegment(uid)}/`;
}

export function projectPrefix(uid: string, projectId: string) {
  return `${userPrefix(uid)}projects/${safeSegment(projectId, 'project')}/`;
}

export class GcsBlobStore implements BlobStore {
  readonly kind = 'gcs' as const;
  private bucket;
  constructor(bucketName: string, storage = new Storage()) {
    this.bucket = storage.bucket(bucketName);
  }
  async put(key: string, data: Buffer | Uint8Array, contentType: string) {
    await this.bucket.file(key).save(Buffer.from(data), { contentType, resumable: false });
  }
  async putStream(key: string, stream: Readable, contentType: string) {
    await pipeline(stream, this.bucket.file(key).createWriteStream({ contentType, resumable: false }));
  }
  async stat(key: string): Promise<BlobInfo | null> {
    try {
      const [m] = await this.bucket.file(key).getMetadata();
      return {
        key,
        size: Number(m.size ?? 0),
        contentType: String(m.contentType || 'application/octet-stream'),
        updated: String(m.updated || ''),
      };
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }
  read(key: string, range?: { start: number; end: number }) {
    return this.bucket.file(key).createReadStream(range ? { start: range.start, end: range.end, validation: false } : {});
  }
  async readBuffer(key: string) {
    const [buf] = await this.bucket.file(key).download();
    return buf;
  }
  async list(prefix: string): Promise<BlobInfo[]> {
    const [files] = await this.bucket.getFiles({ prefix, autoPaginate: true });
    return files.map((f) => ({
      key: f.name,
      size: Number(f.metadata.size ?? 0),
      contentType: String(f.metadata.contentType || 'application/octet-stream'),
      updated: String(f.metadata.updated || ''),
    }));
  }
  async delete(key: string) {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
  async deletePrefix(prefix: string) {
    const files = await this.list(prefix);
    await Promise.all(files.map((f) => this.delete(f.key)));
    return files.length;
  }
  async signedReadUrl(key: string, expiresInSec: number) {
    const [url] = await this.bucket.file(key).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + expiresInSec * 1000 });
    return url;
  }
  async signedUploadUrl(key: string, contentType: string, expiresInSec: number, maxBytes?: number) {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      contentType,
      expires: Date.now() + expiresInSec * 1000,
      // GCS rejects uploads outside this size range (the browser must send the same header).
      ...(maxBytes ? { extensionHeaders: { 'x-goog-content-length-range': `0,${maxBytes}` } } : {}),
    });
    return url;
  }
}

/** Development-only store on the local disk. */
export class LocalDiskBlobStore implements BlobStore {
  readonly kind = 'local-disk' as const;
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  private file(key: string) {
    if (!isSafeKey(key)) throw new Error('unsafe key');
    return path.join(this.root, key);
  }
  private metaFile(key: string) {
    return this.file(key) + '.__meta.json';
  }
  async put(key: string, data: Buffer | Uint8Array, contentType: string) {
    fs.mkdirSync(path.dirname(this.file(key)), { recursive: true });
    fs.writeFileSync(this.file(key), data);
    fs.writeFileSync(this.metaFile(key), JSON.stringify({ contentType }));
  }
  async putStream(key: string, stream: Readable, contentType: string) {
    fs.mkdirSync(path.dirname(this.file(key)), { recursive: true });
    await pipeline(stream, fs.createWriteStream(this.file(key)));
    fs.writeFileSync(this.metaFile(key), JSON.stringify({ contentType }));
  }
  async stat(key: string): Promise<BlobInfo | null> {
    const f = this.file(key);
    if (!fs.existsSync(f)) return null;
    const st = fs.statSync(f);
    let contentType = 'application/octet-stream';
    try {
      contentType = JSON.parse(fs.readFileSync(this.metaFile(key), 'utf8')).contentType || contentType;
    } catch {
      // no metadata
    }
    return { key, size: st.size, contentType, updated: st.mtime.toISOString() };
  }
  read(key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.file(key), range ? { start: range.start, end: range.end } : {});
  }
  async readBuffer(key: string) {
    return fs.readFileSync(this.file(key));
  }
  async list(prefix: string): Promise<BlobInfo[]> {
    const out: BlobInfo[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (!e.name.endsWith('.__meta.json')) {
          const key = path.relative(this.root, abs).split(path.sep).join('/');
          if (key.startsWith(prefix)) out.push({ key, size: fs.statSync(abs).size, contentType: '', updated: fs.statSync(abs).mtime.toISOString() });
        }
      }
    };
    walk(this.root);
    return Promise.all(out.map(async (o) => (await this.stat(o.key)) ?? o));
  }
  async delete(key: string) {
    fs.rmSync(this.file(key), { force: true });
    fs.rmSync(this.metaFile(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    const files = await this.list(prefix);
    for (const f of files) await this.delete(f.key);
    return files.length;
  }
}
