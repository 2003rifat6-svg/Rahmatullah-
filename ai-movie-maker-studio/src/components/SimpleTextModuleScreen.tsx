import { useEffect, useRef, useState } from 'react';
import { Lock, Upload } from 'lucide-react';
import { ParsedPromptEntry } from '../types/studio';
import { parsePromptsFromRawText } from '../utils/validation';
import {
  confirmLeave,
  SectionControls,
  SectionNotice,
  SectionStatus,
  SectionTopBar,
} from './SectionControls';

interface SimpleTextModuleScreenProps {
  title: string;
  bengaliTitle: string;
  placeholder: string;
  acceptTypes: string;
  rawText: string;
  filename?: string;
  locked: boolean;
  savedAt?: string;
  parsedItems?: ParsedPromptEntry[];
  /** Image prompts, used to preview image links while editing video prompts. */
  linkedImages?: ParsedPromptEntry[];
  kind: 'story' | 'image_prompts' | 'video_prompts';
  onSave: (nextText: string, filename?: string) => void;
  onToggleLock: (nextLocked: boolean) => void;
  onBack: () => void;
  /** Story Master only: opens the AI Story Analysis (draft) screen. */
  onOpenAnalysis?: () => void;
}

export function SimpleTextModuleScreen({
  title,
  bengaliTitle,
  placeholder,
  acceptTypes,
  rawText,
  filename,
  locked,
  savedAt,
  parsedItems,
  linkedImages,
  kind,
  onSave,
  onToggleLock,
  onBack,
  onOpenAnalysis,
}: SimpleTextModuleScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draftText, setDraftText] = useState(rawText);
  const [draftFilename, setDraftFilename] = useState(filename);
  const [notice, setNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setDraftText(rawText);
    setDraftFilename(filename);
  }, [rawText, filename]);

  const isDirty = draftText !== rawText || draftFilename !== filename;
  const isSavedClean = Boolean(savedAt) && !isDirty;
  const status: SectionStatus = locked
    ? 'locked'
    : isSavedClean
      ? 'saved'
      : draftText.trim()
        ? 'unsaved'
        : 'empty';

  // Live preview of how the prompts will be split (Scene ID / Shot ID / order).
  const previewItems =
    kind === 'story'
      ? []
      : isDirty
        ? parsePromptsFromRawText(draftText, kind === 'image_prompts' ? 'image' : 'video', linkedImages ?? [])
        : (parsedItems ?? []);

  const handleFileUpload = async (file: File) => {
    if (locked) return;
    const text = await file.text();
    setDraftText(text);
    setDraftFilename(file.name);
    setNotice({ type: 'info', text: `Loaded "${file.name}". Press Save to keep it.` });
  };

  const handleSave = () => {
    if (locked) return;
    if (!draftText.trim()) {
      setNotice({ type: 'error', text: `Please paste or upload ${title} content before saving.` });
      return;
    }
    onSave(draftText, draftFilename);
    setNotice({
      type: 'info',
      text: `${title} saved. It stays UNLOCKED — press Lock when you want to protect it.`,
    });
  };

  const handleLockClick = () => {
    if (locked) {
      onToggleLock(false);
      setNotice({ type: 'info', text: `${title} unlocked. Editing and upload are enabled again.` });
      return;
    }
    if (!isSavedClean) {
      setNotice({ type: 'error', text: 'Please press Save first before locking. / লক করার আগে সেভ করুন।' });
      return;
    }
    onToggleLock(true);
    setNotice({ type: 'info', text: `${title} locked. / লক করা হয়েছে।` });
  };

  const handleBack = () => {
    if (confirmLeave(isDirty && !locked)) onBack();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <SectionTopBar title={title} subtitle={bengaliTitle} status={status} onBack={handleBack} />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />

      {locked && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          This section is locked. Press Unlock to edit or upload again.
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#10131A] p-3.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white truncate">{draftFilename || 'No file selected'}</div>
          <div className="text-xs text-slate-400">Paste below or upload a TXT / JSON / MD file</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptTypes}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileUpload(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={locked}
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[44px] px-4 py-2 rounded-xl border border-white/[0.14] bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center gap-2 shrink-0"
        >
          <Upload className="w-4 h-4 text-[#E5A93C]" />
          Upload File
        </button>
      </div>

      {kind === 'story' && onOpenAnalysis && (
        <button
          type="button"
          onClick={() => {
            if (isDirty && !window.confirm('Your latest story edits are not saved. The analysis uses the SAVED story. Open the analysis anyway?')) return;
            onOpenAnalysis();
          }}
          className="w-full min-h-[46px] rounded-xl border border-[#E5A93C]/40 bg-[#E5A93C]/10 hover:bg-[#E5A93C]/20 text-[#FDE68A] text-sm font-semibold"
        >
          ✨ AI Story Analysis → characters, scenes, shots, prompts (draft)
        </button>
      )}

      <textarea
        rows={13}
        disabled={locked}
        aria-label={`${title} editor`}
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/[0.1] bg-[#0B0D12] p-4 text-sm text-slate-100 leading-relaxed focus:outline-none focus:border-[#E5A93C] disabled:opacity-65"
      />

      {kind !== 'story' && previewItems.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-[#10131A] p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-300 tabular-nums">
            Scene/Shot IDs in original order ({previewItems.length} shot(s)){isDirty ? ' · preview, not saved' : ''}
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-white/[0.06] text-xs">
            {previewItems.map((item) => (
              <div key={item.id} className="py-1.5 flex items-center justify-between gap-3">
                <span className="font-mono text-[#E5A93C] shrink-0">
                  {item.sceneId} · {item.shotId}
                </span>
                <span className={`truncate flex-1 ${item.promptText.trim() ? 'text-slate-300' : 'text-rose-300'}`}>
                  {item.promptText || '(empty prompt)'}
                </span>
                {kind === 'video_prompts' && (
                  <span className={`shrink-0 ${item.linkedImageKey ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {item.linkedImageKey ? `→ ${item.linkedImageKey}` : 'No image'}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            Format per line: <span className="font-mono">S01 | SH01 | prompt text</span> (JSON arrays with sceneId / shotId / prompt also work).
          </p>
        </div>
      )}

      <SectionControls
        locked={locked}
        savedClean={isSavedClean}
        onSave={handleSave}
        onToggleLock={handleLockClick}
        onBack={handleBack}
      />
    </div>
  );
}
