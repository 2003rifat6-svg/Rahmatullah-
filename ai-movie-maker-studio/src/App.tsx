import { useEffect, useRef, useState } from 'react';
import {
  CharacterCard,
  CharacterRefSlot,
  CharacterRefSlotKey,
  ChatAttachment,
  CloudBackendSettings,
  CloudSyncStatus,
  MaterialSectionKey,
  MovieProject,
  ParsedPromptEntry,
  ProductionJob,
  ProductionSettings,
  StorageStatus,
  WorkspaceScreen,
} from './types/studio';
import { createBlankProject, createSampleProject } from './data/sampleProject';
import { loadStudioState, normalizeProject, saveStudioState } from './utils/storage';
import { requestPersistentStorage } from './utils/mediaStore';
import { cloudAuth, cloudProjects, CloudUser, uploadProjectMedia } from './services/cloudSync';
import { characterDisplayName, createId, mergeShotOutputs, parsePromptsFromRawText, shotKey } from './utils/validation';
import { addVersion, removeVersion, selectVersion } from './utils/versions';
import { applyRecoveredJobs, findRecoverableJobs } from './utils/jobRecovery';
import { buildMaterialsBundle, DEFAULT_CLOUD_SETTINGS, interpretMainChatMessage } from './services/studioBackend';
import { phase2CloudServices } from './services/cloudApiInterfaces';
import { generateShotImage, runPool, startShotVideo, waitForVideoJob } from './services/productionRunner';
import { inspectAndParseProjectZip, ZipImportInspection } from './utils/zipManager';
import { MainWorkspaceScreen } from './components/MainWorkspaceScreen';
import { SimpleTextModuleScreen } from './components/SimpleTextModuleScreen';
import { CharacterInfoScreen } from './components/CharacterInfoScreen';
import { CharacterReferencesScreen } from './components/CharacterReferencesScreen';
import { ProductionSettingsModal } from './components/ProductionSettingsModal';
import { currentSelection, GenerationRunState, ShotOutputsScreen } from './components/ShotOutputsScreen';
import { ProjectsAndCloudScreen } from './components/ProjectsAndCloudScreen';
import { ZipImportPreviewModal } from './components/ZipImportPreviewModal';
import { MaterialsHubScreen } from './components/MaterialsHubScreen';
import { PlanSelection, StoryAnalysisScreen } from './components/StoryAnalysisScreen';
import { characterInfoText, hashStory, promptsText } from './utils/storyPlan';
import type { StoryPlan } from './types/storyPlan';
import { createEmptyCharacterCard } from './data/sampleProject';

type ShotKind = 'image' | 'video';

function withHistory(proj: MovieProject, summary: string, now = new Date().toISOString()): MovieProject {
  return {
    ...proj,
    costAndJobs: {
      ...proj.costAndJobs,
      history: [{ id: createId('hist'), timestamp: now, summary }, ...proj.costAndJobs.history].slice(0, 80),
    },
  };
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<MovieProject[]>(() => [createBlankProject('My First Movie')]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [cloudSettings, setCloudSettings] = useState<CloudBackendSettings>(DEFAULT_CLOUD_SETTINGS);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({ ok: true, engine: 'indexeddb' });
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({ status: 'local_only' });
  const [storageAlertDismissed, setStorageAlertDismissed] = useState(false);
  const [screen, setScreen] = useState<WorkspaceScreen>('chat');
  const [refsCharacterId, setRefsCharacterId] = useState<string | undefined>();
  const [zipInspection, setZipInspection] = useState<ZipImportInspection | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [run, setRun] = useState<GenerationRunState | null>(null);
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const cancelRef = useRef(false);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const resumedRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadStudioState()
      .then((result) => {
        if (!active) return;
        if (result.error) {
          setStorageStatus({ ok: false, engine: result.engine, error: result.error });
          setStorageAlertDismissed(false);
        }
        const saved = result.state;
        if (!saved) return;
        setProjects(saved.projects);
        const hasActive = saved.projects.some((p) => p.id === saved.activeProjectId);
        setActiveProjectId(hasActive ? saved.activeProjectId : saved.projects[0].id);
        setCloudSettings({ ...DEFAULT_CLOUD_SETTINGS, ...(saved.cloudSettings ?? {}) });
        setStorageStatus({
          ok: true,
          engine: result.engine,
          lastSavedAt: saved.savedAt,
          quotaWarning: result.missingMedia
            ? `${result.missingMedia} saved image/video file(s) could not be found in browser storage (they may have been cleared). Restore them from a project ZIP or the cloud copy.`
            : undefined,
        });
        if (result.missingMedia) setStorageAlertDismissed(false);
        void requestPersistentStorage();
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    void saveStudioState({
      activeProjectId: activeProject.id,
      projects,
      cloudSettings,
      savedAt: new Date().toISOString(),
    }).then((status) => {
      if (!active) return;
      setStorageStatus(status);
      if (!status.ok || status.quotaWarning) setStorageAlertDismissed(false);
    });
    return () => {
      active = false;
    };
  }, [hydrated, activeProject.id, projects, cloudSettings]);

  const updateProject = (projectId: string, updater: (prev: MovieProject) => MovieProject) => {
    const now = new Date().toISOString();
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...updater(p), updatedAt: now } : p)));
  };
  const updateActiveProject = (updater: (prev: MovieProject) => MovieProject) => updateProject(activeProject.id, updater);

  const patchShot = (projectId: string, kind: ShotKind, key: string, fn: (item: ParsedPromptEntry) => ParsedPromptEntry) =>
    updateProject(projectId, (proj) => {
      const field = kind === 'image' ? 'imagePrompts' : 'videoPrompts';
      return {
        ...proj,
        [field]: {
          ...proj[field],
          parsedItems: proj[field].parsedItems.map((i) => (shotKey(i) === key ? fn(i) : i)),
        },
      };
    });

  const logJob = (projectId: string, job: Omit<ProductionJob, 'id' | 'updatedAt'>) =>
    updateProject(projectId, (proj) => ({
      ...proj,
      costAndJobs: {
        ...proj.costAndJobs,
        jobs: [{ ...job, id: createId('job'), updatedAt: new Date().toISOString() }, ...proj.costAndJobs.jobs].slice(0, 200),
      },
    }));

  const goHub = () => setScreen('materials_hub');

  // ---------- 1. Story / 4. Image prompts / 5. Video prompts (Save never locks) ----------
  const handleSaveStory = (nextText: string, filename?: string) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) =>
      withHistory({ ...proj, story: { ...proj.story, rawText: nextText, filename, savedAt: now, locked: false } }, 'Saved Story (unlocked)', now)
    );
  };

  const handleSaveImagePrompts = (nextText: string, filename?: string) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) => {
      const parsedImages = mergeShotOutputs(parsePromptsFromRawText(nextText, 'image'), proj.imagePrompts.parsedItems);
      const relinkedVideos = proj.videoPrompts.rawText.trim()
        ? mergeShotOutputs(parsePromptsFromRawText(proj.videoPrompts.rawText, 'video', parsedImages), proj.videoPrompts.parsedItems)
        : proj.videoPrompts.parsedItems;
      return withHistory(
        {
          ...proj,
          imagePrompts: { ...proj.imagePrompts, rawText: nextText, filename, savedAt: now, locked: false, parsedItems: parsedImages },
          videoPrompts: { ...proj.videoPrompts, parsedItems: relinkedVideos },
        },
        `Saved Image Prompts (${parsedImages.length} shots, unlocked)`,
        now
      );
    });
  };

  const handleSaveVideoPrompts = (nextText: string, filename?: string) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) => {
      const parsedVideos = mergeShotOutputs(
        parsePromptsFromRawText(nextText, 'video', proj.imagePrompts.parsedItems),
        proj.videoPrompts.parsedItems
      );
      return withHistory(
        { ...proj, videoPrompts: { ...proj.videoPrompts, rawText: nextText, filename, savedAt: now, locked: false, parsedItems: parsedVideos } },
        `Saved Video Prompts (${parsedVideos.length} shots, unlocked)`,
        now
      );
    });
  };

  const toggleSectionLock =
    (field: 'story' | 'imagePrompts' | 'videoPrompts' | 'productionSettings' | 'generatedImagesSection' | 'generatedVideosSection') =>
    (nextLocked: boolean) => {
      const now = new Date().toISOString();
      updateActiveProject((proj) => ({
        ...proj,
        [field]: { ...proj[field], locked: nextLocked, lockedAt: nextLocked ? now : undefined },
      }));
    };

  // ---------- AI Story Analysis (draft only; nothing is final until the user saves it) ----------
  const handleAnalyzeStory = async (o: { style: string; maxScenes: number; shotsPerScene: number }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const proj = activeProject;
    const res = await phase2CloudServices.story.analyze(cloudSettings, { story: proj.story.rawText, style: o.style, maxScenes: o.maxScenes, shotsPerScene: o.shotsPerScene });
    if (!res.ok || !res.data) return { ok: false, error: res.error || 'Story analysis failed.' };
    const { plan, meta } = res.data;
    // The paid result is kept immediately as a draft, so a reload never loses it.
    updateProject(proj.id, (p) => ({ ...p, storyPlanDraft: { plan, meta, createdAt: new Date().toISOString(), storyHash: hashStory(proj.story.rawText) } }));
    return { ok: true };
  };

  const handleUpdateDraft = (plan: StoryPlan) =>
    updateActiveProject((p) => (p.storyPlanDraft ? { ...p, storyPlanDraft: { ...p.storyPlanDraft, plan } } : p));

  const handleDiscardDraft = () => updateActiveProject((p) => ({ ...p, storyPlanDraft: undefined }));

  /** The ONLY place where a draft becomes project materials: the user pressed "Save as Project Materials". */
  const handleApplyPlan = (plan: StoryPlan, sel: PlanSelection): string => {
    const now = new Date().toISOString();
    const existing = new Set(activeProject.characters.map((c) => characterDisplayName(c).toLowerCase()));
    const newCards = sel.characters
      .filter((c) => !existing.has(c.name.toLowerCase()))
      .map((c) => {
        const planChar = plan.characters.find((x) => x.name === c.name);
        const look = planChar?.consistencyPrompt ?? '';
        const card = createEmptyCharacterCard();
        return {
          ...card,
          nameAndDetails: c.infoText,
          savedAt: now,
          // reference prompts are pre-filled so the user only presses "AI Generate" or uploads photos
          references: {
            face: { ...card.references.face, prompt: `Close-up face portrait of ${c.name}: ${look}` },
            front: { ...card.references.front, prompt: `Full-body front view of ${c.name}: ${look}` },
            side: { ...card.references.side, prompt: `Full-body side view of ${c.name}: ${look}` },
            back: { ...card.references.back, prompt: `Full-body back view of ${c.name}: ${look}` },
          },
        };
      });
    const skipped = sel.characters.length - newCards.length;
    const excluded = new Set(sel.excludedShots);
    const imageText = promptsText(plan, 'image', excluded);
    const videoText = promptsText(plan, 'video', excluded);
    const shotCount = imageText ? imageText.split('\n').length : 0;

    updateActiveProject((proj) => {
      let next = proj;
      if (newCards.length) next = { ...next, characters: [...next.characters, ...newCards] };
      if (sel.includeImagePrompts && imageText) {
        const parsed = mergeShotOutputs(parsePromptsFromRawText(imageText, 'image'), next.imagePrompts.parsedItems);
        next = { ...next, imagePrompts: { ...next.imagePrompts, rawText: imageText, filename: 'ai_story_image_prompts.txt', savedAt: now, locked: false, lockedAt: undefined, parsedItems: parsed } };
      }
      if (sel.includeVideoPrompts && videoText) {
        const parsed = mergeShotOutputs(parsePromptsFromRawText(videoText, 'video', next.imagePrompts.parsedItems), next.videoPrompts.parsedItems);
        next = { ...next, videoPrompts: { ...next.videoPrompts, rawText: videoText, filename: 'ai_story_video_prompts.txt', savedAt: now, locked: false, lockedAt: undefined, parsedItems: parsed } };
      }
      return withHistory(next, `Saved AI story analysis as materials (${newCards.length} character(s), ${shotCount} shot(s))`, now);
    });

    return [
      `Saved as project materials (all stay UNLOCKED; nothing was generated):`,
      `• Characters added: ${newCards.length}${skipped > 0 ? ` (${skipped} already existed and were not changed)` : ''} — they are incomplete until a Face image is saved.`,
      sel.includeImagePrompts ? `• Image Prompts: ${shotCount} shot(s) saved.` : '• Image Prompts are LOCKED — not changed. Unlock them and save again to apply.',
      sel.includeVideoPrompts ? `• Video Prompts: ${shotCount} shot(s) saved, linked to the image prompts by Scene/Shot ID.` : '• Video Prompts are LOCKED — not changed.',
      'Next: add the characters’ reference images, review, then Lock and start production yourself.',
    ].join('\n');
  };

  // ---------- 2. Character Information ----------
  const handleSaveCharacterInfo = (card: CharacterCard) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) => {
      const exists = proj.characters.some((c) => c.id === card.id);
      const characters = exists
        ? proj.characters.map((c) =>
            c.id === card.id
              ? { ...c, nameAndDetails: card.nameAndDetails, infoFilename: card.infoFilename, savedAt: now, locked: false, lockedAt: undefined }
              : c
          )
        : [...proj.characters, { ...card, savedAt: now, locked: false, lockedAt: undefined }];
      return withHistory({ ...proj, characters }, `Saved character "${card.nameAndDetails.split('\n')[0].slice(0, 40)}"`, now);
    });
  };

  const handleToggleCharacterLock = (characterId: string, nextLocked: boolean) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) => ({
      ...proj,
      characters: proj.characters.map((c) =>
        c.id === characterId ? { ...c, locked: nextLocked, lockedAt: nextLocked ? now : undefined } : c
      ),
    }));
  };

  const handleDeleteCharacter = (characterId: string) =>
    updateActiveProject((proj) =>
      withHistory({ ...proj, characters: proj.characters.filter((c) => c.id !== characterId) }, 'Deleted a character')
    );

  // ---------- 3. Character Reference Images ----------
  const handleSaveCharacterSlot = (characterId: string, slotKey: CharacterRefSlotKey, savedSlot: CharacterRefSlot) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) =>
      withHistory(
        {
          ...proj,
          characters: proj.characters.map((c) =>
            c.id === characterId
              ? { ...c, references: { ...c.references, [slotKey]: { ...savedSlot, savedAt: now, locked: false, lockedAt: undefined } } }
              : c
          ),
        },
        `Saved ${slotKey} reference image (unlocked)`,
        now
      )
    );
  };

  const handleToggleCharacterSlotLock = (characterId: string, slotKey: CharacterRefSlotKey, nextLocked: boolean) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) => ({
      ...proj,
      characters: proj.characters.map((c) =>
        c.id === characterId
          ? {
              ...c,
              references: {
                ...c.references,
                [slotKey]: { ...c.references[slotKey], locked: nextLocked, lockedAt: nextLocked ? now : undefined },
              },
            }
          : c
      ),
    }));
  };

  // ---------- 6. Production settings ----------
  const handleSaveProductionSettings = (nextSettings: ProductionSettings) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) => ({ ...proj, productionSettings: { ...nextSettings, savedAt: now, locked: false, lockedAt: undefined } }));
  };

  // ---------- 7 / 8. Generated outputs ----------
  const handleSaveOutputs = (kind: ShotKind) => {
    const now = new Date().toISOString();
    updateActiveProject((proj) => {
      const field = kind === 'image' ? 'generatedImagesSection' : 'generatedVideosSection';
      const items = kind === 'image' ? proj.imagePrompts.parsedItems : proj.videoPrompts.parsedItems;
      return withHistory(
        { ...proj, [field]: { ...proj[field], savedAt: now, savedSelection: currentSelection(items), locked: false, lockedAt: undefined } },
        `Saved ${kind === 'image' ? 'Generated Images' : 'Generated Videos'} selection`,
        now
      );
    });
  };

  const handleUploadOutput = (kind: ShotKind, key: string, url: string, filename: string) =>
    patchShot(activeProject.id, kind, key, (item) => addVersion(item, url, 'uploaded', filename));

  const handleSelectCandidate = (kind: ShotKind, key: string, candidateId: string) =>
    patchShot(activeProject.id, kind, key, (item) => selectVersion(item, candidateId));

  const handleRemoveCandidate = (kind: ShotKind, key: string, candidateId: string) =>
    patchShot(activeProject.id, kind, key, (item) => removeVersion(item, candidateId));

  /** Brings back videos that the server finished but this browser never received. Manual and explicit. */
  const recoverServerVideos = async (): Promise<string> => {
    const proj = activeProject;
    const res = await phase2CloudServices.videoGen.listJobs(cloudSettings, proj.id);
    if (!res.ok || !res.data) return `Could not ask the server for jobs: ${res.error || 'unknown error'}`;
    const found = findRecoverableJobs(proj, res.data.jobs);
    if (found.length === 0) return 'Nothing to recover: every finished video of the server is already in this project.';
    updateProject(proj.id, (p) => applyRecoveredJobs(p, findRecoverableJobs(p, res.data!.jobs)));
    return `Recovered ${found.length} finished video(s) from the server as new versions.`;
  };

  const cancelShotVideo = async (key: string) => {
    const item = activeProject.videoPrompts.parsedItems.find((v) => shotKey(v) === key);
    if (!item?.backendJobId) return;
    // The watcher of this shot sees status "cancelled" from the server and marks the shot accordingly.
    await phase2CloudServices.videoGen.cancelVideoJob(cloudSettings, item.backendJobId);
  };

  const watchVideo = async (projectId: string, key: string, jobId: string, cloud: CloudBackendSettings) => {
    const res = await waitForVideoJob(cloud, jobId, () => cancelRef.current);
    if (res.ok) {
      patchShot(projectId, 'video', key, (item) => addVersion(item, res.url, 'cloud_generated', undefined, jobId));
      return true;
    }
    patchShot(projectId, 'video', key, (item) => ({
      ...item,
      status: res.stillRunning ? 'generating' : 'failed',
      errorMessage: res.error,
      backendJobId: res.stillRunning ? jobId : undefined,
    }));
    return false;
  };

  const runGeneration = async (kind: ShotKind, keys: string[]) => {
    if (run) return;
    const projectId = activeProject.id;
    const cloud = cloudSettings;
    const qty = kind === 'image' ? activeProject.productionSettings.imageQuantity : activeProject.productionSettings.videoQuantity;
    const tasks = keys.flatMap((key) => Array.from({ length: qty }, () => key));
    cancelRef.current = false;
    setRun({ kind, total: tasks.length, done: 0, failed: 0, cancelRequested: false });

    await runPool(
      tasks,
      activeProject.productionSettings.generationOrder,
      async (key) => {
        const proj = projectsRef.current.find((p) => p.id === projectId);
        const item = proj && (kind === 'image' ? proj.imagePrompts : proj.videoPrompts).parsedItems.find((i) => shotKey(i) === key);
        if (!proj || !item) return;
        patchShot(projectId, kind, key, (i) => ({ ...i, status: 'generating', errorMessage: undefined }));
        let ok = false;
        let error = '';
        if (kind === 'image') {
          const res = await generateShotImage(proj, cloud, item);
          if (res.ok) {
            patchShot(projectId, 'image', key, (i) => addVersion(i, res.url, 'cloud_generated'));
            ok = true;
          } else {
            error = res.error;
          }
        } else {
          const started = await startShotVideo(proj, cloud, item);
          if (started.ok) {
            patchShot(projectId, 'video', key, (i) => ({ ...i, backendJobId: started.jobId, lastJobId: started.jobId }));
            ok = await watchVideo(projectId, key, started.jobId, cloud);
            if (!ok) error = 'see shot';
          } else {
            error = started.error;
          }
        }
        if (!ok && error && error !== 'see shot') {
          patchShot(projectId, kind, key, (i) => ({ ...i, status: i.generatedUrl ? 'completed' : 'failed', errorMessage: error }));
        }
        logJob(projectId, {
          kind,
          sceneId: item.sceneId,
          shotId: item.shotId,
          status: ok ? 'completed' : 'failed',
          progressPercent: ok ? 100 : 0,
          errorMessage: ok ? undefined : error === 'see shot' ? 'Video job failed or was stopped' : error,
        });
        setRun((r) => (r ? { ...r, done: r.done + (ok ? 1 : 0), failed: r.failed + (ok ? 0 : 1) } : r));
      },
      () => cancelRef.current
    );

    updateProject(projectId, (p) => withHistory(p, `${kind === 'image' ? 'Image' : 'Video'} generation run finished (${tasks.length} request(s))`));
    setRun(null);
  };

  // Resume watching video jobs that were running when the page was closed.
  useEffect(() => {
    if (!hydrated || resumedRef.current || cloudSettings.status !== 'connected') return;
    resumedRef.current = true;
    for (const proj of projects) {
      for (const v of proj.videoPrompts.parsedItems) {
        if (v.status === 'generating' && v.backendJobId) void watchVideo(proj.id, shotKey(v), v.backendJobId, cloudSettings);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, cloudSettings.status]);

  // ---------- Main Chat ----------
  const handleSendAllToMainChat = () => {
    const now = new Date().toISOString();
    const bundle = buildMaterialsBundle(activeProject);
    updateActiveProject((proj) =>
      withHistory(
        {
          ...proj,
          lastBundleSentAt: now,
          chatMessages: [
            ...proj.chatMessages,
            { id: createId('msg'), role: 'user', text: bundle.userSummaryText, timestamp: now, isMaterialBundle: true, bundleText: bundle.bundleText },
            { id: createId('msg'), role: 'assistant', text: bundle.aiAnalysisText, timestamp: now, responseMode: 'local_mode', actionHint: bundle.actionHint },
          ],
        },
        'Sent all saved materials to Main Chat',
        now
      )
    );
    setScreen('chat');
  };

  const handleSendChatMessage = async (
    text: string,
    attachments: ChatAttachment[],
    uploadedTexts: Array<{ filename: string; content: string }>
  ) => {
    const now = new Date().toISOString();
    const targetProjectId = activeProject.id;
    const displayText = text || `Uploaded ${attachments.map((a) => a.name).join(', ')}`;
    const aiReady = cloudSettings.status === 'connected' && cloudSettings.geminiConfigured !== false;

    if (uploadedTexts.length > 0 || !aiReady) {
      updateActiveProject((proj) => {
        const interpreted = interpretMainChatMessage(proj, displayText, cloudSettings, uploadedTexts);
        return {
          ...interpreted.updatedProject,
          chatMessages: [
            ...interpreted.updatedProject.chatMessages,
            { id: createId('msg'), role: 'user', text: displayText, timestamp: now, attachments: attachments.length ? attachments : undefined },
            { id: createId('msg'), role: 'assistant', text: interpreted.replyText, timestamp: now, responseMode: 'local_mode', actionHint: interpreted.actionHint },
          ],
        };
      });
      return;
    }

    const snapshotProject = activeProject;
    updateActiveProject((proj) => ({
      ...proj,
      chatMessages: [
        ...proj.chatMessages,
        { id: createId('msg'), role: 'user', text: displayText, timestamp: now, attachments: attachments.length ? attachments : undefined },
      ],
    }));
    setIsSendingChat(true);
    try {
      const cloudReply = await phase2CloudServices.chat.sendProjectChatTurn(cloudSettings, snapshotProject, displayText, snapshotProject.chatMessages);
      const replyNow = new Date().toISOString();
      updateProject(targetProjectId, (p) => {
        if (cloudReply.ok && cloudReply.data?.replyText) {
          return {
            ...p,
            chatMessages: [...p.chatMessages, { id: createId('msg'), role: 'assistant', text: cloudReply.data.replyText, timestamp: replyNow, responseMode: 'cloud_gemini' }],
          };
        }
        const local = interpretMainChatMessage(p, displayText, cloudSettings, []);
        return {
          ...local.updatedProject,
          chatMessages: [
            ...p.chatMessages,
            {
              id: createId('msg'),
              role: 'assistant',
              timestamp: replyNow,
              responseMode: 'local_mode',
              text: `[Gemini chat ${cloudReply.notImplemented ? 'not implemented' : 'failed'}: ${cloudReply.error || 'Unknown error'}]\n\nLocal mode reply:\n${local.replyText}`,
              actionHint: 'open_cloud',
            },
          ],
        };
      });
    } finally {
      setIsSendingChat(false);
    }
  };

  // ---------- Projects ----------
  // ---------- Optional Cloud Sync (Firestore + Cloud Storage). Local IndexedDB save is unaffected. ----------
  useEffect(() => {
    if (!hydrated || cloudSettings.status !== 'connected' || cloudSettings.authMode !== 'google') {
      setCloudUser(null);
      return;
    }
    void cloudAuth.me(cloudSettings).then((r) => setCloudUser(r.ok ? r.data.user : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, cloudSettings.status, cloudSettings.authMode, cloudSettings.backendUrl]);

  const handleSaveActiveToCloud = async (): Promise<string> => {
    const snapshot = activeProject;
    setCloudSyncStatus({ status: 'syncing', lastAction: 'update' });
    // Images/videos go to Cloud Storage first (one by one); the project JSON that follows is small.
    const media = await uploadProjectMedia(cloudSettings, snapshot);
    if (!media.ok) {
      setCloudSyncStatus({ status: 'error', lastError: media.error, lastAction: 'media_upload' });
      if (media.signInRequired) setCloudUser(null);
      return `Cloud save failed: ${media.error} Nothing was changed in the cloud.`;
    }
    const outgoing = media.project;

    // 1) normal save: update when this device already knows a cloud revision, otherwise create
    let res =
      snapshot.cloudRevision === undefined
        ? await cloudProjects.create(cloudSettings, outgoing)
        : await cloudProjects.update(cloudSettings, outgoing, snapshot.cloudRevision);
    let note = '';

    // 2) the cloud copy was deleted elsewhere: save it again as a new cloud copy (nothing is overwritten)
    if (!res.ok && res.status === 404 && snapshot.cloudRevision !== undefined) {
      res = await cloudProjects.create(cloudSettings, outgoing);
      note = ' The old cloud copy had been deleted, so this is a new cloud copy.';
    }

    // 3) conflict: the cloud copy changed. Nothing was overwritten. Ask, then retry based on the cloud's current revision.
    if (!res.ok && res.status === 409 && res.code === 'revision_conflict' && res.cloudRevision !== undefined) {
      const when = res.cloudUpdatedAt ? new Date(res.cloudUpdatedAt).toLocaleString() : 'unknown time';
      const overwrite = window.confirm(
        `The cloud copy of "${snapshot.title}" was changed elsewhere (cloud revision ${res.cloudRevision}, last saved ${when}). Nothing has been overwritten yet.\n\n` +
          `OK = replace the cloud copy with this device's version.\nCancel = keep the cloud copy (you can Load it; this device's copy stays as it is).`
      );
      if (!overwrite) {
        setCloudSyncStatus({ status: 'error', lastError: 'Cloud copy is newer — not overwritten.', lastAction: 'update' });
        return 'Not saved: the cloud copy is newer, so nothing was overwritten. Use Load to get it, or save again and choose to replace it. This device keeps its own copy.';
      }
      // "Replace" = update based on the revision the user was just shown. If the cloud changed again meanwhile, this conflicts again.
      res = await cloudProjects.update(cloudSettings, outgoing, res.cloudRevision);
    }

    if (!res.ok) {
      setCloudSyncStatus({ status: 'error', lastError: res.error, lastAction: 'update' });
      if (res.signInRequired) setCloudUser(null);
      return res.status === 409
        ? `Not saved: ${res.error} Your data on this device is unchanged.`
        : `Cloud save failed: ${res.error}`;
    }
    const { meta, project: stored } = res.data;
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== snapshot.id) return p;
        // If nothing changed locally during the upload, adopt the stored copy
        // (its images now point to Cloud Storage, which also frees browser space).
        const base = p.updatedAt === snapshot.updatedAt ? normalizeProject({ ...stored, updatedAt: p.updatedAt } as MovieProject) : p;
        return { ...base, cloudRevision: meta.revision, cloudSyncedAt: meta.updatedAt };
      })
    );
    setCloudSyncStatus({ status: 'synced', lastSyncedAt: meta.updatedAt, lastAction: 'update' });
    return `Saved to cloud (revision ${meta.revision}).${note}`;
  };

  const handleLoadFromCloud = async (id: string): Promise<string> => {
    const res = await cloudProjects.get(cloudSettings, id);
    if (!res.ok) return `Could not load from cloud: ${res.error}`;
    const local = projects.find((p) => p.id === id);
    if (local && !window.confirm(`Replace "${local.title}" on this device with the cloud copy (revision ${res.data.meta.revision})?`)) {
      return 'Load cancelled — this device’s copy was kept.';
    }
    const loaded: MovieProject = {
      ...normalizeProject(res.data.project),
      cloudRevision: res.data.meta.revision,
      cloudSyncedAt: res.data.meta.updatedAt,
    };
    setProjects((prev) => (local ? prev.map((p) => (p.id === id ? loaded : p)) : [loaded, ...prev]));
    setActiveProjectId(id);
    return `Loaded "${loaded.title}" from the cloud. It is now saved on this device too.`;
  };

  const handleDeleteFromCloud = async (id: string): Promise<string> => {
    const res = await cloudProjects.remove(cloudSettings, id);
    if (!res.ok) return `Cloud delete failed: ${res.error}`;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, cloudRevision: undefined, cloudSyncedAt: undefined } : p)));
    return 'Deleted from the cloud (Firestore document and its Cloud Storage files). The copy on this device was kept.';
  };

  const openProject = (id: string) => {
    setActiveProjectId(id);
    setScreen('chat');
  };

  const handleCreateProject = (title: string, settings: Partial<ProductionSettings>) => {
    const created = createBlankProject(title, settings);
    setProjects((prev) => [created, ...prev]);
    openProject(created.id);
  };

  const handleLoadDemoProject = () => {
    const existingDemo = projects.find((p) => p.isDemo);
    if (existingDemo) return openProject(existingDemo.id);
    const demo = createSampleProject();
    setProjects((prev) => [...prev, demo]);
    openProject(demo.id);
  };

  const handleImportZipProject = (imported: MovieProject) => {
    setProjects((prev) => [imported, ...prev]);
    openProject(imported.id);
  };

  const handleDuplicateProject = (projectId: string) => {
    const source = projects.find((p) => p.id === projectId);
    if (!source) return;
    const now = new Date().toISOString();
    const unlock = <T extends { locked?: boolean; lockedAt?: string }>(x: T): T => ({ ...x, locked: false, lockedAt: undefined });
    const copy: MovieProject = {
      ...source,
      id: createId('proj'),
      isDemo: false,
      title: `${source.title} (Copy)`,
      createdAt: now,
      updatedAt: now,
      projectLocked: false,
      projectLockedAt: undefined,
      story: unlock(source.story),
      characters: source.characters.map((c) => ({
        ...unlock(c),
        references: { face: unlock(c.references.face), front: unlock(c.references.front), side: unlock(c.references.side), back: unlock(c.references.back) },
      })),
      imagePrompts: unlock(source.imagePrompts),
      videoPrompts: unlock(source.videoPrompts),
      productionSettings: unlock(source.productionSettings),
      generatedImagesSection: unlock(source.generatedImagesSection),
      generatedVideosSection: unlock(source.generatedVideosSection),
    };
    setProjects((prev) => [copy, ...prev]);
    openProject(copy.id);
  };

  const handleDeleteProject = (projectId: string) => {
    if (projects.length <= 1) return;
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    if (activeProjectId === projectId || activeProject.id === projectId) setActiveProjectId(remaining[0].id);
  };

  const openSection = (key: MaterialSectionKey | 'materials_hub' | 'cloud_settings') => setScreen(key);

  const storageAlert = storageStatus.error || storageStatus.quotaWarning;
  const outputScreenProps = (kind: ShotKind) => ({
    kind,
    project: activeProject,
    cloudSettings,
    run,
    onGenerate: (keys: string[]) => void runGeneration(kind, keys),
    onCancelRun: () => {
      cancelRef.current = true;
      setRun((r) => (r ? { ...r, cancelRequested: true } : r));
    },
    onUpload: (key: string, url: string, filename: string) => handleUploadOutput(kind, key, url, filename),
    onSelectCandidate: (key: string, id: string) => handleSelectCandidate(kind, key, id),
    onRemoveCandidate: (key: string, id: string) => handleRemoveCandidate(kind, key, id),
    onCancelJob: (key: string) => void cancelShotVideo(key),
    onRecoverJobs: recoverServerVideos,
    onSave: () => handleSaveOutputs(kind),
    onToggleLock: toggleSectionLock(kind === 'image' ? 'generatedImagesSection' : 'generatedVideosSection'),
    onBack: goHub,
    onOpenSection: openSection,
  });

  return (
    <div className="min-h-screen bg-[#07080B] text-slate-100 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]">
      {storageAlert && !storageAlertDismissed && (
        <div
          role="alert"
          className={`px-4 py-2.5 text-xs flex items-center justify-between gap-3 border-b ${
            storageStatus.error ? 'bg-rose-500/15 border-rose-500/40 text-rose-200' : 'bg-amber-500/15 border-amber-500/35 text-amber-200'
          }`}
        >
          <span>{storageAlert}</span>
          <button type="button" onClick={() => setStorageAlertDismissed(true)} className="underline shrink-0 font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {screen === 'chat' && (
        <MainWorkspaceScreen
          project={activeProject}
          cloudSettings={cloudSettings}
          cloudSyncStatus={cloudSyncStatus}
          isSendingChat={isSendingChat}
          run={run}
          onNavigate={setScreen}
          onPickZipFile={(f) => void inspectAndParseProjectZip(f).then(setZipInspection)}
          onSendMessage={(t, a, u) => void handleSendChatMessage(t, a, u)}
        />
      )}

      {screen === 'materials_hub' && (
        <MaterialsHubScreen project={activeProject} onNavigate={openSection} onBack={() => setScreen('chat')} onSendAll={handleSendAllToMainChat} />
      )}

      {screen === 'story' && (
        <div className="px-3 sm:px-5 py-4">
          <SimpleTextModuleScreen
            key={`${activeProject.id}_story`}
            title="Story Master"
            bengaliTitle="১. সম্পূর্ণ গল্প"
            kind="story"
            acceptTypes=".txt,.json,.md"
            placeholder="Paste your complete story here or tap Upload File..."
            rawText={activeProject.story.rawText}
            filename={activeProject.story.filename}
            locked={activeProject.story.locked}
            savedAt={activeProject.story.savedAt}
            onSave={handleSaveStory}
            onToggleLock={toggleSectionLock('story')}
            onBack={goHub}
            onOpenAnalysis={() => setScreen('story_analysis')}
          />
        </div>
      )}

      {screen === 'story_analysis' && (
        <div className="px-3 sm:px-5 py-4">
          <StoryAnalysisScreen
            key={`${activeProject.id}_analysis`}
            project={activeProject}
            cloudSettings={cloudSettings}
            onAnalyze={handleAnalyzeStory}
            onUpdateDraft={handleUpdateDraft}
            onDiscardDraft={handleDiscardDraft}
            onApply={handleApplyPlan}
            buildInfoText={(name, plan) => characterInfoText(plan.characters.find((c) => c.name === name)!)}
            onNavigate={(to) => setScreen(to)}
          />
        </div>
      )}

      {screen === 'characters' && (
        <div className="px-3 sm:px-5 py-4">
          <CharacterInfoScreen
            key={`${activeProject.id}_characters`}
            characters={activeProject.characters}
            onSaveCharacterInfo={handleSaveCharacterInfo}
            onToggleCharacterLock={handleToggleCharacterLock}
            onDeleteCharacter={handleDeleteCharacter}
            onOpenReferences={(id) => {
              setRefsCharacterId(id);
              setScreen('character_refs');
            }}
            onBack={goHub}
          />
        </div>
      )}

      {screen === 'character_refs' && (
        <div className="px-3 sm:px-5 py-4">
          <CharacterReferencesScreen
            key={`${activeProject.id}_refs`}
            characters={activeProject.characters}
            initialCharacterId={refsCharacterId}
            cloudSettings={cloudSettings}
            onSaveCharacterSlot={handleSaveCharacterSlot}
            onToggleCharacterSlotLock={handleToggleCharacterSlotLock}
            onToggleCharacterLock={handleToggleCharacterLock}
            onOpenCharacterInfo={() => setScreen('characters')}
            onBack={goHub}
          />
        </div>
      )}

      {screen === 'image_prompts' && (
        <div className="px-3 sm:px-5 py-4">
          <SimpleTextModuleScreen
            key={`${activeProject.id}_img`}
            title="Image Prompts"
            bengaliTitle="৪. ছবির প্রম্পট · Scene ID / Shot ID"
            kind="image_prompts"
            acceptTypes=".txt,.json,.md"
            placeholder={'S01 | SH01 | Wide establishing shot...\nS01 | SH02 | Close-up of ...'}
            rawText={activeProject.imagePrompts.rawText}
            filename={activeProject.imagePrompts.filename}
            locked={activeProject.imagePrompts.locked}
            savedAt={activeProject.imagePrompts.savedAt}
            parsedItems={activeProject.imagePrompts.parsedItems}
            onSave={handleSaveImagePrompts}
            onToggleLock={toggleSectionLock('imagePrompts')}
            onBack={goHub}
          />
        </div>
      )}

      {screen === 'video_prompts' && (
        <div className="px-3 sm:px-5 py-4">
          <SimpleTextModuleScreen
            key={`${activeProject.id}_vid`}
            title="Video Prompts"
            bengaliTitle="৫. ভিডিও প্রম্পট · matched to shot images"
            kind="video_prompts"
            acceptTypes=".txt,.json,.md"
            placeholder={'S01 | SH01 | Slow crane descent...\nS01 | SH02 | Subtle push-in...'}
            rawText={activeProject.videoPrompts.rawText}
            filename={activeProject.videoPrompts.filename}
            locked={activeProject.videoPrompts.locked}
            savedAt={activeProject.videoPrompts.savedAt}
            parsedItems={activeProject.videoPrompts.parsedItems}
            linkedImages={activeProject.imagePrompts.parsedItems}
            onSave={handleSaveVideoPrompts}
            onToggleLock={toggleSectionLock('videoPrompts')}
            onBack={goHub}
          />
        </div>
      )}

      {screen === 'production_settings' && (
        <ProductionSettingsModal
          variant="page"
          open
          settings={activeProject.productionSettings}
          onSave={handleSaveProductionSettings}
          onToggleLock={toggleSectionLock('productionSettings')}
          onClose={goHub}
        />
      )}

      {screen === 'generated_images' && (
        <div className="px-3 sm:px-5 py-4">
          <ShotOutputsScreen {...outputScreenProps('image')} />
        </div>
      )}

      {screen === 'generated_videos' && (
        <div className="px-3 sm:px-5 py-4">
          <ShotOutputsScreen {...outputScreenProps('video')} />
        </div>
      )}

      {(screen === 'projects' || screen === 'cloud_settings') && (
        <ProjectsAndCloudScreen
          mode={screen}
          projects={projects}
          activeProject={activeProject}
          cloudSettings={cloudSettings}
          storageStatus={storageStatus}
          cloudSyncStatus={cloudSyncStatus}
          onChangeMode={(m) => setScreen(m)}
          onBackToChat={() => setScreen('chat')}
          onSelectProject={openProject}
          onCreateProject={handleCreateProject}
          onLoadDemoProject={handleLoadDemoProject}
          onImportZipProject={handleImportZipProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onSaveCloudSettings={(next) => {
            setCloudSettings(next);
            if (next.status !== 'connected') setCloudSyncStatus({ status: 'local_only' });
          }}
          cloudPanel={{
            cloudUser,
            localProjectIds: projects.map((p) => p.id),
            onSignedIn: setCloudUser,
            onSignedOut: () => setCloudUser(null),
            onSaveActiveToCloud: handleSaveActiveToCloud,
            onLoadFromCloud: handleLoadFromCloud,
            onDeleteFromCloud: handleDeleteFromCloud,
          }}
          onUpdateBudgetLimit={(budgetLimitUsd) =>
            updateActiveProject((proj) => ({ ...proj, costAndJobs: { ...proj.costAndJobs, budgetLimitUsd } }))
          }
          onClearJobLog={() => updateActiveProject((proj) => ({ ...proj, costAndJobs: { ...proj.costAndJobs, jobs: [] } }))}
        />
      )}

      <ZipImportPreviewModal
        inspection={zipInspection}
        onCancel={() => setZipInspection(null)}
        onConfirm={(imported) => {
          handleImportZipProject(imported);
          setZipInspection(null);
        }}
      />
    </div>
  );
}
