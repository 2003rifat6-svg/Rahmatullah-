/** Production orchestration helpers: job recovery (no paid result is lost), versions with job ids. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBlankProject } from '../src/data/sampleProject';
import type { MovieProject } from '../src/types/studio';
import { applyRecoveredJobs, findRecoverableJobs, ServerJob } from '../src/utils/jobRecovery';
import { parsePromptsFromRawText } from '../src/utils/validation';
import { addVersion } from '../src/utils/versions';

function project(): MovieProject {
  const p = createBlankProject('Orchestration');
  const imgs = parsePromptsFromRawText('S01 | SH01 | a\nS01 | SH02 | b', 'image');
  p.imagePrompts = { ...p.imagePrompts, parsedItems: imgs };
  p.videoPrompts = { ...p.videoPrompts, parsedItems: parsePromptsFromRawText('S01 | SH01 | move a\nS01 | SH02 | move b', 'video', imgs) };
  return p;
}
const job = (over: Partial<ServerJob>): ServerJob => ({ jobId: 'vj_1', projectId: 'p', sceneId: 'S01', shotId: 'SH01', status: 'completed', videoUrl: '/api/media/users/u/projects/p/videos/a.mp4', createdAt: '2026-01-01T10:00:00Z', ...over });

describe('server job recovery', () => {
  it('finds finished server videos that the project does not have; ignores running/failed/cancelled and unknown shots', () => {
    const p = project();
    const found = findRecoverableJobs(p, [
      job({ jobId: 'a' }),
      job({ jobId: 'b', status: 'running', videoUrl: undefined }),
      job({ jobId: 'c', status: 'failed', videoUrl: undefined }),
      job({ jobId: 'd', status: 'cancelled', videoUrl: undefined }),
      job({ jobId: 'e', shotId: 'SH99' }),
      job({ jobId: 'f', shotId: 'SH02', videoUrl: '/api/media/x/f.mp4', createdAt: '2026-01-01T09:00:00Z' }),
    ]);
    assert.deepEqual(found.map((j) => j.jobId), ['f', 'a'], 'oldest first');
  });

  it('a video that is already a version (by job id or by URL) is not recovered twice', () => {
    let p = project();
    p = { ...p, videoPrompts: { ...p.videoPrompts, parsedItems: p.videoPrompts.parsedItems.map((v, i) => (i === 0 ? addVersion(v, '/api/media/known.mp4', 'cloud_generated', undefined, 'vj_known') : v)) } };
    const found = findRecoverableJobs(p, [job({ jobId: 'vj_known', videoUrl: '/api/media/other.mp4' }), job({ jobId: 'vj_new', videoUrl: '/api/media/known.mp4' }), job({ jobId: 'vj_real', videoUrl: '/api/media/real.mp4' })]);
    assert.deepEqual(found.map((j) => j.jobId), ['vj_real']);
  });

  it('recovered videos become new versions; an existing selection is kept, an empty shot gets the newest', () => {
    let p = project();
    p = { ...p, videoPrompts: { ...p.videoPrompts, parsedItems: p.videoPrompts.parsedItems.map((v, i) => (i === 0 ? addVersion(v, '/api/media/mine.mp4', 'uploaded', 'mine.mp4') : v)) } };
    const recoverable = findRecoverableJobs(p, [job({ jobId: 'r1', sceneId: 'S01', shotId: 'SH01', videoUrl: '/api/media/r1.mp4' }), job({ jobId: 'r2', shotId: 'SH02', videoUrl: '/api/media/r2.mp4', createdAt: '2026-01-01T11:00:00Z' }), job({ jobId: 'r3', shotId: 'SH02', videoUrl: '/api/media/r3.mp4', createdAt: '2026-01-01T12:00:00Z' })]);
    const out = applyRecoveredJobs(p, recoverable);
    const [s1, s2] = out.videoPrompts.parsedItems;
    assert.equal(s1.candidates!.length, 2);
    assert.equal(s1.generatedUrl, '/api/media/mine.mp4', 'the user’s selected video is not replaced');
    assert.equal(s2.candidates!.length, 2);
    assert.equal(s2.generatedUrl, '/api/media/r3.mp4', 'empty shot gets the newest recovered video');
    assert.equal(s2.status, 'completed');
    assert.deepEqual(s2.candidates!.map((c) => c.jobId), ['r2', 'r3']);
    assert.equal(findRecoverableJobs(out, recoverable).length, 0, 'recovering is idempotent');
  });
});

describe('versions keep the job that made them', () => {
  it('addVersion stores the job id and never drops earlier versions', () => {
    let item = project().videoPrompts.parsedItems[0];
    for (let i = 0; i < 12; i++) item = addVersion(item, `/v${i}.mp4`, 'cloud_generated', undefined, `job${i}`);
    assert.equal(item.candidates!.length, 12);
    assert.equal(item.candidates![11].jobId, 'job11');
    assert.equal(addVersion(item, '/u.mp4', 'uploaded').candidates!.at(-1)!.jobId, undefined);
  });
});
