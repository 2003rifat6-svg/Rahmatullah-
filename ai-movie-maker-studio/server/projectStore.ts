/**
 * Cloud project storage in Firestore.
 *
 * Layout:  users/{uid}/projects/{projectId}  (document)
 *          users/{uid}/projects/{projectId}/_body/{uuid}.json  (large bodies, GCS)
 *
 * Safety rules for large bodies (> 800 KB):
 *  1. Every save writes a NEW object with a unique key. No existing object is ever
 *     overwritten, so a conflicting or failed save cannot damage the current copy.
 *  2. The Firestore transaction (revision check + pointer update) is the commit point.
 *     Only after it succeeds is the previous body object deleted.
 *  3. If the transaction fails (conflict or error), the new object is deleted again.
 *  4. Every body is stored with its SHA-256; a read that does not match is refused.
 *
 * Other rules:
 * - The uid always comes from the verified session, never from the request body.
 * - `revision` increases on every save; an update with an old baseRevision gets 409.
 */
import { Firestore } from '@google-cloud/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { BlobStore, projectPrefix, safeSegment } from './blobStore';

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  sizeBytes: number;
  bodyLocation: 'firestore' | 'gcs';
}

export class ConflictError extends Error {
  constructor(public cloudRevision: number) {
    super(`Cloud copy changed (cloud revision ${cloudRevision}). Load it or overwrite on purpose.`);
  }
}
export class NotFoundError extends Error {}
export class IntegrityError extends Error {}

const MAX_INLINE_BODY = 800 * 1024;
const BODY_DIR = '_body/';

export interface ProjectStore {
  list(uid: string): Promise<ProjectMeta[]>;
  get(uid: string, id: string): Promise<{ meta: ProjectMeta; project: Record<string, unknown> }>;
  /** mode 'create' fails if the project exists; 'update' checks baseRevision unless force. */
  save(
    uid: string,
    id: string,
    project: Record<string, unknown>,
    opts: { mode: 'create' | 'update'; baseRevision?: number; force?: boolean }
  ): Promise<ProjectMeta>;
  delete(uid: string, id: string): Promise<void>;
}

interface StoredDoc {
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
  sizeBytes?: number;
  bodyLocation?: 'firestore' | 'gcs';
  body?: string | null;
  bodyKey?: string | null;
  bodySha256?: string | null;
  ownerUid?: string;
}

export class FirestoreProjectStore implements ProjectStore {
  constructor(
    private db: Pick<Firestore, 'collection' | 'runTransaction'>,
    private blobs: BlobStore
  ) {}

  private col(uid: string) {
    return this.db.collection('users').doc(safeSegment(uid)).collection('projects');
  }

  private toMeta(id: string, d: StoredDoc): ProjectMeta {
    return {
      id,
      title: String(d.title ?? ''),
      createdAt: String(d.createdAt ?? ''),
      updatedAt: String(d.updatedAt ?? ''),
      revision: Number(d.revision ?? 0),
      sizeBytes: Number(d.sizeBytes ?? 0),
      bodyLocation: d.bodyLocation === 'gcs' ? 'gcs' : 'firestore',
    };
  }

  async list(uid: string) {
    const snap = await this.col(uid).orderBy('updatedAt', 'desc').limit(500).get();
    return snap.docs.map((d) => this.toMeta(d.id, d.data() as StoredDoc));
  }

  async get(uid: string, id: string) {
    const doc = await this.col(uid).doc(safeSegment(id)).get();
    if (!doc.exists) throw new NotFoundError('Project not found in cloud.');
    const data = doc.data() as StoredDoc;
    const meta = this.toMeta(doc.id, data);
    let json: string;
    if (meta.bodyLocation === 'gcs') {
      // Documents saved before this version used the fixed name project.json.
      const key = data.bodyKey || `${projectPrefix(uid, id)}project.json`;
      json = (await this.blobs.readBuffer(key)).toString('utf8');
      if (data.bodySha256 && sha256(json) !== data.bodySha256) {
        throw new IntegrityError('Stored project data does not match its checksum. It was NOT loaded. Contact the owner.');
      }
    } else {
      json = String(data.body ?? '{}');
    }
    return { meta, project: JSON.parse(json) as Record<string, unknown> };
  }

  async save(
    uid: string,
    id: string,
    project: Record<string, unknown>,
    opts: { mode: 'create' | 'update'; baseRevision?: number; force?: boolean }
  ) {
    const ref = this.col(uid).doc(safeSegment(id));
    const json = JSON.stringify(project);
    const sizeBytes = Buffer.byteLength(json);
    const bodyLocation: ProjectMeta['bodyLocation'] = sizeBytes > MAX_INLINE_BODY ? 'gcs' : 'firestore';
    const now = new Date().toISOString();

    // Fast rejection before any upload (the transaction below re-checks atomically).
    const pre = await ref.get();
    if (opts.mode === 'create' && pre.exists) throw new ConflictError(Number(pre.data()?.revision ?? 0));
    if (opts.mode === 'update' && pre.exists && !opts.force && opts.baseRevision !== undefined) {
      const cur = Number(pre.data()?.revision ?? 0);
      if (cur !== opts.baseRevision) throw new ConflictError(cur);
    }

    // Large body: a brand-new object. The current object is never touched here.
    const newKey = bodyLocation === 'gcs' ? `${projectPrefix(uid, id)}${BODY_DIR}${randomUUID()}.json` : null;
    if (newKey) {
      await this.blobs.put(newKey, Buffer.from(json), 'application/json');
    }

    let previousKey: string | null = null;
    let meta: ProjectMeta;
    try {
      meta = await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const old = snap.exists ? (snap.data() as StoredDoc) : undefined;
        if (opts.mode === 'create' && old) throw new ConflictError(Number(old.revision ?? 0));
        const current = old ? Number(old.revision ?? 0) : 0;
        if (opts.mode === 'update' && old && !opts.force && opts.baseRevision !== undefined && opts.baseRevision !== current) {
          throw new ConflictError(current);
        }
        previousKey = old?.bodyLocation === 'gcs' ? old.bodyKey || `${projectPrefix(uid, id)}project.json` : null;
        const doc: StoredDoc = {
          title: String(project.title ?? 'Untitled').slice(0, 200),
          ownerUid: uid,
          createdAt: old ? String(old.createdAt ?? now) : now,
          updatedAt: now,
          revision: current + 1,
          sizeBytes,
          bodyLocation,
          body: bodyLocation === 'firestore' ? json : null,
          bodyKey: newKey,
          bodySha256: bodyLocation === 'gcs' ? sha256(json) : null,
        };
        tx.set(ref, doc);
        return this.toMeta(ref.id, doc);
      });
    } catch (err) {
      // Commit did not happen: remove the orphan object, the current copy is untouched.
      if (newKey) await this.blobs.delete(newKey).catch(() => undefined);
      throw err;
    }

    // Commit succeeded: the previous body object is no longer referenced.
    if (previousKey && previousKey !== newKey) await this.blobs.delete(previousKey).catch(() => undefined);
    return meta;
  }

  async delete(uid: string, id: string) {
    const ref = this.col(uid).doc(safeSegment(id));
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundError('Project not found in cloud.');
    await ref.delete();
    await this.blobs.deletePrefix(projectPrefix(uid, id));
  }
}

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

export const BODY_FOLDER = BODY_DIR;
