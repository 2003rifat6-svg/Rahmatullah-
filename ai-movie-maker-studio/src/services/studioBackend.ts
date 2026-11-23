import {
  CharacterRefSlotKey,
  CloudBackendSettings,
  ModelCapabilityProfile,
  MovieProject,
  ProductionSettings,
} from '../types/studio';
import {
  auditProjectMaterials,
  characterCompleteness,
  characterDisplayName,
  createId,
  isRefSlotSaved,
  mergeShotOutputs,
  parsePromptsFromRawText,
  REF_SLOT_KEYS,
  REF_SLOT_LABELS,
  shotKey,
} from '../utils/validation';

import { phase2CloudServices } from './cloudApiInterfaces';

export const MODEL_CAPABILITY_PROFILES: ModelCapabilityProfile[] = [
  {
    id: 'vertex_standard',
    label: 'Veo via Gemini API — Standard (720p / 1080p · 8s)',
    providerNote:
      'Used by the included backend (server/). Veo image-to-video supports 16:9 and 9:16; other aspect ratios are only used for images. The actual model is set on the server (GEMINI_VIDEO_MODEL).',
    supportedResolutions: ['720p', '1080p'],
    supportedDurationsSec: [8],
    maxGenerationOrder: 2,
  },
  {
    id: 'vertex_extended',
    label: 'Veo via Gemini API — Extended (720p / 1080p · 4s / 6s / 8s)',
    providerNote:
      'Shorter clip lengths are only accepted by some Veo models. If the server model rejects a duration, the shot fails with the real error message.',
    supportedResolutions: ['720p', '1080p'],
    supportedDurationsSec: [4, 6, 8],
    maxGenerationOrder: 4,
  },
];

export const DEFAULT_CLOUD_SETTINGS: CloudBackendSettings = {
  backendUrl: '',
  gcpProjectId: '',
  gcpRegion: 'us-central1',
  gcsBucket: '',
  status: 'not_configured',
};

export function getActiveModelProfile(
  settings: ProductionSettings
): ModelCapabilityProfile {
  return (
    MODEL_CAPABILITY_PROFILES.find((m) => m.id === settings.modelProfileId) ??
    MODEL_CAPABILITY_PROFILES[0]
  );
}

export async function testCloudBackendConnection(
  cloud: CloudBackendSettings
): Promise<CloudBackendSettings> {
  const cleanUrl = cloud.backendUrl.trim().replace(/\/+$/, '');
  const now = new Date().toISOString();

  if (!cleanUrl) {
    return {
      ...cloud,
      status: 'not_configured',
      lastCheckedAt: now,
      lastError:
        'No Google Cloud Run FastAPI URL configured. Enter your backend URL to connect Phase 2 AI generation.',
    };
  }

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ...cloud,
        status: 'not_configured',
        lastCheckedAt: now,
        lastError: 'Backend URL must start with https:// or http://.',
      };
    }
  } catch {
    return {
      ...cloud,
      status: 'not_configured',
      lastCheckedAt: now,
      lastError: 'Invalid Google Cloud Run FastAPI URL format.',
    };
  }

  try {
    const res = await fetch(`${cleanUrl}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        ...cloud,
        status: 'unreachable',
        lastCheckedAt: now,
        lastError: `Health check failed with HTTP ${res.status}.`,
      };
    }
    let healthInfo: Partial<CloudBackendSettings> = {};
    try {
      const data = (await res.json()) as {
        ok?: boolean;
        status?: string;
        geminiConfigured?: boolean;
        ffmpegAvailable?: boolean;
        authMode?: 'google' | 'none';
        googleClientId?: string | null;
        cloudSync?: boolean;
        storage?: 'gcs' | 'local-disk';
        warnings?: string[];
      };
      healthInfo = {
        geminiConfigured: data.geminiConfigured,
        ffmpegAvailable: data.ffmpegAvailable,
        authMode: data.authMode,
        googleClientId: data.googleClientId,
        cloudSync: data.cloudSync,
        storage: data.storage,
        serverWarnings: data.warnings,
      };
      if (data && data.ok === false) {
        return {
          ...cloud,
          status: 'unreachable',
          lastCheckedAt: now,
          lastError: `Health endpoint reported unhealthy status (${data.status || 'not ok'}).`,
        };
      }
    } catch {
      // Allow plain-text HTTP 200 "ok" health endpoints as long as HTTP res.ok passed
    }
    return {
      ...cloud,
      backendUrl: cleanUrl,
      status: 'connected',
      lastCheckedAt: now,
      ...healthInfo,
      lastError:
        healthInfo.geminiConfigured === false
          ? 'Backend is reachable, but GEMINI_API_KEY is not set on the server, so AI generation is disabled.'
          : undefined,
    };
  } catch (err) {
    return {
      ...cloud,
      status: 'unreachable',
      lastCheckedAt: now,
      lastError:
        err instanceof Error
          ? `Health check failed: ${err.message}`
          : 'Could not reach Cloud Run backend.',
    };
  }
}

export async function requestCharacterReferenceImage(
  cloud: CloudBackendSettings,
  payload: {
    characterInfo: string;
    slot: CharacterRefSlotKey;
    prompt: string;
    referenceImages?: string[];
  }
): Promise<{ ok: true; imageUrl: string; filename: string } | { ok: false; error: string }> {
  if (!payload.prompt.trim()) {
    return {
      ok: false,
      error: 'Please enter a prompt before pressing Generate Image.',
    };
  }

  const res = await phase2CloudServices.imageGen.generateCharacterReference(
    cloud,
    payload
  );
  if (!res.ok || !res.data?.imageUrl) {
    return {
      ok: false,
      error:
        res.error ||
        'AI image generation backend is not connected. Start the included backend (npm run server) with GEMINI_API_KEY, connect it in Cloud Settings, or upload an image from your device.',
    };
  }

  return {
    ok: true,
    imageUrl: res.data.imageUrl,
    filename: res.data.filename || `${payload.slot}_generated.png`,
  };
}

/**
 * Builds the single organised "Project Materials Bundle" that the user sends to
 * Main Chat with the one "Send All Materials to Main Chat" button.
 * Only SAVED content is included. Unsaved drafts and incomplete characters are excluded.
 */
export function buildMaterialsBundle(project: MovieProject): {
  bundleText: string;
  userSummaryText: string;
  aiAnalysisText: string;
  actionHint?: 'start_production' | 'open_materials';
  included: string[];
  excluded: string[];
} {
  const audit = auditProjectMaterials(project);
  const included: string[] = [];
  const excluded: string[] = [];
  const parts: string[] = [];
  const lockTag = (locked: boolean) => (locked ? 'LOCKED' : 'saved, unlocked');

  parts.push(`=== PROJECT MATERIALS BUNDLE: ${project.title} ===`);

  // 1. Story
  if (project.story.savedAt && project.story.rawText.trim()) {
    included.push('Story Master');
    parts.push(`\n[1] STORY MASTER (${lockTag(project.story.locked)})\n${project.story.rawText.trim()}`);
  } else {
    excluded.push('Story Master (not saved)');
  }

  // 2 + 3. Characters and their reference images
  const complete = project.characters.filter((c) => characterCompleteness(c).complete);
  const incomplete = project.characters.filter((c) => !characterCompleteness(c).complete);
  if (complete.length > 0) {
    included.push(`Character Information (${complete.length})`, 'Character Reference Images');
    parts.push(`\n[2] CHARACTER INFORMATION (${complete.length} complete)`);
    complete.forEach((c, i) => {
      parts.push(`--- Character ${i + 1}: ${characterDisplayName(c)} (${lockTag(c.locked)}) ---\n${c.nameAndDetails.trim()}`);
    });
    parts.push(`\n[3] CHARACTER REFERENCE IMAGES`);
    complete.forEach((c) => {
      const slots = REF_SLOT_KEYS.map((k) => {
        const slot = c.references[k];
        const state = isRefSlotSaved(c, k)
          ? `${slot.source === 'cloud_generated' ? 'AI generated' : slot.source === 'sample_asset' ? 'sample asset' : 'uploaded'}${slot.locked ? ', locked' : ''}`
          : 'missing';
        return `${REF_SLOT_LABELS[k]}: ${state}`;
      });
      parts.push(`${characterDisplayName(c)} → ${slots.join(' · ')}`);
    });
  } else {
    excluded.push('Characters (no complete character)');
  }
  incomplete.forEach((c) =>
    excluded.push(`Character "${characterDisplayName(c)}" — incomplete: ${characterCompleteness(c).missing.join(', ')}`)
  );

  // 4. Image prompts
  if (project.imagePrompts.savedAt && project.imagePrompts.parsedItems.length) {
    included.push(`Image Prompts (${project.imagePrompts.parsedItems.length})`);
    parts.push(`\n[4] IMAGE PROMPTS (${lockTag(project.imagePrompts.locked)}, original order)`);
    project.imagePrompts.parsedItems.forEach((i) => parts.push(`${i.sceneId} | ${i.shotId} | ${i.promptText}`));
  } else {
    excluded.push('Image Prompts (not saved)');
  }

  // 5. Video prompts
  if (project.videoPrompts.savedAt && project.videoPrompts.parsedItems.length) {
    included.push(`Video Prompts (${project.videoPrompts.parsedItems.length})`);
    parts.push(`\n[5] VIDEO PROMPTS (${lockTag(project.videoPrompts.locked)}, original order)`);
    project.videoPrompts.parsedItems.forEach((v) =>
      parts.push(`${v.sceneId} | ${v.shotId} | ${v.promptText}  → image: ${v.linkedImageKey || 'NO MATCHING IMAGE'}`)
    );
  } else {
    excluded.push('Video Prompts (not saved)');
  }

  // 6. Settings
  const ps = project.productionSettings;
  if (ps.savedAt) {
    included.push('Production Settings');
    parts.push(
      `\n[6] PRODUCTION SETTINGS (${lockTag(ps.locked)})\nGenerate: ${ps.generateType} · Platform: ${ps.platform === 'custom' ? ps.customPlatformLabel || 'custom' : ps.platform} · ${ps.aspectRatio} · ${ps.resolution} · x${ps.imageQuantity} image(s)/shot · x${ps.videoQuantity} video(s)/shot · ${ps.videoDurationSec}s clips`
    );
  } else {
    excluded.push('Production Settings (not saved)');
  }

  // 7 + 8. Outputs (only real assets are counted)
  const imgs = project.imagePrompts.parsedItems.filter((i) => i.generatedUrl);
  const vids = project.videoPrompts.parsedItems.filter((v) => v.generatedUrl);
  if (project.generatedImagesSection.savedAt) {
    included.push(`Generated Images (${imgs.length})`);
    parts.push(`\n[7] GENERATED IMAGES (${lockTag(project.generatedImagesSection.locked)}): ${imgs.length} of ${project.imagePrompts.parsedItems.length} shots have an image${imgs.length ? ` — ${imgs.map(shotKey).join(', ')}` : ''}`);
  } else {
    excluded.push('Generated Images (section not saved)');
  }
  if (project.generatedVideosSection.savedAt) {
    included.push(`Generated Videos (${vids.length})`);
    parts.push(`\n[8] GENERATED VIDEOS (${lockTag(project.generatedVideosSection.locked)}): ${vids.length} of ${project.videoPrompts.parsedItems.length} shots have a video${vids.length ? ` — ${vids.map(shotKey).join(', ')}` : ''}`);
  } else {
    excluded.push('Generated Videos (section not saved)');
  }

  if (excluded.length) {
    parts.push(`\n[NOT INCLUDED]\n${excluded.map((e) => `- ${e}`).join('\n')}`);
  }

  const bundleText = parts.join('\n');
  const userSummaryText = [
    `📦 Project Materials Bundle — "${project.title}"`,
    `Included: ${included.length ? included.join(', ') : 'nothing saved yet'}`,
    excluded.length ? `Not included: ${excluded.join('; ')}` : 'Not included: —',
  ].join('\n');

  const lines: string[] = ['Local validation of the bundle (rule-based check, not an AI reply):', ...audit.summaryLines];
  if (audit.errors.length > 0) {
    lines.push('', 'Must fix before Start Production:');
    audit.errors.forEach((e) => lines.push(`- ${e}`));
  }
  if (audit.warnings.length > 0) {
    lines.push('', 'Notes:');
    audit.warnings.forEach((w) => lines.push(`- ${w}`));
  }
  if (audit.errors.length === 0) {
    lines.push('', 'Story, characters, references and Scene/Shot IDs are consistent. Use START PRODUCTION → Step 1 Images, then Step 2 Videos.');
  }

  return {
    bundleText,
    userSummaryText,
    aiAnalysisText: lines.join('\n'),
    actionHint: audit.errors.length === 0 ? 'start_production' : 'open_materials',
    included,
    excluded,
  };
}

/**
 * Phase 1 Local Deterministic Command & Materials Router.
 * Handles file ingestion, revision versioning, status/settings queries locally without any LLM API key.
 * Phase 2 conversational Gemini AI runs exclusively via `phase2CloudServices.chat` on Google Cloud Run.
 */
export function interpretMainChatMessage(
  project: MovieProject,
  userText: string,
  cloud: CloudBackendSettings,
  uploadedTexts: Array<{ filename: string; content: string }> = []
): {
  replyText: string;
  updatedProject: MovieProject;
  actionHint?: 'open_settings' | 'open_cloud' | 'start_production' | 'open_outputs' | 'open_materials';
} {
  const now = new Date().toISOString();
  let next: MovieProject = { ...project };
  const lower = userText.toLowerCase();

  const logHistory = (summary: string) => {
    next = {
      ...next,
      costAndJobs: {
        ...next.costAndJobs,
        history: [
          { id: createId('hist'), timestamp: now, summary },
          ...next.costAndJobs.history,
        ].slice(0, 60),
      },
    };
  };

  // Handle direct file uploads dropped into Main Chat (never auto-locks!)
  if (uploadedTexts.length > 0) {
    const replies: string[] = [];
    for (const file of uploadedTexts) {
      const fn = file.filename.toLowerCase();
      if (fn.includes('video')) {
        if (next.videoPrompts.locked) {
          replies.push(
            `Video Prompts section is locked. Unlock it first before replacing with "${file.filename}".`
          );
        } else {
          const parsed = parsePromptsFromRawText(
            file.content,
            'video',
            next.imagePrompts.parsedItems
          );
          next.videoPrompts = {
            rawText: file.content,
            filename: file.filename,
            savedAt: now,
            locked: false,
            parsedItems: mergeShotOutputs(parsed, next.videoPrompts.parsedItems),
          };
          logHistory(`Saved video prompts "${file.filename}" from chat (unlocked)`);
          replies.push(
            `Saved "${file.filename}" (${parsed.length} video prompt(s)) in original order and linked with Image Prompts. Section remains UNLOCKED until you manually lock it.`
          );
        }
      } else if (fn.includes('image') || fn.includes('shot')) {
        if (next.imagePrompts.locked) {
          replies.push(
            `Image Prompts section is locked. Unlock it first before replacing with "${file.filename}".`
          );
        } else {
          const parsed = parsePromptsFromRawText(file.content, 'image');
          next.imagePrompts = {
            rawText: file.content,
            filename: file.filename,
            savedAt: now,
            locked: false,
            parsedItems: mergeShotOutputs(parsed, next.imagePrompts.parsedItems),
          };
          next.videoPrompts = {
            ...next.videoPrompts,
            parsedItems: mergeShotOutputs(
              parsePromptsFromRawText(next.videoPrompts.rawText, 'video', parsed),
              next.videoPrompts.parsedItems
            ),
          };
          logHistory(`Saved image prompts "${file.filename}" from chat (unlocked)`);
          replies.push(
            `Saved "${file.filename}" (${parsed.length} image prompt(s)) in original scene and shot order. Section remains UNLOCKED until you manually lock it.`
          );
        }
      } else {
        if (next.story.locked) {
          replies.push(
            `Story is locked. Unlock Story first before replacing with "${file.filename}".`
          );
        } else {
          next.story = {
            rawText: file.content,
            filename: file.filename,
            savedAt: now,
            locked: false,
          };
          logHistory(`Saved story "${file.filename}" from chat (unlocked)`);
          replies.push(
            `Saved your story "${file.filename}" to the Story section. It remains UNLOCKED until you manually lock it.`
          );
        }
      }
    }
    return { replyText: replies.join('\n\n'), updatedProject: next };
  }

  // Editing through Main Chat (preserve originals in versions[])
  const shotMatch = userText.match(
    /(?:scene|scn|s)\s*0*(\d+)[\s,/-]*(?:shot|sh)\s*0*(\d+)/i
  );
  if (shotMatch) {
    const sCode = `S${shotMatch[1].padStart(2, '0')}`;
    const shCode = `SH${shotMatch[2].padStart(2, '0')}`;
    const key = `${sCode}-${shCode}`;

    const targetImg = next.imagePrompts.parsedItems.find(
      (i) => i.sceneId === sCode && i.shotId === shCode
    );
    const targetVid = next.videoPrompts.parsedItems.find(
      (v) => v.sceneId === sCode && v.shotId === shCode
    );

    if (lower.includes('slower') || lower.includes('movement')) {
      if (next.videoPrompts.locked) {
        return {
          replyText: `Video Prompts are LOCKED, so ${key} was not changed. Unlock Video Prompts in Project Materials first.`,
          updatedProject: next,
          actionHint: 'open_materials',
        };
      }
      if (!targetVid) {
        return {
          replyText: `I could not find ${key} in Video Prompts. Add and save it in Video Prompts first.`,
          updatedProject: next,
        };
      }
      next.versions = [
        {
          id: createId('ver'),
          timestamp: now,
          assetKey: key,
          instruction: userText,
          previousValue: targetVid.promptText,
        },
        ...next.versions,
      ];
      next.videoPrompts = {
        ...next.videoPrompts,
        parsedItems: next.videoPrompts.parsedItems.map((v) =>
          v.id === targetVid.id
            ? { ...v, promptText: `${v.promptText} [Slower movement]` }
            : v
        ),
      };
      logHistory(`Saved revision for ${key} video movement via chat`);
      return {
        replyText: `Saved the original ${key} video prompt in version history and created a slower-movement revision. ${
          cloud.status !== 'connected'
            ? 'Connect the backend in Cloud Settings to regenerate the clip.'
            : ''
        }`,
        updatedProject: next,
        actionHint: cloud.status !== 'connected' ? 'open_cloud' : undefined,
      };
    }

    if (
      lower.includes('regenerate') ||
      lower.includes('lighting') ||
      lower.includes('another version')
    ) {
      if (next.imagePrompts.locked) {
        return {
          replyText: `Image Prompts are LOCKED, so ${key} was not changed. Unlock Image Prompts in Project Materials first.`,
          updatedProject: next,
          actionHint: 'open_materials',
        };
      }
      if (!targetImg && !targetVid) {
        return {
          replyText: `Shot ${key} was not found in your saved Image or Video Prompts.`,
          updatedProject: next,
        };
      }
      if (targetImg) {
        next.versions = [
          {
            id: createId('ver'),
            timestamp: now,
            assetKey: key,
            instruction: userText,
            previousValue: targetImg.promptText,
          },
          ...next.versions,
        ];
        next.imagePrompts = {
          ...next.imagePrompts,
          parsedItems: next.imagePrompts.parsedItems.map((i) =>
            i.id === targetImg.id
              ? { ...i, promptText: `${i.promptText} [${userText.trim()}]` }
              : i
          ),
        };
        logHistory(`Saved prompt revision for ${key} via chat`);
      }

      return {
        replyText: `Preserved the original ${key} asset in version history and updated the revision instruction ("${userText.trim()}"). ${
          cloud.status !== 'connected'
            ? 'Real AI regeneration requires the backend to be connected in Cloud Settings.'
            : 'Open Generated Images and press Generate on that shot to regenerate it.'
        }`,
        updatedProject: next,
        actionHint: cloud.status !== 'connected' ? 'open_cloud' : undefined,
      };
    }
  }

  if (
    lower.includes('story') ||
    lower.includes('character') ||
    lower.includes('context') ||
    lower.includes('status')
  ) {
    const audit = auditProjectMaterials(next);
    return {
      replyText: [
        `Current Project Context for "${next.title}":`,
        ...audit.summaryLines,
        audit.errors.length > 0
          ? `\nPending before Start Production:\n${audit.errors
              .map((e) => `• ${e}`)
              .join('\n')}`
          : '\nAll required sections are saved and locked. Ready to start production.',
      ].join('\n'),
      updatedProject: next,
      actionHint: audit.errors.length === 0 ? 'start_production' : undefined,
    };
  }

  if (
    lower.includes('start') &&
    (lower.includes('image') ||
      lower.includes('video') ||
      lower.includes('production'))
  ) {
    return {
      replyText:
        'Use + → START PRODUCTION. It validates all sections, then Step 1 generates Images and Step 2 generates Videos from those images (two separate steps, each asks for confirmation).',
      updatedProject: next,
      actionHint: 'start_production',
    };
  }

  if (
    lower.includes('setting') ||
    lower.includes('resolution') ||
    lower.includes('aspect')
  ) {
    return {
      replyText: `Current Production Settings: ${next.productionSettings.generateType} · ${next.productionSettings.aspectRatio} · ${next.productionSettings.resolution} · x${next.productionSettings.imageQuantity} images / x${next.productionSettings.videoQuantity} videos · ${next.productionSettings.videoDurationSec}s (${next.productionSettings.locked ? 'Locked' : next.productionSettings.savedAt ? 'Saved · Unlocked' : 'Unsaved'}).`,
      updatedProject: next,
      actionHint: 'open_settings',
    };
  }

  return {
    replyText: `Local mode (no AI connected): project "${next.title}" has ${next.story.savedAt ? 'a saved story' : 'no saved story'}, ${next.characters.length} saved character(s), ${next.imagePrompts.parsedItems.length} image prompt(s), ${next.videoPrompts.parsedItems.length} video prompt(s). I understand commands like "status", "settings", "S01 SH02 slower movement" or "S01 SH01 regenerate with warmer lighting". Connect the backend in Cloud Settings for real Gemini chat.`,
    updatedProject: next,
  };
}
