import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Lock, Unlock, X } from 'lucide-react';
import { confirmLeave } from './SectionControls';
import {
  AspectRatio,
  GenerateTargetType,
  PlatformChoice,
  ProductionSettings,
  SupportedResolution,
} from '../types/studio';
import {
  getActiveModelProfile,
  MODEL_CAPABILITY_PROFILES,
} from '../services/studioBackend';

interface ProductionSettingsModalProps {
  open: boolean;
  settings: ProductionSettings;
  onSave: (next: ProductionSettings) => void;
  onToggleLock: (nextLocked: boolean) => void;
  onClose: () => void;
  /** 'page' renders it as the Production Settings section screen (Back → Project Materials). */
  variant?: 'modal' | 'page';
}

function settingsEqual(a: ProductionSettings, b: ProductionSettings): boolean {
  return (
    a.generateType === b.generateType &&
    a.platform === b.platform &&
    a.customPlatformLabel === b.customPlatformLabel &&
    a.aspectRatio === b.aspectRatio &&
    a.resolution === b.resolution &&
    a.imageQuantity === b.imageQuantity &&
    a.videoQuantity === b.videoQuantity &&
    a.generationOrder === b.generationOrder &&
    a.videoDurationSec === b.videoDurationSec &&
    a.modelProfileId === b.modelProfileId
  );
}

export function ProductionSettingsModal({
  open,
  settings,
  onSave,
  onToggleLock,
  onClose,
  variant = 'modal',
}: ProductionSettingsModalProps) {
  const [draft, setDraft] = useState<ProductionSettings>(settings);
  const [notice, setNotice] = useState<{
    type: 'info' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setNotice(null);
    }
  }, [open, settings]);

  if (!open) return null;

  const isLocked = settings.locked;
  const isDirty = !settingsEqual(draft, settings);
  const isSavedClean = Boolean(settings.savedAt) && !isDirty;
  const modelProfile = getActiveModelProfile(draft);

  const handleModelChange = (modelId: string) => {
    const profile =
      MODEL_CAPABILITY_PROFILES.find((m) => m.id === modelId) ??
      MODEL_CAPABILITY_PROFILES[0];
    const nextRes = profile.supportedResolutions.includes(draft.resolution)
      ? draft.resolution
      : profile.supportedResolutions[0];
    const nextDur = profile.supportedDurationsSec.includes(
      draft.videoDurationSec
    )
      ? draft.videoDurationSec
      : profile.supportedDurationsSec[0];
    const nextOrd = Math.min(
      draft.generationOrder,
      profile.maxGenerationOrder
    ) as 1 | 2 | 3 | 4;

    setDraft({
      ...draft,
      modelProfileId: profile.id,
      resolution: nextRes,
      videoDurationSec: nextDur,
      generationOrder: nextOrd,
    });
  };

  const handleBack = () => {
    if (confirmLeave(isDirty && !isLocked)) onClose();
  };

  const handleSaveClick = () => {
    if (isLocked) return;
    onSave(draft);
    setNotice({
      type: 'info',
      text: 'Settings saved. Remains UNLOCKED until you manually press Lock.',
    });
  };

  const handleLockClick = () => {
    if (isLocked) {
      onToggleLock(false);
      setNotice({
        type: 'info',
        text: 'Production Settings unlocked.',
      });
      return;
    }
    if (!isSavedClean) {
      setNotice({
        type: 'error',
        text: 'Please press Save first before locking. / লক করার আগে সেভ করুন।',
      });
      return;
    }
    onToggleLock(true);
    setNotice({
      type: 'info',
      text: 'Production Settings manually locked.',
    });
  };

  const isPage = variant === 'page';
  const body = (
      <div
        className={
          isPage
            ? 'w-full max-w-xl mx-auto rounded-2xl border border-white/[0.1] bg-[#10131A] p-4 sm:p-6 space-y-5'
            : 'w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 sm:p-6 max-h-[90vh] overflow-y-auto space-y-5'
        }
        onClick={(e) => e.stopPropagation()}
        aria-label={isPage ? 'Production Settings' : undefined}
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              Production Settings · প্রোডাকশন সেটিংস
            </h2>
            <p className="text-xs text-slate-400">
              {isLocked ? (
                <span className="text-emerald-400 font-semibold">
                  Locked · লক করা
                </span>
              ) : isSavedClean ? (
                <span className="text-blue-400 font-semibold">
                  Saved · সেভ হয়েছে (Unlocked)
                </span>
              ) : (
                <span className="text-amber-300 font-semibold">
                  Unsaved · আনলকড
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white"
            aria-label={isPage ? 'Back to Project Materials' : 'Close settings'}
          >
            {isPage ? <ArrowLeft className="w-5 h-5" /> : <X className="w-5 h-5" />}
          </button>
        </div>

        {notice && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs flex items-center gap-2 ${
              notice.type === 'error'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : 'border-blue-500/35 bg-blue-500/10 text-blue-100'
            }`}
          >
            {notice.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        )}

        {/* What do you want to generate? */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-300">
            What do you want to generate?
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'image', label: 'Image' },
                { id: 'video', label: 'Video' },
                { id: 'image_and_video', label: 'Image + Video' },
              ] as Array<{ id: GenerateTargetType; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isLocked}
                onClick={() => setDraft({ ...draft, generateType: opt.id })}
                className={`min-h-[44px] rounded-xl border text-xs font-semibold disabled:opacity-50 ${
                  draft.generateType === opt.id
                    ? 'bg-[#E5A93C] text-[#07080B] border-[#E5A93C]'
                    : 'bg-[#07080B] text-slate-300 border-white/[0.1]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Platform & Aspect Ratio */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Platform
            </label>
            <select
              disabled={isLocked}
              value={draft.platform}
              onChange={(e) => {
                const plat = e.target.value as PlatformChoice;
                const autoRatio: AspectRatio =
                  plat === 'youtube_movie'
                    ? '16:9'
                    : plat === 'youtube_shorts' ||
                        plat === 'tiktok' ||
                        plat === 'instagram_reels'
                      ? '9:16'
                      : draft.aspectRatio;
                setDraft({ ...draft, platform: plat, aspectRatio: autoRatio });
              }}
              className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white disabled:opacity-55"
            >
              <option value="youtube_movie">YouTube Movie</option>
              <option value="youtube_shorts">YouTube Shorts</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram_reels">Instagram Reels</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Aspect Ratio
            </label>
            <select
              disabled={isLocked}
              value={draft.aspectRatio}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  aspectRatio: e.target.value as AspectRatio,
                })
              }
              className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white font-mono disabled:opacity-55"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>
        </div>

        {draft.platform === 'custom' && (
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Custom Platform Label
            </label>
            <input
              type="text"
              disabled={isLocked}
              value={draft.customPlatformLabel}
              onChange={(e) =>
                setDraft({ ...draft, customPlatformLabel: e.target.value })
              }
              placeholder="e.g. Cinema DCP, Vimeo 4K, Festival Cut"
              className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white disabled:opacity-55"
            />
          </div>
        )}

        {/* Connected Model & Resolution */}
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Connected AI Model Profile
              </label>
              <select
                disabled={isLocked}
                value={draft.modelProfileId}
                onChange={(e) => handleModelChange(e.target.value)}
                className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-xs text-white disabled:opacity-55"
              >
                {MODEL_CAPABILITY_PROFILES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Resolution (Model Supported)
              </label>
              <select
                disabled={isLocked}
                value={draft.resolution}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    resolution: e.target.value as SupportedResolution,
                  })
                }
                className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white font-mono disabled:opacity-55"
              >
                {modelProfile.supportedResolutions.map((res) => (
                  <option key={res} value={res}>
                    {res}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            {modelProfile.providerNote}
          </p>
        </div>

        {/* Image Quantity, Video Quantity, Video Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            className={
              draft.generateType === 'video' ? 'opacity-45' : undefined
            }
          >
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Image Quantity{' '}
              {draft.generateType === 'video' && (
                <span className="text-[10px] text-slate-400">(N/A)</span>
              )}
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {([1, 2, 3, 4] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isLocked || draft.generateType === 'video'}
                  onClick={() => setDraft({ ...draft, imageQuantity: q })}
                  className={`min-h-[40px] rounded-lg border font-mono text-xs font-semibold disabled:opacity-50 ${
                    draft.imageQuantity === q
                      ? 'bg-[#E5A93C] text-[#07080B] border-[#E5A93C]'
                      : 'bg-[#07080B] text-slate-300 border-white/[0.1]'
                  }`}
                >
                  x{q}
                </button>
              ))}
            </div>
          </div>

          <div
            className={
              draft.generateType === 'image' ? 'opacity-45' : undefined
            }
          >
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Video Quantity{' '}
              {draft.generateType === 'image' && (
                <span className="text-[10px] text-slate-400">(N/A)</span>
              )}
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {([1, 2, 3, 4] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isLocked || draft.generateType === 'image'}
                  onClick={() => setDraft({ ...draft, videoQuantity: q })}
                  className={`min-h-[40px] rounded-lg border font-mono text-xs font-semibold disabled:opacity-50 ${
                    draft.videoQuantity === q
                      ? 'bg-[#E5A93C] text-[#07080B] border-[#E5A93C]'
                      : 'bg-[#07080B] text-slate-300 border-white/[0.1]'
                  }`}
                >
                  x{q}
                </button>
              ))}
            </div>
          </div>

          <div
            className={
              draft.generateType === 'image' ? 'opacity-45' : undefined
            }
          >
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Video Duration{' '}
              {draft.generateType === 'image' && (
                <span className="text-[10px] text-slate-400">(N/A)</span>
              )}
            </label>
            <select
              disabled={isLocked || draft.generateType === 'image'}
              value={draft.videoDurationSec}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  videoDurationSec: Number(e.target.value),
                })
              }
              className="w-full min-h-[40px] rounded-lg bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white font-mono disabled:opacity-55"
            >
              {modelProfile.supportedDurationsSec.map((sec) => (
                <option key={sec} value={sec}>
                  {sec} seconds
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Generation Order */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-300">
            Generation Order (up to {modelProfile.maxGenerationOrder} supported)
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([1, 2, 3, 4] as const).map((ord) => {
              const supported = ord <= modelProfile.maxGenerationOrder;
              return (
                <button
                  key={ord}
                  type="button"
                  disabled={isLocked || !supported}
                  onClick={() => setDraft({ ...draft, generationOrder: ord })}
                  className={`min-h-[40px] px-2.5 rounded-xl border text-xs font-medium ${
                    draft.generationOrder === ord
                      ? 'bg-[#E5A93C]/20 text-[#FDE68A] border-[#E5A93C]'
                      : 'bg-[#07080B] text-slate-300 border-white/[0.1]'
                  } disabled:opacity-35`}
                >
                  {ord === 1
                    ? 'One at a time'
                    : ord === 2
                      ? 'Two at a time'
                      : ord === 3
                        ? 'Three at a time'
                        : 'Four at a time'}
                </button>
              );
            })}
          </div>
        </div>

        {(draft.aspectRatio === '1:1' || draft.aspectRatio === '4:3' || draft.aspectRatio === '3:4') &&
          draft.generateType !== 'image' && (
            <p className="text-[11px] text-amber-300">
              Note: Veo video supports only 16:9 and 9:16. With {draft.aspectRatio} the image is made in {draft.aspectRatio} and the video model chooses its default ratio.
            </p>
          )}

        {/* Universal Controls: Save (blue when saved) · Lock/Unlock · Back */}
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.08]">
          <button
            type="button"
            disabled={isLocked}
            onClick={handleSaveClick}
            data-saved={isSavedClean ? 'true' : 'false'}
            className={`min-h-[46px] rounded-xl border text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-55 transition-colors ${
              isSavedClean
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-[#E5A93C] hover:bg-[#F0B84D] border-[#E5A93C] text-[#07080B]'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>{isSavedClean ? 'Saved · সেভ' : 'Save · সেভ'}</span>
          </button>

          <button
            type="button"
            onClick={handleLockClick}
            data-locked={isLocked ? 'true' : 'false'}
            className={`min-h-[46px] rounded-xl border text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              isLocked
                ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-300'
                : 'bg-[#07080B] hover:bg-white/[0.06] border-white/[0.16] text-white'
            }`}
          >
            {isLocked ? (
              <>
                <Unlock className="w-4 h-4" />
                <span>Unlock</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-[#E5A93C]" />
                <span>Lock</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleBack}
            className="min-h-[46px] rounded-xl border border-white/[0.14] bg-[#07080B] hover:bg-white/[0.06] text-xs sm:text-sm font-semibold text-slate-200 inline-flex items-center justify-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        </div>
      </div>
  );

  if (isPage) return <div className="px-3 sm:px-5 py-4">{body}</div>;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Production Settings"
      onClick={handleBack}
    >
      {body}
    </div>
  );
}