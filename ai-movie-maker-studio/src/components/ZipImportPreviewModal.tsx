import {
  AlertTriangle,
  CheckCircle2,
  FileArchive,
  X,
  XCircle,
} from 'lucide-react';
import { MovieProject } from '../types/studio';
import { ZipImportInspection } from '../utils/zipManager';

interface ZipImportPreviewModalProps {
  inspection: ZipImportInspection | null;
  onConfirm: (project: MovieProject) => void;
  onCancel: () => void;
}

export function ZipImportPreviewModal({
  inspection,
  onConfirm,
  onCancel,
}: ZipImportPreviewModalProps) {
  if (!inspection) return null;

  const hasBlockingErrors =
    inspection.errors.length > 0 || !inspection.previewProject;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="ZIP Project Import Preview"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <FileArchive className="w-5 h-5 text-[#E5A93C] shrink-0" />
              <span className="truncate">ZIP Import Preview &amp; Confirm</span>
            </h2>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              Archive: {inspection.archiveName} (
              {(inspection.archiveSizeBytes / 1024).toFixed(1)} KB compressed ·{' '}
              {(inspection.totalUncompressedBytes / 1024).toFixed(1)} KB uncompressed)
              {' '}· Project:{' '}
              <span className="text-white font-medium">
                {inspection.projectTitle}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close ZIP preview"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs tabular-nums">
          <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3">
            <div className="text-slate-400">Story</div>
            <div
              className={`font-bold mt-1 ${
                inspection.storyFound ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              {inspection.storyFound ? 'Found' : 'Missing'}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3">
            <div className="text-slate-400">Characters</div>
            <div className="font-bold text-white mt-1">
              {inspection.characterCount}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3">
            <div className="text-slate-400">Ref Images</div>
            <div className="font-bold text-white mt-1">
              {inspection.characterRefImagesCount}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3">
            <div className="text-slate-400">Image Prompts</div>
            <div className="font-bold text-white mt-1">
              {inspection.imagePromptCount}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3">
            <div className="text-slate-400">Video Prompts</div>
            <div className="font-bold text-white mt-1">
              {inspection.videoPromptCount}
            </div>
          </div>
        </div>

        {inspection.errors.length > 0 && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 space-y-1.5 text-xs text-rose-200">
            <div className="font-bold text-rose-300 flex items-center gap-1.5">
              <XCircle className="w-4 h-4 shrink-0" />
              Import Blocked — Fix these ZIP file errors before importing:
            </div>
            <ul className="list-disc pl-5 space-y-1">
              {inspection.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {inspection.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 space-y-1 text-xs text-amber-200">
            <div className="font-semibold text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Warnings:
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {inspection.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Inspected Files Breakdown */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">
            Inspected Archive Entries ({inspection.files.length})
          </div>
          <div className="max-h-52 overflow-y-auto space-y-1.5">
            {inspection.files.map((entry, idx) => (
              <div
                key={`${entry.path}_${idx}`}
                className="rounded-xl border border-white/[0.08] bg-[#07080B] px-3 py-2 text-xs flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="font-mono text-white truncate">
                    {entry.path}
                  </div>
                  <div className="text-slate-400">{entry.message}</div>
                </div>
                <span
                  className={`text-[11px] font-semibold shrink-0 ${
                    entry.status === 'error'
                      ? 'text-rose-400'
                      : entry.status === 'warning'
                        ? 'text-amber-300'
                        : 'text-emerald-400'
                  }`}
                >
                  {entry.category}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Imported sections always start UNLOCKED so you can review, edit, Save,
          and manually Lock each section before production.
        </p>

        <div className="flex justify-end gap-2.5 pt-2 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={hasBlockingErrors}
            onClick={() => {
              if (inspection.previewProject && !hasBlockingErrors) {
                onConfirm(inspection.previewProject);
              }
            }}
            className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] disabled:opacity-40 text-[#07080B] text-xs font-bold inline-flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            Confirm &amp; Import Project
          </button>
        </div>
      </div>
    </div>
  );
}
