/**
 * Story-to-movie pipeline tests with a scripted mock AI (no Gemini, no paid call).
 * Covers: structure, deterministic IDs, character consistency, image<->video mapping,
 * JSON validation and repair, limits, HTTP endpoint (auth, quota, errors), and the draft ->
 * materials conversion.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app';
import { LocalDiskBlobStore } from '../server/blobStore';
import { BlobJobStore } from '../server/jobStore';
import { analyzeStory, consistencyPrompt, parseModelJson, PipelineError, validateAnalysis } from '../server/storyPipeline';
import { BlobUsageStore } from '../server/usage';
import { characterInfoText, hashStory, planStats, promptsText } from '../src/utils/storyPlan';
import { parsePromptsFromRawText } from '../src/utils/validation';
import { createStoryMock, SAMPLE_STORY } from './storyMock';
import { createStubProvider, listen, makeTestClip, tempDir, TEST_SESSION_SECRET, testVerifier } from './helpers';

describe('JSON extraction', () => {
  it('reads plain JSON, fenced JSON with chatter, trailing commas and comments', () => {
    assert.deepEqual(parseModelJson('{"a":1}'), { ok: true, value: { a: 1 } });
    assert.deepEqual(parseModelJson('Here you go:\n```json\n{"a": [1,2,],}\n```\nbye'), { ok: true, value: { a: [1, 2] } });
    assert.deepEqual(parseModelJson('{"a": 1, // note\n "b": 2}'), { ok: true, value: { a: 1, b: 2 } });
  });
  it('reports answers that are not JSON', () => {
    for (const bad of ['no braces here', '{"a": ', '']) assert.equal(parseModelJson(bad).ok, false, bad);
  });
});

describe('story pipeline (mock AI)', () => {
  it('Story → characters → scenes → shots → image + video prompts: complete, ordered, uniquely identified', async () => {
    const { provider, calls } = createStoryMock();
    const { plan, meta } = await analyzeStory(provider, SAMPLE_STORY);

    assert.deepEqual(planStats(plan), { characters: 2, scenes: 3, shots: 6 });
    assert.deepEqual(plan.characters.map((c) => c.name), ['Rahim', 'Nila'], 'names exactly as in the story');
    assert.deepEqual(plan.scenes.map((s) => s.sceneId), ['S01', 'S02', 'S03'], 'scene ids are made by the pipeline, not the model');
    for (const s of plan.scenes) assert.deepEqual(s.shots.map((x) => x.shotId), ['SH01', 'SH02'].slice(0, s.shots.length));
    const keys = plan.scenes.flatMap((s) => s.shots.map((x) => `${s.sceneId}-${x.shotId}`));
    assert.equal(new Set(keys).size, keys.length, 'no duplicate Scene/Shot id');
    for (const s of plan.scenes) for (const sh of s.shots) {
      assert.ok(sh.imagePrompt.length > 20 && sh.videoPrompt.length > 10, `${s.sceneId} ${sh.shotId} has both prompts`);
      assert.ok(sh.description && sh.camera);
    }
    assert.equal(meta.providerCalls, 3, 'one call per stage');
    assert.deepEqual(calls.map((c) => c.stage), ['analysis', 'breakdown', 'prompts']);
    assert.ok(calls.every((c) => c.json === true), 'JSON mode requested');
  });

  it('characters stay identical in every scene: one fixed description is added to every prompt they appear in', async () => {
    const { plan } = await analyzeStory(createStoryMock().provider, SAMPLE_STORY);
    const rahim = plan.characters.find((c) => c.name === 'Rahim')!;
    assert.match(rahim.consistencyPrompt, /30 male.*lean build.*short black hair.*wearing faded white panjabi.*small scar/);
    const withRahim = plan.scenes.flatMap((s) => s.shots.filter((sh) => sh.characters.includes('Rahim')));
    assert.ok(withRahim.length >= 3);
    for (const sh of withRahim) {
      assert.ok(sh.imagePrompt.includes(`Rahim: ${rahim.consistencyPrompt}`), 'same descriptor text in every shot');
      assert.match(sh.videoPrompt, /Rahim/);
    }
    // a character who is NOT in the shot is not described there
    const rahimOnly = plan.scenes[0].shots[0];
    assert.deepEqual(rahimOnly.characters, ['Rahim']);
    assert.ok(!rahimOnly.imagePrompt.includes('Nila:'));
  });

  it('character names from the model are normalised; unknown names are dropped with a warning', async () => {
    const { plan, meta } = await analyzeStory(createStoryMock().provider, SAMPLE_STORY);
    const all = new Set(plan.scenes.flatMap((s) => [...s.characters, ...s.shots.flatMap((x) => x.characters)]));
    assert.deepEqual([...all].sort(), ['Nila', 'Rahim'], '"rahim", "NILA", "Nila Akter" became the canonical names');
    assert.ok(meta.warnings.some((w) => w.includes('Unknown Stranger')), meta.warnings.join('|'));
  });

  it('image and video prompts map one-to-one by Scene/Shot id (Image Prompts and Video Prompts sections parse identically)', async () => {
    const { plan } = await analyzeStory(createStoryMock().provider, SAMPLE_STORY);
    const images = parsePromptsFromRawText(promptsText(plan, 'image'), 'image');
    const videos = parsePromptsFromRawText(promptsText(plan, 'video'), 'video', images);
    assert.equal(images.length, 6);
    assert.equal(videos.length, 6);
    assert.deepEqual(videos.map((v) => `${v.sceneId}-${v.shotId}`), images.map((i) => `${i.sceneId}-${i.shotId}`), 'same ids, same order');
    assert.ok(videos.every((v) => v.linkedImageKey === `${v.sceneId}-${v.shotId}`), 'every video prompt is linked to its image');
    assert.ok(images.every((i) => i.promptText.length > 20));
    // excluded shots disappear from BOTH lists
    const without = new Set(['S02-SH01']);
    assert.equal(parsePromptsFromRawText(promptsText(plan, 'image', without), 'image').length, 5);
    assert.equal(parsePromptsFromRawText(promptsText(plan, 'video', without), 'video').length, 5);
    assert.ok(characterInfoText(plan.characters[0]).startsWith('Name: Rahim\nAge: 30'));
  });

  it('a "|" inside a prompt cannot break the Scene | Shot | prompt format', async () => {
    const { plan } = await analyzeStory(createStoryMock().provider, SAMPLE_STORY);
    plan.scenes[0].shots[0].imagePrompt = 'a | b\nsecond line';
    const items = parsePromptsFromRawText(promptsText(plan, 'image'), 'image');
    assert.equal(items.length, 6);
    assert.equal(items[0].promptText, 'a / b second line');
  });

  it('messy answers (markdown fences, chatter, trailing commas) are read without a repair call', async () => {
    const { provider } = createStoryMock({ messy: true });
    const { plan, meta } = await analyzeStory(provider, SAMPLE_STORY);
    assert.equal(planStats(plan).shots, 6);
    assert.equal(meta.providerCalls, 3);
    assert.deepEqual(meta.repairs, []);
  });

  for (const stage of ['analysis', 'breakdown', 'prompts'] as const) {
    it(`invalid ${stage} answer: the model is asked to repair it with the exact problems, then the plan is valid`, async () => {
      const { provider, calls } = createStoryMock({ invalidOnce: stage });
      const { plan, meta } = await analyzeStory(provider, SAMPLE_STORY);
      assert.equal(meta.repairs.length, 1);
      assert.equal(meta.repairs[0].stage, stage);
      assert.ok(meta.repairs[0].problems.length > 0);
      assert.equal(meta.providerCalls, 4);
      const repairCall = calls.find((c) => c.stage === `repair:${stage}`)!;
      assert.ok(repairCall, 'a repair request was sent');
      assert.ok(repairCall.message.includes(meta.repairs[0].problems[0]), 'the problems are told to the model');
      assert.equal(planStats(plan).shots, 6, 'and the final plan is complete');
    });
  }

  it('an answer that is not JSON at all is repaired', async () => {
    const { plan, meta } = await analyzeStory(createStoryMock({ notJsonOnce: 'breakdown' }).provider, SAMPLE_STORY);
    assert.equal(meta.repairs[0].stage, 'breakdown');
    assert.match(meta.repairs[0].problems[0], /no JSON|not valid JSON/);
    assert.equal(planStats(plan).scenes, 3);
  });

  it('missing shots in the prompts answer are detected by id and repaired', async () => {
    const { provider, calls } = createStoryMock({ missingPromptOnce: true });
    const { plan, meta } = await analyzeStory(provider, SAMPLE_STORY);
    assert.match(meta.repairs[0].problems.join(' '), /Missing prompts for S01 SH01/);
    assert.ok(calls.some((c) => c.stage === 'repair:prompts'));
    assert.ok(plan.scenes.every((s) => s.shots.every((x) => x.imagePrompt && x.videoPrompt)));
  });

  for (const stage of ['analysis', 'breakdown', 'prompts'] as const) {
    it(`a ${stage} answer that stays invalid fails with the step and the problems (no half-finished plan)`, async () => {
      const { provider, calls } = createStoryMock({ alwaysInvalid: stage });
      await assert.rejects(analyzeStory(provider, SAMPLE_STORY, { maxRepairs: 2 }), (e: unknown) => {
        assert.ok(e instanceof PipelineError);
        assert.equal(e.stage, stage);
        assert.ok(e.problems.length > 0);
        return true;
      });
      assert.equal(calls.filter((c) => c.stage === stage || c.stage === `repair:${stage}`).length, 3, '1 try + 2 repairs, then stop');
    });
  }

  it('limits: scenes and shots per scene are capped, with warnings', async () => {
    const { plan, meta } = await analyzeStory(createStoryMock({ scenes: 6, shotsPerScene: 6 }).provider, SAMPLE_STORY, { maxScenes: 3, shotsPerScene: 2 });
    assert.equal(plan.scenes.length, 3);
    assert.ok(plan.scenes.every((s) => s.shots.length === 2));
    assert.ok(meta.warnings.some((w) => /only the first 3 were kept/.test(w)));
    assert.ok(meta.warnings.some((w) => /only the first 2 were kept/.test(w)));
  });

  it('long stories: prompts are requested in chunks of 40 shots, ids stay unique', async () => {
    const { provider, calls } = createStoryMock({ scenes: 6, shotsPerScene: 8 });
    const { plan } = await analyzeStory(provider, SAMPLE_STORY, { maxScenes: 12, shotsPerScene: 8 });
    assert.equal(planStats(plan).shots, 48);
    assert.equal(calls.filter((c) => c.stage === 'prompts').length, 2);
    assert.equal(new Set(plan.scenes.flatMap((s) => s.shots.map((x) => `${s.sceneId}-${x.shotId}`))).size, 48);
  });

  it('never starts any production: the pipeline only uses the text model', async () => {
    const stub = createStubProvider(makeTestClip(tempDir('sclip-'), 'c.mp4', 'red'));
    const story = createStoryMock();
    stub.provider.generateText = story.provider.generateText;
    await analyzeStory(stub.provider, SAMPLE_STORY);
    assert.deepEqual([...new Set(stub.calls.map((c) => c.fn))], [], 'no generateImage / startVideo / pollVideo call');
  });

  it('validators and helpers', () => {
    assert.ok(validateAnalysis({ title: 't', summary: 's', characters: [] }).problems.some((p) => /No character/.test(p)));
    assert.ok(validateAnalysis('nope').problems.length > 0);
    assert.equal(hashStory('abc'), hashStory('abc'));
    assert.notEqual(hashStory('abc'), hashStory('abd'));
    assert.equal(consistencyPrompt({ name: 'A', role: '', age: '9', gender: 'girl', appearance: 'curly red hair.', clothing: 'blue dress', personality: '', distinguishingFeatures: '' }), '9 girl, curly red hair, wearing blue dress');
  });
});

describe('POST /api/story/analyze', () => {
  let base = '';
  let close: () => void = () => undefined;
  let cookie = '';
  const stub = createStubProvider(makeTestClip(tempDir('apiclip-'), 'c.mp4', 'blue'));
  const storyMock = { current: createStoryMock() };
  before(async () => {
    stub.provider.generateText = (s, h, m, o) => storyMock.current.provider.generateText(s, h, m, o);
    const blobs = new LocalDiskBlobStore(tempDir('storyapi-'));
    const srv = await listen(
      createApp({
        provider: stub.provider,
        blobStore: blobs,
        projectStore: null,
        jobStore: new BlobJobStore(blobs),
        usageStore: new BlobUsageStore(blobs),
        quotas: { chat: { perMin: 5, perDay: 50 }, image: { perMin: 5, perDay: 50 }, video: { perMin: 5, perDay: 50 }, story: { perMin: 3, perDay: 50 }, project: { imagePerDay: 50, videoPerDay: 50 } },
        auth: { mode: 'google', googleClientId: 'test', verifier: testVerifier, sessionSecret: TEST_SESSION_SECRET, allowedEmails: ['a@x.com'] },
      })
    );
    base = srv.base;
    close = srv.close;
    const r = await fetch(base + '/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms' }, body: JSON.stringify({ credential: 'test:u1:a@x.com' }) });
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  });
  after(() => close());
  const post = (body: unknown, c = cookie) => fetch(base + '/api/story/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'mms', ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) });

  it('needs sign-in', async () => {
    assert.equal((await post({ story: SAMPLE_STORY }, '')).status, 401);
  });

  it('returns a validated plan and meta; only text calls are made', async () => {
    storyMock.current = createStoryMock({ invalidOnce: 'analysis' });
    stub.calls.length = 0;
    const res = await post({ story: SAMPLE_STORY, style: 'watercolor, soft light', shotsPerScene: 2 });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { plan: { scenes: Array<{ sceneId: string }> }; meta: { repairs: unknown[]; providerCalls: number } };
    assert.equal(body.plan.scenes[0].sceneId, 'S01');
    assert.equal(body.meta.repairs.length, 1);
    assert.equal(stub.calls.filter((c) => c.fn === 'generateImage' || c.fn === 'startVideo').length, 0);
  });

  it('rejects too-short/too-long/invalid input with 400 and uses no quota', async () => {
    for (const body of [{}, { story: 'short' }, { story: 'x'.repeat(60_001) }, { story: SAMPLE_STORY, maxScenes: 99 }, { story: SAMPLE_STORY, shotsPerScene: 0 }, { story: SAMPLE_STORY, style: 'x'.repeat(301) }]) {
      const r = await post(body);
      assert.ok([400, 413].includes(r.status), `${JSON.stringify(body).slice(0, 40)} -> ${r.status}`);
    }
  });

  it('an AI answer that cannot be repaired gives 422 with the step and problems', async () => {
    storyMock.current = createStoryMock({ alwaysInvalid: 'breakdown' });
    const res = await post({ story: SAMPLE_STORY });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { code: string; stage: string; problems: string[]; error: string };
    assert.equal(body.code, 'story_analysis_invalid');
    assert.equal(body.stage, 'breakdown');
    assert.ok(body.problems.length > 0);
    assert.match(body.error, /breakdown/);
  });

  it('has its own quota: the 4th analysis in a minute is 429', async () => {
    storyMock.current = createStoryMock();
    // 2 requests were counted by the tests above that passed validation (success + 422)
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await post({ story: SAMPLE_STORY })).status);
    assert.ok(statuses.includes(429), statuses.join(','));
    const limited = await post({ story: SAMPLE_STORY });
    assert.equal(limited.status, 429);
    assert.equal(((await limited.json()) as { code: string }).code, 'quota_exceeded');
  });
});
