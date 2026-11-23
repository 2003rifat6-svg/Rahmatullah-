import { useEffect, useRef, useState } from 'react';
import { CloudDownload, CloudUpload, Download, LogOut, RefreshCw, Trash2, Upload } from 'lucide-react';
import { CloudBackendSettings, MovieProject } from '../types/studio';
import { cloudAuth, CloudFile, cloudFiles, CloudProjectMeta, cloudProjects, CloudUser, loadGoogleIdentity } from '../services/cloudSync';

interface Props {
  cloudSettings: CloudBackendSettings;
  cloudUser: CloudUser | null;
  activeProject: MovieProject;
  localProjectIds: string[];
  onSignedIn: (user: CloudUser) => void;
  onSignedOut: () => void;
  onSaveActiveToCloud: () => Promise<string>;
  onLoadFromCloud: (id: string) => Promise<string>;
  onDeleteFromCloud: (id: string) => Promise<string>;
}

type GoogleId = {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
};

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Optional Cloud Sync (Firestore + Cloud Storage). The local IndexedDB save keeps working
 * whether or not this is used; nothing syncs automatically.
 */
export function CloudSyncPanel({
  cloudSettings,
  cloudUser,
  activeProject,
  localProjectIds,
  onSignedIn,
  onSignedOut,
  onSaveActiveToCloud,
  onLoadFromCloud,
  onDeleteFromCloud,
}: Props) {
  const btnRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [projects, setProjects] = useState<CloudProjectMeta[] | null>(null);
  const [files, setFiles] = useState<CloudFile[] | null>(null);

  const connected = cloudSettings.status === 'connected';
  const googleMode = cloudSettings.authMode === 'google' && Boolean(cloudSettings.googleClientId);
  const syncAvailable = Boolean(cloudSettings.cloudSync);

  useEffect(() => {
    if (!connected || !googleMode || cloudUser || !btnRef.current) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        const g = (window as unknown as { google?: GoogleId }).google;
        if (cancelled || !g || !btnRef.current) return;
        g.accounts.id.initialize({
          client_id: cloudSettings.googleClientId!,
          callback: async ({ credential }) => {
            const res = await cloudAuth.signIn(cloudSettings, credential);
            if (res.ok) {
              onSignedIn(res.data.user);
              setMessage({ type: 'info', text: `Signed in as ${res.data.user.email}.` });
            } else setMessage({ type: 'error', text: res.error });
          },
        });
        g.accounts.id.renderButton(btnRef.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
      })
      .catch((err) => setMessage({ type: 'error', text: err.message }));
    return () => {
      cancelled = true;
    };
  }, [connected, googleMode, cloudUser, cloudSettings, onSignedIn]);

  const refresh = async () => {
    setBusy('refresh');
    try {
      const [p, f] = await Promise.all([cloudProjects.list(cloudSettings), cloudFiles.list(cloudSettings, activeProject.id)]);
      if (p.ok) setProjects(p.data.projects);
      else setMessage({ type: 'error', text: p.error });
      if (f.ok) setFiles(f.data.files);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (cloudUser && syncAvailable) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudUser, syncAvailable, activeProject.id]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      const text = await fn();
      setMessage({ type: /fail|error|could not|not /i.test(text) ? 'error' : 'info', text });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = (file: File) =>
    run('upload', async () => {
      const kind = file.type.startsWith('image/') ? 'images' : file.type.startsWith('video/') ? 'videos' : file.name.endsWith('.zip') ? 'zips' : 'files';
      const res = await cloudFiles.upload(cloudSettings, activeProject.id, kind, file.name, file);
      return res.ok ? `Uploaded "${file.name}" to Cloud Storage.` : `Upload failed: ${res.error}`;
    });

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-4 space-y-4" aria-label="Cloud Sync">
      <div>
        <h2 className="font-display text-base font-bold text-white">Cloud Sync (optional)</h2>
        <p className="text-xs text-slate-400">
          Your projects are always saved in this browser. Cloud Sync is an extra copy in Firestore + Cloud Storage, private to your Google account. Nothing syncs automatically.
        </p>
      </div>

      {message && (
        <div className={`rounded-xl border px-3 py-2 text-xs ${message.type === 'error' ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-blue-500/35 bg-blue-500/10 text-blue-100'}`}>
          {message.text}
        </div>
      )}

      {!connected ? (
        <p className="text-xs text-amber-300">Connect the backend first (Test Backend Connection below).</p>
      ) : !googleMode ? (
        <p className="text-xs text-amber-300">This server has no sign-in configured (GOOGLE_OAUTH_CLIENT_ID), so Cloud Sync is off. Local save works normally.</p>
      ) : !cloudUser ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-300">Sign in to use Cloud Sync. Only you can see your cloud projects and files.</p>
          <div ref={btnRef} />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-300 truncate" data-testid="cloud-user">
              Signed in: <b className="text-white">{cloudUser.email}</b>
            </span>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => void refresh()} className="min-h-[36px] px-2.5 rounded-lg border border-white/[0.12] text-slate-200 inline-flex items-center gap-1" aria-label="Refresh cloud lists">
                <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  await cloudAuth.signOut(cloudSettings);
                  onSignedOut();
                  setProjects(null);
                  setFiles(null);
                }}
                className="min-h-[36px] px-2.5 rounded-lg border border-white/[0.12] text-slate-200 inline-flex items-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          </div>

          {!syncAvailable ? (
            <p className="text-xs text-amber-300">Firestore is not enabled on this server (FIRESTORE_ENABLED), so projects cannot be synced.</p>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run('save', onSaveActiveToCloud)}
                className="w-full min-h-[46px] rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] disabled:opacity-40 text-[#07080B] text-sm font-bold inline-flex items-center justify-center gap-2"
              >
                <CloudUpload className="w-4 h-4" />
                {busy === 'save' ? 'Saving to cloud…' : `Save “${activeProject.title}” to Cloud`}
              </button>
              <p className="text-[11px] text-slate-500">
                {activeProject.cloudSyncedAt
                  ? `Last cloud save: ${new Date(activeProject.cloudSyncedAt).toLocaleString()} (revision ${activeProject.cloudRevision}).`
                  : 'This project has not been saved to the cloud yet.'}
              </p>

              <h3 className="text-xs font-semibold text-slate-300 pt-1">My cloud projects ({projects?.length ?? '…'})</h3>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {projects?.length === 0 && <p className="text-xs text-slate-500">No cloud projects yet.</p>}
                {projects?.map((p) => (
                  <div key={p.id} className="rounded-xl border border-white/[0.08] bg-[#07080B] px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">{p.title}</div>
                      <div className="text-slate-500">
                        {new Date(p.updatedAt).toLocaleString()} · rev {p.revision} · {fmtSize(p.sizeBytes)}
                        {localProjectIds.includes(p.id) ? ' · also on this device' : ''}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void run(`load_${p.id}`, () => onLoadFromCloud(p.id))}
                        className="min-h-[36px] px-2.5 rounded-lg border border-white/[0.12] text-[#E5A93C] inline-flex items-center gap-1 disabled:opacity-40"
                      >
                        <CloudDownload className="w-3.5 h-3.5" /> Load
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        aria-label={`Delete ${p.title} from cloud`}
                        onClick={() => {
                          if (window.confirm(`Delete "${p.title}" and all its cloud files from the cloud? The copy on this device is kept.`)) {
                            void run(`del_${p.id}`, () => onDeleteFromCloud(p.id));
                          }
                        }}
                        className="min-h-[36px] px-2.5 rounded-lg border border-rose-500/30 text-rose-300 inline-flex items-center gap-1 disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-300">Cloud files of this project ({files?.length ?? '…'})</h3>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*,.zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => fileRef.current?.click()}
                className="min-h-[36px] px-2.5 rounded-lg border border-white/[0.12] text-xs text-white inline-flex items-center gap-1 disabled:opacity-40"
              >
                <Upload className="w-3.5 h-3.5 text-[#E5A93C]" /> Upload
              </button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {files?.length === 0 && <p className="text-xs text-slate-500">No files in Cloud Storage for this project.</p>}
              {files?.map((f) => (
                <div key={f.key} className="rounded-xl border border-white/[0.08] bg-[#07080B] px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="text-white truncate">{f.name}</div>
                    <div className="text-slate-500">
                      {f.kind} · {fmtSize(f.size)}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <a href={cloudFiles.downloadUrl(cloudSettings, f.url)} className="min-h-[36px] px-2.5 rounded-lg border border-white/[0.12] text-slate-200 inline-flex items-center" aria-label={`Download ${f.name}`}>
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      aria-label={`Delete ${f.name}`}
                      onClick={() => {
                        if (window.confirm(`Delete "${f.name}" from Cloud Storage?`)) {
                          void run(`file_${f.key}`, async () => {
                            const r = await cloudFiles.remove(cloudSettings, f.key);
                            return r.ok ? `Deleted ${f.name}.` : `Delete failed: ${r.error}`;
                          });
                        }
                      }}
                      className="min-h-[36px] px-2.5 rounded-lg border border-rose-500/30 text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
