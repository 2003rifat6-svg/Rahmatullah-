import type { PlanCharacter, StoryPlan } from '../types/storyPlan';

/** Short, fast hash of the story text (only used to tell whether the story changed since the analysis). */
export function hashStory(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Character Information text (same field layout the Character Information section uses). */
export function characterInfoText(c: PlanCharacter): string {
  return [
    `Name: ${c.name}`,
    c.age && `Age: ${c.age}`,
    c.gender && `Gender: ${c.gender}`,
    c.role && `Role: ${c.role}`,
    `Appearance: ${c.appearance}`,
    `Clothing & Style: ${c.clothing}`,
    c.personality && `Personality: ${c.personality}`,
    c.distinguishingFeatures && `Distinguishing features: ${c.distinguishingFeatures}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();

/** Keys of excluded shots look like "S01-SH02". Prompts keep the original order and IDs. */
export function promptsText(plan: StoryPlan, kind: 'image' | 'video', excluded: ReadonlySet<string> = new Set()): string {
  return plan.scenes
    .flatMap((s) => s.shots.filter((sh) => !excluded.has(`${s.sceneId}-${sh.shotId}`)).map((sh) => `${s.sceneId} | ${sh.shotId} | ${oneLine(kind === 'image' ? sh.imagePrompt : sh.videoPrompt)}`))
    .join('\n');
}

export function planStats(plan: StoryPlan) {
  return { characters: plan.characters.length, scenes: plan.scenes.length, shots: plan.scenes.reduce((n, s) => n + s.shots.length, 0) };
}
