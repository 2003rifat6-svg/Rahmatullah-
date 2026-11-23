import { MovieProject, ParsedPromptEntry } from '../types/studio';
import { shotKey } from './validation';

/** A job as reported by GET /api/generate/jobs (public fields only). */
export interface ServerJob {
  jobId: string;
  projectId: string;
  sceneId: string;
  shotId: string;
  linkedImageKey?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  videoUrl?: string;
  error?: string;
  createdAt: string;
}

/**
 * Finished server jobs whose video is not in this project yet (for example the browser was closed
 * or its data was cleared before the result was received). The paid result is never lost.
 */
export function findRecoverableJobs(project: MovieProject, jobs: ServerJob[]): ServerJob[] {
  const shots = new Map(project.videoPrompts.parsedItems.map((v) => [shotKey(v), v]));
  return jobs
    .filter((j) => j.status === 'completed' && j.videoUrl)
    .filter((j) => {
      const shot = shots.get(`${j.sceneId}-${j.shotId}`);
      if (!shot) return false; // shot no longer exists in this project
      return !(shot.candidates ?? []).some((c) => c.jobId === j.jobId || c.url === j.videoUrl);
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Adds recovered videos as extra versions (oldest first). A shot that already has a selected video keeps it;
 * a shot without one gets the newest recovered video selected.
 */
export function applyRecoveredJobs(project: MovieProject, recoverable: ServerJob[]): MovieProject {
  const items = project.videoPrompts.parsedItems.map((item): ParsedPromptEntry => {
    const mine = recoverable.filter((j) => `${j.sceneId}-${j.shotId}` === shotKey(item));
    if (mine.length === 0) return item;
    const candidates = [...(item.candidates ?? [])];
    for (const j of mine) {
      candidates.push({ id: `cand_rec_${j.jobId}`, url: j.videoUrl!, source: 'cloud_generated', createdAt: j.createdAt, fromPrompt: item.promptText, jobId: j.jobId });
    }
    const hadSelection = Boolean(item.selectedCandidateId && item.generatedUrl);
    const newest = candidates[candidates.length - 1];
    return {
      ...item,
      candidates,
      selectedCandidateId: hadSelection ? item.selectedCandidateId : newest.id,
      generatedUrl: hadSelection ? item.generatedUrl : newest.url,
      assetSource: hadSelection ? item.assetSource : 'cloud_generated',
      status: hadSelection ? item.status : 'completed',
    };
  });
  return { ...project, videoPrompts: { ...project.videoPrompts, parsedItems: items } };
}
