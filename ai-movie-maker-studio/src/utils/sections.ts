import { MaterialSectionKey, MovieProject } from '../types/studio';
import { characterCompleteness, REF_SLOT_KEYS, selectedCandidate, shotKey } from './validation';

export type HubStatus = 'locked' | 'saved' | 'unsaved' | 'empty';

export interface HubSection {
  key: MaterialSectionKey;
  number: number;
  title: string;
  bengali: string;
  status: HubStatus;
  detail: string;
}

function sameSel(a: Record<string, string> | undefined, items: MovieProject['imagePrompts']['parsedItems']) {
  if (!a) return false;
  const cur: Record<string, string> = {};
  for (const i of items) {
    const c = selectedCandidate(i);
    if (c) cur[shotKey(i)] = c.id;
  }
  const ka = Object.keys(a);
  return ka.length === Object.keys(cur).length && ka.every((k) => a[k] === cur[k]);
}

/** Status of the 8 Project Materials sections, as shown in the Hub and the + menu. */
export function getHubSections(p: MovieProject): HubSection[] {
  const textStatus = (saved?: string, locked?: boolean, hasText?: boolean): HubStatus =>
    locked ? 'locked' : saved ? 'saved' : hasText ? 'unsaved' : 'empty';

  const chars = p.characters;
  const complete = chars.filter((c) => characterCompleteness(c).complete).length;
  const slots = chars.flatMap((c) => REF_SLOT_KEYS.map((k) => ({ c, s: c.references[k] })));
  const savedSlots = slots.filter(({ s }) => s.imageUrl && s.savedAt).length;
  const refsStatus: HubStatus =
    chars.length === 0 || savedSlots === 0
      ? 'empty'
      : slots.every(({ c, s }) => c.locked || s.locked)
        ? 'locked'
        : 'saved';

  const imgs = p.imagePrompts.parsedItems;
  const vids = p.videoPrompts.parsedItems;
  const outStatus = (sec: MovieProject['generatedImagesSection'], items: typeof imgs): HubStatus =>
    sec.locked ? 'locked' : sec.savedAt && sameSel(sec.savedSelection, items) ? 'saved' : items.some((i) => i.generatedUrl) ? 'unsaved' : 'empty';

  return [
    {
      key: 'story',
      number: 1,
      title: 'Story Master',
      bengali: 'সম্পূর্ণ গল্প',
      status: textStatus(p.story.savedAt, p.story.locked, Boolean(p.story.rawText.trim())),
      detail: p.story.rawText.trim() ? `${p.story.rawText.trim().split(/\s+/).length} words` : 'No story yet',
    },
    {
      key: 'characters',
      number: 2,
      title: 'Character Information',
      bengali: 'চরিত্রের তথ্য',
      status: chars.length === 0 ? 'empty' : chars.every((c) => c.locked) ? 'locked' : 'saved',
      detail: `${chars.length} saved · ${complete} complete`,
    },
    {
      key: 'character_refs',
      number: 3,
      title: 'Character Reference Images',
      bengali: 'Face · Front · Side · Back',
      status: refsStatus,
      detail: `${savedSlots} / ${chars.length * 4} images saved`,
    },
    {
      key: 'image_prompts',
      number: 4,
      title: 'Image Prompts',
      bengali: 'Scene ID · Shot ID',
      status: textStatus(p.imagePrompts.savedAt, p.imagePrompts.locked, Boolean(p.imagePrompts.rawText.trim())),
      detail: `${imgs.length} shot(s)`,
    },
    {
      key: 'video_prompts',
      number: 5,
      title: 'Video Prompts',
      bengali: 'ছবির সাথে মিলানো',
      status: textStatus(p.videoPrompts.savedAt, p.videoPrompts.locked, Boolean(p.videoPrompts.rawText.trim())),
      detail: `${vids.length} shot(s) · ${vids.filter((v) => !v.linkedImageKey).length} unmatched`,
    },
    {
      key: 'production_settings',
      number: 6,
      title: 'Production Settings',
      bengali: 'Platform · Ratio · Quality',
      status: textStatus(p.productionSettings.savedAt, p.productionSettings.locked, false),
      detail: `${p.productionSettings.aspectRatio} · ${p.productionSettings.resolution} · ${p.productionSettings.generateType.replace(/_/g, ' ')}`,
    },
    {
      key: 'generated_images',
      number: 7,
      title: 'Generated Images',
      bengali: 'Step 1 · ছবি',
      status: outStatus(p.generatedImagesSection, imgs),
      detail: `${imgs.filter((i) => i.generatedUrl).length} / ${imgs.length} shots have an image`,
    },
    {
      key: 'generated_videos',
      number: 8,
      title: 'Generated Videos & Export',
      bengali: 'Step 2 · ভিডিও · ZIP · MP4',
      status: outStatus(p.generatedVideosSection, vids),
      detail: `${vids.filter((v) => v.generatedUrl).length} / ${vids.length} shots have a video`,
    },
  ];
}
