import { useCallback, useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { MovieProject } from '../types/studio';
import { openStudioDb } from '../utils/storage';
import { cleanUnusedMedia, estimateStorage, formatBytes, MediaReport, mediaReport, StorageEstimate } from '../utils/mediaStore';

/**
 * Shows how much browser storage the studio uses. Saved images/videos are never deleted
 * automatically: unused files are removed only after the user presses the button and confirms.
 */
export function LocalStoragePanel({ projects }: { projects: MovieProject[] }) {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [report, setReport] = useState<MediaReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setEstimate(await estimateStorage());
    try {
      setReport(await mediaReport(await openStudioDb(), projects));
    } catch {
      setReport(null);
    }
  }, [projects]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clean = async () => {
    if (!report || report.unusedCount === 0) return;
    const ok = window.confirm(
      `Delete ${report.unusedCount} saved file(s) (${formatBytes(report.unusedBytes)}) that no project uses any more?\n` +
        'Files used by any version of any project are NOT touched. This cannot be undone.'
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await cleanUnusedMedia(await openStudioDb(), projects);
      setMessage(`Removed ${r.deleted} unused file(s), freed ${formatBytes(r.freedBytes)}.`);
      await refresh();
    } catch (err) {
      setMessage(`Cleanup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const pct = estimate ? Math.round(estimate.ratio * 100) : null;
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3.5 space-y-2 text-xs" data-testid="local-storage-panel">
      <div className="flex items-center gap-2 font-semibold text-slate-300">
        <HardDrive className="w-4 h-4 text-[#E5A93C]" /> Browser storage (images &amp; videos)
      </div>
      <p className="text-slate-400">
        {estimate ? `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used (${pct}%)` : 'Usage unknown in this browser'}
        {estimate?.persisted === true ? ' · protected from automatic cleanup' : ''}
        {report ? ` · ${report.count} stored file(s), ${formatBytes(report.bytes)}` : ''}
      </p>
      {pct !== null && pct >= 80 && (
        <p className="text-amber-300">Storage is {pct}% full. Nothing is deleted automatically — free space or save to the cloud / a ZIP.</p>
      )}
      <button
        type="button"
        disabled={busy || !report || report.unusedCount === 0}
        onClick={() => void clean()}
        className="min-h-[38px] px-3 rounded-lg border border-white/[0.14] text-slate-200 disabled:opacity-40"
      >
        {report && report.unusedCount > 0
          ? `Clean unused local files (${report.unusedCount} · ${formatBytes(report.unusedBytes)})`
          : 'No unused local files'}
      </button>
      {message && <p className="text-blue-200">{message}</p>}
    </div>
  );
}
