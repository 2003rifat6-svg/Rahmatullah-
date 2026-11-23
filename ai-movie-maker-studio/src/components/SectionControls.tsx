import { AlertCircle, ArrowLeft, Check, Lock, Unlock } from 'lucide-react';

export type SectionStatus = 'locked' | 'saved' | 'unsaved' | 'empty';

export function statusLabel(status: SectionStatus): string {
  switch (status) {
    case 'locked':
      return 'Locked · লক করা';
    case 'saved':
      return 'Saved · Unlocked';
    case 'unsaved':
      return 'Unsaved · Unlocked';
    default:
      return 'Empty · Unlocked';
  }
}

export function statusTone(status: SectionStatus): string {
  return status === 'locked'
    ? 'text-emerald-400'
    : status === 'saved'
      ? 'text-blue-400'
      : status === 'unsaved'
        ? 'text-amber-300'
        : 'text-slate-400';
}

/**
 * Asks before leaving a section with unsaved edits. Leaving NEVER sends anything to Main Chat.
 */
export function confirmLeave(isDirty: boolean): boolean {
  if (!isDirty) return true;
  return window.confirm(
    'এই Section-এ Save না করা পরিবর্তন আছে। Back করলে সেগুলো বাদ যাবে (Main Chat-এ কিছু যাবে না)।\n\nUnsaved changes will be discarded. Go back anyway?'
  );
}

export function SectionTopBar({
  title,
  subtitle,
  status,
  onBack,
}: {
  title: string;
  subtitle?: string;
  status: SectionStatus;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Project Materials (back)"
        className="min-h-[44px] px-3 py-2 rounded-xl border border-white/[0.1] bg-[#10131A] hover:bg-white/[0.06] text-sm font-medium text-white inline-flex items-center gap-2 shrink-0"
      >
        <ArrowLeft className="w-4 h-4 text-[#E5A93C]" />
        <span className="hidden sm:inline">Project Materials</span>
        <span className="sm:hidden">Back</span>
      </button>
      <div className="text-center min-w-0">
        <h1 className="font-display text-base sm:text-xl font-bold text-white truncate">{title}</h1>
        {subtitle && <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>}
      </div>
      <span className={`text-[11px] sm:text-xs font-semibold text-right shrink-0 ${statusTone(status)}`} data-testid="section-status">
        {statusLabel(status)}
      </span>
    </div>
  );
}

export function SectionNotice({
  notice,
  onDismiss,
}: {
  notice: { type: 'info' | 'error'; text: string } | null;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  return (
    <div
      role={notice.type === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-2.5 text-xs flex items-start justify-between gap-3 ${
        notice.type === 'error'
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          : 'border-blue-500/35 bg-blue-500/10 text-blue-100'
      }`}
    >
      <div className="flex items-start gap-2">
        {notice.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
        <span className="whitespace-pre-wrap">{notice.text}</span>
      </div>
      <button type="button" onClick={onDismiss} className="text-xs font-semibold underline shrink-0">
        OK
      </button>
    </div>
  );
}

/** Universal bottom bar: Save · Lock/Unlock · Back. Save never locks. */
export function SectionControls({
  locked,
  savedClean,
  onSave,
  onToggleLock,
  onBack,
  saveLabel = 'Save',
  compact = false,
}: {
  locked: boolean;
  savedClean: boolean;
  onSave: () => void;
  onToggleLock: () => void;
  onBack?: () => void;
  saveLabel?: string;
  compact?: boolean;
}) {
  const h = compact ? 'min-h-[42px]' : 'min-h-[48px]';
  return (
    <div className={`grid ${onBack ? 'grid-cols-3' : 'grid-cols-2'} gap-2.5`}>
      <button
        type="button"
        disabled={locked}
        onClick={onSave}
        data-saved={savedClean ? 'true' : 'false'}
        className={`${h} rounded-xl border text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-45 ${
          savedClean
            ? 'bg-blue-600 border-blue-500 text-white'
            : 'bg-[#E5A93C] hover:bg-[#F0B84D] border-[#E5A93C] text-[#07080B]'
        }`}
      >
        <Check className="w-4 h-4" />
        <span>{savedClean ? 'Saved ✓' : saveLabel}</span>
      </button>
      <button
        type="button"
        onClick={onToggleLock}
        data-locked={locked ? 'true' : 'false'}
        className={`${h} rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 border transition-colors ${
          locked
            ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-300 hover:bg-emerald-500/25'
            : 'bg-[#10131A] border-white/[0.16] hover:bg-white/[0.08] text-white'
        }`}
      >
        {locked ? (
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
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className={`${h} rounded-xl border border-white/[0.14] bg-[#10131A] hover:bg-white/[0.08] text-xs sm:text-sm font-semibold text-slate-200 inline-flex items-center justify-center gap-1.5`}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      )}
    </div>
  );
}
