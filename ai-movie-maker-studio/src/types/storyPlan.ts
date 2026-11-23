/** Output of the automated story analysis (kept as a DRAFT until the user saves it as materials). */
export interface PlanCharacter {
  name: string;
  role: string;
  age: string;
  gender: string;
  appearance: string;
  clothing: string;
  personality: string;
  distinguishingFeatures: string;
  /** One fixed visual description, added to every prompt of every shot this character is in. */
  consistencyPrompt: string;
}

export interface PlanShot {
  /** SH01, SH02 ... (unique inside its scene) */
  shotId: string;
  description: string;
  camera: string;
  characters: string[];
  imagePrompt: string;
  videoPrompt: string;
}

export interface PlanScene {
  /** S01, S02 ... (unique in the plan) */
  sceneId: string;
  title: string;
  location: string;
  timeOfDay: string;
  mood: string;
  summary: string;
  characters: string[];
  shots: PlanShot[];
}

export interface StoryPlan {
  title: string;
  summary: string;
  language: 'bn' | 'en' | 'mixed';
  characters: PlanCharacter[];
  scenes: PlanScene[];
}

export interface StoryPlanMeta {
  /** Provider answers that were invalid JSON / failed validation and had to be repaired. */
  repairs: Array<{ stage: string; attempt: number; problems: string[] }>;
  /** Things fixed or filled in locally (e.g. renumbered ids, unknown character names dropped). */
  warnings: string[];
  providerCalls: number;
}

export interface StoryPlanDraft {
  plan: StoryPlan;
  meta: StoryPlanMeta;
  createdAt: string;
  /** Short hash of the story text this plan was made from (to show when the story changed since). */
  storyHash: string;
}
