import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBlankProject, createEmptyCharacterCard, createSampleProject } from '../src/data/sampleProject';
import { buildMaterialsBundle, interpretMainChatMessage, DEFAULT_CLOUD_SETTINGS } from '../src/services/studioBackend';
import { charactersInPrompt } from '../src/services/productionRunner';
import { getHubSections } from '../src/utils/sections';
import {
  auditProjectMaterials,
  characterCompleteness,
  characterDisplayName,
  mergeShotOutputs,
  parsePromptsFromRawText,
} from '../src/utils/validation';
import type { MovieProject } from '../src/types/studio';

const IMG = 'data:image/png;base64,AAAA';

function readyProject(): MovieProject {
  const p = createSampleProject();
  const now = new Date().toISOString();
  p.story = { ...p.story, savedAt: now, locked: true };
  p.imagePrompts = { ...p.imagePrompts, savedAt: now, locked: true };
  p.videoPrompts = { ...p.videoPrompts, savedAt: now, locked: true };
  p.productionSettings = { ...p.productionSettings, savedAt: now, locked: true };
  p.characters = p.characters.map((c) => ({
    ...c,
    locked: true,
    references: { ...c.references, face: { ...c.references.face, imageUrl: IMG, savedAt: now } },
  }));
  return p;
}

describe('sections start UNLOCKED', () => {
  it('a new project has all 8 sections unlocked and not saved', () => {
    const sections = getHubSections(createBlankProject('X'));
    assert.equal(sections.length, 8);
    assert.deepEqual(
      sections.map((s) => s.key),
      ['story', 'characters', 'character_refs', 'image_prompts', 'video_prompts', 'production_settings', 'generated_images', 'generated_videos']
    );
    assert.ok(sections.every((s) => s.status !== 'locked'));
  });
});

describe('prompt parsing keeps Scene/Shot IDs and order', () => {
  it('parses pipe format and links videos to images', () => {
    const imgs = parsePromptsFromRawText('S02 | SH03 | b\nS01 | SH01 | a', 'image');
    assert.deepEqual(imgs.map((i) => `${i.sceneId}-${i.shotId}`), ['S02-SH03', 'S01-SH01']);
    const vids = parsePromptsFromRawText('S01 | SH01 | move\nS09 | SH09 | lost', 'video', imgs);
    assert.equal(vids[0].linkedImageKey, 'S01-SH01');
    assert.equal(vids[1].linkedImageKey, undefined);
  });

  it('re-saving prompts keeps already generated outputs (by Scene/Shot ID)', () => {
    const before = parsePromptsFromRawText('S01 | SH01 | a\nS01 | SH02 | b', 'image');
    before[1] = {
      ...before[1],
      generatedUrl: IMG,
      assetSource: 'cloud_generated',
      status: 'completed',
      candidates: [{ id: 'c1', url: IMG, source: 'cloud_generated', createdAt: '', fromPrompt: 'b' }],
      selectedCandidateId: 'c1',
    };
    const after = mergeShotOutputs(parsePromptsFromRawText('S01 | SH02 | b edited\nS01 | SH03 | c', 'image'), before);
    assert.equal(after[0].generatedUrl, IMG);
    assert.equal(after[0].selectedCandidateId, 'c1');
    assert.equal(after[1].generatedUrl, undefined);
  });
});

describe('characters', () => {
  it('display name comes from the Name: line', () => {
    assert.equal(characterDisplayName({ id: 'x', nameAndDetails: 'Age: 3\nName: Rahim Uddin' }), 'Rahim Uddin');
    assert.equal(characterDisplayName({ id: 'x', nameAndDetails: 'নাম: করিম' }), 'করিম');
  });

  it('incomplete until info is saved AND a face image is saved', () => {
    const c = createEmptyCharacterCard();
    c.nameAndDetails = 'Name: Test';
    assert.equal(characterCompleteness(c).complete, false);
    c.savedAt = 'now';
    assert.equal(characterCompleteness(c).complete, false);
    c.references.face = { prompt: '', imageUrl: IMG }; // image not saved yet
    assert.equal(characterCompleteness(c).complete, false);
    c.references.face.savedAt = 'now';
    assert.equal(characterCompleteness(c).complete, true);
  });

  it('only complete characters mentioned in a prompt are attached to a shot', () => {
    const p = readyProject();
    const found = charactersInPrompt(p, 'Medium close-up of Elena Vance near the harbor');
    assert.deepEqual(found.map((c) => c.id), ['chr_elena']);
  });
});

describe('Send All Materials bundle', () => {
  it('includes only saved sections and excludes incomplete characters', () => {
    const p = createSampleProject(); // nothing saved, sample face images not "saved"
    const b = buildMaterialsBundle(p);
    assert.ok(!b.bundleText.includes('[1] STORY MASTER'));
    assert.ok(!b.bundleText.includes('--- Character'));
    assert.ok(b.excluded.some((e) => e.includes('Story Master')));
    assert.ok(b.excluded.some((e) => e.includes('Elena Vance') && e.includes('incomplete')));
  });

  it('a fully prepared project produces a complete, ordered bundle with no errors', () => {
    const p = readyProject();
    const b = buildMaterialsBundle(p);
    for (const tag of ['[1] STORY MASTER', '[2] CHARACTER INFORMATION', '[3] CHARACTER REFERENCE IMAGES', '[4] IMAGE PROMPTS', '[5] VIDEO PROMPTS', '[6] PRODUCTION SETTINGS']) {
      assert.ok(b.bundleText.includes(tag), tag);
    }
    assert.ok(b.bundleText.indexOf('S01 | SH01') < b.bundleText.indexOf('S02 | SH01'));
    assert.equal(auditProjectMaterials(p).errors.length, 0);
    assert.equal(b.actionHint, 'start_production');
  });

  it('video step waits for images', () => {
    const audit = auditProjectMaterials(readyProject());
    assert.equal(audit.videoStepErrors.length, 3);
  });
});

describe('Main Chat respects locks', () => {
  it('does not revise a locked prompt section', () => {
    const p = readyProject();
    const before = p.videoPrompts.parsedItems[0].promptText;
    const r = interpretMainChatMessage(p, 'S01 SH01 slower movement', DEFAULT_CLOUD_SETTINGS);
    assert.match(r.replyText, /LOCKED/);
    assert.equal(r.updatedProject.videoPrompts.parsedItems[0].promptText, before);
  });
});
