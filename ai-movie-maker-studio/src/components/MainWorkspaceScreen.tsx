import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Cloud,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Play,
  Plus,
  Send,
  Settings,
  Sliders,
  Upload,
  X,
} from 'lucide-react';
import {
  ChatAttachment,
  CloudBackendSettings,
  CloudSyncStatus,
  MovieProject,
  WorkspaceScreen,
} from '../types/studio';
import { auditProjectMaterials, createId } from '../utils/validation';
import { getHubSections } from '../utils/sections';
import { GenerationRunState } from './ShotOutputsScreen';
import { readAndOptimizeImageFile } from '../utils/storage';
import { SafeImage } from './SafeImage';

interface MainWorkspaceScreenProps {
  project: MovieProject;
  cloudSettings: CloudBackendSettings;
  cloudSyncStatus: CloudSyncStatus;
  isSendingChat?: boolean;
  run?: GenerationRunState | null;
  onNavigate: (screen: WorkspaceScreen) => void;
  onPickZipFile?: (file: File) => void;
  onSendMessage: (
    text: string,
    attachments: ChatAttachment[],
    uploadedTexts: Array<{ filename: string; content: string }>
  ) => void;
}

export function MainWorkspaceScreen({
  project,
  cloudSettings,
  cloudSyncStatus,
  isSendingChat = false,
  run = null,
  onNavigate,
  onPickZipFile,
  onSendMessage,
}: MainWorkspaceScreenProps) {
  const [composerText, setComposerText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingTextFiles, setPendingTextFiles] = useState<
    Array<{ filename: string; content: string }>
  >([]);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [openBundleIds, setOpenBundleIds] = useState<Record<string, boolean>>({});
  const onOpenSettings = () => onNavigate('production_settings');
  const hubSections = getHubSections(project);
  const aiReady = cloudSettings.status === 'connected' && cloudSettings.geminiConfigured !== false;

  const chatEndRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [project.chatMessages.length]);

  const audit = auditProjectMaterials(project);

  const handleImagePick = async (
    files: FileList | null,
    kind: 'camera' | 'gallery'
  ) => {
    if (!files || files.length === 0) return;
    const added: ChatAttachment[] = [];
    for (const file of Array.from(files)) {
      const url = await readAndOptimizeImageFile(file, 960);
      added.push({
        id: createId('att'),
        name: file.name,
        kind,
        previewUrl: url,
      });
    }
    setPendingAttachments((prev) => [...prev, ...added]);
    setPlusMenuOpen(false);
  };

  const handleDocumentPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const addedAtt: ChatAttachment[] = [];
    const addedTexts: Array<{ filename: string; content: string }> = [];

    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.zip') && onPickZipFile) {
        onPickZipFile(file);
        continue;
      }
      addedAtt.push({
        id: createId('att'),
        name: file.name,
        kind: 'file',
      });
      if (
        lower.endsWith('.txt') ||
        lower.endsWith('.json') ||
        lower.endsWith('.md') ||
        lower.endsWith('.csv')
      ) {
        const content = await file.text();
        addedTexts.push({ filename: file.name, content });
      }
    }

    if (addedAtt.length > 0) {
      setPendingAttachments((prev) => [...prev, ...addedAtt]);
    }
    if (addedTexts.length > 0) {
      setPendingTextFiles((prev) => [...prev, ...addedTexts]);
    }
    setPlusMenuOpen(false);
  };

  const handleSubmitChat = () => {
    const trimmed = composerText.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    onSendMessage(trimmed, pendingAttachments, pendingTextFiles);
    setComposerText('');
    setPendingAttachments([]);
    setPendingTextFiles([]);
  };

  const totalImagesPlanned =
    project.imagePrompts.parsedItems.length *
    project.productionSettings.imageQuantity;
  const totalVideosPlanned =
    project.videoPrompts.parsedItems.length *
    project.productionSettings.videoQuantity;

  const connectedCharacterRefs = project.characters.reduce((sum, ch) => {
    let count = 0;
    if (ch.references.face.imageUrl) count += 1;
    if (ch.references.front.imageUrl) count += 1;
    if (ch.references.side.imageUrl) count += 1;
    if (ch.references.back.imageUrl) count += 1;
    return sum + count;
  }, 0);

  return (
    <div className="flex flex-col h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] max-w-5xl mx-auto px-3 sm:px-5 py-3 gap-3">
      {/* Top Studio Header */}
      <header className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('projects')}
            className="min-h-[44px] px-3 rounded-xl border border-white/[0.1] bg-[#10131A] hover:bg-white/[0.06] text-xs font-semibold text-white inline-flex items-center gap-1.5 shrink-0"
          >
            <FolderOpen className="w-4 h-4 text-[#E5A93C]" />
            <span>Projects</span>
          </button>

          <div className="min-w-0 px-1">
            <h1 className="font-display text-sm sm:text-base font-bold text-white truncate">
              {project.title}
            </h1>
            <p className="text-[11px] text-slate-400 truncate tabular-nums">
              {audit.errors.length === 0 ? 'Ready' : 'Unlocked'} ·{' '}
              {project.productionSettings.aspectRatio} ·{' '}
              {project.productionSettings.resolution} ·{' '}
              {aiReady ? 'Gemini AI connected' : 'Local mode (no AI)'}{' '}
              ·{' '}
              {cloudSyncStatus.status === 'synced'
                ? 'Cloud Synced'
                : cloudSyncStatus.status === 'error' ||
                    cloudSyncStatus.status === 'not_implemented'
                  ? 'Cloud Sync Error'
                  : 'Local Saved'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('generated_videos')}
            className="min-h-[44px] px-3 rounded-xl border border-white/[0.1] bg-[#10131A] hover:bg-white/[0.06] text-xs font-semibold text-white inline-flex items-center gap-1.5"
            aria-label="Outputs and export"
          >
            <Upload className="w-4 h-4 text-[#E5A93C] rotate-180" />
            <span className="hidden sm:inline">Outputs</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('cloud_settings')}
            className="min-h-[44px] px-3 rounded-xl border border-white/[0.1] bg-[#10131A] hover:bg-white/[0.06] text-xs font-semibold text-white inline-flex items-center gap-1.5"
            aria-label="Cloud and Cost Settings"
          >
            <Cloud className="w-4 h-4 text-[#E5A93C]" />
            <span className="hidden sm:inline">Cloud</span>
          </button>
        </div>
      </header>

      {/* Large AI Main Chat Box (unobstructed full height) */}
      <main
        aria-label="AI Main Chat Box"
        className="flex-1 min-h-0 rounded-2xl border border-white/[0.08] bg-[#0B0D12] overflow-y-auto p-3 sm:p-5 space-y-4"
      >
        {project.chatMessages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[90%] sm:max-w-[78%] rounded-2xl px-4 py-3 space-y-2.5 ${
                  isUser
                    ? 'bg-[#1A1F2B] border border-[#E5A93C]/30 text-slate-100'
                    : 'bg-[#10131A] border border-white/[0.08] text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400">
                  <span className="font-semibold text-[#E5A93C]">
                    {isUser
                      ? msg.isMaterialBundle
                        ? 'You · Project Materials'
                        : 'You'
                      : msg.responseMode === 'cloud_gemini'
                        ? 'Gemini Assistant (AI)'
                        : 'Studio Assistant · Local (no AI)'}
                  </span>
                  <span className="tabular-nums">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {msg.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="rounded-lg border border-white/[0.08] bg-[#07080B] p-1.5 space-y-1"
                      >
                        {att.previewUrl ? (
                          <div className="aspect-video rounded overflow-hidden">
                            <SafeImage src={att.previewUrl} alt={att.name} />
                          </div>
                        ) : (
                          <div className="py-2 flex items-center justify-center text-[#E5A93C]">
                            <FileText className="w-5 h-5" />
                          </div>
                        )}
                        <div className="text-[11px] text-slate-300 truncate text-center">
                          {att.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.text}
                </p>

                {msg.isMaterialBundle && msg.bundleText && (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setOpenBundleIds((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                      className="text-xs font-semibold text-[#E5A93C] underline"
                    >
                      {openBundleIds[msg.id] ? 'Hide full bundle' : 'Show full bundle'}
                    </button>
                    {openBundleIds[msg.id] && (
                      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed bg-[#07080B] border border-white/[0.08] rounded-lg p-2.5 text-slate-300">
                        {msg.bundleText}
                      </pre>
                    )}
                  </div>
                )}

                {msg.actionHint === 'open_settings' && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-[#E5A93C] inline-flex items-center gap-1.5"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Open Production Settings
                  </button>
                )}

                {msg.actionHint === 'open_cloud' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('cloud_settings')}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-[#E5A93C] inline-flex items-center gap-1.5"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    Open Cloud Settings (backend)
                  </button>
                )}

                {msg.actionHint === 'start_production' && (
                  <button
                    type="button"
                    onClick={() => setStartModalOpen(true)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Review &amp; Start Production
                  </button>
                )}

                {msg.actionHint === 'open_materials' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('materials_hub')}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-[#E5A93C] inline-flex items-center gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Open Project Materials
                  </button>
                )}

                {msg.actionHint === 'open_outputs' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('generated_videos')}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-[#E5A93C] inline-flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5 rotate-180" />
                    Open Output Files &amp; ZIPs
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {run && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100 flex items-center justify-between gap-2">
            <span className="tabular-nums">
              {run.kind === 'image' ? 'Image' : 'Video'} generation running: {run.done + run.failed}/{run.total} finished ({run.failed} failed)
            </span>
            <button
              type="button"
              onClick={() => onNavigate(run.kind === 'image' ? 'generated_images' : 'generated_videos')}
              className="font-semibold underline"
            >
              Open
            </button>
          </div>
        )}

        <div ref={chatEndRef} />
      </main>

      {/* Bottom Chat Composer */}
      <footer className="shrink-0 space-y-2">
        {pendingAttachments.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-xl border border-white/[0.12] bg-[#10131A] px-2.5 py-1.5 text-xs text-slate-200 shrink-0"
              >
                <span className="truncate max-w-[140px]">{att.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingAttachments((prev) =>
                      prev.filter((p) => p.id !== att.id)
                    );
                    setPendingTextFiles((prev) =>
                      prev.filter((t) => t.filename !== att.name)
                    );
                  }}
                  aria-label={`Remove ${att.name}`}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-white/[0.1] bg-[#10131A] p-2">
          <button
            type="button"
            onClick={() => setPlusMenuOpen(true)}
            aria-label="Attach files or open project materials"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-[#E5A93C] flex items-center justify-center shrink-0"
          >
            <Plus className="w-5 h-5" />
          </button>

          <textarea
            rows={1}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmitChat();
              }
            }}
            placeholder='Message AI Assistant, paste prompts, or ask for revisions...'
            className="flex-1 min-h-[44px] max-h-28 resize-none bg-transparent px-2 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />

          <button
            type="button"
            onClick={handleSubmitChat}
            disabled={
              isSendingChat ||
              (!composerText.trim() && pendingAttachments.length === 0)
            }
            aria-label="Send message"
            className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] disabled:opacity-40 text-[#07080B] text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">
              {isSendingChat ? 'Sending...' : 'Send'}
            </span>
          </button>
        </div>

        {/* Hidden Inputs for Plus Menu */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handleImagePick(e.target.files, 'camera');
            e.target.value = '';
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleImagePick(e.target.files, 'gallery');
            e.target.value = '';
          }}
        />
        <input
          ref={filesInputRef}
          type="file"
          accept=".json,.txt,.md,.pdf,.zip,.csv"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleDocumentPick(e.target.files);
            e.target.value = '';
          }}
        />
      </footer>

      {/* Plus (+) Menu Sheet */}
      {plusMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Attachments and Project Materials"
          onClick={() => setPlusMenuOpen(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h2 className="font-display text-base font-bold text-white">
                Studio Menu &amp; Attachments
              </h2>
              <button
                type="button"
                onClick={() => setPlusMenuOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-[#E5A93C]">
                A. Upload from Device
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="min-h-[68px] rounded-xl border border-white/[0.1] bg-[#07080B] hover:border-[#E5A93C]/50 p-2 flex flex-col items-center justify-center gap-1.5 text-xs text-white"
                >
                  <Camera className="w-5 h-5 text-[#E5A93C]" />
                  <span>Camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="min-h-[68px] rounded-xl border border-white/[0.1] bg-[#07080B] hover:border-[#E5A93C]/50 p-2 flex flex-col items-center justify-center gap-1.5 text-xs text-white"
                >
                  <ImageIcon className="w-5 h-5 text-[#E5A93C]" />
                  <span>Gallery</span>
                </button>
                <button
                  type="button"
                  onClick={() => filesInputRef.current?.click()}
                  className="min-h-[68px] rounded-xl border border-white/[0.1] bg-[#07080B] hover:border-[#E5A93C]/50 p-2 flex flex-col items-center justify-center gap-1.5 text-xs text-white"
                >
                  <FileText className="w-5 h-5 text-[#E5A93C]" />
                  <span>Files</span>
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-[#E5A93C]">
                B. Project Materials
              </div>
              <div className="grid grid-cols-2 gap-2">
                {hubSections.map((item) => {
                  const toneClass =
                    item.status === 'locked'
                      ? 'text-emerald-400'
                      : item.status === 'saved'
                        ? 'text-blue-400'
                        : item.status === 'unsaved'
                          ? 'text-amber-300'
                          : 'text-slate-500';
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setPlusMenuOpen(false);
                        onNavigate(item.key);
                      }}
                      className="min-h-[54px] px-3 py-2 rounded-xl border border-white/[0.1] bg-[#07080B] hover:border-[#E5A93C]/50 text-left flex flex-col justify-center gap-0.5"
                    >
                      <div className="text-xs font-semibold text-white truncate">
                        {item.number}. {item.title}
                      </div>
                      <div className={`text-[11px] ${toneClass}`}>
                        {item.status === 'locked' ? 'Locked' : item.status === 'saved' ? 'Saved' : item.status === 'unsaved' ? 'Not saved' : 'Empty'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#E5A93C]">
                C. Production Controls
              </div>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    onNavigate('materials_hub');
                  }}
                  className="min-h-[44px] px-3 rounded-xl border border-[#E5A93C]/50 bg-[#E5A93C]/12 hover:bg-[#E5A93C]/20 text-[#FDE68A] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>OPEN PROJECT MATERIALS (Send All is there)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="min-h-[44px] px-3 rounded-xl border border-white/[0.12] bg-[#07080B] hover:bg-white/[0.06] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5 text-[#E5A93C]" />
                  <span>
                    Production Settings (
                    {project.productionSettings.locked
                      ? 'Locked'
                      : project.productionSettings.savedAt
                        ? 'Saved'
                        : 'Draft'}
                    )
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    setStartModalOpen(true);
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-xs font-bold inline-flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>START PRODUCTION · শুরু করুন</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Production Validation & Confirmation Modal */}
      {startModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Start Production Review"
          onClick={() => setStartModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#10131A] p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h2 className="font-display text-base sm:text-lg font-bold text-white">
                Start Production · Validation Check
              </h2>
              <button
                type="button"
                onClick={() => setStartModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {audit.errors.length > 0 ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Fix these before production (Save + Lock each section):
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-xs text-rose-200">
                    {audit.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap gap-2">
                  {!audit.storyOk && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartModalOpen(false);
                        onNavigate('story');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-white/[0.12] bg-[#07080B] text-xs font-semibold text-white"
                    >
                      Open Story
                    </button>
                  )}
                  {!audit.charactersOk && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartModalOpen(false);
                        onNavigate('characters');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-white/[0.12] bg-[#07080B] text-xs font-semibold text-white"
                    >
                      Open Characters
                    </button>
                  )}
                  {!audit.settingsOk && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartModalOpen(false);
                        onNavigate('production_settings');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-white/[0.12] bg-[#07080B] text-xs font-semibold text-white"
                    >
                      Open Production Settings
                    </button>
                  )}
                  {!audit.charactersOk && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartModalOpen(false);
                        onNavigate('character_refs');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-white/[0.12] bg-[#07080B] text-xs font-semibold text-white"
                    >
                      Open Reference Images
                    </button>
                  )}
                  {!audit.imagesOk && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartModalOpen(false);
                        onNavigate('image_prompts');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-white/[0.12] bg-[#07080B] text-xs font-semibold text-white"
                    >
                      Open Image Prompts
                    </button>
                  )}
                  {!audit.videosOk && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartModalOpen(false);
                        onNavigate('video_prompts');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-white/[0.12] bg-[#07080B] text-xs font-semibold text-white"
                    >
                      Open Video Prompts
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-start gap-2.5 text-xs text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Story, characters, reference images, image prompts and video prompts are saved, locked and consistent (Scene/Shot IDs and image→video links checked).
                  </span>
                </div>

                {audit.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                    {audit.warnings.map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}

                <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3.5 text-xs space-y-1.5 text-slate-300 tabular-nums">
                  <div>
                    Target:{' '}
                    <span className="text-white font-semibold">
                      {project.productionSettings.generateType}
                    </span>{' '}
                    · {project.productionSettings.aspectRatio} ·{' '}
                    {project.productionSettings.resolution}
                  </div>
                  <div>
                    Connected Character References:{' '}
                    <span className="text-white font-semibold">
                      {project.characters.length} character(s) ·{' '}
                      {connectedCharacterRefs} reference image(s)
                    </span>
                  </div>
                  <div>
                    Planned Batch:{' '}
                    <span className="text-white font-semibold">
                      {totalImagesPlanned} image(s)
                    </span>{' '}
                    ·{' '}
                    <span className="text-white font-semibold">
                      {totalVideosPlanned} video(s)
                    </span>{' '}
                    ({project.productionSettings.videoDurationSec}s each)
                  </div>
                  <div>
                    Budget Cap:{' '}
                    <span className="text-[#E5A93C] font-semibold">
                      ${project.costAndJobs.budgetLimitUsd.toFixed(2)} USD
                    </span>{' '}
                    · Cloud Backend:{' '}
                    <span className="text-white font-semibold">
                      {cloudSettings.status === 'connected'
                        ? cloudSettings.backendUrl
                        : 'Not Connected (Held as awaiting_backend)'}
                    </span>
                  </div>
                </div>

                {audit.videoStepErrors.length > 0 && (
                  <div className="rounded-xl border border-white/[0.08] bg-[#07080B] p-3 text-xs text-slate-300 space-y-1">
                    <div className="font-semibold text-slate-200">Step 2 waits for images:</div>
                    {audit.videoStepErrors.slice(0, 6).map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}

                {!aiReady && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    AI backend is not ready ({cloudSettings.status === 'connected' ? 'GEMINI_API_KEY missing on server' : 'not connected'}). You can open the steps and upload files manually; AI generation stays disabled.
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStartModalOpen(false);
                      onNavigate('generated_images');
                    }}
                    className="min-h-[48px] px-4 rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-sm font-bold"
                  >
                    Step 1 · Generate Images →
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStartModalOpen(false);
                      onNavigate('generated_videos');
                    }}
                    className="min-h-[48px] px-4 rounded-xl border border-[#E5A93C]/50 bg-[#E5A93C]/10 text-[#FDE68A] text-sm font-bold"
                  >
                    Step 2 · Generate Videos from Images →
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartModalOpen(false)}
                    className="min-h-[40px] px-4 rounded-xl text-xs font-medium text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
