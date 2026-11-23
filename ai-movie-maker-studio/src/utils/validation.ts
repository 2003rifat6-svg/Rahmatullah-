import {
  CharacterCard,
  CharacterRefSlotKey,
  MovieProject,
  ParsedPromptEntry,
  ShotAssetCandidate,
} from '../types/studio';

export const REF_SLOT_KEYS: CharacterRefSlotKey[] = ['face', 'front', 'side', 'back'];

export const REF_SLOT_LABELS: Record<CharacterRefSlotKey, string> = {
  face: 'Face',
  front: 'Front Body',
  side: 'Side Body',
  back: 'Back Body',
};

export function shotKey(item: { sceneId: string; shotId: string }): string {
  return `${item.sceneId}-${item.shotId}`;
}

/** First "Name: ..." line, or the first non-empty line of Character Information. */
export function characterDisplayName(card: Pick<CharacterCard, 'nameAndDetails' | 'id'>): string {
  const lines = card.nameAndDetails.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const named = lines.find((l) => /^name\s*[:：-]/i.test(l) || /^নাম\s*[:：-]/.test(l));
  const raw = (named ? named.replace(/^(name|নাম)\s*[:：-]\s*/i, '') : lines[0]) || '';
  return raw.slice(0, 60) || 'Unnamed character';
}

/** A reference slot counts only when it has an image AND that image was saved. */
export function isRefSlotSaved(card: CharacterCard, key: CharacterRefSlotKey): boolean {
  const slot = card.references[key];
  return Boolean(slot.imageUrl && slot.savedAt);
}

/**
 * Complete character = Character Information saved AND at least the Face reference
 * image saved. Incomplete characters are never included in the Main Chat bundle
 * or sent to image/video generation.
 */
export function characterCompleteness(card: CharacterCard): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!card.savedAt || !card.nameAndDetails.trim()) missing.push('Character Information (Save)');
  if (!isRefSlotSaved(card, 'face')) missing.push('Face reference image (Save)');
  return { complete: missing.length === 0, missing };
}

export function selectedCandidate(item: ParsedPromptEntry): ShotAssetCandidate | undefined {
  const list = item.candidates ?? [];
  return list.find((c) => c.id === item.selectedCandidateId) ?? list[0];
}

/**
 * Re-parsing prompts must not throw away images/videos that were already produced.
 * Outputs are carried over by Scene/Shot ID.
 */
export function mergeShotOutputs(
  nextItems: ParsedPromptEntry[],
  prevItems: ParsedPromptEntry[]
): ParsedPromptEntry[] {
  const prevByKey = new Map(prevItems.map((p) => [shotKey(p), p]));
  return nextItems.map((item) => {
    const prev = prevByKey.get(shotKey(item));
    if (!prev || !(prev.candidates?.length || prev.generatedUrl)) return item;
    return {
      ...item,
      candidates: prev.candidates,
      selectedCandidateId: prev.selectedCandidateId,
      generatedUrl: prev.generatedUrl,
      assetSource: prev.assetSource,
      status: prev.status === 'generating' ? prev.status : prev.generatedUrl ? 'completed' : prev.status,
      backendJobId: prev.backendJobId,
      errorMessage: prev.errorMessage,
    };
  });
}

export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function normalizeSceneCode(value: string): string {
  const clean = value.trim().toUpperCase();
  if (!clean) return 'S01';
  if (/^\d+$/.test(clean)) return `S${clean.padStart(2, '0')}`;
  if (/^SCENE\s*0*(\d+)$/.test(clean)) {
    const m = clean.match(/^SCENE\s*0*(\d+)$/)!;
    return `S${m[1].padStart(2, '0')}`;
  }
  if (/^S\s*0*(\d+)$/.test(clean)) {
    const m = clean.match(/^S\s*0*(\d+)$/)!;
    return `S${m[1].padStart(2, '0')}`;
  }
  return clean;
}

export function normalizeShotCode(value: string): string {
  const clean = value.trim().toUpperCase();
  if (!clean) return 'SH01';
  if (/^\d+$/.test(clean)) return `SH${clean.padStart(2, '0')}`;
  if (/^SHOT\s*0*(\d+)$/.test(clean)) {
    const m = clean.match(/^SHOT\s*0*(\d+)$/)!;
    return `SH${m[1].padStart(2, '0')}`;
  }
  if (/^SH\s*0*(\d+)$/.test(clean)) {
    const m = clean.match(/^SH\s*0*(\d+)$/)!;
    return `SH${m[1].padStart(2, '0')}`;
  }
  return clean;
}

/**
 * Parses pasted or uploaded raw Image or Video Prompts (JSON or TXT)
 * while strictly preserving the user's original prompt order and Scene/Shot IDs.
 */
export function parsePromptsFromRawText(
  rawText: string,
  kind: 'image' | 'video',
  existingImages: ParsedPromptEntry[] = []
): ParsedPromptEntry[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const findImageKey = (sceneId: string, shotId: string): string | undefined => {
    const match = existingImages.find(
      (img) => img.sceneId === sceneId && img.shotId === shotId
    );
    return match ? `${match.sceneId}-${match.shotId}` : undefined;
  };

  let items: ParsedPromptEntry[] = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.prompts)
          ? parsed.prompts
          : [parsed];
      items = arr.map((obj: Record<string, unknown>, idx: number) => {
        const sceneId = normalizeSceneCode(
          String(obj.sceneId ?? obj.scene_id ?? obj.scene ?? 'S01')
        );
        const shotId = normalizeShotCode(
          String(obj.shotId ?? obj.shot_id ?? obj.shot ?? idx + 1)
        );
        return {
          id: createId(kind === 'image' ? 'img' : 'vid'),
          sceneId,
          shotId,
          orderIndex: idx,
          promptText: String(
            obj.prompt ?? obj.promptText ?? obj.description ?? ''
          ).trim(),
          linkedImageKey:
            kind === 'video'
              ? String(obj.linkedImageKey || findImageKey(sceneId, shotId) || '') ||
                undefined
              : undefined,
          status: 'waiting',
        };
      });
    } catch {
      // fall through to line parser
    }
  }

  if (items.length === 0) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    items = lines.map((line, idx) => {
      let sceneId = 'S01';
      let shotId = `SH${String(idx + 1).padStart(2, '0')}`;
      let promptText = line.trim();

      if (line.includes('|')) {
        const parts = line.split('|').map((p) => p.trim());
        sceneId = normalizeSceneCode(parts[0] || 'S01');
        shotId = normalizeShotCode(parts[1] || String(idx + 1));
        promptText =
          parts.length >= 3 ? parts.slice(2).join(' · ').trim() : '';
      } else {
        const match = line.match(
          /^(?:SCENE|SCN|S)\s*([A-Z0-9_-]+)[\s/_-]*(?:SHOT|SH)\s*([A-Z0-9_-]+)\s*[:|-]?\s*(.*)$/i
        );
        if (match) {
          sceneId = normalizeSceneCode(match[1]);
          shotId = normalizeShotCode(match[2]);
          promptText = (match[3] || '').trim();
        }
      }

      return {
        id: createId(kind === 'image' ? 'img' : 'vid'),
        sceneId,
        shotId,
        orderIndex: idx,
        promptText,
        linkedImageKey:
          kind === 'video' ? findImageKey(sceneId, shotId) : undefined,
        status: 'waiting',
      };
    });
  }

  // Preserve original user prompt order (no re-sorting)
  return items.map((item, idx) => ({ ...item, orderIndex: idx }));
}

export interface ProjectMaterialsAudit {
  storyOk: boolean;
  charactersOk: boolean;
  imagesOk: boolean;
  videosOk: boolean;
  settingsOk: boolean;
  /** Errors that block Step 1 (image generation). */
  imageStepErrors: string[];
  /** Errors that block Step 2 (video generation), in addition to all errors. */
  videoStepErrors: string[];
  errors: string[];
  warnings: string[];
  summaryLines: string[];
}

export function auditProjectMaterials(
  project: MovieProject
): ProjectMaterialsAudit {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasStory = project.story.rawText.trim().length > 0;
  const storySaved = Boolean(project.story.savedAt);
  const storyLocked = project.story.locked;

  if (!hasStory) {
    errors.push('Story is empty. Open Story, paste or upload your story, Save, and Lock it.');
  } else if (!storySaved) {
    errors.push('Story has not been saved yet. Open Story and press Save.');
  } else if (!storyLocked) {
    errors.push('Story is saved but NOT locked. Open Story and press Lock.');
  }

  const hasChars = project.characters.length > 0;
  let charsAllValid = false;
  const completeChars = project.characters.filter((c) => characterCompleteness(c).complete);

  if (!hasChars) {
    errors.push('Character Information has 0 saved characters. Add a character and press Save.');
  } else {
    const incomplete = project.characters.filter((c) => !characterCompleteness(c).complete);
    for (const c of incomplete) {
      errors.push(
        `Character "${characterDisplayName(c)}" is incomplete (missing: ${characterCompleteness(c).missing.join(', ')}).`
      );
    }
    const unlockedChars = project.characters.filter((c) => !c.locked).length;
    if (unlockedChars > 0) {
      errors.push(`${unlockedChars} character card(s) are NOT locked yet. Lock each character before production.`);
    }
    for (const c of completeChars) {
      const missingBody = REF_SLOT_KEYS.filter((k) => k !== 'face' && !isRefSlotSaved(c, k));
      if (missingBody.length > 0) {
        warnings.push(
          `"${characterDisplayName(c)}" has no saved ${missingBody.map((k) => REF_SLOT_LABELS[k]).join(' / ')} reference image.`
        );
      }
    }
    charsAllValid = incomplete.length === 0 && unlockedChars === 0;
  }

  const needImg =
    project.productionSettings.generateType === 'image' ||
    project.productionSettings.generateType === 'image_and_video';
  const needVid =
    project.productionSettings.generateType === 'video' ||
    project.productionSettings.generateType === 'image_and_video';

  const hasImages = project.imagePrompts.parsedItems.length > 0;
  let imagesValid = !needImg;

  if (needImg) {
    if (!hasImages) {
      errors.push('Image Prompts are empty. Add prompts, Save, and Lock.');
      imagesValid = false;
    } else {
      const seen = new Set<string>();
      let dupFound = false;
      let emptyPromptFound = false;

      for (const item of project.imagePrompts.parsedItems) {
        const key = `${item.sceneId}-${item.shotId}`;
        if (!item.promptText.trim()) {
          emptyPromptFound = true;
          errors.push(`Image Prompt ${key} has empty prompt text.`);
        }
        if (seen.has(key)) {
          dupFound = true;
          errors.push(`Duplicate Image Prompt Scene/Shot ID: ${key}`);
        }
        seen.add(key);
      }

      if (!project.imagePrompts.savedAt) {
        errors.push('Image Prompts have not been saved yet.');
      } else if (!project.imagePrompts.locked) {
        errors.push('Image Prompts are saved but NOT locked. Open Image Prompts and press Lock.');
      }

      imagesValid =
        !dupFound &&
        !emptyPromptFound &&
        Boolean(project.imagePrompts.savedAt) &&
        project.imagePrompts.locked;
    }
  }

  const hasVideos = project.videoPrompts.parsedItems.length > 0;
  let videosValid = !needVid;

  if (needVid) {
    if (!hasVideos) {
      errors.push('Video Prompts are empty. Add prompts, Save, and Lock.');
      videosValid = false;
    } else {
      const seenVid = new Set<string>();
      let dupVidFound = false;
      for (const v of project.videoPrompts.parsedItems) {
        const key = `${v.sceneId}-${v.shotId}`;
        if (seenVid.has(key)) {
          dupVidFound = true;
          errors.push(`Duplicate Video Prompt Scene/Shot ID: ${key}`);
        }
        seenVid.add(key);
      }

      const imageKeys = new Set(
        project.imagePrompts.parsedItems.map((i) => `${i.sceneId}-${i.shotId}`)
      );
      const unlinked = project.videoPrompts.parsedItems.filter(
        (v) => !v.linkedImageKey || !imageKeys.has(v.linkedImageKey)
      );
      if (unlinked.length > 0) {
        errors.push(
          `${unlinked.length} video prompt(s) have no matching Scene/Shot image (${unlinked
            .map((u) => `${u.sceneId}-${u.shotId}`)
            .join(', ')}).`
        );
      }
      const emptyVids = project.videoPrompts.parsedItems.filter(
        (v) => !v.promptText.trim()
      );
      if (emptyVids.length > 0) {
        errors.push(
          `${emptyVids.length} video prompt(s) have empty prompt text.`
        );
      }
      if (!project.videoPrompts.savedAt) {
        errors.push('Video Prompts have not been saved yet.');
      } else if (!project.videoPrompts.locked) {
        errors.push('Video Prompts are saved but NOT locked. Open Video Prompts and press Lock.');
      }

      videosValid =
        !dupVidFound &&
        unlinked.length === 0 &&
        emptyVids.length === 0 &&
        Boolean(project.videoPrompts.savedAt) &&
        project.videoPrompts.locked;
    }
  }

  const settingsOk = Boolean(project.productionSettings.savedAt);
  if (!project.productionSettings.savedAt) {
    errors.push('Production Settings have not been saved yet. Open Production Settings and press Save.');
  } else if (!project.productionSettings.locked) {
    warnings.push('Production Settings are saved but unlocked.');
  }

  // Step 2 (video) needs an image for every linked shot.
  const imageByKey = new Map(project.imagePrompts.parsedItems.map((i) => [shotKey(i), i]));
  const videoStepErrors: string[] = [];
  if (needVid) {
    for (const v of project.videoPrompts.parsedItems) {
      const img = imageByKey.get(v.linkedImageKey || shotKey(v));
      if (!img?.generatedUrl) {
        videoStepErrors.push(`${shotKey(v)}: no image yet (generate or upload it in Generated Images first).`);
      }
    }
  }

  const summaryLines = [
    hasStory
      ? `Story: ${project.story.rawText.trim().split(/\s+/).length} words (${
          project.story.locked
            ? 'Locked'
            : project.story.savedAt
              ? 'Saved · Unlocked'
              : 'Unsaved'
        }).`
      : 'Story: Empty.',
    hasChars
      ? `Characters: ${completeChars.length} complete of ${project.characters.length} saved (${
          project.characters.filter((c) => c.locked).length
        } locked).`
      : 'Characters: 0 saved.',
    hasImages
      ? `Image Prompts: ${project.imagePrompts.parsedItems.length} shot(s) in original order (${
          project.imagePrompts.locked
            ? 'Locked'
            : project.imagePrompts.savedAt
              ? 'Saved · Unlocked'
              : 'Unsaved'
        }).`
      : 'Image Prompts: Empty.',
    hasVideos
      ? `Video Prompts: ${project.videoPrompts.parsedItems.length} shot(s) in original order (${
          project.videoPrompts.locked
            ? 'Locked'
            : project.videoPrompts.savedAt
              ? 'Saved · Unlocked'
              : 'Unsaved'
        }).`
      : 'Video Prompts: Empty.',
  ];

  return {
    storyOk: hasStory && storySaved && storyLocked,
    charactersOk: hasChars && charsAllValid,
    imagesOk: imagesValid,
    videosOk: videosValid,
    settingsOk,
    imageStepErrors: errors.filter((e) => !/video prompt/i.test(e)),
    videoStepErrors,
    errors,
    warnings,
    summaryLines,
  };
}
