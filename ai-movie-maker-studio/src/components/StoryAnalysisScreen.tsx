import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Save, Sparkles, Trash2 } from 'lucide-react';
import { CloudBackendSettings, MovieProject } from '../types/studio';
import type { StoryPlan } from '../types/storyPlan';
import { hashStory, planStats } from '../utils/storyPlan';

export interface PlanSelection {
  /** Character names to add (with the possibly edited Character Information text). */
  characters: Array<{ name: string; infoText: string }>;
  includeImagePrompts: boolean;
  includeVideoPrompts: boolean;
  /** "S01-SH02" keys of shots left out */
  excludedShots: string[];
}

interface Props {
  project: MovieProject;
  cloudSettings: CloudBackendSettings;
  onAnalyze: (opts: { style: string; maxScenes: number; shotsPerScene: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onUpdateDraft: (plan: StoryPlan) => void;
  onDiscardDraft: () => void;
  onApply: (plan: StoryPlan, selection: PlanSelection, infoOverrides: Record<string, string>) => string;
  buildInfoText: (name: string, plan: StoryPlan) => string;
  onNavigate: (to: 'story' | 'characters' | 'character_refs' | 'image_prompts' | 'video_prompts' | 'cloud_settings') => void;
}

const ta = 'w-full rounded-lg bg-[#07080B] border border-white/[0.1] p-2.5 text-xs text-slate-100 leading-relaxed';

/**
 * AI Story Analysis (Story Master → "AI Story Analysis").
 * The result is a DRAFT that can be edited. Nothing becomes a project material until the user
 * presses "Save as Project Materials", and nothing is generated automatically.
 */
export function StoryAnalysisScreen({ project, cloudSettings, onAnalyze, onUpdateDraft, onDiscardDraft, onApply, buildInfoText, onNavigate }: Props) {
  const draft = project.storyPlanDraft;
  const [plan, setPlan] = useState<StoryPlan | null>(draft?.plan ?? null);
  const [style, setStyle] = useState('cinematic, photorealistic, natural lighting');
  const [maxScenes, setMaxScenes] = useState(8);
  const [shotsPerScene, setShotsPerScene] = useState(4);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [skipChars, setSkipChars] = useState<Set<string>>(new Set());
  const [skipShots, setSkipShots] = useState<Set<string>>(new Set());
  const [infoOverrides, setInfoOverrides] = useState<Record<string, string>>({});
  const [openScene, setOpenScene] = useState<string | null>('S01');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setPlan(draft?.plan ?? null);
  }, [draft?.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const story = project.story;
  const storySaved = Boolean(story.savedAt && story.rawText.trim());
  const aiReady = cloudSettings.status === 'connected' && cloudSettings.geminiConfigured !== false;
  const storyChanged = draft && draft.storyHash !== hashStory(story.rawText);

  const analyze = async () => {
    if (!storySaved) return setNotice({ type: 'error', text: 'Save the Story Master first (the analysis uses the saved story).' });
    if (!aiReady) {
      return setNotice({
        type: 'error',
        text: cloudSettings.status === 'connected' ? 'The server has no GEMINI_API_KEY, so AI analysis is disabled.' : 'Backend not connected (Cloud Settings). No AI analysis is possible and no fake result is created.',
      });
    }
    if (
      draft &&
      !window.confirm('There is already a draft. Analyzing again replaces it (your edits in the draft are lost). Continue?')
    )
      return;
    if (
      !window.confirm(
        'This sends your story to the Gemini AI through your server (a PAID API, about 3 text requests). It uses 1 "story analysis" from your daily limit.\n\nIt does NOT generate images or videos and changes none of your sections until you save the result.\n\nContinue?'
      )
    )
      return;
    setBusy(true);
    setDone(null);
    setNotice(null);
    try {
      const r = await onAnalyze({ style, maxScenes, shotsPerScene });
      if (!r.ok) setNotice({ type: 'error', text: r.error });
      else {
        setSkipChars(new Set());
        setSkipShots(new Set());
        setInfoOverrides({});
        setNotice({ type: 'info', text: 'Draft created. Review and edit it, then press “Save as Project Materials”. Nothing is saved or generated yet.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const commit = (next: StoryPlan) => {
    setPlan(next);
    onUpdateDraft(next);
  };
  const setShot = (sceneId: string, shotId: string, patch: Partial<{ imagePrompt: string; videoPrompt: string }>) =>
    plan && setPlan({ ...plan, scenes: plan.scenes.map((s) => (s.sceneId === sceneId ? { ...s, shots: s.shots.map((x) => (x.shotId === shotId ? { ...x, ...patch } : x)) } : s)) });
  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setter(n);
  };

  const apply = () => {
    if (!plan) return;
    const chars = plan.characters.filter((c) => !skipChars.has(c.name)).map((c) => ({ name: c.name, infoText: infoOverrides[c.name] ?? buildInfoText(c.name, plan) }));
    const imagesLocked = project.imagePrompts.locked;
    const videosLocked = project.videoPrompts.locked;
    const replaceImages = project.imagePrompts.rawText.trim().length > 0;
    const replaceVideos = project.videoPrompts.rawText.trim().length > 0;
    if ((replaceImages && !imagesLocked) || (replaceVideos && !videosLocked)) {
      if (!window.confirm('Your Image/Video Prompts sections already contain text. Replace it with the prompts from this draft?')) return;
    }
    const msg = onApply(plan, { characters: chars, includeImagePrompts: !imagesLocked, includeVideoPrompts: !videosLocked, excludedShots: [...skipShots] }, infoOverrides);
    setDone(msg);
    setNotice(null);
  };

  const stats = plan ? planStats(plan) : null;
  const shotCount = plan ? stats!.shots - skipShots.size : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => onNavigate('story')} aria-label="Back to Story Master" className="min-h-[44px] px-3 rounded-xl border border-white/[0.1] bg-[#10131A] text-sm text-white inline-flex items-center gap-2">
          <ArrowLeft className="w-4 h-4 text-[#E5A93C]" /> Story Master
        </button>
        <div className="text-center min-w-0">
          <h1 className="font-display text-base sm:text-xl font-bold text-white truncate">AI Story Analysis</h1>
          <p className="text-[11px] text-slate-400">গল্প → চরিত্র → Scene → Shot → Prompt (খসড়া)</p>
        </div>
        <span className="w-[44px]" />
      </div>

      {notice && (
        <div role={notice.type === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-2.5 text-xs flex gap-2 ${notice.type === 'error' ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-blue-500/35 bg-blue-500/10 text-blue-100'}`}>
          {notice.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          <span className="whitespace-pre-wrap">{notice.text}</span>
        </div>
      )}

      <section className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-3.5 space-y-3">
        <p className="text-xs text-slate-300">
          AI reads the saved Story Master and drafts characters, scenes, shots and prompts. <b>It is only a draft</b>: you edit it, then save it as materials yourself. It never starts image or video generation.
        </p>
        {!storySaved && <p className="text-xs text-amber-300">The Story Master is empty or not saved yet.</p>}
        {!aiReady && <p className="text-xs text-amber-300">{cloudSettings.status === 'connected' ? 'AI is not configured on the server.' : 'Backend not connected: AI analysis is unavailable (no fake result is created).'}</p>}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="col-span-3 space-y-1">
            <span className="text-slate-400">Visual style</span>
            <input value={style} maxLength={300} onChange={(e) => setStyle(e.target.value)} className="w-full min-h-[40px] rounded-lg bg-[#07080B] border border-white/[0.1] px-2.5 text-white" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Max scenes</span>
            <select value={maxScenes} onChange={(e) => setMaxScenes(Number(e.target.value))} className="w-full min-h-[40px] rounded-lg bg-[#07080B] border border-white/[0.1] px-2 text-white">
              {[2, 4, 6, 8, 10, 12].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Shots / scene</span>
            <select value={shotsPerScene} onChange={(e) => setShotsPerScene(Number(e.target.value))} className="w-full min-h-[40px] rounded-lg bg-[#07080B] border border-white/[0.1] px-2 text-white">
              {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void analyze()} className="self-end min-h-[40px] rounded-lg bg-[#E5A93C] hover:bg-[#F0B84D] disabled:opacity-50 text-[#07080B] font-bold inline-flex items-center justify-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {busy ? 'Working…' : draft ? 'Analyze again' : 'Analyze'}
          </button>
        </div>
        {busy && <p className="text-xs text-blue-200">Waiting for the AI (3 steps: analysis → shots → prompts). This can take up to a minute. No progress is shown until the server answers.</p>}
      </section>

      {plan && stats && (
        <>
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-1.5 text-xs">
            <div className="font-semibold text-amber-200">DRAFT — not saved as project materials</div>
            <p className="text-slate-300">
              “{plan.title}” · {stats.characters} character(s) · {stats.scenes} scene(s) · {stats.shots} shot(s). {plan.summary}
            </p>
            {storyChanged && <p className="text-amber-300">The Story Master changed after this analysis was made.</p>}
            {draft && (draft.meta.warnings.length > 0 || draft.meta.repairs.length > 0) && (
              <details className="text-slate-400">
                <summary className="cursor-pointer text-slate-300">
                  AI checks: {draft.meta.repairs.length} repaired answer(s), {draft.meta.warnings.length} note(s), {draft.meta.providerCalls} AI call(s)
                </summary>
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  {draft.meta.repairs.map((r, i) => (
                    <li key={`r${i}`}>
                      Repaired “{r.stage}”: {r.problems[0]}
                    </li>
                  ))}
                  {draft.meta.warnings.map((w, i) => (
                    <li key={`w${i}`}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section className="space-y-2.5" aria-label="Characters">
            <h2 className="font-display text-sm font-bold text-white">Characters ({plan.characters.length})</h2>
            {plan.characters.map((c) => (
              <div key={c.name} className="rounded-xl border border-white/[0.08] bg-[#10131A] p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-white">
                  <input type="checkbox" checked={!skipChars.has(c.name)} onChange={() => toggle(skipChars, c.name, setSkipChars)} aria-label={`Include ${c.name}`} /> {c.name}
                  <span className="text-[11px] font-normal text-slate-400">{c.role}</span>
                </label>
                <textarea
                  rows={6}
                  aria-label={`Character information of ${c.name}`}
                  value={infoOverrides[c.name] ?? buildInfoText(c.name, plan)}
                  onChange={(e) => setInfoOverrides((o) => ({ ...o, [c.name]: e.target.value }))}
                  className={ta}
                />
              </div>
            ))}
            <p className="text-[11px] text-slate-500">Prompts below already contain each character’s fixed description. If you change a character, change the prompts too.</p>
          </section>

          <section className="space-y-2.5" aria-label="Scenes and shots">
            <h2 className="font-display text-sm font-bold text-white">Scenes &amp; shots ({shotCount} selected)</h2>
            {plan.scenes.map((s) => (
              <div key={s.sceneId} className="rounded-xl border border-white/[0.08] bg-[#10131A]">
                <button type="button" onClick={() => setOpenScene(openScene === s.sceneId ? null : s.sceneId)} aria-expanded={openScene === s.sceneId} className="w-full text-left p-3 min-h-[48px]">
                  <span className="font-mono text-[#E5A93C] text-sm font-bold">{s.sceneId}</span>
                  <span className="ml-2 text-sm text-white">{s.title}</span>
                  <span className="block text-[11px] text-slate-400">
                    {s.location} · {s.timeOfDay} · {s.mood} · {s.characters.join(', ') || 'no named character'} · {s.shots.length} shot(s)
                  </span>
                </button>
                {openScene === s.sceneId && (
                  <div className="px-3 pb-3 space-y-3">
                    <p className="text-xs text-slate-300">{s.summary}</p>
                    {s.shots.map((sh) => {
                      const key = `${s.sceneId}-${sh.shotId}`;
                      return (
                        <div key={key} className="rounded-lg border border-white/[0.06] bg-[#07080B] p-2.5 space-y-1.5" data-testid={`plan-shot-${key}`}>
                          <label className="flex items-center gap-2 text-xs font-semibold text-white">
                            <input type="checkbox" checked={!skipShots.has(key)} onChange={() => toggle(skipShots, key, setSkipShots)} aria-label={`Include shot ${key}`} />
                            <span className="font-mono text-[#E5A93C]">
                              {s.sceneId} · {sh.shotId}
                            </span>
                            <span className="font-normal text-slate-400">{sh.camera} · {sh.characters.join(', ') || '—'}</span>
                          </label>
                          <p className="text-[11px] text-slate-400">{sh.description}</p>
                          <label className="block text-[11px] text-slate-400">
                            Image prompt
                            <textarea rows={4} value={sh.imagePrompt} onChange={(e) => setShot(s.sceneId, sh.shotId, { imagePrompt: e.target.value })} onBlur={() => plan && commit(plan)} aria-label={`Image prompt ${key}`} className={ta} />
                          </label>
                          <label className="block text-[11px] text-slate-400">
                            Video prompt
                            <textarea rows={3} value={sh.videoPrompt} onChange={(e) => setShot(s.sceneId, sh.shotId, { videoPrompt: e.target.value })} onBlur={() => plan && commit(plan)} aria-label={`Video prompt ${key}`} className={ta} />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </section>

          {done ? (
            <section role="status" className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 space-y-2.5 text-xs text-emerald-100">
              <p className="whitespace-pre-wrap">{done}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onNavigate('character_refs')} className="min-h-[42px] rounded-lg border border-emerald-400/40 font-semibold">
                  Character Reference Images
                </button>
                <button type="button" onClick={() => onNavigate('image_prompts')} className="min-h-[42px] rounded-lg border border-emerald-400/40 font-semibold">
                  Image Prompts
                </button>
              </div>
            </section>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" onClick={apply} className="min-h-[48px] rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-sm font-bold inline-flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> Save as Project Materials
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Discard this draft?')) {
                    onDiscardDraft();
                    setPlan(null);
                  }
                }}
                className="min-h-[48px] rounded-xl border border-white/[0.14] bg-[#10131A] text-sm font-semibold text-slate-200 inline-flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Discard draft
              </button>
            </div>
          )}
          <p className="text-[11px] text-slate-500">Saving adds the characters (unlocked, without images yet) and replaces the Image / Video Prompts text with the selected shots. Story, settings and locks are not changed. Generation is started only by you.</p>
        </>
      )}
    </div>
  );
}
