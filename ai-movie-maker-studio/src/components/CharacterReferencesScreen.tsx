import { useState } from 'react';
import { Lock, Sparkles, Unlock, Upload } from 'lucide-react';
import {
  CharacterCard,
  CharacterRefSlot,
  CharacterRefSlotKey,
  CloudBackendSettings,
} from '../types/studio';
import { requestCharacterReferenceImage } from '../services/studioBackend';
import { readAndOptimizeImageFile, urlToDataUrl } from '../utils/storage';
import {
  characterCompleteness,
  characterDisplayName,
  REF_SLOT_KEYS,
  REF_SLOT_LABELS,
} from '../utils/validation';
import { SafeImage } from './SafeImage';
import {
  confirmLeave,
  SectionControls,
  SectionNotice,
  SectionStatus,
  SectionTopBar,
  statusLabel,
  statusTone,
} from './SectionControls';

interface Props {
  characters: CharacterCard[];
  initialCharacterId?: string;
  cloudSettings: CloudBackendSettings;
  onSaveCharacterSlot: (characterId: string, slotKey: CharacterRefSlotKey, slot: CharacterRefSlot) => void;
  onToggleCharacterSlotLock: (characterId: string, slotKey: CharacterRefSlotKey, nextLocked: boolean) => void;
  onToggleCharacterLock: (characterId: string, nextLocked: boolean) => void;
  onOpenCharacterInfo: () => void;
  onBack: () => void;
}

const SLOT_HINT: Record<CharacterRefSlotKey, string> = {
  face: 'মুখের রেফারেন্স — close-up face portrait',
  front: 'সামনের পূর্ণ শরীর — full body, front view',
  side: 'পাশের পূর্ণ শরীর — full body, side view',
  back: 'পিছনের পূর্ণ শরীর — full body, back view',
};

type SlotDraft = Pick<CharacterRefSlot, 'prompt' | 'imageUrl' | 'filename' | 'source' | 'uploadedAt'>;

function sameSlot(a: SlotDraft, b: CharacterRefSlot) {
  return a.prompt === b.prompt && a.imageUrl === b.imageUrl && a.filename === b.filename;
}

/**
 * Section 3 — Character Reference Images.
 * Only characters whose information was saved appear here.
 */
export function CharacterReferencesScreen({
  characters,
  initialCharacterId,
  cloudSettings,
  onSaveCharacterSlot,
  onToggleCharacterSlotLock,
  onToggleCharacterLock,
  onOpenCharacterInfo,
  onBack,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(
    initialCharacterId && characters.some((c) => c.id === initialCharacterId)
      ? initialCharacterId
      : characters[0]?.id ?? ''
  );
  const [drafts, setDrafts] = useState<Record<string, SlotDraft>>({});
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);

  const card = characters.find((c) => c.id === selectedId);
  const keyOf = (cid: string, k: CharacterRefSlotKey) => `${cid}_${k}`;
  const draftOf = (c: CharacterCard, k: CharacterRefSlotKey): SlotDraft => drafts[keyOf(c.id, k)] ?? c.references[k];
  const slotDirty = (c: CharacterCard, k: CharacterRefSlotKey) => !sameSlot(draftOf(c, k), c.references[k]);
  const anyDirty = characters.some((c) => REF_SLOT_KEYS.some((k) => slotDirty(c, k)));

  const patchDraft = (c: CharacterCard, k: CharacterRefSlotKey, patch: Partial<SlotDraft>) =>
    setDrafts((prev) => ({ ...prev, [keyOf(c.id, k)]: { ...draftOf(c, k), ...patch } }));

  const slotStatus = (c: CharacterCard, k: CharacterRefSlotKey): SectionStatus => {
    const slot = c.references[k];
    if (c.locked || slot.locked) return 'locked';
    if (slotDirty(c, k)) return 'unsaved';
    if (slot.savedAt && slot.imageUrl) return 'saved';
    return 'empty';
  };

  const sectionStatus: SectionStatus = (() => {
    if (characters.length === 0) return 'empty';
    if (anyDirty) return 'unsaved';
    const all = characters.flatMap((c) => REF_SLOT_KEYS.map((k) => slotStatus(c, k)));
    if (all.every((s) => s === 'locked')) return 'locked';
    if (all.some((s) => s === 'saved' || s === 'locked')) return 'saved';
    return 'empty';
  })();

  const handleUpload = async (c: CharacterCard, k: CharacterRefSlotKey, file: File) => {
    const dataUrl = await readAndOptimizeImageFile(file, 1024);
    patchDraft(c, k, { imageUrl: dataUrl, filename: file.name, source: 'uploaded', uploadedAt: new Date().toISOString() });
    setNotice({ type: 'info', text: `${REF_SLOT_LABELS[k]} image loaded. Press Save on that slot to keep it.` });
  };

  const handleGenerate = async (c: CharacterCard, k: CharacterRefSlotKey) => {
    const draft = draftOf(c, k);
    const id = keyOf(c.id, k);
    setBusySlot(id);
    try {
      // Body views reuse the saved Face (and Front) image so the person stays identical.
      const refUrls = REF_SLOT_KEYS.filter((rk) => rk !== k && c.references[rk].imageUrl && c.references[rk].savedAt)
        .slice(0, 2)
        .map((rk) => c.references[rk].imageUrl!);
      const referenceImages = (await Promise.all(refUrls.map(urlToDataUrl))).filter((u): u is string => Boolean(u));
      const result = await requestCharacterReferenceImage(cloudSettings, {
        characterInfo: c.nameAndDetails,
        slot: k,
        prompt: draft.prompt.trim() || `${REF_SLOT_LABELS[k]} reference of ${characterDisplayName(c)}`,
        referenceImages,
      });
      if (!result.ok) {
        setNotice({ type: 'error', text: `${REF_SLOT_LABELS[k]}: ${result.error}` });
        return;
      }
      patchDraft(c, k, {
        imageUrl: result.imageUrl,
        filename: result.filename,
        source: 'cloud_generated',
        uploadedAt: new Date().toISOString(),
      });
      setNotice({ type: 'info', text: `${REF_SLOT_LABELS[k]} image generated by AI. Press Save on that slot to keep it.` });
    } finally {
      setBusySlot(null);
    }
  };

  const handleSaveSlot = (c: CharacterCard, k: CharacterRefSlotKey) => {
    const d = draftOf(c, k);
    if (!d.imageUrl) {
      setNotice({ type: 'error', text: `Upload or generate the ${REF_SLOT_LABELS[k]} image before saving.` });
      return;
    }
    onSaveCharacterSlot(c.id, k, { ...c.references[k], ...d, locked: false, lockedAt: undefined });
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[keyOf(c.id, k)];
      return copy;
    });
    setNotice({ type: 'info', text: `${REF_SLOT_LABELS[k]} reference saved (still unlocked).` });
  };

  const handleSlotLock = (c: CharacterCard, k: CharacterRefSlotKey) => {
    const slot = c.references[k];
    if (slot.locked) {
      onToggleCharacterSlotLock(c.id, k, false);
      setNotice({ type: 'info', text: `${REF_SLOT_LABELS[k]} unlocked. Upload / Generate / Edit enabled.` });
      return;
    }
    if (slotDirty(c, k) || !slot.savedAt || !slot.imageUrl) {
      setNotice({ type: 'error', text: `Save the ${REF_SLOT_LABELS[k]} image first, then Lock. / লক করার আগে সেভ করুন।` });
      return;
    }
    onToggleCharacterSlotLock(c.id, k, true);
    setNotice({ type: 'info', text: `${REF_SLOT_LABELS[k]} locked.` });
  };

  const handleBack = () => {
    if (confirmLeave(anyDirty)) onBack();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <SectionTopBar
        title="Character Reference Images"
        subtitle="Face · Front · Side · Back"
        status={sectionStatus}
        onBack={handleBack}
      />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />

      {characters.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.14] bg-[#10131A] p-8 text-center space-y-3">
          <p className="text-sm text-slate-300">
            No saved characters yet. Save a character in “Character Information” first.
          </p>
          <button
            type="button"
            onClick={onOpenCharacterInfo}
            className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#07080B] text-sm font-bold"
          >
            Open Character Information
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Characters">
            {characters.map((c) => {
              const done = characterCompleteness(c).complete;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                  className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold whitespace-nowrap ${
                    c.id === selectedId
                      ? 'bg-[#E5A93C] text-[#07080B] border-[#E5A93C]'
                      : 'bg-[#10131A] text-slate-200 border-white/[0.12]'
                  }`}
                >
                  {characterDisplayName(c)} {done ? '✓' : '•'}
                </button>
              );
            })}
          </div>

          {card && card.locked && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Lock className="w-4 h-4" /> “{characterDisplayName(card)}” is locked — all 4 slots are protected.
              </span>
              <button
                type="button"
                onClick={() => onToggleCharacterLock(card.id, false)}
                className="min-h-[36px] px-3 rounded-lg border border-emerald-500/45 text-emerald-200 font-semibold inline-flex items-center gap-1"
              >
                <Unlock className="w-3.5 h-3.5" /> Unlock
              </button>
            </div>
          )}

          {card &&
            REF_SLOT_KEYS.map((k) => {
              const d = draftOf(card, k);
              const slot = card.references[k];
              const status = slotStatus(card, k);
              const disabled = card.locked || Boolean(slot.locked);
              const busy = busySlot === keyOf(card.id, k);
              const fileId = `ref_${card.id}_${k}`;
              return (
                <section
                  key={k}
                  aria-label={`${REF_SLOT_LABELS[k]} reference`}
                  className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-3.5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{REF_SLOT_LABELS[k]}</div>
                      <div className="text-[11px] text-slate-400">{SLOT_HINT[k]}</div>
                    </div>
                    <span className={`text-[11px] font-semibold ${statusTone(status)}`}>{statusLabel(status)}</span>
                  </div>

                  <div className="grid grid-cols-[96px_1fr] sm:grid-cols-[140px_1fr] gap-3 items-start">
                    <div className="aspect-[3/4] rounded-xl overflow-hidden bg-[#07080B] border border-white/[0.08]">
                      <SafeImage src={d.imageUrl} alt={`${REF_SLOT_LABELS[k]} preview`} fallbackLabel="No image" />
                    </div>
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        disabled={disabled}
                        aria-label={`${REF_SLOT_LABELS[k]} prompt`}
                        value={d.prompt}
                        onChange={(e) => patchDraft(card, k, { prompt: e.target.value })}
                        placeholder="Prompt for AI generation (optional for upload)"
                        className="w-full rounded-xl bg-[#07080B] border border-white/[0.1] p-2.5 text-xs text-slate-100 disabled:opacity-60"
                      />
                      {d.imageUrl && (
                        <div className="text-[11px] text-slate-400 truncate">
                          {d.source === 'cloud_generated' ? 'AI generated' : d.source === 'sample_asset' ? 'Sample asset' : 'Uploaded'} · {d.filename || 'image'}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          id={fileId}
                          type="file"
                          accept="image/*"
                          disabled={disabled}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleUpload(card, k, f);
                            e.target.value = '';
                          }}
                        />
                        <label
                          htmlFor={fileId}
                          className={`min-h-[40px] rounded-lg border border-white/[0.12] text-xs font-semibold inline-flex items-center justify-center gap-1 ${
                            disabled ? 'opacity-40 cursor-not-allowed text-slate-500' : 'bg-[#07080B] hover:bg-white/[0.08] text-white cursor-pointer'
                          }`}
                        >
                          <Upload className="w-3.5 h-3.5 text-[#E5A93C]" /> Upload
                        </label>
                        <button
                          type="button"
                          disabled={disabled || busy}
                          onClick={() => void handleGenerate(card, k)}
                          className="min-h-[40px] rounded-lg border border-[#E5A93C]/40 bg-[#E5A93C]/10 hover:bg-[#E5A93C]/20 text-[#FDE68A] text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-40"
                        >
                          <Sparkles className="w-3.5 h-3.5" /> {busy ? 'Waiting for AI…' : 'AI Generate'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <SectionControls
                    compact
                    locked={disabled}
                    savedClean={status === 'saved' || (status === 'locked' && !slotDirty(card, k))}
                    onSave={() => handleSaveSlot(card, k)}
                    onToggleLock={() =>
                      card.locked ? onToggleCharacterLock(card.id, false) : handleSlotLock(card, k)
                    }
                    saveLabel={`Save ${REF_SLOT_LABELS[k]}`}
                  />
                </section>
              );
            })}

          {cloudSettings.status !== 'connected' && (
            <p className="text-[11px] text-amber-300/90">
              AI Generate needs the backend (Cloud Settings → Test Backend Connection). Without it, use Upload — no fake images are created.
            </p>
          )}

          <button
            type="button"
            onClick={handleBack}
            className="w-full min-h-[46px] rounded-xl border border-white/[0.14] bg-[#10131A] text-sm font-semibold text-slate-200"
          >
            Back to Project Materials
          </button>
        </>
      )}
    </div>
  );
}
