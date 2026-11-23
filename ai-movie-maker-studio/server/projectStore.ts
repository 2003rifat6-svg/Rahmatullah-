/**
 * Cloud project storage in Firestore.
 *
 * Layout:  users/{uid}/projects/{projectId}
 *   { title, ownerUid, createdAt, updatedAt, revision, sizeBytes, bodyLocation, body? }
 *
 * - The uid always comes from the verified session, never from the request body,
 *   so a user can only ever read or write their own sub-collection.
 * - Firestore documents are limited to 1 MiB. Media (data: URLs) is moved to GCS before
 *   saving (see app.ts), and if the JSON is still too large the body is stored in GCS.
 * - `revision` increases on every save; an update with an old baseRevision gets 409.
 */
import { Firestore } from '@google-cloud/firestore';
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

const MAX_INLINE_BODY = 800 * 1024;

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

export class FirestoreProjectStore implements ProjectStore {
  constructor(
    private db: Firestore,
    private blobs: BlobStore
  ) {}

  private col(uid: string) {
    return this.db.collection('users').doc(safeSegment(uid)).collection('projects');
  }

  private toMeta(id: string, d: FirebaseFirestore.DocumentData): ProjectMeta {
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
    return snap.docs.map((d) => this.toMeta(d.id, d.data()));
  }

  async get(uid: string, id: string) {
    const doc = await this.col(uid).doc(safeSegment(id)).get();
    if (!doc.exists) throw new NotFoundError('Project not found in cloud.');
    const data = doc.data()!;
    const meta = this.toMeta(doc.id, data);
    const json =
      meta.bodyLocation === 'gcs'
        ? (await this.blobs.readBuffer(`${projectPrefix(uid, id)}project.json`)).toString('utf8')
        : String(data.body ?? '{}');
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

    // Large bodies go to GCS first; the Firestore transaction below is the commit point.
    if (bodyLocation === 'gcs') {
      await this.blobs.put(`${projectPrefix(uid, id)}project.json`, Buffer.from(json), 'application/json');
    }

    const meta = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (opts.mode === 'create' && snap.exists) {
        throw new ConflictError(Number(snap.data()?.revision ?? 0));
      }
      const current = snap.exists ? Number(snap.data()?.revision ?? 0) : 0;
      if (opts.mode === 'update' && snap.exists && !opts.force && opts.baseRevision !== undefined && opts.baseRevision !== current) {
        throw new ConflictError(current);
      }
      const doc = {
        title: String(project.title ?? 'Untitled').slice(0, 200),
        ownerUid: uid,
        createdAt: snap.exists ? String(snap.data()?.createdAt ?? now) : now,
        updatedAt: now,
        revision: current + 1,
        sizeBytes,
        bodyLocation,
        ...(bodyLocation === 'firestore' ? { body: json } : { body: null }),
      };
      tx.set(ref, doc);
      return this.toMeta(ref.id, doc);
    });

    if (bodyLocation === 'firestore') {
      await this.blobs.delete(`${projectPrefix(uid, id)}project.json`).catch(() => undefined);
    }
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
