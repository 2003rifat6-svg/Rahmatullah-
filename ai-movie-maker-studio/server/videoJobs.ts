/**
 * Video job lifecycle (start / advance / cancel). Express-free so it can be tested directly.
 * All state lives in the JobStore; nothing important is kept in memory.
 */
import { createHash } from 'node:crypto';
import { BlobStore, projectPrefix, safeSegment } from './blobStore';
import { JobStore, VideoJob } from './jobStore';
import { InlineImage, StudioAiProvider } from './provider';
import { JobQueue } from './queue';
import { safeErrorMessage } from './redact';

export interface VideoJobDeps {
  provider: StudioAiProvider;
  jobs: JobStore;
  blobs: BlobStore;
  /** Minimum time between provider polls of one job (also the poll lease). */
  pollIntervalMs: number;
  /** A job that never reached the provider within this time is failed (server stopped mid-start). */
  queuedTimeoutMs: number;
  /** Consecutive poll/save errors before the job is failed. */
  maxPollErrors: number;
  mediaRoute: string;
  queue?: JobQueue;
  now?: () => number;
}

export interface StartVideoInput {
  uid: string;
  projectId: string;
  sceneId: string;
  shotId: string;
  linkedImageKey: string;
  idempotencyKey: string;
  prompt: string;
  startFrame: InlineImage;
  aspectRatio?: string;
  resolution?: string;
  durationSec?: number;
  retryOf?: string | null;
  /** Called only when this call creates a NEW job, before the paid provider call (quota). May throw. */
  reserve?: () => Promise<void>;
}

export interface StartVideoResult {
  job: VideoJob;
  /** true only when THIS call created the job and submitted it to the provider. */
  started: boolean;
  /** An existing job was returned (same idempotency key, or the shot already has an active job). */
  reused?: 'idempotent' | 'active';
}

const now = (d: VideoJobDeps) => (d.now ? d.now() : Date.now());

export async function startVideoJob(deps: VideoJobDeps, input: StartVideoInput): Promise<StartVideoResult> {
  const { job, created, reason } = await deps.jobs.createOrGet({
    uid: input.uid,
    projectId: input.projectId,
    sceneId: input.sceneId,
    shotId: input.shotId,
    linkedImageKey: input.linkedImageKey,
    idempotencyKey: input.idempotencyKey,
    retryOf: input.retryOf ?? null,
    request: {
      promptHash: createHash('sha256').update(input.prompt).digest('hex').slice(0, 24),
      promptPreview: input.prompt.slice(0, 120),
      aspectRatio: input.aspectRatio ?? null,
      resolution: input.resolution ?? null,
      durationSec: input.durationSec ?? null,
    },
  });
  // Atomic dedupe happened BEFORE the paid provider call: reused jobs never call the provider again.
  if (!created) return { job, started: false, reused: reason };

  if (input.reserve) {
    try {
      await input.reserve();
    } catch (err) {
      // No paid call happens: release the shot so the user can try again later.
      await deps.jobs.update(input.uid, job.id, (j) =>
        ACTIVE.has(j.status)
          ? { status: 'failed', error: { code: 'quota_exceeded', message: safeErrorMessage(err) }, finishedAt: new Date(now(deps)).toISOString() }
          : null
      );
      throw err;
    }
  }

  try {
    const { operationName } = await deps.provider.startVideo({
      prompt: input.prompt,
      startFrame: input.startFrame,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      durationSeconds: input.durationSec,
    });
    const t = new Date(now(deps)).toISOString();
    const running = await deps.jobs.update(input.uid, job.id, (j) =>
      j.status === 'queued' ? { status: 'running', operationName, startedAt: t, leaseUntil: 0 } : null
    );
    await deps.queue?.enqueuePoll({ uid: input.uid, jobId: job.id }, Math.ceil(deps.pollIntervalMs / 1000)).catch(() => undefined);
    return { job: running ?? job, started: true };
  } catch (err) {
    const failed = await deps.jobs.update(input.uid, job.id, (j) =>
      ACTIVE.has(j.status)
        ? { status: 'failed', error: { code: 'provider_start_failed', message: safeErrorMessage(err) }, finishedAt: new Date(now(deps)).toISOString() }
        : null
    );
    return { job: failed ?? job, started: false };
  }
}

const ACTIVE = new Set(['queued', 'running']);

/** Moves a job forward by at most one provider poll. Safe to call from any instance at any time. */
export async function advanceJob(deps: VideoJobDeps, uid: string, id: string): Promise<VideoJob | null> {
  let job = await deps.jobs.get(uid, id);
  if (!job) return null;
  const t = now(deps);

  if (job.status === 'queued' && !job.operationName && t - Date.parse(job.createdAt) >= deps.queuedTimeoutMs) {
    return (
      (await deps.jobs.update(uid, id, (j) =>
        j.status === 'queued' && !j.operationName
          ? {
              status: 'failed',
              error: { code: 'submission_interrupted', message: 'The server stopped before this video request was confirmed. Please generate this shot again.' },
              finishedAt: new Date(t).toISOString(),
            }
          : null
      )) ?? job
    );
  }
  if (job.status !== 'running' || !job.operationName) return job;

  const claimed = await deps.jobs.claimPoll(uid, id, deps.pollIntervalMs, t);
  if (!claimed) return job; // another poll is recent / in progress

  try {
    const r = await deps.provider.pollVideo(claimed.operationName!);
    if (!r.done) {
      job = (await deps.jobs.update(uid, id, (j) => (j.status === 'running' ? { pollErrors: 0 } : null))) ?? claimed;
      return job;
    }
    if (!r.ok) {
      return (
        (await deps.jobs.update(uid, id, (j) =>
          j.status === 'running'
            ? { status: 'failed', error: { code: 'provider_failed', message: safeErrorMessage(r.error) }, finishedAt: new Date().toISOString(), leaseUntil: 0 }
            : null
        )) ?? claimed
      );
    }
    const bytes = r.video.bytes ?? (await deps.provider.fetchVideoUri(r.video.uri!));
    // One deterministic object per job: repeating this step overwrites the same file, never duplicates.
    const key = `${projectPrefix(uid, claimed.projectId)}videos/${safeSegment(claimed.sceneId)}_${safeSegment(claimed.shotId)}_${claimed.id}.mp4`;
    await deps.blobs.put(key, bytes, r.video.mimeType || 'video/mp4');
    const done = await deps.jobs.update(uid, id, (j) =>
      j.status === 'running'
        ? { status: 'completed', result: { videoUrl: `${deps.mediaRoute}${key}`, key }, error: null, pollErrors: 0, finishedAt: new Date().toISOString(), leaseUntil: 0 }
        : null
    );
    if (!done || done.status !== 'completed') await deps.blobs.delete(key).catch(() => undefined); // cancelled meanwhile
    return done ?? claimed;
  } catch (err) {
    const msg = safeErrorMessage(err);
    return (
      (await deps.jobs.update(uid, id, (j) => {
        if (j.status !== 'running') return null;
        const errors = j.pollErrors + 1;
        return errors >= deps.maxPollErrors
          ? { status: 'failed', pollErrors: errors, error: { code: 'poll_failed', message: `Could not complete the video after ${errors} attempts: ${msg}` }, finishedAt: new Date().toISOString(), leaseUntil: 0 }
          : { pollErrors: errors };
      })) ?? claimed
    );
  }
}

/**
 * Marks an active job cancelled. The provider cannot be told to stop (the Veo API has no cancel),
 * so a request that was already accepted may still be billed; its result is discarded.
 */
export async function cancelJob(deps: VideoJobDeps, uid: string, id: string): Promise<VideoJob | null> {
  return deps.jobs.update(uid, id, (j) =>
    ACTIVE.has(j.status)
      ? { status: 'cancelled', error: { code: 'cancelled', message: 'Cancelled by the user.' }, finishedAt: new Date(now(deps)).toISOString(), leaseUntil: 0 }
      : null
  );
}
