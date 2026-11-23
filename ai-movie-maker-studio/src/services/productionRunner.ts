/**
 * Step-by-step production: Step 1 shot images, Step 2 image-to-video.
 * Every status shown in the UI comes from a real backend response.
 */
import { CharacterCard, CloudBackendSettings, MovieProject, ParsedPromptEntry } from '../types/studio';
import { characterCompleteness, characterDisplayName, REF_SLOT_KEYS, shotKey } from '../utils/validation';
import { urlToDataUrl } from '../utils/storage';
import { phase2CloudServices, resolveBackendUrl } from './cloudApiInterfaces';

/** Complete characters whose name (or first name) appears in the prompt. */
export function charactersInPrompt(project: MovieProject, prompt: string): CharacterCard[] {
  const text = prompt.toLowerCase();
  return project.characters.filter((c) => {
    if (!characterCompleteness(c).complete) return false;
    const name = characterDisplayName(c).toLowerCase();
    const first = name.split(/\s+/)[0];
    return (name.length > 1 && text.includes(name)) || (first.length > 2 && text.includes(first));
  });
}

async function characterPayload(c: CharacterCard) {
  const urls = REF_SLOT_KEYS.filter((k) => c.references[k].imageUrl && c.references[k].savedAt)
    .slice(0, 3)
    .map((k) => c.references[k].imageUrl!);
  const referenceImages = (await Promise.all(urls.map(urlToDataUrl))).filter((u): u is string => Boolean(u));
  return { name: characterDisplayName(c), info: c.nameAndDetails, referenceImages };
}

export async function generateShotImage(
  project: MovieProject,
  cloud: CloudBackendSettings,
  item: ParsedPromptEntry
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const chars = await Promise.all(charactersInPrompt(project, item.promptText).map(characterPayload));
  const res = await phase2CloudServices.imageGen.generateShotImage(cloud, {
    projectId: project.id,
    sceneId: item.sceneId,
    shotId: item.shotId,
    prompt: item.promptText,
    aspectRatio: project.productionSettings.aspectRatio,
    storyContext: project.story.rawText.slice(0, 3000),
    characters: chars,
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error || 'Image generation failed.' };
  return { ok: true, url: res.data.imageUrl };
}

function newIdempotencyKey(projectId: string, key: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${projectId.slice(0, 24)}:${key}:${rand}`.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);
}

export async function startShotVideo(
  project: MovieProject,
  cloud: CloudBackendSettings,
  video: ParsedPromptEntry
): Promise<{ ok: true; jobId: string; reused: boolean } | { ok: false; error: string }> {
  const img = project.imagePrompts.parsedItems.find((i) => shotKey(i) === (video.linkedImageKey || shotKey(video)));
  if (!img?.generatedUrl) {
    return { ok: false, error: `No image for ${shotKey(video)} — generate or upload it in Generated Images first.` };
  }
  const startImage = await urlToDataUrl(resolveBackendUrl(cloud, img.generatedUrl));
  if (!startImage) return { ok: false, error: 'Could not read the shot image to use as the first frame.' };
  const ps = project.productionSettings;
  const res = await phase2CloudServices.videoGen.startShotVideo(cloud, {
    projectId: project.id,
    sceneId: video.sceneId,
    shotId: video.shotId,
    prompt: video.promptText,
    startImage,
    linkedImageKey: video.linkedImageKey || shotKey(video),
    idempotencyKey: newIdempotencyKey(project.id, shotKey(video)),
    retryOf: video.status === 'failed' ? video.lastJobId : undefined,
    aspectRatio: ps.aspectRatio,
    resolution: ps.resolution,
    durationSec: ps.videoDurationSec,
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error || 'Could not start video generation.' };
  return { ok: true, jobId: res.data.jobId, reused: Boolean(res.data.reused) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls the backend until the Veo job really finishes. */
export async function waitForVideoJob(
  cloud: CloudBackendSettings,
  jobId: string,
  shouldStop: () => boolean,
  intervalMs = 10000,
  timeoutMs = 15 * 60 * 1000
): Promise<{ ok: true; url: string } | { ok: false; error: string; stillRunning?: boolean }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (shouldStop()) return { ok: false, error: 'Stopped watching. The server job may still finish.', stillRunning: true };
    const res = await phase2CloudServices.videoGen.getVideoJobStatus(cloud, jobId);
    if (!res.ok || !res.data) return { ok: false, error: res.error || 'Video status check failed.' };
    if (res.data.status === 'completed' && res.data.videoUrl) return { ok: true, url: res.data.videoUrl };
    if (res.data.status === 'failed') return { ok: false, error: res.data.error || 'Video generation failed.' };
    if (res.data.status === 'cancelled') return { ok: false, error: 'This video job was cancelled.' };
    await sleep(intervalMs);
  }
  return { ok: false, error: 'Timed out after 15 minutes waiting for the video.', stillRunning: true };
}

/** Runs tasks with a concurrency limit (Production Settings → Generation Order). */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, shouldStop: () => boolean) {
  let index = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length && !shouldStop()) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
