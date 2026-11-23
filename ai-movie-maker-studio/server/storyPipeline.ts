/**
 * Automated story analysis:
 *   Story -> analysis + characters -> scene/shot breakdown -> image & video prompts -> StoryPlan (JSON)
 *
 * Every AI answer is parsed and validated; an invalid answer is sent back to the model for repair
 * (max 2 repairs per stage). IDs (S01.., SH01..), character consistency and the one-image-prompt +
 * one-video-prompt-per-shot mapping are enforced here in code, not left to the model.
 * Nothing here starts any image/video generation.
 */
import type { PlanCharacter, PlanScene, PlanShot, StoryPlan, StoryPlanMeta } from '../src/types/storyPlan';
import type { StudioAiProvider } from './provider';

export class PipelineError extends Error {
  constructor(
    message: string,
    public stage: string,
    public problems: string[]
  ) {
    super(message);
  }
}

export interface PipelineOptions {
  /** Visual style wording used in prompts (e.g. "cinematic, realistic"). */
  style?: string;
  maxScenes?: number;
  shotsPerScene?: number;
  maxRepairs?: number;
}

type Provider = Pick<StudioAiProvider, 'generateText'>;
type Validated<T> = { value: T; problems: string[] };

const MAX_CHARACTERS = 12;
const PROMPT_CHUNK = 40;

// ---------- JSON handling ----------
/** Extracts one JSON object from a model answer (markdown fences, chatter, trailing commas, comments). */
export function parseModelJson(text: string): { ok: true; value: unknown } | { ok: false; problem: string } {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, problem: 'The answer contains no JSON object.' };
  const body = t.slice(start, end + 1);
  const attempts = [body, body.replace(/\/\/[^\n"]*$/gm, '').replace(/,\s*([}\]])/g, '$1')];
  let lastError = '';
  for (const a of attempts) {
    try {
      return { ok: true, value: JSON.parse(a) };
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'invalid JSON';
    }
  }
  return { ok: false, problem: `The answer is not valid JSON (${lastError}).` };
}

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function str(v: unknown, path: string, problems: string[], opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const { min = 1, max = 2000, optional = false } = opts;
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (!optional) problems.push(`${path} is missing.`);
    return '';
  }
  if (typeof v !== 'string' && typeof v !== 'number') {
    problems.push(`${path} must be text.`);
    return '';
  }
  const t = String(v).trim().replace(/\s+/g, ' ');
  if (t.length < min) problems.push(`${path} is too short.`);
  return t.slice(0, max);
}

const strList = (v: unknown, path: string, problems: string[]): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    problems.push(`${path} must be a list.`);
    return [];
  }
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim());
};

// ---------- stage validators ----------
interface AnalysisResult {
  title: string;
  summary: string;
  language: StoryPlan['language'];
  characters: Omit<PlanCharacter, 'consistencyPrompt'>[];
}

export function validateAnalysis(raw: unknown): Validated<AnalysisResult> {
  const problems: string[] = [];
  const o = asObj(raw);
  if (!o) return { value: { title: '', summary: '', language: 'en', characters: [] }, problems: ['The answer must be a JSON object.'] };
  const title = str(o.title, 'title', problems, { max: 200 });
  const summary = str(o.summary, 'summary', problems, { max: 800 });
  const lang = String(o.language ?? '').toLowerCase();
  const language: StoryPlan['language'] = lang === 'bn' || lang === 'en' || lang === 'mixed' ? lang : 'en';
  const list = Array.isArray(o.characters) ? o.characters : null;
  if (!list) problems.push('characters must be a list.');
  const characters: AnalysisResult['characters'] = [];
  const seen = new Set<string>();
  (list ?? []).slice(0, MAX_CHARACTERS).forEach((c, i) => {
    const co = asObj(c);
    if (!co) return void problems.push(`characters[${i}] must be an object.`);
    const name = str(co.name, `characters[${i}].name`, problems, { max: 80 });
    if (name && seen.has(name.toLowerCase())) return void problems.push(`characters[${i}].name "${name}" is a duplicate.`);
    if (name) seen.add(name.toLowerCase());
    characters.push({
      name,
      role: str(co.role, `characters[${i}].role`, problems, { max: 200, optional: true }),
      age: str(co.age, `characters[${i}].age`, problems, { max: 40, optional: true }),
      gender: str(co.gender, `characters[${i}].gender`, problems, { max: 40, optional: true }),
      appearance: str(co.appearance, `characters[${i}].appearance`, problems, { min: 8, max: 600 }),
      clothing: str(co.clothing, `characters[${i}].clothing`, problems, { min: 3, max: 400 }),
      personality: str(co.personality, `characters[${i}].personality`, problems, { max: 400, optional: true }),
      distinguishingFeatures: str(co.distinguishingFeatures, `characters[${i}].distinguishingFeatures`, problems, { max: 300, optional: true }),
    });
  });
  if (list && characters.length === 0) problems.push('No character was found. List at least one character.');
  return { value: { title, summary, language, characters }, problems };
}

interface RawScene {
  title: string;
  location: string;
  timeOfDay: string;
  mood: string;
  summary: string;
  characters: string[];
  shots: Array<{ description: string; camera: string; characters: string[] }>;
}

export function validateBreakdown(raw: unknown): Validated<RawScene[]> {
  const problems: string[] = [];
  const o = asObj(raw);
  const list = o && Array.isArray(o.scenes) ? o.scenes : null;
  if (!list) return { value: [], problems: ['scenes must be a list.'] };
  const scenes: RawScene[] = [];
  list.forEach((s, i) => {
    const so = asObj(s);
    if (!so) return void problems.push(`scenes[${i}] must be an object.`);
    const shotsRaw = Array.isArray(so.shots) ? so.shots : null;
    if (!shotsRaw || shotsRaw.length === 0) problems.push(`scenes[${i}].shots must list at least one shot.`);
    scenes.push({
      title: str(so.title, `scenes[${i}].title`, problems, { max: 200 }),
      location: str(so.location, `scenes[${i}].location`, problems, { max: 200 }),
      timeOfDay: str(so.timeOfDay, `scenes[${i}].timeOfDay`, problems, { max: 80, optional: true }),
      mood: str(so.mood, `scenes[${i}].mood`, problems, { max: 120, optional: true }),
      summary: str(so.summary, `scenes[${i}].summary`, problems, { max: 600 }),
      characters: strList(so.characters, `scenes[${i}].characters`, problems),
      shots: (shotsRaw ?? []).map((sh, j) => {
        const sho = asObj(sh) ?? {};
        return {
          description: str(sho.description, `scenes[${i}].shots[${j}].description`, problems, { min: 8, max: 600 }),
          camera: str(sho.camera, `scenes[${i}].shots[${j}].camera`, problems, { max: 160, optional: true }),
          characters: strList(sho.characters, `scenes[${i}].shots[${j}].characters`, problems),
        };
      }),
    });
  });
  if (scenes.length === 0) problems.push('No scene was found.');
  return { value: scenes, problems };
}

export function validatePrompts(raw: unknown, expected: Array<{ sceneId: string; shotId: string }>): Validated<Map<string, { imagePrompt: string; videoPrompt: string }>> {
  const problems: string[] = [];
  const out = new Map<string, { imagePrompt: string; videoPrompt: string }>();
  const o = asObj(raw);
  const list = o && Array.isArray(o.shots) ? o.shots : null;
  if (!list) return { value: out, problems: ['shots must be a list.'] };
  const want = new Set(expected.map((e) => `${e.sceneId}|${e.shotId}`));
  list.forEach((x, i) => {
    const xo = asObj(x);
    if (!xo) return void problems.push(`shots[${i}] must be an object.`);
    const key = `${String(xo.sceneId ?? '').trim().toUpperCase()}|${String(xo.shotId ?? '').trim().toUpperCase()}`;
    if (!want.has(key)) return; // extra shots are ignored
    if (out.has(key)) return void problems.push(`shots: ${key.replace('|', ' ')} appears twice.`);
    const imagePrompt = str(xo.imagePrompt, `shots[${i}].imagePrompt`, problems, { min: 12, max: 1200 });
    const videoPrompt = str(xo.videoPrompt, `shots[${i}].videoPrompt`, problems, { min: 8, max: 800 });
    out.set(key, { imagePrompt, videoPrompt });
  });
  for (const k of want) if (!out.has(k)) problems.push(`Missing prompts for ${k.replace('|', ' ')}.`);
  return { value: out, problems };
}

// ---------- model calls with repair ----------
async function askValidJson<T>(
  provider: Provider,
  stage: string,
  system: string,
  prompt: string,
  validate: (raw: unknown) => Validated<T>,
  state: { meta: StoryPlanMeta },
  maxRepairs: number
): Promise<T> {
  let message = prompt;
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    state.meta.providerCalls += 1;
    const answer = await provider.generateText(system, [], message, { json: true });
    const parsed = parseModelJson(answer);
    const problems = parsed.ok ? [] : [parsed.problem];
    if (parsed.ok) {
      const v = validate(parsed.value);
      if (v.problems.length === 0) return v.value;
      problems.push(...v.problems);
    }
    lastProblems = problems;
    if (attempt < maxRepairs) {
      state.meta.repairs.push({ stage, attempt: attempt + 1, problems: problems.slice(0, 12) });
      message =
        `[[STAGE:repair:${stage}]]\nYour previous answer was rejected for these reasons:\n- ${problems.slice(0, 12).join('\n- ')}\n\n` +
        `Original task:\n${prompt}\n\nPrevious answer (for reference):\n${answer.slice(0, 8000)}\n\nReturn ONLY the corrected JSON object.`;
    }
  }
  throw new PipelineError(`The AI answer for the "${stage}" step could not be repaired.`, stage, lastProblems.slice(0, 12));
}

// ---------- deterministic finishing ----------
const pad = (n: number) => String(n).padStart(2, '0');

export function consistencyPrompt(c: Omit<PlanCharacter, 'consistencyPrompt'>): string {
  const parts = [[c.age, c.gender].filter(Boolean).join(' '), c.appearance, c.clothing ? `wearing ${c.clothing}` : '', c.distinguishingFeatures]
    .map((p) => p.replace(/[.\s]+$/, ''))
    .filter(Boolean);
  return parts.join(', ').slice(0, 450);
}

function resolveName(raw: string, names: string[]): string | null {
  const t = raw.trim().toLowerCase();
  const exact = names.find((n) => n.toLowerCase() === t);
  if (exact) return exact;
  const partial = names.filter((n) => n.toLowerCase().split(/\s+/)[0] === t.split(/\s+/)[0] || t.includes(n.toLowerCase()) || n.toLowerCase().includes(t));
  return partial.length === 1 ? partial[0] : null;
}

const endSentence = (s: string) => (/[.!?।]$/.test(s) ? s : `${s}.`);

export async function analyzeStory(provider: Provider, story: string, opts: PipelineOptions = {}): Promise<{ plan: StoryPlan; meta: StoryPlanMeta }> {
  const style = opts.style?.trim() || 'cinematic, photorealistic, natural lighting';
  const maxScenes = Math.min(Math.max(opts.maxScenes ?? 8, 1), 12);
  const shotsPerScene = Math.min(Math.max(opts.shotsPerScene ?? 4, 1), 8);
  const maxRepairs = opts.maxRepairs ?? 2;
  const state = { meta: { repairs: [], warnings: [], providerCalls: 0 } as StoryPlanMeta };
  const warn = (w: string) => state.meta.warnings.push(w);

  // ---- 1. analysis + characters ----
  const analysis = await askValidJson(
    provider,
    'analysis',
    `[[STAGE:analysis]]
You are a film story analyst. Read the WHOLE story and return ONLY one JSON object (no markdown) shaped exactly like:
{"title": string, "summary": string (max 600 chars), "language": "bn" | "en" | "mixed",
 "characters": [{"name": string, "role": string, "age": string, "gender": string, "appearance": string, "clothing": string, "personality": string, "distinguishingFeatures": string}]}
Rules: include every named character that matters (max ${MAX_CHARACTERS}); keep each name exactly as written in the story; describe face, hair and build concretely and visually; if the story does not say, invent ONE plausible specific detail and keep it; write all fields in English except the names.`,
    `STORY:\n${story}`,
    validateAnalysis,
    state,
    maxRepairs
  );
  const characters: PlanCharacter[] = analysis.characters.map((c) => ({ ...c, consistencyPrompt: consistencyPrompt(c) }));
  const names = characters.map((c) => c.name);

  // ---- 2. scene breakdown + shot planning ----
  let rawScenes = await askValidJson(
    provider,
    'breakdown',
    `[[STAGE:breakdown]]
You are a film director planning shots. Return ONLY one JSON object (no markdown):
{"scenes": [{"title": string, "location": string, "timeOfDay": string, "mood": string, "summary": string, "characters": [names],
  "shots": [{"description": string, "camera": string, "characters": [names]}]}]}
Rules: follow the story order; at most ${maxScenes} scenes and ${shotsPerScene} shots per scene; every shot is ONE visual moment; "camera" = shot size + camera movement; use ONLY these character names: ${JSON.stringify(names)}.`,
    `STORY:\n${story}\n\nCHARACTERS:\n${characters.map((c) => `- ${c.name}: ${c.consistencyPrompt}`).join('\n')}`,
    validateBreakdown,
    state,
    maxRepairs
  );
  if (rawScenes.length > maxScenes) {
    warn(`The AI returned ${rawScenes.length} scenes; only the first ${maxScenes} were kept.`);
    rawScenes = rawScenes.slice(0, maxScenes);
  }

  // Deterministic IDs and character-name normalisation (never trust ids or names from the model).
  const scenes: PlanScene[] = rawScenes.map((s, si) => {
    const sceneId = `S${pad(si + 1)}`;
    const mapNames = (list: string[], where: string) =>
      list
        .map((n) => {
          const r = resolveName(n, names);
          if (!r) warn(`${where}: unknown character "${n}" was removed.`);
          return r;
        })
        .filter((n): n is string => Boolean(n))
        .filter((n, i, a) => a.indexOf(n) === i);
    if (s.shots.length > shotsPerScene) warn(`${sceneId}: ${s.shots.length} shots returned; only the first ${shotsPerScene} were kept.`);
    const shots: PlanShot[] = s.shots.slice(0, shotsPerScene).map((sh, shi) => ({
      shotId: `SH${pad(shi + 1)}`,
      description: sh.description,
      camera: sh.camera || 'medium shot, steady',
      characters: mapNames(sh.characters, `${sceneId} SH${pad(shi + 1)}`),
      imagePrompt: '',
      videoPrompt: '',
    }));
    const sceneChars = mapNames(s.characters, sceneId);
    for (const sh of shots) for (const c of sh.characters) if (!sceneChars.includes(c)) sceneChars.push(c);
    return { sceneId, title: s.title, location: s.location, timeOfDay: s.timeOfDay, mood: s.mood, summary: s.summary, characters: sceneChars, shots };
  });
  if (rawScenes.length && scenes.every((s) => s.shots.every((sh) => sh.characters.length === 0))) warn('No shot lists a known character; check the character names.');

  // ---- 3. image + video prompts (chunked so long stories stay within limits) ----
  const flat = scenes.flatMap((s) => s.shots.map((sh) => ({ scene: s, shot: sh })));
  for (let i = 0; i < flat.length; i += PROMPT_CHUNK) {
    const chunk = flat.slice(i, i + PROMPT_CHUNK);
    const expected = chunk.map(({ scene, shot }) => ({ sceneId: scene.sceneId, shotId: shot.shotId }));
    const got = await askValidJson(
      provider,
      'prompts',
      `[[STAGE:prompts]]
You write prompts for AI image and video generators. For EACH listed shot return an imagePrompt (one still frame: subject, action, setting, lighting, composition) and a videoPrompt (the motion of that same frame for about 8 seconds: subject motion + camera motion, no scene change).
Return ONLY: {"shots": [{"sceneId": string, "shotId": string, "imagePrompt": string, "videoPrompt": string}]} with EXACTLY the listed sceneId/shotId values.
Visual style: ${style}. Do not describe the characters' faces or clothes (that is added automatically). Never ask for text, subtitles, logos or watermarks.`,
      `STORY SUMMARY: ${analysis.summary}\n\nSHOTS:\n${chunk
        .map(({ scene, shot }) => `${scene.sceneId} ${shot.shotId} | ${scene.location}, ${scene.timeOfDay}, mood ${scene.mood} | ${shot.camera} | characters: ${shot.characters.join(', ') || 'none'} | ${shot.description}`)
        .join('\n')}`,
      (raw) => validatePrompts(raw, expected),
      state,
      maxRepairs
    );
    for (const { scene, shot } of chunk) {
      const p = got.get(`${scene.sceneId}|${shot.shotId}`)!;
      shot.imagePrompt = p.imagePrompt;
      shot.videoPrompt = p.videoPrompt;
    }
  }

  // ---- 4. enforce consistency + one-to-one mapping in code ----
  for (const { scene, shot } of flat) {
    const who = shot.characters.map((n) => characters.find((c) => c.name === n)!).filter(Boolean);
    const looks = who.map((c) => `${c.name}: ${c.consistencyPrompt}`).join('; ');
    const base = endSentence(shot.imagePrompt);
    shot.imagePrompt = who.length ? `${base} Characters in frame (must look identical in every shot): ${looks}.` : base;
    shot.videoPrompt = who.length ? `${endSentence(shot.videoPrompt)} Keep ${who.map((c) => c.name).join(' and ')} looking exactly as in the start frame.` : endSentence(shot.videoPrompt);
    if (!shot.imagePrompt.trim() || !shot.videoPrompt.trim()) throw new PipelineError('A shot has no prompt after the pipeline.', 'finalize', [`${scene.sceneId} ${shot.shotId}`]);
  }

  const plan: StoryPlan = { title: analysis.title, summary: analysis.summary, language: analysis.language, characters, scenes };
  const ids = new Set<string>();
  for (const s of plan.scenes) for (const sh of s.shots) {
    const k = `${s.sceneId}-${sh.shotId}`;
    if (ids.has(k)) throw new PipelineError(`Duplicate id ${k}`, 'finalize', [k]);
    ids.add(k);
  }
  return { plan, meta: state.meta };
}
