import {
  CharacterCard,
  MovieProject,
  OutputSectionState,
  ProductionSettings,
} from '../types/studio';
import { createId, parsePromptsFromRawText } from '../utils/validation';

export const SAMPLE_IMAGES = {
  harborStill: '/src/assets/images/harbor_nocturne_still_1795338406198.jpg',
  elenaPortrait: '/src/assets/images/character_elena_portrait_1795338406234.jpg',
  marcusPortrait: '/src/assets/images/character_marcus_portrait_1795338406268.jpg',
};

export function createDefaultProductionSettings(): ProductionSettings {
  return {
    generateType: 'image_and_video',
    platform: 'youtube_movie',
    customPlatformLabel: '',
    aspectRatio: '16:9',
    resolution: '1080p',
    imageQuantity: 1,
    videoQuantity: 1,
    generationOrder: 1,
    videoDurationSec: 8,
    modelProfileId: 'vertex_standard',
    locked: false,
  };
}

export function createEmptyOutputSection(): OutputSectionState {
  return { locked: false };
}

export function createEmptyCharacterCard(): CharacterCard {
  return {
    id: createId('chr'),
    nameAndDetails: '',
    references: {
      face: { prompt: '', locked: false },
      front: { prompt: '', locked: false },
      side: { prompt: '', locked: false },
      back: { prompt: '', locked: false },
    },
    locked: false,
  };
}

/**
 * Optional Demo Project ("Nocturne at Harbor 9").
 * Never treats sample reference stills as real AI-generated movie outputs.
 */
export function createSampleProject(): MovieProject {
  const now = new Date().toISOString();

  const sampleImageRaw = `S01 | SH01 | Wide establishing shot of rain-slicked harbor pier at twilight, warm amber sodium lamps reflecting on dark water, lone investigator near moored freighter.
S01 | SH02 | Medium close-up of Elena Vance in dark navy wool peacoat looking toward harbor mist under warm rim light.
S02 | SH01 | Tight portrait of harbormaster Marcus Cole in navy canvas jacket illuminated by radar glow and desk lamp.`;

  const parsedImages = parsePromptsFromRawText(sampleImageRaw, 'image');

  const sampleVideoRaw = `S01 | SH01 | Slow crane descent toward the rain-drenched pier while sodium lamp reflections shimmer across dark harbor ripples.
S01 | SH02 | Subtle push-in on Elena Vance as wind shifts her collar and distant harbor light pulses across her face.
S02 | SH01 | Locked shot with slow focus rack as Marcus Cole turns from the radar screen toward the desk.`;

  const parsedVideos = parsePromptsFromRawText(
    sampleVideoRaw,
    'video',
    parsedImages
  );

  return {
    id: 'proj_nocturne_harbor_9',
    title: 'Nocturne at Harbor 9 (Demo)',
    isDemo: true,
    createdAt: now,
    updatedAt: now,
    projectLocked: false,
    story: {
      rawText: `SCENE S01: EXT. HARBOR PIER 9 - TWILIGHT
Rain sheets across wet concrete under amber sodium lamps. Elena Vance stands at the edge of Pier 9 watching the darkened freighter Nordic Star drift against the pilings.
ELENA: Nobody cleared berth nine after midnight.

SCENE S02: INT. HARBORMASTER OFFICE - NIGHT
Marcus Cole studies a cracked radar terminal. Elena drops a brass manifest key onto his desk.
MARCUS: That vessel was flagged decommissioned six months ago.`,
      filename: 'nocturne_story.txt',
      locked: false,
    },
    characters: [
      {
        id: 'chr_elena',
        nameAndDetails:
          'Name: Elena Vance\nAge: 35\nGender: Female\nAppearance: Lean athletic build, damp dark hair tied back, sharp eyes.\nClothing & Style: Heavy navy wool peacoat, dark knit sweater, silver hoop earrings.\nPersonality: Composed, persistent maritime investigator.\nWalking Style & Body Language: Measured deliberate stride; hands tucked in coat pockets until inspecting evidence.',
        references: {
          face: {
            prompt:
              '35-year-old female maritime investigator, sharp gaze, damp dark hair, moody studio lighting',
            imageUrl: SAMPLE_IMAGES.elenaPortrait,
            filename: 'elena_face_sample.jpg',
            source: 'sample_asset',
            uploadedAt: now,
            locked: false,
          },
          front: {
            prompt:
              'Full-body front view of Elena Vance wearing navy wool peacoat and dark boots, neutral studio background',
            locked: false,
          },
          side: {
            prompt:
              'Full-body side profile view of Elena Vance in navy wool peacoat, measured posture',
            locked: false,
          },
          back: {
            prompt:
              'Full-body back view of Elena Vance in navy wool peacoat, damp dark hair tied back',
            locked: false,
          },
        },
        savedAt: now,
        locked: false,
      },
      {
        id: 'chr_marcus',
        nameAndDetails:
          'Name: Marcus Cole\nAge: 48\nGender: Male\nAppearance: Broad-shouldered, weathered skin, salt-and-pepper beard.\nClothing & Style: Heavy navy waxed canvas jacket with brass compass pin.\nPersonality: Guarded, gruff veteran harbormaster.\nWalking Style & Body Language: Heavy steady dockworker gait; leans over consoles with planted forearms.',
        references: {
          face: {
            prompt:
              '48-year-old weathered harbormaster, salt-and-pepper beard, dramatic key light',
            imageUrl: SAMPLE_IMAGES.marcusPortrait,
            filename: 'marcus_face_sample.jpg',
            source: 'sample_asset',
            uploadedAt: now,
            locked: false,
          },
          front: {
            prompt:
              'Full-body front view of Marcus Cole in navy waxed canvas jacket and work boots',
            locked: false,
          },
          side: {
            prompt:
              'Full-body side view of Marcus Cole in navy waxed canvas jacket',
            locked: false,
          },
          back: {
            prompt:
              'Full-body back view of Marcus Cole in navy waxed canvas jacket',
            locked: false,
          },
        },
        savedAt: now,
        locked: false,
      },
    ],
    imagePrompts: {
      rawText: sampleImageRaw,
      filename: 'image_prompts.txt',
      locked: false,
      parsedItems: parsedImages,
    },
    videoPrompts: {
      rawText: sampleVideoRaw,
      filename: 'video_prompts.txt',
      locked: false,
      parsedItems: parsedVideos,
    },
    productionSettings: createDefaultProductionSettings(),
    generatedImagesSection: createEmptyOutputSection(),
    generatedVideosSection: createEmptyOutputSection(),
    costAndJobs: {
      budgetLimitUsd: 25,
      estimatedCostUsd: null,
      actualSpentUsd: 0,
      jobs: [],
      history: [
        {
          id: 'hist_sample_1',
          timestamp: now,
          summary:
            'Loaded optional Demo Project "Nocturne at Harbor 9" (all sections unlocked; 0 generated outputs)',
        },
      ],
    },
    versions: [],
    chatMessages: [
      {
        id: 'msg_init_1',
        role: 'assistant',
        timestamp: now,
        text: 'Demo Project "Nocturne at Harbor 9" is open. Sample reference images are starter examples only (not AI-generated outputs). All sections start UNLOCKED. Open + → Project Materials, then for each section: Edit → Save → Lock (optional) → Back. When everything is ready, press "Send All Materials to Main Chat" in Project Materials.',
      },
    ],
  };
}

export function createBlankProject(
  title: string,
  settingsOverride?: Partial<ProductionSettings>
): MovieProject {
  const now = new Date().toISOString();
  const cleanTitle = title.trim() || 'Untitled Movie';
  return {
    id: createId('proj'),
    title: cleanTitle,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
    projectLocked: false,
    story: {
      rawText: '',
      locked: false,
    },
    characters: [],
    imagePrompts: {
      rawText: '',
      locked: false,
      parsedItems: [],
    },
    videoPrompts: {
      rawText: '',
      locked: false,
      parsedItems: [],
    },
    productionSettings: {
      ...createDefaultProductionSettings(),
      ...settingsOverride,
      locked: false,
    },
    generatedImagesSection: createEmptyOutputSection(),
    generatedVideosSection: createEmptyOutputSection(),
    costAndJobs: {
      budgetLimitUsd: 25,
      estimatedCostUsd: null,
      actualSpentUsd: 0,
      jobs: [],
      history: [
        {
          id: createId('hist'),
          timestamp: now,
          summary: `Created blank project "${cleanTitle}" (all sections unlocked)`,
        },
      ],
    },
    versions: [],
    chatMessages: [
      {
        id: createId('msg'),
        role: 'assistant',
        timestamp: now,
        text: `Blank project "${cleanTitle}" is ready. Tap + → Project Materials to fill the 8 sections (Story, Character Information, Character Reference Images, Image Prompts, Video Prompts, Production Settings, Generated Images, Generated Videos & Export). Each section: Edit → Save → Lock → Back. Nothing is sent here until you press "Send All Materials to Main Chat".`,
      },
    ],
  };
}
