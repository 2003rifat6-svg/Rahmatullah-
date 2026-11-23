/**
 * Version history of generated / uploaded shot outputs.
 * Rules: a new output is ADDED as a new version; no version is ever dropped automatically.
 * Versions are removed only by an explicit user action (removeVersion).
 */
import { AssetSource, ParsedPromptEntry, ShotAssetCandidate } from '../types/studio';

let counter = 0;
function newVersionId(): string {
  counter += 1;
  return `cand_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function addVersion(
  item: ParsedPromptEntry,
  url: string,
  source: AssetSource,
  filename?: string,
  jobId?: string
): ParsedPromptEntry {
  const version: ShotAssetCandidate = {
    id: newVersionId(),
    url,
    source,
    createdAt: new Date().toISOString(),
    fromPrompt: item.promptText,
    filename,
    ...(jobId ? { jobId } : {}),
  };
  return {
    ...item,
    candidates: [...(item.candidates ?? []), version], // never truncated
    selectedCandidateId: version.id,
    generatedUrl: url,
    assetSource: source,
    status: 'completed',
    errorMessage: undefined,
    backendJobId: undefined,
  };
}

export function selectVersion(item: ParsedPromptEntry, versionId: string): ParsedPromptEntry {
  const v = item.candidates?.find((c) => c.id === versionId);
  return v ? { ...item, selectedCandidateId: v.id, generatedUrl: v.url, assetSource: v.source } : item;
}

/** Explicit user action only. Keeps the newest remaining version selected if the current one is removed. */
export function removeVersion(item: ParsedPromptEntry, versionId: string): ParsedPromptEntry {
  const candidates = (item.candidates ?? []).filter((c) => c.id !== versionId);
  const current = candidates.find((c) => c.id === item.selectedCandidateId) ?? candidates[candidates.length - 1];
  return {
    ...item,
    candidates,
    selectedCandidateId: current?.id,
    generatedUrl: current?.url,
    assetSource: current?.source,
    status: current ? 'completed' : 'waiting',
  };
}

/** "v1" is the oldest version. */
export function versionNumber(item: ParsedPromptEntry, versionId: string): number {
  return (item.candidates ?? []).findIndex((c) => c.id === versionId) + 1;
}
