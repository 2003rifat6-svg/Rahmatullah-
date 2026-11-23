/**
 * Durable video-job tracking.
 *
 * Firestore layout (production):
 *   users/{uid}/jobs/{jobId}          the job document
 *   users/{uid}/jobLocks/{lockKey}    points to the currently active job of one shot
 *
 * Why it survives restarts: everything needed to continue a job (provider operation name,
 * Scene/Shot mapping, status, result, error) is in the document. Any instance can pick the
 * job up again by polling the provider with the stored operation name.
 *
 * Idempotency: jobId = hash(uid + idempotencyKey). Creating the same job twice returns the
 * existing one (no second paid provider call). A shot that already has a queued/running job
 * also returns that job.
 */
import { Firestore } from '@google-cloud/firestore';
import { createHash } from 'node:crypto';
import { BlobStore, safeSegment } from './blobStore';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set(['queued', 'running']);

export interface VideoJob {
  id: string;
  uid: string;
  kind: 'video';
  projectId: string;
  sceneId: string;
  shotId: string;
  linkedImageKey: string;
  status: JobStatus;
  idempotencyKey: string;
  /** Provider (Veo) long-running operation name; null until the provider accepted the request. */
  operationName: string | null;
  request: { promptHash: string; promptPreview: string; aspectRatio: string | null; resolution: string | null; durationSec: number | null };
  result: { videoUrl: string; key: string } | null;
  error: { message: string; code: string } | null;
  pollErrors: number;
  retryOf: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Epoch ms: no instance polls the provider for this job before this time (poll lease). */
  leaseUntil: number;
  /** Lets Firestore TTL remove old jobs (enable a TTL policy on this field). */
  expiresAt: Date;
}

export type NewVideoJob = Pick<VideoJob, 'uid' | 'projectId' | 'sceneId' | 'shotId' | 'linkedImageKey' | 'idempotencyKey' | 'request' | 'retryOf'>;

export interface CreateOrGetResult {
  job: VideoJob;
  created: boolean;
  /** Why an existing job was returned instead of creating a new one. */
  reason?: 'idempotent' | 'active';
}

export interface JobStore {
  readonly kind: 'firestore' | 'local-file';
  createOrGet(input: NewVideoJob): Promise<CreateOrGetResult>;
  get(uid: string, id: string): Promise<VideoJob | null>;
  /**
   * Atomic read-modify-write. `mutator` gets the current job and returns the fields to change,
   * or null to leave it untouched (e.g. the job was cancelled in the meantime).
   */
  update(uid: string, id: string, mutator: (job: VideoJob) => Partial<VideoJob> | null): Promise<VideoJob | null>;
  listByProject(uid: string, projectId: string, limit?: number): Promise<VideoJob[]>;
  /** Returns the job if this caller now owns the poll lease, else null. */
  claimPoll(uid: string, id: string, leaseMs: number, now?: number): Promise<VideoJob | null>;
}

export function jobIdFor(uid: string, idempotencyKey: string): string {
  return `vj_${createHash('sha256').update(`${uid}\n${idempotencyKey}`).digest('hex').slice(0, 32)}`;
}

export function lockKeyFor(projectId: string, sceneId: string, shotId: string): string {
  return `${safeSegment(projectId)}__${safeSegment(sceneId)}__${safeSegment(shotId)}`;
}

const JOB_TTL_MS = 30 * 86400_000;

function buildJob(input: NewVideoJob, now: Date): VideoJob {
  return {
    id: jobIdFor(input.uid, input.idempotencyKey),
    kind: 'video',
    status: 'queued',
    operationName: null,
    result: null,
    error: null,
    pollErrors: 0,
    startedAt: null,
    finishedAt: null,
    leaseUntil: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + JOB_TTL_MS),
    ...input,
  };
}

function fromDoc(d: FirebaseFirestore.DocumentData): VideoJob {
  const exp = d.expiresAt;
  return { ...(d as VideoJob), expiresAt: exp && typeof exp.toDate === 'function' ? exp.toDate() : new Date(exp) };
}

/** Production store: Firestore transactions give atomic idempotency and state changes. */
export class FirestoreJobStore implements JobStore {
  readonly kind = 'firestore' as const;
  constructor(private db: Pick<Firestore, 'collection' | 'runTransaction'>) {}

  private jobs(uid: string) {
    return this.db.collection('users').doc(safeSegment(uid)).collection('jobs');
  }
  private locks(uid: string) {
    return this.db.collection('users').doc(safeSegment(uid)).collection('jobLocks');
  }

  async createOrGet(input: NewVideoJob): Promise<CreateOrGetResult> {
    const job = buildJob(input, new Date());
    const ref = this.jobs(input.uid).doc(job.id);
    const lockRef = this.locks(input.uid).doc(lockKeyFor(input.projectId, input.sceneId, input.shotId));
    return this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return { job: fromDoc(existing.data()!), created: false, reason: 'idempotent' as const };
      const lock = await tx.get(lockRef);
      if (lock.exists) {
        const activeSnap = await tx.get(this.jobs(input.uid).doc(String(lock.data()!.jobId)));
        if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.data()!.status)) {
          return { job: fromDoc(activeSnap.data()!), created: false, reason: 'active' as const };
        }
      }
      tx.set(ref, job);
      tx.set(lockRef, { jobId: job.id, updatedAt: job.createdAt });
      return { job, created: true };
    });
  }

  async get(uid: string, id: string) {
    const snap = await this.jobs(uid).doc(safeSegment(id)).get();
    return snap.exists ? fromDoc(snap.data()!) : null;
  }

  async update(uid: string, id: string, mutator: (job: VideoJob) => Partial<VideoJob> | null) {
    const ref = this.jobs(uid).doc(safeSegment(id));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const current = fromDoc(snap.data()!);
      const patch = mutator(current);
      if (!patch) return current;
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      tx.set(ref, next);
      return next;
    });
  }

  async listByProject(uid: string, projectId: string, limit = 200) {
    const snap = await this.jobs(uid).where('projectId', '==', projectId).limit(limit).get();
    return snap.docs.map((d) => fromDoc(d.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async claimPoll(uid: string, id: string, leaseMs: number, now = Date.now()) {
    const ref = this.jobs(uid).doc(safeSegment(id));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = fromDoc(snap.data()!);
      if (job.status !== 'running' || job.leaseUntil > now) return null;
      const next = { ...job, leaseUntil: now + leaseMs };
      tx.set(ref, next);
      return next;
    });
  }
}

/**
 * LOCAL DEVELOPMENT ONLY (no Firestore): jobs are JSON objects in the blob store, so they also
 * survive restarts of a local server. Atomicity is in-process only, so it is NOT safe with
 * several server instances. Cloud Run requires Firestore (see config.ts).
 */
export class BlobJobStore implements JobStore {
  readonly kind = 'local-file' as const;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private blobs: BlobStore) {}

  private key(uid: string, id: string) {
    return `users/${safeSegment(uid)}/_jobs/${safeSegment(id)}.json`;
  }
  private lockKey(uid: string, lock: string) {
    return `users/${safeSegment(uid)}/_jobs/lock_${lock}.json`;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async read(key: string): Promise<VideoJob | null> {
    if (!(await this.blobs.stat(key))) return null;
    const j = JSON.parse((await this.blobs.readBuffer(key)).toString('utf8'));
    return { ...j, expiresAt: new Date(j.expiresAt) };
  }
  private async write(key: string, value: unknown) {
    await this.blobs.put(key, Buffer.from(JSON.stringify(value)), 'application/json');
  }

  createOrGet(input: NewVideoJob): Promise<CreateOrGetResult> {
    return this.serial(async () => {
      const job = buildJob(input, new Date());
      const existing = await this.read(this.key(input.uid, job.id));
      if (existing) return { job: existing, created: false, reason: 'idempotent' as const };
      const lockKey = this.lockKey(input.uid, lockKeyFor(input.projectId, input.sceneId, input.shotId));
      if (await this.blobs.stat(lockKey)) {
        const lock = JSON.parse((await this.blobs.readBuffer(lockKey)).toString('utf8'));
        const active = await this.read(this.key(input.uid, lock.jobId));
        if (active && ACTIVE_STATUSES.has(active.status)) return { job: active, created: false, reason: 'active' as const };
      }
      await this.write(this.key(input.uid, job.id), job);
      await this.write(lockKey, { jobId: job.id });
      return { job, created: true };
    });
  }

  get(uid: string, id: string) {
    return this.serial(() => this.read(this.key(uid, id)));
  }

  update(uid: string, id: string, mutator: (job: VideoJob) => Partial<VideoJob> | null) {
    return this.serial(async () => {
      const current = await this.read(this.key(uid, id));
      if (!current) return null;
      const patch = mutator(current);
      if (!patch) return current;
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await this.write(this.key(uid, id), next);
      return next;
    });
  }

  listByProject(uid: string, projectId: string, limit = 200) {
    return this.serial(async () => {
      const files = await this.blobs.list(`users/${safeSegment(uid)}/_jobs/vj_`);
      const jobs: VideoJob[] = [];
      for (const f of files) {
        const j = await this.read(f.key);
        if (j && j.projectId === projectId) jobs.push(j);
      }
      return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    });
  }

  claimPoll(uid: string, id: string, leaseMs: number, now = Date.now()) {
    return this.serial(async () => {
      const job = await this.read(this.key(uid, id));
      if (!job || job.status !== 'running' || job.leaseUntil > now) return null;
      const next = { ...job, leaseUntil: now + leaseMs };
      await this.write(this.key(uid, id), next);
      return next;
    });
  }
}

/** Fields safe to show the browser (no provider operation name, lease or internal data). */
export function publicJob(job: VideoJob) {
  return {
    jobId: job.id,
    projectId: job.projectId,
    sceneId: job.sceneId,
    shotId: job.shotId,
    linkedImageKey: job.linkedImageKey,
    status: job.status,
    videoUrl: job.result?.videoUrl,
    error: job.error?.message,
    errorCode: job.error?.code,
    retryOf: job.retryOf,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}
