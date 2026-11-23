/**
 * Background-queue adapter (interface only; no Cloud resource is created by this project).
 *
 * Today job progress is advanced when the browser polls GET /api/generate/video-status/:id
 * ("inline" mode). The job itself is already durable in Firestore, so a restart loses nothing.
 *
 * To make jobs progress with no browser open, implement `JobQueue` with Cloud Tasks or Pub/Sub:
 *   enqueuePoll({uid, jobId}, delaySec)  ->  create a task that calls a private, authenticated
 *   endpoint which runs the same `advanceJob()` step as the status endpoint.
 * Then select it with JOB_QUEUE=cloud-tasks (not implemented yet: config.ts refuses it).
 */
export interface JobQueue {
  readonly kind: 'inline' | 'cloud-tasks' | 'pubsub';
  enqueuePoll(job: { uid: string; jobId: string }, delaySec: number): Promise<void>;
}

/** Default: nothing is scheduled; the browser's status polling drives progress. */
export class InlineJobQueue implements JobQueue {
  readonly kind = 'inline' as const;
  async enqueuePoll(): Promise<void> {
    // intentionally empty
  }
}

export const SUPPORTED_QUEUES = ['inline'] as const;
