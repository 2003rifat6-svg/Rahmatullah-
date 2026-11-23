import { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Images,
  Lock,
  Send,
  Sliders,
  Unlock,
  Users,
  Video,
} from 'lucide-react';
import { MaterialSectionKey, MovieProject } from '../types/studio';
import { getHubSections } from '../utils/sections';
import { buildMaterialsBundle } from '../services/studioBackend';

interface Props {
  project: MovieProject;
  onNavigate: (screen: MaterialSectionKey) => void;
  onBack: () => void;
  onSendAll: () => void;
}

const ICONS: Record<MaterialSectionKey, typeof BookOpen> = {
  story: BookOpen,
  characters: Users,
  character_refs: Images,
  image_prompts: ImageIcon,
  video_prompts: Video,
  production_settings: Sliders,
  generated_images: Clapperboard,
  generated_videos: Film,
};

const STATUS_TEXT = {
  locked: 'Locked',
  saved: 'Saved · Unlocked',
  unsaved: 'Not saved · Unlocked',
  empty: 'Empty · Unlocked',
} as const;

const STATUS_TONE = {
  locked: 'text-emerald-400',
  saved: 'text-blue-400',
  unsaved: 'text-amber-300',
  empty: 'text-slate-400',
} as const;

/**
 * Project Materials Hub — the 8 sections. Opening a section never sends anything to chat.
 * The ONLY way materials reach Main Chat is the "Send All Materials to Main Chat" button.
 */
export function MaterialsHubScreen({ project, onNavigate, onBack, onSendAll }: Props) {
  const sections = getHubSections(project);
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = previewOpen ? buildMaterialsBundle(project) : null;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-5 py-4 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="min-h-[44px] px-3 rounded-xl border border-white/[0.1] bg-[#10131A] inline-flex items-center gap-2 text-sm text-slate-200"
      >
        <ArrowLeft className="w-4 h-4 text-[#E5A93C]" /> Main Chat
      </button>
      <div>
        <h1 className="font-display text-xl font-bold text-white">Project Materials</h1>
        <p className="text-sm text-slate-400 mt-1">
          প্রতিটি Section আলাদাভাবে Edit → Save → Lock করুন। কোনো Section নিজে থেকে Main Chat-এ কিছু পাঠায় না।
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {sections.map((s) => {
          const Icon = ICONS[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onNavigate(s.key)}
              data-testid={`hub-${s.key}`}
              className="text-left rounded-xl border border-white/[0.1] bg-[#11141b] p-3.5 hover:border-amber-400/50 space-y-1.5 min-h-[92px]"
            >
              <div className="flex items-center gap-2">
                <Icon className="w-5 h-5 text-amber-400 shrink-0" />
                <span className="font-semibold text-white text-sm">
                  {s.number}. {s.title}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {s.bengali} · {s.detail}
              </p>
              <div className={`text-xs font-semibold ${STATUS_TONE[s.status]}`} data-testid={`hub-status-${s.key}`}>
                {s.status === 'locked' ? <Lock className="inline w-3 h-3 mr-1" /> : <Unlock className="inline w-3 h-3 mr-1" />}
                {STATUS_TEXT[s.status]}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[#E5A93C]/30 bg-[#E5A93C]/5 p-3.5 space-y-3">
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className="text-xs font-semibold text-[#FDE68A] underline"
        >
          {previewOpen ? 'Hide bundle preview' : 'Preview what will be sent'}
        </button>
        {preview && (
          <div className="text-xs space-y-1.5">
            <div className="text-emerald-300">Included: {preview.included.join(', ') || 'nothing saved yet'}</div>
            {preview.excluded.length > 0 && (
              <div className="text-amber-300">Not included: {preview.excluded.join('; ')}</div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onSendAll}
          className="w-full min-h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm inline-flex items-center justify-center gap-2"
        >
          <Send className="w-4 h-4" /> Send All Materials to Main Chat
        </button>
        <p className="text-[11px] text-slate-400">
          শুধু Save করা উপকরণ একটি গোছানো Bundle হিসেবে Main Chat-এ যাবে। অসম্পূর্ণ Character ও Save না করা লেখা যাবে না। এতে কোনো ছবি বা ভিডিও তৈরি হয় না।
          {project.lastBundleSentAt ? ` Last sent: ${new Date(project.lastBundleSentAt).toLocaleString()}.` : ''}
        </p>
      </div>
    </div>
  );
}
