/**
 * TEST-ONLY scripted AI for the story pipeline. It answers each pipeline stage with deterministic
 * JSON and can misbehave on purpose (invalid JSON, missing fields, chatter, missing prompts).
 */
import type { StudioAiProvider } from '../server/provider';

export interface StoryMockOptions {
  /** wrap answers in markdown fences + chatter + trailing commas */
  messy?: boolean;
  /** first answer of this stage is invalid; the repair answer is valid */
  invalidOnce?: 'analysis' | 'breakdown' | 'prompts';
  /** "not json" instead of a JSON object on the first answer of the stage */
  notJsonOnce?: 'analysis' | 'breakdown' | 'prompts';
  /** this stage never returns a valid answer */
  alwaysInvalid?: 'analysis' | 'breakdown' | 'prompts';
  /** first prompts answer leaves out one shot */
  missingPromptOnce?: boolean;
  /** breakdown with many scenes/shots (for chunking and limits) */
  scenes?: number;
  shotsPerScene?: number;
}

export const SAMPLE_STORY =
  'রহিম একজন গরিব মাঝি। প্রতিদিন ভোরে সে নদীতে নৌকা নিয়ে বের হয়। একদিন সে নীলাকে দেখে, নীলা শহর থেকে আসা এক তরুণী। ' +
  'ঝড়ের রাতে নৌকা ডুবে যায় এবং রহিম নীলাকে বাঁচায়। শেষে সকালে তারা দুজনে নদীর পাড়ে বসে হাসে। (Rahim, a poor boatman, saves Nila from a storm.)';

const char = (name: string, extra: Record<string, string> = {}) => ({
  name,
  role: 'lead',
  age: name === 'Rahim' ? '30' : '22',
  gender: name === 'Rahim' ? 'male' : 'female',
  appearance: name === 'Rahim' ? 'lean build, short black hair, sun-tanned skin, kind dark eyes' : 'slim, long black braid, fair skin, large expressive eyes',
  clothing: name === 'Rahim' ? 'faded white panjabi and a checked gamchha' : 'light green saree with a red border',
  personality: 'brave and gentle',
  distinguishingFeatures: name === 'Rahim' ? 'a small scar above the left eyebrow' : 'a silver nose stud',
  ...extra,
});

export function createStoryMock(opts: StoryMockOptions = {}) {
  const calls: Array<{ stage: string; message: string; json?: boolean }> = [];
  const seen: Record<string, number> = {};
  const wrap = (obj: unknown) =>
    opts.messy ? `Sure! Here is the JSON you asked for:\n\`\`\`json\n${JSON.stringify(obj, null, 1).replace(/}(\s*)]/g, '},\n]').replace(/"\n}/g, '",\n}')}\n\`\`\`\nHope this helps!` : JSON.stringify(obj);

  const scenesCount = opts.scenes ?? 3;
  const shotsCount = opts.shotsPerScene ?? 2;
  const breakdown = () => ({
    scenes: Array.from({ length: scenesCount }, (_, si) => ({
      sceneId: si === 1 ? 'S01' : `scene-${si}`, // model-made ids are wrong on purpose: the pipeline must ignore them
      title: `Scene ${si + 1}`,
      location: ['river bank', 'stormy river', 'village shore'][si % 3],
      timeOfDay: ['dawn', 'night', 'morning'][si % 3],
      mood: ['calm', 'tense', 'hopeful'][si % 3],
      summary: `Summary of scene ${si + 1} with enough words.`,
      characters: si === 0 ? ['rahim'] : ['Rahim', 'NILA', 'Unknown Stranger'],
      shots: Array.from({ length: shotsCount }, (_, shi) => ({
        shotId: 'SH99',
        description: `Shot ${shi + 1} of scene ${si + 1}: the boatman works near the water.`,
        camera: shi % 2 ? 'close-up, slow push-in' : 'wide shot, static',
        characters: si === 0 ? ['Rahim'] : shi % 2 ? ['Nila Akter'] : ['Rahim', 'Nila'],
      })),
    })),
  });

  const provider: Pick<StudioAiProvider, 'generateText'> = {
    async generateText(system, _history, message, o) {
      const stage = /\[\[STAGE:(analysis|breakdown|prompts)\]\]/.exec(system)?.[1] ?? /\[\[STAGE:repair:(\w+)\]\]/.exec(message)?.[1] ?? 'unknown';
      const isRepair = message.startsWith('[[STAGE:repair');
      calls.push({ stage: isRepair ? `repair:${stage}` : stage, message, json: o?.json });
      seen[stage] = (seen[stage] ?? 0) + 1;
      const first = seen[stage] === 1;

      if (opts.alwaysInvalid === stage) return '{"nothing": true}';
      if (opts.notJsonOnce === stage && first) return 'I am sorry, I cannot produce JSON right now.';

      if (stage === 'analysis') {
        const good = { title: 'The Boatman', summary: 'A boatman rescues a young woman in a storm.', language: 'mixed', characters: [char('Rahim'), char('Nila')] };
        if (opts.invalidOnce === 'analysis' && first) {
          const bad = JSON.parse(JSON.stringify(good));
          delete bad.characters[0].appearance;
          return wrap(bad);
        }
        return wrap(good);
      }
      if (stage === 'breakdown') {
        if (opts.invalidOnce === 'breakdown' && first) return wrap({ scenes: [{ title: 'x', shots: [] }] });
        return wrap(breakdown());
      }
      if (stage === 'prompts') {
        const ids = [...message.matchAll(/^(S\d+) (SH\d+) \|/gm)].map((m) => ({ sceneId: m[1], shotId: m[2] }));
        let shots = ids.map((i) => ({ ...i, imagePrompt: `Wide film still of the river at ${i.sceneId} ${i.shotId}, golden light, boat on calm water`, videoPrompt: `Slow drift of the boat, camera glides forward (${i.sceneId} ${i.shotId})` }));
        if (opts.missingPromptOnce && first) shots = shots.slice(1);
        if (opts.invalidOnce === 'prompts' && first) shots = shots.map((s) => ({ ...s, imagePrompt: '' }));
        return wrap({ shots });
      }
      return '{}';
    },
  };
  return { provider, calls };
}
