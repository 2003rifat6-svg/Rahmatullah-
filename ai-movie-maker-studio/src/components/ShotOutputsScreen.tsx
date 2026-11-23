import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Film, Loader2, Sparkles, Square, Trash2, Upload } from 'lucide-react';
import { CloudBackendSettings, MovieProject, OutputSectionState, ParsedPromptEntry } from '../types/studio';
import { auditProjectMaterials, selectedCandidate, shotKey } from '../utils/validation';
import { readAndOptimizeImageFile, triggerDownload } from '../utils/storage';
import { estimateStorage, formatBytes, StorageEstimate } from '../utils/mediaStore';
import { exportImagesOnlyZip, exportVideosOnlyZip, sanitizeFolderName } from '../utils/zipManager';
import { phase2CloudServices, resolveBackendUrl } from '../services/cloudApiInterfaces';
import { SafeImage } from './SafeImage';
import { SectionControls, SectionNotice, SectionStatus, SectionTopBar } from './SectionControls';

export interface GenerationRunState {
  kind: 'image' | 'video';
  total: number;
  done: number;
  failed: number;
  cancelRequested: boolean;
}

interface Props {
  kind: 'image' | 'video';
  project: MovieProject;
  cloudSettings: CloudBackendSettings;
  run: GenerationRunState | null;
  onGenerate: (keys: string[]) => void;
  onCancelRun: () => void;
  onUpload: (key: string, url: string, filename: string) => void;
  onSelectCandidate: (key: string, candidateId: string) => void;
  onRemoveCandidate: (key: string, candidateId: string) => void;
  /** Cancels the running backend video job of a shot. */
  onCancelJob: (key: string) => void;
  /** Video screen: asks the server for finished videos this project does not have yet. */
  onRecoverJobs: () => Promise<string>;
  onSave: () => void;
  onToggleLock: (next: boolean) => void;
  onBack: () => void;
  onOpenSection: (screen: 'generated_images' | 'image_prompts' | 'video_prompts' | 'materials_hub' | 'cloud_settings') => void;
}

function extFromUrl(url: string, fallback: string) {
  const m = /^data:([^;]+);/.exec(url);
  if (m) return m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : m[1].includes('mp4') ? 'mp4' : 'jpg';
  const p = /\.([a-z0-9]{3,4})(?:\?|$)/i.exec(url);
  return p ? p[1].toLowerCase() : fallback;
}

export function currentSelection(items: ParsedPromptEntry[]): Record<string, string> {
  const sel: Record<string, string> = {};
  for (const i of items) {
    const c = selectedCandidate(i);
    if (c) sel[shotKey(i)] = c.id;
  }
  return sel;
}

function sameSelection(a: Record<string, string> | undefined, b: Record<string, string>) {
  if (!a) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

export function ShotOutputsScreen({
  kind,
  project,
  cloudSettings,
  run,
  onGenerate,
  onCancelRun,
  onUpload,
  onSelectCandidate,
  onRemoveCandidate,
  onCancelJob,
  onRecoverJobs,
  onSave,
  onToggleLock,
  onBack,
  onOpenSection,
}: Props) {
  const isImage = kind === 'image';
  const items = isImage ? project.imagePrompts.parsedItems : project.videoPrompts.parsedItems;
  const section: OutputSectionState = isImage ? project.generatedImagesSection : project.generatedVideosSection;
  const imageByKey = new Map(project.imagePrompts.parsedItems.map((i) => [shotKey(i), i]));
  const audit = auditProjectMaterials(project);
  const [notice, setNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [confirmKeys, setConfirmKeys] = useState<string[] | null>(null);
  const [busyExport, setBusyExport] = useState<'zip_images' | 'zip_videos' | 'mp4' | null>(null);
  const [mp4Url, setMp4Url] = useState<string | null>(null);
  const [openVersions, setOpenVersions] = useState<Record<string, boolean>>({});
  const [previewIds, setPreviewIds] = useState<Record<string, string | null>>({});
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const totalVersions = items.reduce((n, i) => n + (i.candidates?.length ?? 0), 0);

  // Browser storage level: versions are never deleted automatically, so the user is told when space runs low.
  useEffect(() => {
    let alive = true;
    void estimateStorage().then((e) => alive && setStorage(e));
    return () => {
      alive = false;
    };
  }, [totalVersions]);

  const selection = currentSelection(items);
  const savedClean = Boolean(section.savedAt) && sameSelection(section.savedSelection, selection);
  const withOutput = items.filter((i) => i.generatedUrl);
  const status: SectionStatus = section.locked
    ? 'locked'
    : savedClean
      ? 'saved'
      : withOutput.length
        ? 'unsaved'
        : 'empty';

  const running = run !== null && run.kind === kind;
  const otherRunning = run !== null && run.kind !== kind;
  const connected = cloudSettings.status === 'connected' && cloudSettings.geminiConfigured !== false;
  const stepErrors = isImage ? audit.imageStepErrors : audit.errors;
  const blocked = stepErrors.length > 0;
  const qty = isImage ? project.productionSettings.imageQuantity : project.productionSettings.videoQuantity;
  const slug = sanitizeFolderName(project.title);
  const canEdit = !section.locked && !running;

  const failedKeys = items
    .filter((i) => i.status === 'failed' && (isImage || imageByKey.get(i.linkedImageKey || shotKey(i))?.generatedUrl))
    .map(shotKey);

  const missingKeys = items
    .filter((i) => !i.generatedUrl && (isImage || imageByKey.get(i.linkedImageKey || shotKey(i))?.generatedUrl))
    .map(shotKey);

  const askGenerate = (keys: string[]) => {
    if (!keys.length) return;
    if (!connected) {
      setNotice({
        type: 'error',
        text:
          cloudSettings.status === 'connected'
            ? 'Backend is connected but GEMINI_API_KEY is not set on the server. AI generation is disabled.'
            : 'Backend is not connected. Open Cloud Settings → Test Backend Connection. (No fake output is created.)',
      });
      return;
    }
    if (blocked) {
      setNotice({ type: 'error', text: `Fix these first:\n• ${stepErrors.join('\n• ')}` });
      return;
    }
    setConfirmKeys(keys);
  };

  const handleUpload = async (key: string, file: File) => {
    if (isImage) {
      const url = await readAndOptimizeImageFile(file, 1920);
      onUpload(key, url, file.name);
    } else {
      if (file.size > 30 * 1024 * 1024) {
        setNotice({ type: 'error', text: 'Video file is larger than 30 MB (the upload limit for cloud sync).' });
        return;
      }
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error('read failed'));
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(file);
      });
      onUpload(key, url, file.name);
    }
    setNotice({ type: 'info', text: `${key}: your file was added (marked “Uploaded”, not AI). Press Save to confirm the selection.` });
  };

  const downloadOne = async (item: ParsedPromptEntry) => {
    if (!item.generatedUrl) return;
    const url = resolveBackendUrl(cloudSettings, item.generatedUrl);
    try {
      const blob = await (await fetch(url)).blob();
      triggerDownload(blob, `${slug}_${item.sceneId}_${item.shotId}.${extFromUrl(url, isImage ? 'jpg' : 'mp4')}`);
    } catch {
      setNotice({ type: 'error', text: `Could not download ${shotKey(item)} (file not reachable).` });
    }
  };

  const handleZip = async (which: 'images' | 'videos') => {
    setBusyExport(which === 'images' ? 'zip_images' : 'zip_videos');
    try {
      const { blob, count, failed } =
        which === 'images' ? await exportImagesOnlyZip(project, cloudSettings) : await exportVideosOnlyZip(project, cloudSettings);
      if (count === 0) {
        setNotice({ type: 'error', text: `No ${which} could be added to the ZIP.` });
        return;
      }
      triggerDownload(blob, `${slug}_${which === 'images' ? 'Images' : 'Videos'}.zip`);
      setNotice({
        type: failed.length ? 'error' : 'info',
        text: `ZIP downloaded with ${count} file(s).${failed.length ? ` Not reachable: ${failed.join(', ')}` : ''}`,
      });
    } finally {
      setBusyExport(null);
    }
  };

  const handleMp4 = async () => {
    const ordered = project.videoPrompts.parsedItems.filter((v) => v.generatedUrl);
    if (ordered.length < project.videoPrompts.parsedItems.length) {
      if (!window.confirm(`Only ${ordered.length} of ${project.videoPrompts.parsedItems.length} shots have a video. Assemble only those, in Scene/Shot order?`)) return;
    }
    setBusyExport('mp4');
    setMp4Url(null);
    try {
      const res = await phase2CloudServices.ffmpeg.requestCompleteMovieMp4(cloudSettings, project, {
        aspectRatio: project.productionSettings.aspectRatio,
        resolution: project.productionSettings.resolution,
        clips: ordered.map((v) => ({ sceneId: v.sceneId, shotId: v.shotId, videoUrl: v.generatedUrl! })),
      });
      if (!res.ok || !res.data?.downloadUrl) {
        setNotice({ type: 'error', text: `Movie assembly failed: ${res.error || 'no download URL returned'}` });
        return;
      }
      setMp4Url(resolveBackendUrl(cloudSettings, res.data.downloadUrl));
      setNotice({ type: 'info', text: `FFmpeg assembled ${ordered.length} clip(s) into one MP4 on the server.` });
    } finally {
      setBusyExport(null);
    }
  };

  const handleSave = () => {
    if (section.locked) return;
    onSave();
    setNotice({ type: 'info', text: `Selection saved (${withOutput.length} shot(s) with ${isImage ? 'an image' : 'a video'}). Still unlocked.` });
  };

  const handleLock = () => {
    if (section.locked) {
      onToggleLock(false);
      setNotice({ type: 'info', text: 'Unlocked. Generate / Upload / Select are enabled again.' });
      return;
    }
    if (!savedClean) {
      setNotice({ type: 'error', text: 'Please press Save first before locking. / লক করার আগে সেভ করুন।' });
      return;
    }
    onToggleLock(true);
    setNotice({ type: 'info', text: 'Locked — outputs are protected from regeneration and changes.' });
  };

  const handleBack = () => {
    // Running generation continues in the background; leaving never sends anything to chat.
    onBack();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <SectionTopBar
        title={isImage ? 'Generated Images' : 'Generated Videos & Export'}
        subtitle={isImage ? 'Step 1 · ছবি তৈরি' : 'Step 2 · ছবি থেকে ভিডিও · ZIP · MP4'}
        status={status}
        onBack={handleBack}
      />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />

      {!connected && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4" />
            {cloudSettings.status === 'connected' ? 'AI provider not configured on server' : 'Backend not connected'}
          </div>
          <p>
            AI generation runs only on the backend (server/), which keeps the Gemini API key. Until it is connected, you can
            still <b>upload</b> your own {isImage ? 'images' : 'video clips'} for each shot. No fake generation or progress is shown.
          </p>
          <button type="button" onClick={() => onOpenSection('cloud_settings')} className="underline font-semibold">
            Open Cloud Settings
          </button>
        </div>
      )}

      {storage && storage.ratio >= 0.8 && (
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
          Browser storage is {Math.round(storage.ratio * 100)}% full ({formatBytes(storage.usage)} of {formatBytes(storage.quota)}).
          {storage.ratio >= 0.95 ? ' New outputs may fail to save.' : ''} All versions are kept — nothing is deleted automatically.
          Free space by removing versions you no longer need, using Cloud ☁ → “Clean unused local files”, or saving the project to the cloud / a ZIP.
        </div>
      )}

      {blocked && (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-100 space-y-1">
          <div className="font-semibold">AI generation is blocked until these are fixed:</div>
          <ul className="list-disc pl-5 space-y-0.5 max-h-36 overflow-y-auto">
            {stepErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {running && run && (
        <div className="rounded-xl border border-blue-500/35 bg-blue-500/10 p-3 text-xs text-blue-100 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 tabular-nums">
            <Loader2 className="w-4 h-4 animate-spin" />
            {run.done + run.failed} / {run.total} shot(s) finished ({run.failed} failed)
            {run.cancelRequested ? ' · stopping after current requests…' : ''}
          </span>
          <button
            type="button"
            disabled={run.cancelRequested}
            onClick={onCancelRun}
            className="min-h-[36px] px-3 rounded-lg border border-white/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Square className="w-3 h-3" /> Stop
          </button>
        </div>
      )}
      {otherRunning && (
        <p className="text-xs text-slate-400">{run?.kind === 'image' ? 'Image' : 'Video'} generation is running — wait for it to finish.</p>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.14] bg-[#10131A] p-6 text-center text-sm text-slate-300 space-y-3">
          <p>No {isImage ? 'Image' : 'Video'} Prompts saved yet.</p>
          <button
            type="button"
            onClick={() => onOpenSection(isImage ? 'image_prompts' : 'video_prompts')}
            className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#07080B] font-bold"
          >
            Open {isImage ? 'Image' : 'Video'} Prompts
          </button>
        </div>
      ) : (
        <>
          {failedKeys.length > 0 && (
            <button
              type="button"
              disabled={!canEdit || otherRunning}
              onClick={() => askGenerate(failedKeys)}
              data-testid="retry-failed"
              className="w-full min-h-[44px] rounded-xl border border-rose-400/40 bg-rose-500/10 text-rose-200 text-sm font-semibold disabled:opacity-40"
            >
              Retry failed ({failedKeys.length})
            </button>
          )}
          {!isImage && connected && (
            <button
              type="button"
              disabled={running}
              onClick={async () => setNotice({ type: 'info', text: await onRecoverJobs() })}
              className="w-full min-h-[40px] rounded-xl border border-white/[0.12] bg-[#10131A] text-xs font-semibold text-slate-200 disabled:opacity-40"
            >
              Check the server for finished videos
            </button>
          )}
          <div className={`grid ${isImage ? 'grid-cols-2' : 'grid-cols-1'} gap-2.5`}>
            <button
              type="button"
              disabled={!canEdit || otherRunning || missingKeys.length === 0}
              onClick={() => askGenerate(missingKeys)}
              className="min-h-[46px] rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] disabled:opacity-40 text-[#07080B] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-4 h-4" /> Generate missing ({missingKeys.length})
            </button>
            {isImage && (
            <button
              type="button"
              disabled={busyExport !== null || withOutput.length === 0}
              onClick={() => void handleZip('images')}
              className="min-h-[46px] rounded-xl border border-white/[0.14] bg-white/[0.05] disabled:opacity-40 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4 text-[#E5A93C]" />
              {busyExport === 'zip_images' ? 'Creating ZIP…' : `Images ZIP (${withOutput.length})`}
            </button>
            )}
          </div>

          <div className="space-y-3">
            {items.map((item) => {
              const key = shotKey(item);
              const sel = selectedCandidate(item);
              const srcImage = isImage ? undefined : imageByKey.get(item.linkedImageKey || key);
              const stale = sel && sel.fromPrompt !== item.promptText;
              const versions = item.candidates ?? [];
              const previewing = previewIds[key] ? versions.find((c) => c.id === previewIds[key]) : undefined;
              const fileId = `out_${kind}_${item.id}`;
              const noSourceImage = !isImage && !srcImage?.generatedUrl;
              return (
                <section key={item.id} aria-label={`Shot ${key}`} className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-[#E5A93C]">
                      {item.sceneId} · {item.shotId}
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        item.status === 'generating'
                          ? 'text-blue-300'
                          : item.status === 'failed'
                            ? 'text-rose-300'
                            : item.generatedUrl
                              ? 'text-emerald-300'
                              : 'text-slate-400'
                      }`}
                      data-testid={`shot-status-${key}`}
                    >
                      {item.status === 'generating'
                        ? isImage
                          ? 'Generating (waiting for AI)…'
                          : 'Video job running on server…'
                        : item.status === 'failed'
                          ? 'Failed'
                          : item.generatedUrl
                            ? sel?.source === 'uploaded'
                              ? 'Uploaded file'
                              : 'AI generated'
                            : 'No output yet'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-3">{item.promptText}</p>
                  {!isImage && item.status === 'generating' && item.backendJobId && (
                    <button
                      type="button"
                      onClick={() => onCancelJob(key)}
                      className="text-[11px] text-rose-300 underline"
                    >
                      Cancel this video job
                    </button>
                  )}
                  {item.status === 'failed' && item.errorMessage && (
                    <p className="text-[11px] text-rose-300">{item.errorMessage}</p>
                  )}
                  {stale && <p className="text-[11px] text-amber-300">Prompt changed after this output was made — consider regenerating.</p>}
                  {!isImage && (
                    <p className={`text-[11px] ${noSourceImage ? 'text-rose-300' : 'text-slate-400'}`}>
                      Start frame: {srcImage ? shotKey(srcImage) : 'no matching image prompt'}
                      {noSourceImage ? ' — needs an image first (Generated Images).' : ''}
                    </p>
                  )}

                  <div className={`grid ${isImage ? 'grid-cols-1' : 'grid-cols-[88px_1fr]'} gap-2.5`}>
                    {!isImage && (
                      <div className="aspect-video rounded-lg overflow-hidden bg-[#07080B] border border-white/[0.08] self-start">
                        <SafeImage src={srcImage?.generatedUrl} alt={`Start frame ${key}`} fallbackLabel="No image" />
                      </div>
                    )}
                    <div className="aspect-video rounded-xl overflow-hidden bg-[#07080B] border border-white/[0.08]">
                      {(previewing?.url ?? item.generatedUrl) ? (
                        isImage ? (
                          <SafeImage src={previewing?.url ?? item.generatedUrl} alt={`Shot ${key}`} className="w-full h-full object-contain" />
                        ) : (
                          <video src={resolveBackendUrl(cloudSettings, (previewing?.url ?? item.generatedUrl)!)} controls playsInline className="w-full h-full object-contain bg-black" />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
                          {isImage ? 'No image yet' : 'No video yet'}
                        </div>
                      )}
                    </div>
                  </div>

                  {previewing && (
                    <p className="text-[11px] text-blue-300">
                      Previewing v{versions.indexOf(previewing) + 1} — not selected.{' '}
                      <button type="button" className="underline" onClick={() => setPreviewIds((p) => ({ ...p, [key]: null }))}>
                        Back to current
                      </button>
                    </p>
                  )}

                  {versions.length > 0 && (
                    <div>
                      <button
                        type="button"
                        aria-expanded={Boolean(openVersions[key])}
                        onClick={() => setOpenVersions((o) => ({ ...o, [key]: !o[key] }))}
                        data-testid={`versions-toggle-${key}`}
                        className="text-xs font-semibold text-[#E5A93C] underline"
                      >
                        {openVersions[key] ? 'Hide' : 'Show'} versions ({versions.length})
                      </button>
                      {openVersions[key] && (
                        <ul aria-label={`Versions of ${key}`} className="mt-2 space-y-2 max-h-72 overflow-y-auto">
                          {[...versions].map((c, ci) => ({ c, n: ci + 1 })).reverse().map(({ c, n }) => {
                            const isCurrent = c.id === sel?.id;
                            return (
                              <li
                                key={c.id}
                                data-testid={`version-${key}-${n}`}
                                className={`rounded-lg border p-2 flex items-center gap-2.5 ${isCurrent ? 'border-[#E5A93C]/60 bg-[#E5A93C]/5' : 'border-white/[0.08] bg-[#07080B]'}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => setPreviewIds((p) => ({ ...p, [key]: c.id === sel?.id ? null : c.id }))}
                                  aria-label={`Preview version ${n} of ${key}`}
                                  className="w-16 shrink-0 aspect-video rounded overflow-hidden border border-white/[0.1] bg-black"
                                >
                                  {isImage ? (
                                    <SafeImage src={c.url} alt={`Version ${n}`} />
                                  ) : (
                                    <video src={resolveBackendUrl(cloudSettings, c.url)} muted preload="metadata" playsInline className="w-full h-full object-cover pointer-events-none" />
                                  )}
                                </button>
                                <div className="min-w-0 flex-1 text-[11px]">
                                  <div className="font-semibold text-white">
                                    v{n}
                                    {isCurrent && <span className="ml-1.5 text-[#E5A93C]">· current</span>}
                                    {c.fromPrompt !== item.promptText && <span className="ml-1.5 text-amber-300">· older prompt</span>}
                                  </div>
                                  <div className="text-slate-400 truncate">
                                    {new Date(c.createdAt).toLocaleString()} · {c.source === 'cloud_generated' ? 'AI generated' : c.source === 'uploaded' ? 'Uploaded' : 'Sample'}
                                  </div>
                                </div>
                                <div className="flex flex-col gap-1 shrink-0">
                                  <button
                                    type="button"
                                    disabled={!canEdit || isCurrent}
                                    onClick={() => {
                                      onSelectCandidate(key, c.id);
                                      setPreviewIds((p) => ({ ...p, [key]: null }));
                                    }}
                                    className="min-h-[30px] px-2 rounded border border-[#E5A93C]/40 text-[10px] font-semibold text-[#FDE68A] disabled:opacity-40"
                                  >
                                    Use this
                                  </button>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      aria-label={`Download version ${n} of ${key}`}
                                      onClick={async () => {
                                        try {
                                          const url = resolveBackendUrl(cloudSettings, c.url);
                                          const blob = await (await fetch(url)).blob();
                                          triggerDownload(blob, `${slug}_${item.sceneId}_${item.shotId}_v${n}.${extFromUrl(url, isImage ? 'jpg' : 'mp4')}`);
                                        } catch {
                                          setNotice({ type: 'error', text: `Could not download v${n} of ${key}.` });
                                        }
                                      }}
                                      className="min-h-[30px] flex-1 px-2 rounded border border-white/[0.12] text-slate-200"
                                    >
                                      <Download className="w-3 h-3 mx-auto" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      aria-label={`Remove version ${n} of ${key}`}
                                      onClick={() => {
                                        if (window.confirm(`Remove version v${n} of ${key} from this project? This cannot be undone.`)) {
                                          onRemoveCandidate(key, c.id);
                                          setPreviewIds((p) => ({ ...p, [key]: null }));
                                        }
                                      }}
                                      className="min-h-[30px] flex-1 px-2 rounded border border-rose-500/30 text-rose-300 disabled:opacity-40"
                                    >
                                      <Trash2 className="w-3 h-3 mx-auto" />
                                    </button>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={!canEdit || otherRunning || item.status === 'generating' || noSourceImage}
                      onClick={() => askGenerate([key])}
                      className="min-h-[40px] rounded-lg border border-[#E5A93C]/40 bg-[#E5A93C]/10 text-[#FDE68A] text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-40"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {item.generatedUrl ? 'Regenerate' : 'Generate'}
                    </button>
                    <input
                      id={fileId}
                      type="file"
                      accept={isImage ? 'image/*' : 'video/mp4,video/*'}
                      disabled={!canEdit}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUpload(key, f);
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor={fileId}
                      className={`min-h-[40px] rounded-lg border border-white/[0.12] text-xs font-semibold inline-flex items-center justify-center gap-1 ${
                        canEdit ? 'bg-[#07080B] text-white cursor-pointer' : 'opacity-40 cursor-not-allowed text-slate-500'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5 text-[#E5A93C]" /> Upload
                    </label>
                    <button
                      type="button"
                      disabled={!item.generatedUrl}
                      onClick={() => void downloadOne(item)}
                      className="min-h-[40px] rounded-lg border border-white/[0.12] bg-[#07080B] text-white text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-40"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {!isImage && (
        <section className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-4 space-y-3">
          <h2 className="font-display text-sm font-bold text-white">Export</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              disabled={busyExport !== null || project.imagePrompts.parsedItems.every((i) => !i.generatedUrl)}
              onClick={() => void handleZip('images')}
              className="min-h-[44px] rounded-xl border border-white/[0.14] bg-white/[0.05] disabled:opacity-40 text-white text-xs font-semibold"
            >
              {busyExport === 'zip_images' ? 'Creating…' : 'Images ZIP'}
            </button>
            <button
              type="button"
              disabled={busyExport !== null || withOutput.length === 0}
              onClick={() => void handleZip('videos')}
              className="min-h-[44px] rounded-xl border border-white/[0.14] bg-white/[0.05] disabled:opacity-40 text-white text-xs font-semibold"
            >
              {busyExport === 'zip_videos' ? 'Creating…' : 'Videos ZIP'}
            </button>
            <button
              type="button"
              disabled={busyExport !== null || withOutput.length === 0 || cloudSettings.status !== 'connected' || cloudSettings.ffmpegAvailable === false}
              onClick={() => void handleMp4()}
              className="min-h-[44px] rounded-xl border border-[#E5A93C]/50 bg-[#E5A93C]/10 disabled:opacity-40 text-[#FDE68A] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Film className="w-4 h-4" /> {busyExport === 'mp4' ? 'FFmpeg running…' : 'Assemble Movie (MP4)'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            {cloudSettings.status !== 'connected'
              ? 'Movie assembly needs the backend with FFmpeg (not connected).'
              : cloudSettings.ffmpegAvailable === false
                ? 'FFmpeg is not installed on the connected server, so movie assembly is unavailable.'
                : 'FFmpeg joins the clips on the server in Scene/Shot order. Only clips generated by this server can be assembled (uploaded clips stay in the ZIP only).'}
          </p>
          {mp4Url && (
            <div className="space-y-2">
              <video src={mp4Url} controls playsInline className="w-full rounded-xl bg-black" />
              <a href={mp4Url} download className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#E5A93C] underline">
                <Download className="w-3.5 h-3.5" /> Download movie MP4
              </a>
            </div>
          )}
        </section>
      )}

      <SectionControls
        locked={section.locked}
        savedClean={savedClean}
        onSave={handleSave}
        onToggleLock={handleLock}
        onBack={handleBack}
        saveLabel="Save Selection"
      />

      {confirmKeys && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Confirm paid generation">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-white">Confirm {isImage ? 'image' : 'video'} generation</h2>
            <p className="text-sm text-slate-300">
              This sends <b>{confirmKeys.length * qty}</b> request(s) to the Google {isImage ? 'Gemini image' : 'Veo video'} model
              ({confirmKeys.length} shot(s) × {qty} version(s)). These are <b>paid API calls</b> billed to the server owner’s Google account.
            </p>
            <p className="text-[11px] text-slate-400 font-mono break-words">{confirmKeys.join(', ')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmKeys(null)} className="min-h-[44px] px-4 rounded-xl text-sm text-slate-300">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onGenerate(confirmKeys);
                  setConfirmKeys(null);
                }}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#07080B] text-sm font-bold"
              >
                Yes, generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
