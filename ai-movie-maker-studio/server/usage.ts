/**
 * Durable usage counters for rate limits and quotas.
 *
 * Fixed windows (a minute, a day) stored per user:
 *   Firestore (production):  users/{uid}/usage/{key}__{windowStart}  { count, expiresAt }
 *   local files (dev):       users/{uid}/_usage/...json
 * Counters survive restarts and are shared by every server instance. A request is allowed only if
 * ALL its limits have room; then all counters are incremented in ONE transaction (no partial use).
 * Rejected requests do not write anything.
 *
 * Fixed windows can allow a short burst around a window boundary; the per-minute AND per-day
 * limits together keep the spend bounded. Enable a Firestore TTL policy on `expiresAt` to remove old counters.
 */
import { Firestore } from '@google-cloud/firestore';
import { BlobStore, safeSegment } from './blobStore';

export interface LimitSpec {
  /** Counter name, e.g. "video:min" or "project:p1:video:day". */
  key: string;
  max: number;
  windowSec: number;
  /** Human words used in the error message, e.g. "video generations per day". */
  label: string;
}

export type ConsumeResult =
  | { allowed: true; remaining: number }
  | { allowed: false; key: string; label: string; limit: number; windowSec: number; retryAfterSec: number; resetAt: string };

export interface UsageStore {
  readonly kind: 'firestore' | 'local-file';
  consume(uid: string, specs: LimitSpec[], now?: number): Promise<ConsumeResult>;
  /** Current counts (for tests / a usage page). */
  read(uid: string, spec: LimitSpec, now?: number): Promise<number>;
}

const windowStart = (now: number, windowSec: number) => Math.floor(now / (windowSec * 1000)) * windowSec * 1000;
const docId = (spec: LimitSpec, start: number) => `${safeSegment(spec.key)}__${start}`;

function decide(specs: LimitSpec[], counts: number[], now: number): ConsumeResult {
  let remaining = Infinity;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    if (counts[i] + 1 > s.max) {
      const resetMs = windowStart(now, s.windowSec) + s.windowSec * 1000;
      return {
        allowed: false,
        key: s.key,
        label: s.label,
        limit: s.max,
        windowSec: s.windowSec,
        retryAfterSec: Math.max(1, Math.ceil((resetMs - now) / 1000)),
        resetAt: new Date(resetMs).toISOString(),
      };
    }
    remaining = Math.min(remaining, s.max - counts[i] - 1);
  }
  return { allowed: true, remaining };
}

export class FirestoreUsageStore implements UsageStore {
  readonly kind = 'firestore' as const;
  constructor(private db: Pick<Firestore, 'collection' | 'runTransaction'>) {}
  private col(uid: string) {
    return this.db.collection('users').doc(safeSegment(uid)).collection('usage');
  }
  async consume(uid: string, specs: LimitSpec[], now = Date.now()): Promise<ConsumeResult> {
    const refs = specs.map((s) => this.col(uid).doc(docId(s, windowStart(now, s.windowSec))));
    return this.db.runTransaction(async (tx) => {
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const counts = snaps.map((s) => (s.exists ? Number(s.data()!.count || 0) : 0));
      const result = decide(specs, counts, now);
      if (!result.allowed) return result;
      specs.forEach((s, i) => {
        const start = windowStart(now, s.windowSec);
        tx.set(refs[i], {
          key: s.key,
          count: counts[i] + 1,
          windowStart: start,
          windowSec: s.windowSec,
          expiresAt: new Date(start + s.windowSec * 1000 + 3600_000),
        });
      });
      return result;
    });
  }
  async read(uid: string, spec: LimitSpec, now = Date.now()) {
    const snap = await this.col(uid).doc(docId(spec, windowStart(now, spec.windowSec))).get();
    return snap.exists ? Number(snap.data()!.count || 0) : 0;
  }
}

/** Development store: counters in JSON files (survive restarts; one server process only). */
export class BlobUsageStore implements UsageStore {
  readonly kind = 'local-file' as const;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private blobs: BlobStore) {}
  private key(uid: string, id: string) {
    return `users/${safeSegment(uid)}/_usage/${id}.json`;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async count(uid: string, id: string) {
    const k = this.key(uid, id);
    if (!(await this.blobs.stat(k))) return 0;
    return Number(JSON.parse((await this.blobs.readBuffer(k)).toString('utf8')).count || 0);
  }
  consume(uid: string, specs: LimitSpec[], now = Date.now()): Promise<ConsumeResult> {
    return this.serial(async () => {
      const ids = specs.map((s) => docId(s, windowStart(now, s.windowSec)));
      const counts = await Promise.all(ids.map((id) => this.count(uid, id)));
      const result = decide(specs, counts, now);
      if (!result.allowed) return result;
      await Promise.all(ids.map((id, i) => this.blobs.put(this.key(uid, id), Buffer.from(JSON.stringify({ count: counts[i] + 1 })), 'application/json')));
      return result;
    });
  }
  read(uid: string, spec: LimitSpec, now = Date.now()) {
    return this.serial(() => this.count(uid, docId(spec, windowStart(now, spec.windowSec))));
  }
}

export class QuotaError extends Error {
  constructor(public detail: Extract<ConsumeResult, { allowed: false }>) {
    super(quotaMessage(detail));
  }
}

export function quotaMessage(d: Extract<ConsumeResult, { allowed: false }>): string {
  const when = d.retryAfterSec >= 3600 ? `after ${d.resetAt.slice(0, 16).replace('T', ' ')} UTC` : `in ${d.retryAfterSec} second(s)`;
  return `Limit reached: ${d.limit} ${d.label}. Please try again ${when}. / সীমা শেষ: ${d.label} (${d.limit}); পরে আবার চেষ্টা করুন।`;
}

// ---- limits per endpoint group (env-configurable) ----
export interface QuotaConfig {
  chat: { perMin: number; perDay: number };
  image: { perMin: number; perDay: number };
  video: { perMin: number; perDay: number };
  story: { perMin: number; perDay: number };
  project: { imagePerDay: number; videoPerDay: number };
}

export function quotaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): QuotaConfig {
  const n = (name: string, def: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 1) throw new Error(`${name} must be a positive whole number (got "${raw}").`);
    return v;
  };
  return {
    chat: { perMin: n('QUOTA_CHAT_PER_MIN', 20), perDay: n('QUOTA_CHAT_PER_DAY', 300) },
    image: { perMin: n('QUOTA_IMAGE_PER_MIN', 30), perDay: n('QUOTA_IMAGE_PER_DAY', 400) },
    video: { perMin: n('QUOTA_VIDEO_PER_MIN', 4), perDay: n('QUOTA_VIDEO_PER_DAY', 40) },
    story: { perMin: n('QUOTA_STORY_PER_MIN', 3), perDay: n('QUOTA_STORY_PER_DAY', 30) },
    project: { imagePerDay: n('QUOTA_PROJECT_IMAGE_PER_DAY', 200), videoPerDay: n('QUOTA_PROJECT_VIDEO_PER_DAY', 20) },
  };
}

export type QuotaGroup = 'chat' | 'image' | 'video' | 'story';

/** The limits one request of `group` must pass: per user (minute + day) and, if known, per project (day). */
export function limitsFor(cfg: QuotaConfig, group: QuotaGroup, projectId?: string): LimitSpec[] {
  const g = cfg[group];
  const names: Record<QuotaGroup, string> = { chat: 'AI chat messages', image: 'image generations', video: 'video generations', story: 'story analyses' };
  const specs: LimitSpec[] = [
    { key: `${group}:min`, max: g.perMin, windowSec: 60, label: `${names[group]} per minute` },
    { key: `${group}:day`, max: g.perDay, windowSec: 86400, label: `${names[group]} per day` },
  ];
  if (projectId && (group === 'image' || group === 'video')) {
    specs.push({
      key: `project:${safeSegment(projectId)}:${group}:day`,
      max: group === 'image' ? cfg.project.imagePerDay : cfg.project.videoPerDay,
      windowSec: 86400,
      label: `${names[group]} per day for this project`,
    });
  }
  return specs;
}
