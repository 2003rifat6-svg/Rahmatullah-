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
 * - `revision` increases on every save. An update MUST carry the baseRevision it was based on;
 *   a missing baseRevision is rejected and a mismatch is a conflict (409). There is no blind
 *   overwrite: "overwrite" means re-sending with the cloud's current revision after the user
 *   confirmed, and a newer change in between conflicts again.
 * - Delete is two-phase (mark `deleting` -> remove files -> remove document). While a project is
 *   `deleting`, saves are refused, reads answer "not found", and an interrupted delete is resumed.
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
  constructor(
    public cloudRevision: number,
    public cloudUpdatedAt?: string
  ) {
    super(`The cloud copy changed since you last loaded it (cloud revision ${cloudRevision}). Nothing was overwritten.`);
  }
}
export class NotFoundError extends Error {}
export class IntegrityError extends Error {}
export class ValidationError extends Error {}
export class ProjectDeletingError extends Error {
  constructor() {
    super('This cloud project is being deleted, so it cannot be saved right now.');
  }
}

const MAX_INLINE_BODY = 800 * 1024;
const BODY_DIR = '_body/';

export interface ProjectStore {
  list(uid: string): Promise<ProjectMeta[]>;
  get(uid: string, id: string): Promise<{ meta: ProjectMeta; project: Record<string, unknown> }>;
  /** 'create' fails if the project exists; 'update' needs the baseRevision and never creates. */
  save(
    uid: string,
    id: string,
    project: Record<string, unknown>,
    opts: { mode: 'create' } | { mode: 'update'; baseRevision: number }
  ): Promise<ProjectMeta>;
  delete(uid: string, id: string): Promise<void>;
  /** Throws ProjectDeletingError if the project is being deleted (used before uploading media). */
  assertWritable(uid: string, id: string): Promise<void>;
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
  status?: 'active' | 'deleting';
  deletingAt?: string;
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
    const stuck = snap.docs.filter((d) => (d.data() as StoredDoc).status === 'deleting').map((d) => d.id);
    // Recovery: an interrupted delete is finished in the background the next time the user lists projects.
    if (stuck.length > 0) void this.resumeDeletes(uid, stuck).catch(() => undefined);
    return snap.docs.filter((d) => (d.data() as StoredDoc).status !== 'deleting').map((d) => this.toMeta(d.id, d.data() as StoredDoc));
  }

  /** Finishes deletes that were interrupted (crash between removing files and removing the document). */
  async resumeDeletes(uid: string, ids?: string[]) {
    const targets =
      ids ??
      (await this.col(uid).get()).docs.filter((d) => (d.data() as StoredDoc).status === 'deleting').map((d) => d.id);
    for (const id of targets) await this.delete(uid, id, { resumeOnly: true }).catch(() => undefined);
    return targets.length;
  }

  async assertWritable(uid: string, id: string) {
    const doc = await this.col(uid).doc(safeSegment(id)).get();
    if (doc.exists && (doc.data() as StoredDoc).status === 'deleting') throw new ProjectDeletingError();
  }

  async get(uid: string, id: string) {
    const doc = await this.col(uid).doc(safeSegment(id)).get();
    if (!doc.exists || (doc.data() as StoredDoc).status === 'deleting') throw new NotFoundError('Project not found in cloud.');
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
    opts: { mode: 'create' } | { mode: 'update'; baseRevision: number }
  ) {
    if (opts.mode === 'update' && !(Number.isInteger(opts.baseRevision) && opts.baseRevision >= 1)) {
      throw new ValidationError('baseRevision is required for an update (the cloud revision this change is based on).');
    }
    const ref = this.col(uid).doc(safeSegment(id));
    const json = JSON.stringify(project);
    const sizeBytes = Buffer.byteLength(json);
    const bodyLocation: ProjectMeta['bodyLocation'] = sizeBytes > MAX_INLINE_BODY ? 'gcs' : 'firestore';
    const now = new Date().toISOString();

    const check = (old: StoredDoc | undefined) => {
      if (old?.status === 'deleting') throw new ProjectDeletingError();
      if (opts.mode === 'create') {
        if (old) throw new ConflictError(Number(old.revision ?? 0), old.updatedAt);
      } else {
        if (!old) throw new NotFoundError('The cloud copy no longer exists (it was deleted).');
        if (Number(old.revision ?? 0) !== opts.baseRevision) throw new ConflictError(Number(old.revision ?? 0), old.updatedAt);
      }
    };

    // Fast rejection before any upload (the transaction below re-checks atomically).
    const pre = await ref.get();
    check(pre.exists ? (pre.data() as StoredDoc) : undefined);

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
        check(old);
        const current = old ? Number(old.revision ?? 0) : 0;
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
          status: 'active',
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
    // Housekeeping for orphans left by crashes (never touches recent objects of in-flight saves).
    void this.sweepOrphans(uid, id).catch(() => undefined);
    return meta;
  }

  /** Deletes `_body/` objects that the project document does not reference and that are old enough. */
  async sweepOrphans(uid: string, id: string, opts: { minAgeMs?: number } = {}) {
    const minAge = opts.minAgeMs ?? 15 * 60_000;
    const snap = await this.col(uid).doc(safeSegment(id)).get();
    const keep = snap.exists ? (snap.data() as StoredDoc).bodyKey : null;
    const now = Date.now();
    let removed = 0;
    for (const o of await this.blobs.list(`${projectPrefix(uid, id)}${BODY_DIR}`)) {
      if (o.key === keep) continue;
      if (now - Date.parse(o.updated || '') < minAge) continue;
      await this.blobs.delete(o.key);
      removed += 1;
    }
    return removed;
  }

  /**
   * Two-phase delete. `resumeOnly` is used by recovery: it continues only a project that is
   * already `deleting`, so a project re-created in the meantime is never touched.
   */
  async delete(uid: string, id: string, opts: { resumeOnly?: boolean } = {}) {
    const ref = this.col(uid).doc(safeSegment(id));
    const prefix = projectPrefix(uid, id);
    // Phase 1: mark. From now on saves are refused and reads answer "not found".
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError('Project not found in cloud.');
      const status = (snap.data() as StoredDoc).status;
      if (status !== 'deleting') {
        if (opts.resumeOnly) throw new NotFoundError('Nothing to resume.');
        tx.update(ref, { status: 'deleting', deletingAt: new Date().toISOString() });
      }
    });
    // Phase 2: remove the files. If this fails the project stays hidden + 'deleting' and is resumed later.
    await this.blobs.deletePrefix(prefix);
    // Phase 3: remove the document (only while it is still `deleting`).
    // No "final sweep" afterwards: a save that raced with the delete removes its own new object when
    // its commit is refused, and a sweep could destroy a project re-created with the same id.
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && (snap.data() as StoredDoc).status === 'deleting') tx.delete(ref);
    });
  }
}

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

export const BODY_FOLDER = BODY_DIR;
