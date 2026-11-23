import { ComponentProps, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  FileArchive,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AspectRatio,
  CloudBackendSettings,
  CloudSyncStatus,
  GenerateTargetType,
  MovieProject,
  PlatformChoice,
  ProductionSettings,
  StorageStatus,
  SupportedResolution,
} from '../types/studio';
import { createDefaultProductionSettings } from '../data/sampleProject';
import { testCloudBackendConnection } from '../services/studioBackend';
import {
  inspectAndParseProjectZip,
  ZipImportInspection,
} from '../utils/zipManager';
import { ZipImportPreviewModal } from './ZipImportPreviewModal';
import { CloudSyncPanel } from './CloudSyncPanel';
import { LocalStoragePanel } from './LocalStoragePanel';

interface ProjectsAndCloudScreenProps {
  mode: 'projects' | 'cloud_settings';
  projects: MovieProject[];
  activeProject: MovieProject;
  cloudSettings: CloudBackendSettings;
  storageStatus: StorageStatus;
  cloudSyncStatus: CloudSyncStatus;
  onChangeMode: (mode: 'projects' | 'cloud_settings') => void;
  onBackToChat: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (
    title: string,
    settings: Partial<ProductionSettings>
  ) => void;
  onLoadDemoProject: () => void;
  onImportZipProject: (imported: MovieProject) => void;
  onDuplicateProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onSaveCloudSettings: (next: CloudBackendSettings) => void;
  cloudPanel: Omit<ComponentProps<typeof CloudSyncPanel>, 'cloudSettings' | 'activeProject'>;
  onUpdateBudgetLimit: (budgetLimitUsd: number) => void;
  onClearJobLog: () => void;
}

export function ProjectsAndCloudScreen({
  mode,
  projects,
  activeProject,
  cloudSettings,
  storageStatus,
  cloudSyncStatus,
  onChangeMode,
  onBackToChat,
  onSelectProject,
  onCreateProject,
  onLoadDemoProject,
  onImportZipProject,
  onDuplicateProject,
  onDeleteProject,
  onSaveCloudSettings,
  cloudPanel,
  onUpdateBudgetLimit,
  onClearJobLog,
}: ProjectsAndCloudScreenProps) {
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGenType, setNewGenType] =
    useState<GenerateTargetType>('image_and_video');
  const [newPlatform, setNewPlatform] =
    useState<PlatformChoice>('youtube_movie');
  const [newAspectRatio, setNewAspectRatio] = useState<AspectRatio>('16:9');
  const [newResolution, setNewResolution] =
    useState<SupportedResolution>('1080p');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [cloudDraft, setCloudDraft] =
    useState<CloudBackendSettings>(cloudSettings);
  const [testingCloud, setTestingCloud] = useState(false);
  const [zipInspection, setZipInspection] =
    useState<ZipImportInspection | null>(null);
  const [parsingZip, setParsingZip] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const handleZipFilePick = async (file: File) => {
    setParsingZip(true);
    try {
      const inspected = await inspectAndParseProjectZip(file);
      setZipInspection(inspected);
    } finally {
      setParsingZip(false);
    }
  };

  const handleTestBackend = async () => {
    setTestingCloud(true);
    try {
      const checked = await testCloudBackendConnection(cloudDraft);
      setCloudDraft(checked);
      onSaveCloudSettings(checked);
    } finally {
      setTestingCloud(false);
    }
  };

  const handleCreateSubmit = () => {
    const clean = newTitle.trim() || 'Untitled Movie';
    onCreateProject(clean, {
      ...createDefaultProductionSettings(),
      generateType: newGenType,
      platform: newPlatform,
      aspectRatio: newAspectRatio,
      resolution: newResolution,
    });
    setNewTitle('');
    setNewProjectOpen(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-5 py-4 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToChat}
          className="min-h-[44px] px-3.5 py-2 rounded-xl border border-white/[0.1] bg-[#10131A] hover:bg-white/[0.06] text-sm font-medium text-white inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4 text-[#E5A93C]" />
          Back to Chat
        </button>

        <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#10131A] p-1">
          <button
            type="button"
            onClick={() => onChangeMode('projects')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold ${
              mode === 'projects'
                ? 'bg-[#E5A93C] text-[#07080B]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Projects ({projects.length})
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('cloud_settings')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold ${
              mode === 'cloud_settings'
                ? 'bg-[#E5A93C] text-[#07080B]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Google Cloud &amp; Cost Control
          </button>
        </div>

        {mode === 'projects' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleZipFilePick(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={parsingZip}
              onClick={() => zipInputRef.current?.click()}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-white/[0.12] bg-[#10131A] hover:bg-white/[0.06] text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <FileArchive className="w-4 h-4 text-[#E5A93C]" />
              {parsingZip ? 'Reading ZIP...' : 'Import Project ZIP'}
            </button>

            <button
              type="button"
              onClick={onLoadDemoProject}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5A93C]/40 bg-[#E5A93C]/10 hover:bg-[#E5A93C]/20 text-xs font-semibold text-[#FDE68A] inline-flex items-center gap-1.5"
            >
              <Sparkles className="w-4 h-4" />
              Load Demo Project
            </button>

            <button
              type="button"
              onClick={() => setNewProjectOpen(true)}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-xs sm:text-sm font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>
        )}
      </div>

      {mode === 'projects' ? (
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((proj) => {
              const isActive = proj.id === activeProject.id;
              return (
                <div
                  key={proj.id}
                  className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 ${
                    isActive
                      ? 'border-[#E5A93C]/60 bg-[#141821]'
                      : 'border-white/[0.08] bg-[#10131A]'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-display text-base font-bold text-white truncate">
                          {proj.title}
                        </h2>
                        {proj.isDemo && (
                          <span className="text-[11px] font-semibold text-[#E5A93C]">
                            Optional Sample Project · Demo Only (No AI Outputs)
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-xs font-semibold shrink-0 ${
                          proj.projectLocked
                            ? 'text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {proj.projectLocked ? 'Locked' : 'Draft'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 tabular-nums">
                      Story: {proj.story.rawText.trim() ? 'Added' : 'Empty'} ·{' '}
                      {proj.characters.length} characters ·{' '}
                      {proj.imagePrompts.parsedItems.length} image shots ·{' '}
                      {proj.videoPrompts.parsedItems.length} video shots
                    </p>

                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {proj.productionSettings.aspectRatio} ·{' '}
                      {proj.productionSettings.resolution} · Updated{' '}
                      {new Date(proj.updatedAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => onSelectProject(proj.id)}
                      className="min-h-[40px] px-4 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-xs font-bold"
                    >
                      {isActive ? 'Open Active Chat' : 'Open Workspace'}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onDuplicateProject(proj.id)}
                        title="Duplicate project"
                        aria-label={`Duplicate ${proj.title}`}
                        className="min-h-[40px] min-w-[40px] rounded-xl border border-white/[0.1] bg-[#07080B] hover:bg-white/[0.06] text-slate-300 flex items-center justify-center"
                      >
                        <Copy className="w-4 h-4" />
                      </button>

                      {projects.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(proj.id)}
                          title="Delete project"
                          aria-label={`Delete ${proj.title}`}
                          className="min-h-[40px] min-w-[40px] rounded-xl border border-white/[0.1] bg-[#07080B] hover:border-rose-500/40 text-slate-300 hover:text-rose-400 flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="space-y-6">
          {/* Separate Local Save vs Cloud Sync Status + Phase 1/2 Capability Split */}
          <section className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#E5A93C]" />
                  Local Save &amp; Cloud Sync Status
                </h2>
                <p className="text-xs text-slate-400">
                  Local Storage and Cloud Sync are tracked separately. App remains 100% usable in Local Mode when Cloud Backend is disconnected.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-300">
                    Local Save Status
                  </span>
                  <span
                    className={`font-semibold ${
                      storageStatus.ok ? 'text-blue-400' : 'text-rose-400'
                    }`}
                  >
                    {storageStatus.ok
                      ? `Saved (${storageStatus.engine})`
                      : 'Local Save Failed'}
                  </span>
                </div>
                <p className="text-slate-400">
                  {storageStatus.lastSavedAt
                    ? `Last local save: ${new Date(
                        storageStatus.lastSavedAt
                      ).toLocaleTimeString()}`
                    : 'Local IndexedDB / localStorage persistence active.'}
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-300">
                    Cloud Sync Status
                  </span>
                  <span
                    className={`font-semibold ${
                      cloudSyncStatus.status === 'synced'
                        ? 'text-emerald-400'
                        : cloudSyncStatus.status === 'error' ||
                            cloudSyncStatus.status === 'not_implemented'
                          ? 'text-rose-400'
                          : cloudSyncStatus.status === 'syncing'
                            ? 'text-amber-300'
                            : 'text-slate-400'
                    }`}
                  >
                    {cloudSyncStatus.status === 'synced'
                      ? 'Synced'
                      : cloudSyncStatus.status === 'syncing'
                        ? 'Syncing...'
                        : cloudSyncStatus.status === 'not_implemented'
                          ? 'Backend Not Implemented'
                          : cloudSyncStatus.status === 'error'
                            ? 'Sync Failed'
                            : 'Local only'}
                  </span>
                </div>
                <p className="text-slate-400">
                  {cloudSyncStatus.lastError
                    ? cloudSyncStatus.lastError
                    : cloudSyncStatus.lastSyncedAt
                      ? `Last cloud sync: ${new Date(
                          cloudSyncStatus.lastSyncedAt
                        ).toLocaleTimeString()}`
                      : 'Optional. Use “Save to Cloud” in the Cloud Sync panel below.'}
                </p>
              </div>
            </div>

            <LocalStoragePanel projects={projects} />

            {storageStatus.error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
                {storageStatus.error}
              </div>
            )}

            {storageStatus.quotaWarning && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                {storageStatus.quotaWarning}
              </div>
            )}

          </section>

          {/* Google Cloud Backend Configuration */}
          <section className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-[#E5A93C]" />
                  Studio Backend (AI generation server)
                </h2>
                <p className="text-xs text-slate-400">
                  The Gemini API key lives only on the server (server/ · GEMINI_API_KEY). This app never stores an AI API key.
                  {cloudDraft.status === 'connected' && (
                    <>
                      {' '}Server: Gemini {cloudDraft.geminiConfigured ? 'configured' : 'NOT configured'} · FFmpeg{' '}
                      {cloudDraft.ffmpegAvailable ? 'available' : 'not available'}.
                    </>
                  )}
                </p>
              </div>
              <span
                className={`text-xs font-semibold shrink-0 ${
                  cloudDraft.status === 'connected'
                    ? 'text-emerald-400'
                    : cloudDraft.status === 'unreachable'
                      ? 'text-rose-400'
                      : 'text-amber-300'
                }`}
              >
                {cloudDraft.status === 'connected'
                  ? 'Connected'
                  : cloudDraft.status === 'unreachable'
                    ? 'Unreachable'
                    : 'Not Configured'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Backend URL
                </label>
                <input
                  type="url"
                  value={cloudDraft.backendUrl}
                  onChange={(e) =>
                    setCloudDraft({ ...cloudDraft, backendUrl: e.target.value })
                  }
                  placeholder="https://your-studio-server.example.com"
                  className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={() => setCloudDraft({ ...cloudDraft, backendUrl: window.location.origin })}
                  className="mt-1.5 text-[11px] font-semibold text-[#E5A93C] underline"
                >
                  Use this app’s own server ({window.location.origin})
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Studio Access Token (only if the server sets STUDIO_ACCESS_TOKEN)
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={cloudDraft.accessToken || ''}
                  onChange={(e) => setCloudDraft({ ...cloudDraft, accessToken: e.target.value })}
                  placeholder="optional"
                  className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white font-mono"
                />
                <p className="mt-1 text-[11px] text-slate-500">Not an AI API key — just a password that protects your server from strangers.</p>
              </div>

            </div>

            {cloudDraft.lastError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                {cloudDraft.lastError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-[#E5A93C]" />
                Backend: Node/Express · Gemini (images, chat) · Veo (video) · FFmpeg · Firestore + Cloud Storage (sync). Google Cloud project, bucket and region are set on the server (see README), not here.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSaveCloudSettings(cloudDraft)}
                  className="min-h-[42px] px-4 rounded-xl border border-white/[0.12] bg-[#07080B] hover:bg-white/[0.06] text-xs font-semibold text-white"
                >
                  Save Config
                </button>
                <button
                  type="button"
                  disabled={testingCloud}
                  onClick={() => void handleTestBackend()}
                  className="min-h-[42px] px-4 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${testingCloud ? 'animate-spin' : ''}`}
                  />
                  {testingCloud ? 'Testing /health...' : 'Test Backend Connection'}
                </button>
              </div>
            </div>
          </section>

          <CloudSyncPanel {...cloudPanel} cloudSettings={cloudDraft.status === 'connected' ? { ...cloudSettings, ...cloudDraft } : cloudSettings} activeProject={activeProject} />

          {/* Cost & Job Control for Active Project */}
          <section className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  Cost &amp; Job Control — {activeProject.title}
                </h2>
                <p className="text-xs text-slate-400">
                  Budget note, log of real generation requests, and saved prompt versions. Costs are billed by Google to the server owner; this app does not track spend.
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs tabular-nums">
                <label className="text-slate-300 font-medium">
                  Budget Limit ($ USD):
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={activeProject.costAndJobs.budgetLimitUsd}
                  onChange={(e) =>
                    onUpdateBudgetLimit(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-24 min-h-[40px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs tabular-nums">
              <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3.5">
                <div className="text-slate-400">Budget Cap</div>
                <div className="text-base font-bold text-[#E5A93C] mt-1">
                  ${activeProject.costAndJobs.budgetLimitUsd.toFixed(2)}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3.5">
                <div className="text-slate-400">Requests made</div>
                <div className="text-base font-bold text-white mt-1">
                  {activeProject.costAndJobs.jobs.length}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3.5">
                <div className="text-slate-400">Estimated Cost</div>
                <div className="text-base font-bold text-slate-200 mt-1">
                  See Google AI Studio billing
                </div>
              </div>
            </div>

            {/* Jobs Queue */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">
                  Generation Request Log ({activeProject.costAndJobs.jobs.length})
                </h3>
                {activeProject.costAndJobs.jobs.length > 0 && (
                  <button type="button" onClick={onClearJobLog} className="text-[11px] text-slate-400 underline">
                    Clear log
                  </button>
                )}
              </div>
              {activeProject.costAndJobs.jobs.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No generation requests yet. Use Generated Images (Step 1) and Generated Videos (Step 2).
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {activeProject.costAndJobs.jobs.map((job) => (
                    <div
                      key={job.id}
                      className="rounded-xl border border-white/[0.08] bg-[#07080B] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono font-semibold text-white">
                          {job.kind.toUpperCase()} · {job.sceneId}-{job.shotId}
                        </div>
                        <div className="text-slate-400 tabular-nums">
                          {job.status} · {new Date(job.updatedAt).toLocaleString()}
                          {job.errorMessage ? ` · ${job.errorMessage}` : ''}
                        </div>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generation History & Version History */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/[0.08]">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">
                  Generation History ({activeProject.costAndJobs.history.length})
                </h3>
                <div className="max-h-40 overflow-y-auto space-y-1.5 text-xs">
                  {activeProject.costAndJobs.history.map((h) => (
                    <div
                      key={h.id}
                      className="rounded-lg bg-[#07080B] border border-white/[0.06] px-3 py-2 text-slate-300"
                    >
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {new Date(h.timestamp).toLocaleString()}
                      </div>
                      <div>{h.summary}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">
                  Preserved Asset Versions ({activeProject.versions.length})
                </h3>
                {activeProject.versions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Original assets and prompt versions are saved here when you
                    request edits in Main Chat.
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1.5 text-xs">
                    {activeProject.versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="rounded-lg bg-[#07080B] border border-white/[0.06] px-3 py-2 text-slate-300 space-y-0.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[#E5A93C] font-semibold">
                            {ver.assetKey}
                          </span>
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            {new Date(ver.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-slate-200">{ver.instruction}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          Original: {ver.previousValue}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* New Project Modal */}
      {newProjectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Create New Project"
          onClick={() => setNewProjectOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 sm:p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h2 className="font-display text-base font-bold text-white">
                New Movie Project
              </h2>
              <button
                type="button"
                onClick={() => setNewProjectOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Project Name
              </label>
              <input
                type="text"
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Solar Echoes"
                className="w-full min-h-[44px] rounded-xl bg-[#07080B] border border-white/[0.12] px-3 text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Generate
                </label>
                <select
                  value={newGenType}
                  onChange={(e) =>
                    setNewGenType(e.target.value as GenerateTargetType)
                  }
                  className="w-full min-h-[42px] rounded-xl bg-[#07080B] border border-white/[0.12] px-2.5 text-xs text-white"
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                  <option value="image_and_video">Image + Video</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Platform
                </label>
                <select
                  value={newPlatform}
                  onChange={(e) => {
                    const p = e.target.value as PlatformChoice;
                    setNewPlatform(p);
                    if (p === 'youtube_movie') setNewAspectRatio('16:9');
                    if (
                      p === 'youtube_shorts' ||
                      p === 'tiktok' ||
                      p === 'instagram_reels'
                    ) {
                      setNewAspectRatio('9:16');
                    }
                  }}
                  className="w-full min-h-[42px] rounded-xl bg-[#07080B] border border-white/[0.12] px-2.5 text-xs text-white"
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
                  value={newAspectRatio}
                  onChange={(e) =>
                    setNewAspectRatio(e.target.value as AspectRatio)
                  }
                  className="w-full min-h-[42px] rounded-xl bg-[#07080B] border border-white/[0.12] px-2.5 text-xs text-white font-mono"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Resolution
                </label>
                <select
                  value={newResolution}
                  onChange={(e) =>
                    setNewResolution(e.target.value as SupportedResolution)
                  }
                  className="w-full min-h-[42px] rounded-xl bg-[#07080B] border border-white/[0.12] px-2.5 text-xs text-white font-mono"
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setNewProjectOpen(false)}
                className="min-h-[42px] px-4 rounded-xl text-xs font-medium text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSubmit}
                className="min-h-[42px] px-5 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-xs font-bold inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                Create &amp; Open Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-white">
              Delete Project?
            </h2>
            <p className="text-xs text-slate-300">
              This removes the project and its saved chat history from local
              storage.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="min-h-[40px] px-4 rounded-xl text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteProject(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="min-h-[40px] px-4 rounded-xl bg-rose-500 text-white text-xs font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <ZipImportPreviewModal
        inspection={zipInspection}
        onCancel={() => setZipInspection(null)}
        onConfirm={(imported) => {
          onImportZipProject(imported);
          setZipInspection(null);
        }}
      />
    </div>
  );
}
