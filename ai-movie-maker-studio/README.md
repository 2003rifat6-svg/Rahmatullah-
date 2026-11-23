# AI Movie Maker Studio

Mobile-first AI film production studio. Story → Characters (Face / Front / Side / Back references) → Image Prompts → Video Prompts → Production Settings → **Step 1 images** → **Step 2 image-to-video** → ZIP export → FFmpeg movie. Optional **Cloud Sync** (Firestore + Cloud Storage) with **Sign in with Google**, durable video jobs, per-user quotas, automated story analysis (AI draft) and an installable **PWA**.

> সহজ বাংলা Deploy নির্দেশনা নিচে আছে ("Cloud Run-এ Deploy — ধাপে ধাপে")।

## Run locally

Node.js 22+ (and `ffmpeg` for movie assembly).

```bash
npm ci
cp .env.example .env          # optional: GEMINI_API_KEY (+ STUDIO_ACCESS_TOKEN) for real AI generation
npm start                     # builds and serves app + API on http://localhost:8787 (this computer only)
```

Dev mode with hot reload: `npm run server` (API :8787) + `npm run dev` (app :3000, proxies the API).
In the app: **Cloud ☁ → "Use this app's own server" → Test Backend Connection**.

Without sign-in configured, everything works locally (browser IndexedDB); Cloud Sync stays off. In this mode the server listens on `127.0.0.1` only, and a real `GEMINI_API_KEY` is refused unless `STUDIO_ACCESS_TOKEN` is set.

## Cloud Run-এ Deploy — ধাপে ধাপে (সহজ নির্দেশনা)

> ⚠️ **খরচ:** Cloud Run, Firestore, Cloud Storage, Cloud Build, Artifact Registry ও Secret Manager — সবগুলোর free tier আছে, কিন্তু Google Cloud Project-এ **Billing Account চালু থাকতেই হবে**। Gemini/Veo (ছবি/ভিডিও) আলাদা Paid API। নিচের ধাপগুলো আপনি নিজে চালাবেন; এই কোড নিজে থেকে কিছু Deploy বা চালু করে না।

1. **Google Cloud Project** তৈরি করুন: <https://console.cloud.google.com> → নতুন Project → Billing যুক্ত করুন।
2. **gcloud** ইনস্টল করে লগইন: `gcloud auth login`
3. **OAuth Client ID** (Sign in with Google-এর জন্য, ফ্রি): Console → *APIs & Services* → *OAuth consent screen* (External, নিজের ইমেইল) → *Credentials* → *Create credentials* → *OAuth client ID* → **Web application** → Client ID কপি করুন।
4. **Gemini API Key** (ঐচ্ছিক, Paid): <https://aistudio.google.com/apikey>
5. প্রজেক্ট ফোল্ডারে চালান (স্ক্রিপ্ট সব দেখিয়ে `YES` চাইবে, তারপর Key চাইবে):

   ```bash
   PROJECT_ID=your-project-id \
   REGION=asia-south1 \
   OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com \
   ALLOWED_EMAILS=you@gmail.com \
   bash deploy/deploy-cloudrun.sh
   ```

   স্ক্রিপ্ট যা করে: API চালু → Firestore (Native) → Private GCS Bucket → কম-অনুমতির Service Account → Secret Manager-এ `SESSION_SECRET` ও `GEMINI_API_KEY` → Dockerfile দিয়ে Build ও Deploy → Bucket CORS।
6. শেষে যে URL দেখাবে সেটি OAuth Client-এর **Authorized JavaScript origins**-এ যোগ করুন (ধাপ ৩-এর পেজে)।
7. URL খুলুন → Cloud ☁ → "Use this app's own server" → Test → **Sign in with Google** → "Save to Cloud"।

Firestore-এ ব্রাউজার থেকে সরাসরি প্রবেশ বন্ধ রাখতে (ঐচ্ছিক, প্রস্তাবিত): `deploy/firestore.rules` ফাইলটি Console → Firestore → Rules-এ বসান।

### Google Cloud IAM permissions

The Cloud Run service runs as its own service account (`movie-studio-run@PROJECT.iam.gserviceaccount.com`):

| Role | Where | Why |
|---|---|---|
| `roles/datastore.user` | project | read/write Firestore project documents |
| `roles/storage.objectAdmin` | the media bucket only | upload / read / delete images, videos, ZIPs, movies |
| `roles/secretmanager.secretAccessor` | secrets `SESSION_SECRET`, `GEMINI_API_KEY` | read secrets at start-up |
| `roles/iam.serviceAccountTokenCreator` | on the service account itself | only if `GCS_SIGNED_URLS=true` (sign V4 URLs for big files) |

The person running the deploy script needs (or Owner): `roles/run.admin`, `roles/iam.serviceAccountAdmin`, `roles/iam.serviceAccountUser`, `roles/resourcemanager.projectIamAdmin`, `roles/serviceusage.serviceUsageAdmin`, `roles/datastore.owner`, `roles/storage.admin`, `roles/secretmanager.admin`, `roles/cloudbuild.builds.editor`, `roles/artifactregistry.admin`.

APIs enabled by the script: `run`, `cloudbuild`, `artifactregistry`, `firestore`, `storage`, `secretmanager`, `iamcredentials`.

### Environment variables

| Variable | Required on Cloud Run | Meaning |
|---|---|---|
| `GCS_BUCKET` | **yes** | Cloud Storage bucket for all media (server refuses to start without it on Cloud Run) |
| `GOOGLE_OAUTH_CLIENT_ID` | **yes** | OAuth Web client id for Sign in with Google |
| `SESSION_SECRET` (secret) | **yes** | ≥ 32 random chars, signs the HttpOnly login cookie |
| `ALLOWED_EMAILS` | **yes** | comma-separated Google accounts allowed in. Empty / only commas / invalid addresses => the server **refuses to start**; the deploy script checks the same rules before any gcloud command |
| `FIRESTORE_ENABLED` | **yes** | `true`: projects, durable video jobs and usage counters live in Firestore |
| `GOOGLE_CLOUD_PROJECT` | recommended | GCP project id |
| `GEMINI_API_KEY` (secret) | no | empty = AI generation disabled (paid API) |
| `QUOTA_CHAT_PER_MIN` / `_PER_DAY` | no | per user (defaults 20 / 300) |
| `QUOTA_IMAGE_PER_MIN` / `_PER_DAY` | no | per user (defaults 30 / 400) |
| `QUOTA_VIDEO_PER_MIN` / `_PER_DAY` | no | per user, Veo (defaults 4 / 40) |
| `QUOTA_STORY_PER_MIN` / `_PER_DAY` | no | per user, story analysis (defaults 3 / 30) |
| `QUOTA_PROJECT_IMAGE_PER_DAY` / `QUOTA_PROJECT_VIDEO_PER_DAY` | no | per project (defaults 200 / 20) |
| `CORS_ORIGINS` | no | exact origins allowed to call the API from another website, e.g. `https://app.example.com`. Default: none (same site only). No wildcards. |
| `GCS_SIGNED_URLS` | no | `true` = big uploads/downloads go directly to GCS (files are re-checked after upload) |
| `JOB_QUEUE` | no | only `inline` is implemented (see `server/queue.ts` for the Cloud Tasks / Pub/Sub adapter interface) |
| `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL` / `GEMINI_VIDEO_MODEL` | no | model overrides |
| `FIRESTORE_DATABASE_ID`, `FFMPEG_PATH` | no | special setups |
| `PORT` | set by Cloud Run | listen port |
| `HOST`, `MEDIA_DIR`, `STUDIO_ACCESS_TOKEN` | no | local development only |

Deploy script settings (not server variables): `PROJECT_ID`, `OAUTH_CLIENT_ID`, `ALLOWED_EMAILS`, `REGION`, `SERVICE`, `BUCKET`, `SA_NAME`, `SIGNED_URLS`, `MAX_INSTANCES` (1–20, default 3). All are validated before the first gcloud command.

## Security model

- **Sign in with Google** → the server verifies the Google ID token (`google-auth-library`) and sets an **HttpOnly, SameSite=Lax** session cookie (**always `Secure` in production**). The account must be in `ALLOWED_EMAILS`; removing an address ends its sessions immediately.
- The user id is the Google account's `sub`, taken **only** from the verified token. All data lives under `users/<uid>/…` (Firestore + GCS); every request checks that prefix. User ids sent by a client are ignored.
- **Headers/CSP** on every response (strict Content-Security-Policy: no inline/eval scripts, only Google sign-in as external script, frames denied, `nosniff`, no-referrer, HSTS on https). **CORS**: exact origins only (`CORS_ORIGINS`). **CSRF**: writes need `X-Requested-With` and a same-site/allowed `Origin`.
- **Quotas & rate limits are durable** (Firestore counters, shared by all instances, survive restarts): per user per minute/day for chat, images, videos (Veo) and story analysis, plus per project per day. Over the limit → HTTP 429 with `Retry-After`. Invalid requests and duplicate video requests use no quota. (Fixed windows can allow a short burst around a window boundary; minute + day limits together bound the spend.) Sign-in attempts are also limited per address (per instance).
- **Input validation** for prompts, ids, enums, sizes (per-route body limits) and images (PNG/JPEG/WebP by file signature). **Uploads**: allowed types per folder, size caps, magic-byte check, direct (signed-URL) uploads are verified afterwards and deleted if invalid; files are served inline only if image/video, everything else as a download.
- Secrets (API key, tokens, cookies) are redacted from logs and error answers. Keys live only in Secret Manager / environment, never in the frontend or the ZIP.
- Nothing important is written to the container disk: videos and movies go to GCS; FFmpeg's temporary folder is deleted after each export.

## Local save vs Cloud Sync

- The browser (IndexedDB) is always the main save — also offline and without sign-in. **Images and videos are kept in a separate IndexedDB store**; the project record holds only small references. **Every generated or uploaded version is kept** (no limit); nothing is deleted automatically. The Cloud ☁ screen shows storage use and offers “Clean unused local files”, which deletes only files no project uses, after confirmation. A warning appears when browser storage is 80% full.
- Cloud Sync is **manual and optional**: *Save to Cloud* / *Load* / *Delete from cloud*. Media is uploaded to Cloud Storage first, then the small project JSON is saved.
- Every cloud project has a **revision**. An update **must** state the revision it is based on (`baseRevision`, otherwise 400). If the cloud copy is newer you get a conflict (409) with the cloud revision and time; nothing is overwritten. “Replace” re-sends based on the revision you were shown, so a newer change in between conflicts again. Updates never create a project.
- Large projects (> 800 KB) store their body as a new GCS object per save (never overwritten); the previous one is removed only after the Firestore commit; a SHA-256 checksum is verified on every read.
- Delete is two-phase (mark `deleting` → remove files → remove document). While deleting, the project is hidden and cannot be saved; an interrupted delete is resumed automatically (when projects are listed) or by repeating Delete.

## Video jobs

Video generation is a durable job in Firestore (`users/<uid>/jobs/<id>`): job id, project, user, Scene/Shot mapping, status (`queued` / `running` / `completed` / `failed` / `cancelled`), provider operation name, result, error. A restarted or different server instance continues the job from the stored operation name. The browser sends an **idempotency key**; the same key — or a second request for a shot that already has an active job — returns the existing job and never starts a second paid generation. A poll lease prevents two instances from polling/saving the same job. Failed shots can be retried (new job linked by `retryOf`); running jobs can be cancelled (the provider cannot stop a request it already accepted, so that may still be billed; the result is discarded). “Check the server for finished videos” brings back results the browser never received. Progress shown is always the real job status.

## AI story analysis (draft)

Story Master → **AI Story Analysis**: analysis → characters → scenes → shots → image & video prompts (3+ text requests, 1 story-analysis quota). The JSON of every step is validated and, if invalid, sent back to the model for repair (max 2 per step). Scene/Shot ids (`S01`, `SH01`), one image + one video prompt per shot, and each character's fixed description inside every prompt are enforced in code. The result is an editable **draft** kept across reloads; it becomes project materials only when you press *Save as Project Materials* (locked sections are not touched), and it never starts image/video generation.

## PWA

Installable (manifest + icons + service worker), opens offline with all data already on the device, with an offline fallback page. The service worker never caches `/api`, `/media` or `/health`. Safe-area insets are handled; on iPhone Home Screen apps downloads use the share sheet (not tested on a real iPhone).

## Where things live

| Part | Files |
|---|---|
| Main Chat | `src/components/MainWorkspaceScreen.tsx` |
| Project Materials Hub (8 sections + **Send All**) | `src/components/MaterialsHubScreen.tsx`, `src/utils/sections.ts` |
| Story / prompts text sections | `src/components/SimpleTextModuleScreen.tsx` |
| AI Story Analysis | `src/components/StoryAnalysisScreen.tsx`, `server/storyPipeline.ts`, `src/utils/storyPlan.ts` |
| Characters, references, settings | `CharacterInfoScreen.tsx`, `CharacterReferencesScreen.tsx`, `ProductionSettingsModal.tsx` |
| Generated images/videos, versions | `src/components/ShotOutputsScreen.tsx`, `src/utils/versions.ts`, `src/utils/mediaStore.ts`, `src/services/productionRunner.ts` |
| Local persistence | `src/utils/storage.ts`, `src/utils/mediaStore.ts` |
| Cloud Sync UI/client | `CloudSyncPanel.tsx`, `src/services/cloudSync.ts` |
| API routes & checks | `server/app.ts`, `server/validators.ts`, `server/uploads.ts`, `server/security.ts` |
| Auth | `server/auth.ts` |
| Projects (Firestore) | `server/projectStore.ts` |
| Files (GCS / local dev) | `server/blobStore.ts` |
| Video jobs | `server/jobStore.ts`, `server/videoJobs.ts`, `server/queue.ts` |
| Quotas | `server/usage.ts` |
| Config (fails closed) | `server/config.ts`, `server/shared/config-rules.mjs` |
| Gemini / Veo provider | `server/provider.ts` |
| Deploy | `Dockerfile`, `deploy/deploy-cloudrun.sh`, `deploy/validate-config.mjs`, `deploy/cors.json`, `deploy/firestore.rules` |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`, `public/icons/` |

## Rules the app follows

- Every section opens **UNLOCKED**. **Save** never locks. Lock needs a clean Save first; Unlock re-enables everything.
- **Back** returns to Project Materials; nothing is ever sent to Main Chat by a section.
- A character is complete when its information AND a Face image are saved; incomplete characters never go to chat or generation.
- Only **Send All Materials to Main Chat** sends materials (saved content only, as one bundle).
- Images (Step 1) and videos (Step 2) are separate steps, each confirmed before any paid request.
- No fake AI output or progress: without backend/key the buttons explain why they are off; uploads are marked “Uploaded”.

## Backend API

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | status: Gemini, FFmpeg, auth mode, Cloud Sync, storage |
| POST | `/api/auth/session` · GET `/api/auth/me` · POST `/api/auth/logout` | Google ID token → session cookie |
| GET / POST | `/api/projects` | list / create (409 if it exists) |
| GET / PUT / DELETE | `/api/projects/:id` | load / update (**`baseRevision` required**, 409 on conflict) / delete (two-phase) |
| GET | `/api/storage/files?projectId=` | list files |
| POST | `/api/storage/upload-url` · `/api/storage/upload-complete` | prepare an upload (type/size checked) · verify a direct upload |
| PUT | `/api/storage/upload/<key>` | upload through the server (≤ 30 MB, signature checked) |
| GET / DELETE | `/api/media/<key>` · `/api/storage/files/<key>` | download (Range) / delete, owner only |
| POST | `/api/chat`, `/api/generate-character-ref`, `/api/generate/shot-image`, `/api/story/analyze` | AI (503 without key, 429 over quota) |
| POST | `/api/generate/shot-video` | start a durable job (`idempotencyKey` required) |
| GET / POST | `/api/generate/video-status/:id` · `/api/generate/video-cancel/:id` · GET `/api/generate/jobs?projectId=` | job status / cancel / list |
| POST | `/api/export/mp4` | FFmpeg join of your stored clips → saved to GCS |

## Tests

```bash
npm ci
npm run verify          # runs everything below and prints PASS / FAIL / SKIPPED (a skipped step is never "passed")
```

Or one by one: `npm run lint` · `npm run test:unit` (unit, security, deployment guard, PWA files, story pipeline, versions) · `npm run emulators:setup` once, then `npm run test:integration` (real Firestore + GCS client libraries on the official emulators: revision conflicts, concurrency, delete recovery, jobs, quotas) · `npm run build` · `npm run test:e2e`, `npm run test:e2e:cloud`, `npm run test:e2e:pwa` (phone-size Chromium; needs `npx playwright install chromium` once).

The stub AI provider, scripted story AI and test sign-in verifier live only in `test/`; the real server never uses them.

## Known limits

- **Not tested against a real Google Cloud project, real Google sign-in, real Gemini or Veo** (no project, billing or API key was used). Firestore and GCS were tested with the official emulators through the real Google client libraries. The Veo operation lookup by name follows the SDK source but was not run against the live API. Signed-URL uploads/downloads and bucket CORS only work on real Cloud Storage.
- The Docker image was not built here (no Docker daemon); its build and run steps were run by hand.
- Job progress advances while a browser polls (`JOB_QUEUE=inline`). Jobs are durable, but a result is only saved when something polls; a real background queue needs the adapter in `server/queue.ts` (Cloud Tasks / Pub/Sub, not implemented).
- Quotas are per user/project; a user could use many project ids, so the per-user limits are the hard cap. The sign-in limiter is per instance.
- Not designed for thousands of concurrent users: FFmpeg runs inside the web service (1 CPU/1 GB), Gemini/Veo quotas and cost are shared, and no load test was done.
- Cloud Sync sends one request per media file (≤ 30 MB each; larger files need `GCS_SIGNED_URLS=true`).
- Veo accepts only 16:9 and 9:16. iPhone Home-Screen download behaviour is untested.

## বাংলা সারাংশ

- **চালানো:** `npm install` → `.env`-এ `GEMINI_API_KEY` (শুধু আসল AI চাইলে) → `npm start` → অ্যাপে Cloud → "Use this app's own server" → Test।
- প্রতিটি Section প্রথমবার **Unlocked**। **Save** করলে Lock হয় না। Lock/Unlock আলাদা বোতাম। Unlock করলে সব লেখা, Upload, Generate আবার চালু হয়।
- **Back** সবসময় Project Materials-এ ফেরে; কোনো Section নিজে থেকে Main Chat-এ কিছু পাঠায় না।
- অসংখ্য Character; নতুন Character শুধু **Save Character** চাপলে Project-এ যায়। প্রতিটির Face, Front Body, Side Body, Back Body — Upload বা AI Generate।
- সব কাজ শেষে Project Materials-এ **Send All Materials to Main Chat** — শুধু Save করা উপকরণ একটি Bundle হিসেবে যায়, অসম্পূর্ণ Character যায় না।
- Step 1-এ ছবি, Step 2-এ সেই ছবি থেকে ভিডিও। ছবি ও ভিডিও আলাদাভাবে Download ও ZIP, আর FFmpeg দিয়ে পুরো Movie MP4।
- API Key শুধু Server-এ। প্রতিটি Paid Generation-এর আগে নিশ্চিত করতে বলে। Backend না থাকলে ভুয়া কিছু দেখায় না।
- **Cloud Sync (ঐচ্ছিক):** Sign in with Google → Firestore-এ Project, Cloud Storage-এ ছবি/ভিডিও/ZIP। প্রত্যেক ব্যবহারকারী শুধু নিজের ডেটা দেখে। Browser-এর Local Save আগের মতোই চলে; Cloud-এ কিছু নিজে থেকে যায় না।
